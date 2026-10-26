import { Injectable, OnModuleInit } from '@nestjs/common'
import { defineTask } from '../platform/tasks'
import { InterviewsService } from '../modules/interviews/interviews.service'
import { EvaluationService } from '../modules/interviews/evaluation.service'
import { structuredInterviewTargetCount } from '../modules/interviews/interview-question-blueprint'
import { EmployeeLifecycleService } from '../modules/employee-lifecycle/employee-lifecycle.service'

let runFlow: ((log: (message: string) => void) => Promise<void>) | undefined
let runStartReminders: ((log: (message: string) => void) => Promise<void>) | undefined

@Injectable()
export class RecruitmentFlowTaskRunner implements OnModuleInit {
  constructor(
    private readonly interviews: InterviewsService,
    private readonly evaluations: EvaluationService,
    private readonly lifecycle: EmployeeLifecycleService,
  ) {}

  onModuleInit() {
    runFlow = (log) => this.run(log)
    runStartReminders = (log) => this.runStartReminders(log)
  }

  async runStartReminders(log: (message: string) => void) {
    const results = await Promise.allSettled([
      this.evaluations.checkBeforeInterviews(),
      this.interviews.checkCandidateDayBeforeReminders(),
    ])
    const errors: string[] = []
    for (const [index, result] of results.entries()) {
      const name = index === 0 ? '面试官开场提醒' : '候选人前一天邮件提醒'
      if (result.status === 'rejected') errors.push(`${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
      else {
        errors.push(...result.value.errors.map(error => `${name}: ${error}`))
        log(`${name}检查完成`)
      }
    }
    if (errors.length) throw new Error(errors.join('\n'))
  }

  async run(log: (message: string) => void) {
    const errors: string[] = []
    const check = async (name: string, operation: () => Promise<unknown>) => {
      try { return await operation() }
      catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); return undefined }
    }
    const delivery = await check('日程和邀请邮件恢复', () => this.interviews.checkDeliveryRecovery()) as {errors?:string[];pending?:number} | undefined
    errors.push(...(delivery?.errors || []))
    if (delivery?.pending) log(`日程和邀请邮件恢复：${delivery.pending} 项待人工处理`)
    await check('面试提醒', () => this.interviews.checkReminders('招聘流程自动化'))
    const feedbackSla = await check('面试评价催填', () => this.evaluations.checkFeedbackSla('招聘流程自动化')) as { errors?: string[] } | undefined
    errors.push(...(feedbackSla?.errors || []))
    const handoffs = await check('面试后HR交接', () => this.evaluations.checkHrHandoffs()) as {errors?:string[];pending?:number} | undefined
    errors.push(...(handoffs?.errors || []))
    if (handoffs?.pending) log(`面试后HR交接：${handoffs.pending} 项待人工处理`)
    const workbench = await check('面试题补偿检查', () => this.evaluations.workbench({})) as {items?: Array<{id:string;status:string;confirmationStatus:string;questionStatus:string}>} | undefined
    let generated = 0
    for (const item of workbench?.items || []) {
      if (item.status === '已取消') continue
      if (!['待生成','生成失败','生成中'].includes(item.questionStatus)) continue
      const result = await check(`面试题 ${item.id}`, () => this.evaluations.generateInterviewQuestions({interviewId:item.id,count:structuredInterviewTargetCount,operator:'招聘流程自动化'})) as {status?:string} | undefined
      if (result?.status === '已生成待推送') generated++
      else if (result && result.status !== '生成中') errors.push(`${item.id}: 面试题${result.status}`)
    }
    await check('入职评价提醒', () => this.lifecycle.checkProbationReviewReminders('招聘流程自动化'))
    const arrivalReminders = await check('入职提醒', () => this.lifecycle.checkOnboardingArrivalReminders('招聘流程自动化')) as { errors?: string[] } | undefined
    errors.push(...(arrivalReminders?.errors || []))
    log(`招聘流程检查完成：补偿生成面试题 ${generated} 场，已检查面试结束评价入口和每日催填`)
    if (errors.length) throw new Error(errors.join('\n'))
  }
}

defineTask({
  name: '面试前10分钟双向提醒',
  description: '每分钟检查已确认面试；开始前10分钟提醒面试官，开始前一天早上9点邮件提醒候选人，失败重试，取消和改期按最新安排处理',
  cron: '* * * * *',
  schedule: '每分钟检查面试时间提醒',
  handler: async ({ log }) => {
    if (!runStartReminders) throw new Error('面试提醒服务尚未初始化')
    await runStartReminders(log)
  },
})

defineTask({
  name: '招聘流程自动推进',
  description: '面试题预生成补偿、面试结束后评价入口、每日评价催填、评价完成交接HR填写Offer和入职提醒',
  cron: '*/10 * * * *',
  schedule: '每10分钟',
  handler: async ({ log }) => {
    if (!runFlow) throw new Error('招聘流程服务尚未初始化')
    await runFlow(log)
  },
})
