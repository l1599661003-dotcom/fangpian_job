const text = (value: unknown) => String(value ?? '').trim()

export interface TianjiMeetingRoom {
  meetingroom_id: string | number
  name: string
  capacity?: number
  city?: string
  building?: string
  floor?: string
  equipment?: number[]
  need_approval?: number
  conflicts?: Array<{ start_time: number; end_time: number; booker?: string; status?: number }>
}

export interface TianjiFreeMeetingRoomsResult {
  start_time: number
  end_time: number
  free_count: number
  busy_count: number
  free: TianjiMeetingRoom[]
  busy: TianjiMeetingRoom[]
}

function weixinMessageActionEndpoint(action: string, envName: string, label: string) {
  const configured = text((process.env as Record<string, string | undefined>)[envName])
  if (configured) return configured
  const messageEndpoint = text(process.env.TIANJI_WEIXIN_USER_MESSAGE_URL)
  if (!messageEndpoint) throw new Error(`缺少天玑企微接口地址，无法${label}`)
  let endpoint: URL
  try { endpoint = new URL(messageEndpoint) } catch { throw new Error('天玑企微消息接口地址无效，无法推导接口') }
  if (!/\/admin\/weixinUserMessage\/send\/?$/.test(endpoint.pathname)) {
    throw new Error('天玑企微消息接口地址不是文档中的 send 接口，无法推导接口')
  }
  endpoint.pathname = endpoint.pathname.replace(/\/send\/?$/, `/${action}`)
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint.toString()
}

function readableHtmlError(raw: string) {
  const title = raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
  const body = raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || raw
  const visibleText = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
  const readableTitle = title.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return [readableTitle, visibleText].filter(Boolean).join('：').slice(0, 500)
}

