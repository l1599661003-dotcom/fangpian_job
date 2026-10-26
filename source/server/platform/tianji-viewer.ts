// 天玑「代客授权」SDK — 让应用**代表当前访客本人**读天玑，各看各的数据。
//
// ┌─ 先决定用哪一个 ─────────────────────────────────────────────────────────┐
// │  面向使用者的查询（他打开页面要看"我的订单"）→ 本文件 tianjiViewer      │
// │  后台任务 / 定时同步 / 批量入库（没有"当前使用者"）→ platform/tianji.ts  │
// └─────────────────────────────────────────────────────────────────────────┘
// 猜错的后果是真实的：用 owner 身份去做面向使用者的查询 = 所有人看到同一份数据
// （通常是老板的全量数据）；用访客身份去跑定时任务 = 任务必然报错，因为那时没有访客。
//
// ★★ 三条铁律（违反其中任何一条，二级授权就白做了）：
//
//   1. **访客身份查到的数据，不要写进所有人共读的表。**
//      甲的订单落进 orders 表，乙打开页面就看得见 —— 隔离在应用层被打破，
//      网关这边做得再严也没用。要缓存就按 (viewerKey, ...) 分区存。
//
//   2. **句柄（handle）只能待在服务端。** 不要塞进接口响应、URL、localStorage。
//      句柄代表"这个人授权你代表他访问天玑"，泄漏等于把授权转让出去。
//      本 SDK 不提供任何"取出 handle"的方法，就是为了断掉这条路。
//
//   3. **未授权时不要回落 owner 身份。** 正确做法是把 TianjiAuthRequired 抛给前端，
//      让它引导用户去授权（错误对象自带 consentUrl）。悄悄换成 owner = 用户以为
//      看的是自己的数据，其实是别人的。
//
// 用法（三步）：
//
//   // ① 查询：未授权会抛 TianjiAuthRequired
//   import { tianjiViewer, TianjiAuthRequired } from './platform/tianji-viewer'
//   app.get('/api/my-orders', async (req, res) => {
//     try {
//       const r = await tianjiViewer.of(req).call('/api/admin/order/getOrderList',
//         { page: 1, pageSize: 50 }, ['id', 'order_code', 'deal_price'])
//       res.json({ list: r.data?.list ?? [] })
//     } catch (e) {
//       if (e instanceof TianjiAuthRequired) {
//         return res.status(200).json({ needAuth: true, consentUrl: e.consentUrl })
//       }
//       throw e
//     }
//   })
//
//   // ② 发起授权：前端拿 consentUrl 开小窗（组件见 client/src/TianjiConnect.tsx）
//   app.post('/api/tianji/connect', async (req, res) => {
//     res.json(await tianjiViewer.startAuthorization(req, { returnPath: '/tianji-callback' }))
//   })
//
//   // ③ 回调：前端把一次性 code 送回来，换成句柄存服务端
//   app.post('/api/tianji/callback', async (req, res) => {
//     await tianjiViewer.completeAuthorization(req, req.body.code)
//     res.json({ ok: true })
//   })
//
// ── 用天玑账号**登录**应用（identity_v1）────────────────────────────────────
// 需求是"员工点『用天玑账号登录』进我的应用"时用这一组，**不要**拿 order_read_v1 /
// creator_read_v1 顶替 —— 那样同意页会写"查看订单/达人"，向使用者要走一份你根本不用的权限。
// identity_v1 零端点，同意页只写"确认你的天玑身份"。前端同样用 TianjiConnect.tsx，
// 只是把 connectPath / callbackPath 指到下面两个路由。
//
//   app.post('/api/tianji/login/start', async (req, res) => {
//     res.json(await tianjiViewer.startLogin(req, { returnPath: '/tianji-callback' }))
//   })
//   app.post('/api/tianji/login/callback', async (req, res) => {
//     const who = await tianjiViewer.completeLogin(req, req.body.code)  // { sub, name, dept, role, phone }
//     // who.sub = 天玑员工 ID，用它认人；在这里签应用自己的会话 cookie。
//     // 身份只认这里返回的 subject，前端传上来的姓名/工号/手机号一律不采纳。
//     res.json({ ok: true, name: who.name })
//   })

import type { Request } from 'express'
import { getStudioUser } from './user'

const BASE = (process.env.ARP_BASE_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.ARP_API_TOKEN || ''
const APP_ID = process.env.STUDIO_APP_ID || ''

/** 该访客还没授权（或已撤销/过期）。consentUrl 给前端开小窗用。 */
export class TianjiAuthRequired extends Error {
  readonly consentUrl?: string
  constructor(msg: string, consentUrl?: string) {
    super(msg)
    this.name = 'TianjiAuthRequired'
    this.consentUrl = consentUrl
  }
}

/** 调用超出了本次授权的范围（模板没包含这个端点）。换端点，或联系平台加模板。 */
export class TianjiScopeError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'TianjiScopeError'
  }
}

/**
 * 授权人的天玑身份，出自授权流程本身（使用者在天玑亲自登录并同意），应用伪造不了。
 * sub = 天玑员工 ID，做用户归属用它；phone 是天玑已验证的手机号，可用来关联存量账号。
 */
