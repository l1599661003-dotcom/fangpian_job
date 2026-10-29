import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { tianji } from '../../platform/tianji'
import { teable, TeableRecord } from '../../platform/teable'
import { tianjiWeixinMessage } from '../../platform/tianji-weixin-message'
import { ReadCache } from '../../platform/read-cache'
import { DatabaseService } from '../database/database.service'
import { MessagesService } from '../messages/messages.service'
import { appFlowUrl, interviewScheduleUrl } from '../../platform/app-links'
import { candidateEmailCard } from '../../platform/candidate-email'
import { AvailabilityInput, GroupInterviewInput, InterviewAppointmentInput, InterviewerInput, MeetingRoomAvailabilityQuery, MeetingRoomInput } from './interview.types'
import { EvaluationService } from './evaluation.service'
import { structuredInterviewTargetCount } from './interview-question-blueprint'
import { canReadInterview, InterviewAccessScope } from './interview-access'
import { isOnlineInterviewMode, normalizeInterviewMode, ONLINE_INTERVIEW_MODE } from './interview-mode'

const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
const text = (value: unknown) => String(value ?? '').trim()
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const json = <T>(value: unknown, fallback: T): T => { try { return value ? JSON.parse(String(value)) as T : fallback } catch { return fallback } }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const MAX_SINGLE_INTERVIEW_DURATION_MS = 8 * 60 * 60 * 1000
const isWecomAuthorizationExpired = (message: string) => /\b850003\b|authorization\s+expired|企微认证已过期/i.test(message)
type TianjiRoomBookingSnapshot = { meetingRoomId: string; booker: string; startTime: number; endTime: number; subject: string; attendees: string[]; scheduleId?: string }
type TianjiMeetingSnapshot = { meetingId: string; meetingLink: string; adminUserId: string; startTime: number; endTime: number; attendees: string[] }
function sameMeetingSchedule(meeting: TianjiMeetingSnapshot, requested: Pick<TianjiMeetingSnapshot, 'startTime' | 'endTime' | 'adminUserId' | 'attendees'>) {
  return Boolean(meeting.meetingId && meeting.meetingLink) && meeting.startTime === requested.startTime && meeting.endTime === requested.endTime && meeting.adminUserId === requested.adminUserId && JSON.stringify([...(meeting.attendees || [])].sort()) === JSON.stringify([...requested.attendees].sort())
}
const interviewResultEmailHtml=(candidateName:string,round:string,result:string,note:string)=>candidateEmailCard({
  candidateName,
  title:'面试结果通知',
  intro:[`感谢你参加方片新媒体${round}面试。经过面试官综合评估，你的面试结果如下。`,'如需了解后续安排，我们会另行与你联系。'],
  details:[{label:'面试轮次',value:round},{label:'面试结果',value:result}],
  note,
  noteTitle:'结果说明',
  footer:'方片新媒体招聘团队',
})

