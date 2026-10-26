const BASE = (process.env.STUDIO_PLATFORM_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.STUDIO_APP_TOKEN || ''

export interface PresignResult {
  uploadUrl: string
  method: 'PUT'
  objectKey: string
  cdnUrl: string
  contentType: string
  expiresIn: number
}

export const storage = {
  async getUploadUrl(filename: string, contentType: string): Promise<PresignResult> {
    if (!BASE) throw new Error('缺少 STUDIO_PLATFORM_URL，无法访问对象存储')
    const response = await fetch(`${BASE}/storage/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ filename, contentType }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`对象存储签名失败 (${response.status})`)
    const parsed = JSON.parse(text)
    return parsed?.data ?? parsed
  },
  async upload(filename: string, contentType: string, bytes: Buffer): Promise<PresignResult> {
    const signed = await this.getUploadUrl(filename, contentType)
    const response = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.contentType ? { 'Content-Type': signed.contentType } : {},
      body: bytes as any,
    })
    if (!response.ok) throw new Error(`文件上传失败 (${response.status})`)
    return signed
  },
}
