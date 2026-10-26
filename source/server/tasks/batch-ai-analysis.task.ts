import { Injectable, OnModuleInit } from '@nestjs/common'
import { defineTask } from '../platform/tasks'
import { TalentsService } from '../modules/talents/talents.service'

/**
 * 定时任务：补全人才档案中遗漏的 AI 分析（评分、岗位匹配、标签）。
 * 直接注入服务执行，避免内部 HTTP API 因登录态返回 401。
 */
let runBatchAutoAnalysis: ((log: (message: string) => void) => Promise<void>) | undefined

@Injectable()
export class BatchAiAnalysisTaskRunner implements OnModuleInit {
  constructor(private readonly talents: TalentsService) {}

  onModuleInit() {
    runBatchAutoAnalysis = async (log) => {
      const queueStatus = this.talents.getAiQueueStatus()
      log(`AI 队列状态: 待处理 ${queueStatus.pending}，运行中 ${queueStatus.running ? '是' : '否'}`)
      const result = await this.talents.batchAutoAnalyze(250)
      log(`补全完成: 处理${result.total}份，成功${result.succeeded}份，失败${result.failed}份，跳过${result.skipped}份`)
      if (result.failed) throw new Error(`${result.failed}份简历AI补全失败，详见结果明细`)
    }
  }
}

defineTask({
  name: 'AI岗位匹配补全',
  description: '补漏：为最新简历缺失AI分析或当前评分为0的人才批量生成评分、岗位匹配和标签',
  cron: '0 19 * * *',
  schedule: '每天 03:00（北京时间）',
  handler: async ({ log }) => {
    if (!runBatchAutoAnalysis) throw new Error('AI分析补全服务尚未初始化')
    await runBatchAutoAnalysis(log)
  },
})
