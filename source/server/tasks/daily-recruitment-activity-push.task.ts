import { Injectable, OnModuleInit } from '@nestjs/common'
import { defineTask } from '../platform/tasks'
import { RecruitmentService } from '../modules/recruitment/recruitment.service'

type MonthlyHiringResult = Awaited<ReturnType<RecruitmentService['monthlyHiring']>>

export interface DailyRecruitmentActivityPushInput {
  date: string
  summary: {
    resumes: number | string
    interviews: number | string
    offers: number | string
    arrived: number | string
  }
  uploaders?: Array<{ name: string; count: number; department?: string }>
  departmentUploads?: Array<{ department: string; count: number; uploaders: Array<{ name: string; count: number }> }>
  resumeUploads?: Array<Record<string, string>>
}

const text = (value: unknown) => String(value ?? '').trim()
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const byteLength = (value: string) => new TextEncoder().encode(value).length

export function buildDailyRecruitmentActivityMarkdown(input: DailyRecruitmentActivityPushInput) {
  const uploaders = input.uploaders || []
  const uploads = uploaders.length ? uploaders : (input.resumeUploads || []).reduce((result, item) => {
    const uploader = text(item.uploader)
    const current = result.find(entry => entry.name === uploader)
    if (current) current.count += 1
    else result.push({ name: uploader || '未记录', count: 1 })
    return result
  }, [] as Array<{ name: string; count: number }>)
  const manualUploads = uploads.filter(item => item.name !== '内推')
  const referralUploads = uploads.filter(item => item.name === '内推')
  const manualUploadSummary = manualUploads.length
    ? manualUploads.map((item, index) => `${index ? '上传 ' : ''}${text(item.name)} ${number(item.count)} 份`).join('、')
    : '暂无上传记录'
  const referralCount = referralUploads.reduce((sum, item) => sum + number(item.count), 0)
  return [
    '## 每日招聘动态',
    `<font color="comment">${text(input.date)}</font>`,
    `- 简历入库：${number(input.summary.resumes)}`,
    `- 面试场次：${number(input.summary.interviews)}`,
    `- 已发 Offer：${number(input.summary.offers)}`,
    `- 入职数：${number(input.summary.arrived)}`,
    '来源分类:',
    `上传：${manualUploadSummary}`,
    `内推：${referralCount}份`,
  ].join('\n')
}

function splitLongLine(line: string, maxBytes: number): string[] {
  if (byteLength(line) <= maxBytes) return [line]

  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  for (const character of line) {
    const characterBytes = byteLength(character)
    if (current && currentBytes + characterBytes > maxBytes) {
      parts.push(current)
      current = character
      currentBytes = characterBytes
      continue
    }
    current += character
    currentBytes += characterBytes
  }
  if (current) parts.push(current)
  return parts
}

export function splitMarkdownForWecom(markdown: string, maxBytes = 3500): string[] {
  if (maxBytes < 128) throw new Error('企微 markdown 分片长度不能小于 128 字节')
  if (byteLength(markdown) <= maxBytes) return [markdown]

  const chunks: string[] = []
  let currentLines: string[] = []
  let currentBytes = 0
  for (const line of markdown.split('\n')) {
    for (const part of splitLongLine(line, maxBytes)) {
      const partBytes = byteLength(part)
      const separatorBytes = currentLines.length ? 1 : 0
      if (currentLines.length && currentBytes + separatorBytes + partBytes > maxBytes) {
        chunks.push(currentLines.join('\n'))
        currentLines = [part]
        currentBytes = partBytes
        continue
      }
      currentLines.push(part)
      currentBytes += separatorBytes + partBytes
    }
  }
  if (currentLines.length) chunks.push(currentLines.join('\n'))
  return chunks
}

export function buildDailyRecruitmentActivityMarkdownMessages(
  input: DailyRecruitmentActivityPushInput,
  maxBytes = 3500,
): string[] {
  const chunks = splitMarkdownForWecom(
    buildDailyRecruitmentActivityMarkdown(input),
    maxBytes - 80,
  )
  return chunks.map((chunk, index) =>
    index === 0 ? chunk : `## 每日招聘动态（续 ${index}）\n${chunk}`,
  )
}

let runDailyRecruitmentActivityPush: ((log: (message: string) => void) => Promise<void>) | undefined

@Injectable()
export class DailyRecruitmentActivityPushTaskRunner implements OnModuleInit {
  constructor(private readonly recruitment: RecruitmentService) {}

  onModuleInit() {
    runDailyRecruitmentActivityPush = log => this.run(log)
  }

  async run(log: (message: string) => void) {
    const data: MonthlyHiringResult = await this.recruitment.monthlyHiring('', undefined, 'day')
    const activity = (data.hiringActivity || data.dailyHiring) as DailyRecruitmentActivityPushInput
    if (!activity) throw new Error('未获取到今日招聘动态数据')
    const webhookKey = text(process.env.WECOM_DAILY_RECRUITMENT_WEBHOOK_KEY)
    if (!webhookKey) throw new Error('未配置 WECOM_DAILY_RECRUITMENT_WEBHOOK_KEY，无法推送每日招聘动态')
    const messages = buildDailyRecruitmentActivityMarkdownMessages(activity)
    for (const [index, content] of messages.entries()) {
      const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(webhookKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
      })
      const result = await response.json().catch(() => ({} as any))
      if (!response.ok || result?.errcode !== 0) {
        throw new Error(text(result?.errmsg) || `每日招聘动态推送失败：第 ${index + 1}/${messages.length} 片 HTTP ${response.status}`)
      }
    }
    log(`已推送每日招聘动态：简历入库 ${number(activity.summary.resumes)} 份，面试 ${number(activity.summary.interviews)} 场，Offer ${number(activity.summary.offers)} 份，入职 ${number(activity.summary.arrived)} 人`)
  }
}

defineTask({
  name: '每日招聘动态推送',
  description: '每天晚上6点汇总当日简历入库、面试场次、Offer、入职和来源分类，并推送到企微群',
  cron: '0 18 * * *',
  schedule: '每天 18:00',
  handler: async ({ log }) => {
    if (!runDailyRecruitmentActivityPush) throw new Error('每日招聘动态推送服务尚未初始化')
    await runDailyRecruitmentActivityPush(log)
  },
})
