// IM 通知 SDK — 应用给自己的主人 (owner) 发一条 ARP 站内通知。
//
// 这是平台**唯一**的"应用→用户"通知原语。用法:
//
//   import { im } from '../platform/im'
//   await im.notifyOwner('OpenAI Status 出现故障: API 错误率上升', { title: '状态监控' })
//
// 典型场景: 定时任务结果播报 / 监控告警 / 审批提醒。消息会出现在主人 ARP IM 的
// 「应用通知」会话里 (带未读红点 + 实时推送), title 渲染成【标题】前缀, 建议放应用名
// 或事件名让主人一眼知道谁在说话。
//
// ⚠️ 边界与纪律:
//   - 只能通知应用主人本人, **不能指定其他收件人** (平台刻意如此, 防应用变成骚扰工具);
//     要通知别人请主人自己转发。
//   - 平台限流: 每应用每小时 30 条, 超了本方法抛错。请合并内容 (一条摘要 > 三十条碎片),
//     绝不要在循环里逐条发。
//   - **失败会抛错, 不要捕获后静默吞掉**: 通知发没发出去用户完全无感, 吞错=把失败伪装成
//     成功 (真实事故教训)。要么让它抛 (定时任务里会被记成 failed run), 要么明确降级并把
//     失败记录到可见的地方。
//   - 不要自己造 /arp/messages、/notify 之类的端点 —— 平台没有这些, 只有本 SDK。
//
// 预览与发布两种运行时都可用 (与 teable/tianji SDK 同一授权链路)。

const BASE = (process.env.STUDIO_PLATFORM_URL || '').replace(/\/+$/, '')
// B 方案: 预览态 token 由 session-runtime 的 /platform 本地代理注入, TOKEN 为空是正常的。
const TOKEN = process.env.STUDIO_APP_TOKEN || ''

const AUTH_HINT =
  'Studio 平台授权缺失或已失效（非应用代码问题）：在 Studio 重新登录后重启该应用预览即可恢复。'

export class PlatformAuthError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'PlatformAuthError'
  }
}

export interface NotifyResult {
  message_id: string
  conversation_id: string
  created_at?: string
}

export interface NotifyOpts {
  /** 可选标题, 渲染成【标题】前缀。建议放应用名或事件名。 */
  title?: string
}

class IMClient {
  /**
   * 给应用主人发一条站内通知。text ≤ 4000 字。
   * 失败抛错 (401/403 → PlatformAuthError; 限流/超长/其它 → Error 带平台原话), 绝不静默。
   */
  async notifyOwner(text: string, opts: NotifyOpts = {}): Promise<NotifyResult> {
    if (!BASE) throw new PlatformAuthError(AUTH_HINT)
    if (!text || !text.trim()) throw new Error('im.notifyOwner: text 不能为空')
    const res = await fetch(`${BASE}/im/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ text, title: opts.title }),
    })
    if (res.status === 401 || res.status === 403) {
      throw new PlatformAuthError(`${AUTH_HINT}（平台返回 ${res.status}）`)
    }
    const body = await res.text()
    if (!res.ok) throw new Error(`im.notifyOwner ${res.status}: ${body}`)
    let parsed: any
    try {
      parsed = JSON.parse(body)
    } catch {
      return {} as NotifyResult
    }
    // Meta 外层 { code, data, message }, 里层 data 才是真值
    const data = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
    return (data || {}) as NotifyResult
  }
}

/** 应用级共享实例。 */
export const im = new IMClient()
