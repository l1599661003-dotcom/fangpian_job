const BASE = (process.env.STUDIO_PLATFORM_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.STUDIO_APP_TOKEN || ''

export async function callMcp<T = any>(tool: string, args: Record<string, any>): Promise<T> {
  if (!BASE) throw new Error('缺少 STUDIO_PLATFORM_URL，无法调用平台能力')
  const response = await fetch(`${BASE}/mcp/call`, {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tool, args }),
  })
  const text = await response.text()
  let parsed: any = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
  if (!response.ok) {
    const rawMessage = Array.isArray(parsed?.message) ? parsed.message.join('；') : parsed?.message || parsed?.error || parsed?.detail || text
    // 平台/MCP 的请求错误要回显给业务界面，便于区分工具未注册、参数校验失败和上游权限失败；
    // 同时限制长度，避免意外把大段上游响应或敏感上下文写入业务记录。
    const message = String(rawMessage || '未返回具体原因').replace(/\s+/g, ' ').trim().slice(0, 500)
    throw new Error(`平台能力 ${tool} 调用失败 (${response.status})：${message}`)
  }
  if (!parsed) throw new Error(`平台能力 ${tool} 返回了无效响应`)
  return parsed?.data ?? parsed
}

export async function listMcpTools(): Promise<any[]> {
  if (!BASE) throw new Error('缺少 STUDIO_PLATFORM_URL，无法读取平台能力清单')
  const response = await fetch(`${BASE}/mcp/tools`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30_000) })
  const text = await response.text()
  let parsed: any = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
  if (!response.ok) {
    const message = String(parsed?.message || parsed?.error || text || '未返回具体原因').replace(/\s+/g, ' ').trim().slice(0, 500)
    throw new Error(`平台能力清单读取失败 (${response.status})：${message}`)
  }
  const data = parsed?.data ?? parsed
  return Array.isArray(data) ? data : Array.isArray(data?.tools) ? data.tools : []
}

/**
 * `wecom_cli` may report a command-line error in a successful MCP HTTP
 * response, wrapped as `{ text: 'error: ...' }`. Treat that as a failed
 * platform operation so callers never mistake an invalid command for an
 * empty business result.
 */
export function assertWecomCliSuccess<T = any>(result: T): T {
  const raw = typeof (result as any)?.text === 'string' ? (result as any).text.trim() : ''
  let parsedText: any = null
  try { parsedText = raw ? JSON.parse(raw.split(/\n\n\[diagnosis\]/)[0].trim()) : null } catch { parsedText = null }
  const nestedErrcode = Number(parsedText?.errcode || 0)
  const businessError = (result as any)?.error || parsedText?.error || (nestedErrcode ? { code: nestedErrcode, message: parsedText?.errmsg || '企业微信返回业务错误' } : null)
  if (businessError) {
    const code = businessError?.code ?? businessError?.errcode
    const detail = typeof businessError === 'string' ? businessError : String(businessError?.message || businessError?.errmsg || JSON.stringify(businessError))
    const message = `wecom_cli 业务错误${code ? ` (${code})` : ''}: ${detail.slice(0, 300)}`
    console.error(message)
    throw new Error(message)
  }
  if (/(?:^error:|unrecognized subcommand|Usage:)/i.test(raw)) {
    const message = `wecom_cli 参数错误: ${raw.slice(0, 300)}`
    console.error(message)
    throw new Error(message)
  }
  return result
}

export async function callWecomCli<T = any>(argv: string[]): Promise<T> {
  return assertWecomCliSuccess(await callMcp<T>('wecom_cli', { argv }))
}

export const ocr = {
  recognize: (imageUrl: string) => callMcp<any>('ocr_recognize', { image_url: imageUrl, type: 'Advanced' }),
}

export const wecom = {
  cli: (argv: string[]) => callWecomCli<any>(argv),
}
