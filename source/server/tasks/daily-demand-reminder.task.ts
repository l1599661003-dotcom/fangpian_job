import { appFlowUrl } from '../platform/app-links'
import { defineTask } from '../platform/tasks'
import { teable, TeableRecord } from '../platform/teable'
import { tianjiWeixinMessage } from '../platform/tianji-weixin-message'

const companyCalendar = require('../company-calendar.js') as {
  monthForDate(value: Date | number | string): string
  monthRange(month: string): { startDate: string; endDate: string } | null
}
const text = (value: unknown) => String(value ?? '').trim()
const activeBinding = (fields: Record<string, unknown>, now: number) => {
  if (text(fields['绑定状态']) !== '启用') return false
  const startsAt = text(fields['生效时间']), expiresAt = text(fields['失效时间'])
  const start = startsAt ? Date.parse(startsAt) : Number.NaN
  const end = expiresAt ? Date.parse(expiresAt) : Number.NaN
  if ((startsAt && !Number.isFinite(start)) || (expiresAt && !Number.isFinite(end))) return false
  return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end > now)
}

export interface DemandReminderRecipient {
  userId: string
  name: string
  wechatId: string
}

export function selectDepartmentLeaderRecipients(input: {
  roles: TeableRecord[]
  bindings: TeableRecord[]
  users: TeableRecord[]
  now?: number
}): DemandReminderRecipient[] {
  const now = input.now ?? Date.now()
  const enabledRoleCodes = new Set(input.roles
    .filter((row) => text(row.fields['角色状态']) === '启用')
    .map((row) => text(row.fields['角色编码'])))
  if (!enabledRoleCodes.has('department_leader')) return []

  const usersById = new Map<string, TeableRecord>(input.users
    .filter((row) => text(row.fields['用户状态']) === '启用' && text(row.fields['天玑人事状态']) !== '离职')
    .map((row) => [text(row.fields['用户ID']), row] as const))
  const recipients = new Map<string, DemandReminderRecipient>()
  for (const binding of input.bindings) {
    const fields = binding.fields
    const userId = text(fields['用户ID'])
    if (text(fields['角色编码']) !== 'department_leader' || !activeBinding(fields, now) || !userId) continue
    const user = usersById.get(userId)
    if (!user || recipients.has(userId)) continue
    recipients.set(userId, {
      userId,
      name: text(user.fields['姓名']) || userId,
      wechatId: text(user.fields['天玑微信ID']) || text(user.fields['企业微信用户ID']),
    })
  }
  return [...recipients.values()]
}

export function buildDemandReminderMarkdown(input: { month: string; link: string }) {
  const range = companyCalendar.monthRange(input.month)
  const rangeLabel = range ? `（${range.startDate} 至 ${range.endDate}）` : ''
  return [
    '## 招聘需求录入提醒',
    `> 请核对 ${input.month} 公司月份${rangeLabel}本部门在招岗位及招聘进展，可新增、调整需求或暂停招聘。`,
    `[查看本部门招聘与需求 →](${input.link})`,
  ].join('\n')
}

defineTask({
  name: '每日招聘需求录入提醒',
  description: '每天晚上6点向已启用的部门负责人发送招聘需求录入提醒和直达链接',
  cron: '0 18 * * *',
  schedule: '每天 18:00',
  handler: async ({ log }) => {
    const month = companyCalendar.monthForDate(Date.now())
    const link = appFlowUrl('demand', { demand_month: month })
    if (!link) throw new Error('未配置 APP_PUBLIC_URL，无法生成需求录入直达链接')
    const markdown = buildDemandReminderMarkdown({ month, link })
    const tableNames = ['recruitment_users', 'recruitment_roles', 'recruitment_user_roles']
    const tables = await Promise.all(tableNames.map((name) => teable.ensureTable(name)))
    const [users, roles, bindings] = await Promise.all(tables.map((table) => teable.listAllRecords(table.id)))
    if (!roles.some((row) => text(row.fields['角色编码']) === 'department_leader' && text(row.fields['角色状态']) === '启用')) {
      throw new Error('系统中没有启用的“部门负责人”角色，未发送招聘需求提醒')
    }
    const recipients = selectDepartmentLeaderRecipients({ users, roles, bindings })
    if (!recipients.length) throw new Error('没有找到已启用且绑定“部门负责人”角色的员工，未发送招聘需求提醒')

    const withWechatId = recipients.filter((recipient) => recipient.wechatId)
    const missingWechatId = recipients.filter((recipient) => !recipient.wechatId).map((recipient) => recipient.name)
    const failures: string[] = []
    let sent = 0
    for (let index = 0; index < withWechatId.length; index += 5) {
      const batch = withWechatId.slice(index, index + 5)
      const results = await Promise.allSettled(batch.map((recipient) => tianjiWeixinMessage.send({
        wechatId: recipient.wechatId,
        message: markdown,
        msgType: 'markdown',
      })))
      results.forEach((result, batchIndex) => {
        if (result.status === 'fulfilled') sent += 1
        else failures.push(`${batch[batchIndex].name}：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
      })
    }
    log(`已向 ${sent}/${recipients.length} 位部门负责人发送 ${month} 招聘需求录入提醒`)
    if (missingWechatId.length || failures.length) {
      const details = [
        missingWechatId.length ? `未配置企微/天玑ID：${missingWechatId.join('、')}` : '',
        ...failures,
      ].filter(Boolean)
      throw new Error(`部门负责人招聘需求提醒部分失败：${details.join('；')}`)
    }
  },
})