async function postWeixinMessageAction(action: string, envName: string, label: string, body: Record<string, unknown>) {
  const endpoint = weixinMessageActionEndpoint(action, envName, label)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const raw = await response.text()
    const contentType = response.headers.get('content-type') || ''
    let result: any = null
    try { result = raw ? JSON.parse(raw) : null } catch { result = null }
    const code = result?.code ?? result?.errcode
    const numericCode = code === undefined || code === null || code === '' ? undefined : Number(code)
    const codeSuccessful = numericCode === undefined ? Boolean(result?.success ?? result?.status ?? result?.data) : [0, 1, 200].includes(numericCode)
    if (!response.ok || !codeSuccessful) {
      const isHtml = /text\/html/i.test(contentType) || /^\s*<!doctype\s+html\b|^\s*<html\b/i.test(raw)
      const upstreamMessage = text(result?.msg || result?.message || result?.errmsg)
      const reason = (upstreamMessage || (isHtml ? `返回 HTML 错误页：${readableHtmlError(raw) || '未提供可读错误详情'}` : text(raw)) || `HTTP ${response.status}`).slice(0, 500)
      const status = !response.ok || isHtml ? ` (HTTP ${response.status})` : ''
      throw new Error(`企微${label}失败${code !== undefined ? ` (${code})` : ''}${status}：${reason}`)
    }
    return { outer: result, data: result?.data ?? result }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`企微${label}超时，请稍后重试`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function queryTianjiFreeMeetingRooms(startTime: number, endTime: number) {
  if (!Number.isInteger(startTime) || !Number.isInteger(endTime) || endTime <= startTime) {
    throw new Error('会议室查询时间范围无效')
  }
  try {
    const { data } = await postWeixinMessageAction('freeMeetingRooms', 'TIANJI_WEIXIN_FREE_MEETING_ROOMS_URL', '会议室查询', { start_time: startTime, end_time: endTime })
    if (!data || !Array.isArray(data.free) || !Array.isArray(data.busy)) {
      throw new Error('企微会议室查询返回格式异常，无法确认空闲状态')
    }
    return data as TianjiFreeMeetingRoomsResult
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('企微会议室查询超时，请稍后重试')
    throw error
  }
}

export interface TianjiScheduleInput {
  startTime: number
  endTime: number
  summary?: string
  description?: string
  location?: string
  attendees?: string[]
  meetingRoomId?: string
}

export async function createTianjiSchedule(input: TianjiScheduleInput) {
  if (!Number.isInteger(input.startTime) || !Number.isInteger(input.endTime) || input.endTime <= input.startTime) {
    throw new Error('企微日程时间范围无效')
  }
  const body = {
    start_time: input.startTime,
    end_time: input.endTime,
    summary: text(input.summary),
    description: text(input.description),
    location: text(input.location),
    attendees: (input.attendees || []).map(text).filter(Boolean),
    ...(input.meetingRoomId ? { meeting_room_id: text(input.meetingRoomId) } : {}),
  }
  const { data } = await postWeixinMessageAction('createSchedule', 'TIANJI_WEIXIN_CREATE_SCHEDULE_URL', '日程创建', body)
  const result = data?.result ?? data
  const scheduleId = text(result?.schedule_id)
  if (!scheduleId) throw new Error('企微日程创建未返回 schedule_id，不能确认成功')
  return { scheduleId, response: result }
}

export interface TianjiMeetingRoomBookingInput {
  meetingRoomId: string | number
  booker: string
  startTime: number
  endTime: number
  subject?: string
  attendees?: string[]
}

export async function bookTianjiMeetingRoom(input: TianjiMeetingRoomBookingInput) {
  const meetingRoomId = text(input.meetingRoomId)
  const booker = text(input.booker)
  if (!meetingRoomId) throw new Error('缺少企微会议室 ID，无法预定会议室')
  if (!booker) throw new Error('缺少预定人的企微 userid，无法预定会议室')
  if (!Number.isInteger(input.startTime) || !Number.isInteger(input.endTime) || input.endTime - input.startTime < 1800) {
    throw new Error('企微会议室预定时间无效，结束时间必须至少晚于开始时间 30 分钟')
  }
  const roomId = /^\d+$/.test(meetingRoomId) ? Number(meetingRoomId) : meetingRoomId
  const body = {
    meetingroom_id: roomId,
    booker,
    start_time: input.startTime,
    end_time: input.endTime,
    subject: Array.from(text(input.subject)).slice(0, 20).join(''),
    attendees: (input.attendees || []).map(text).filter(Boolean),
  }
  const { outer, data } = await postWeixinMessageAction('bookMeetingRoom', 'TIANJI_WEIXIN_BOOK_MEETING_ROOM_URL', '会议室预定', body)
  if (Number(outer?.code) !== 200) throw new Error(`企微会议室预定失败：接口未返回 code 200${outer?.msg ? `，${text(outer.msg)}` : ''}`)
  const result = data?.result ?? data
  if (result?.errcode !== undefined && Number(result.errcode) !== 0) {
    throw new Error(`企微会议室预定失败 (${result.errcode})：${text(result.errmsg || result.message || '未返回成功回执')}`)
  }
  const bookingId = text(result?.booking_id)
  const scheduleId = text(result?.schedule_id)
  if (!bookingId || !scheduleId) throw new Error('企微会议室预定未同时返回 booking_id 和 schedule_id，不能确认预定成功')
  return { bookingId, scheduleId, response: result }
}

export async function cancelTianjiSchedule(scheduleId: string) {
  if (!text(scheduleId)) throw new Error('缺少企微日程 ID，无法取消日程')
  const { data } = await postWeixinMessageAction('cancelSchedule', 'TIANJI_WEIXIN_CANCEL_SCHEDULE_URL', '日程取消', { schedule_id: text(scheduleId) })
  const result = data?.result ?? data
  if (result?.errcode !== undefined && Number(result.errcode) !== 0) {
    throw new Error(`企微日程取消失败 (${result.errcode})：${text(result.errmsg || result.message || '未返回成功回执')}`)
  }
  return { scheduleId: text(scheduleId), response: result }
}

export interface TianjiMeetingInput {
  adminUserId: string
  title: string
  startTime: number
  endTime: number
  invitees: string[]
}

export async function createTianjiMeeting(input: TianjiMeetingInput) {
  const adminUserId = text(input.adminUserId)
  const invitees = (input.invitees || []).map(text).filter(Boolean)
  if (!adminUserId) throw new Error('缺少会议管理员的企微 userid，无法创建会议')
  if (!invitees.includes(adminUserId)) throw new Error('企微会议管理员必须同时是参会人，无法创建会议')
  const duration = input.endTime - input.startTime
  if (!Number.isInteger(input.startTime) || !Number.isInteger(input.endTime) || duration < 300 || duration > 86399) {
    throw new Error('企微会议时长必须在 5 分钟到 23 小时 59 分钟之间')
  }
  const body = {
    admin_userid: adminUserId,
    title: Array.from(text(input.title)).slice(0, 20).join('') || '面试会议',
    meeting_start: input.startTime,
    meeting_duration: duration,
    invitees,
  }
  const { data } = await postWeixinMessageAction('createMeeting', 'TIANJI_WEIXIN_CREATE_MEETING_URL', '会议创建', body)
  const result = data?.result ?? data
  if (result?.errcode !== undefined && Number(result.errcode) !== 0) {
    throw new Error(`企微会议创建失败 (${result.errcode})：${text(result.errmsg || result.message || '未返回成功回执')}`)
  }
  const meetingId = text(data?.meetingid || result?.meetingid)
  const meetingLink = text(data?.meeting_link || result?.meeting_link)
  if (!meetingId || !/^https?:\/\//i.test(meetingLink)) throw new Error('企微会议创建未返回 meetingid 和 meeting_link，不能确认会议已创建')
  return { meetingId, meetingLink, response: result }
}

export async function cancelTianjiMeeting(meetingId: string) {
  if (!text(meetingId)) throw new Error('缺少企微会议 ID，无法取消会议')
  const { data } = await postWeixinMessageAction('cancelMeeting', 'TIANJI_WEIXIN_CANCEL_MEETING_URL', '会议取消', { meetingid: text(meetingId) })
  const result = data?.result ?? data
  if (result?.errcode !== undefined && Number(result.errcode) !== 0) {
    throw new Error(`企微会议取消失败 (${result.errcode})：${text(result.errmsg || result.message || '未返回成功回执')}`)
  }
  return { meetingId: text(meetingId), response: result }
}

export interface TianjiMailInput {
  toEmails: string[]
  subject: string
  content: string
  contentType?: 'html' | 'text'
}

export async function sendTianjiMail(input: TianjiMailInput) {
  const emails = (input.toEmails || []).map(text).filter(Boolean)
  if (!emails.length) throw new Error('缺少邮件收件人')
  if (!text(input.subject)) throw new Error('邮件主题不能为空')
  if (!text(input.content)) throw new Error('邮件正文不能为空')
  const body = {
    to_emails: emails,
    subject: text(input.subject),
    content: input.content,
    content_type: input.contentType === 'html' ? 'html' : 'text',
  }
  const { data } = await postWeixinMessageAction('sendMail', 'TIANJI_WEIXIN_SEND_MAIL_URL', '邮件发送', body)
  const result = data?.result ?? data
  if (result?.errcode !== undefined && Number(result.errcode) !== 0) {
    throw new Error(`企微邮件发送失败 (${result.errcode})：${text(result.errmsg || result.message || '未返回成功回执')}`)
  }
  return { response: result, messageId: text(result?.message_id || result?.mail_id || result?.id) }
}

export interface TianjiWeixinMessageInput {
  wechatId: string
  message: string
  msgType?: 'markdown' | 'text'
}

export async function sendTianjiWeixinUserMessage(input: TianjiWeixinMessageInput) {
  const endpoint = text(process.env.TIANJI_WEIXIN_USER_MESSAGE_URL)
  if (!endpoint) throw new Error('缺少 TIANJI_WEIXIN_USER_MESSAGE_URL，无法发送个人机器人消息')
  if (!text(input.wechatId)) throw new Error('缺少个人机器人消息接收人的 wechat_id')
  if (!text(input.message)) throw new Error('个人机器人消息内容不能为空')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wechat_id: text(input.wechatId), message: input.message, msg_type: input.msgType || 'markdown' }),
      signal: controller.signal,
    })
    const raw = await response.text()
    let result: any = null
    try { result = raw ? JSON.parse(raw) : null } catch { result = null }
    const code = result?.code ?? result?.errcode
    const numericCode = code === undefined || code === null || code === '' ? undefined : Number(code)
    const failedCode = numericCode !== undefined && ![0, 1, 200].includes(numericCode)
    if (!response.ok || result?.success === false || result?.status === false || failedCode) {
      const reason = text(result?.message || result?.msg || result?.errmsg || raw || `HTTP ${response.status}`).slice(0, 500)
      throw new Error(`天玑个人机器人消息发送失败${code !== undefined ? ` (${code})` : ''}：${reason}`)
    }
    const messageId = text(result?.data?.message_id || result?.data?.msgid || result?.message_id || result?.msgid || result?.id)
    if (!(numericCode !== undefined && [0, 1, 200].includes(numericCode)) && result?.success !== true && result?.status !== true && !messageId) {
      throw new Error('天玑个人机器人消息未返回明确成功回执，不能确认发送成功')
    }
    return {
      message_id: messageId,
      recipient: text(input.wechatId),
      response: result ?? raw,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('天玑个人机器人消息发送超时，请稍后重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const tianjiWeixinMessage = {
  send: sendTianjiWeixinUserMessage,
  freeMeetingRooms: queryTianjiFreeMeetingRooms,
  bookMeetingRoom: bookTianjiMeetingRoom,
  createSchedule: createTianjiSchedule,
  cancelSchedule: cancelTianjiSchedule,
  createMeeting: createTianjiMeeting,
  cancelMeeting: cancelTianjiMeeting,
  sendMail: sendTianjiMail,
}
