// 天玑只读直调 SDK — 应用后端分页批量拉天玑数据 (订单/线索/达人/品牌...).
//
// 工作原理:
//   - 复用 STUDIO_PLATFORM_URL + STUDIO_APP_TOKEN (预览与发布运行时都注入了这两个 env)
//   - 调 Studio Meta 平台代理 /api/v1/platform/tianji/call
//   - Meta 经 ARP MCP tianji_call 转发, 借用本应用 owner 绑定的天玑账号 (只读)
//   - 用户代码不接触任何天玑 token; 写操作 / 回调端点会被网关拒绝 (只读护栏)
//
// 为什么用它而不是让 AI 在对话里逐条搬: 这条路是 程序→程序, 数据不经过 AI 上下文,
// 所以能在后台分页把近一个月几千条订单/线索一次性写进应用库.
//
// 用法:
//   import { tianji } from './platform/tianji'
//
//   // 单页 (带 fields 字段裁剪, 单行从 ~20KB 压到几百字节, 才能用大 pageSize):
//   const r = await tianji.call('/api/admin/order/getOrderList',
//     { page: 1, pageSize: 200, order_date: '2026-05-01,2026-06-01' },
//     ['id', 'order_code', 'platform_name', 'deal_price'])
//   const orders = r.data?.list ?? []          // 总数在 r.data.count 或 r.data.total
//
//   // 自动翻页拉全量 + 边拉边写库 (推荐):
//   await tianji.fetchAll('/api/admin/order/getOrderList',
//     { order_date: '2026-05-01,2026-06-01' },
//     ['id', 'order_code', 'platform_name', 'deal_price'],
//     { onPage: async (rows) => { await upsertOrders(rows) } })
//
//   // 只读 POST 端点 (filter/分页在 body, 如「支出管理 → 博主支出」):
//   // 天玑侧 order/finance/page/list 是 POST-only, 须传 method:'POST' + body.
//   const r2 = await tianji.call('/api/admin/order/finance/page/list',
//     undefined,
//     ['id', 'entity_id', 'money_total', 'cash_date', 'platform_name'],
//     { method: 'POST', body: { settlement_type: 3, private_flag: 0, page: 1, pageSize: 200 } })
//   // 或自动翻页 (body 里带 page/pageSize):
//   await tianji.fetchAll('/api/admin/order/finance/page/list',
//     { settlement_type: 3, private_flag: 0 },
//     ['id', 'money_total', 'cash_date'],
//     { method: 'POST', onPage: async (rows) => { await upsertExpenses(rows) } })
//
// 天玑日期过滤参数 (因端点而异, 先用 tianji_describe_api 核对):
//   - 订单 order/getOrderList: order_date="2026-05-01,2026-06-01"
//   - 线索 clueAllocation/getMergedList: invitation_time_start + invitation_time_end 两个参数
//     (不是 invitation_initiation_time, 那个当过滤无效会返全量)

const BASE = (process.env.STUDIO_PLATFORM_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.STUDIO_APP_TOKEN || ''

const AUTH_HINT =
  'Studio 平台授权缺失或已失效（非应用代码问题）：在 Studio 重新登录后重启该应用预览即可恢复。'

export class PlatformAuthError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'PlatformAuthError'
  }
}

// 天玑列表响应体: { code, msg, data: { list, total? / count? } }
export interface TianjiResponse<T = any> {
  code: number
  msg?: string
  data?: { list?: T[]; total?: number; count?: number; [k: string]: any }
}

export interface FetchAllOpts<T = any> {
  pageSize?: number // 单页条数, 默认 200 (上限 200)
  onPage?: (rows: T[], page: number) => Promise<void> | void // 边拉边处理, 不传则收集后一次返回
  maxPages?: number // 安全上限, 默认 1000 页
  method?: 'GET' | 'POST' // POST-only 列表 (如 order/finance/page/list): page/pageSize 放 body
}

class TianjiClient {
  /**
   * 通用只读直调. path 须以 /api/admin/ 开头 (只读护栏由网关执行).
   * 自带退避重试: 429 (限流, ~5 QPS) / 5xx (上游抖动) 时按 Retry-After 或指数退避重试,
   * 最多 maxRetries 次; 401/403 (授权问题) 立刻抛 PlatformAuthError 不重试; 4xx (入参错)
   * 直接抛不重试. 所以分页循环里偶发 429 不会让整批中断.
   */
  async call<T = any>(
    path: string,
    query?: Record<string, any>,
    fields?: string[],
    opts: { maxRetries?: number; method?: 'GET' | 'POST'; body?: Record<string, any> } = {},
  ): Promise<TianjiResponse<T>> {
    // 只要求 BASE; token 缺失正常(B 方案由 session-runtime /platform 代理注入 Bearer)。
    if (!BASE) throw new PlatformAuthError(AUTH_HINT)
    const maxRetries = opts.maxRetries ?? 4
    // method/body 仅对天玑确认的只读 POST 端点用 (filter 在 body); 缺省 GET, 行为不变。
    // 网关侧仍有白名单 + 写护栏, 非只读 POST 会被拒。
    const method = opts.method === 'POST' ? 'POST' : undefined
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}/tianji/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ path, query, fields, method, body: opts.body }),
      })
      if (res.status === 401 || res.status === 403) {
        throw new PlatformAuthError(`${AUTH_HINT}（平台返回 ${res.status}）`)
      }
      // 429 限流 / 5xx 上游抖动: 退避后重试 (优先 Retry-After 秒数, 否则 0.5s*2^n).
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const ra = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      const text = await res.text()
      if (!res.ok) throw new Error(`tianji ${path} ${res.status}: ${text}`)
      let parsed: any
      try {
        parsed = JSON.parse(text)
      } catch {
        return { code: -1, msg: text } as any
      }
      // Meta 外层 { code, data, message }, 里层 data 才是天玑响应体
      const body = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
      return body as TianjiResponse<T>
    }
  }

  /**
   * 自动翻页拉全量. 内部用大 pageSize + fields, 按 total/count 翻到底.
   * onPage 回调可边拉边写库 (推荐, 避免把几千条全堆内存); 不传则收集后一次返回.
   */
  async fetchAll<T = any>(
    path: string,
    query: Record<string, any> = {},
    fields?: string[],
    opts: FetchAllOpts<T> = {},
  ): Promise<T[]> {
    const pageSize = Math.min(opts.pageSize || 200, 200)
    const maxPages = opts.maxPages || 1000
    const post = opts.method === 'POST'
    const all: T[] = []
    for (let page = 1; page <= maxPages; page++) {
      // GET: 分页在 query; POST-only 列表: 分页+filter 在 body (query 留空)。
      const r = post
        ? await this.call<T>(path, undefined, fields, {
            method: 'POST',
            body: { ...query, page, pageSize },
          })
        : await this.call<T>(path, { ...query, page, pageSize }, fields)
      const list = (r?.data?.list ?? []) as T[]
      if (list.length === 0) break
      if (opts.onPage) await opts.onPage(list, page)
      else all.push(...list)
      const total = r?.data?.count ?? r?.data?.total ?? 0
      if (list.length < pageSize || (total > 0 && page * pageSize >= total)) break
    }
    return all
  }

  async searchEmployees(keyword: string, fields: string[] = [
    'id', 'employee_name', 'employee_phone', 'employee_email', 'wechat_id', 'status', 'departments',
  ]) {
    const name = String(keyword ?? '').trim()
    if (!name) return []
    return this.fetchAll('/api/admin/employee/getEmployeeList', { employee_name: name }, fields)
  }
}

export const tianji = new TianjiClient()