export interface TianjiSubject {
  sub: string
  name?: string
  dept?: string
  role?: string
  phone?: string
}

/** completeAuthorization 的结果。句柄不在里面 —— 它只待在服务端的 store 里。 */
export interface TianjiAuthResult {
  templateId: string
  subject: TianjiSubject | null
  expiresAt?: string
}

/** 只确认身份、不读业务数据的模板。它的句柄调任何端点都 403，所以不存。 */
export const TIANJI_IDENTITY_TEMPLATE = 'identity_v1'

export interface TianjiResponse<T = any> {
  code: number
  msg?: string
  data?: { list?: T[]; total?: number; count?: number; [k: string]: any }
}

/**
 * 句柄存储。默认进程内 Map。
 *
 * ★ 应用有多个副本、或希望重启后授权仍在时，换成你自己的实现（存应用库即可）：
 *     tianjiViewer.setStore({ get, set, del })
 * 存的是句柄本身，**不要**把它放进任何会返回给前端的表/字段。
 */
export interface HandleStore {
  get(viewerKey: string): Promise<string | null> | string | null
  set(viewerKey: string, handle: string): Promise<void> | void
  del(viewerKey: string): Promise<void> | void
}

class MemoryStore implements HandleStore {
  private m = new Map<string, string>()
  get(k: string) {
    return this.m.get(k) ?? null
  }
  set(k: string, v: string) {
    this.m.set(k, v)
  }
  del(k: string) {
    this.m.delete(k)
  }
}

function gatewayReady(): boolean {
  return Boolean(BASE && TOKEN && APP_ID)
}

/** 网关的错误信封与天玑的业务响应体都长得像 {code,...}，用 request_id 区分是谁在说话。 */
function isGatewayEnvelope(body: any): boolean {
  return body && typeof body === 'object' && typeof body.code === 'number' && 'request_id' in body
}

async function gatewayPost(path: string, body: unknown, handle?: string): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  }
  if (handle) headers['X-ARP-Tianji-Handle'] = handle
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`tianji delegate ${path} ${res.status}: ${text}`)
  }
}

class ViewerClient {
  constructor(
    private readonly key: string,
    private readonly owner: TianjiViewer,
  ) {}

  /**
   * 以**当前访客本人**的天玑身份只读调用。
   * 未授权 / 已撤销 / 已过期 → 抛 TianjiAuthRequired（带 consentUrl，直接给前端）。
   * 端点不在授权模板内 → 抛 TianjiScopeError。
   */
  async call<T = any>(path: string, query?: Record<string, any>, fields?: string[]): Promise<TianjiResponse<T>> {
    const handle = await this.owner.handleOf(this.key)
    if (!handle) throw new TianjiAuthRequired('该用户尚未授权天玑', await this.owner.consentUrlFor(this.key))

    const body = await gatewayPost('/openplatform/v1/tianji/delegate/call', { path, query, fields }, handle)
    // 网关的错误一律 HTTP 200 + 信封里的 code，必须看 body.code（不是 res.status）
    if (isGatewayEnvelope(body) && body.code !== 200) {
      if (body.code === 401 || (body.code === 403 && /撤销|过期|句柄/.test(body.message || ''))) {
        await this.owner.forget(this.key) // 已失效的句柄没有留存价值
        throw new TianjiAuthRequired(body.message || '授权已失效', await this.owner.consentUrlFor(this.key))
      }
      if (body.code === 403) throw new TianjiScopeError(body.message || '不在授权范围内')
      throw new Error(`tianji delegate ${path}: [${body.code}] ${body.message}`)
    }
    return body as TianjiResponse<T>
  }

  /** 自动翻页。语义同 platform/tianji.ts 的 fetchAll，只是身份换成访客本人。 */
  async fetchAll<T = any>(
    path: string,
    query: Record<string, any> = {},
    fields?: string[],
    opts: { pageSize?: number; maxPages?: number; onPage?: (rows: T[], page: number) => Promise<void> | void } = {},
  ): Promise<T[]> {
    const pageSize = Math.min(opts.pageSize || 200, 200)
    const maxPages = opts.maxPages || 1000
    const all: T[] = []
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.call<T>(path, { ...query, page, pageSize }, fields)
      const list = (r?.data?.list ?? []) as T[]
      if (list.length === 0) break
      if (opts.onPage) await opts.onPage(list, page)
      else all.push(...list)
      const total = r?.data?.count ?? r?.data?.total ?? 0
      if (list.length < pageSize || (total > 0 && page * pageSize >= total)) break
    }
    return all
  }

  /** 这个访客现在是否已授权（用于前端决定显示"连接天玑"还是数据）。 */
  async isConnected(): Promise<boolean> {
    return Boolean(await this.owner.handleOf(this.key))
  }

  /** 使用者在应用里点"断开天玑账号"。幂等。 */
  async disconnect(): Promise<void> {
    const handle = await this.owner.handleOf(this.key)
    if (handle) await gatewayPost('/openplatform/v1/tianji/delegate/revoke', {}, handle)
    await this.owner.forget(this.key)
  }
}