@Injectable()
export class InterviewsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly messages: MessagesService,
    private readonly evaluations: EvaluationService,
  ) {}
  private candidateName(candidate: TeableRecord | undefined) { return text(candidate?.fields['姓名']) || '候选人' }
  private candidateDayBeforeReminderAt(startAt: string) {
    const timestamp = Date.parse(startAt)
    if (!Number.isFinite(timestamp)) return Number.NaN
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp))
    const localDate = `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`
    const previousDay = new Date(`${localDate}T00:00:00.000Z`)
    previousDay.setUTCDate(previousDay.getUTCDate() - 1)
    return Date.parse(`${previousDay.toISOString().slice(0, 10)}T09:00:00+08:00`)
  }
  private candidateEmailReminderEnabled(interview: TeableRecord) { return text(interview.fields['候选人邮件发送选项']) !== '否' }
  private readonly roomSelections = new Map<string, { expiresAt: number; startAt: string; endAt: string; rooms: Array<{ externalResourceId: string; name: string; location: string; floor: string; capacity: number; equipment: string[]; available: boolean; needApproval: boolean }> }>()

  private async notifyPositionHr(category: string, candidateId: string, markdown: string, objectId?: string, positionId?: string, applicationId?: string, operator?: string) {
    await this.messages.notifyPositionHr({ category, candidateId, objectId, positionId, applicationId, markdown, operator }).catch((error) => {
      console.error(`[流程私信] ${category} 失败: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private table(name: string) { return this.database.requireTableId(name) }

  private authorizationNotice: { expiresAt: number; promise: Promise<{ status: string; message: string }> } | null = null
  private candidateReminderLocks = new Map<string, Promise<{ status: string }>>()

  async checkCandidateDayBeforeReminders() {
    const rows = await teable.listAllRecords(this.table('recruitment_interviews'))
    let sent = 0
    const errors: string[] = []
    const current = Date.now()
    for (const row of rows) {
      const startAt = text(row.fields['开始时间'])
      const reminderAt = this.candidateDayBeforeReminderAt(startAt)
      if (['已取消', '已完成'].includes(text(row.fields['面试状态'])) || text(row.fields['同步状态']) !== '已同步' || !this.candidateEmailReminderEnabled(row) || !Number.isFinite(reminderAt) || reminderAt > current || Date.parse(startAt) <= current) continue
      const interviewId = text(row.fields['面试ID']) || row.id
      const key = `${interviewId}:${startAt}`
      if (this.candidateReminderLocks.has(key)) continue
      const pending = this.sendCandidateDayBeforeReminder(interviewId, startAt)
      this.candidateReminderLocks.set(key, pending)
      try {
        const result = await pending
        if (result.status === '已发送') sent++
        } catch (error) { errors.push(`${interviewId}: ${error instanceof Error ? error.message : String(error)}`) }
      finally { if (this.candidateReminderLocks.get(key) === pending) this.candidateReminderLocks.delete(key) }
    }
    return { checked: rows.length, sent, errors }
  }

  private async sendCandidateDayBeforeReminder(interviewId: string, startAt: string) {
    const row = await this.findInterview(interviewId)
    const current = Date.now()
    const reminderAt = this.candidateDayBeforeReminderAt(startAt)
    if (['已取消', '已完成'].includes(text(row.fields['面试状态'])) || text(row.fields['同步状态']) !== '已同步' || !this.candidateEmailReminderEnabled(row) || text(row.fields['开始时间']) !== startAt || !Number.isFinite(reminderAt) || reminderAt > current || Date.parse(startAt) <= current) return { status: '无需发送' }
    const candidateId = text(row.fields['候选人ID'])
    const mailTable = this.table('recruitment_interview_mail_events')
    const subject = `方片新媒体｜面试前一天提醒｜${this.formatWecomMeetingTime(new Date(startAt))}`
    const [candidate, events, links] = await Promise.all([
      teable.findOneByField(this.table('recruitment_candidates'), '候选人ID', candidateId),
      teable.listByField(mailTable, '面试ID', interviewId, 1000),
      teable.listByField(this.table('recruitment_public_links'), '对象ID', interviewId, 200),
    ])
    const matching = events.filter(event => text(event.fields['邮件主题']) === subject).sort((first, second) => text(second.fields['创建时间']).localeCompare(text(first.fields['创建时间'])))
    if (matching.some(event => text(event.fields['发送状态']) === '已发送')) return { status: '已跳过' }
    const lastAttempt = matching[0]
    const lastAttemptAt = Date.parse(text(lastAttempt?.fields['发送时间']) || text(lastAttempt?.fields['创建时间'])) || 0
    if (text(lastAttempt?.fields['发送状态']) === '发送中' && current - lastAttemptAt < 5 * 60_000) return { status: '发送中' }
    if (text(lastAttempt?.fields['发送状态']) === '发送失败' && current - lastAttemptAt < 30 * 60_000) return { status: '等待重试' }
    const email = text(candidate?.fields['邮箱'])
    const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
    const link = links.filter(item => text(item.fields['链接类型']) === '面试邀请' && text(item.fields['链接状态']) === '有效' && Date.parse(text(item.fields['过期时间'])) > Date.now())
      .sort((first, second) => text(second.fields['创建时间']).localeCompare(text(first.fields['创建时间'])))[0]
    const url = text(link?.fields['访问路径'])
    const meetingUrl = this.onlineMeetingUrl(row)
    const location = text(row.fields['会议地址']) || text(row.fields['面试地点']) || '请查看邀请邮件中的面试安排'
    const content = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px 16px;background:#f3f1eb;color:#263c37;font-family:'Microsoft YaHei',sans-serif"><div style="max-width:580px;margin:auto;background:#fffef9;border:1px solid #e0e4db;border-radius:16px;overflow:hidden"><div style="padding:24px;background:#233e36;color:#fffaf0"><div>方片新媒体 · 招聘团队</div><h1 style="font-size:24px;margin:18px 0 0">面试安排提醒</h1></div><div style="padding:24px;font-size:15px;line-height:1.9;overflow-wrap:anywhere;word-break:break-word"><p>${escape(text(candidate?.fields['姓名']) || '候选人')}，你好：</p><p>提醒你即将参加面试，请提前安排好时间并按时参加。期待与你见面。</p><p><strong>面试时间</strong><br>${escape(this.formatWecomMeetingTime(new Date(startAt)))}（北京时间）</p><p><strong>面试方式</strong><br>${escape(normalizeInterviewMode(row.fields['面试方式']) || '线下面试')}</p><p><strong>地点 / 会议链接</strong><br>${escape(location)}</p>${meetingUrl ? `<p><a href="${escape(meetingUrl)}" style="display:inline-block;background:#294b3e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">进入会议 →</a></p>` : ''}${/^https?:\/\//i.test(url) ? `<p><a href="${escape(url)}" style="display:inline-block;background:#294b3e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">查看专属面试安排 →</a></p>` : ''}<p style="font-size:13px;color:#737d72">如有临时情况，请及时联系招聘负责人。此链接仅供本人使用，请勿转发。</p></div></div></body></html>`
    const fresh = await this.findInterview(interviewId)
    if (['已取消', '已完成'].includes(text(fresh.fields['面试状态'])) || text(fresh.fields['同步状态']) !== '已同步' || !this.candidateEmailReminderEnabled(fresh) || text(fresh.fields['开始时间']) !== startAt || Date.parse(startAt) <= Date.now()) return { status: '无需发送' }
    const timestamp = now()
    const event = await teable.createRecord(mailTable, { 邮件事件ID: id('mail'), 面试ID: interviewId, 候选人ID: candidateId, 收件人邮箱: email, 邮件主题: subject, 邮件正文: content, 发送状态: '发送中', 发送人: '面试前一天邮件提醒', 创建时间: timestamp })
    try {
      if (!email) throw new Error('候选人未配置邮箱，面试提醒未发送')
      const result = await tianjiWeixinMessage.sendMail({ toEmails: [email], subject, content, contentType: 'html' })
      await teable.updateRecord(mailTable, event.id, { 发送状态: '已发送', 外部邮件ID: text(result.messageId), 错误信息: '', 发送时间: now() })
      return { status: '已发送' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await teable.updateRecord(mailTable, event.id, { 发送状态: '发送失败', 错误信息: message.slice(0, 1000), 发送时间: now() })
      throw error
    }
  }

  async notifyWecomAuthorizationExpired(operator: string, operatorUserId: string) {
    if (this.authorizationNotice && this.authorizationNotice.expiresAt > Date.now()) return this.authorizationNotice.promise
    const promise = (async () => {
      const users = (await teable.listByField(this.table('recruitment_users'), '姓名', '高子云'))
        .filter(user => text(user.fields['用户状态']) === '启用')
      if (users.length !== 1) throw new BadRequestException('未找到唯一启用的高子云账号，请联系管理员核对员工资料')
      const recipientId = text(users[0].fields['用户ID']) || users[0].id
      if (!text(users[0].fields['天玑微信ID'])) throw new BadRequestException('高子云尚未配置天玑微信ID，请先在组织与权限中完善，未发送通知')
      const result = await this.messages.notifyDirectUsers({
        category: '企微认证过期提醒', objectType: '企微连接器', objectId: `wecom-auth-${Math.floor(Date.now() / 900000)}`,
        userIds: [recipientId], operator, operatorUserId,
        markdown: `## 人才管理系统 · 企微认证需要验证\n\n高子云，你好。HR查询面试会议室时，企微返回授权过期（850003 / authorization expired）。\n\n请检查应用主人在当前环境的企业微信连接器，并在「个人中心 → MCP市场」完成企微验证或重新授权。\n\n授权恢复后，HR可重新查询会议室继续约面。\n\n提醒时间：${now()}`,
      })
      if (!['已发送', '已跳过'].includes(result.status)) throw new ServiceUnavailableException(result.reason || '通知尚未确认发送成功，请稍后重试')
      return { status: result.status, message: result.status === '已跳过' ? '近期已通过天玑通知高子云，请等待她完成企微验证后重试。' : '已通过天玑通知高子云，请等待她完成企微验证后重试。' }
    })()
    this.authorizationNotice = { expiresAt: Date.now() + 900000, promise }
    try { return await promise } catch (error) { this.authorizationNotice = null; throw error }
  }

  private cache = new ReadCache()

  private cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    return this.cache.get(key, ttlMs, ['recruitment_interviews', 'recruitment_candidates', 'recruitment_applications', 'recruitment_users', 'recruitment_user_roles', 'recruitment_interviewer_pool', 'recruitment_meeting_rooms'].map(name => this.table(name)), loader)
  }

  private invalidateCache() {
    this.cache.clear()
  }

  async listInterviewers() {
    // 新预约只认“组织与权限”中的有效 interviewer 角色；旧面试官池仅补充历史配置。
    const [users, bindings, pool] = await Promise.all([
      this.cached('interviews-users', 30_000, () => teable.listAllRecords(this.table('recruitment_users'))),
      this.cached('interviews-bindings', 30_000, () => teable.listAllRecords(this.table('recruitment_user_roles'))),
      this.cached('interviews-pool', 30_000, () => teable.listAllRecords(this.table('recruitment_interviewer_pool'))),
    ])
    const current = Date.now()
    const activeIds = new Set(bindings
      .filter((row) => text(row.fields['角色编码']) === 'interviewer' && text(row.fields['绑定状态']) === '启用')
      .filter((row) => !text(row.fields['生效时间']) || Date.parse(text(row.fields['生效时间'])) <= current)
      .filter((row) => !text(row.fields['失效时间']) || Date.parse(text(row.fields['失效时间'])) > current)
      .map((row) => text(row.fields['用户ID'])).filter(Boolean))
    const interviewers = users.filter((row) => activeIds.has(text(row.fields['用户ID'])) && text(row.fields['用户状态']) === '启用').map((user) => {
      const userId = text(user.fields['用户ID']) || user.id
      const legacy = pool.find((row) => text(row.fields['用户ID']) === userId || text(row.fields['用户ID']) === text(user.fields['企业微信用户ID']))
      const setting = legacy ? this.mapInterviewer(legacy) : null
      const wecomUserId = text(user.fields['企业微信用户ID']) || text(user.fields['天玑微信ID'])
      return { id: userId, userId, wecomUserId, name: text(user.fields['姓名']) || userId, department: json<string[]>(user.fields['部门JSON'], [])[0] || text(user.fields['事业部']), roles: ['面试官'], specialties: setting?.roles || [], rounds: setting?.rounds || ['一面'], timezone: setting?.timezone || 'Asia/Shanghai', status: '启用', maxPerDay: setting?.maxPerDay || 4, source: '组织与权限' }
    }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return { total: interviewers.length, interviewers }
  }
  async searchWecomUsers(keywords: string) {
    const query = text(keywords)
    if (!query) throw new BadRequestException('请填写面试官姓名或企微成员关键词')
    const employees = await tianji.searchEmployees(query)
    const users = employees.filter((item: any) => text(item?.wechat_id) && text(item?.employee_name))
    return {
      total: users.length,
      users: users.map((user: any) => ({
        userId: text(user?.wechat_id),
        name: text(user?.employee_name),
        departments: Array.isArray(user?.departments) ? user.departments.map((department: any) => text(department?.department_name)).filter(Boolean) : [],
        position: text(user?.positions?.[0]?.position_name),
      })).filter((user: { userId: string; name: string }) => user.userId && user.name),
    }
  }
  async createInterviewer(input: InterviewerInput) {
    if (!text(input.userId) || !text(input.name)) throw new BadRequestException('面试官用户ID和姓名不能为空')
    const table = this.table('recruitment_interviewer_pool'); const rows = await teable.listAllRecords(table)
    const existing = rows.find((row) => text(row.fields['用户ID']) === input.userId); const timestamp = now()
    const fields = { 面试官ID: text(existing?.fields['面试官ID']) || id('interviewer'), 用户ID: input.userId, 姓名: input.name, 部门ID: text(input.departmentId), 部门: text(input.department), 擅长岗位JSON: JSON.stringify(input.roles || []), 可面轮次JSON: JSON.stringify(input.rounds || ['一面']), 时区: text(input.timezone) || 'Asia/Shanghai', 状态: text(input.status) || '启用', 每日最大面试数: Math.max(1, Math.min(20, Math.round(num(input.maxPerDay) || 4))), 创建时间: text(existing?.fields['创建时间']) || timestamp, 更新时间: timestamp }
    if (existing) await teable.updateRecord(table, existing.id, fields); else await teable.createRecord(table, fields)
    await this.audit(existing?'更新面试官':'新增面试官','面试官',fields.面试官ID,existing?.fields||{},fields,input.name)
    this.invalidateCache()
    return { interviewerId: fields.面试官ID, status: fields.状态 }
  }
  async addAvailability(input: AvailabilityInput) {
    const { start, end } = this.timeRange(input.startAt, input.endAt)
    const [directory, pool] = await Promise.all([this.listInterviewers(), this.cached('interviews-pool', 30_000, () => teable.listAllRecords(this.table('recruitment_interviewer_pool')))])
    const legacy = pool.find((row) => text(row.fields['面试官ID']) === input.interviewerId || row.id === input.interviewerId)
    const interviewer = directory.interviewers.find((item) => item.id === input.interviewerId || (legacy && item.userId === text(legacy.fields['用户ID'])))
    if (!interviewer) throw new NotFoundException('面试官不存在')
    const availabilityId = id('availability'); const timestamp = now()
    await teable.createRecord(this.table('recruitment_interviewer_availability'), { 可用时间ID: availabilityId, 面试官ID: legacy ? text(legacy.fields['面试官ID']) || input.interviewerId : interviewer.id, 用户ID: text(input.userId) || interviewer.userId, 开始时间: start.toISOString(), 结束时间: end.toISOString(), 可用状态: '可用', 重复规则: text(input.repeatRule), 来源类型: text(input.source) || '人工维护', 创建时间: timestamp, 更新时间: timestamp })
    this.invalidateCache()
    return { availabilityId, startAt: start.toISOString(), endAt: end.toISOString() }
  }
  async listAvailability(query: { interviewerId?: string; from?: string; to?: string }) {
    const rows = await teable.listAllRecords(this.table('recruitment_interviewer_availability'))
    return { availability: rows.filter((row) => !query.interviewerId || text(row.fields['面试官ID']) === query.interviewerId).filter((row) => !query.from || text(row.fields['结束时间']) >= query.from).filter((row) => !query.to || text(row.fields['开始时间']) <= query.to).map((row) => ({ id: text(row.fields['可用时间ID']) || row.id, interviewerId: text(row.fields['面试官ID']), userId: text(row.fields['用户ID']), startAt: text(row.fields['开始时间']), endAt: text(row.fields['结束时间']), status: text(row.fields['可用状态']), source: text(row.fields['来源类型']) })) }
  }
  async resolveSchedulingCandidate(input: { candidateId?: string; interviewId?: string; phone?: string }) {
    let candidateId = text(input.candidateId)
    const phone = text(input.phone).replace(/[\s()-]/g, '').replace(/^(?:\+86|0086)/, '')
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw new BadRequestException('请填写候选人的完整11位手机号')
    if (text(input.interviewId)) {
      const interview = await teable.findOneByField(this.table('recruitment_interviews'), '面试ID', text(input.interviewId))
      if (!interview) throw new NotFoundException('未找到对应面试记录，请使用候选人手机号重新匹配')
      const linkedId = text(interview.fields['候选人ID'])
      if (candidateId && linkedId !== candidateId) throw new ConflictException('链接中的候选人与面试记录不一致，请核实后重新打开')
      candidateId = linkedId
    }
    let candidate = candidateId ? await teable.findOneByField(this.table('recruitment_candidates'), '候选人ID', candidateId) : undefined
    if (candidate && text(candidate.fields['合并状态']) === '已合并') candidate = undefined
    if (!candidate && phone) {
      const rows = await teable.listByAnyField(this.table('recruitment_candidates'), '电话', [phone, `+86${phone}`, `0086${phone}`], 200)
      const matches = rows.filter(row => text(row.fields['电话']).replace(/[\s()-]/g, '').replace(/^(?:\+86|0086)/, '') === phone && text(row.fields['合并状态']) !== '已合并')
      if (matches.length > 1) throw new ConflictException('该手机号对应多份人才档案，请先核对或合并重复档案，系统不会自动选择')
      candidate = matches[0]
    }
    if (!candidate) throw new NotFoundException('没有匹配到候选人，请核对候选人手机号或确认简历已入库')
    if (phone && text(candidate.fields['电话']).replace(/[\s()-]/g, '').replace(/^(?:\+86|0086)/, '') !== phone) throw new ConflictException('候选人手机号与本次面试档案不一致，请核实后重试')
    return { candidate: { id: text(candidate.fields['候选人ID']) || candidate.id, name: this.candidateName(candidate), bestMatchRole: text(candidate.fields['期望职位']) || '岗位待确认' } }
  }

  async listSchedulingCandidates() {
    const [candidates, applications] = await Promise.all([
      this.cached('interviews-candidates', 15_000, () => teable.listAllRecords(this.table('recruitment_candidates'), { fields: ['候选人ID', '姓名', '期望职位', '候选人状态', '合并状态'] })),
      this.cached('interviews-applications', 15_000, () => teable.listAllRecords(this.table('recruitment_applications'))),
    ])
    return {
      candidates: candidates
        .filter((row) => text(row.fields['合并状态']) !== '已合并')
        .map((row) => {
          const candidateId = text(row.fields['候选人ID']) || row.id
          const application = applications.filter((item) => text(item.fields['候选人ID']) === candidateId && text(item.fields['当前状态']) !== '已结束').sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
          return { id: candidateId, name: text(row.fields['姓名']) || '未识别姓名', role: text(row.fields['期望职位']) || text(application?.fields['职位名称']) || '岗位待确认', status: text(row.fields['候选人状态']) || text(application?.fields['当前阶段']) || '待负责人审查' }
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    }
  }
  async listRooms() {
    const rows = await this.cached('interviews-rooms', 15_000, () => teable.listAllRecords(this.table('recruitment_meeting_rooms')))
    return { total: rows.length, rooms: rows.map(this.mapRoom) }
  }
  async roomAvailability(query: MeetingRoomAvailabilityQuery, excludeInterviewId = '') {
    const range = this.scheduledInterviewRange(query.startAt, query.endAt)
    const { start, end } = this.meetingRoomReservationRange(range.start, range.end)
    if (query.source === 'wecom') {
      const remote = await this.queryTianjiRoomAvailability(start, end, text(query.roomKeyword))
      if (remote.status !== '企微实时') throw new ServiceUnavailableException(remote.message || '企微会议室查询失败，请重试')
      for (const [key, value] of this.roomSelections) if (value.expiresAt <= Date.now()) this.roomSelections.delete(key)
      if (this.roomSelections.size >= 500) this.roomSelections.delete(this.roomSelections.keys().next().value!)
      const selectionId = id('roomquery')
      this.roomSelections.set(selectionId, { startAt: start.toISOString(), endAt: end.toISOString(), rooms: remote.rooms, expiresAt: Date.now() + 15 * 60_000 })
      return {
        startAt: start.toISOString(), endAt: end.toISOString(), source: remote.status,
        message: remote.message,
        action: '', selectionId,
        rooms: remote.rooms.map(room => ({ ...room, id: room.externalResourceId, status: room.needApproval ? '需审批' : room.available ? '空闲' : '已占用', source: '企微实时', reservable: room.available && !room.needApproval, conflictInterviewId: '', externalMessage: room.externalMessage })),
      }
    }
    const requestedIds = (Array.isArray(query.roomIds) ? query.roomIds : text(query.roomIds).split(',')).map(text).filter(Boolean)
    const [roomRows, interviewRows] = await Promise.all([teable.listAllRecords(this.table('recruitment_meeting_rooms')), this.interviewsInRange(start, end)])
    const localRooms = roomRows.map(this.mapRoom)
    const active = interviewRows.filter((row) => {
      if (text(row.fields['面试ID']) === excludeInterviewId || ['已取消', '已完成'].includes(text(row.fields['面试状态']))) return false
      const reservation = this.meetingRoomReservationRange(new Date(text(row.fields['开始时间'])), new Date(text(row.fields['结束时间'])))
      return reservation.start.getTime() < end.getTime() && reservation.end.getTime() > start.getTime()
    })
    const remote = await this.queryTianjiRoomAvailability(start, end)
    // 实时查询结果不能依赖“先同步到本地表”这个前置动作。企微返回但尚未入库的会议室
    // 直接作为可选资源返回，并保留其真实 meeting_room_id 供保存时的二次校验与预约使用。
    const remoteOnlyRooms = remote.rooms
      .filter((remoteRoom) => !localRooms.some((room) => room.externalResourceId === remoteRoom.externalResourceId))
      .map((remoteRoom) => ({
        id: remoteRoom.externalResourceId,
        name: remoteRoom.name,
        location: remoteRoom.location,
        floor: remoteRoom.floor,
        capacity: remoteRoom.capacity,
        equipment: remoteRoom.equipment,
        externalResourceId: remoteRoom.externalResourceId,
        needApproval: remoteRoom.needApproval,
        status: remoteRoom.needApproval ? '需审批' : remoteRoom.available ? '空闲' : '已占用',
        syncStatus: '企微实时（未同步）',
        syncError: '',
      }))
    const rooms = [...localRooms, ...remoteOnlyRooms].filter((room) => !requestedIds.length || requestedIds.includes(room.id))
    const availability = rooms.map((room) => {
      const localConflict = active.find((row) => text(row.fields['会议室ID']) === room.id)
      const external = room.externalResourceId ? remote.byExternalId.get(room.externalResourceId) : undefined
      const blockedByExternal = external?.available === false || external?.needApproval === true
      const localBusy = Boolean(localConflict)
      const live = Boolean(external)
      const source = localBusy ? '本系统排期' : live ? '企微实时' : room.externalResourceId ? '企微待确认' : '本系统资源'
      const status = localBusy || blockedByExternal ? '已占用' : live ? '空闲' : room.externalResourceId ? '待企微确认' : '空闲'
      return {
        ...room,
        status,
        source,
        reservable: !localBusy && (room.externalResourceId ? external?.available === true && external.needApproval !== true : true),
        conflictInterviewId: localConflict ? text(localConflict.fields['面试ID']) || localConflict.id : '',
        externalMessage: external?.message || '',
      }
    })
    return {
      startAt: start.toISOString(), endAt: end.toISOString(),
      source: remote.status,
      message: remote.message,
      action: remote.action,
      rooms: availability,
    }
  }
  private async resolveRoomSelection(selectionId: string, externalResourceId: string, start: Date, end: Date) {
    const selection = this.roomSelections.get(selectionId)
    const room = selection?.rooms.find(item => item.externalResourceId === externalResourceId)
    if (!selection || selection.expiresAt <= Date.now() || selection.startAt !== start.toISOString() || selection.endAt !== end.toISOString() || !room) {
      throw new BadRequestException('会议室查询结果已失效或面试时间已改变，请重新查询会议室')
    }
    if (room.needApproval) throw new ConflictException('所选会议室需要审批，当前接口无法代为预定，请选择无需审批的会议室')
    if (!room.available) throw new ConflictException('所选会议室当前时段已占用，请重新查询并选择空闲会议室')
    const table = this.table('recruitment_meeting_rooms')
    const rows = await teable.listByField(table, '外部资源ID', externalResourceId, 10)
    const existing = rows.find(row => text(row.fields['外部资源ID']) === externalResourceId)
    if (existing) return { roomId: text(existing.fields['会议室ID']) || existing.id, externalResourceId }
    const roomId = id('room'), timestamp = now()
    await teable.createRecord(table, {
      会议室ID: roomId, 会议室名称: room.name, 外部资源ID: externalResourceId, 办公地点: room.location,
      楼层: room.floor, 容纳人数: room.capacity, 设备JSON: JSON.stringify(room.equipment),
      资源状态: '可用', 同步状态: '已同步', 创建时间: timestamp, 更新时间: timestamp,
    })
    this.invalidateCache()
    return { roomId, externalResourceId }
  }

  async createRoom(input: MeetingRoomInput) {
    if (!text(input.name)) throw new BadRequestException('会议室名称不能为空'); const table = this.table('recruitment_meeting_rooms'); const rows = await teable.listAllRecords(table); const externalResourceId = text(input.externalResourceId); const existing = rows.find((row) => externalResourceId && text(row.fields['外部资源ID']) === externalResourceId) || rows.find((row) => text(row.fields['会议室名称']) === text(input.name)); const roomId = text(existing?.fields['会议室ID']) || id('room'); const timestamp = now()
    const fields = { 会议室ID: roomId, 会议室名称: input.name, 办公地点: text(input.location) || text(existing?.fields['办公地点']), 楼层: text(input.floor) || text(existing?.fields['楼层']), 容纳人数: Math.max(1, Math.round(num(input.capacity) || num(existing?.fields['容纳人数']) || 4)), 设备JSON: JSON.stringify(input.equipment?.length ? input.equipment : json<string[]>(existing?.fields['设备JSON'], [])), 外部资源ID: externalResourceId || text(existing?.fields['外部资源ID']), 资源状态: text(input.status) || text(existing?.fields['资源状态']) || '可用', 同步状态: externalResourceId ? '已关联' : text(existing?.fields['同步状态']) || '本地资源', 更新时间: timestamp }
    if (existing) await teable.updateRecord(table, existing.id, fields); else await teable.createRecord(table, { ...fields, 创建时间: timestamp })
    await this.audit(existing ? '更新会议室' : '新增会议室','会议室',roomId,existing?.fields || {},fields,input.name)
    this.invalidateCache()
    return { roomId, status: '可用' }
  }
  async listInviteTemplates(){await this.ensureInviteTemplates();const rows=await teable.listAllRecords(this.table('recruitment_interview_invite_templates'));return{templates:rows.filter(r=>text(r.fields['模板状态'])!=='停用').map(r=>({id:text(r.fields['邀约模板ID'])||r.id,name:text(r.fields['模板名称']),mode:text(r.fields['适用面试方式']),content:text(r.fields['模板内容']),variables:json<string[]>(r.fields['变量JSON'],[])}))}}
  async listAppointments(query: { from?: string; to?: string; candidateId?: string; status?: string }, scope?: InterviewAccessScope) {
    const [allRows, directory, rooms] = await Promise.all([
      this.cached('interviews-appointments', 10_000, () => teable.listAllRecords(this.table('recruitment_interviews'))),
      this.listInterviewers(),
      this.cached('interviews-rooms', 15_000, () => teable.listAllRecords(this.table('recruitment_meeting_rooms'))),
    ])
    const rows = allRows.filter(row => canReadInterview(row, scope))
      .filter(row => (!query.from || text(row.fields['结束时间']) >= query.from) && (!query.to || text(row.fields['开始时间']) <= query.to) && (!query.candidateId || text(row.fields['候选人ID']) === query.candidateId) && (!query.status || text(row.fields['面试状态']) === query.status))
    const candidateIds = [...new Set(rows.map(row => text(row.fields['候选人ID'])))].sort()
    const candidates = await this.cached(`calendar-candidates:${JSON.stringify(candidateIds)}`, 30_000, () => teable.listAllByAnyField(this.table('recruitment_candidates'), '候选人ID', candidateIds, ['候选人ID', '姓名', '期望职位']))
    const items = rows.filter((row) => !query.from || text(row.fields['结束时间']) >= query.from).filter((row) => !query.to || text(row.fields['开始时间']) <= query.to).filter((row) => !query.candidateId || text(row.fields['候选人ID']) === query.candidateId).filter((row) => !query.status || text(row.fields['面试状态']) === query.status).map((row) => this.mapAppointment(row, candidates, directory.interviewers, rooms)).sort((a, b) => a.startAt.localeCompare(b.startAt))
    return { total: items.length, appointments: items, visibility: scope && !scope.all ? 'mine' : 'all' }
  }
  async getAppointment(interviewId:string) {
    const [row,candidates,directory,rooms]=await Promise.all([
      this.findInterview(interviewId),
      teable.listAllRecords(this.table('recruitment_candidates')),
      this.listInterviewers(),
      teable.listAllRecords(this.table('recruitment_meeting_rooms')),
    ])
    return { appointment:this.mapAppointment(row,candidates,directory.interviewers,rooms) }
  }
  async createGroupAppointments(input: GroupInterviewInput, progress: (message: string) => void = () => {}) {
    const candidateIds = [...new Set((input.candidateIds || []).map(text).filter(Boolean))]
    if (candidateIds.length < 2) throw new BadRequestException('群面至少选择两位候选人')
    if (candidateIds.length > 30) throw new BadRequestException('一次群面最多选择 30 位候选人')
    const groupId = id('group')
    const created: Array<{ candidateId: string; interviewId: string }> = []
    let sharedBooking: { bookingId: string; scheduleId: string; snapshot: TianjiRoomBookingSnapshot } | null = null
    progress(`正在创建群面，共 ${candidateIds.length} 位候选人…`)
    for (const [index, candidateId] of candidateIds.entries()) {
      progress(`正在保存第 ${index + 1}/${candidateIds.length} 位候选人…`)
      try {
        const result = await this.createAppointment({
          ...input,
          candidateId,
          groupId,
          sharedRoom: index > 0,
          meetingRoomSelectionId: index === 0 ? input.meetingRoomSelectionId : '',
          sharedRoomBooking: sharedBooking || undefined,
        }, () => {})
        if (result.roomBooking) sharedBooking = result.roomBooking
        created.push({ candidateId, interviewId: result.interviewId })
      } catch (error) {
        for (const item of created.reverse()) {
          const row = await this.findInterview(item.interviewId).catch(() => null)
          if (row) await this.cancelAppointment(item.interviewId, { reason: '群面创建未完成，已自动取消已保存的候选人', operator: text(input.operator) || '当前用户' }).catch(() => {})
        }
        const message = error instanceof Error ? error.message : String(error)
        throw new BadRequestException(`群面在第 ${index + 1} 位候选人处失败，已取消本次已保存记录：${message}`)
      }
    }
    return { groupId, total: created.length, interviews: created }
  }

  async createAppointment(input: InterviewAppointmentInput, progress: (message: string) => void = () => {}) {
    progress('正在核对候选人与面试官信息…')
    const { start, end } = this.scheduledInterviewRange(input.startAt, input.endAt)
    const historical = start.getTime() <= Date.now()
    const reservation = historical ? { start, end } : this.meetingRoomReservationRange(start, end)
    if (historical) {
      input = { ...input, meetingRoomId: '', meetingRoomSelectionId: '', location: text(input.location) || '山东省烟台市莱山区方片新媒体' }
    }
    if (!input.interviewerIds?.length) throw new BadRequestException('请选择一位面试官')
    const directory = await this.listInterviewers()
    const legacyPool = input.interviewerIds.every(value => directory.interviewers.some(item => item.id === text(value)))
      ? [] : await teable.listAllRecords(this.table('recruitment_interviewer_pool'))
    const selected = input.interviewerIds.map(text).filter(Boolean).map((value) => { const legacy = legacyPool.find((row) => text(row.fields['面试官ID']) === value || row.id === value); return directory.interviewers.find((item) => item.id === value || (legacy && item.userId === text(legacy.fields['用户ID']))) }).filter(Boolean)
    if (selected.length !== input.interviewerIds.length) throw new BadRequestException('所选员工不是“组织与权限”中启用的面试官')
    const noWecomId = selected.find((item) => !item!.wecomUserId)
    if (noWecomId) throw new BadRequestException(`面试官“${noWecomId!.name}”尚未填写企业微信成员 ID，请先到“组织与权限”补充后再预约`)
    const attendeeIds = selected.map(item => item!.wecomUserId)
    if (input.interviewerWecomIds && (input.interviewerWecomIds.length !== attendeeIds.length || input.interviewerWecomIds.some((value, index) => text(value) !== attendeeIds[index]))) throw new BadRequestException('面试官企微 ID 与所选员工不一致，请重新打开面试安排')
    const [candidates, applications] = await Promise.all([
      input.candidateId.startsWith('rec') ? teable.getRecord(this.table('recruitment_candidates'), input.candidateId).then(row => row ? [row] : []) : teable.listByField(this.table('recruitment_candidates'), '候选人ID', input.candidateId, 2),
      teable.listByField(this.table('recruitment_applications'), '候选人ID', input.candidateId, 1000),
    ])
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === input.candidateId || row.id === input.candidateId); if (!candidate) throw new NotFoundException('候选人不存在')
    if (!historical && input.sendCandidateEmail !== false && !text(candidate.fields['邮箱'])) throw new BadRequestException('该候选人没有可用邮箱，无法发送面试邀请；请先在人才档案补充邮箱，或选择不发送邮件')
    const directRoom = !historical && input.meetingRoomSelectionId
      ? await this.resolveRoomSelection(input.meetingRoomSelectionId, text(input.meetingRoomId), reservation.start, reservation.end)
      : undefined
    if (directRoom) input = { ...input, meetingRoomId: directRoom.roomId }
    progress('正在实时校验面试官与会议室冲突…')
    const application = applications.find((row) => text(row.fields['应聘记录ID']) === input.applicationId) || applications.filter((row) => text(row.fields['候选人ID']) === input.candidateId).sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const recoverable = await this.findRecoverableAppointment(start, end, input.candidateId, input.interviewerIds)
    const timestamp = now()
    if (recoverable) {
      const interviewId = text(recoverable.fields['面试ID']) || recoverable.id
      progress('检测到同时段已保存面试，正在恢复原记录…')
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(start.getTime() + 2 * 3_600_000).toISOString()
      await teable.updateRecord(this.table('recruitment_interviews'), recoverable.id, {
        应聘记录ID: text(application?.fields['应聘记录ID']) || text(recoverable.fields['应聘记录ID']), 职位ID: text(input.positionId) || text(application?.fields['职位ID']) || text(recoverable.fields['职位ID']), 面试轮次: input.round, 面试类型: text(input.type) || text(recoverable.fields['面试类型']) || '招聘面试', 面试方式: normalizeInterviewMode(input.mode), 开始时间: start.toISOString(), 结束时间: end.toISOString(), 时区: text(input.timezone) || 'Asia/Shanghai', 面试地点: text(input.location) || '山东省烟台市莱山区方片新媒体', 会议地址: text(input.meetingUrl), 会议室ID: text(input.meetingRoomId), 面试官用户IDJSON: JSON.stringify(input.interviewerIds), 面试官姓名JSON: JSON.stringify(selected.map((item) => item!.name)), 组织者用户ID: text(input.organizerUserId) || text(recoverable.fields['组织者用户ID']), 面试状态: '已确认', 候选人确认状态: '已确认', 候选人确认时间: text(recoverable.fields['候选人确认时间']) || timestamp, 签到状态: text(recoverable.fields['签到状态']) || '未签到', 评价状态: text(recoverable.fields['评价状态']) || '未开始', 面试题状态: ['已发布','生成中'].includes(text(recoverable.fields['面试题状态'])) ? text(recoverable.fields['面试题状态']) : '待生成', 备注: text(input.note), 候选人操作Token哈希: hash(token), Token前缀: token.slice(0,8), 操作链接过期时间: expiresAt, 同步状态: historical ? '无需同步' : '待同步', 提醒状态: text(recoverable.fields['提醒状态']) || '待提醒', 更新时间: timestamp,
      })
      await teable.updateRecord(this.table('recruitment_interviews'), recoverable.id, { 候选人邮件发送选项: historical || input.sendCandidateEmail === false ? '否' : '是' })
      progress(historical ? '正在保存历史面试补录…' : '正在重试企业微信日程并发送候选人邮件…')
      const sync = historical
        ? await this.markHistoricalAppointment(interviewId, text(input.operator) || '当前用户')
        : await this.syncAppointment(interviewId, text(recoverable.fields['外部预约ID']) ? '修改预约' : '创建预约', text(input.operator) || '当前用户', { attendeeIds, roomExternalId: directRoom?.externalResourceId, sharedRoomBooking: input.sharedRoomBooking })
      if (sync.status !== '已同步' && sync.status !== '无需同步') throw new ServiceUnavailableException(sync.roomRejected ? sync.message : `企微日程创建失败：${sync.message || '未收到成功回执'}。本次操作未完成，请修正后重新提交。`)
      const questionJob = historical
        ? { status: '未生成' }
        : text(recoverable.fields['面试题状态']) === '已发布'
        ? { status: '已发布' }
        : this.evaluations.queueInterviewQuestionGeneration({ interviewId, count: structuredInterviewTargetCount, operator: '创建面试后自动生成' })
      const email = historical || input.sendCandidateEmail === false
        ? { status: '未发送', message: historical ? '历史补录不发送候选人邮件' : '已按设置跳过候选人邮件' }
        : await this.sendCandidateInterviewEmail(interviewId, token, input.publicUrl, text(input.operator) || '当前用户')
      await this.audit('恢复面试预约','面试',interviewId,recoverable.fields,input,text(input.operator)||'当前用户','检测到同候选人同时段已保存记录，复用原面试')
      this.invalidateCache()
      return { interviewId, token, path: `?interview_token=${encodeURIComponent(token)}`, expiresAt, sync, email, invitation: await this.renderInvite(interviewId, token, input.publicUrl), questionJob, reused: true, roomBooking: sync.roomBooking }
    }
    if (!historical) await this.assertNoConflict(start, end, reservation.start, reservation.end, input.interviewerIds, text(input.meetingRoomId), '', { allowSharedResources: Boolean(input.groupId), skipRoomAvailability: Boolean(input.sharedRoom) })
    const token = randomBytes(32).toString('base64url'); const interviewId = id('interview'); const expiresAt = new Date(start.getTime() + 2 * 3_600_000).toISOString()
    const location = text(input.location) || (historical ? '' : '山东省烟台市莱山区方片新媒体')
    const interviewRecord = await teable.createRecord(this.table('recruitment_interviews'), { 面试ID: interviewId, 应聘记录ID: text(application?.fields['应聘记录ID']), 候选人ID: input.candidateId, 职位ID: text(input.positionId) || text(application?.fields['职位ID']), 面试轮次: input.round, 面试类型: text(input.type) || (input.groupId ? '群面' : '招聘面试'), 面试方式: normalizeInterviewMode(input.mode), 开始时间: start.toISOString(), 结束时间: end.toISOString(), 时区: text(input.timezone) || 'Asia/Shanghai', 面试地点: location, 会议地址: text(input.meetingUrl), 会议室ID: text(input.meetingRoomId), 面试官用户IDJSON: JSON.stringify(input.interviewerIds), 面试官姓名JSON: JSON.stringify(selected.map((item) => item!.name)), 组织者用户ID: text(input.organizerUserId), 面试状态: '已确认', 候选人确认状态: '已确认', 候选人确认时间: timestamp, 签到状态: '未签到', 评价状态: '未开始', 面试题状态: historical ? '无需生成' : '待生成', 备注: [text(input.note), input.groupId ? `群面 ${input.groupId}` : ''].filter(Boolean).join('\n'), 候选人操作Token哈希: hash(token), Token前缀: token.slice(0,8), 操作链接过期时间: expiresAt, 同步状态: historical ? '无需同步' : '待同步', 提醒状态: '待提醒', 创建时间: timestamp, 更新时间: timestamp })
    await teable.updateRecord(this.table('recruitment_interviews'), interviewRecord.id, { 候选人邮件发送选项: historical || input.sendCandidateEmail === false ? '否' : '是' })
    progress(historical ? '正在保存历史面试，不创建企微日程…' : '正在创建企业微信日程，请勿重复提交…')
    const sync = historical
      ? await this.markHistoricalAppointment(interviewId, text(input.operator) || '当前用户')
      : await this.syncAppointment(interviewId, '创建预约', text(input.operator) || '当前用户', { attendeeIds, roomExternalId: directRoom?.externalResourceId, sharedRoomBooking: input.sharedRoomBooking })
    if (sync.status !== '已同步' && sync.status !== '无需同步') {
      await this.rollbackFailedAppointment(interviewRecord.id, interviewId)
      if (input.meetingRoomSelectionId && !sync.roomRejected) this.roomSelections.delete(input.meetingRoomSelectionId)
      throw new ServiceUnavailableException(sync.roomRejected ? '该会议室暂时无法预约，系统未生成面试记录，请换一间会议室后重新提交。' : `企微日程创建失败：${sync.message || '未收到成功回执'}。系统未生成面试记录，请修正后重新提交。`)
    }
    const questionJob = historical
      ? { status: '未生成' }
      : this.evaluations.queueInterviewQuestionGeneration({ interviewId, count: structuredInterviewTargetCount, operator: '创建面试后自动生成' })
    const previousStage = text(application?.fields['当前阶段']) || '意向沟通'
    if (application && ['负责人审查', '意向沟通', '待约面', '简历待补充'].includes(previousStage)) {
      await teable.updateRecord(this.table('recruitment_applications'), application.id, { 当前阶段: '约面', 当前状态: '进行中', 最近处理时间: timestamp, 更新时间: timestamp })
      await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 候选人状态: '约面', 更新时间: timestamp })
      await teable.createRecord(this.table('recruitment_stage_events'), { 事件ID: id('evt'), 应聘记录ID: text(application.fields['应聘记录ID']) || application.id, 候选人ID: input.candidateId, 职位ID: text(input.positionId) || text(application.fields['职位ID']), 原阶段: previousStage, 新阶段: '约面', 操作: '创建面试预约', 结果: '成功', 原因: text(input.note) || `${input.round}面试已排期`, 操作人: text(input.operator) || '当前用户', 发生时间: timestamp, 来源类型: '面试预约', 来源记录ID: interviewId })
    }
    progress(historical ? '历史面试已保存。' : '正在生成邀请并发送候选人邮件…')
    const invitation = historical ? null : await this.renderInvite(interviewId,token,input.publicUrl)
    const email = historical || input.sendCandidateEmail === false
      ? { status: '未发送', message: historical ? '历史补录不发送候选人邮件' : '已按设置跳过候选人邮件' }
      : await this.sendCandidateInterviewEmail(interviewId, token, input.publicUrl, text(input.operator) || '当前用户')
    if (!historical) await teable.createRecord(this.table('recruitment_tasks'), {
      待办ID: id('todo'), 待办类型: '面试题生成', 对象类型: '面试', 对象ID: interviewId,
      标题: `生成${text(input.round) || '本轮'}面试题`, 描述: '面试创建后，根据岗位、意向沟通和题库预生成面试题；开始前10分钟向面试官发送题单链接',
      处理人用户ID: text(input.organizerUserId), 处理人: '系统', 优先级: '高', 待办状态: '待处理',
      扩展信息JSON: JSON.stringify({ interviewId, candidateId: input.candidateId, operator: text(input.operator) || '流程自动化' }),
      创建时间: timestamp, 更新时间: timestamp,
    })
    await this.audit('创建面试预约','面试',interviewId,{},input,text(input.operator)||'当前用户')
    this.invalidateCache()
    return { interviewId, token, path: `?interview_token=${encodeURIComponent(token)}`, expiresAt, sync, email, invitation, questionJob, roomBooking: sync.roomBooking }
  }
  async updateAppointment(interviewId: string, input: Partial<InterviewAppointmentInput>, options: { resendInvitation?: boolean } = {}) {
    const row = await this.findInterview(interviewId); if (['已取消','已完成'].includes(text(row.fields['面试状态']))) throw new ConflictException('已取消或已完成面试不能修改')
    const previousMeetingUrl = this.onlineMeetingUrl(row)
    const startAt = text(input.startAt) || text(row.fields['开始时间']); const endAt = text(input.endAt) || text(row.fields['结束时间']); const { start, end } = this.scheduledInterviewRange(startAt, endAt)
    const reservation = this.meetingRoomReservationRange(start, end)
    const interviewerIds = input.interviewerIds || json<string[]>(row.fields['面试官用户IDJSON'], []); const roomId = input.meetingRoomId ?? text(row.fields['会议室ID'])
    await this.assertNoConflict(start, end, reservation.start, reservation.end, interviewerIds, roomId, text(row.fields['面试ID']) || interviewId)
    await teable.updateRecord(this.table('recruitment_interviews'), row.id, { 开始时间: start.toISOString(), 结束时间: end.toISOString(), 面试轮次: text(input.round) || text(row.fields['面试轮次']), 面试方式: normalizeInterviewMode(text(input.mode) || text(row.fields['面试方式'])), 面试地点: input.location ?? text(row.fields['面试地点']), 会议地址: input.meetingUrl ?? text(row.fields['会议地址']), 会议室ID: roomId, 面试官用户IDJSON: JSON.stringify(interviewerIds), 候选人确认状态: '已确认', 面试状态: '已确认', 同步状态: '待同步', 更新时间: now() })
    const sync=await this.syncAppointment(interviewId, '修改预约', text(input.operator) || '当前用户');await this.audit('修改面试预约','面试',interviewId,row.fields,input,text(input.operator)||'当前用户')
    const meetingUrl=this.onlineMeetingUrl(await this.findInterview(interviewId))
    const email=options.resendInvitation!==false&&sync.status==='已同步'&&meetingUrl&&meetingUrl!==previousMeetingUrl?await this.retryInvitation(interviewId,text(input.operator)||'当前用户'):null
    return { interviewId, sync, email }
  }

  private async rollbackFailedAppointment(recordId: string, interviewId: string) {
    const syncEvents = await teable.listByField(this.table('recruitment_interview_sync_events'), '面试ID', interviewId, 200)
    for (const event of syncEvents) await teable.deleteRecord(this.table('recruitment_interview_sync_events'), event.id)
    await teable.deleteRecord(this.table('recruitment_interviews'), recordId)
    this.invalidateCache()
  }
  async cancelAppointment(interviewId: string, body: { reason: string; operator?: string }) { if (!text(body.reason)) throw new BadRequestException('取消面试必须填写原因'); const row = await this.findInterview(interviewId); if (text(row.fields['面试状态']) === '已取消') return { interviewId, status: '已取消' }; await teable.updateRecord(this.table('recruitment_interviews'), row.id, { 面试状态: '已取消', 候选人确认状态: '已取消', 取消时间: now(), 备注: `${text(row.fields['备注'])}\n取消原因：${body.reason}`.trim(), 同步状态: '待同步', 更新时间: now() }); const sync=await this.syncAppointment(interviewId, '取消预约', text(body.operator) || '当前用户');await this.audit('取消面试预约','面试',interviewId,row.fields,{status:'已取消'},text(body.operator)||'当前用户',body.reason);return { interviewId, status: '已取消', sync } }
  async retrySync(interviewId: string, operator='当前用户') {
    const row=await this.findInterview(interviewId)
    const result=await this.syncAppointment(interviewId,text(row.fields['面试状态'])==='已取消'?'取消预约':text(row.fields['外部预约ID'])?'修改预约':'创建预约',operator)
    if(result.status==='已同步'&&text(row.fields['面试状态'])==='已取消')await this.completeDeliveryRecoveryTasks(interviewId)
    return result
  }

  private async completeDeliveryRecoveryTasks(interviewId:string){
    const tasks=await teable.listByField(this.table('recruitment_tasks'),'对象ID',interviewId,200)
    for(const task of tasks.filter(row=>text(row.fields['待办类型'])==='面试异常处理'&&text(row.fields['待办状态'])!=='已完成'))await teable.updateRecord(this.table('recruitment_tasks'),task.id,{待办状态:'已完成',完成时间:now(),更新时间:now()})
  }

  async retryInvitation(interviewId:string,operator='招聘流程自动补偿'){
    const row=await this.findInterview(interviewId)
    if(text(row.fields['面试状态'])==='已取消'||Date.parse(text(row.fields['开始时间']))<=Date.now())return{status:'无需发送'}
    if(text(row.fields['同步状态'])!=='已同步')throw new ConflictException('企微日程尚未同步，不能发送邀请')
    const links=await teable.listByField(this.table('recruitment_public_links'),'对象ID',interviewId,200)
    const active=links.find(link=>text(link.fields['链接类型'])==='面试邀请'&&text(link.fields['访问Token哈希'])===text(row.fields['候选人操作Token哈希']))
    let token=''
    try{token=new URL(text(active?.fields['访问路径'])).searchParams.get('interview_token')||''}catch{}
    if(!token||hash(token)!==text(row.fields['候选人操作Token哈希'])||Date.parse(text(row.fields['操作链接过期时间']))<=Date.now()){
      token=randomBytes(32).toString('base64url')
      await teable.updateRecord(this.table('recruitment_interviews'),row.id,{候选人操作Token哈希:hash(token),Token前缀:token.slice(0,8),操作链接过期时间:new Date(Math.max(Date.now(),Date.parse(text(row.fields['结束时间']))||0)+86400000).toISOString(),更新时间:now()})
    }
    return this.sendCandidateInterviewEmail(interviewId,token,process.env.APP_PUBLIC_URL,operator)
  }

  async checkDeliveryRecovery(){
    const [interviews,mail,candidates]=await Promise.all([teable.listAllRecords(this.table('recruitment_interviews')),teable.listAllRecords(this.table('recruitment_interview_mail_events')),teable.listAllRecords(this.table('recruitment_candidates'))])
    const candidateById=new Map(candidates.map(row=>[text(row.fields['候选人ID']),row]))
    const errors:string[]=[]
    let pending=0
    let recovered=0
    for(const row of interviews){
      const interviewId=text(row.fields['面试ID'])||row.id,cancelled=text(row.fields['面试状态'])==='已取消'
      try{
        if(cancelled){
          const stalePending=text(row.fields['同步状态'])==='待同步'&&Date.now()-(Date.parse(text(row.fields['更新时间']))||0)>10*60_000
          if(text(row.fields['同步状态'])==='同步失败'||stalePending){
            if(!text(row.fields['外部预约ID'])){
              await teable.updateRecord(this.table('recruitment_interviews'),row.id,{外部预约ID:'',外部会议室预订ID:'',外部会议室预订信息JSON:'',同步状态:'已同步',同步错误:'',最近同步时间:now(),更新时间:now()})
              await this.completeDeliveryRecoveryTasks(interviewId)
              recovered++
              continue
            }
            const sync=await this.retrySync(interviewId,'取消会议自动补偿');if(sync.status!=='已同步')throw new Error(sync.message||'取消会议失败');recovered++
          }
          continue
        }
        if(Date.parse(text(row.fields['开始时间']))<=Date.now() || text(row.fields['同步状态'])==='无需同步')continue
        const stalePending=text(row.fields['同步状态'])==='待同步'&&Date.now()-(Date.parse(text(row.fields['更新时间']))||0)>10*60_000
        if(text(row.fields['同步状态'])==='同步失败'||stalePending){
          if(!text(row.fields['外部预约ID']))throw new Error('日程创建未取得企微ID，需在排期中核实并重试，避免重复占用会议室')
          const sync=await this.retrySync(interviewId,'日程修改自动补偿')
          if(sync.status!=='已同步')throw new Error(sync.message||'日程同步失败')
        }
        const candidate=candidateById.get(text(row.fields['候选人ID']))
        if(!candidate||!text(candidate.fields['邮箱']))throw new Error('候选人邮箱不存在，请补充后再发送面试邀请')
        const refreshed=await this.findInterview(interviewId)
        if(text(refreshed.fields['同步状态'])!=='已同步')continue
        const latest=mail.filter(event=>text(event.fields['面试ID'])===interviewId&&text(event.fields['邮件主题']).includes('邀请')).sort((first,second)=>text(second.fields['创建时间']).localeCompare(text(first.fields['创建时间'])))[0]
        const invitationCurrent=!latest||Date.parse(text(latest.fields['创建时间']))>=(Date.parse(text(refreshed.fields['最近同步时间']))||0)
        if(text(latest?.fields['发送状态'])==='已发送'&&invitationCurrent){await this.completeDeliveryRecoveryTasks(interviewId);continue}
        if(latest&&Date.now()-(Date.parse(text(latest.fields['创建时间']))||0)<60_000)continue
        const sent=await this.retryInvitation(interviewId)
        if(sent.status==='发送失败')throw new Error('message' in sent?String(sent.message):'邀请邮件发送失败')
        recovered++
      }catch(error){
        const reason=error instanceof Error?error.message:String(error)
        const isPendingDataIssue=/候选人邮箱不存在|候选人档案不存在/.test(reason)
        try{
          const tasks=await teable.listByField(this.table('recruitment_tasks'),'对象ID',interviewId,200)
          const task=tasks.find(item=>text(item.fields['待办类型'])==='面试异常处理')
          const url=appFlowUrl('interview_status',{candidate_id:text(row.fields['候选人ID']),interview_id:interviewId})
          const fields={待办类型:'面试异常处理',对象类型:'面试',对象ID:interviewId,标题:'面试日程或邀请待处理',描述:reason,优先级:'高',待办状态:'待处理',扩展信息JSON:JSON.stringify({interviewId,url,error:reason}),更新时间:now()}
          const shouldNotify=!task||text(task.fields['描述'])!==reason
          if(task)await teable.updateRecord(this.table('recruitment_tasks'),task.id,fields)
          else await teable.createRecord(this.table('recruitment_tasks'),{...fields,待办ID:id('todo'),创建时间:now()})
          if(shouldNotify)await this.messages.notifyPositionHr({category:'面试异常处理',candidateId:text(row.fields['候选人ID']),positionId:text(row.fields['职位ID']),applicationId:text(row.fields['应聘记录ID']),objectId:interviewId,markdown:`## 【面试流程待处理】\n${reason}\n[打开本次面试并重试 →](${url})`,operator:'流程自动检查'})
        }catch(notificationError){errors.push(`${interviewId}: 异常待办通知失败 ${notificationError instanceof Error?notificationError.message:String(notificationError)}`)}
        if(isPendingDataIssue)pending++
        else errors.push(`${interviewId}: ${reason}`)
      }
    }
    return{recovered,pending,errors}
  }
  async sendInterviewResult(interviewId: string, body: { result: string; note?: string; operator?: string }) {
    const result = text(body.result)
    if (!result) throw new BadRequestException('面试结果不能为空')
    const row = await this.findInterview(interviewId)
    const status = text(row.fields['面试状态'])
    if (status === '已取消') throw new ConflictException('面试已取消，无法发送面试结果')
    if (status !== '已完成') throw new ConflictException('面试尚未完成，无法发送面试结果')
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    const email = text(candidate?.fields['邮箱'])
    const eventId = id('mail'), timestamp = now()
    const candidateName = text(candidate?.fields['姓名']) || '候选人'
    const round = text(row.fields['面试轮次']) || '本轮'
    const note = text(body.note) || ''
    const subject = `方片新媒体｜${round}面试结果通知｜${candidateName}`
    const content = interviewResultEmailHtml(candidateName, round, result, note)
    if (!email) {
      await teable.createRecord(this.table('recruitment_interview_mail_events'), { 邮件事件ID: eventId, 面试ID: interviewId, 候选人ID: text(row.fields['候选人ID']), 收件人邮箱: '', 邮件主题: subject, 邮件正文: content, 发送状态: '发送失败', 外部邮件ID: '', 错误信息: '候选人邮箱不存在，未发送邮件', 发送人: text(body.operator) || '当前用户', 发送时间: timestamp, 创建时间: timestamp })
      return { status: '发送失败', message: '候选人邮箱不存在，未发送邮件', interviewId }
    }
    try {
      const res = await tianjiWeixinMessage.sendMail({ toEmails: [email], subject, content, contentType: 'html' })
      const externalId = text(res.messageId)
      await teable.createRecord(this.table('recruitment_interview_mail_events'), { 邮件事件ID: eventId, 面试ID: interviewId, 候选人ID: text(row.fields['候选人ID']), 收件人邮箱: email, 邮件主题: subject, 邮件正文: content, 发送状态: '已发送', 外部邮件ID: externalId, 错误信息: '', 发送人: text(body.operator) || '当前用户', 发送时间: timestamp, 创建时间: timestamp })
      await teable.updateRecord(this.table('recruitment_interviews'), row.id, { 面试结果: result, 结果通知状态: '已发送', 结果通知时间: timestamp, 更新时间: now() })
      await this.audit('发送面试结果', '面试', interviewId, row.fields, { result, note }, text(body.operator) || '当前用户')
      return { status: '已发送', recipient: email, subject, interviewId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await teable.createRecord(this.table('recruitment_interview_mail_events'), { 邮件事件ID: eventId, 面试ID: interviewId, 候选人ID: text(row.fields['候选人ID']), 收件人邮箱: email, 邮件主题: subject, 邮件正文: content, 发送状态: '发送失败', 外部邮件ID: '', 错误信息: message.slice(0, 1000), 发送人: text(body.operator) || '当前用户', 发送时间: timestamp, 创建时间: timestamp })
      await teable.updateRecord(this.table('recruitment_interviews'), row.id, { 面试结果: result, 结果通知状态: '发送失败', 结果通知时间: timestamp, 更新时间: now() })
      await this.audit('发送面试结果', '面试', interviewId, row.fields, { result, note, error: message }, text(body.operator) || '当前用户')
      return { status: '发送失败', message, interviewId }
    }
  }
  async syncWecomResources(query: Partial<MeetingRoomAvailabilityQuery> = {}) {
    const fallbackStart = new Date(Date.now() + 30 * 60_000)
    const fallbackEnd = new Date(fallbackStart.getTime() + 60 * 60_000)
    const exactRange = query.startAt && query.endAt ? this.scheduledInterviewRange(query.startAt, query.endAt) : { start: fallbackStart, end: fallbackEnd }
    const range = this.meetingRoomReservationRange(exactRange.start, exactRange.end)
    try {
      const { start, end } = range
      const remote = await this.queryTianjiRoomAvailability(start, end)
      if (remote.status !== '企微实时') return { status: '连接失败', message: remote.message || '企业微信会议服务暂时不可用。', action: remote.action }
      const sourceRooms = remote.rooms
      const table = this.table('recruitment_meeting_rooms'); const existingRows = await teable.listAllRecords(table); const timestamp = now(); const syncedRooms:any[] = []
      for (const source of sourceRooms) {
        const externalResourceId = text(source.externalResourceId)
        const name = text(source.name)
        if (!externalResourceId || !name) continue
        const existing = existingRows.find((row) => text(row.fields['外部资源ID']) === externalResourceId) || existingRows.find((row) => text(row.fields['会议室名称']) === name)
        const roomId = text(existing?.fields['会议室ID']) || id('room')
        const fields = { 会议室ID: roomId, 会议室名称: name, 办公地点: text(source.location) || text(existing?.fields['办公地点']), 楼层: text(source.floor) || text(existing?.fields['楼层']), 容纳人数: Math.max(1, Math.round(num(source.capacity) || num(existing?.fields['容纳人数']) || 4)), 设备JSON: JSON.stringify(Array.isArray(source.equipment) ? source.equipment : json<string[]>(existing?.fields['设备JSON'], [])), 外部资源ID: externalResourceId, 资源状态: '可用', 同步状态: '已同步', 同步错误: '', 最近同步时间: timestamp, 更新时间: timestamp }
        if (existing) await teable.updateRecord(table, existing.id, fields); else await teable.createRecord(table, { ...fields, 创建时间: timestamp })
        syncedRooms.push({ id: roomId, name, externalResourceId })
      }
      await this.audit('查询并同步企微可用会议室','会议室资源','wecom',{}, { count: syncedRooms.length, startAt: start.toISOString(), endAt: end.toISOString() }, '系统')
      this.invalidateCache()
      if (!syncedRooms.length) {
        return {
          status: '资源为空', rooms: [], syncedCount: 0,
          message: '当前时间段内没有查询到可用的企业微信会议室。',
          action: '请调整面试时间后重试；如任何时间段都为空，请确认企业微信会议服务已配置会议室且应用具有访问权限。',
        }
      }
      return { status: '已连接', rooms: syncedRooms, syncedCount: syncedRooms.length, startAt: start.toISOString(), endAt: end.toISOString() }
    } catch (error) { return { status: '连接失败', message: error instanceof Error ? error.message : String(error), action: '请按错误信息检查企微命令参数或应用主人连接器授权后重试' } }
  }
  async checkReminders(operator='系统') { const rows = await teable.listAllRecords(this.table('recruitment_interviews')); const timestamp = Date.now(); let created=0; for (const row of rows.filter(r => ['已确认','待候选人确认'].includes(text(r.fields['面试状态'])) && text(r.fields['提醒状态']) !== '已提醒')) { const start=Date.parse(text(row.fields['开始时间'])); if (start >= timestamp && start-timestamp <= 24*3_600_000) { await teable.createRecord(this.table('recruitment_tasks'), { 待办ID:id('todo'), 待办类型:'面试提醒', 对象类型:'面试', 对象ID:text(row.fields['面试ID'])||row.id, 标题:'面试前确认与签到提醒', 描述:`面试时间 ${text(row.fields['开始时间'])}`, 处理人:text(row.fields['组织者用户ID'])||'招聘负责人', 优先级:start-timestamp<=2*3_600_000?'高':'中', 待办状态:'待处理', 截止时间:text(row.fields['开始时间']), 提醒时间:now(), 创建时间:now(), 更新时间:now() }); await teable.updateRecord(this.table('recruitment_interviews'), row.id, { 提醒状态:'已提醒', 提醒时间:now(), 更新时间:now() }); created++ } } return { checked: rows.length, created, operator } }
  async publicDetail(token:string) { const row=await this.resolveToken(token); return this.publicPayload(row) }
  async candidateConfirm(token:string) {
    const row = await this.resolveToken(token)
    const interviewId = text(row.fields['面试ID']) || row.id
    const confirmationStatus = text(row.fields['候选人确认状态'])
    if (confirmationStatus === '改期审批中') return { interviewId, status:'改期审批中', questionJob:{ status:text(row.fields['面试题状态']) || '待生成' } }
    if (confirmationStatus !== '已确认') {
      await teable.updateRecord(this.table('recruitment_interviews'), row.id, { 候选人确认状态:'已确认', 面试状态:'已确认', 候选人确认时间:now(), 更新时间:now() })
    }
    const questionStatus = text(row.fields['面试题状态']) || '待生成'
    const questionJob = questionStatus === '已发布'
      ? { status: '已发布' }
      : this.evaluations.queueInterviewQuestionGeneration({ interviewId, count: structuredInterviewTargetCount, operator: '兼容确认入口自动生成' })
    return { interviewId, status:'已确认', questionJob }
  }
  async candidateReschedule(token:string, body:{ reason:string; preferredTimes?:string[] }) {
    const reason=text(body.reason),preferredTimes=(body.preferredTimes||[]).map(text).filter(Boolean)
    if(!reason)throw new BadRequestException('申请改期必须填写原因')
    if(!preferredTimes.length)throw new BadRequestException('请至少填写一个期望面试时间')
    if(preferredTimes.some(value=>!Number.isFinite(Date.parse(value))))throw new BadRequestException('期望面试时间无效')
    const row=await this.resolveToken(token),confirmationStatus=text(row.fields['候选人确认状态'])
    if(confirmationStatus==='改期审批中'||text(row.fields['改期审批状态'])==='待审批')throw new ConflictException('改期申请已提交，正在等待HR确认')
    const interviewId=text(row.fields['面试ID'])||row.id,timestamp=now()
    await teable.updateRecord(this.table('recruitment_interviews'),row.id,{候选人确认状态:'改期审批中',面试状态:'已确认',候选人改期原因:reason,改期申请时间:timestamp,改期期望时间JSON:JSON.stringify(preferredTimes),改期审批状态:'待审批',改期审批人用户ID:'',改期审批人:'',改期审批时间:'',改期审批说明:'',改期通知状态:'待发送',改期通知错误:'',更新时间:timestamp})
    await teable.createRecord(this.table('recruitment_tasks'),{待办ID:id('todo'),待办类型:'面试改期',对象类型:'面试',对象ID:interviewId,标题:'候选人申请面试改期',描述:`${reason}\n期望时间：${preferredTimes.join('、')}`,处理人用户ID:text(row.fields['组织者用户ID']),处理人:'招聘负责人',优先级:'高',待办状态:'待处理',创建时间:timestamp,更新时间:timestamp})
    const candidates=await teable.listAllRecords(this.table('recruitment_candidates')),candidate=candidates.find(item=>text(item.fields['候选人ID'])===text(row.fields['候选人ID']))
    const reviewUrl=appFlowUrl('reschedule',{candidate_id:text(row.fields['候选人ID']),interview_id:interviewId})||`${text(process.env.APP_PUBLIC_URL).replace(/\/+$/,'')}/#interviews`
    const notification:any=await this.messages.notifyPositionHr({category:'候选人改期申请',candidateId:text(row.fields['候选人ID']),objectId:interviewId,positionId:text(row.fields['职位ID']),applicationId:text(row.fields['应聘记录ID']),markdown:`## 【面试改期申请】${this.candidateName(candidate)}
> 当前安排：${this.formatWecomMeetingTime(new Date(text(row.fields['开始时间'])))}
> 申请原因：${reason}
> 期望时间：${preferredTimes.map(value=>this.formatWecomMeetingTime(new Date(value))).join('、')}

[打开HR改期确认→](${reviewUrl})
<font color="comment">当前面试安排仍然有效，HR确认并重新排期后才会变更。</font>`,operator:'候选人提交'}).catch((error)=>({status:'发送失败',error:error instanceof Error?error.message:String(error)}))
    await teable.updateRecord(this.table('recruitment_interviews'),row.id,{改期通知状态:text(notification?.status),改期通知错误:text(notification?.error||notification?.reason),更新时间:now()})
    await this.audit('候选人申请面试改期','面试',interviewId,row.fields,{reason,preferredTimes,notification},'候选人',reason)
    return {interviewId,status:'改期审批中',notification}
  }
  async decideReschedule(interviewId:string,body:{decision:'批准'|'拒绝';startAt?:string;endAt?:string;meetingRoomId?:string;location?:string;note?:string;operator?:string;operatorUserId?:string},progress:(message:string)=>void=()=>{}){
    progress('正在校验改期申请')
    const row=await this.findInterview(interviewId),decision=text(body.decision),operator=text(body.operator)||'当前用户',timestamp=now()
    if(text(row.fields['改期审批状态'])!=='待审批'||text(row.fields['候选人确认状态'])!=='改期审批中')throw new ConflictException('当前没有待审批的改期申请')
    if(!['批准','拒绝'].includes(decision))throw new BadRequestException('请选择批准或拒绝改期')
    if(decision==='拒绝'){
      progress('正在保留原面试安排')
      await teable.updateRecord(this.table('recruitment_interviews'),row.id,{候选人确认状态:'已确认',面试状态:'已确认',改期审批状态:'已拒绝',改期审批人用户ID:text(body.operatorUserId),改期审批人:operator,改期审批时间:timestamp,改期审批说明:text(body.note),更新时间:timestamp})
      await this.completeRescheduleTasks(interviewId,operator,text(body.note)||'原面试安排保持不变')
      await this.audit('HR拒绝面试改期','面试',interviewId,row.fields,{decision,note:text(body.note)},operator,text(body.note))
      return {interviewId,status:'已拒绝',confirmationStatus:'已确认'}
    }
    if(!text(body.startAt)||!text(body.endAt))throw new BadRequestException('批准改期时必须确认新的开始和结束时间')
    progress('正在更新面试时间并同步企微日程')
    const updated=await this.updateAppointment(interviewId,{startAt:body.startAt,endAt:body.endAt,meetingRoomId:body.meetingRoomId,location:body.location,operator},{resendInvitation:false})
    const refreshed=await this.findInterview(interviewId),expiresAt=new Date(Date.parse(text(refreshed.fields['开始时间']))+2*3_600_000).toISOString()
    await teable.updateRecord(this.table('recruitment_interviews'),refreshed.id,{操作链接过期时间:expiresAt,改期审批状态:'已批准',改期审批人用户ID:text(body.operatorUserId),改期审批人:operator,改期审批时间:timestamp,改期审批说明:text(body.note),更新时间:now()})
    let email:any={status:'未发送',message:'企微日程改期同步失败，暂未向候选人发送新链接'},path=''
    if(updated.sync?.status==='已同步'){
      progress('企微日程已更新，正在发送候选人邮件')
      const token=randomBytes(32).toString('base64url')
      await teable.updateRecord(this.table('recruitment_interviews'),refreshed.id,{候选人操作Token哈希:hash(token),Token前缀:token.slice(0,8),操作链接过期时间:expiresAt,更新时间:now()})
      email=await this.sendCandidateInterviewEmail(interviewId,token,process.env.APP_PUBLIC_URL,operator)
      if(email.status==='已发送')path=`?interview_token=${encodeURIComponent(token)}`
      else await teable.updateRecord(this.table('recruitment_interviews'),refreshed.id,{候选人操作Token哈希:text(row.fields['候选人操作Token哈希']),Token前缀:text(row.fields['Token前缀']),操作链接过期时间:expiresAt,更新时间:now()})
    }
    progress(email.status==='已发送'?'新日程和候选人邮件已完成':'改期已保存，候选人邮件未发送')
    await this.completeRescheduleTasks(interviewId,operator,text(body.note)||'已批准并重新排期')
    await this.audit('HR批准面试改期','面试',interviewId,row.fields,{decision,startAt:body.startAt,endAt:body.endAt,meetingRoomId:body.meetingRoomId,sync:updated.sync,email},operator,text(body.note))
    return {interviewId,status:'已批准',confirmationStatus:'已确认',sync:updated.sync,email,path,expiresAt}
  }
  async checkIn(token:string) { const row=await this.resolveToken(token); const start=Date.parse(text(row.fields['开始时间'])); if(Math.abs(Date.now()-start)>2*3_600_000) throw new ConflictException('当前不在允许签到时间范围内'); await teable.updateRecord(this.table('recruitment_interviews'), row.id, { 签到状态:'已签到',签到时间:now(),面试状态:'进行中',更新时间:now() }); return { status:'已签到',checkedInAt:now() } }
  async submitCandidatePreparation(token:string, body:{ profile?:Record<string,unknown>; confirm?:boolean }) {
    const row = await this.resolveToken(token)
    const profile = body?.profile || {}
    const phone = text(profile.phone), years = text(profile.yearsOfExperience), highestEducation = text(profile.highestEducation), gender = text(profile.gender)
    const age = Number(profile.age)
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new BadRequestException('请填写正确的11位手机号码')
    if (!years || !highestEducation || !['男', '女'].includes(gender) || !Number.isInteger(age) || age < 16 || age > 80) throw new BadRequestException('请完整填写年龄、工作年限、最高学历和性别')
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    if (!candidate) throw new NotFoundException('候选人档案不存在')
    const timestamp = now(), interviewId = text(row.fields['面试ID']) || row.id, candidateId = text(row.fields['候选人ID'])
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 电话: phone, 性别: gender, 工作年限: years, 最高学历: highestEducation, 年龄: age, 更新时间: timestamp })
    await teable.createRecord(this.table('recruitment_interview_candidate_forms'), { 填写记录ID: id('candidateform'), 面试ID: interviewId, 候选人ID: candidateId, 个人信息JSON: JSON.stringify({ phone, gender, yearsOfExperience: years, highestEducation, age }), 预面试问卷JSON: '', 填写状态: '已提交', 提交时间: timestamp, 创建时间: timestamp, 更新时间: timestamp })
    return { status: '已提交', submittedAt: timestamp }
  }


  async publicCommunicationLink(candidateId: string, protocol = 'https', host = '') {
    if (!text(candidateId)) throw new BadRequestException('请选择候选人')
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
    if (!candidate) throw new NotFoundException('候选人不存在')
    const token = randomBytes(32).toString('base64url'), timestamp = now()
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
    await teable.createRecord(this.table('recruitment_public_links'), {
      链接ID: id('link'), 候选人ID: text(candidate.fields['候选人ID']) || candidateId, 链接类型: '意向沟通',
      访问Token哈希: hash(token), Token前缀: token.slice(0, 8), 访问路径: `/communication?token=${encodeURIComponent(token)}`,
      链接状态: '有效', 过期时间: expiresAt, 创建人: '招聘流程自动通知', 创建时间: timestamp, 更新时间: timestamp,
    })
    const publicBase = text(process.env.APP_PUBLIC_URL) || (host ? `${protocol}://${host}` : '')
    if (!publicBase) throw new ServiceUnavailableException('未配置应用公开地址，无法生成意向沟通链接')
    return { candidateId, path: `/communication?token=${encodeURIComponent(token)}`, url: `${publicBase.replace(/\/+$/, '')}/communication?token=${encodeURIComponent(token)}`, expiresAt }
  }

  async publicCommunicationDetail(token: string) {
    const link = await this.resolvePublicLink(token, '意向沟通')
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === text(link.fields['候选人ID']))
    if (!candidate) throw new NotFoundException('候选人不存在')
    return { candidateId: text(candidate.fields['候选人ID']), candidateName: text(candidate.fields['姓名']) || '候选人', role: text(candidate.fields['期望职位']) || '招聘岗位', expiresAt: text(link.fields['过期时间']) }
  }

  async submitPublicCommunicationByToken(token: string, body: Record<string, unknown>) {
    const link = await this.resolvePublicLink(token, '意向沟通')
    const candidateId = text(link.fields['候选人ID'])
    if (text(body.candidateId) && text(body.candidateId) !== candidateId) throw new BadRequestException('提交的候选人与沟通链接不一致，请重新打开原链接')
    const channel = text(body.channel)
    const answerStatus = text(body.answerStatus)
    const interestLevel = text(body.interestLevel)
    const jobStatus = text(body.jobStatus)
    const result = text(body.result)
    if (!['电话', '微信', '邮件', '短信', '当面', '其他'].includes(channel)) throw new BadRequestException('请选择有效的沟通渠道')
    if (!['已接通', '未接听', '拒接', '关机', '空号', '微信回复'].includes(answerStatus)) throw new BadRequestException('请选择有效的接通状态')
    if (!['高', '中', '低', '拒绝'].includes(interestLevel)) throw new BadRequestException('请选择有效的兴趣度')
    if (!['已离职', '在职已提离职', '在职未提离职', '应届生'].includes(jobStatus)) throw new BadRequestException('请选择有效的在职状态')
    if (!['推进面试', '放入人才库', '淘汰', '二次沟通'].includes(result)) throw new BadRequestException('请选择有效的沟通结果')
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === candidateId)
    if (!candidate) throw new NotFoundException('候选人不存在')
    const applications = await teable.listByField(this.table('recruitment_applications'), '候选人ID', candidateId)
    const application = applications.sort((first, second) => (text(second.fields['更新时间']) || text(second.fields['创建时间'])).localeCompare(text(first.fields['更新时间']) || text(first.fields['创建时间'])))[0]
    const applicationId = text(application?.fields['应聘记录ID']) || application?.id || ''
    await teable.createRecord(this.table('recruitment_communications'), {
      沟通记录ID: id('comm'), 候选人ID: candidateId, 应聘记录ID: applicationId, 沟通类型: '意向沟通',
      沟通渠道: channel, 沟通方向: text(body.direction) || '呼出', 沟通摘要: text(body.summary) || '群链接填写',
      沟通结果: result, 接通状态: answerStatus, 兴趣度: interestLevel,
      在职状态: jobStatus, 到岗时间: text(body.entryTime), 离职原因: text(body.leaveReason), 离职原因详情: text(body.leaveReasonDetail),
      婚姻状况: text(body.maritalStatus), 居住区域: text(body.homeAddress), 主要职责: text(body.workContent),
      当前薪酬整体情况: text(body.currentSalaryInfo), 候选人关注点: text(body.candidateConcerns), 当前加班强度: text(body.overtimeIntensity),
      加班接受度: text(body.overtimeAttitude), 约面形式: text(body.interviewType), 约面时间: text(body.interviewTime), 沟通备注: text(body.notes),
      操作人: text(body.operator) || '意向沟通填写', 发生时间: now(), 创建时间: now(),
    })
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 最近联系时间: now(), 更新时间: now() })
    await this.notifyPositionHr('意向沟通完成', text(candidate.fields['候选人ID']), `## 【待约面】${text(candidate.fields['姓名']) || '候选人'}\n> 意向沟通已提交\n[打开约面工作台 →](${interviewScheduleUrl(candidateId)})\n<font color=\"comment\">请确认面试时间、面试官和会议室。</font>`, '', '', '', text(body.operator) || '意向沟通填写')
    return { status: '已提交', candidateId, scheduleUrl: interviewScheduleUrl(candidateId) }
  }

  private async resolvePublicLink(token: string, type: string) {
    if (!text(token)) throw new UnauthorizedException('链接无效')
    const table = this.table('recruitment_public_links')
    const rows = await teable.listAllRecords(table)
    const link = rows.find((row) => text(row.fields['链接类型']) === type && text(row.fields['访问Token哈希']) === hash(token))
    if (!link) throw new UnauthorizedException('链接无效')
    if (text(link.fields['链接状态']) === '已撤销') throw new ConflictException('链接已撤销')
    if (Date.parse(text(link.fields['过期时间'])) <= Date.now()) throw new UnauthorizedException('链接已过期')
    return link
  }

  async submitCandidateCommunication(token: string, body: Record<string, unknown>) {
    const row = await this.resolveToken(token)
    const candidateId = text(row.fields['候选人ID'])
    const interviewId = text(row.fields['面试ID']) || row.id
    const timestamp = now()
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === candidateId)
    if (!candidate) throw new NotFoundException('候选人档案不存在')
    const applications = await teable.listAllRecords(this.table('recruitment_applications'))
    const application = applications.filter((r) => text(r.fields['候选人ID']) === candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const communicationId = id('comm')
    const fields: Record<string, unknown> = {
      沟通记录ID: communicationId, 候选人ID: candidateId, 应聘记录ID: text(application?.fields['应聘记录ID']) || '',
      沟通类型: '候选人自填', 沟通渠道: '邮件', 沟通方向: '呼入',
      沟通摘要: text(body.comm_result) || '候选人通过面试邀请链接自行填写',
      沟通结果: text(body.comm_result) || '',
      接通状态: text(body.answer_status) || '已接通',
      兴趣度: text(body.interest_level), 在职状态: text(body.job_status), 到岗时间: text(body.entry_time),
      离职原因: text(body.leave_reason), 离职原因详情: text(body.leave_reason_detail),
      婚姻状况: text(body.marital_status), 居住区域: text(body.home_address),
      主要职责: text(body.work_content), 当前薪酬整体情况: text(body.current_salary_info),
      候选人关注点: text(body.candidate_concerns),
      当前加班强度: text(body.overtime_intensity), 加班接受度: text(body.overtime_attitude),
      约面形式: text(body.interview_type), 约面时间: text(body.interview_time),
      淘汰原因: text(body.reject_reason),
      沟通备注: text(body.notes),
      操作人: '候选人自填', 发生时间: timestamp, 创建时间: timestamp,
    }
    await teable.createRecord(this.table('recruitment_communications'), fields)
    // Update candidate info from the form
    const candidateFields: Record<string, unknown> = { 最近联系时间: timestamp, 更新时间: timestamp }
    const phone = text(body.phone), wechat = text(body.wechat)
    if (phone && /^1[3-9]\d{9}$/.test(phone)) candidateFields['电话'] = phone
    if (wechat) candidateFields['微信'] = wechat
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, candidateFields)
    await this.notifyPositionHr('意向沟通完成', text(row.fields['候选人ID']), `## 【待约面】${this.candidateName(candidate)}\n> 意向沟通已提交\n[打开约面工作台 →](${interviewScheduleUrl(candidateId)})\n<font color=\"comment\">请确认面试时间、面试官和会议室。</font>`, communicationId, '', '', '候选人自填')
    return { status: '已提交', communicationId, submittedAt: timestamp }
  }


 private async findRecoverableAppointment(start: Date, end: Date, candidateId: string, interviewerIds: string[]) {
  const rows = await this.interviewsInRange(start, end)
  return rows.find(row => text(row.fields['候选人ID']) === candidateId
    && !['已取消', '已完成'].includes(text(row.fields['面试状态']))
    && Date.parse(text(row.fields['开始时间'])) === start.getTime()
    && Date.parse(text(row.fields['结束时间'])) === end.getTime()
    && json<string[]>(row.fields['面试官用户IDJSON'], []).some(id => interviewerIds.includes(id)))
 }
 private async assertNoConflict(start:Date,end:Date,reservationStart:Date,reservationEnd:Date,interviewerIds:string[],roomId:string,excludeId='', options: { allowSharedResources?: boolean; skipRoomAvailability?: boolean } = {}) {
  const [rows,roomRows]=await Promise.all([this.interviewsInRange(start,end),this.interviewsInRange(reservationStart,reservationEnd)])
  const active=rows.filter(r=>text(r.fields['面试ID'])!==excludeId&&!['已取消','已完成'].includes(text(r.fields['面试状态'])))
  const interviewerConflict=!options.allowSharedResources && active.find(r=>json<string[]>(r.fields['面试官用户IDJSON'],[]).some(x=>interviewerIds.includes(x)))
  if(interviewerConflict) throw new ConflictException({message:'所选面试官在该时间段已有面试',code:'INTERVIEWER_CONFLICT',interviewId:text(interviewerConflict.fields['面试ID'])})
  if(roomId){
    const roomConflict=roomRows.find(r=>{
      if(text(r.fields['面试ID'])===excludeId||['已取消','已完成'].includes(text(r.fields['面试状态']))||text(r.fields['会议室ID'])!==roomId)return false
      const reservation=this.meetingRoomReservationRange(new Date(text(r.fields['开始时间'])),new Date(text(r.fields['结束时间'])))
      return reservation.start.getTime()<reservationEnd.getTime()&&reservation.end.getTime()>reservationStart.getTime()
    })
    if(roomConflict && !options.allowSharedResources) throw new ConflictException({message:'所选会议室在该时间段已被占用',code:'MEETING_ROOM_CONFLICT',interviewId:text(roomConflict.fields['面试ID'])})
    if (options.allowSharedResources) return
    const roomAvailability=await this.roomAvailability({startAt:start.toISOString(),endAt:end.toISOString(),roomIds:[roomId]},excludeId)
    const room=roomAvailability.rooms[0]
    if(!room||!room.reservable) throw new ConflictException({message:'企微会议室当前不可确认空闲，请重新查询并选择空闲会议室',code:'WECOM_MEETING_ROOM_CONFLICT',interviewId:room?.conflictInterviewId})
  }
  const availability=await teable.listAllRecords(this.table('recruitment_interviewer_availability'))
  for(const interviewerId of interviewerIds){
    const slots=availability.filter(r=>text(r.fields['面试官ID'])===interviewerId&&text(r.fields['可用状态'])==='可用')
    if(slots.length&&!slots.some(r=>Date.parse(text(r.fields['开始时间']))<=start.getTime()&&Date.parse(text(r.fields['结束时间']))>=end.getTime())) throw new ConflictException({message:'所选时间不在面试官维护的可用时间内',code:'OUTSIDE_AVAILABILITY',interviewerId})
  }
 }
  private async interviewsInRange(start: Date, end: Date) {
    const rows = await teable.listAllRecords(this.table('recruitment_interviews'))
    return rows.filter(row =>
      Date.parse(text(row.fields['开始时间'])) < end.getTime()
      && Date.parse(text(row.fields['结束时间'])) > start.getTime(),
    )
  }

  private async queryTianjiRoomAvailability(start:Date,end:Date,roomKeyword='') {
    try {
      const padding = 24 * 60 * 60
      const requestedStart = Math.floor(start.getTime() / 1000)
      const requestedEnd = Math.floor(end.getTime() / 1000)
      const response = await tianjiWeixinMessage.freeMeetingRooms(requestedStart - padding, requestedEnd + padding)
      const records = new Map<string, { item: any; reportedBusy: boolean; conflicts: any[] }>()
      for (const [items, reportedBusy] of [[response.free, false], [response.busy, true]] as const) {
        for (const item of items) {
          const externalResourceId = text(item.meetingroom_id)
          if (!externalResourceId || !text(item.name)) throw new Error('企微会议室查询返回了缺少 ID 或名称的资源，无法安全展示')
          const existing = records.get(externalResourceId)
          const conflicts = Array.isArray(item.conflicts) ? item.conflicts : []
          if (existing) {
            existing.reportedBusy ||= reportedBusy
            existing.conflicts.push(...conflicts)
          } else records.set(externalResourceId, { item, reportedBusy, conflicts: [...conflicts] })
        }
      }
      const rooms = [...records.entries()].map(([externalResourceId, record]) => {
        const conflicts = record.conflicts.filter((item) => {
          const conflictStart = Number(item.start_time), conflictEnd = Number(item.end_time)
          return Number.isFinite(conflictStart) && Number.isFinite(conflictEnd) && conflictStart < requestedEnd && conflictEnd > requestedStart
        })
        const available = conflicts.length === 0 && !(record.reportedBusy && record.conflicts.length === 0)
        const item = record.item
        const needApproval = Number(item.need_approval) !== 0
        return {
          externalResourceId,
          name: text(item.name),
          location: [text(item.city), text(item.building)].filter(Boolean).join(' · '),
          floor: text(item.floor),
          capacity: num(item.capacity),
          equipment: Array.isArray(item.equipment) ? item.equipment.map(text) : [],
          needApproval,
          available,
          externalMessage: needApproval ? '该会议室需要审批，当前接口无法代为预定' : conflicts.length ? `预约冲突：${conflicts.map(conflict => `${this.formatWecomMeetingTime(new Date(Number(conflict.start_time) * 1000))}–${this.formatWecomMeetingTime(new Date(Number(conflict.end_time) * 1000))}`).join('、')}` : '',
        }
      }).filter((room) => !roomKeyword || room.name.toLowerCase().includes(roomKeyword.toLowerCase()))
      const byExternalId = new Map<string,{available:boolean;message:string;needApproval:boolean}>()
      rooms.forEach((room) => byExternalId.set(room.externalResourceId, { available: room.available, message: room.externalMessage, needApproval: room.needApproval }))
      const freeCount = rooms.filter((room) => room.available && !room.needApproval).length
      const busyCount = rooms.length - freeCount
      const message = `${roomKeyword ? `名称匹配“${roomKeyword}”` : '所选时段'}：${freeCount} 间空闲，${busyCount} 间占用。占用状态按实际面试区间复核。`
      return { status:'企微实时', message, action:'', byExternalId, rooms }
    } catch(primaryError) {
      const message = primaryError instanceof Error ? primaryError.message : String(primaryError)
      if (isWecomAuthorizationExpired(message)) throw new ServiceUnavailableException('企微认证已过期（850003），暂时无法查询会议室。请联系高子云完成企微验证后重试。')
      return { status:'企微查询失败', message, action:'企微会议室实时查询失败，请稍后重试；当前不是已确认的空闲状态。', byExternalId:new Map<string,{available:boolean;message:string;needApproval:boolean}>(), rooms:[] }
    }
  }
  private wecomInterviewSummary(positionName: string, candidateName: string, round: string) {
    const limit = 20
    const prefix = '面试｜'
    const suffix = `｜${candidateName}｜${round}`
    const minimum = `${prefix}岗位${suffix}`
    if (Array.from(minimum).length > limit) return Array.from(`面试｜${candidateName}｜${round}`).slice(0, limit).join('')
    const available = limit - Array.from(minimum).length + Array.from('岗位').length
    const position = Array.from(positionName).slice(0, Math.max(2, available)).join('')
    return `${prefix}${position}${suffix}`
  }
  private formatWecomMeetingTime(value: Date) {
    const values = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value).reduce<Record<string,string>>((result, part) => { result[part.type] = part.value; return result }, {})
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`
  }
  private parseWecomPayload(response: any): any {
    if (typeof response?.text === 'string') { try { return JSON.parse(response.text) } catch { return {} } }
    return response?.data || response?.result || response || {}
  }
  private async syncAppointment(interviewId:string,type:string,operator:string, context?: { attendeeIds?: string[]; roomExternalId?: string; sharedRoomBooking?: { bookingId: string; scheduleId: string; snapshot: TianjiRoomBookingSnapshot } }) {
    const row=await this.findInterview(interviewId)
    const old=text(row.fields['同步状态'])
    const eventId=id('sync')
    let externalId=text(row.fields['外部预约ID'])
    let bookingId=text(row.fields['外部会议室预订ID'])
    let bookingSnapshot=json<TianjiRoomBookingSnapshot|null>(row.fields['外部会议室预订信息JSON'],null)
    const previousExternalId=externalId
    const meetingSnapshot=json<TianjiMeetingSnapshot|null>(row.fields['外部会议信息JSON'],null)
    let createdMeeting:TianjiMeetingSnapshot|null=null
    let meetingCommitted=false
    try {
      const roomId=text(row.fields['会议室ID'])
      const rooms=roomId&&!context?.roomExternalId?await teable.listAllRecords(this.table('recruitment_meeting_rooms')):[]
      const room=rooms.find((item)=>text(item.fields['会议室ID'])===roomId||item.id===roomId)
      const candidateId=text(row.fields['候选人ID'])
      const candidates=await teable.listByField(this.table('recruitment_candidates'),'候选人ID',candidateId,2)
      const candidate=candidates.find((item)=>text(item.fields['候选人ID'])===candidateId||item.id===candidateId)
      const attendeeIds=context?.attendeeIds || await this.resolveWecomAttendees(json<string[]>(row.fields['面试官用户IDJSON'],[]))
      const organizerWecomUserId=await this.resolveWecomUserId(text(row.fields['组织者用户ID']))
      if (organizerWecomUserId && !attendeeIds.includes(organizerWecomUserId)) attendeeIds.push(organizerWecomUserId)
      const roomExternalId=context?.roomExternalId||text(room?.fields['外部资源ID'])
      if(roomId&&!roomExternalId) throw new Error('所选会议室未关联企微 meetingroom_id，无法确认实际预定；请选择企微实时会议室或先同步会议室')
      const exactStart=new Date(text(row.fields['开始时间'])), exactEnd=new Date(text(row.fields['结束时间']))
      const reservation=this.meetingRoomReservationRange(exactStart,exactEnd)
      const startTime=Math.floor(exactStart.getTime()/1000)
      const endTime=Math.floor(exactEnd.getTime()/1000)
      const bookingStartTime=Math.floor(reservation.start.getTime()/1000)
      const bookingEndTime=Math.floor(reservation.end.getTime()/1000)
      const candidateName=text(candidate?.fields['姓名'])||candidateId||'候选人'
      const round=text(row.fields['面试轮次'])||'面试'
      const positionId=text(row.fields['职位ID'])
      const positions=positionId?await teable.listByField(this.table('recruitment_positions'),'职位ID',positionId,2):[]
      const position=positions.find((item)=>text(item.fields['职位ID'])===positionId)
      const positionName=text(position?.fields['职位名称'])||text(candidate?.fields['期望职位'])||'岗位待确认'
      const summary=this.wecomInterviewSummary(positionName,candidateName,round)
      const payload={summary,start_time:startTime,end_time:endTime,location:text(row.fields['面试地点']),description:text(row.fields['备注']),attendees:attendeeIds,meetingroom_id:roomExternalId||undefined}
      const scheduleInput={summary,startTime,endTime,location:payload.location,description:payload.description,attendees:attendeeIds,meetingRoomId:roomExternalId||undefined}
      const booker=organizerWecomUserId||attendeeIds[0]
      const meetingRequired=type!=='取消预约'&&isOnlineInterviewMode(row.fields['面试方式'])
      const requestedMeeting={startTime,endTime,adminUserId:booker,attendees:[...attendeeIds]}
      let nextMeetingSnapshot:TianjiMeetingSnapshot|null=meetingRequired&&meetingSnapshot&&sameMeetingSchedule(meetingSnapshot,requestedMeeting)?meetingSnapshot:null
      if(meetingRequired&&!nextMeetingSnapshot) {
        const meeting=await tianjiWeixinMessage.createMeeting({adminUserId:booker,title:summary,startTime,endTime,invitees:attendeeIds})
        createdMeeting={...requestedMeeting,meetingId:meeting.meetingId,meetingLink:meeting.meetingLink}
        nextMeetingSnapshot=createdMeeting
      }
      const bookingInput=roomExternalId?{meetingRoomId:roomExternalId,booker,startTime:bookingStartTime,endTime:bookingEndTime,subject:summary,attendees:attendeeIds}:undefined
      const requestedBookingSnapshot: TianjiRoomBookingSnapshot|null=bookingInput?{meetingRoomId:bookingInput.meetingRoomId,booker:bookingInput.booker,startTime:bookingStartTime,endTime:bookingEndTime,subject:bookingInput.subject,attendees:[...bookingInput.attendees]}:null
      const sharedRoomBooking=context?.sharedRoomBooking
      const reuseSharedRoom=Boolean(sharedRoomBooking&&requestedBookingSnapshot&&sharedRoomBooking.snapshot.meetingRoomId===requestedBookingSnapshot.meetingRoomId&&sharedRoomBooking.snapshot.startTime===requestedBookingSnapshot.startTime&&sharedRoomBooking.snapshot.endTime===requestedBookingSnapshot.endTime)
      let result:any
      let nextBookingId=''
      let nextBookingSnapshot:TianjiRoomBookingSnapshot|null=null
      if(type==='取消预约') {
        if(!externalId) throw new Error('缺少企微日程ID，无法取消企微日程')
        const sharedWithActivePeer=bookingId ? (await teable.listAllRecords(this.table('recruitment_interviews'))).some((item) => item.id !== row.id && text(item.fields['面试状态']) !== '已取消' && text(item.fields['外部会议室预订ID']) === bookingId) : false
        const sharedRoomScheduleId=bookingSnapshot?.scheduleId || ''
        const releasesSharedRoom=Boolean(bookingId && !sharedWithActivePeer && sharedRoomScheduleId && sharedRoomScheduleId !== externalId)
        if(releasesSharedRoom) await tianjiWeixinMessage.cancelSchedule(sharedRoomScheduleId)
        result=await tianjiWeixinMessage.cancelSchedule(externalId)
        externalId=''
      } else if(reuseSharedRoom) {
        result=await tianjiWeixinMessage.createSchedule(scheduleInput)
        externalId=result.scheduleId
        nextBookingId=sharedRoomBooking!.bookingId
        nextBookingSnapshot=sharedRoomBooking!.snapshot
      } else if(requestedBookingSnapshot) {
        if(bookingId&&externalId&&bookingSnapshot&&JSON.stringify({...bookingSnapshot,scheduleId:undefined})===JSON.stringify(requestedBookingSnapshot)) {
          result={scheduleId:externalId,bookingId,response:{reused:true},reused:true}
          nextBookingId=bookingId
          nextBookingSnapshot=requestedBookingSnapshot
        } else {
          const overlapsExistingReservation=Boolean(bookingId&&externalId&&bookingSnapshot&&bookingSnapshot.meetingRoomId===requestedBookingSnapshot.meetingRoomId&&bookingSnapshot.startTime<requestedBookingSnapshot.endTime&&bookingSnapshot.endTime>requestedBookingSnapshot.startTime)
          if(overlapsExistingReservation) {
            await tianjiWeixinMessage.cancelSchedule(externalId)
            try {
              result=await tianjiWeixinMessage.bookMeetingRoom(bookingInput!)
            } catch(bookingError) {
              try {
                const restored=await tianjiWeixinMessage.bookMeetingRoom(bookingSnapshot!)
                externalId=restored.scheduleId
                bookingId=restored.bookingId
                await teable.updateRecord(this.table('recruitment_interviews'),row.id,{外部预约ID:externalId,外部会议室预订ID:bookingId,外部会议室预订信息JSON:JSON.stringify(bookingSnapshot)})
              } catch(restoreError) {
                externalId=''
                bookingId=''
                bookingSnapshot=null
                await teable.updateRecord(this.table('recruitment_interviews'),row.id,{外部预约ID:'',外部会议室预订ID:'',外部会议室预订信息JSON:''})
                throw new Error(`新会议室预定失败，旧预定也未能恢复：${restoreError instanceof Error?restoreError.message:String(restoreError)}`)
              }
              throw bookingError
            }
          } else {
            result=await tianjiWeixinMessage.bookMeetingRoom(bookingInput!)
            if(externalId) {
              try { await tianjiWeixinMessage.cancelSchedule(externalId) }
              catch(cancelError) {
                await tianjiWeixinMessage.cancelSchedule(result.scheduleId).catch(()=>undefined)
                throw cancelError
              }
            }
          }
          externalId=result.scheduleId
          nextBookingId=result.bookingId
          nextBookingSnapshot={...requestedBookingSnapshot,scheduleId:result.scheduleId}
        }
      } else if((type==='修改预约'||type==='确认预约')&&externalId) {
        result=await tianjiWeixinMessage.createSchedule(scheduleInput)
        try { await tianjiWeixinMessage.cancelSchedule(externalId) }
        catch (cancelError) {
          await tianjiWeixinMessage.cancelSchedule(result.scheduleId).catch(()=>undefined)
          throw cancelError
        }
        externalId=result.scheduleId
      } else {
        result=await tianjiWeixinMessage.createSchedule(scheduleInput)
        externalId=result.scheduleId
      }
      if(meetingSnapshot&&meetingSnapshot.meetingId!==nextMeetingSnapshot?.meetingId) await tianjiWeixinMessage.cancelMeeting(meetingSnapshot.meetingId)
      const syncedExternalId=type==='取消预约'?previousExternalId:text(result?.scheduleId)||externalId
      const eventExternalId=type==='取消预约'?previousExternalId:syncedExternalId
      const syncedBookingId=type==='取消预约'?'':nextBookingId
      const syncedBookingSnapshot=type==='取消预约'?'':nextBookingSnapshot?JSON.stringify(nextBookingSnapshot):''
      const syncedMeetingSnapshot=nextMeetingSnapshot?JSON.stringify(nextMeetingSnapshot):''
      await teable.updateRecord(this.table('recruitment_interviews'),row.id,{外部预约ID:syncedExternalId,外部会议室预订ID:syncedBookingId,外部会议室预订信息JSON:syncedBookingSnapshot,外部会议信息JSON:syncedMeetingSnapshot,...(meetingRequired?{会议地址:nextMeetingSnapshot?.meetingLink||''}:{}),同步状态:'已同步',同步错误:'',最近同步时间:now(),更新时间:now()})
      meetingCommitted=true
      await this.syncEvent(eventId,interviewId,type,old,'已同步',eventExternalId,payload,result,'',operator)
      return {status:'已同步',externalId:syncedExternalId,bookingId:syncedBookingId,reused:Boolean(result?.reused),roomBooking:nextBookingSnapshot&&syncedBookingId&&syncedExternalId&&!reuseSharedRoom?{bookingId:syncedBookingId,scheduleId:syncedExternalId,snapshot:nextBookingSnapshot}:undefined}
    } catch(error){
      const rawMessage=error instanceof Error?error.message:String(error)
      if(createdMeeting&&!meetingCommitted) await tianjiWeixinMessage.cancelMeeting(createdMeeting.meetingId).catch(()=>undefined)
      const roomRejected=/企微会议室预定失败 \(\d+\)|meetingroom not available/i.test(rawMessage)
      if (roomRejected) console.error(`[面试企微日程] 会议室预定被拒，原始信息: ${rawMessage}`)
      const message=roomRejected?'该会议室暂时无法预约，请换一间会议室后重新提交。':rawMessage
      await teable.updateRecord(this.table('recruitment_interviews'),row.id,{同步状态:'同步失败',同步错误:message,最近同步时间:now(),更新时间:now()})
      await this.syncEvent(eventId,interviewId,type,old,'同步失败',externalId||previousExternalId,{}, {},message,operator)
      return {status:'同步失败',message,roomRejected,roomBooking:undefined,action:'请按错误信息检查天玑企微接口参数后，再使用人工重试'}
    }
  }
  private async resolveWecomAttendees(ids:string[]){const [directory,pool]=await Promise.all([this.listInterviewers(),teable.listAllRecords(this.table('recruitment_interviewer_pool'))]);const resolved=ids.map((id)=>{const user=directory.interviewers.find((item)=>item.id===id);if(user?.wecomUserId)return user.wecomUserId;const legacy=pool.find((item)=>text(item.fields['面试官ID'])===id||text(item.fields['用户ID'])===id);return text(legacy?.fields['用户ID'])}).filter(Boolean);if(!resolved.length)throw new Error('预约中没有可用于企微日程的面试官成员 ID');return resolved}
  private async resolveWecomUserId(userId:string){if(!userId)return '';const users=await teable.listByField(this.table('recruitment_users'),'用户ID',userId,2);const user=users.find((item)=>text(item.fields['用户ID'])===userId);return text(user?.fields['企业微信用户ID'])||text(user?.fields['天玑微信ID'])}
  private async syncEvent(eventId:string,interviewId:string,type:string,oldState:string,newState:string,externalId:string,request:unknown,response:unknown,error:string,operator:string){await teable.createRecord(this.table('recruitment_interview_sync_events'),{同步事件ID:eventId,面试ID:interviewId,同步类型:type,同步方向:'系统到企微',原状态:oldState,新状态:newState,外部预约ID:externalId,请求摘要JSON:JSON.stringify(request),响应摘要JSON:JSON.stringify(response),错误信息:error,操作人:operator,发生时间:now()})}
  private async ensureInviteTemplates(){const table=this.table('recruitment_interview_invite_templates');const rows=await teable.listAllRecords(table);if(rows.length)return;const timestamp=now();const defaults=[{name:'线下面试邀约',mode:'线下面试',content:'你好，{{候选人姓名}}。邀请你于{{面试时间}}参加{{面试轮次}}，地点：{{面试地点}}。请通过安全链接确认、申请改期或签到：{{确认链接}}'},{name:'线上面试邀约',mode:ONLINE_INTERVIEW_MODE,content:'你好，{{候选人姓名}}。邀请你于{{面试时间}}参加{{面试轮次}}线上面试，会议链接：{{会议链接}}。请通过安全链接确认：{{确认链接}}'}];for(const item of defaults)await teable.createRecord(table,{邀约模板ID:id('interviewtpl'),模板名称:item.name,适用面试方式:item.mode,模板内容:item.content,变量JSON:JSON.stringify([...item.content.matchAll(/{{([^}]+)}}/g)].map(x=>x[1])),模板状态:'启用',创建人:'系统',创建时间:timestamp,更新时间:timestamp})}
  private async renderInvite(interviewId:string,token:string,publicUrl=''){await this.ensureInviteTemplates();const row=await this.findInterview(interviewId);const templates=await teable.listAllRecords(this.table('recruitment_interview_invite_templates'));const mode=normalizeInterviewMode(row.fields['面试方式']);const template=templates.find(r=>normalizeInterviewMode(r.fields['适用面试方式'])===mode)||templates[0];const candidates=await teable.listByField(this.table('recruitment_candidates'),'候选人ID',text(row.fields['候选人ID']),2);const candidate=candidates.find(r=>text(r.fields['候选人ID'])===text(row.fields['候选人ID']));const values:Record<string,string>={'候选人姓名':text(candidate?.fields['姓名']),'面试时间':this.formatWecomMeetingTime(new Date(text(row.fields['开始时间']))),'面试轮次':text(row.fields['面试轮次']),'面试地点':text(row.fields['面试地点']),'会议链接':text(row.fields['会议地址']),'确认链接':this.invitationLink(token,publicUrl)};let content=text(template?.fields['模板内容']);for(const[key,value]of Object.entries(values))content=content.replaceAll(`{{${key}}}`,value||'待确认');return{templateId:text(template?.fields['邀约模板ID']),templateName:text(template?.fields['模板名称']),content,sendStatus:'将随预约自动发送'}}
  private invitationLink(token:string, publicUrl='') {
    const raw = text(process.env.APP_PUBLIC_URL) || text(publicUrl)
    if (!raw) throw new Error('缺少候选人访问地址，无法生成安全面试链接')
    let url: URL
    try { url = new URL(raw) } catch { throw new Error('候选人访问地址无效，无法生成安全面试链接') }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('候选人访问地址必须使用 HTTP(S)')
    url.search = ''; url.hash = ''; url.searchParams.set('interview_token', token)
    return url.toString()
  }
  private candidateEmailContent(row:TeableRecord,candidate:TeableRecord,link:string) {
    const name = text(candidate.fields['姓名']) || '候选人'
    const round = text(row.fields['面试轮次']) || '面试'
    const meetingUrl = this.onlineMeetingUrl(row)
    const mode = normalizeInterviewMode(row.fields['面试方式'])
    const meetingLabel = '进入会议'
    return candidateEmailCard({
      candidateName:name,
      title:'面试邀请',
      brandSub:'FANGPIAN · INTERVIEW',
      intro:[meetingUrl ? `你好，方片新媒体已为你安排${round}${mode}。面试开始时点击下方「${meetingLabel}」即可加入；点击「查看面试安排」可查看时间、地点、面试官和注意事项。` : `你好，方片新媒体已为你安排${round}。点击下方按钮即可查看时间、地点、面试官和注意事项。`],
      details:[],
      primaryLink:{label:'查看面试安排',href:link},
      secondaryLinks:meetingUrl?[{label:meetingLabel,href:meetingUrl}]:[],
      footer:'方片新媒体招聘团队',
    })
  }
  private onlineMeetingUrl(row:TeableRecord){const url=text(row.fields['会议地址']);return isOnlineInterviewMode(row.fields['面试方式'])&&/^https?:\/\//i.test(url)?url:''}
  private async sendCandidateInterviewEmail(interviewId:string,token:string,publicUrl:string|undefined,operator:string) {
    const row = await this.findInterview(interviewId)
    const candidates = await teable.listByField(this.table('recruitment_candidates'), '候选人ID', text(row.fields['候选人ID']), 2)
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    const email = text(candidate?.fields['邮箱']), eventId = id('mail'), timestamp = now()
    if (!candidate || !email) return { status: '发送失败', message: '候选人邮箱不存在，未发送邮件' }
    const subject = `方片新媒体｜${text(row.fields['面试轮次']) || '面试'}邀请｜${this.formatWecomMeetingTime(new Date(text(row.fields['开始时间']))).slice(0, 16)}`
    try {
      const link = this.invitationLink(token, publicUrl || '')
      const links=await teable.listByField(this.table('recruitment_public_links'),'对象ID',interviewId,200)
      if(!links.some(item=>text(item.fields['链接类型'])==='面试邀请'&&text(item.fields['访问Token哈希'])===hash(token)))await teable.createRecord(this.table('recruitment_public_links'),{链接ID:id('link'),候选人ID:text(row.fields['候选人ID']),链接类型:'面试邀请',对象类型:'面试',对象ID:interviewId,访问Token哈希:hash(token),Token前缀:token.slice(0,8),访问路径:link,链接状态:'有效',过期时间:text(row.fields['操作链接过期时间']),创建人:operator,创建时间:timestamp,更新时间:timestamp})
      const content = this.candidateEmailContent(row, candidate, link)
      const result = await tianjiWeixinMessage.sendMail({ toEmails: [email], subject, content, contentType: 'html' })
      const externalId = text(result.messageId)
      await teable.createRecord(this.table('recruitment_interview_mail_events'), { 邮件事件ID: eventId, 面试ID: interviewId, 候选人ID: text(row.fields['候选人ID']), 收件人邮箱: email, 邮件主题: subject, 邮件正文: content, 发送状态: '已发送', 外部邮件ID: externalId, 错误信息: '', 发送人: operator, 发送时间: timestamp, 创建时间: timestamp })
      return { status: '已发送', recipient: email, subject }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await teable.createRecord(this.table('recruitment_interview_mail_events'), { 邮件事件ID: eventId, 面试ID: interviewId, 候选人ID: text(row.fields['候选人ID']), 收件人邮箱: email, 邮件主题: subject, 邮件正文: '', 发送状态: '发送失败', 外部邮件ID: '', 错误信息: message.slice(0, 1000), 发送人: operator, 发送时间: timestamp, 创建时间: timestamp })
      return { status: '发送失败', message }
    }
  }
  private async completeRescheduleTasks(interviewId:string,operator:string,note:string){
    const rows=await teable.listAllRecords(this.table('recruitment_tasks')),timestamp=now()
    for(const row of rows.filter(item=>text(item.fields['待办类型'])==='面试改期'&&text(item.fields['对象ID'])===interviewId&&text(item.fields['待办状态'])!=='已完成'))await teable.updateRecord(this.table('recruitment_tasks'),row.id,{待办状态:'已完成',备注:`${operator}：${note}`,完成时间:timestamp,更新时间:timestamp})
  }
  private async audit(action:string,objectType:string,objectId:string,before:unknown,after:unknown,operator:string,reason=''){await teable.createRecord(this.table('recruitment_audit_logs'),{日志ID:id('audit'),操作人:operator,操作类型:action,对象类型:objectType,对象ID:objectId,修改前摘要JSON:JSON.stringify(before),修改后摘要JSON:JSON.stringify(after),操作原因:reason,请求ID:id('req'),发生时间:now(),操作结果:'成功',错误信息:''})}
  private async findInterview(interviewId:string){const table=this.table('recruitment_interviews');let row:TeableRecord|undefined;if(interviewId.startsWith('rec')){try{row=await teable.getRecord(table,interviewId)}catch{}}if(!row||(!text(row.fields['面试ID'])&&row.id!==interviewId)||text(row.fields['面试ID'])!==interviewId)row=await teable.findOneByField(table,'面试ID',interviewId);if(row&&text(row.fields['面试ID'])!==interviewId&&row.id!==interviewId)row=(await teable.listAllRecords(table)).find(r=>text(r.fields['面试ID'])===interviewId||r.id===interviewId);if(!row)throw new NotFoundException('面试预约不存在');return row}
  private async resolveToken(token:string){if(!text(token))throw new UnauthorizedException('面试操作链接无效');const table=this.table('recruitment_interviews');let row=await teable.findOneByField(table,'候选人操作Token哈希',hash(token));if(row&&text(row.fields['候选人操作Token哈希'])!==hash(token))row=(await teable.listAllRecords(table)).find(r=>text(r.fields['候选人操作Token哈希'])===hash(token));if(!row)throw new UnauthorizedException('面试操作链接无效');if(Date.parse(text(row.fields['操作链接过期时间']))<=Date.now())throw new UnauthorizedException('面试操作链接已过期');if(text(row.fields['面试状态'])==='已取消')throw new ConflictException('面试已取消');return row}
  private async publicPayload(row:TeableRecord){
    const [candidates,rooms,directory,forms]=await Promise.all([teable.listAllRecords(this.table('recruitment_candidates')),teable.listAllRecords(this.table('recruitment_meeting_rooms')),this.listInterviewers(),teable.listAllRecords(this.table('recruitment_interview_candidate_forms'))])
    const candidate=candidates.find(r=>text(r.fields['候选人ID'])===text(row.fields['候选人ID']))
    const room=rooms.find(r=>text(r.fields['会议室ID'])===text(row.fields['会议室ID']))
    const ids=json<string[]>(row.fields['面试官用户IDJSON'],[]), interviewId=text(row.fields['面试ID'])||row.id
    const latestForm=forms.filter((item)=>text(item.fields['面试ID'])===interviewId).sort((left,right)=>text(right.fields['提交时间']).localeCompare(text(left.fields['提交时间'])))[0]
    return {interviewId,candidateName:text(candidate?.fields['姓名']),round:text(row.fields['面试轮次']),mode:normalizeInterviewMode(row.fields['面试方式']),startAt:text(row.fields['开始时间']),endAt:text(row.fields['结束时间']),timezone:text(row.fields['时区']),location:this.onlineMeetingUrl(row)?'线上会议':isOnlineInterviewMode(row.fields['面试方式'])?'线上会议（链接待确认）':(text(row.fields['面试地点'])||text(room?.fields['会议室名称'])||'山东省烟台市莱山区方片新媒体'),meetingUrl:text(row.fields['会议地址']),interviewers:directory.interviewers.filter((item)=>ids.includes(item.id)||ids.includes(item.userId)).map((item)=>item.name),status:text(row.fields['面试状态']),confirmationStatus:text(row.fields['候选人确认状态']),confirmedAt:text(row.fields['候选人确认时间']),questionStatus:text(row.fields['面试题状态'])||'待生成',checkInStatus:text(row.fields['签到状态']),note:text(row.fields['备注']),reschedule:{status:text(row.fields['改期审批状态']),reason:text(row.fields['候选人改期原因']),preferredTimes:json<string[]>(row.fields['改期期望时间JSON'],[]),requestedAt:text(row.fields['改期申请时间']),decidedAt:text(row.fields['改期审批时间']),decisionNote:text(row.fields['改期审批说明']),notificationStatus:text(row.fields['改期通知状态'])},candidateProfile:{phone:text(candidate?.fields['电话']),gender:text(candidate?.fields['性别']),yearsOfExperience:text(candidate?.fields['工作年限']),highestEducation:text(candidate?.fields['最高学历']),age:candidate?.fields['年龄'] ?? ''},preparationStatus:text(latestForm?.fields['填写状态'])||'待填写',preparationSubmittedAt:text(latestForm?.fields['提交时间'])}
  }
  private timeRange(startAt:string,endAt:string){const start=new Date(startAt),end=new Date(endAt);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)throw new BadRequestException('面试开始和结束时间无效');return{start,end}}
  private interviewRange(startAt:string,endAt:string){const range=this.timeRange(startAt,endAt);if(range.end.getTime()-range.start.getTime()>MAX_SINGLE_INTERVIEW_DURATION_MS)throw new BadRequestException('单场面试时段最长 8 小时；此处不是多日日期范围，请选择具体的开始和结束时间');return range}
  private scheduledInterviewRange(startAt:string,endAt:string){
    return this.interviewRange(startAt,endAt)
  }
  private async markHistoricalAppointment(interviewId: string, operator: string) {
    const row = await this.findInterview(interviewId)
    const timestamp = now()
    await teable.updateRecord(this.table('recruitment_interviews'), row.id, {
      会议室ID: '', 外部预约ID: '', 外部会议室预订ID: '', 外部会议室预订信息JSON: '',
      同步状态: '无需同步', 同步错误: '', 最近同步时间: timestamp, 更新时间: timestamp,
    })
    await this.syncEvent(id('sync'), interviewId, '补录历史面试', text(row.fields['同步状态']), '无需同步', '', { historical: true }, { status: '无需同步' }, '已过去的面试只补录数据，不查询企微会议室，也不创建企微日程', operator)
    return { status: '无需同步', message: '历史面试已补录，未创建企微日程', roomRejected: false, roomBooking: undefined }
  }
  private meetingRoomReservationRange(start:Date,end:Date){
    const slot=30*60_000,reservationStart=new Date(Math.floor(start.getTime()/slot)*slot),reservationEnd=new Date(Math.ceil(end.getTime()/slot)*slot)
    if(reservationEnd.getTime()-reservationStart.getTime()>MAX_SINGLE_INTERVIEW_DURATION_MS)throw new BadRequestException('按企微会议室半小时规则取整后，单场面试占用不能超过 8 小时')
    return{start:reservationStart,end:reservationEnd}
  }
  private mapInterviewer=(row:TeableRecord)=>({id:text(row.fields['面试官ID'])||row.id,userId:text(row.fields['用户ID']),name:text(row.fields['姓名']),department:text(row.fields['部门']),roles:json<string[]>(row.fields['擅长岗位JSON'],[]),rounds:json<string[]>(row.fields['可面轮次JSON'],[]),timezone:text(row.fields['时区']),status:text(row.fields['状态']),maxPerDay:num(row.fields['每日最大面试数'])})
  private mapRoom=(row:TeableRecord)=>({id:text(row.fields['会议室ID'])||row.id,name:text(row.fields['会议室名称']),location:text(row.fields['办公地点']),floor:text(row.fields['楼层']),capacity:num(row.fields['容纳人数']),equipment:json<string[]>(row.fields['设备JSON'],[]),externalResourceId:text(row.fields['外部资源ID']),status:text(row.fields['资源状态']),syncStatus:text(row.fields['同步状态']),syncError:text(row.fields['同步错误'])})
  private mapAppointment(row:TeableRecord,candidates:TeableRecord[],interviewers:any[],rooms:TeableRecord[]){const candidateId=text(row.fields['候选人ID']);const candidate=candidates.find(r=>text(r.fields['候选人ID'])===candidateId);const ids=json<string[]>(row.fields['面试官用户IDJSON'],[]);return{id:text(row.fields['面试ID'])||row.id,candidateId,candidateName:text(candidate?.fields['姓名']),role:text(candidate?.fields['期望职位'])||'岗位待确认',round:text(row.fields['面试轮次']),mode:normalizeInterviewMode(row.fields['面试方式']),startAt:text(row.fields['开始时间']),endAt:text(row.fields['结束时间']),timezone:text(row.fields['时区']),location:text(row.fields['面试地点']),meetingUrl:text(row.fields['会议地址']),room:rooms.find(r=>text(r.fields['会议室ID'])===text(row.fields['会议室ID']))?this.mapRoom(rooms.find(r=>text(r.fields['会议室ID'])===text(row.fields['会议室ID']))!):null,interviewerIds:ids,interviewers:interviewers.filter((item)=>ids.includes(text(item.id))||ids.includes(text(item.userId))).map((item)=>item.fields?this.mapInterviewer(item):item),status:text(row.fields['面试状态']),confirmationStatus:text(row.fields['候选人确认状态']),confirmedAt:text(row.fields['候选人确认时间']),evaluationStatus:text(row.fields['评价状态'])||'未开始',checkInStatus:text(row.fields['签到状态']),syncStatus:text(row.fields['同步状态']),syncError:text(row.fields['同步错误']),externalId:text(row.fields['外部预约ID']),bookingId:text(row.fields['外部会议室预订ID']),note:text(row.fields['备注']),reschedule:{status:text(row.fields['改期审批状态']),reason:text(row.fields['候选人改期原因']),preferredTimes:json<string[]>(row.fields['改期期望时间JSON'],[]),requestedAt:text(row.fields['改期申请时间']),decidedAt:text(row.fields['改期审批时间']),decisionNote:text(row.fields['改期审批说明']),notificationStatus:text(row.fields['改期通知状态']),notificationError:text(row.fields['改期通知错误'])}}}
}
