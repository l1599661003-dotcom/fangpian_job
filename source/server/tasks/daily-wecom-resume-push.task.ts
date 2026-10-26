import { Injectable, OnModuleInit } from '@nestjs/common'
import { defineTask } from '../platform/tasks'
import { teable } from '../platform/teable'
import { DatabaseService } from '../modules/database/database.service'
import { TalentsService } from '../modules/talents/talents.service'
import { MessagesService } from '../modules/messages/messages.service'

let runDailyPush: ((log: (message: string) => void) => Promise<void>) | undefined

@Injectable()
export class DailyResumePushTaskRunner implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly talents: TalentsService,
    private readonly messages: MessagesService,
  ) {}

  onModuleInit() {
    runDailyPush = (log) => this.run(log)
  }

  async run(log: (message: string) => void) {
    const rows = await teable.listAllRecords(this.database.requireTableId('resume_batch_import_items'))
    const current = Date.now(), chinaOffset = 8 * 60 * 60 * 1000
    const todayStart = Math.floor((current + chinaOffset) / 86400000) * 86400000 - chinaOffset
    const todayItems = rows.filter(row => {
      const completedAt = Date.parse(String(row.fields['完成时间'] || ''))
      return row.fields['处理状态'] === '已完成' && row.fields['候选人ID'] && String(row.fields['不推送企微群'] || '').trim() !== '是' && completedAt >= todayStart && completedAt < todayStart + 86400000
    })
    if (!todayItems.length) { log('今天没有需要推送的批量简历，跳过推送'); return }
    const date = new Date(current).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const errors: string[] = []
    try {
      const summary = await this.messages.notifyFlowEvent({
        category: '每日简历入库汇总', group: 'business', objectId: date, operator: '每日自动推送',
        markdown: `## 📋 每日简历推送\n<font color="comment">${date} 共 ${todayItems.length} 份新简历符合推送条件</font>\n综合评分达到60分且待业务群评审的简历将检查补发，已发送的不重复发送。`,
      })
      if (summary.status !== '已发送' && !(summary.status === '已跳过' && 'reason' in summary && summary.reason === '相同流程通知已发送')) throw new Error('每日汇总未成功发送')
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
    let pushed = 0, skipped = 0
    const candidateIds = [...new Set(todayItems.map(row => String(row.fields['候选人ID'])))]
    for (const candidateId of candidateIds) {
      try {
        const result = await this.talents.pushAutomaticReview(candidateId)
        if (result.status === '已发送') { pushed++; log(`已推送候选人 ${candidateId}`) }
        else if (result.status === '已跳过' || result.status === '无需发送') { skipped++; log(`未新增推送 ${candidateId}：${'reason' in result ? result.reason : result.status}`) }
        else throw new Error('未收到明确发送结果')
      } catch (error) { errors.push(`${candidateId}: ${error instanceof Error ? error.message : String(error)}`) }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    log(`每日推送完成：实际发送 ${pushed} 份，已发送或不满足条件跳过 ${skipped} 份，异常 ${errors.length} 项`)
    if (errors.length) throw new Error(errors.join('\n'))
  }
}

defineTask({
  name: '每日企微简历推送',
  description: '每天20点汇总当天批量入库简历，并补发评分达标且尚未发送的评审通知',
  cron: '0 20 * * *',
  schedule: '每天 20:00',
  handler: async ({ log }) => {
    if (!runDailyPush) throw new Error('每日简历推送服务尚未初始化')
    await runDailyPush(log)
  },
})