class TianjiViewer {
  private store: HandleStore = new MemoryStore()
  private pendingConsent = new Map<string, string>() // viewerKey → consentUrl（最近一次发起）

  /** 换成你自己的句柄存储（多副本 / 需要重启后保留授权时必须换）。 */
  setStore(s: HandleStore) {
    this.store = s
  }

  /**
   * 当前访客的标识。默认取 Studio 反代注入的用户头；没有则退回 SDK 自己种的 cookie。
   *
   * ★ 它只用来把句柄和"同一个浏览器/同一个人"对应起来，**不承担鉴权**——
   * 真正的身份是使用者在天玑那边亲自登录授权出来的，应用伪造不了。
   */
  viewerKey(req: Request): string {
    const u = getStudioUser(req)
    if (u?.id) return `arp:${u.id}`
    const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)tj_viewer=([^;]+)/)
    if (cookie) return `br:${cookie[1]}`
    return 'anon'
  }

  of(req: Request): ViewerClient {
    return new ViewerClient(this.viewerKey(req), this)
  }

  /** 发起授权：返回 {consentUrl}，前端拿它开小窗。 */
  async startAuthorization(
    req: Request,
    opts: { templateId?: string; returnPath?: string } = {},
  ): Promise<{ consentUrl: string }> {
    if (!gatewayReady()) throw new Error('平台环境缺失 ARP_BASE_URL / ARP_API_TOKEN / STUDIO_APP_ID')
    const origin = appOrigin(req)
    const body = {
      templateId: opts.templateId || 'order_read_v1',
      return: origin + (opts.returnPath || '/tianji-callback'),
      popup: true,
    }
    const r = await gatewayPost('/openplatform/v1/tianji/delegate/start', body)
    if (!isGatewayEnvelope(r) || r.code !== 200) {
      throw new Error(`发起天玑授权失败: [${r?.code}] ${r?.message}`)
    }
    const url = r.data.consentUrl as string
    this.pendingConsent.set(this.viewerKey(req), url)
    return { consentUrl: url }
  }

  /**
   * 回调：把前端送回的一次性 code 换成句柄并存下。code 2 分钟内有效、只能用一次。
   * 返回授权人的天玑身份（subject）—— 想知道"这次是谁授权的"就读它，别再向使用者要。
   */
  async completeAuthorization(req: Request, code: string): Promise<TianjiAuthResult> {
    if (!gatewayReady()) throw new Error('平台环境缺失 ARP_BASE_URL / ARP_API_TOKEN / STUDIO_APP_ID')
    const r = await gatewayPost('/openplatform/v1/tianji/delegate/exchange', { code })
    if (!isGatewayEnvelope(r) || r.code !== 200) {
      throw new TianjiAuthRequired(`兑换授权失败: ${r?.message || ''}`, this.pendingConsent.get(this.viewerKey(req)))
    }
    const templateId = String(r.data?.templateId || '')
    if (templateId !== TIANJI_IDENTITY_TEMPLATE) {
      await this.store.set(this.viewerKey(req), r.data.handle as string)
    }
    const s = r.data?.subject
    return {
      templateId,
      subject: s && typeof s.sub === 'string' && s.sub ? (s as TianjiSubject) : null,
      expiresAt: r.data?.expiresAt,
    }
  }

  /** 发起"用天玑账号登录"：等同 startAuthorization，模板固定为 identity_v1。 */
  async startLogin(req: Request, opts: { returnPath?: string } = {}): Promise<{ consentUrl: string }> {
    return this.startAuthorization(req, { ...opts, templateId: TIANJI_IDENTITY_TEMPLATE })
  }

  /**
   * 登录回调：一次性 code 换成授权人的天玑身份。拿不到 subject.sub 就抛 TianjiAuthRequired ——
   * **不要**回落成演示身份 / owner 身份 / 前端传来的身份。
   */
  async completeLogin(req: Request, code: string): Promise<TianjiSubject> {
    const r = await this.completeAuthorization(req, code)
    if (!r.subject) {
      throw new TianjiAuthRequired('天玑没有返回授权人身份，请重新登录', this.pendingConsent.get(this.viewerKey(req)))
    }
    return r.subject
  }

  /** 平台提供的授权模板清单（同意页会按它逐条展示给使用者）。 */
  async templates(): Promise<Array<{ id: string; name: string; summary: string }>> {
    const res = await fetch(`${BASE}/openplatform/v1/tianji/delegate/templates`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const body = await res.json()
    return body?.data?.templates ?? []
  }

  // —— 内部 ——
  async handleOf(key: string): Promise<string | null> {
    return (await this.store.get(key)) || null
  }
  async forget(key: string): Promise<void> {
    await this.store.del(key)
  }
  async consentUrlFor(key: string): Promise<string | undefined> {
    return this.pendingConsent.get(key)
  }
}

/** 应用自己的对外 origin（授权完要跳回来）。反代会带 X-Forwarded-*。 */
function appOrigin(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || ''
  return `${proto}://${host}`
}

export const tianjiViewer = new TianjiViewer()
