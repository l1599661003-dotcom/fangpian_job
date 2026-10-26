const BASE = (process.env.STUDIO_PLATFORM_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.STUDIO_APP_TOKEN || ''

export const llm = {
  async chat(messages: Array<{ role: string; content: string }>, options: { timeoutMs?: number } = {}): Promise<string> {
    if (!BASE) throw new Error('缺少 STUDIO_PLATFORM_URL，无法调用大模型')
    const response = await fetch(`${BASE}/llm/v1/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(options.timeoutMs || 120_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ messages, stream: false, temperature: 0 }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`大模型调用失败 (${response.status}): ${text.slice(0, 300) || '无响应内容'}`)
    const parsed = JSON.parse(text)
    return parsed?.choices?.[0]?.message?.content || ''
  },
}
