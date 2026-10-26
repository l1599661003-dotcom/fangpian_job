import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { llm } from '../../platform/llm'
import { teable, TeableRecord } from '../../platform/teable'
import { DatabaseService } from '../database/database.service'
import { MessagesService } from '../messages/messages.service'
import { appFlowUrl, interviewQuestionsUrl, interviewScheduleUrl } from '../../platform/app-links'
import { CommunicationTemplateInput, CommunicationTranscriptExtraction, PositionRematchInput, ResumeTalentInput, TalentAnalysis, TalentAnalysisCorrectionInput, TalentAnalysisRerunInput, TalentArchiveDeleteInput, TalentBatchInput, TalentBirthYearInput, TalentCommunicationInput, TalentContactLockInput, TalentMatchCorrectionInput, TalentMergeInput, TalentNameInput, TalentOwnershipInput, TalentPublicReviewInput, TalentReviewInput, TalentReviewViewer, TalentWecomShareInput } from './talent.types'
import { RecruitmentService } from '../recruitment/recruitment.service'
import { RoleAccessProfile, RoleAccessService, TalentAccessContext } from '../database/role-access.service'
import { AccessAdminService } from '../database/access-admin.service'
import { TALENT_DIRECTORY_FIELDS, TALENT_DIRECTORY_FILTER_FIELDS } from './talent-directory-fields'
import { ReadCache } from '../../platform/read-cache'

const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
const text = (value: unknown) => String(value ?? '').trim()
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const json = <T>(value: unknown, fallback: T): T => {
  try { return value ? JSON.parse(String(value)) as T : fallback } catch { return fallback }
}
const safeGender = (value: unknown) => ['男', '女'].includes(text(value)) ? text(value) : ''
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)))
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
const maskPhone = (value: string) => value.replace(/(\d{3})\d+(\d{4})/, '$1****$2')
const maskEmail = (value: string) => value.replace(/^(.{1,2}).*(@.*)$/, '$1***$2')
const TRADITIONAL_NAME_CHAR_MAP: Record<string, string> = {
  張: '张', 趙: '赵', 錢: '钱', 孫: '孙', 吳: '吴', 鄭: '郑', 馮: '冯', 陳: '陈', 衛: '卫', 蔣: '蒋', 韓: '韩', 楊: '杨',
  許: '许', 呂: '吕', 華: '华', 謝: '谢', 鄒: '邹', 蘇: '苏', 魯: '鲁', 韋: '韦', 馬: '马', 鳳: '凤', 鮑: '鲍', 費: '费',
  賀: '贺', 羅: '罗', 畢: '毕', 樂: '乐', 於: '于', 齊: '齐', 顧: '顾', 黃: '黄', 蕭: '萧', 鄧: '邓', 劉: '刘', 龍: '龙',
  葉: '叶', 賴: '赖', 譚: '谭', 喬: '乔', 關: '关', 鍾: '钟', 鐘: '钟', 歐: '欧', 陽: '阳',
}
const normalizeCandidateName = (value: unknown) => [...text(value).normalize('NFKC')
  .replace(/^[姓名Name:：]+/i, '')
  .replace(/[\s\u3000、，,.。．：:;；·•・—–_\-]+/g, '')]
  .map((character) => TRADITIONAL_NAME_CHAR_MAP[character] || character)
  .join('')
// 企微群机器人 Markdown 的能力有限：这里把动态字段压成单行并转义，
// 让群消息保持整齐，也避免候选人原始文本影响消息排版。
const wecomInline = (value: unknown, fallback = '待补充', limit = 72) => {
  const normalized = text(value).replace(/[\r\n]+/g, ' ').replace(/[\\`*_#[\]()<>]/g, '').replace(/\s{2,}/g, ' ')
  if (!normalized) return fallback
  return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1))}…` : normalized
}
const wecomList = (values: unknown[], fallback = '待补充', limit = 6) => {
  const items = values.map((item) => wecomInline(item, '', 18)).filter(Boolean).slice(0, limit)
  return items.length ? items.join(' · ') : fallback
}
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
})
const CANDIDATE_FIELD_MAP: Record<string, string> = {
  name: '姓名', gender: '性别', birthYear: '出生年份', phone: '电话', email: '邮箱', wechat: '微信', address: '当前城市',
  educationBackground: '教育经历', workExperience: '工作经历', selfEvaluation: '自我评价', yearsOfExperience: '工作年限',
  currentCompany: '当前公司', currentRole: '当前职位', jobIntention: '期望职位', owner: '负责人', ownerUserId: '负责人用户ID',
}
const MERGE_RELATION_TABLES = [
  'resume_extraction_records', 'recruitment_applications', 'recruitment_stage_events', 'recruitment_candidate_tags',
  'recruitment_ai_assessments', 'recruitment_job_matches', 'recruitment_communications', 'recruitment_interviews',
  'recruitment_interview_feedback', 'recruitment_referrals', 'recruitment_referral_rewards',
] as const
const LEGACY_STAGE_MAP: Record<string, string> = {
  '简历采集': '简历入库',
  '待负责人审查': '待业务群评审',
  '负责人审查': '待业务群评审',
  '意向沟通': '待约面',
  '约面': '已约面',
  '面试': '面试中',
  '待决策': '面试通过',
  'Offer沟通': 'Offer已发',
  '背调': '背调中',
}
const mapLegacyStage = (value: unknown) => LEGACY_STAGE_MAP[text(value)] || text(value)
const DIRECTORY_CACHE_TTL_MS = 60000
const EMPLOYEE_CACHE_TTL_MS = 60000
type AnalysisRun = { analysis: TalentAnalysis; status: '成功' | '规则降级'; durationMs: number; error: string; promptVersion: string; modelVersion: string; inputChars: number; outputChars: number; startedAt: string; completedAt: string }
type TalentDirectoryQuery = { q?: string; job?: string; status?: string; source?: string; tag?: string; importer?: string; minScore?: string; age?: string; region?: string; score?: string; page?: string; pageSize?: string; refresh?: string }

@Injectable()
export class TalentsService implements OnModuleInit {
  constructor(private readonly database: DatabaseService, private readonly recruitment: RecruitmentService, private readonly messages: MessagesService, @Optional() private readonly access?: RoleAccessService, @Optional() private readonly accessAdmin?: AccessAdminService) {}

  private cache = new ReadCache(24)
  private detailCache = new ReadCache(8)

  private cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    return this.cache.get(key, ttlMs, Object.keys(TALENT_DIRECTORY_FIELDS).map(name => this.table(name)), loader)
  }

  private invalidateDirectoryCache() {
    this.cache.clear()
    this.detailCache.clear()
  }

  private logSlow(operation: string, startedAt: number, thresholdMs = 1200) {
    const durationMs = Date.now() - startedAt
    if (durationMs >= thresholdMs) console.warn(`[slow] talents.${operation} ${durationMs}ms`)
  }

  async onModuleInit() {
    // 延迟 3 秒等数据库初始化完成后再恢复队列
    setTimeout(() => { void this.recoverAiQueue() }, 3000)
  }

  // AI 分析队列：简历入库后自动排队，一个一个执行，避免并发 LLM 调用
  private aiQueue: Array<{ candidateId: string; resumeId: string; reason: string; analysisType?: string }> = []
  private aiQueueRunning = false
  private aiQueueProcessed = 0
  private aiQueueTotal = 0
  private reviewShareLocks = new Map<string, Promise<void>>()
  private reviewSubmitLocks = new Map<string, Promise<void>>()

  /** 将一个人才加入 AI 分析队列，持久化到 recruitment_tasks 表，服务器重启后可恢复 */
  enqueueAiAnalysis(candidateId: string, resumeId: string, reason = '简历入库自动触发', analysisType = '入库自动分析') {
    const taskId = id('todo')
    const timestamp = now()
    const startQueuedAnalysis = () => {
      if (!this.aiQueue.some((item) => item.candidateId === candidateId && item.resumeId === resumeId)) {
        this.aiQueue.push({ candidateId, resumeId, reason, analysisType })
        this.aiQueueTotal++
      }
      void this.drainAiQueue()
    }
    // 异步写入任务表，不阻塞入库流程；下一拍再开始分析，避免和入库请求的后续处理竞争。
    void teable.createRecord(this.table('recruitment_tasks'), {
      待办ID: taskId, 待办类型: 'AI简历分析', 对象类型: '人才', 对象ID: candidateId,
      标题: `AI分析：${candidateId}`, 描述: reason,
      处理人: '系统', 优先级: '普通', 待办状态: '待处理',
      创建时间: timestamp, 更新时间: timestamp,
      扩展信息JSON: JSON.stringify({ candidateId, resumeId, reason, analysisType }),
    }).then(() => {
      setTimeout(startQueuedAnalysis, 0)
    }).catch((error) => {
      console.error(`[AI队列] 写入任务表失败: ${error instanceof Error ? error.message : String(error)}`)
      // 持久化失败时仍保留内存队列，保证本次分析不丢失。
      setTimeout(startQueuedAnalysis, 0)
    })
  }

  /** 获取队列状态 */
  getAiQueueStatus() {
    return {
      pending: this.aiQueue.length,
      running: this.aiQueueRunning,
      processed: this.aiQueueProcessed,
      total: this.aiQueueTotal,
    }
  }

  /** 启动时从任务表恢复未完成的 AI 分析任务 */
  async recoverAiQueue() {
    try {
      const rows = await teable.listAllRecords(this.table('recruitment_tasks'))
      const pending = rows.filter((row) =>
        text(row.fields['待办类型']) === 'AI简历分析' &&
        text(row.fields['待办状态']) === '待处理'
      )
      for (const row of pending) {
        const ext = json<{ candidateId: string; resumeId: string; reason: string; analysisType?: string }>(row.fields['扩展信息JSON'], { candidateId: '', resumeId: '', reason: '' })
        if (ext.candidateId && !this.aiQueue.some((item) => item.candidateId === ext.candidateId)) {
          const analysisType = ext.analysisType || (ext.reason === '简历入库自动触发' ? '入库自动分析' : '人工重跑')
          this.aiQueue.push({ candidateId: ext.candidateId, resumeId: ext.resumeId, reason: ext.reason || '启动恢复', analysisType })
        }
      }
      if (this.aiQueue.length > 0) {
        this.aiQueueTotal = this.aiQueue.length
        console.log(`[AI队列] 从任务表恢复 ${this.aiQueue.length} 个待分析任务`)
        void this.drainAiQueue()
      }
    } catch (error) {
      console.error(`[AI队列] 恢复失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 逐个处理队列中的 AI 分析任务 */
  private async drainAiQueue() {
    if (this.aiQueueRunning) return
    this.aiQueueRunning = true
    try {
      while (this.aiQueue.length > 0) {
        const item = this.aiQueue.shift()!
        const taskTable = this.table('recruitment_tasks')
        // 找到对应的任务记录并标记为处理中
        let taskRow: TeableRecord | undefined
        try {
          const taskRows = await teable.listByField(taskTable, '对象ID', item.candidateId, 100)
          taskRow = taskRows.filter((row) => {
            if (text(row.fields['待办类型']) !== 'AI简历分析' || text(row.fields['待办状态']) !== '待处理') return false
            const extension = json<{ resumeId?: string }>(row.fields['扩展信息JSON'], {})
            return !extension.resumeId || extension.resumeId === item.resumeId
          }).sort((a, b) => text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0]
          if (taskRow) await teable.updateRecord(taskTable, taskRow.id, { 待办状态: '处理中', 更新时间: now() })
        } catch { /* 查询失败不影响分析本身 */ }

        try {
          await this.analyzeSingleCandidate(item.candidateId, item.resumeId, item.reason, { type: item.analysisType })
          this.aiQueueProcessed++
          if (taskRow) await teable.updateRecord(taskTable, taskRow.id, { 待办状态: '已完成', 完成时间: now(), 更新时间: now() })
        } catch (error) {
          this.aiQueueProcessed++
          const msg = error instanceof Error ? error.message : String(error)
          console.error(`[AI队列] ${item.candidateId} 分析失败: ${msg}`)
          if (taskRow) await teable.updateRecord(taskTable, taskRow.id, { 待办状态: '失败', 备注: msg.slice(0, 500), 更新时间: now() })
        }
      }
    } finally {
      this.aiQueueRunning = false
    }
  }

  /** 对单个候选人执行 AI 分析（评分、标签、岗位匹配） */
  private async analyzeSingleCandidate(candidateId: string, resumeId: string, reason: string, options: { type?: string } = {}) {
    const candidate = await this.findCandidateRow(candidateId)
    const suppressGroupPush = text(candidate.fields['不推送企微群']) === '是'
    const [resumeRows, assessmentRows, applications] = await Promise.all([
      teable.listAllRecords(this.table('resume_extraction_records')),
      teable.listAllRecords(this.table('recruitment_ai_assessments')),
      teable.listAllRecords(this.table('recruitment_applications')),
    ])
    const resumeRow = resumeRows.find((row) => row.id === resumeId || text(row.fields['解析记录ID']) === resumeId)
      || resumeRows.filter((row) => text(row.fields['候选人ID']) === candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    if (!resumeRow) throw new Error('没有可用的简历记录')

    const candidateAssessments = assessmentRows.filter((row) => text(row.fields['候选人ID']) === candidateId)
      .sort((a, b) => (num(b.fields['版本号']) || 1) - (num(a.fields['版本号']) || 1) || text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))
    const previous = candidateAssessments[0]
    const version = Math.max(0, ...candidateAssessments.map((row) => num(row.fields['版本号']) || 1)) + 1
    const resume = this.resumeInput(resumeRow)
    const currentApplication = applications.find((row) =>
      text(row.fields['候选人ID']) === candidateId
      && text(row.fields['简历记录ID']) === resume.id
      && text(row.fields['当前状态']) !== '已结束',
    ) || applications.filter((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['当前状态']) !== '已结束').sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const selectedPositionId = text(currentApplication?.fields['职位ID'])
    const run = await this.analyzeRun(resume)
    const assessmentId = await this.saveAssessment(candidateId, resume.id, run.analysis, {
      version, parentId: text(previous?.fields['分析记录ID']) || previous?.id || '', type: options.type || '入库自动分析', reason, operator: '系统', operatorUserId: '', ...run,
    })
    await this.saveTags(candidateId, assessmentId, run.analysis)
    const matches = await this.saveMatches(candidateId, assessmentId, resume, run.analysis, selectedPositionId)

    // 更新当前应聘记录的 AI 匹配分
    const applicationId = text(currentApplication?.fields['应聘记录ID']) || currentApplication?.id || ''
    const qualifiesForReview = run.analysis.scores.overall >= 60
    const shouldEnterReview = Boolean(currentApplication && qualifiesForReview && text(currentApplication.fields['当前阶段']) === 'AI分析中')
    if (currentApplication) {
      await teable.updateRecord(this.table('recruitment_applications'), currentApplication.id, {
        AI匹配分: matches[0]?.score || run.analysis.scores.overall,
        AI评分版本: `talent-v${version}`,
        人工复核结果: selectedPositionId ? '已确认' : '待确认',
        ...(shouldEnterReview ? { 当前阶段: '待业务群评审', 最近处理时间: now() } : {}),
        更新时间: now(),
      })
    }
    if (shouldEnterReview) {
      await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 候选人状态: '待业务群评审', 更新时间: now() })
      await teable.createRecord(this.table('recruitment_stage_events'), {
        事件ID: id('evt'), 应聘记录ID: applicationId, 候选人ID: candidateId, 职位ID: text(currentApplication?.fields['职位ID']),
        原阶段: 'AI分析中', 新阶段: '待业务群评审', 操作: 'AI分析完成', 结果: `综合评分${run.analysis.scores.overall}分，进入业务群评审`,
        操作人: '系统', 发生时间: now(), 来源类型: '系统自动',
      })
    }

    console.log(`[AI队列] ${candidateId} 分析完成，评分${run.analysis.scores.overall}，匹配${matches.length}个岗位`)
    if (shouldEnterReview && !suppressGroupPush) {
      await this.pushAutomaticReview(candidateId).catch((error) => {
        console.error(`[流程通知] AI自动评审推送失败 ${candidateId}: ${error instanceof Error ? error.message : String(error)}`)
      })
    } else if (shouldEnterReview && suppressGroupPush) {
      console.log(`[流程通知] ${candidateId} 已按导入设置跳过业务群自动推送`)
    }
  }

  async pushAutomaticReview(candidateId: string) {
    const profile = await this.detail(candidateId)
    if (profile.suppressGroupPush) return { status: '已跳过', reason: '本次导入已设置不推送企微群' }
    const application = (profile.applications || []).find((item: any) => text(item['当前状态']) !== '已结束')
    if (!profile.analysis?.id || num(profile.analysis?.scores?.overall) < 60 || text(application?.['当前阶段']) !== '待业务群评审') {
      return { status: '无需发送', reason: '尚未完成达标评分，或应聘记录已不在待业务群评审阶段' }
    }
    const share = await this.shareForWecomReview(candidateId, { operator: 'AI评分自动推送', applicationId: text(application?.['应聘记录ID']), assessmentId: text(profile.analysis.id), expiresInDays: 7, sendMessage: false })
    const shares = await teable.listByField(this.table('recruitment_talent_review_shares'), '分享批次ID', share.shareId, 1)
    const row = shares[0]
    if (!row) throw new ServiceUnavailableException('评审链接记录未保存成功，无法确认自动推送')
    if (text(row.fields['发送时间']) && text(row.fields['分享状态']) === '评审中') return { status: '已跳过', reason: '该评审链接已发送' }
    const delivery = await this.notifyFlow('AI自动业务群评审', candidateId, 'business', this.reviewMarkdown(profile, share.reviewUrl, 7, application), share.shareId)
    const deliveryStatus = text((delivery as any)?.status), reason = text((delivery as any)?.reason) || text((delivery as any)?.error)
    const delivered = deliveryStatus === '已发送' || (deliveryStatus === '已跳过' && reason === '相同流程通知已发送')
    await teable.updateRecord(this.table('recruitment_talent_review_shares'), row.id, {
      分享状态: delivered ? '评审中' : '发送失败', 发送错误: delivered ? '' : reason || '企微群消息未发送',
      ...(delivered ? { 发送时间: now() } : {}), 更新时间: now(),
    })
    if (!delivered) throw new ServiceUnavailableException(`自动评审群推送失败：${reason || '未收到成功回执'}`)
    return { status: deliveryStatus, shareId: share.shareId }
  }


  private candidateName(candidate: TeableRecord) {
    return text(candidate.fields['姓名']) || '候选人'
  }

  private reviewCandidateName(profile: any) {
    const invalid = /^(?:候选人|未识别姓名|未知姓名|匿名|全职|兼职|实习|应届|应届生|在职|离职)$/
    const current = text(profile?.name)
    if (/^[\u3400-\u9fff·]{2,6}$/.test(current) && !invalid.test(current)) return current
    const lines = text(profile?.rawText).normalize('NFKC').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const fromHeading = text(lines[0]?.match(/^([\u3400-\u9fff·]{2,6})(?=\s+)/)?.[1])
    if (fromHeading && !invalid.test(fromHeading)) return fromHeading
    const sourceName = text(profile?.sourceFileName).normalize('NFKC').replace(/\.[^.]+$/, '')
    const fromFile = text(sourceName.match(/([\u3400-\u9fff·]{2,6})(?=\s*[（(]\d)/)?.[1])
    return fromFile && !invalid.test(fromFile) ? fromFile : '未识别姓名'
  }

  private reviewMarkdown(profile: any, reviewUrl: string, expiresInDays: number, application: any = {}) {
    const bestMatch = profile.matches?.[0]
    const matchScore = Number(bestMatch?.score || profile.analysis.scores?.overall || 0)
    const candidateName = wecomInline(this.reviewCandidateName(profile), '未识别姓名', 20)
    const recommendedPosition = wecomInline(bestMatch?.positionName || profile.jobIntention, '待选择', 30)
    const sourceType = [text(profile.source), text(application['来源类型'])].find((source) => source.includes('内推')) || text(profile.source) || text(application['来源类型'])
    const isReferral = sourceType.includes('内推') || Boolean(text(application['内推记录ID']))
    const selectedPosition = wecomInline(application.positionName || application['职位名称'], '候选人未选择岗位', 30)
    const hasSelectedPosition = Boolean(text(application.positionId) || text(application['职位ID']))
    const aiMatches = (profile.matches || []).slice(0, 3).filter((item: any) => text(item.positionName))
    const aiRecommendedPositions = aiMatches.length
      ? aiMatches.map((item: any) => `${wecomInline(item.positionName, '岗位待补充', 30)}（${Math.round(Number(item.score || 0))}分）`).join('、')
      : wecomList(profile.analysis.recommendedRoles || [], recommendedPosition, 3)
    const experience = wecomInline(profile.yearsOfExperience, '经验待补充', 16)
    const city = wecomInline(profile.address, '城市待补充', 18)
    const currentExperience = wecomInline(profile.currentRole || profile.currentCompany, '当前经历待补充', 36)
    const strengths = wecomList(profile.analysis.strengths || [], '等待人工确认', 3)
    const tags = wecomList(profile.skills || [], '待补充', 6)
    return [
      `## 【${isReferral ? '内推简历 · 待评审' : '待评审'}】${candidateName}`,
      `<font color="comment">请业务负责人快速判断是否适合本部门岗位</font>`,
      ...(isReferral ? [
        `> **简历来源**　员工内推`,
        `> **候选人选择岗位**　<font color="info">${selectedPosition}</font>`,
        `> **AI推荐岗位**　<font color="info">${aiRecommendedPositions}</font>　　**AI综合评分**　<font color="warning">${Number(profile.analysis.scores?.overall || 0)} 分</font>`,
      ] : hasSelectedPosition ? [
        `> **上传人选择岗位**　<font color="info">${selectedPosition}</font>`,
        `> **AI推荐岗位**　<font color="info">${aiRecommendedPositions}</font>　　**AI综合评分**　<font color="warning">${Number(profile.analysis.scores?.overall || 0)} 分</font>`,
      ] : [`> **推荐岗位**　<font color="info">${recommendedPosition}</font>　　**综合匹配**　<font color="warning">${matchScore} 分</font>`]),
      `> ${experience}　|　${city}　|　${currentExperience}`,
      `**候选人速览**`,
      `- 核心优势：${strengths}`,
      `- 技能标签：${tags}`,
      `<font color="comment">选择“适合我的岗位”即可认领，每次认领都会通知所选岗位的招聘HR进行意向沟通。</font>`,
      `[进入简历评审 →](${reviewUrl})`,
      `<font color="comment">请在 ${expiresInDays} 天内完成判断；在线页支持“适合 / 不适合 / 其他意见”，可打印或保存为 PDF。请勿转发候选人信息。</font>`,
    ].join('\n\n')
  }

  private async createCommunicationLink(candidateId: string) {
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
    if (!candidate) throw new NotFoundException('候选人不存在')
    const token = randomBytes(32).toString('base64url'), timestamp = now(), expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
    await teable.createRecord(this.table('recruitment_public_links'), {
      链接ID: id('link'), 候选人ID: text(candidate.fields['候选人ID']) || candidateId, 链接类型: '意向沟通',
      访问Token哈希: tokenHash(token), Token前缀: token.slice(0, 8), 访问路径: `/communication?token=${encodeURIComponent(token)}`,
      链接状态: '有效', 过期时间: expiresAt, 创建人: '招聘流程自动通知', 创建时间: timestamp, 更新时间: timestamp,
    })
    const publicBase = text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')
    if (!publicBase) throw new ServiceUnavailableException('未配置应用公开地址，无法生成意向沟通链接')
    return `${publicBase}/communication?token=${encodeURIComponent(token)}`
  }

  private async notifyFlow(category: string, candidateId: string, group: 'business' | 'talent', markdown: string, objectId?: string, operator?: string) {
    return this.messages.notifyFlowEvent({ category, candidateId, objectId, group, markdown, operator }).catch((error) => {
      console.error(`[流程通知] ${category} 失败: ${error instanceof Error ? error.message : String(error)}`)
      return { status: '发送失败', error: error instanceof Error ? error.message : String(error) }
    })
  }

  private async notifyPositionHr(category: string, candidateId: string, markdown: string, objectId?: string, positionId?: string, applicationId?: string, operator?: string) {
    await this.messages.notifyPositionHr({ category, candidateId, objectId, positionId, applicationId, markdown, operator }).catch((error) => {
      console.error(`[流程私信] ${category} 失败: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private table(name: string) {
    return this.database.requireTableId(name)
  }

  async ingestResume(resume: ResumeTalentInput) {
    const candidateTable = this.table('recruitment_candidates')
    const candidates = await teable.listAllRecords(candidateTable)
    const duplicate = this.findStrongCandidate(candidates, resume)
    const suspicious = duplicate ? [] : this.findSuspiciousCandidates(candidates, resume)
    const candidateId = text(duplicate?.fields['候选人ID']) || id('tal')
    const timestamp = now()
    const birthYear = resume.age ? new Date().getUTCFullYear() - resume.age : 0
    const duplicateState = duplicate ? '已归入现有人才主档' : suspicious.length ? '疑似重复待处理' : '未发现重复'
    const previous = duplicate?.fields || {}
    const manualBirthYear = text(previous['出生年份确认状态']) === '人工已确认' && num(previous['出生年份'])
    const resolvedBirthYear = manualBirthYear ? num(previous['出生年份']) : birthYear || num(previous['出生年份'])
    const candidateFields = {
      候选人ID: candidateId,
      姓名: resume.name || text(previous['姓名']) || '未识别姓名',
      性别: ['男', '女'].includes(text(resume.gender)) ? text(resume.gender) : (['男', '女'].includes(text(previous['性别'])) ? text(previous['性别']) : ''),
      出生年份: resolvedBirthYear || undefined,
      年龄: resolvedBirthYear ? new Date().getUTCFullYear() - resolvedBirthYear : resume.age || num(previous['年龄']) || undefined,
      出生年份来源: manualBirthYear ? text(previous['出生年份来源']) || '人工修正' : birthYear ? '简历年龄换算' : text(previous['出生年份来源']),
      出生年份确认状态: manualBirthYear ? '人工已确认' : text(previous['出生年份确认状态']) || '待人工复核',
      出生年份冲突JSON: text(previous['出生年份冲突JSON']) || '',
      电话: resume.phone || text(previous['电话']),
      邮箱: resume.email || text(previous['邮箱']),
      微信: resume.wechat || text(previous['微信']),
      当前城市: resume.address || text(previous['当前城市']),
      工作年限: resume.yearsOfExperience || text(previous['工作年限']),
      期望职位: resume.jobIntention || text(previous['期望职位']),
      自我评价: resume.selfEvaluation || text(previous['自我评价']),
      技能JSON: JSON.stringify([...new Set([...json<string[]>(previous['技能JSON'], []), ...this.extractSkills(resume.skillsCertificates)])]),
      教育经历: resume.educationBackground || text(previous['教育经历']),
      工作经历: resume.workExperience || text(previous['工作经历']),
      当前公司: resume.currentCompany || text(previous['当前公司']),
      当前职位: resume.currentRole || text(previous['当前职位']),
      候选人状态: 'AI分析中',
      人才池: text(previous['人才池']) || '公司人才库',
      来源类型: text(resume.sourceType) || text(previous['来源类型']) || '简历解析',
      不推送企微群: resume.suppressGroupPush ? '是' : '否',
      创建人用户ID: text(previous['创建人用户ID']) || text(resume.importedById),
      创建人: text(previous['创建人']) || text(resume.importedBy) || '系统导入',
      来源记录ID: resume.id,
      最新简历记录ID: resume.id,
      当前简历文件名: resume.sourceFileName || text(previous['当前简历文件名']),
      当前简历地址: resume.sourceFileUrl || text(previous['当前简历地址']),
      头像地址: resume.avatarUrl || text(previous['头像地址']),
      头像提取状态: resume.avatarUrl ? '已提取' : text(previous['头像提取状态']) || '未发现可用头像',
      首次进入时间: text(duplicate?.fields['首次进入时间']) || timestamp,
      更新时间: timestamp,
      创建时间: text(duplicate?.fields['创建时间']) || timestamp,
      重复检查状态: duplicateState,
      疑似重复候选人JSON: JSON.stringify(suspicious.map((row) => text(row.fields['候选人ID']) || row.id)),
      合并状态: text(previous['合并状态']) || '独立档案',
    }
    if (duplicate) await teable.updateRecord(candidateTable, duplicate.id, candidateFields)
    else await teable.createRecord(candidateTable, candidateFields)
    if (!duplicate && suspicious.length) {
      for (const row of suspicious) await this.ensureDuplicateCase(candidateId, row)
    }

    const applicationId = await this.ensureApplication(candidateId, resume)
    await this.ensureInitialEvent(candidateId, applicationId, '')
    await teable.updateRecord(this.table('resume_extraction_records'), resume.id, {
      解析记录ID: resume.id, 候选人ID: candidateId, 应聘记录ID: applicationId, 解析状态: '已完成',
      来源类型: text(resume.sourceType) || '简历上传', 解析器版本: 'resumeflow-v1', 模型版本: 'platform-llm', 人工复核状态: '待复核', 更新时间: now(),
    })
    // 简历入库后自动加入 AI 分析队列（评分、岗位匹配、标签）
    this.invalidateDirectoryCache()
    if (!resume.deferAiAnalysis) this.enqueueAiAnalysis(candidateId, resume.id, '简历入库自动触发', '入库自动分析')
    return { candidateId, applicationId, duplicate: Boolean(duplicate), suspiciousDuplicateCount: suspicious.length, analysis: null, matches: [] }
  }

  async list(query: TalentDirectoryQuery, accessProfile?: RoleAccessProfile) {
    if (query.refresh === '1') this.invalidateDirectoryCache()
    // 人才目录首屏只读取摘要相关表；OCR 原文、附件、沟通、评审、企微反馈等重数据
    // 仅在 detail() 中按点击加载。这样人才数量增长时，列表不会随完整档案膨胀。
    const pageSize = Math.max(10, Math.min(100, Math.round(num(query.pageSize) || 25)))
    const page = Math.max(1, Math.round(num(query.page) || 1))
    const importerKeyword = text(query.importer)
    const referralCandidateIds = importerKeyword ? await this.importerReferralCandidateIds(importerKeyword) : []
    const hasRelationFilter = Boolean((query.job && query.job !== '全部岗位') || (query.tag && query.tag !== '全部标签') || query.minScore || (query.age && query.age !== '全部年龄') || (query.region && query.region !== '全部地区') || (query.score && query.score !== '全部评分'))
    const hasComplexFilter = Boolean(hasRelationFilter || query.status === '未入职')
    const serverFilter = this.directoryFilter(query, referralCandidateIds)
    const canScopePositions = accessProfile && typeof (this.recruitment as any).positionOptions === 'function'
    const [data, employeeRows, positionResult] = await Promise.all([
      hasComplexFilter
        ? this.cached(`talents-complex:${this.complexFilterCacheKey(query)}`, DIRECTORY_CACHE_TTL_MS, () => this.loadComplexDirectory(query, serverFilter))
        : this.cached(`talents-page:${page}:${pageSize}:${serverFilter || ''}`, DIRECTORY_CACHE_TTL_MS, () => this.loadDirectoryPage(page, pageSize, serverFilter)),
      this.cached('talents-employees', EMPLOYEE_CACHE_TTL_MS, () => teable.listAllRecords(this.table('recruitment_users'), { fields: TALENT_DIRECTORY_FIELDS.recruitment_users })).catch(() => []),
      canScopePositions ? this.recruitment.positionOptions(accessProfile) : { positions: [] },
    ])
    const index = this.directoryIndex(data)
    const keyword = text(query.q).toLowerCase()
    const minimum = num(query.minScore)
    const rangeMatches = (value: number, filter: unknown) => {
      const label = text(filter)
      if (!label || label.startsWith('全部')) return true
      const values = (label.match(/\d+/g) || []).map(Number)
      if (!values.length) return true
      return label.includes('以上') ? value >= values[0] : value >= values[0] && value <= (values[1] ?? values[0])
    }
    const canViewArchive = !accessProfile || !this.access || this.access.hasPage(accessProfile, 'candidates')
    const scoped = data.candidates
      .filter((row) => text(row.fields['合并状态']) !== '已合并' && text(row.fields['候选人状态']) !== '已删除')
      .map((row) => this.directoryProfile(row, index))
      .filter(() => canViewArchive)
    // 列表权限解锁记录按整页一次查询。此前逐人才读取授权表，737 位人才会多出数百次重复请求。
    const unlockCandidates = accessProfile && this.access
      ? scoped.filter(item => (['contacts', 'salary', 'resume'] as const).some(field => this.access!.sensitiveFieldPolicy?.(accessProfile, field, item._access) !== 'full'))
      : scoped
    const unlocksByCandidate = accessProfile && this.access && this.accessAdmin && unlockCandidates.length
      ? await this.accessAdmin.activeUnlockFieldsForCandidates(accessProfile.userId, unlockCandidates.map((item) => item.id))
      : new Map<string, string[]>()
    const keywordScoped = scoped.filter((item: any) => {
      if (!keyword) return true
      const haystack = String(item.name || '').toLowerCase()
      return haystack.includes(keyword)
    })
    const protectedItems = keywordScoped.map((item) => {
      if (!accessProfile || !this.access) return this.withoutAccessMetadata(item)
      return this.access.protectTalent(item, accessProfile, { ...item._access, unlockedFields: unlocksByCandidate.get(item.id) || [] })
    })
    const positionOptions = positionResult.positions
    const visiblePositionIds = canScopePositions ? new Set(positionOptions.map((item) => item.id)) : null
    const visiblePositionNames = canScopePositions ? new Set(positionOptions.map((item) => item.name)) : null
    const positionScopedItems = protectedItems.map((item: any) => {
      if (!visiblePositionIds || !visiblePositionNames) return item
      const matches = (item.matches || []).filter((match: any) => visiblePositionIds.has(match.positionId) || (!match.positionId && visiblePositionNames.has(match.positionName)))
      return { ...item, matches, bestMatchRole: matches[0]?.positionName || '', bestMatchScore: Number(matches[0]?.score || 0) }
    })
    const employeeByPhone = new Map(employeeRows.map((row) => [text(row.fields['手机']).replace(/\D/g, '').replace(/^86/, ''), text(row.fields['天玑人事状态'])]))
    const candidates = positionScopedItems.map((item: any) => {
      const directoryStatus = employeeByPhone.get(text(item.phone).replace(/\D/g, '').replace(/^86/, '')) || ''
      const employmentStatus = ['在职', '离职'].includes(item.employmentStatus) ? item.employmentStatus : ['在职', '离职'].includes(directoryStatus) ? directoryStatus : '未入职'
      return { ...item, employmentStatus }
    }).filter((item: any) => {
      return (!query.job || query.job === '全部岗位' || item.matches.some((match: any) => match.positionName === query.job))
        && (!query.status || query.status === '全部状态' || (['在职', '离职', '未入职'].includes(query.status) ? item.employmentStatus === query.status : item.status === query.status))
        && (!query.source || query.source === '全部来源' || item.source === query.source)
        && (!query.tag || query.tag === '全部标签' || item.tags.some((tag: any) => tag.name === query.tag))
        && (!minimum || item.bestMatchScore >= minimum)
        && rangeMatches(Number(item.age || 0), query.age)
        && (!query.region || query.region === '全部地区' || item.address === query.region)
        && rangeMatches(Number(item.bestMatchScore || 0), query.score)
    })
    candidates.sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))
    // total 必须与当前权限下实际可见的数据一致；否则无人才档案权限的角色仍会看到“总数”。
    const total = canViewArchive ? (hasComplexFilter ? candidates.length : (data.total || candidates.length)) : 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize)), safePage = Math.min(totalPages, page)
    const start = hasComplexFilter ? (safePage - 1) * pageSize : 0
    const pageItems = candidates.slice(start, start + pageSize)
    const talents = hasComplexFilter ? await this.hydrateComplexDirectoryPage(data, pageItems) : pageItems
    return { talents, total, page: safePage, pageSize, totalPages, jobMap: this.jobMap(candidates), overview: this.overview(candidates) }
  }

  /**
   * 一次性把已从历史简历提取出来的头像地址写回人才主档。
   * 不重新解析文件、不读取或修改 OCR 内容，也不在人才列表 GET 请求里做写入，
   * 这样历史数据补齐后仍可维持万人规模目录的首屏性能。
   */
  async backfillStoredAvatars(progress: (message: string) => void = () => undefined) {
    const [candidates, resumes] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates'), { fields: ['候选人ID', '头像地址', '最新简历记录ID'] }),
      teable.listAllRecords(this.table('resume_extraction_records'), { fields: ['候选人ID', '解析记录ID', '头像地址', '头像提取状态', '更新时间', '创建时间'] }),
    ])
    const byResumeId = new Map<string, TeableRecord>()
    const latestWithAvatarByCandidate = new Map<string, TeableRecord>()
    for (const resume of resumes) {
      byResumeId.set(resume.id, resume)
      const resumeId = text(resume.fields['解析记录ID'])
      if (resumeId) byResumeId.set(resumeId, resume)
      const candidateId = text(resume.fields['候选人ID'])
      const avatarUrl = text(resume.fields['头像地址'])
      if (!candidateId || !avatarUrl) continue
      const current = latestWithAvatarByCandidate.get(candidateId)
      const rank = text(resume.fields['更新时间']) || text(resume.fields['创建时间']) || resume.createdTime || ''
      const currentRank = current ? text(current.fields['更新时间']) || text(current.fields['创建时间']) || current.createdTime || '' : ''
      if (!current || rank > currentRank) latestWithAvatarByCandidate.set(candidateId, resume)
    }
    const result = { total: candidates.length, alreadyPresent: 0, synced: 0, noStoredAvatar: 0, failed: 0 }
    progress(`正在核对历史简历头像（0/${candidates.length}）`)
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      if (text(candidate.fields['头像地址'])) { result.alreadyPresent += 1; continue }
      const candidateId = text(candidate.fields['候选人ID']) || candidate.id
      const latestResumeId = text(candidate.fields['最新简历记录ID'])
      const resume = byResumeId.get(latestResumeId) || latestWithAvatarByCandidate.get(candidateId)
      const avatarUrl = text(resume?.fields['头像地址'])
      if (!avatarUrl) { result.noStoredAvatar += 1; continue }
      try {
        await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, {
          头像地址: avatarUrl,
          头像提取状态: text(resume?.fields['头像提取状态']) || '已提取',
          更新时间: now(),
        })
        result.synced += 1
      } catch {
        result.failed += 1
      }
      if ((index + 1) % 25 === 0 || index + 1 === candidates.length) progress(`正在同步历史头像（${index + 1}/${candidates.length}）`)
    }
    progress(`历史头像同步完成：已补齐 ${result.synced} 位人才`)
    return result
  }

  async detail(candidateId: string, accessProfile?: RoleAccessProfile) {
    const tables = [...Object.keys(TALENT_DIRECTORY_FIELDS), 'recruitment_stage_events', 'recruitment_communications', 'recruitment_candidate_reviews', 'recruitment_assessment_invites', 'recruitment_assessment_reviews', 'recruitment_interview_feedback', 'recruitment_offers', 'recruitment_background_checks', 'recruitment_onboarding_cases', 'recruitment_probation_reviews', 'recruitment_offboarding_cases', 'recruitment_followups', 'recruitment_talent_review_shares', 'recruitment_talent_review_responses']
    const data = await this.detailCache.get(candidateId, 30_000, tables.map(name => this.table(name)), () => this.loadAll(candidateId))
    const row = data.candidates.find((item) => text(item.fields['候选人ID']) === candidateId || item.id === candidateId)
    if (!row) throw new NotFoundException('人才档案不存在')
    const result = this.profile(row, data, true)
    if (accessProfile && this.access) {
      if (!this.access.hasPage(accessProfile, 'candidates')) throw new ForbiddenException('当前账号没有人才档案菜单权限')
      const unlockedFields = this.accessAdmin ? await this.accessAdmin.activeUnlockFields(accessProfile.userId, result.id) : []
      return this.access.protectTalent(result, accessProfile, { ...result._access, unlockedFields })
    }
    return this.withoutAccessMetadata(result)
  }

  async advance(candidateId: string, body: { stage: string; reason?: string; operator?: string }) {
    const start = Date.now()
    const candidate = await this.findCandidateRow(candidateId)
    const applicationsTable = this.table('recruitment_applications')
    const applications = await teable.listByField(applicationsTable, '候选人ID', candidateId, 100)
    let application = applications.find((row) => text(row.fields['当前状态']) !== '已结束')
    if (!application) {
      application = await teable.createRecord(applicationsTable, {
        应聘记录ID: id('app'), 候选人ID: candidateId, 当前阶段: '待业务群评审', 当前状态: '进行中',
        来源类型: '人才库', 创建时间: now(), 更新时间: now(), 最近处理时间: now(),
      })
    }
    const oldStage = mapLegacyStage(text(application.fields['当前阶段'])) || '待业务群评审'
    const stage = text(body.stage)
    if (!stage) throw new Error('请选择目标阶段')
    await teable.updateRecord(applicationsTable, application.id, { 当前阶段: stage, 最近处理时间: now(), 更新时间: now() })
    await teable.createRecord(this.table('recruitment_stage_events'), {
      事件ID: id('evt'), 应聘记录ID: text(application.fields['应聘记录ID']), 候选人ID: candidateId,
      职位ID: text(application.fields['职位ID']), 原阶段: oldStage, 新阶段: stage, 操作: '推进流程', 结果: '成功',
      原因: text(body.reason), 操作人: text(body.operator) || '当前用户', 发生时间: now(), 来源类型: '人工操作',
    })
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 候选人状态: stage, 更新时间: now() })
    this.invalidateDirectoryCache()
    this.logSlow('advance', start)
    return { candidateId, stage, oldStage, applicationId: text(application.fields['应聘记录ID']) || application.id, updatedAt: now() }
  }

  async archiveTalent(candidateId: string, input: TalentArchiveDeleteInput) {
    const start = Date.now()
    if (input.decision !== '删除') throw new BadRequestException('请确认删除人才档案')
    if (!text(input.reason)) throw new BadRequestException('删除人才档案必须填写原因')
    const candidate = await this.findCandidateRow(candidateId)
    if (text(candidate.fields['合并状态']) === '已合并') throw new BadRequestException('已合并副档不能单独删除')
    const timestamp = now(), operator = text(input.operator) || '当前用户'
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, {
      候选人状态: '已删除', 人才池: '已删除', 更新时间: timestamp,
    })
    await this.talentAudit('删除人才档案', '人才', candidateId, candidate.fields, { deleted: true, reason: input.reason }, operator, input.reason)
    this.invalidateDirectoryCache()
    this.logSlow('archiveTalent', start)
    return { candidateId, deleted: true, operator, updatedAt: timestamp }
  }

  async confirmAssessment(candidateId: string, body: { result: string; note?: string; operator?: string }) {
    const start = Date.now()
    const table = this.table('recruitment_ai_assessments')
    const rows = await teable.listAllRecords(table)
    const assessment = rows.filter((row) => text(row.fields['候选人ID']) === candidateId)
      .sort((a, b) => (num(b.fields['版本号']) || 1) - (num(a.fields['版本号']) || 1) || text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0]
    if (!assessment) throw new NotFoundException('该人才暂无AI分析结果')
    await teable.updateRecord(table, assessment.id, {
      人工确认状态: text(body.result) || '已确认', 人工修正内容: text(body.note), 确认人: text(body.operator) || '当前用户', 确认时间: now(), 更新时间: now(),
    })
    this.invalidateDirectoryCache()
    this.logSlow('confirmAssessment', start)
    return { candidateId, assessmentId: text(assessment.fields['分析记录ID']) || assessment.id, reviewStatus: text(body.result) || '已确认', operator: text(body.operator) || '当前用户', updatedAt: now() }
  }

  async shareForWecomReview(candidateId: string, input: TalentWecomShareInput) {
    const previous = this.reviewShareLocks.get(candidateId) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.reviewShareLocks.set(candidateId, queued)
    await previous
    try {
      return await this.shareForWecomReviewUnlocked(candidateId, input)
    } finally {
      release()
      if (this.reviewShareLocks.get(candidateId) === queued) this.reviewShareLocks.delete(candidateId)
    }
  }

  private async shareForWecomReviewUnlocked(candidateId: string, input: TalentWecomShareInput) {
    const profile = await this.detail(candidateId)
    if (!profile.analysis?.id) throw new BadRequestException('请先在人才档案生成评分、岗位匹配和标签，再推送企微评审')
    const automaticOperators = new Set(['AI评分自动推送', '每日自动推送', '批量导入'])
    const sendMessage = input.sendMessage !== false && !automaticOperators.has(text(input.operator))
    const sendMode = input.sendMode === 'direct' || input.sendMode === 'both' ? input.sendMode : 'group'
    const sendGroup = sendMode === 'group' || sendMode === 'both'
    const sendDirect = sendMode === 'direct' || sendMode === 'both'
    const directUserIds = [...new Set((Array.isArray(input.directUserIds) ? input.directUserIds : [input.directUserIds]).map(text).filter(Boolean))]
    const webhookKey = text(input.webhookKey) || text(process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY)
    const publicBase = text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')
    if (sendMessage && sendDirect && !directUserIds.length) throw new BadRequestException('请选择单独提醒的接收人')
    if (sendMessage && sendDirect && typeof this.messages?.notifyDirectUsers !== 'function') throw new ServiceUnavailableException('企微私信发送服务不可用，请稍后重试')
    if (sendMessage && sendGroup && !webhookKey) throw new ServiceUnavailableException('未配置企微人才评审群机器人，请在 .env.local 配置 WECOM_TALENT_REVIEW_WEBHOOK_KEY')
    if (!publicBase) throw new ServiceUnavailableException('未配置应用公开地址，请在 .env.local 配置 APP_PUBLIC_URL')

    const sharesTable = this.table('recruitment_talent_review_shares')
    const expiresInDays = Math.max(1, Math.min(30, Math.round(num(input.expiresInDays) || 7)))
    const timestamp = now()
    const application = (profile.applications || []).find((item: any) => text(item['应聘记录ID']) === text(input.applicationId)) || profile.applications?.[0] || {}
    const applicationId = text(input.applicationId) || text(application['应聘记录ID'])
    const assessmentId = text(input.assessmentId) || text(profile.analysis.id)
    const sourceType = [text(profile.source), text(application['来源类型'])].find((source) => source.includes('内推')) || text(profile.source) || text(application['来源类型'])
    const selectedPositionName = text(application.positionName) || text(application['职位名称'])

    // 同一个应聘记录、同一个AI分析版本只维护一条评审链接；人才重新投递时必须创建新的评审批次。
    const existingShares = await teable.listAllRecords(sharesTable)
    const activeShare = existingShares.find((row) =>
      text(row.fields['候选人ID']) === candidateId &&
      (!applicationId || text(row.fields['应聘记录ID']) === applicationId) &&
      (!assessmentId || text(row.fields['分析记录ID']) === assessmentId) &&
      (['发送中', '评审中'].includes(text(row.fields['分享状态'])) || (sendMessage && input.forceSend && text(row.fields['分享状态']) === '发送失败')) &&
      Date.parse(text(row.fields['过期时间'])) > Date.now()
    )

    if (activeShare) {
      // 复用已有链接，重新推送到当前选择的企微渠道
      const existingReviewUrl = text(activeShare.fields['评审链接'])
      const existingShareId = text(activeShare.fields['分享批次ID']) || activeShare.id
      const existingExpiresAt = text(activeShare.fields['过期时间'])
      if (!sendMessage || !input.forceSend) return { shareId: existingShareId, status: text(activeShare.fields['分享状态']), sent: false, reviewUrl: existingReviewUrl, expiresAt: existingExpiresAt, needsNotification: false, message: '已复用现有评审链接，本次未发送企微群消息' }

      const markdown = this.reviewMarkdown(profile, existingReviewUrl, expiresInDays, application)

      try {
        const delivered = await this.deliverReviewMessage({ markdown, sendMode, webhookKey, directUserIds, candidateId, shareId: existingShareId, operator: text(input.operator), operatorUserId: text(input.operatorUserId) })
        const sentAt = now()
        await teable.updateRecord(sharesTable, activeShare.id, { 分享状态: '评审中', 企微消息ID: delivered.externalId, 发送错误: delivered.partialError || '', 发送时间: sentAt, 更新时间: sentAt })
        return { shareId: existingShareId, status: '评审中', sent: true, partial: Boolean(delivered.partialError), sentAt, reviewUrl: existingReviewUrl, expiresAt: existingExpiresAt, message: delivered.message }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await teable.updateRecord(sharesTable, activeShare.id, { 分享状态: '发送失败', 发送错误: message, 更新时间: now() })
        throw new ServiceUnavailableException(`企微评审推送失败：${message}`)
      }
    }

    // 没有未过期的链接，创建新链接
    const shareId = id('talshare')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
    const reviewUrl = `${publicBase}/talent-review?token=${encodeURIComponent(token)}`
    const bestMatch = profile.matches?.[0]
    const snapshot = {
      name: this.reviewCandidateName(profile), gender: profile.gender, age: profile.age, yearsOfExperience: profile.yearsOfExperience,
      sourceType, selectedPositionId: text(application['职位ID']), selectedPositionName,
      city: profile.address, currentCompany: profile.currentCompany, currentRole: profile.currentRole, jobIntention: profile.jobIntention,
      phone: maskPhone(profile.phone || ''), email: maskEmail(profile.email || ''),
      educationBackground: profile.educationBackground, workExperience: profile.workExperience,
      selfEvaluation: profile.selfEvaluation, skills: profile.skills || [], tags: profile.tags || [],
      sourceFileName: profile.sourceFileName, sourceFileUrl: profile.sourceFileUrl || '', avatarUrl: profile.avatarUrl || '',
      analysis: profile.analysis, matches: profile.matches || [], createdAt: timestamp,
    }
    const shareRecord = await teable.createRecord(sharesTable, {
      分享批次ID: shareId, 候选人ID: candidateId, 应聘记录ID: applicationId, 分析记录ID: assessmentId,
      推荐职位ID: text(bestMatch?.positionId), 推荐职位名称: text(bestMatch?.positionName), 访问Token哈希: tokenHash(token), Token前缀: token.slice(0, 8),
      评审链接: reviewUrl, 人才快照JSON: JSON.stringify(snapshot), 分享状态: sendMessage ? '发送中' : '评审中', 反馈数: 0,
      创建人用户ID: text(input.operatorUserId), 创建人: text(input.operator) || '当前用户', 过期时间: expiresAt, 创建时间: timestamp, 更新时间: timestamp,
    })

    const markdown = this.reviewMarkdown(profile, reviewUrl, expiresInDays, application)

    if (!sendMessage) return { shareId, status: '评审中', sent: false, reviewUrl, expiresAt, needsNotification: true, markdown, message: '已创建评审链接，等待自动通知发送' }

    try {
      const delivered = await this.deliverReviewMessage({ markdown, sendMode, webhookKey, directUserIds, candidateId, shareId, operator: text(input.operator), operatorUserId: text(input.operatorUserId) })
      const sentAt = now()
      await teable.updateRecord(sharesTable, shareRecord.id, { 分享状态: '评审中', 企微消息ID: delivered.externalId, 发送错误: delivered.partialError || '', 发送时间: sentAt, 更新时间: sentAt })
      return { shareId, status: '评审中', sent: true, partial: Boolean(delivered.partialError), sentAt, reviewUrl, expiresAt, message: delivered.message }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await teable.updateRecord(sharesTable, shareRecord.id, { 分享状态: '发送失败', 发送错误: message, 更新时间: now() })
        throw new ServiceUnavailableException(`企微评审推送失败：${message}`)
    }
  }

  private async deliverReviewMessage(input: { markdown: string; sendMode: 'group' | 'direct' | 'both'; webhookKey: string; directUserIds: string[]; candidateId: string; shareId: string; operator?: string; operatorUserId?: string }) {
    const sendGroup = input.sendMode === 'group' || input.sendMode === 'both'
    const sendDirect = input.sendMode === 'direct' || input.sendMode === 'both'
    const delivered: { externalId: string; message: string }[] = []
    const failed: string[] = []
    if (sendDirect) {
      try {
        const result = await this.messages.notifyDirectUsers({
          category: '优质简历', candidateId: input.candidateId, objectType: '人才评审', objectId: input.shareId,
          userIds: input.directUserIds, markdown: input.markdown, operator: input.operator, operatorUserId: input.operatorUserId, force: true,
        })
        if (['已发送', '已跳过', '部分发送'].includes(text(result?.status))) {
          const externalId = (result.results || []).map((item: any) => text(item?.messageId)).filter(Boolean).join(',')
          delivered.push({ externalId, message: text(result?.status) === '已跳过' ? '接收人此前已收到企微私信' : `已发送企微私信，等待${input.directUserIds.length}位接收人反馈` })
          if (text(result?.status) === '部分发送') failed.push(`企微私信部分失败：${text(result?.reason) || '部分接收人未送达'}`)
        } else failed.push(`企微私信发送失败：${text(result?.reason) || '未收到成功回执'}`)
      } catch (error) {
        failed.push(`企微私信发送失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (sendGroup) {
      try {
        const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(input.webhookKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'markdown', markdown: { content: input.markdown } }),
        })
        const result = await response.json().catch(() => ({} as any))
        if (!response.ok || result?.errcode !== 0) throw new Error(text(result?.errmsg) || `未收到企微成功回执（HTTP ${response.status}）`)
        delivered.push({ externalId: text(result?.msgid), message: '已推送企微群，等待业务部门反馈' })
      } catch (error) {
        failed.push(`企微群推送失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (!delivered.length) throw new Error(failed.join('；'))
    return {
      externalId: delivered.map((item) => item.externalId).filter(Boolean).join(','),
      message: delivered.map((item) => item.message).join('；'),
      partialError: failed.join('；'),
    }
  }

  async publicReviewDetail(token: string, viewer?: TalentReviewViewer) {
    const share = await this.findReviewShare(token)
    const snapshot = await this.refreshReviewSnapshot(share)
    const [positions, organizations, responses] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_positions')),
      teable.listAllRecords(this.table('recruitment_organization_units')),
      teable.listAllRecords(this.table('recruitment_talent_review_responses')),
    ])
    const availablePositions = positions
      .filter((row) => !['已下线', '关闭'].includes(text(row.fields['发布状态'])))
      .map((row) => ({ id: text(row.fields['职位ID']) || row.id, name: text(row.fields['职位名称']), departmentId: text(row.fields['部门ID']), department: text(row.fields['部门']) }))
    const shareResponses = responses.filter((row) => text(row.fields['分享批次ID']) === (text(share.fields['分享批次ID']) || share.id))
    const latestResponse = shareResponses.sort((a, b) => text(b.fields['提交时间']).localeCompare(text(a.fields['提交时间'])))[0]
    return {
      shareId: text(share.fields['分享批次ID']) || share.id, status: text(share.fields['分享状态']), expiresAt: text(share.fields['过期时间']),
      claimed: Boolean(text(share.fields['认领反馈ID'])), claimedDepartment: text(share.fields['认领部门']), claimedPosition: text(share.fields['认领职位']),
      candidate: snapshot,
      viewer: viewer ? { userId: viewer.userId, name: viewer.name, departments: viewer.departments } : undefined,
      departments: organizations.filter((row) => !viewer || !viewer.departmentIds.length || viewer.departmentIds.includes(text(row.fields['组织单元ID']))).map((row) => ({ id: text(row.fields['组织单元ID']) || row.id, name: text(row.fields['组织名称']) })),
      positions: availablePositions,
      responseCount: shareResponses.length,
      reviewed: Boolean(latestResponse || text(share.fields['认领反馈ID'])),
      review: latestResponse ? {
        decision: text(latestResponse.fields['反馈结论']), department: text(latestResponse.fields['部门']), position: text(latestResponse.fields['职位']),
        reviewer: text(latestResponse.fields['评审人']), submittedAt: text(latestResponse.fields['提交时间']),
      } : undefined,
    }
  }

  private async refreshReviewSnapshot(share: TeableRecord) {
    const snapshot = json<any>(share.fields['人才快照JSON'], {})
    const candidateId = text(share.fields['候选人ID'])
    if (!candidateId) return snapshot

    const candidatesTable = this.table('recruitment_candidates')
    const candidates = await teable.listByField(candidatesTable, '候选人ID', candidateId, 1)
    const candidate = candidates[0]
    if (!candidate) return snapshot

    const resumesTable = this.table('resume_extraction_records')
    let resume: TeableRecord | undefined
    const latestResumeId = text(candidate.fields['最新简历记录ID'])
    if (latestResumeId) {
      try { resume = await teable.getRecord(resumesTable, latestResumeId) } catch {}
    }
    if (!resume || text(resume.fields['候选人ID']) !== candidateId) {
      resume = (await teable.listByField(resumesTable, '候选人ID', candidateId, 1))[0]
    }

    const refreshed = {
      ...snapshot,
      name: text(candidate.fields['姓名']) || snapshot.name,
      gender: safeGender(candidate.fields['性别']) || snapshot.gender,
      age: num(candidate.fields['年龄']) || snapshot.age,
      yearsOfExperience: text(candidate.fields['工作年限']) || snapshot.yearsOfExperience,
      city: text(candidate.fields['当前城市']) || snapshot.city,
      currentCompany: text(candidate.fields['当前公司']) || snapshot.currentCompany,
      currentRole: text(candidate.fields['当前职位']) || snapshot.currentRole,
      jobIntention: text(candidate.fields['期望职位']) || snapshot.jobIntention,
      phone: maskPhone(text(candidate.fields['电话'] || snapshot.phone)),
      email: maskEmail(text(candidate.fields['邮箱'] || snapshot.email)),
      educationBackground: text(candidate.fields['教育经历']) || text(resume?.fields['教育背景']) || snapshot.educationBackground,
      workExperience: text(candidate.fields['工作经历']) || text(resume?.fields['工作经历']) || snapshot.workExperience,
      selfEvaluation: text(candidate.fields['自我评价']) || text(resume?.fields['自我评价']) || snapshot.selfEvaluation,
      sourceFileName: text(candidate.fields['当前简历文件名']) || text(resume?.fields['源文件名']) || snapshot.sourceFileName,
      sourceFileUrl: text(candidate.fields['当前简历地址']) || text(resume?.fields['源文件地址']) || snapshot.sourceFileUrl,
      avatarUrl: text(candidate.fields['头像地址']) || snapshot.avatarUrl,
    }
    if (JSON.stringify(refreshed) === JSON.stringify(snapshot)) return snapshot

    await teable.updateRecord(this.table('recruitment_talent_review_shares'), share.id, {
      人才快照JSON: JSON.stringify(refreshed), 更新时间: now(),
    })
    return refreshed
  }

  async submitPublicReview(token: string, input: TalentPublicReviewInput, viewer?: TalentReviewViewer) {
    const start = Date.now()
    const decision = text(input.decision)
    if (!['适合', '不适合', '其他'].includes(decision)) throw new BadRequestException('请选择有效的评审结论')
    const reviewer = viewer?.name || text(input.reviewer)
    const reviewerUserId = viewer?.userId || text(input.reviewerUserId)
    if (!reviewer) throw new BadRequestException('登录身份缺少姓名，请联系管理员完善员工资料')
    if (decision === '适合' && !text(input.positionId) && !text(input.position)) throw new BadRequestException('选择适合时必须选择岗位')

    const share = await this.findReviewShare(token)
    const shareId = text(share.fields['分享批次ID']) || share.id
    const previous = this.reviewSubmitLocks.get(shareId) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.reviewSubmitLocks.set(shareId, queued)
    await previous
    try {
    const candidateId = text(share.fields['候选人ID'])
    const positions = await teable.listAllRecords(this.table('recruitment_positions'))
    const position = positions.find((row) => text(row.fields['职位ID']) === text(input.positionId) || row.id === text(input.positionId))
    if (decision === '适合' && (!position || ['已下线', '关闭'].includes(text(position.fields['发布状态'])))) throw new BadRequestException('请选择有效的认领岗位')
    const positionId = text(position?.fields['职位ID']) || text(input.positionId)
    const positionName = text(position?.fields['职位名称']) || text(input.position)
    const departmentId = text(position?.fields['部门ID']) || viewer?.departmentIds[0] || text(input.departmentId)
    const department = text(position?.fields['部门']) || viewer?.departments[0] || text(input.department)
    const responsesTable = this.table('recruitment_talent_review_responses')
    if ((await teable.listByField(responsesTable, '分享批次ID', shareId, 1)).length) throw new ConflictException('本次简历已完成评审，其他人员仅可查看')
    const responseId = id('talresponse')
    const timestamp = now()
    let processing = decision === '适合' ? '已认领待HR跟进' : '已记录'
    let taskId = ''
    let applicationId = text(share.fields['应聘记录ID'])

    if (decision === '适合' && !text(share.fields['认领反馈ID'])) {
      processing = '已认领并进入意向沟通'
      const applicationsTable = this.table('recruitment_applications')
      const applications = await teable.listAllRecords(applicationsTable)
      let application = applications.find((row) => text(row.fields['应聘记录ID']) === applicationId || (text(row.fields['候选人ID']) === candidateId && text(row.fields['当前状态']) !== '已结束'))
      if (!application) application = await teable.createRecord(applicationsTable, { 应聘记录ID: id('app'), 候选人ID: candidateId, 当前阶段: '待约面', 当前状态: '进行中', 来源类型: '企微部门认领', 创建时间: timestamp, 更新时间: timestamp })
      applicationId = text(application.fields['应聘记录ID']) || application.id
      const oldStage = mapLegacyStage(text(application.fields['当前阶段'])) || '待业务群评审'
      await teable.updateRecord(applicationsTable, application.id, {
        职位ID: positionId, 需求ID: text(position?.fields['需求ID']), 负责人用户ID: reviewerUserId, 负责人: reviewer,
        当前阶段: '意向沟通', 当前状态: '进行中', 人工复核结果: '业务部门确认适合', 最近处理时间: timestamp, 更新时间: timestamp,
      })
      const candidate = await this.findCandidateRow(candidateId)
      await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 候选人状态: '意向沟通', 负责人用户ID: reviewerUserId, 负责人: reviewer, 更新时间: timestamp })
      await teable.createRecord(this.table('recruitment_stage_events'), {
        事件ID: id('evt'), 应聘记录ID: applicationId, 候选人ID: candidateId, 职位ID: positionId, 原阶段: oldStage, 新阶段: '意向沟通',
        操作: '企微业务部门认领', 结果: '成功', 原因: `${department || '业务部门'} ${reviewer}确认适合${input.comment ? `：${text(input.comment)}` : ''}`,
        操作人用户ID: reviewerUserId, 操作人: reviewer, 发生时间: timestamp, 来源类型: '企微人才评审', 来源记录ID: responseId,
      })
      taskId = id('task')
      await teable.createRecord(this.table('recruitment_tasks'), {
        待办ID: taskId, 待办类型: '意向沟通', 对象类型: '应聘记录', 对象ID: applicationId, 标题: `联系${json<any>(share.fields['人才快照JSON'], {}).name || '候选人'}进行意向沟通`,
        描述: `${department || '业务部门'}已通过企微认领，岗位：${positionName || '待确认'}。请先完成意向沟通，再协调面试时间和面试官。`,
        处理人用户ID: reviewerUserId, 处理人: reviewer, 部门ID: departmentId, 优先级: '高', 待办状态: '待处理',
        截止时间: new Date(Date.now() + 2 * 86_400_000).toISOString(), 创建时间: timestamp, 更新时间: timestamp,
      })
      await teable.updateRecord(this.table('recruitment_talent_review_shares'), share.id, {
        分享状态: '已认领', 认领反馈ID: responseId, 认领部门ID: departmentId, 认领部门: department, 认领职位ID: positionId, 认领职位: positionName, 更新时间: timestamp,
      })
    }

    await teable.createRecord(responsesTable, {
      反馈ID: responseId, 分享批次ID: shareId, 候选人ID: candidateId, 反馈结论: decision, 部门ID: departmentId, 部门: department,
      职位ID: positionId, 职位: positionName, 评审人用户ID: reviewerUserId, 评审人: reviewer, 评审意见: text(input.comment),
      处理结果: processing, 应聘记录ID: applicationId, 面试待办ID: taskId, 提交时间: timestamp, 创建时间: timestamp, 更新时间: timestamp,
    })
    const responses = await teable.listAllRecords(responsesTable)
    await teable.updateRecord(this.table('recruitment_talent_review_shares'), share.id, { 反馈数: responses.filter((row) => text(row.fields['分享批次ID']) === shareId).length, 更新时间: now() })
    let notification: { status: string; reason?: string } | undefined
    if (decision === '适合') {
      try {
        const communicationUrl = await this.createCommunicationLink(candidateId)
        notification = await this.messages.notifyPositionHr({
          category: '业务群评审确认', candidateId, positionId, applicationId, objectId: responseId,
          operator: reviewer, operatorUserId: reviewerUserId,
          markdown: `## 【待意向沟通】${wecomInline(json<any>(share.fields['人才快照JSON'], {}).name, '候选人', 20)}\n> ${wecomInline(reviewer)}认领了${wecomInline(department)} · ${wecomInline(positionName)}，请跟进意向沟通。\n[打开意向沟通表单 →](${communicationUrl})\n<font color="comment">请结合人才档案中的当前进度跟进，避免重复联系。</font>`,
        })
      } catch (error) {
        notification = { status: '发送失败', reason: error instanceof Error ? error.message : String(error) }
        console.error(`[认领通知] ${responseId}: ${notification.reason}`)
      }
    }
    this.invalidateDirectoryCache()
    this.logSlow('submitPublicReview', start)
    return { responseId, decision, processing, claimed: decision === '适合', candidateId, applicationId, taskId, notification }
    } finally {
      release()
      if (this.reviewSubmitLocks.get(shareId) === queued) this.reviewSubmitLocks.delete(shareId)
    }
  }

  async pushFlowWecom(candidateId: string, input: { step: string; operator?: string; operatorUserId?: string }) {
    const steps = ['communication', 'interview', 'interview_question', 'interview_evaluation', 'offer', 'onboarding', 'onboarding_evaluation']
    const step = steps.includes(text(input.step)) ? text(input.step) : ''
    if (!step) throw new BadRequestException('请选择有效的企微推送流程')
    const candidate = await this.findCandidateRow(candidateId)
    const [applications, interviews, offers, onboardings, probationReviews] = await Promise.all([
      teable.listByField(this.table('recruitment_applications'), '候选人ID', candidateId, 200),
      teable.listByField(this.table('recruitment_interviews'), '候选人ID', candidateId, 200),
      teable.listByField(this.table('recruitment_offers'), '候选人ID', candidateId, 200),
      teable.listByField(this.table('recruitment_onboarding_cases'), '候选人ID', candidateId, 200),
      teable.listByField(this.table('recruitment_probation_reviews'), '候选人ID', candidateId, 200),
    ])
    const application = applications.filter((row) => text(row.fields['当前状态']) !== '已结束').sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const interview = interviews.sort((a, b) => text(b.fields['开始时间']).localeCompare(text(a.fields['开始时间'])))[0]
    const offer = offers.sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const onboarding = onboardings.sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const onboardingReview = probationReviews.filter((row) => !onboarding || text(row.fields['入职单ID']) === (text(onboarding.fields['入职单ID']) || onboarding.id)).sort((a, b) => text(b.fields['计划日期']).localeCompare(text(a.fields['计划日期'])))[0]
    const name = this.candidateName(candidate)
    const applicationId = text(application?.fields['应聘记录ID']) || application?.id || ''
    const positionId = text(application?.fields['职位ID']) || text(interview?.fields['职位ID']) || text(offer?.fields['职位ID']) || text(onboarding?.fields['职位ID']) || ''
    const common = { candidateId, positionId, applicationId, operator: text(input.operator) || '当前用户', operatorUserId: text(input.operatorUserId), force: true }
    const requireInterview = (label: string) => {
      if (!interview) throw new ConflictException(`请先完成约面，再推送${label}`)
      return text(interview.fields['面试ID']) || interview.id
    }
    const hrPush = async (category: string, objectId: string, markdown: string) => this.messages.notifyPositionHr({ ...common, category, objectId, markdown })
    const interviewerPush = async (category: string, objectId: string, objectType: string, markdown: string) => {
      const interviewId = requireInterview(category)
      const userIds = json<string[]>(interview!.fields['面试官用户IDJSON'], [])
      if (!userIds.length) throw new ConflictException('本次面试没有可通知的面试官')
      return this.messages.notifyDirectUsers({ ...common, category, objectId, objectType, userIds, markdown })
    }
    if (step === 'communication') {
      const url = await this.createCommunicationLink(candidateId)
      return { step, result: await hrPush('手动推送-意向沟通', applicationId, `## 【待意向沟通】${wecomInline(name, '候选人', 20)}\n> 请跟进意向沟通并记录结果。\n[打开意向沟通表单 →](${url})`) }
    }
    if (step === 'interview') {
      const url = interviewScheduleUrl(candidateId, interview ? text(interview.fields['面试ID']) || interview.id : undefined)
      return { step, result: await hrPush('手动推送-约面', interview ? text(interview.fields['面试ID']) || interview.id : applicationId, `## 【待约面】${wecomInline(name, '候选人', 20)}\n> 请确认面试时间、面试官和会议室。\n[打开约面工作台 →](${url})`) }
    }
    if (step === 'interview_question') {
      const interviewId = requireInterview('面试题')
      return { step, result: await interviewerPush('手动推送-面试题', interviewId, '面试题', `## 【面试题】${wecomInline(name, '候选人', 20)}\n> 请查看本次结构化面试题，并在面试中记录回答。\n[打开完整面试题 →](${interviewQuestionsUrl(interviewId)})`) }
    }
    if (step === 'interview_evaluation') {
      const interviewId = requireInterview('面试评价')
      return { step, result: await interviewerPush('手动推送-面试评价', interviewId, '面试评价', `## 【面试评价】${wecomInline(name, '候选人', 20)}\n> 请记录面试过程并提交独立评价。\n[打开面试评价 →](${appFlowUrl('evaluation', { candidate_id: candidateId, interview_id: interviewId })})`) }
    }
    if (step === 'offer') {
      const url = appFlowUrl('offer', { candidate_id: candidateId, interview_id: interview ? text(interview.fields['面试ID']) || interview.id : undefined, position_id: positionId, application_id: applicationId })
      return { step, result: await hrPush('手动推送-发Offer', text(offer?.fields['OfferID']) || offer?.id || applicationId, `## 【待填写Offer】${wecomInline(name, '候选人', 20)}\n> ${offer ? `当前状态：${text(offer.fields['Offer状态']) || '处理中'}` : '请根据面试评价创建Offer'}。\n[填写或查看Offer →](${url})`) }
    }
    if (step === 'onboarding') {
      const url = appFlowUrl('onboarding', { candidate_id: candidateId, onboarding_id: onboarding ? text(onboarding.fields['入职单ID']) || onboarding.id : undefined })
      return { step, result: await hrPush('手动推送-入职', text(onboarding?.fields['入职单ID']) || onboarding?.id || applicationId, `## 【待跟进入职】${wecomInline(name, '候选人', 20)}\n> ${onboarding ? `计划入职：${text(onboarding.fields['计划入职日期']) || '待确认'}` : '请确认Offer后办理入职'}。\n[进入入职管理 →](${url})`) }
    }
    const reviewId = text(onboardingReview?.fields['试用期记录ID']) || onboardingReview?.id || ''
    if (!onboarding) throw new ConflictException('请先确认入职，再推送入职评价')
    const evaluationUrl = text(json<any>(onboardingReview?.fields['扩展信息JSON'], {}).evaluationUrl) || appFlowUrl('onboarding', { candidate_id: candidateId, onboarding_id: text(onboarding.fields['入职单ID']) || onboarding.id })
    return { step, result: await hrPush('手动推送-入职评价', reviewId || text(onboarding.fields['入职单ID']) || onboarding.id, `## 【入职评价】${wecomInline(name, '候选人', 20)}\n> 到岗日期：${text(onboarding.fields['实际到岗日期']) || '待确认'}\n> 请完成入职评价并反哺题库。\n[打开入职评价 →](${evaluationUrl})`) }
  }

  private async findReviewShare(token: string) {
    if (!text(token)) throw new BadRequestException('评审链接无效')
    const rows = await teable.listAllRecords(this.table('recruitment_talent_review_shares'))
    const share = rows.find((row) => text(row.fields['访问Token哈希']) === tokenHash(token))
    if (!share) throw new NotFoundException('评审链接不存在或已失效')
    if (text(share.fields['分享状态']) === '已撤销') throw new ConflictException('本次评审已撤销')
    if (Date.parse(text(share.fields['过期时间'])) < Date.now()) throw new ConflictException('评审链接已过期，请联系招聘负责人重新推送')
    return share
  }

  /**
   * 批量为没有 AI 分析的人才生成评分、岗位匹配和标签。
   * 以人才当前最新简历为准，同时补回历史版本中未写入应聘记录的 0 分数据。
   */
  async batchAutoAnalyze(limit = 20): Promise<{ total: number; succeeded: number; failed: number; skipped: number; results: Array<{ candidateId: string; candidateName: string; status: 'success' | 'failed' | 'skipped'; message: string }> }> {
    const maxLimit = Math.max(1, Math.min(250, limit))
    const [candidates, assessments, resumeRecords] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_ai_assessments')),
      teable.listAllRecords(this.table('resume_extraction_records')),
    ])

    const applications = await teable.listAllRecords(this.table('recruitment_applications'))
    const analyzedResumeIds = new Set(
      assessments
        .filter((row) => text(row.fields['候选人ID']) && text(row.fields['简历记录ID']))
        .map((row) => `${text(row.fields['候选人ID'])}:${text(row.fields['简历记录ID'])}`)
    )

    const pending = candidates
      .filter((row) => {
        const cid = text(row.fields['候选人ID'])
        const latestResumeId = text(row.fields['最新简历记录ID'])
        if (!cid || !latestResumeId || text(row.fields['合并状态']) === '已合并' || text(row.fields['候选人状态']) === '已删除') return false
        const currentApplication = applications
          .filter((application) => text(application.fields['候选人ID']) === cid && text(application.fields['当前状态']) !== '已结束')
          .sort((left, right) => {
            const leftMatchesLatest = text(left.fields['简历记录ID']) === latestResumeId ? 1 : 0
            const rightMatchesLatest = text(right.fields['简历记录ID']) === latestResumeId ? 1 : 0
            if (leftMatchesLatest !== rightMatchesLatest) return rightMatchesLatest - leftMatchesLatest
            return text(right.fields['更新时间']).localeCompare(text(left.fields['更新时间']))
          })[0]
        const hasCurrentAnalysis = analyzedResumeIds.has(`${cid}:${latestResumeId}`)
        const currentScore = num(currentApplication?.fields['AI匹配分'])
        return !hasCurrentAnalysis || currentScore === 0
      })
      .slice(0, maxLimit)

    if (!pending.length) {
      return { total: 0, succeeded: 0, failed: 0, skipped: 0, results: [] }
    }

    const results: Array<{ candidateId: string; candidateName: string; status: 'success' | 'failed' | 'skipped'; message: string }> = []

    for (const candidate of pending) {
      const candidateId = text(candidate.fields['候选人ID']) || candidate.id
      const candidateName = text(candidate.fields['姓名']) || '未识别姓名'
      try {
        const latestResumeId = text(candidate.fields['最新简历记录ID'])
        const resumeRow = resumeRecords.find((row) => row.id === latestResumeId || text(row.fields['解析记录ID']) === latestResumeId)
          || resumeRecords.filter((row) => text(row.fields['候选人ID']) === candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
        if (!resumeRow) {
          results.push({ candidateId, candidateName, status: 'skipped', message: '没有可用的简历记录' })
          continue
        }
        await this.analyzeSingleCandidate(candidateId, text(resumeRow.fields['解析记录ID']) || resumeRow.id, '批量补全AI分析', { type: '批量补全AI分析' })
        results.push({ candidateId, candidateName, status: 'success', message: '分析完成' })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        results.push({ candidateId, candidateName, status: 'failed', message: msg })
      }
    }

    const succeeded = results.filter((r) => r.status === 'success').length
    const failed = results.filter((r) => r.status === 'failed').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    return { total: results.length, succeeded, failed, skipped, results }
  }

  /** 将所有未合并人才重新加入 AI 分析队列，每个候选人生成新的分析版本。 */
  rerunAllAnalysis(input: TalentAnalysisRerunInput) {
    if (!text(input.reason)) throw new BadRequestException('全量重新运行AI分析必须填写原因')
    const candidates = teable.listAllRecords(this.table('recruitment_candidates'))
    return candidates.then((rows) => {
      const pending = rows.filter((row) =>
        text(row.fields['候选人ID']) &&
        text(row.fields['合并状态']) !== '已合并' &&
        text(row.fields['候选人状态']) !== '已删除' &&
        (text(row.fields['最新简历记录ID']) || text(row.fields['来源记录ID']))
      )
      for (const row of pending) {
        const candidateId = text(row.fields['候选人ID'])
        const resumeId = text(row.fields['最新简历记录ID']) || text(row.fields['来源记录ID'])
        this.enqueueAiAnalysis(candidateId, resumeId, input.reason, '批量重跑')
      }
      this.invalidateDirectoryCache()
      return { total: pending.length, queueStatus: this.getAiQueueStatus() }
    })
  }

  async rerunAnalysis(candidateId: string, input: TalentAnalysisRerunInput) {
    if (!text(input.reason)) throw new BadRequestException('重新运行AI分析必须填写原因')
    const candidate = await this.findCandidateRow(candidateId)
    const latestResumeId = text(candidate.fields['最新简历记录ID'])
    const [resumeRows, assessmentsRaw] = await Promise.all([
      teable.listAllRecords(this.table('resume_extraction_records')),
      teable.listAllRecords(this.table('recruitment_ai_assessments')),
    ])
    const resumeRow = resumeRows.find((row) => row.id === latestResumeId || text(row.fields['解析记录ID']) === latestResumeId) || resumeRows.filter((row) => text(row.fields['候选人ID']) === candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    if (!resumeRow) throw new NotFoundException('该人才没有可用于AI分析的简历记录')
    const assessments = assessmentsRaw.filter((row) => text(row.fields['候选人ID']) === candidateId).sort((a, b) => (num(b.fields['版本号']) || 1) - (num(a.fields['版本号']) || 1) || text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))
    const previous = assessments[0], version = Math.max(0, ...assessments.map((row) => num(row.fields['版本号']) || 1)) + 1
    const resume = this.resumeInput(resumeRow)
    const run = await this.analyzeRun(resume), operator = text(input.operator) || '当前用户'
    const assessmentId = await this.saveAssessment(candidateId, resume.id, run.analysis, { version, parentId: text(previous?.fields['分析记录ID']) || previous?.id || '', type: '人工重跑', reason: input.reason, operator, operatorUserId: text(input.operatorUserId), ...run })
    await this.saveTags(candidateId, assessmentId, run.analysis)
    const matches = await this.saveMatches(candidateId, assessmentId, resume, run.analysis)
    const applications = await teable.listAllRecords(this.table('recruitment_applications'))
    const currentApplication = applications.filter((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['当前状态']) !== '已结束').sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    if (currentApplication) await teable.updateRecord(this.table('recruitment_applications'), currentApplication.id, { AI匹配分: matches[0]?.score || run.analysis.scores.overall, AI评分版本: `talent-v${version}`, 人工复核结果: '待确认', 更新时间: now() })
    await this.talentAudit('重新运行AI人才分析', '人才AI分析', assessmentId, { previousAssessmentId: text(previous?.fields['分析记录ID']) || '', previousVersion: num(previous?.fields['版本号']) || 1 }, { version, status: run.status, matches: matches.length }, operator, input.reason)
    return { candidateId, assessmentId, version, runStatus: run.status, error: run.error, comparison: previous ? await this.compareAnalysisVersions(candidateId, text(previous.fields['分析记录ID']) || previous.id, assessmentId) : null }
  }

  async correctAnalysis(candidateId: string, input: TalentAnalysisCorrectionInput) {
    if (!text(input.reason)) throw new BadRequestException('人工修正AI分析必须填写原因')
    await this.findCandidateRow(candidateId)
    const table = this.table('recruitment_ai_assessments')
    const assessments = (await teable.listAllRecords(table)).filter((row) => text(row.fields['候选人ID']) === candidateId)
      .sort((a, b) => (num(b.fields['版本号']) || 1) - (num(a.fields['版本号']) || 1) || text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))
    const assessment = assessments[0]
    if (!assessment) throw new NotFoundException('该人才暂无可修正的AI分析结果')
    const original = this.analysisFromAssessment(assessment)
    const previousCorrection = json<any>(assessment.fields['人工修正JSON'], null)
    const currentAnalysis: TalentAnalysis = previousCorrection?.effective || original
    const list = (value: unknown, fallback: string[]) => value === undefined ? fallback : [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))].slice(0, 30)
    const scores = { ...currentAnalysis.scores }
    for (const key of ['business', 'management', 'logic', 'communication', 'overall'] as const) {
      if (input.scores?.[key] === undefined) continue
      const value = Number(input.scores[key])
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new BadRequestException(`${key}评分必须在0到100之间`)
      scores[key] = Math.round(value)
    }
    const effective: TalentAnalysis = {
      summary: input.summary === undefined ? currentAnalysis.summary : text(input.summary),
      strengths: list(input.strengths, currentAnalysis.strengths), risks: list(input.risks, currentAnalysis.risks),
      skills: list(input.skills, currentAnalysis.skills), recommendedRoles: list(input.recommendedRoles, currentAnalysis.recommendedRoles),
      scores, evidence: currentAnalysis.evidence, confidence: currentAnalysis.confidence,
    }
    if (!effective.summary) throw new BadRequestException('人才摘要不能为空')
    const changedFields = ['summary', 'strengths', 'risks', 'skills', 'recommendedRoles', 'scores'].filter((key) => JSON.stringify((currentAnalysis as any)[key]) !== JSON.stringify((effective as any)[key]))
    if (!changedFields.length) throw new BadRequestException('没有检测到需要保存的人工修正')
    const assessmentId = text(assessment.fields['分析记录ID']) || assessment.id, operator = text(input.operator) || '当前用户', timestamp = now()
    const correction = { original, previousEffective: currentAnalysis, effective, changedFields, reason: input.reason, operator, operatorUserId: text(input.operatorUserId), correctedAt: timestamp }
    await teable.updateRecord(table, assessment.id, {
      人工修正内容: changedFields.join('、'), 人工修正JSON: JSON.stringify(correction), 生效评分JSON: JSON.stringify(effective.scores),
      生效技能JSON: JSON.stringify(effective.skills), 生效推荐岗位JSON: JSON.stringify(effective.recommendedRoles), 人工修正原因: input.reason,
      人工确认状态: '人工已修正', 修正人用户ID: text(input.operatorUserId), 修正人: operator, 修正时间: timestamp,
      确认人用户ID: text(input.operatorUserId), 确认人: operator, 确认时间: timestamp, 更新时间: timestamp,
    })
    await this.applyCorrectedTags(candidateId, assessmentId, effective, input.reason)
    const applications = await teable.listAllRecords(this.table('recruitment_applications'))
    const currentApplication = applications.filter((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['当前状态']) !== '已结束')
      .sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    if (currentApplication) await teable.updateRecord(this.table('recruitment_applications'), currentApplication.id, { AI匹配分: effective.scores.overall, 人工复核结果: '人工已修正', 更新时间: timestamp })
    await this.talentAudit('人工修正AI标签和评分', '人才AI分析', assessmentId, currentAnalysis, effective, operator, input.reason)
    return { candidateId, assessmentId, changedFields, correction, talent: await this.detail(candidateId) }
  }

  async correctMatch(candidateId: string, input: TalentMatchCorrectionInput) {
    const start = Date.now()
    const reason = text(input.reason)
    if (!reason) throw new BadRequestException('人工修改适配岗位必须填写原因')
    await this.findCandidateRow(candidateId)
    const positions = await teable.listAllRecords(this.table('recruitment_positions'))
    const position = positions.find((row) =>
      (text(input.positionId) && (text(row.fields['职位ID']) === text(input.positionId) || row.id === text(input.positionId)))
      || (text(input.positionName) && text(row.fields['职位名称']) === text(input.positionName)),
    )
    if (!position) throw new NotFoundException('请从岗位库中选择新的适配岗位')
    const positionId = text(position.fields['职位ID']) || position.id
    const positionName = text(position.fields['职位名称'])
    if (!positionName) throw new BadRequestException('所选岗位缺少岗位名称，请先维护岗位信息')

    const matches = await teable.listAllRecords(this.table('recruitment_job_matches'))
    const activeMatches = matches.filter((row) =>
      text(row.fields['候选人ID']) === candidateId && !['历史', '已失效'].includes(text(row.fields['匹配状态'])),
    ).sort((first, second) => num(second.fields['匹配总分']) - num(first.fields['匹配总分']))
    const currentMatch = activeMatches[0]
    if (currentMatch && (text(currentMatch.fields['职位ID']) === positionId || text(currentMatch.fields['职位名称']) === positionName)) {
      throw new BadRequestException('新的适配岗位与当前岗位一致，无需重复保存')
    }

    const timestamp = now(), operator = text(input.operator) || '当前用户', matchId = id('match')
    const assessmentId = text(currentMatch?.fields['分析记录ID'])
    const previousPositionId = text(currentMatch?.fields['职位ID'])
    const previousPositionName = text(currentMatch?.fields['职位名称'])
    for (const row of activeMatches) {
      await teable.updateRecord(this.table('recruitment_job_matches'), row.id, { 匹配状态: '历史', 更新时间: timestamp })
    }
    await teable.createRecord(this.table('recruitment_job_matches'), {
      匹配记录ID: matchId, 候选人ID: candidateId, 职位ID: positionId, 职位名称: positionName,
      需求ID: text(position.fields['需求ID']), 分析记录ID: assessmentId, 匹配总分: num(currentMatch?.fields['匹配总分']),
      技能匹配分: num(currentMatch?.fields['技能匹配分']), 经验匹配分: num(currentMatch?.fields['经验匹配分']),
      管理匹配分: num(currentMatch?.fields['管理匹配分']), 业务匹配分: num(currentMatch?.fields['业务匹配分']),
      推荐理由: `人工修正适配岗位：${reason}`, 差距与待确认项: text(currentMatch?.fields['差距与待确认项']),
      置信度: text(currentMatch?.fields['置信度']) || '人工确认', 人工确认状态: '人工已修正', 人工结论: '人工已修正',
      分析版本: assessmentId, 岗位JD版本: num(position.fields['JD版本']) || 1, 匹配状态: '当前',
      父匹配记录ID: text(currentMatch?.fields['匹配记录ID']) || currentMatch?.id || '',
      匹配人用户ID: text(input.operatorUserId), 匹配人: operator,
      修正前岗位ID: previousPositionId, 修正前岗位: previousPositionName,
      人工修正原因: reason, 人工修正人用户ID: text(input.operatorUserId), 人工修正人: operator, 人工修正时间: timestamp,
      创建时间: timestamp, 更新时间: timestamp,
    })
    await this.talentAudit(
      '人工修改适配岗位', '岗位匹配', matchId,
      { positionId: previousPositionId, positionName: previousPositionName },
      { positionId, positionName, reason }, operator, reason,
    )
    this.invalidateDirectoryCache()
    this.logSlow('correctMatch', start)
    return {
      candidateId, matchId, positionId, positionName, previousPositionId, previousPositionName,
      reason, operator, updatedAt: timestamp, talent: await this.detail(candidateId),
    }
  }

  async positionRematchImpact(positionId: string) {
    if (!text(positionId)) throw new BadRequestException('请选择需要重新匹配的岗位')
    const positions = await teable.listAllRecords(this.table('recruitment_positions'))
    const position = positions.find((row) => text(row.fields['职位ID']) === positionId || row.id === positionId)
    if (!position) throw new NotFoundException('职位不存在')
    const [matches, applications, candidates] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_job_matches')),
      teable.listAllRecords(this.table('recruitment_applications')),
      teable.listAllRecords(this.table('recruitment_candidates')),
    ])
    const active = (row: TeableRecord) => !['历史', '已失效'].includes(text(row.fields['匹配状态']))
    const matchCandidates = matches.filter((row) => text(row.fields['职位ID']) === positionId && active(row)).map((row) => text(row.fields['候选人ID']))
    const applicationCandidates = applications.filter((row) => text(row.fields['职位ID']) === positionId && text(row.fields['当前状态']) !== '已结束').map((row) => text(row.fields['候选人ID']))
    const candidateIds = [...new Set([...matchCandidates, ...applicationCandidates].filter(Boolean))]
    const items = candidateIds.map((candidateId) => {
      const candidate = candidates.find((row) => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
      const currentMatch = matches.filter((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['职位ID']) === positionId && active(row))
        .sort((a, b) => text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0]
      return { candidateId, name: text(candidate?.fields['姓名']) || '未命名人才', currentScore: num(currentMatch?.fields['匹配总分']), matchedJdVersion: num(currentMatch?.fields['岗位JD版本']) || 1, currentMatchId: text(currentMatch?.fields['匹配记录ID']) || currentMatch?.id || '' }
    })
    return { positionId, positionName: text(position.fields['职位名称']), jdVersion: num(position.fields['JD版本']) || 1, rematchStatus: text(position.fields['重匹配状态']) || '无需重匹配', pendingCount: items.length, changedAt: text(position.fields['最近JD变更时间']), changeReason: text(position.fields['最近JD变更原因']), items }
  }

  async rematchPosition(positionId: string, input: PositionRematchInput) {
    if (!text(input.reason)) throw new BadRequestException('岗位重新匹配必须填写原因')
    const impact = await this.positionRematchImpact(positionId)
    const selected = input.candidateIds?.length ? [...new Set(input.candidateIds.map(text).filter(Boolean))] : impact.items.map((item) => item.candidateId)
    if (!selected.length) return { ...impact, batchId: '', total: 0, succeeded: 0, failed: 0, results: [], message: '该岗位当前没有需要重新匹配的人才' }
    const positions = await teable.listAllRecords(this.table('recruitment_positions'))
    const position = positions.find((row) => text(row.fields['职位ID']) === positionId || row.id === positionId)!
    const [assessments, resumes, matches, applications] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_ai_assessments')),
      teable.listAllRecords(this.table('resume_extraction_records')),
      teable.listAllRecords(this.table('recruitment_job_matches')),
      teable.listAllRecords(this.table('recruitment_applications')),
    ])
    const batchId = id('rematch'), operator = text(input.operator) || '当前用户', timestamp = now(), results: any[] = []
    for (const candidateId of selected) {
      try {
        const assessment = assessments.filter((row) => text(row.fields['候选人ID']) === candidateId)
          .sort((a, b) => (num(b.fields['版本号']) || 1) - (num(a.fields['版本号']) || 1) || text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0]
        if (!assessment) throw new Error('缺少AI分析版本')
        const resume = resumes.filter((row) => text(row.fields['候选人ID']) === candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
        if (!resume) throw new Error('缺少可用于匹配的简历')
        const correction = json<any>(assessment.fields['人工修正JSON'], null)
        const analysis: TalentAnalysis = correction?.effective || this.analysisFromAssessment(assessment)
        const resumeInput = this.resumeInput(resume), assessmentId = text(assessment.fields['分析记录ID']) || assessment.id
        const corpus = `${text(position.fields['职位名称'])} ${text(position.fields['岗位JD'])} ${text(position.fields['工作职责'])} ${text(position.fields['任职要求'])} ${text(position.fields['标签JSON'])}`
        const resumeText = `${resumeInput.jobIntention} ${analysis.recommendedRoles.join(' ')} ${analysis.skills.join(' ')} ${resumeInput.workExperience}`
        const overlap = this.sharedTokens(corpus, resumeText), positionName = text(position.fields['职位名称'])
        const direct = Boolean(positionName && (resumeInput.jobIntention.includes(positionName) || analysis.recommendedRoles.some((role) => role.includes(positionName) || positionName.includes(role))))
        const score = clamp(45 + Math.min(30, overlap * 6) + (direct ? 18 : 0))
        const currentMatches = matches.filter((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['职位ID']) === positionId && !['历史', '已失效'].includes(text(row.fields['匹配状态'])))
        const previous = currentMatches.sort((a, b) => text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0]
        for (const row of currentMatches) await teable.updateRecord(this.table('recruitment_job_matches'), row.id, { 匹配状态: '历史', 更新时间: timestamp })
        const matchId = id('match')
        await teable.createRecord(this.table('recruitment_job_matches'), {
          匹配记录ID: matchId, 候选人ID: candidateId, 职位ID: positionId, 职位名称: positionName, 需求ID: text(position.fields['需求ID']), 分析记录ID: assessmentId,
          匹配总分: score, 技能匹配分: clamp(score + Math.min(8, overlap * 2)), 经验匹配分: analysis.scores.business, 管理匹配分: analysis.scores.management, 业务匹配分: analysis.scores.business,
          推荐理由: `岗位JD更新后重新匹配；${analysis.summary}`, 差距与待确认项: analysis.risks.join('；'), 置信度: analysis.confidence, 人工确认状态: '待人工确认',
          分析版本: assessmentId, 岗位JD版本: impact.jdVersion, 匹配状态: '当前', 父匹配记录ID: text(previous?.fields['匹配记录ID']) || previous?.id || '', 重匹配批次ID: batchId,
          重匹配原因: input.reason, 匹配人用户ID: text(input.operatorUserId), 匹配人: operator, 创建时间: timestamp, 更新时间: timestamp,
        })
        const application = applications.filter((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['职位ID']) === positionId && text(row.fields['当前状态']) !== '已结束').sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
        if (application) await teable.updateRecord(this.table('recruitment_applications'), application.id, { AI匹配分: score, 人工复核结果: '待确认', 更新时间: timestamp })
        results.push({ candidateId, status: '成功', previousScore: num(previous?.fields['匹配总分']), score, delta: score - num(previous?.fields['匹配总分']), matchId })
      } catch (error) {
        results.push({ candidateId, status: '失败', error: error instanceof Error ? error.message : String(error) })
      }
    }
    const failed = results.filter((item) => item.status === '失败').length
    await teable.updateRecord(this.table('recruitment_positions'), position.id, { 重匹配状态: failed ? '部分失败' : '已完成', 待重匹配人数: failed, 最近重匹配时间: timestamp, 更新时间: timestamp })
    await this.talentAudit('岗位JD变化后重新匹配', '职位', positionId, { jdVersion: impact.jdVersion, pending: impact.pendingCount }, { batchId, succeeded: results.length - failed, failed }, operator, input.reason)
    return { positionId, positionName: impact.positionName, jdVersion: impact.jdVersion, batchId, total: results.length, succeeded: results.length - failed, failed, results }
  }

  async aiMonitoring(days = 30) {
    const safeDays = Math.max(1, Math.min(365, Math.round(days || 30))), since = Date.now() - safeDays * 86_400_000
    const rows = (await teable.listAllRecords(this.table('recruitment_ai_assessments'))).filter((row) => {
      const time = Date.parse(text(row.fields['完成时间']) || text(row.fields['创建时间']))
      return !Number.isFinite(time) || time >= since
    })
    const runs = rows.map((row) => {
      const f = row.fields, inputTokens = num(f['输入估算Token']) || Math.ceil(num(f['输入字符数']) / 4), outputTokens = num(f['输出估算Token']) || Math.ceil(num(f['输出字符数']) / 4)
      return { id: text(f['分析记录ID']) || row.id, candidateId: text(f['候选人ID']), version: text(f['分析版本']) || 'talent-v1', type: text(f['分析类型']) || 'AI分析', status: text(f['运行状态']) || '成功', durationMs: num(f['耗时毫秒']), inputTokens, outputTokens, estimatedCost: num(f['估算成本元']), costBasis: text(f['成本估算口径']) || '按字符数÷4估算Token；未配置模型单价', error: text(f['运行错误']), model: text(f['模型版本']), operator: text(f['运行人']), completedAt: text(f['完成时间']) || text(f['创建时间']) }
    }).sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    const durations = runs.map((run) => run.durationMs).filter((value) => value >= 0).sort((a, b) => a - b)
    const percentile = (ratio: number) => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * ratio) - 1)] : 0
    const failed = runs.filter((run) => run.status !== '成功'), total = runs.length, fallback = runs.filter((run) => run.status === '规则降级')
    const errorMap = new Map<string, number>()
    failed.forEach((run) => { const key = run.error || run.status || '未知错误'; errorMap.set(key, (errorMap.get(key) || 0) + 1) })
    const dayMap = new Map<string, { date: string; total: number; success: number; fallback: number; durationTotal: number; estimatedCost: number }>()
    runs.forEach((run) => { const date = (run.completedAt || '').slice(0, 10) || '未知日期', current = dayMap.get(date) || { date, total: 0, success: 0, fallback: 0, durationTotal: 0, estimatedCost: 0 }; current.total += 1; if (run.status === '成功') current.success += 1; if (run.status === '规则降级') current.fallback += 1; current.durationTotal += run.durationMs; current.estimatedCost += run.estimatedCost; dayMap.set(date, current) })
    const failureRate = total ? Number((failed.length / total * 100).toFixed(1)) : 0, p95 = percentile(.95)
    const alerts = [
      ...(failureRate >= 10 ? [{ level: '高', type: '失败率', message: `近${safeDays}天AI非成功率${failureRate}%，建议检查平台LLM配置和错误明细。` }] : []),
      ...(p95 >= 15_000 ? [{ level: '中', type: '耗时', message: `P95耗时${p95}ms，已接近同步请求风险阈值。` }] : []),
      ...(fallback.length ? [{ level: '中', type: '规则降级', message: `${fallback.length}次分析使用规则降级，结果需要优先人工复核。` }] : []),
    ]
    return {
      rangeDays: safeDays, generatedAt: now(), pricingConfigured: Boolean(num(process.env.AI_INPUT_COST_PER_MILLION) || num(process.env.AI_OUTPUT_COST_PER_MILLION)),
      costBasis: runs[0]?.costBasis || '按字符数÷4估算Token；未配置模型单价',
      summary: { total, success: runs.filter((run) => run.status === '成功').length, fallback: fallback.length, failed: failed.length, successRate: total ? Number(((total - failed.length) / total * 100).toFixed(1)) : 0, averageDurationMs: total ? Math.round(runs.reduce((sum, run) => sum + run.durationMs, 0) / total) : 0, p95DurationMs: p95, inputTokens: runs.reduce((sum, run) => sum + run.inputTokens, 0), outputTokens: runs.reduce((sum, run) => sum + run.outputTokens, 0), estimatedCost: Number(runs.reduce((sum, run) => sum + run.estimatedCost, 0).toFixed(6)) },
      alerts, errors: [...errorMap.entries()].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      daily: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((item) => ({ ...item, averageDurationMs: item.total ? Math.round(item.durationTotal / item.total) : 0, estimatedCost: Number(item.estimatedCost.toFixed(6)) })),
      slowRuns: runs.filter((run) => run.durationMs >= Math.max(5000, p95)).slice(0, 20), recent: runs.slice(0, 50),
    }
  }

  async analysisVersions(candidateId: string) {
    await this.findCandidateRow(candidateId)
    const rows = (await teable.listAllRecords(this.table('recruitment_ai_assessments'))).filter((row) => text(row.fields['候选人ID']) === candidateId)
      .sort((a, b) => (num(b.fields['版本号']) || 1) - (num(a.fields['版本号']) || 1) || text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))
    const versions = rows.map((row) => this.mapAnalysisVersion(row))
    return { candidateId, total: versions.length, currentAssessmentId: versions[0]?.id || '', versions }
  }

  async compareAnalysisVersions(candidateId: string, from?: string, to?: string) {
    const result = await this.analysisVersions(candidateId), versions = result.versions
    if (versions.length < 2 && (!from || !to)) throw new BadRequestException('至少需要两个AI分析版本才能对比')
    const find = (value: string | undefined, fallback: any) => versions.find((item) => item.id === value || String(item.version) === String(value)) || fallback
    const target = find(to, versions[0]), source = find(from, versions.find((item) => item.id !== target?.id))
    if (!source || !target || source.id === target.id) throw new BadRequestException('请选择两个不同的AI分析版本')
    const added = (next: string[], previous: string[]) => next.filter((item) => !previous.includes(item))
    const scoreDelta: Record<string, number> = {}
    for (const key of ['business', 'management', 'logic', 'communication', 'overall']) scoreDelta[key] = Number(target.scores[key] || 0) - Number(source.scores[key] || 0)
    return {
      candidateId, from: source, to: target, scoreDelta,
      skills: { added: added(target.skills, source.skills), removed: added(source.skills, target.skills) },
      recommendedRoles: { added: added(target.recommendedRoles, source.recommendedRoles), removed: added(source.recommendedRoles, target.recommendedRoles) },
      strengths: { added: added(target.strengths, source.strengths), removed: added(source.strengths, target.strengths) },
      risks: { added: added(target.risks, source.risks), removed: added(source.risks, target.risks) },
      summaryChanged: source.summary !== target.summary, confidenceChanged: source.confidence !== target.confidence,
    }
  }

  private resumeInput(row: TeableRecord): ResumeTalentInput {
    const f = row.fields
    return { id: text(f['解析记录ID']) || row.id, name: text(f['姓名']), gender: text(f['性别']), age: f['年龄'] == null ? null : num(f['年龄']), phone: text(f['电话']), email: text(f['邮箱']), wechat: text(f['微信']), address: text(f['地址']), selfEvaluation: text(f['自我评价']), skillsCertificates: text(f['技能证书']), educationBackground: text(f['教育背景']), workExperience: text(f['工作经历']), jobIntention: text(f['求职意向']), yearsOfExperience: text(f['工作年限']), currentCompany: text(f['当前公司']), currentRole: text(f['当前职位']), sourceFileName: text(f['源文件名']), sourceFileUrl: text(f['源文件地址']), rawText: text(f['OCR原文']), fingerprint: text(f['简历指纹']), createdTime: text(f['创建时间']) || row.createdTime }
  }

  private mapAnalysisVersion(row: TeableRecord) {
    const f = row.fields
    const original = this.analysisFromAssessment(row), correction = json<any>(f['人工修正JSON'], null), effective = correction?.effective || original
    return { id: text(f['分析记录ID']) || row.id, recordId: row.id, version: num(f['版本号']) || 1, versionName: text(f['分析版本']) || 'talent-v1', parentId: text(f['父分析记录ID']), type: text(f['分析类型']) || '首次分析', reason: text(f['重跑原因']), promptVersion: text(f['提示词版本']), modelVersion: text(f['模型版本']), runStatus: text(f['运行状态']) || '成功', durationMs: num(f['耗时毫秒']), inputChars: num(f['输入字符数']), outputChars: num(f['输出字符数']), inputTokens: num(f['输入估算Token']) || Math.ceil(num(f['输入字符数']) / 4), outputTokens: num(f['输出估算Token']) || Math.ceil(num(f['输出字符数']) / 4), estimatedCost: num(f['估算成本元']), costBasis: text(f['成本估算口径']), error: text(f['运行错误']), ...effective, aiOriginal: original, corrected: Boolean(correction), correction: correction ? { changedFields: correction.changedFields || [], reason: text(f['人工修正原因']) || correction.reason, operator: text(f['修正人']) || correction.operator, correctedAt: text(f['修正时间']) || correction.correctedAt } : null, reviewStatus: text(f['人工确认状态']) || '待人工确认', humanCorrection: text(f['人工修正内容']), operator: text(f['运行人']), startedAt: text(f['开始时间']), completedAt: text(f['完成时间']), createdAt: text(f['创建时间']) }
  }

  private analysisFromAssessment(row: TeableRecord): TalentAnalysis {
    const f = row.fields
    return { summary: text(f['人才摘要']), strengths: json<string[]>(f['优势JSON'], []), risks: json<string[]>(f['风险与待确认JSON'], []), skills: json<string[]>(f['技能JSON'], []), recommendedRoles: json<string[]>(f['推荐岗位JSON'], []), scores: { business: num(f['业务能力分']), management: num(f['管理能力分']), logic: num(f['逻辑能力分']), communication: num(f['沟通协作分']), overall: num(f['综合建议分']) }, evidence: json<TalentAnalysis['evidence']>(f['评分证据JSON'], { business: '', management: '', logic: '', communication: '' }), confidence: (['高', '中', '低'].includes(text(f['置信度'])) ? text(f['置信度']) : '低') as TalentAnalysis['confidence'] }
  }

  private async applyCorrectedTags(candidateId: string, assessmentId: string, analysis: TalentAnalysis, reason: string) {
    const table = this.table('recruitment_candidate_tags'), rows = await teable.listAllRecords(table), timestamp = now()
    const targets = [
      ...analysis.skills.map((name) => ({ name, category: '技能标签' })),
      ...analysis.recommendedRoles.map((name) => ({ name: `适合${name}`, category: '岗位推荐' })),
    ]
    const targetNames = new Set(targets.map((item) => item.name))
    for (const row of rows.filter((item) => text(item.fields['候选人ID']) === candidateId && text(item.fields['分析版本']) === assessmentId && !targetNames.has(text(item.fields['标签名称'])))) {
      await teable.updateRecord(table, row.id, { 标签状态: '人工移除', 人工确认状态: '人工已修正', 更新时间: timestamp })
    }
    for (const target of targets) {
      const existing = rows.find((item) => text(item.fields['候选人ID']) === candidateId && text(item.fields['标签名称']) === target.name)
      const fields = { 标签记录ID: text(existing?.fields['标签记录ID']) || id('tag'), 候选人ID: candidateId, 标签名称: target.name, 标签分类: target.category, 标签来源: existing ? text(existing.fields['标签来源']) || '人工修正' : '人工修正', 置信度: 100, 证据: `人工修正：${reason}`, 人工确认状态: '人工已修正', 标签状态: '当前', 分析版本: assessmentId, 创建时间: text(existing?.fields['创建时间']) || timestamp, 更新时间: timestamp }
      if (existing) await teable.updateRecord(table, existing.id, fields)
      else await teable.createRecord(table, fields)
    }
  }

  async reviewQueue(query: { owner?: string; q?: string }) {
    const data = await this.loadAll()
    const keyword = text(query.q).toLowerCase()
    const nowTime = Date.now()
    const items = data.applications
      .filter((application) => ['待业务群评审', '负责人审查'].includes(text(application.fields['当前阶段'])) && text(application.fields['当前状态']) !== '已结束')
      .map((application) => {
        const candidateId = text(application.fields['候选人ID'])
        const candidate = data.candidates.find((row) => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
        if (!candidate || text(candidate.fields['合并状态']) === '已合并') return null
        const profile = this.profile(candidate, data, true)
        const submittedAt = text(application.fields['投递时间']) || text(application.fields['创建时间']) || profile.createdTime
        const waitingDays = submittedAt ? Math.max(0, Math.floor((nowTime - Date.parse(submittedAt)) / 86_400_000)) : 0
        const risks = profile.analysis?.risks || []
        const priorityScore = clamp(profile.bestMatchScore + Math.min(12, waitingDays * 2) + Math.min(12, risks.length * 4), 0, 130)
        return {
          applicationId: text(application.fields['应聘记录ID']) || application.id, candidateId, name: profile.name,
          positionName: profile.bestMatchRole || profile.jobIntention || '岗位待确认', matchScore: profile.bestMatchScore,
          owner: profile.owner, source: profile.source, waitingDays, risks, strengths: profile.analysis?.strengths || [],
          confidence: profile.analysis?.confidence || '低', priorityScore, submittedAt, profile,
        }
      })
      .filter(Boolean)
      .filter((item: any) => (!query.owner || query.owner === '全部负责人' || item.owner === query.owner)
        && (!keyword || [item.name, item.positionName, item.owner, item.source].join('|').toLowerCase().includes(keyword)))
      .sort((a: any, b: any) => b.priorityScore - a.priorityScore || b.waitingDays - a.waitingDays)
    return {
      total: items.length, highMatch: items.filter((item: any) => item.matchScore >= 80).length,
      riskPending: items.filter((item: any) => item.risks.length).length, overdue: items.filter((item: any) => item.waitingDays >= 3).length,
      items,
    }
  }

  async reviewTalent(candidateId: string, input: TalentReviewInput) {
    const start = Date.now()
    const decisions = ['通过', '退回', '淘汰', '储备']
    if (!decisions.includes(text(input.decision))) throw new BadRequestException('审查结论必须是通过、退回、淘汰或储备')
    if (!text(input.opinion)) throw new BadRequestException('负责人审查必须填写审查意见')
    if (!(input.evidence || []).some((item) => text(item))) throw new BadRequestException('负责人审查必须至少填写一条判断证据')
    const candidate = await this.findCandidateRow(candidateId)
    if (text(candidate.fields['合并状态']) === '已合并') throw new BadRequestException('已合并副档不能单独审查')
    const applicationTable = this.table('recruitment_applications')
    const [applications, assessments] = await Promise.all([
      teable.listAllRecords(applicationTable),
      teable.listAllRecords(this.table('recruitment_ai_assessments')),
    ])
    const application = applications
      .filter((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['当前状态']) !== '已结束')
      .sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    if (!application) throw new NotFoundException('该人才没有进行中的应聘记录')
    if (!['待业务群评审', '负责人审查'].includes(text(application.fields['当前阶段']))) throw new ConflictException('该人才已不在业务群评审阶段')
    const targetMap: Record<string, string> = { 通过: '意向沟通', 退回: '简历待补充', 淘汰: '已淘汰', 储备: '储备人才' }
    const targetStage = targetMap[input.decision]
    const timestamp = now()
    const operator = text(input.operator) || '当前用户'
    const assessment = assessments.filter((row) => text(row.fields['候选人ID']) === candidateId)
      .sort((a, b) => text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0]
    const reviewId = id('review')
    await teable.createRecord(this.table('recruitment_candidate_reviews'), {
      审查记录ID: reviewId, 应聘记录ID: text(application.fields['应聘记录ID']) || application.id, 候选人ID: candidateId,
      职位ID: text(application.fields['职位ID']), 审查结论: input.decision, 审查意见: input.opinion,
      证据JSON: JSON.stringify((input.evidence || []).map(text).filter(Boolean)), 风险项反馈JSON: JSON.stringify(input.riskFeedback || {}),
      AI匹配分: num(application.fields['AI匹配分']), AI置信度: text(assessment?.fields['置信度']),
      原阶段: '待业务群评审', 目标阶段: targetStage, 审查人用户ID: text(input.operatorUserId), 审查人: operator,
      审查时间: timestamp, 创建时间: timestamp,
    })
    const closed = ['淘汰', '储备'].includes(input.decision)
    await teable.updateRecord(applicationTable, application.id, {
      当前阶段: targetStage, 当前状态: closed ? '已结束' : '进行中', 人工复核结果: input.decision,
      淘汰原因: input.decision === '淘汰' ? input.opinion : text(application.fields['淘汰原因']),
      最近处理时间: timestamp, 流程结束时间: closed ? timestamp : '', 更新时间: timestamp,
    })
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, {
      候选人状态: targetStage, 人才池: input.decision === '储备' ? '储备人才池' : text(candidate.fields['人才池']) || '公司人才库', 更新时间: timestamp,
    })
    if (input.decision === '通过') await this.notifyPositionHr('业务群评审通过', candidateId, `## 【待意向沟通】${wecomInline(this.candidateName(candidate), '候选人', 20)}\n> 业务群评审已通过，已进入你的招聘待办\n[打开意向沟通表单 →](${(await this.createCommunicationLink(candidateId).catch(() => '')) || `${text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')}/#candidates`})\n<font color=\"comment\">提交后系统会继续私信提醒约面。</font>`, text(application.fields['应聘记录ID']) || application.id, text(application.fields['职位ID']), text(application.fields['应聘记录ID']) || application.id, operator)
    await teable.createRecord(this.table('recruitment_stage_events'), {
      事件ID: id('evt'), 应聘记录ID: text(application.fields['应聘记录ID']) || application.id, 候选人ID: candidateId,
      职位ID: text(application.fields['职位ID']), 原阶段: '待业务群评审', 新阶段: targetStage,
      操作: '业务群评审确认', 结果: input.decision, 原因: input.opinion, 操作人用户ID: text(input.operatorUserId), 操作人: operator,
      发生时间: timestamp, 来源类型: '人工操作', 来源记录ID: reviewId,
      扩展信息JSON: JSON.stringify({ evidence: input.evidence || [], riskFeedback: input.riskFeedback || {} }),
    })
    await this.completeTasks('待业务群评审', candidateId)
    await this.talentAudit('业务群评审确认', '人才', candidateId, application.fields,
      { decision: input.decision, targetStage, evidence: input.evidence }, operator, input.opinion)
    this.invalidateDirectoryCache()
    this.logSlow('reviewTalent', start)
    return { reviewId, candidateId, decision: input.decision, targetStage }
  }

  async listCommunications(candidateId: string) {
    await this.findCandidateRow(candidateId)
    const rows = (await teable.listAllRecords(this.table('recruitment_communications')))
      .filter((row) => text(row.fields['候选人ID']) === candidateId)
      .sort((a, b) => text(b.fields['发生时间']).localeCompare(text(a.fields['发生时间'])))
    const applications = await teable.listByField(this.table('recruitment_applications'), '候选人ID', candidateId)
    const application = applications.sort((first, second) => text(second.fields['更新时间']).localeCompare(text(first.fields['更新时间'])))[0]
    const positionId = text(application?.fields['职位ID'])
    const positions = positionId ? await teable.listAllRecords(this.table('recruitment_positions')) : []
    const position = positions.find((item) => text(item.fields['职位ID']) === positionId || item.id === positionId)
    return { total: rows.length, communications: rows.map((row) => this.mapCommunication(row)), defaultHr: {
      id: text(position?.fields['招聘HR用户ID']), name: text(position?.fields['招聘HR']), positionName: text(position?.fields['职位名称']),
    } }
  }

  async createCommunication(candidateId: string, input: TalentCommunicationInput) {
    const channels = ['电话', '微信', '邮件', '短信', '当面', '其他']
    const answerStatuses = ['已接通', '未接听', '拒接', '关机', '空号', '微信回复']
    const interestLevels = ['高', '中', '低', '拒绝']
    const jobStatuses = ['已离职', '在职已提离职', '在职未提离职', '应届生']
    if (!channels.includes(text(input.channel))) throw new BadRequestException('请选择有效的沟通渠道')
    if (!answerStatuses.includes(text(input.answerStatus))) throw new BadRequestException('请选择有效的接通状态')
    if (!interestLevels.includes(text(input.interestLevel))) throw new BadRequestException('请选择有效的兴趣度')
    if (!jobStatuses.includes(text(input.jobStatus))) throw new BadRequestException('请选择有效的在职状态')
    if (!text(input.summary)) throw new BadRequestException('请填写沟通摘要')
    if (!text(input.result)) throw new BadRequestException('请选择沟通结果')
    if (text(input.result).includes('拒绝') && !text(input.rejectionReason)) throw new BadRequestException('候选人拒绝时必须记录拒绝原因')
    const candidate = await this.findCandidateRow(candidateId)
    if (text(candidate.fields['合并状态']) === '已合并') throw new BadRequestException('已合并副档不能单独记录沟通')
    const applications = await teable.listAllRecords(this.table('recruitment_applications'))
    const application = applications.filter((row) => text(row.fields['候选人ID']) === candidateId)
      .sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const timestamp = now()
    const operator = text(input.operator) || '当前用户'
    const wechatCheck = input.wechat ? await this.checkWechatDuplicate(input.wechat, candidateId) : { duplicate: false, matches: [] }
    const communicationId = id('comm')
    await teable.createRecord(this.table('recruitment_communications'), {
      沟通记录ID: communicationId, 候选人ID: candidateId, 应聘记录ID: text(application?.fields['应聘记录ID']) || application?.id || '',
      沟通类型: text(input.type) || '意向沟通', 沟通渠道: input.channel, 沟通方向: text(input.direction) || '呼出',
      沟通摘要: input.summary, 下一步行动: text(input.nextAction), 下次跟进时间: text(input.nextFollowUpAt), 沟通结果: input.result,
      微信号: text(input.wechat), 微信重复状态: wechatCheck.duplicate ? '疑似与其他人才重复' : input.wechat ? '未发现重复' : '',
      使用模板ID: text(input.templateId), 拒绝原因: text(input.rejectionReason), 再联系时间: text(input.recontactAt),
      接通状态: text(input.answerStatus), 兴趣度: text(input.interestLevel), 在职状态: text(input.jobStatus), 到岗时间: text(input.entryTime),
      离职原因: text(input.leaveReason), 离职原因详情: text(input.leaveReasonDetail), 婚姻状况: text(input.maritalStatus), 居住区域: text(input.homeAddress),
      主要职责: text(input.workContent), 当前薪酬整体情况: text(input.currentSalaryInfo), 候选人关注点: text(input.candidateConcerns),
      当前加班强度: text(input.overtimeIntensity), 加班接受度: text(input.overtimeAttitude), 约面形式: text(input.interviewType), 约面时间: text(input.interviewTime),
      沟通备注: text(input.notes),
      操作人用户ID: text(input.operatorUserId), 操作人: operator, 发生时间: timestamp, 创建时间: timestamp,
    })
    const candidateFields: Record<string, unknown> = { 最近联系时间: timestamp, 更新时间: timestamp }
    if (input.wechat && !text(candidate.fields['微信']) && !wechatCheck.duplicate) candidateFields['微信'] = input.wechat
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, candidateFields)
    if (application && ['负责人审查', '待业务群评审', '意向沟通'].includes(text(application.fields['当前阶段']))) {
      await teable.updateRecord(this.table('recruitment_applications'), application.id, { 当前阶段: '待约面', 最近处理时间: timestamp, 更新时间: timestamp })
      await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 候选人状态: '待约面', 更新时间: timestamp })
    } else if (application) await teable.updateRecord(this.table('recruitment_applications'), application.id, { 最近处理时间: timestamp, 更新时间: timestamp })
    const followUpAt = text(input.nextFollowUpAt) || text(input.recontactAt)
    if (followUpAt) await this.upsertFollowUpTask(candidateId, text(candidate.fields['姓名']), followUpAt, operator, text(input.operatorUserId), text(input.nextAction) || text(input.rejectionReason))
    if (application && ['负责人审查', '待业务群评审', '意向沟通', '待约面'].includes(text(application.fields['当前阶段']))) {
      const scheduleUrl = interviewScheduleUrl(candidateId)
      await this.notifyPositionHr('意向沟通完成', candidateId, `## 【待约面】${wecomInline(this.candidateName(candidate), '候选人', 20)}\n> 意向沟通已记录：${text(input.result)}\n[打开约面工作台 →](${scheduleUrl})\n<font color="comment">请确认面试时间、面试官和会议室。</font>`, text(application.fields['应聘记录ID']) || application.id, text(application.fields['职位ID']), text(application.fields['应聘记录ID']) || application.id, operator)
    }
    await this.talentAudit('记录人才沟通', '人才', candidateId, {}, { communicationId, result: input.result, channel: input.channel }, operator, input.summary)
    return { candidateId, scheduleUrl: interviewScheduleUrl(candidateId), communicationId, wechatDuplicate: wechatCheck, communication: this.mapCommunication({ id: communicationId, fields: {
      沟通记录ID: communicationId, 候选人ID: candidateId, 沟通类型: input.type, 沟通渠道: input.channel, 沟通方向: input.direction,
      沟通摘要: input.summary, 下一步行动: input.nextAction, 下次跟进时间: input.nextFollowUpAt, 沟通结果: input.result,
      微信号: input.wechat, 微信重复状态: wechatCheck.duplicate ? '疑似与其他人才重复' : '', 拒绝原因: input.rejectionReason,
      再联系时间: input.recontactAt, 操作人: operator, 操作人用户ID: text(input.operatorUserId), 发生时间: timestamp,
      接通状态: input.answerStatus, 兴趣度: input.interestLevel, 在职状态: input.jobStatus, 到岗时间: input.entryTime,
      离职原因: input.leaveReason, 离职原因详情: input.leaveReasonDetail, 婚姻状况: input.maritalStatus, 居住区域: input.homeAddress,
      主要职责: input.workContent, 当前薪酬整体情况: input.currentSalaryInfo, 候选人关注点: input.candidateConcerns,
      当前加班强度: input.overtimeIntensity, 加班接受度: input.overtimeAttitude, 约面形式: input.interviewType, 约面时间: input.interviewTime,
      沟通备注: input.notes,
    } }) }
  }

  async checkWechatDuplicate(wechatValue?: string, candidateId?: string) {
    const wechat = text(wechatValue).toLowerCase()
    if (!wechat) return { duplicate: false, matches: [] }
    const [candidates, communications] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_communications')),
    ])
    const matches = new Map<string, { candidateId: string; name: string; source: string }>()
    for (const candidate of candidates) {
      const idValue = text(candidate.fields['候选人ID']) || candidate.id
      if (idValue !== candidateId && text(candidate.fields['微信']).toLowerCase() === wechat) matches.set(idValue, { candidateId: idValue, name: text(candidate.fields['姓名']), source: '人才主档' })
    }
    for (const communication of communications) {
      const idValue = text(communication.fields['候选人ID'])
      if (idValue && idValue !== candidateId && text(communication.fields['微信号']).toLowerCase() === wechat && !matches.has(idValue)) {
        const candidate = candidates.find((row) => text(row.fields['候选人ID']) === idValue || row.id === idValue)
        matches.set(idValue, { candidateId: idValue, name: text(candidate?.fields['姓名']), source: '历史沟通记录' })
      }
    }
    return { duplicate: matches.size > 0, normalizedWechat: wechat, matches: [...matches.values()] }
  }

  async extractCommunicationTranscript(transcriptValue: string, timeoutMs = 30_000): Promise<{ extraction: CommunicationTranscriptExtraction; source: 'ai' | 'empty' }> {
    const transcript = text(transcriptValue)
    if (!transcript) throw new BadRequestException('请粘贴电话或沟通文字记录')
    if (transcript.length > 20000) throw new BadRequestException('沟通文本最多20000字')
    const allowed = <T extends string>(value: unknown, options: readonly T[]): T | '' => {
      const normalized = text(value)
      return options.includes(normalized as T) ? normalized as T : ''
    }
    const normalizeDateTime = (value: unknown) => {
      const raw = text(value)
      if (!raw) return ''
      const parsed = new Date(raw)
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.now() - 86400000 * 365) return ''
      const pad = (input: number) => String(input).padStart(2, '0')
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
    }
    const prompt = `你是招聘沟通记录结构化助手。只从给定文本中提取明确提到的事实；没有提到的一律留空字符串，不要推断、不要编造、不要补默认值。\n返回纯JSON，字段如下：\nchannel只能是“电话”“微信”“邮件”“短信”“当面”“其他”或空；answerStatus只能是“已接通”“未接听”“拒接”“关机”“空号”或空；interestLevel只能是“高”“中”“低”“拒绝”或空；jobStatus只能是“已离职”“在职已提离职”“在职未提离职”“应届生”或空；entryTime只能是“随时”“一周内”“两周内”“一个月内”“不确定”或空；leaveReason只能是“薪资”“发展”“管理”“家庭”“通勤”“公司变动”“其他”或空；interviewType只能是“线上”“线下”或空；result只能是“推进面试”“放入人才库”“淘汰”“二次沟通”或空；rejectionReason只能是“薪资不匹配”“地点不匹配”“已入职”“无兴趣”“经验不足”“其他”或空。\n其他字段为字符串：leaveReasonDetail、maritalStatus（尽量用“已婚”“未婚”“其他”）、homeAddress、workContent、currentSalaryInfo、candidateConcerns、overtimeIntensity、overtimeAttitude、interviewTime（尽量转换为YYYY-MM-DDTHH:mm）、notes（一句话摘要）。\n\n沟通文本：\n${transcript.slice(0, 18000)}`
    const answer = await withTimeout(llm.chat([{ role: 'user', content: prompt }], { timeoutMs }), timeoutMs, 'AI解析耗时过长，请稍后重试，或根据原文手动填写')
    const value = JSON.parse(answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()) as CommunicationTranscriptExtraction
    const extraction: CommunicationTranscriptExtraction = {
      channel: allowed(value?.channel, ['电话', '微信', '邮件', '短信', '当面', '其他'] as const),
      answerStatus: allowed(value?.answerStatus, ['已接通', '未接听', '拒接', '关机', '空号'] as const),
      interestLevel: allowed(value?.interestLevel, ['高', '中', '低', '拒绝'] as const),
      jobStatus: allowed(value?.jobStatus, ['已离职', '在职已提离职', '在职未提离职', '应届生'] as const),
      entryTime: allowed(value?.entryTime, ['随时', '一周内', '两周内', '一个月内', '不确定'] as const),
      leaveReason: allowed(value?.leaveReason, ['薪资', '发展', '管理', '家庭', '通勤', '公司变动', '其他'] as const),
      leaveReasonDetail: text(value?.leaveReasonDetail),
      maritalStatus: allowed(value?.maritalStatus, ['已婚', '未婚', '其他'] as const),
      homeAddress: text(value?.homeAddress),
      workContent: text(value?.workContent),
      currentSalaryInfo: text(value?.currentSalaryInfo),
      candidateConcerns: text(value?.candidateConcerns),
      overtimeIntensity: text(value?.overtimeIntensity),
      overtimeAttitude: text(value?.overtimeAttitude),
      interviewType: allowed(value?.interviewType, ['线上', '线下'] as const),
      interviewTime: normalizeDateTime(value?.interviewTime),
      result: allowed(value?.result, ['推进面试', '放入人才库', '淘汰', '二次沟通'] as const),
      rejectionReason: allowed(value?.rejectionReason, ['薪资不匹配', '地点不匹配', '已入职', '无兴趣', '经验不足', '其他'] as const),
      notes: text(value?.notes),
    }
    return { extraction, source: 'ai' }
  }

  async listCommunicationTemplates(query: { category?: string; channel?: string; position?: string }) {
    await this.ensureDefaultCommunicationTemplates()
    const rows = await teable.listAllRecords(this.table('recruitment_communication_templates'))
    const templates = rows.filter((row) => text(row.fields['模板状态']) !== '停用')
      .filter((row) => !query.category || text(row.fields['模板分类']) === query.category)
      .filter((row) => !query.channel || !text(row.fields['适用渠道']) || text(row.fields['适用渠道']) === query.channel)
      .filter((row) => !query.position || !text(row.fields['适用岗位']) || text(row.fields['适用岗位']) === query.position)
      .map((row) => ({ id: text(row.fields['模板ID']) || row.id, name: text(row.fields['模板名称']), category: text(row.fields['模板分类']), position: text(row.fields['适用岗位']), channel: text(row.fields['适用渠道']), content: text(row.fields['模板内容']), variables: json<string[]>(row.fields['变量JSON'], []), status: text(row.fields['模板状态']) }))
    return { total: templates.length, templates }
  }

  async createCommunicationTemplate(input: CommunicationTemplateInput) {
    if (!text(input.name) || !text(input.category) || !text(input.content)) throw new BadRequestException('模板名称、分类和内容不能为空')
    const timestamp = now()
    const templateId = id('commtpl')
    await teable.createRecord(this.table('recruitment_communication_templates'), {
      模板ID: templateId, 模板名称: input.name, 模板分类: input.category, 适用岗位: text(input.position), 适用渠道: text(input.channel),
      模板内容: input.content, 变量JSON: JSON.stringify(input.variables || []), 模板状态: text(input.status) || '启用',
      创建人用户ID: text(input.operatorUserId), 创建人: text(input.operator) || '当前用户', 创建时间: timestamp, 更新时间: timestamp,
    })
    return { templateId, status: '启用' }
  }

  async syncFollowUpTasks(operator = '系统') {
    const communications = await teable.listAllRecords(this.table('recruitment_communications'))
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    let createdOrUpdated = 0
    for (const row of communications) {
      const followUpAt = text(row.fields['下次跟进时间']) || text(row.fields['再联系时间'])
      if (!followUpAt) continue
      const candidateId = text(row.fields['候选人ID'])
      const candidate = candidates.find((item) => text(item.fields['候选人ID']) === candidateId || item.id === candidateId)
      await this.upsertFollowUpTask(candidateId, text(candidate?.fields['姓名']), followUpAt, text(row.fields['操作人']) || operator, text(row.fields['操作人用户ID']), text(row.fields['下一步行动']) || text(row.fields['拒绝原因']))
      createdOrUpdated += 1
    }
    return { checked: communications.length, createdOrUpdated }
  }

  async listOverdueFollowUps(owner?: string) {
    const [tasks, candidates] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_tasks')),
      teable.listAllRecords(this.table('recruitment_candidates')),
    ])
    const nowTime = Date.now()
    const items = tasks.filter((row) => text(row.fields['待办类型']) === '人才跟进' && text(row.fields['待办状态']) !== '已完成')
      .filter((row) => !owner || text(row.fields['处理人']) === owner)
      .map((row) => {
        const candidateId = text(row.fields['对象ID'])
        const candidate = candidates.find((item) => text(item.fields['候选人ID']) === candidateId || item.id === candidateId)
        const deadline = text(row.fields['截止时间'])
        return { id: text(row.fields['待办ID']) || row.id, candidateId, name: text(candidate?.fields['姓名']), title: text(row.fields['标题']), description: text(row.fields['描述']), owner: text(row.fields['处理人']), deadline, overdue: Boolean(deadline && Date.parse(deadline) < nowTime), priority: text(row.fields['优先级']) }
      }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.deadline.localeCompare(b.deadline))
    return { total: items.length, overdue: items.filter((item) => item.overdue).length, items }
  }

  private mapCommunication(row: TeableRecord) {
    return {
      id: text(row.fields['沟通记录ID']) || row.id, candidateId: text(row.fields['候选人ID']), applicationId: text(row.fields['应聘记录ID']),
      type: text(row.fields['沟通类型']), channel: text(row.fields['沟通渠道']), direction: text(row.fields['沟通方向']),
      summary: text(row.fields['沟通摘要']), nextAction: text(row.fields['下一步行动']), nextFollowUpAt: text(row.fields['下次跟进时间']),
      result: text(row.fields['沟通结果']), wechat: text(row.fields['微信号']), wechatDuplicateStatus: text(row.fields['微信重复状态']),
      templateId: text(row.fields['使用模板ID']), rejectionReason: text(row.fields['拒绝原因']), recontactAt: text(row.fields['再联系时间']),
      answerStatus: text(row.fields['接通状态']), interestLevel: text(row.fields['兴趣度']), jobStatus: text(row.fields['在职状态']), entryTime: text(row.fields['到岗时间']),
      leaveReason: text(row.fields['离职原因']), leaveReasonDetail: text(row.fields['离职原因详情']), maritalStatus: text(row.fields['婚姻状况']), homeAddress: text(row.fields['居住区域']),
      workContent: text(row.fields['主要职责']), currentSalaryInfo: text(row.fields['当前薪酬整体情况']), candidateConcerns: text(row.fields['候选人关注点']),
      overtimeIntensity: text(row.fields['当前加班强度']), overtimeAttitude: text(row.fields['加班接受度']), interviewType: text(row.fields['约面形式']), interviewTime: text(row.fields['约面时间']),
      notes: text(row.fields['沟通备注']),
      operatorUserId: text(row.fields['操作人用户ID']), operator: text(row.fields['操作人']), occurredAt: text(row.fields['发生时间']),
    }
  }

  private async ensureDefaultCommunicationTemplates() {
    const table = this.table('recruitment_communication_templates')
    const rows = await teable.listAllRecords(table)
    if (rows.length) return
    const timestamp = now()
    const defaults = [
      { name: '首次意向沟通', category: '意向沟通', channel: '电话', content: '你好，我是方片招聘团队的{{招聘负责人}}。我们正在招聘{{岗位名称}}，你的经历与岗位有较高匹配，希望和你用几分钟了解当前求职意向、期望城市和到岗时间。' },
      { name: '公司与岗位介绍', category: '公司介绍', channel: '微信', content: '你好，补充发送方片及{{岗位名称}}的介绍。岗位核心目标是{{岗位目标}}，团队目前处于{{团队阶段}}。内容仅供你了解，如有关注点可以随时沟通。' },
      { name: '约定下次沟通', category: '跟进提醒', channel: '微信', content: '感谢今天的沟通。我们约定在{{下次跟进时间}}继续确认{{下一步行动}}，如你的安排有变化，也可以提前告诉我。' },
      { name: '暂不考虑回访', category: '拒绝回访', channel: '微信', content: '理解你目前暂不考虑机会。我们会在{{再联系时间}}前后再礼貌确认一次；如果你不希望后续联系，也可以直接告诉我。' },
    ]
    for (const item of defaults) {
      await teable.createRecord(table, {
        模板ID: id('commtpl'), 模板名称: item.name, 模板分类: item.category, 适用岗位: '', 适用渠道: item.channel,
        模板内容: item.content, 变量JSON: JSON.stringify([...item.content.matchAll(/{{([^}]+)}}/g)].map((match) => match[1])),
        模板状态: '启用', 创建人: '系统', 创建时间: timestamp, 更新时间: timestamp,
      })
    }
  }

  private async upsertFollowUpTask(candidateId: string, candidateName: string, deadline: string, owner: string, ownerUserId: string, description: string) {
    const deadlineTime = Date.parse(deadline)
    if (!Number.isFinite(deadlineTime)) throw new BadRequestException('下次跟进时间格式无效')
    const table = this.table('recruitment_tasks')
    const rows = await teable.listAllRecords(table)
    const existing = rows.find((row) => text(row.fields['待办类型']) === '人才跟进' && text(row.fields['对象ID']) === candidateId && text(row.fields['待办状态']) !== '已完成')
    const timestamp = now()
    const fields = {
      待办类型: '人才跟进', 对象类型: '人才', 对象ID: candidateId, 标题: `跟进${candidateName || '候选人'}`,
      描述: description || '按约定时间继续意向沟通', 处理人用户ID: ownerUserId, 处理人: owner,
      优先级: deadlineTime <= Date.now() ? '高' : '中', 待办状态: '待处理', 截止时间: new Date(deadlineTime).toISOString(),
      提醒时间: new Date(Math.max(Date.now(), deadlineTime - 3_600_000)).toISOString(), 更新时间: timestamp,
    }
    if (existing) await teable.updateRecord(table, existing.id, fields)
    else await teable.createRecord(table, { 待办ID: id('todo'), ...fields, 创建时间: timestamp })
  }

  private async completeTasks(type: string, objectId: string) {
    const table = this.table('recruitment_tasks')
    const rows = await teable.listAllRecords(table)
    const timestamp = now()
    for (const row of rows.filter((item) => text(item.fields['待办类型']) === type && text(item.fields['对象ID']) === objectId && text(item.fields['待办状态']) !== '已完成')) {
      await teable.updateRecord(table, row.id, { 待办状态: '已完成', 完成时间: timestamp, 更新时间: timestamp })
    }
  }

  async scanDuplicateCandidates(operator = '系统查重') {
    const candidateTable = this.table('recruitment_candidates')
    const rows = (await teable.listAllRecords(candidateTable)).filter((row) => text(row.fields['合并状态']) !== '已合并')
    if (rows.length > 3000) throw new BadRequestException('人才数量超过3000，请按批次执行疑似重复扫描')
    let created = 0
    let matched = 0
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
        const left = rows[leftIndex]
        const right = rows[rightIndex]
        if (!this.shouldCompareCandidates(left, right)) continue
        const similarity = this.duplicateSimilarity(left, right)
        if (similarity.overall < 55 && similarity.contact < 100) continue
        matched += 1
        if (await this.createDuplicateCase(left, right, similarity, operator)) created += 1
      }
    }
    return { scanned: rows.length, matchedPairs: matched, createdCases: created }
  }

  async listDuplicateCases(status = '待处理') {
    const [cases, candidates] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidate_duplicate_cases')),
      teable.listAllRecords(this.table('recruitment_candidates')),
    ])
    const items = cases
      .filter((row) => !status || status === '全部' || text(row.fields['案件状态']) === status)
      .map((row) => this.mapDuplicateCase(row, candidates))
      .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    return { total: items.length, cases: items }
  }

  async getDuplicateCase(caseId: string) {
    const [cases, candidates] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidate_duplicate_cases')),
      teable.listAllRecords(this.table('recruitment_candidates')),
    ])
    const row = cases.find((item) => text(item.fields['重复案件ID']) === caseId || item.id === caseId)
    if (!row) throw new NotFoundException('疑似重复案件不存在')
    const leftId = text(row.fields['候选人AID'])
    const rightId = text(row.fields['候选人BID'])
    const left = candidates.find((item) => text(item.fields['候选人ID']) === leftId || item.id === leftId)
    const right = candidates.find((item) => text(item.fields['候选人ID']) === rightId || item.id === rightId)
    if (!left || !right) throw new NotFoundException('疑似重复案件关联的人才档案不存在')
    const comparison = Object.entries(CANDIDATE_FIELD_MAP).map(([key, field]) => ({
      key, label: field, left: left.fields[field] ?? '', right: right.fields[field] ?? '',
      same: JSON.stringify(left.fields[field] ?? '') === JSON.stringify(right.fields[field] ?? ''),
    }))
    return {
      ...this.mapDuplicateCase(row, candidates),
      left: this.candidateSnapshot(left), right: this.candidateSnapshot(right), comparison,
    }
  }

  async mergeDuplicateCase(caseId: string, input: TalentMergeInput) {
    const start = Date.now()
    if (!text(input.reason)) throw new BadRequestException('合并人才时必须填写合并原因')
    const caseTable = this.table('recruitment_candidate_duplicate_cases')
    const caseRows = await teable.listAllRecords(caseTable)
    const duplicateCase = caseRows.find((row) => text(row.fields['重复案件ID']) === caseId || row.id === caseId)
    if (!duplicateCase) throw new NotFoundException('疑似重复案件不存在')
    if (!['待处理', '已撤销'].includes(text(duplicateCase.fields['案件状态']))) throw new BadRequestException('该疑似重复案件已经处理')
    const leftId = text(duplicateCase.fields['候选人AID'])
    const rightId = text(duplicateCase.fields['候选人BID'])
    const primaryId = text(input.primaryCandidateId)
    if (![leftId, rightId].includes(primaryId)) throw new BadRequestException('主档必须是案件中的候选人之一')
    const secondaryId = primaryId === leftId ? rightId : leftId
    const candidateTable = this.table('recruitment_candidates')
    const candidates = await teable.listAllRecords(candidateTable)
    const primary = candidates.find((row) => text(row.fields['候选人ID']) === primaryId || row.id === primaryId)
    const secondary = candidates.find((row) => text(row.fields['候选人ID']) === secondaryId || row.id === secondaryId)
    if (!primary || !secondary) throw new NotFoundException('待合并人才档案不存在')
    if (text(primary.fields['合并状态']) === '已合并' || text(secondary.fields['合并状态']) === '已合并') throw new BadRequestException('其中一份人才档案已经被合并')

    const mergeId = id('merge')
    const mergeTime = now()
    const operator = text(input.operator) || '当前用户'
    const primarySnapshot = { ...primary.fields }
    const secondarySnapshot = { ...secondary.fields }
    const mergeTable = this.table('recruitment_candidate_merge_events')
    const mergeRecord = await teable.createRecord(mergeTable, {
      合并事件ID: mergeId, 重复案件ID: text(duplicateCase.fields['重复案件ID']) || caseId,
      主档候选人ID: primaryId, 副档候选人ID: secondaryId, 字段选择JSON: JSON.stringify(input.fieldSources || {}),
      主档合并前快照JSON: JSON.stringify(primarySnapshot), 副档合并前快照JSON: JSON.stringify(secondarySnapshot),
      关联迁移JSON: '[]', 合并状态: '执行中', 操作人: operator, 合并原因: input.reason, 合并时间: mergeTime,
    })
    const mergedFields = this.buildMergedCandidateFields(primarySnapshot, secondarySnapshot, input.fieldSources || {}, mergeId, mergeTime)
    await teable.updateRecord(candidateTable, primary.id, mergedFields)
    const migrated: Array<{ table: string; recordId: string }> = []
    for (const tableName of MERGE_RELATION_TABLES) {
      const tableId = this.table(tableName)
      const rows = await teable.listAllRecords(tableId)
      for (const row of rows.filter((item) => text(item.fields['候选人ID']) === secondaryId)) {
        await teable.updateRecord(tableId, row.id, { 候选人ID: primaryId })
        migrated.push({ table: tableName, recordId: row.id })
      }
    }
    await teable.updateRecord(candidateTable, secondary.id, {
      合并状态: '已合并', 合并至候选人ID: primaryId, 合并事件ID: mergeId,
      候选人状态: '已归档', 归档时间: mergeTime, 重复检查状态: '已人工合并', 更新时间: mergeTime,
      联系锁定状态: '', 锁定人用户ID: '', 锁定人: '', 锁定到期时间: '',
    })
    await teable.updateRecord(caseTable, duplicateCase.id, {
      案件状态: '已合并', 处理结论: '确认同一人才', 主档候选人ID: primaryId,
      被合并候选人ID: secondaryId, 合并事件ID: mergeId, 处理人: operator,
      处理说明: input.reason, 处理时间: mergeTime, 更新时间: mergeTime,
    })
    await teable.updateRecord(mergeTable, mergeRecord.id, { 关联迁移JSON: JSON.stringify(migrated), 合并状态: '已合并' })
    await this.refreshCandidateDuplicateState(primaryId)
    await this.talentAudit('合并人才档案', '人才', primaryId, { primary: primarySnapshot, secondary: secondarySnapshot }, { mergeId, secondaryId, migrated }, operator, input.reason)
    this.invalidateDirectoryCache()
    this.logSlow('mergeDuplicateCase', start)
    return { mergeId, caseId, primaryCandidateId: primaryId, secondaryCandidateId: secondaryId, migratedRecords: migrated.length }
  }

  async resolveDuplicateCase(caseId: string, body: { result: string; note: string; operator?: string }) {
    const start = Date.now()
    if (text(body.result) !== 'not_duplicate') throw new BadRequestException('当前仅支持确认不是同一人')
    if (!text(body.note)) throw new BadRequestException('排除疑似重复时必须填写判断依据')
    const caseTable = this.table('recruitment_candidate_duplicate_cases')
    const cases = await teable.listAllRecords(caseTable)
    const duplicateCase = cases.find((row) => text(row.fields['重复案件ID']) === caseId || row.id === caseId)
    if (!duplicateCase) throw new NotFoundException('疑似重复案件不存在')
    if (text(duplicateCase.fields['案件状态']) !== '待处理') throw new BadRequestException('该疑似重复案件已经处理')
    const leftId = text(duplicateCase.fields['候选人AID'])
    const rightId = text(duplicateCase.fields['候选人BID'])
    const operator = text(body.operator) || '当前用户'
    const resolvedAt = now()
    await teable.updateRecord(caseTable, duplicateCase.id, {
      案件状态: '已排除', 处理结论: '确认不是同一人才', 处理人: operator,
      处理说明: body.note, 处理时间: resolvedAt, 更新时间: resolvedAt,
    })
    await this.refreshCandidateDuplicateState(leftId)
    await this.refreshCandidateDuplicateState(rightId)
    await this.talentAudit('排除疑似重复', '人才查重', text(duplicateCase.fields['重复案件ID']) || caseId,
      duplicateCase.fields, { leftId, rightId, result: 'not_duplicate' }, operator, body.note)
    this.invalidateDirectoryCache()
    this.logSlow('resolveDuplicateCase', start)
    return { caseId: text(duplicateCase.fields['重复案件ID']) || caseId, status: '已排除', leftCandidateId: leftId, rightCandidateId: rightId }
  }

  async undoMerge(mergeId: string, body: { reason: string; operator?: string }) {
    const start = Date.now()
    if (!text(body.reason)) throw new BadRequestException('撤销合并时必须填写原因')
    const mergeTable = this.table('recruitment_candidate_merge_events')
    const mergeRows = await teable.listAllRecords(mergeTable)
    const merge = mergeRows.find((row) => text(row.fields['合并事件ID']) === mergeId || row.id === mergeId)
    if (!merge) throw new NotFoundException('人才合并事件不存在')
    if (text(merge.fields['合并状态']) !== '已合并') throw new BadRequestException('该合并事件当前不能撤销')
    const primaryId = text(merge.fields['主档候选人ID'])
    const secondaryId = text(merge.fields['副档候选人ID'])
    const candidateTable = this.table('recruitment_candidates')
    const candidates = await teable.listAllRecords(candidateTable)
    const primary = candidates.find((row) => text(row.fields['候选人ID']) === primaryId || row.id === primaryId)
    const secondary = candidates.find((row) => text(row.fields['候选人ID']) === secondaryId || row.id === secondaryId)
    if (!primary || !secondary) throw new NotFoundException('合并关联的人才档案不存在')
    const mergeTime = text(merge.fields['合并时间'])
    if (text(primary.fields['更新时间']) !== mergeTime) throw new ConflictException('主档在合并后已被修改，为避免覆盖新数据，请人工处理撤销')
    const primarySnapshot = json<Record<string, unknown>>(merge.fields['主档合并前快照JSON'], {})
    const secondarySnapshot = json<Record<string, unknown>>(merge.fields['副档合并前快照JSON'], {})
    const migrated = json<Array<{ table: string; recordId: string }>>(merge.fields['关联迁移JSON'], [])
    for (const relation of migrated) {
      const tableId = this.table(relation.table)
      const rows = await teable.listAllRecords(tableId)
      const row = rows.find((item) => item.id === relation.recordId)
      if (row && text(row.fields['候选人ID']) === primaryId) await teable.updateRecord(tableId, row.id, { 候选人ID: secondaryId })
    }
    await teable.updateRecord(candidateTable, primary.id, primarySnapshot)
    await teable.updateRecord(candidateTable, secondary.id, secondarySnapshot)
    const caseId = text(merge.fields['重复案件ID'])
    const caseTable = this.table('recruitment_candidate_duplicate_cases')
    const caseRows = await teable.listAllRecords(caseTable)
    const duplicateCase = caseRows.find((row) => text(row.fields['重复案件ID']) === caseId || row.id === caseId)
    if (duplicateCase) await teable.updateRecord(caseTable, duplicateCase.id, { 案件状态: '已撤销', 处理结论: '合并已撤销', 更新时间: now() })
    const undoTime = now()
    await teable.updateRecord(mergeTable, merge.id, { 合并状态: '已撤销', 撤销人: text(body.operator) || '当前用户', 撤销原因: body.reason, 撤销时间: undoTime })
    await this.refreshCandidateDuplicateState(primaryId)
    await this.refreshCandidateDuplicateState(secondaryId)
    await this.talentAudit('撤销人才合并', '人才合并', mergeId, { primaryId, secondaryId }, { restoredRelations: migrated.length }, text(body.operator) || '当前用户', body.reason)
    this.invalidateDirectoryCache()
    this.logSlow('undoMerge', start)
    return { mergeId, status: '已撤销', primaryCandidateId: primaryId, secondaryCandidateId: secondaryId, restoredRecords: migrated.length }
  }

  async updateOwnership(candidateId: string, input: TalentOwnershipInput) {
    const start = Date.now()
    if (!text(input.owner)) throw new BadRequestException('请选择人才负责人')
    if (!text(input.reason)) throw new BadRequestException('请填写负责人变更原因')
    const candidateTable = this.table('recruitment_candidates')
    const candidate = await this.findCandidateRow(candidateId)
    if (text(candidate.fields['合并状态']) === '已合并') throw new BadRequestException('已合并副档不能单独分配负责人')
    const fields = { 负责人用户ID: text(input.ownerUserId), 负责人: text(input.owner), 更新时间: now() }
    await teable.updateRecord(candidateTable, candidate.id, fields)
    await teable.createRecord(this.table('recruitment_candidate_owner_events'), {
      归属事件ID: id('talowner'), 候选人ID: candidateId,
      原负责人用户ID: text(candidate.fields['负责人用户ID']), 原负责人: text(candidate.fields['负责人']),
      新负责人用户ID: text(input.ownerUserId), 新负责人: text(input.owner),
      变更原因: input.reason, 操作人: text(input.operator) || '当前用户', 发生时间: now(),
    })
    await this.talentAudit('变更人才负责人', '人才', candidateId, candidate.fields, fields, text(input.operator) || '当前用户', input.reason)
    this.invalidateDirectoryCache()
    this.logSlow('updateOwnership', start)
    return { candidateId, owner: text(input.owner), ownerUserId: text(input.ownerUserId), reason: input.reason, updatedAt: now() }
  }

  async updateBirthYear(candidateId: string, input: TalentBirthYearInput) {
    const start = Date.now()
    const currentYear = new Date().getUTCFullYear()
    const birthYear = Math.round(num(input.birthYear))
    if (birthYear < currentYear - 80 || birthYear > currentYear - 15) throw new BadRequestException(`出生年份应在${currentYear - 80}至${currentYear - 15}之间`)
    if (!text(input.reason)) throw new BadRequestException('请填写出生年份修正原因和核对依据')
    const candidate = await this.findCandidateRow(candidateId)
    if (text(candidate.fields['合并状态']) === '已合并') throw new BadRequestException('已合并副档不能单独修正出生年份')
    const resumes = await teable.listAllRecords(this.table('resume_extraction_records'))
    const latestResumeId = text(candidate.fields['最新简历记录ID'])
    const resume = resumes.find((row) => row.id === latestResumeId || text(row.fields['解析记录ID']) === latestResumeId || text(row.fields['候选人ID']) === candidateId)
    const conflicts = this.birthYearSignals(candidate, resume)
    const timestamp = now(), operator = text(input.operator) || '当前用户'
    const fields = {
      出生年份: birthYear,
      年龄: currentYear - birthYear,
      出生年份来源: '人工修正',
      出生年份确认状态: '人工已确认',
      出生年份冲突JSON: JSON.stringify(conflicts),
      出生年份修正原因: text(input.reason),
      出生年份修正人用户ID: text(input.operatorUserId),
      出生年份修正人: operator,
      出生年份修正时间: timestamp,
      更新时间: timestamp,
    }
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, fields)
    await this.talentAudit('修正出生年份', '人才', candidateId, { birthYear: num(candidate.fields['出生年份']), age: num(candidate.fields['年龄']), signals: conflicts }, fields, operator, input.reason)
    this.invalidateDirectoryCache()
    this.logSlow('updateBirthYear', start)
    return { candidateId, birthYear, age: currentYear - birthYear, confirmStatus: '人工已确认', updatedAt: timestamp }
  }

  async updateName(candidateId: string, input: TalentNameInput) {
    const start = Date.now()
    const name = text(input.name).trim()
    if (!name) throw new BadRequestException('请填写人才姓名')
    if (name.length > 50) throw new BadRequestException('人才姓名不能超过50个字符')
    if (/[\u0000-\u001f]/.test(name)) throw new BadRequestException('人才姓名不能包含控制字符')
    const candidate = await this.findCandidateRow(candidateId)
    if (text(candidate.fields['合并状态']) === '已合并') throw new BadRequestException('已合并副档不能单独修改姓名')

    const previousName = text(candidate.fields['姓名'])
    const timestamp = now(), operator = text(input.operator) || '当前用户'
    const candidateFields = { 姓名: name, 更新时间: timestamp }
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, candidateFields)

    const resumeTable = this.table('resume_extraction_records')
    const resumeRows = await teable.listByField(resumeTable, '候选人ID', candidateId, 100)
    const latestResumeId = text(candidate.fields['最新简历记录ID'])
    const resume = resumeRows.find((row) => [row.id, text(row.fields['解析记录ID'])].includes(latestResumeId))
      || resumeRows.sort((left, right) => (text(right.fields['更新时间']) || text(right.fields['创建时间']) || right.createdTime || '').localeCompare(text(left.fields['更新时间']) || text(left.fields['创建时间']) || left.createdTime || ''))[0]
    let resumeId = ''
    if (resume) {
      resumeId = text(resume.fields['解析记录ID']) || resume.id
      const correction = {
        changes: [{ field: '姓名', before: text(resume.fields['姓名']), after: name }],
        reason: '人工修改人才名称',
        operator,
        reviewedAt: timestamp,
      }
      await teable.updateRecord(resumeTable, resume.id, {
        姓名: name,
        人工复核状态: '已修正',
        人工修正内容: JSON.stringify(correction),
        更新时间: timestamp,
      })
    }

    this.invalidateDirectoryCache()
    await this.talentAudit('修改人才名称', '人才', candidateId, { name: previousName, resumeId }, { name, resumeId }, operator, '人才档案人工修改姓名')
    this.logSlow('updateName', start)
    return { candidateId, name, resumeId, updatedAt: timestamp, talent: await this.detail(candidateId) }
  }

  async batch(input: TalentBatchInput) {
    const start = Date.now()
    const candidateIds = [...new Set((input.candidateIds || []).map(text).filter(Boolean))]
    if (!candidateIds.length) throw new BadRequestException('请至少选择一位人才')
    if (candidateIds.length > 100) throw new BadRequestException('单次批量操作最多处理100位人才')
    if (!['assign_owner', 'add_tag'].includes(input.action)) throw new BadRequestException('不支持的批量操作')
    if (!text(input.reason)) throw new BadRequestException('批量操作必须填写原因')
    if (input.action === 'assign_owner' && !text(input.owner)) throw new BadRequestException('请选择负责人')
    if (input.action === 'add_tag' && !text(input.tag)) throw new BadRequestException('请填写人才标签')
    const operator = text(input.operator) || '当前用户', timestamp = now()
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const tags = input.action === 'add_tag' ? await teable.listAllRecords(this.table('recruitment_candidate_tags')) : []
    const results: Array<{ candidateId: string; status: 'success' | 'failed'; message: string }> = []
    for (const candidateId of candidateIds) {
      try {
        const candidate = candidates.find(row => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
        if (!candidate) throw new Error('人才档案不存在')
        if (text(candidate.fields['合并状态']) === '已合并') throw new Error('已合并副档不能批量操作')
        if (input.action === 'assign_owner') {
          const fields = { 负责人用户ID: text(input.ownerUserId), 负责人: text(input.owner), 更新时间: timestamp }
          await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, fields)
          await teable.createRecord(this.table('recruitment_candidate_owner_events'), { 归属事件ID: id('talowner'), 候选人ID: candidateId, 原负责人用户ID: text(candidate.fields['负责人用户ID']), 原负责人: text(candidate.fields['负责人']), 新负责人用户ID: text(input.ownerUserId), 新负责人: text(input.owner), 变更原因: input.reason, 操作人: operator, 发生时间: timestamp })
          await this.talentAudit('批量变更人才负责人', '人才', candidateId, candidate.fields, fields, operator, input.reason)
        } else {
          const existing = tags.find(row => text(row.fields['候选人ID']) === candidateId && text(row.fields['标签名称']) === text(input.tag))
          const fields = { 标签名称: text(input.tag), 标签分类: text(input.tagCategory) || '人工标签', 标签来源: '人工批量操作', 置信度: 100, 证据: input.reason, 人工确认状态: '人工已确认', 更新时间: timestamp }
          if (existing) await teable.updateRecord(this.table('recruitment_candidate_tags'), existing.id, fields)
          else await teable.createRecord(this.table('recruitment_candidate_tags'), { 标签记录ID: id('tag'), 候选人ID: candidateId, ...fields, 分析版本: '', 创建时间: timestamp })
          await this.talentAudit('批量添加人才标签', '人才', candidateId, {}, fields, operator, input.reason)
        }
        results.push({ candidateId, status: 'success', message: input.action === 'assign_owner' ? `已分配给${text(input.owner)}` : `已添加标签${text(input.tag)}` })
      } catch (error) {
        results.push({ candidateId, status: 'failed', message: error instanceof Error ? error.message : '处理失败' })
      }
    }
    const succeeded = results.filter(item => item.status === 'success').length
    this.invalidateDirectoryCache()
    this.logSlow('batch', start)
    return { action: input.action, total: results.length, succeeded, failed: results.length - succeeded, partial: succeeded > 0 && succeeded < results.length, results, operatedAt: timestamp, operator }
  }

  async acquireContactLock(candidateId: string, input: TalentContactLockInput) {
    const start = Date.now()
    if (!text(input.operator)) throw new BadRequestException('锁定人才前必须提供操作人')
    const candidate = await this.findCandidateRow(candidateId)
    if (text(candidate.fields['合并状态']) === '已合并') throw new BadRequestException('已合并副档不能发起联系')
    const lockTable = this.table('recruitment_candidate_contact_locks')
    const rows = await teable.listAllRecords(lockTable)
    const currentTime = Date.now()
    const identity = text(input.operatorUserId) || text(input.operator)
    const active = rows.find((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['锁定状态']) === '生效中' && Date.parse(text(row.fields['到期时间'])) > currentTime)
    const activeIdentity = text(active?.fields['锁定人用户ID']) || text(active?.fields['锁定人'])
    if (active && activeIdentity !== identity) {
      throw new ConflictException({
        message: `该人才正在由${text(active.fields['锁定人']) || '其他招聘人员'}联系`,
        code: 'CONTACT_LOCKED', holder: text(active.fields['锁定人']), expiresAt: text(active.fields['到期时间']),
      })
    }
    const duration = Math.max(15, Math.min(240, Math.round(num(input.durationMinutes) || 60)))
    const lockTime = now()
    const expiresAt = new Date(currentTime + duration * 60_000).toISOString()
    const fields = {
      候选人ID: candidateId, 锁定人用户ID: text(input.operatorUserId), 锁定人: text(input.operator), 锁定状态: '生效中',
      到期时间: expiresAt, 最近续期时间: lockTime, 释放时间: '', 释放原因: '',
    }
    let lockId = text(active?.fields['联系锁ID'])
    if (active) await teable.updateRecord(lockTable, active.id, fields)
    else {
      lockId = id('contactlock')
      await teable.createRecord(lockTable, { 联系锁ID: lockId, ...fields, 锁定时间: lockTime })
    }
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, {
      联系锁定状态: '生效中', 锁定人用户ID: text(input.operatorUserId), 锁定人: text(input.operator), 锁定到期时间: expiresAt, 更新时间: lockTime,
    })
    this.invalidateDirectoryCache()
    this.logSlow('acquireContactLock', start)
    return { lockId, candidateId, holder: text(input.operator), expiresAt, durationMinutes: duration }
  }

  async releaseContactLock(candidateId: string, body: { reason: string; operator?: string; operatorUserId?: string }) {
    const start = Date.now()
    if (!text(body.reason)) throw new BadRequestException('释放联系锁时必须填写原因')
    const candidate = await this.findCandidateRow(candidateId)
    const lockTable = this.table('recruitment_candidate_contact_locks')
    const rows = await teable.listAllRecords(lockTable)
    const active = rows.find((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['锁定状态']) === '生效中')
    if (!active) return { candidateId, released: false, reason: '当前没有生效中的联系锁' }
    const actorIdentity = text(body.operatorUserId) || text(body.operator)
    const holderIdentity = text(active.fields['锁定人用户ID']) || text(active.fields['锁定人'])
    if (actorIdentity && actorIdentity !== holderIdentity && !text(body.operator).includes('管理员')) {
      throw new ConflictException('只有锁定人或管理员可以释放联系锁')
    }
    const releasedAt = now()
    await teable.updateRecord(lockTable, active.id, { 锁定状态: '已释放', 释放时间: releasedAt, 释放原因: body.reason })
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, {
      联系锁定状态: '已释放', 锁定人用户ID: '', 锁定人: '', 锁定到期时间: '', 更新时间: releasedAt,
    })
    this.invalidateDirectoryCache()
    this.logSlow('releaseContactLock', start)
    return { candidateId, released: true, releasedAt }
  }

  async releaseExpiredContactLocks(operator = '系统') {
    const start = Date.now()
    const lockTable = this.table('recruitment_candidate_contact_locks')
    const rows = await teable.listAllRecords(lockTable)
    const expired = rows.filter((row) => text(row.fields['锁定状态']) === '生效中' && Date.parse(text(row.fields['到期时间'])) <= Date.now())
    const candidateTable = this.table('recruitment_candidates')
    const candidates = await teable.listAllRecords(candidateTable)
    const releasedAt = now()
    for (const lock of expired) {
      await teable.updateRecord(lockTable, lock.id, { 锁定状态: '已过期', 释放时间: releasedAt, 释放原因: '锁定超时自动释放' })
      const candidateId = text(lock.fields['候选人ID'])
      const candidate = candidates.find((row) => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
      if (candidate && text(candidate.fields['锁定到期时间']) === text(lock.fields['到期时间'])) {
        await teable.updateRecord(candidateTable, candidate.id, { 联系锁定状态: '已过期', 锁定人用户ID: '', 锁定人: '', 锁定到期时间: '', 更新时间: releasedAt })
      }
    }
    this.invalidateDirectoryCache()
    this.logSlow('releaseExpiredContactLocks', start)
    return { checked: rows.filter((row) => text(row.fields['锁定状态']) === '生效中').length, released: expired.length, operator }
  }

  async releaseStaleOwnership(body: { inactiveDays?: number; dryRun?: boolean; operator?: string }) {
    const start = Date.now()
    const inactiveDays = Math.max(3, Math.min(90, Math.round(num(body.inactiveDays) || 14)))
    const dryRun = body.dryRun !== false
    const operator = text(body.operator) || '系统'
    const cutoff = Date.now() - inactiveDays * 86_400_000
    const [candidates, applications, communications] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_applications')),
      teable.listAllRecords(this.table('recruitment_communications')),
    ])
    const protectedStages = new Set(['Offer沟通', '背调', '待入职', '已入职'])
    const stale = candidates.filter((candidate) => {
      const candidateId = text(candidate.fields['候选人ID']) || candidate.id
      if (!text(candidate.fields['负责人']) || text(candidate.fields['合并状态']) === '已合并') return false
      const relatedApplications = applications.filter((row) => text(row.fields['候选人ID']) === candidateId)
      if (relatedApplications.some((row) => protectedStages.has(text(row.fields['当前阶段'])) && text(row.fields['当前状态']) !== '已结束')) return false
      const activityTimes = [text(candidate.fields['最近联系时间']), text(candidate.fields['更新时间']),
        ...relatedApplications.map((row) => text(row.fields['最近处理时间']) || text(row.fields['更新时间'])),
        ...communications.filter((row) => text(row.fields['候选人ID']) === candidateId).map((row) => text(row.fields['发生时间']) || text(row.fields['创建时间'])),
      ].filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite)
      return (activityTimes.length ? Math.max(...activityTimes) : 0) <= cutoff
    })
    const items = stale.map((row) => ({
      candidateId: text(row.fields['候选人ID']) || row.id, name: text(row.fields['姓名']), owner: text(row.fields['负责人']),
      lastActivityAt: text(row.fields['最近联系时间']) || text(row.fields['更新时间']) || text(row.fields['创建时间']),
    }))
    if (!dryRun) {
      const releasedAt = now()
      for (const candidate of stale) {
        const candidateId = text(candidate.fields['候选人ID']) || candidate.id
        await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 负责人用户ID: '', 负责人: '', 更新时间: releasedAt })
        await teable.createRecord(this.table('recruitment_candidate_owner_events'), {
          归属事件ID: id('talowner'), 候选人ID: candidateId,
          原负责人用户ID: text(candidate.fields['负责人用户ID']), 原负责人: text(candidate.fields['负责人']),
          新负责人用户ID: '', 新负责人: '', 变更原因: `连续${inactiveDays}天无有效跟进，按规则释放至公共人才池`, 操作人: operator, 发生时间: releasedAt,
        })
        await this.talentAudit('释放长期未跟进人才', '人才', candidateId, candidate.fields,
          { owner: '', inactiveDays }, operator, `连续${inactiveDays}天无有效跟进`)
      }
      this.invalidateDirectoryCache()
    }
    this.logSlow('releaseStaleOwnership', start)
    return { inactiveDays, dryRun, total: items.length, released: dryRun ? 0 : items.length, candidates: items }
  }

  private async ensureDuplicateCase(candidateId: string, other: TeableRecord) {
    const rows = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = rows.find((row) => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
    if (!candidate) return false
    return this.createDuplicateCase(candidate, other, this.duplicateSimilarity(candidate, other), '简历入库查重')
  }

  private async refreshCandidateDuplicateState(candidateId: string) {
    const [candidates, cases] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_candidate_duplicate_cases')),
    ])
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
    if (!candidate || text(candidate.fields['合并状态']) === '已合并') return
    const pendingIds = cases
      .filter((row) => text(row.fields['案件状态']) === '待处理'
        && [text(row.fields['候选人AID']), text(row.fields['候选人BID'])].includes(candidateId))
      .map((row) => text(row.fields['候选人AID']) === candidateId ? text(row.fields['候选人BID']) : text(row.fields['候选人AID']))
      .filter(Boolean)
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, {
      重复检查状态: pendingIds.length ? '疑似重复待处理' : '人工复核无重复',
      疑似重复候选人JSON: JSON.stringify([...new Set(pendingIds)]),
    })
  }

  private shouldCompareCandidates(left: TeableRecord, right: TeableRecord) {
    const leftName = text(left.fields['姓名']).replace(/\s+/g, '')
    const rightName = text(right.fields['姓名']).replace(/\s+/g, '')
    const sameContact = ['电话', '邮箱', '微信'].some((field) => {
      const a = text(left.fields[field]).toLowerCase()
      const b = text(right.fields[field]).toLowerCase()
      return Boolean(a && b && a === b)
    })
    return sameContact || Boolean(leftName && rightName && leftName === rightName)
  }

  private duplicateSimilarity(left: TeableRecord, right: TeableRecord) {
    const leftName = text(left.fields['姓名']).replace(/\s+/g, '')
    const rightName = text(right.fields['姓名']).replace(/\s+/g, '')
    const name = leftName && rightName && leftName === rightName ? 100 : 0
    const contactFields = ['电话', '邮箱', '微信']
    const matchedContacts = contactFields.filter((field) => {
      const a = text(left.fields[field]).toLowerCase()
      const b = text(right.fields[field]).toLowerCase()
      return Boolean(a && b && a === b)
    })
    const contact = matchedContacts.length ? 100 : 0
    const educationShared = this.sharedTokens(text(left.fields['教育经历']), text(right.fields['教育经历']))
    const workShared = this.sharedTokens(text(left.fields['工作经历']), text(right.fields['工作经历']))
    const education = clamp(educationShared * 30)
    const work = clamp(workShared * 20)
    const overall = clamp(contact * 0.45 + name * 0.25 + education * 0.1 + work * 0.2)
    const reasons = [
      ...matchedContacts.map((field) => `${field}一致`),
      ...(name === 100 ? ['姓名一致'] : []),
      ...(educationShared ? [`教育经历命中${educationShared}个共同词`] : []),
      ...(workShared ? [`工作经历命中${workShared}个共同词`] : []),
    ]
    return { overall, name, contact, education, work, reasons }
  }

  private async createDuplicateCase(
    left: TeableRecord,
    right: TeableRecord,
    similarity: ReturnType<TalentsService['duplicateSimilarity']>,
    operator: string,
  ) {
    const leftId = text(left.fields['候选人ID']) || left.id
    const rightId = text(right.fields['候选人ID']) || right.id
    if (leftId === rightId) return false
    const [candidateAId, candidateBId] = [leftId, rightId].sort()
    const caseTable = this.table('recruitment_candidate_duplicate_cases')
    const cases = await teable.listAllRecords(caseTable)
    const existing = cases.find((row) => {
      const pair = [text(row.fields['候选人AID']), text(row.fields['候选人BID'])].sort()
      return pair[0] === candidateAId && pair[1] === candidateBId
    })
    if (existing) return false
    const caseId = id('duplicate')
    const timestamp = now()
    await teable.createRecord(caseTable, {
      重复案件ID: caseId, 候选人AID: candidateAId, 候选人BID: candidateBId,
      综合相似分: similarity.overall, 姓名相似分: similarity.name, 联系方式相似分: similarity.contact,
      教育经历相似分: similarity.education, 工作经历相似分: similarity.work,
      命中原因JSON: JSON.stringify(similarity.reasons), 案件状态: '待处理', 处理结论: '',
      处理人: '', 处理说明: `由${operator}发现`, 创建时间: timestamp, 更新时间: timestamp,
    })
    await this.markCandidateSuspicious(left, rightId)
    await this.markCandidateSuspicious(right, leftId)
    return true
  }

  private async markCandidateSuspicious(candidate: TeableRecord, otherId: string) {
    const start = Date.now()
    const suspicious = new Set(json<string[]>(candidate.fields['疑似重复候选人JSON'], []))
    suspicious.add(otherId)
    await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, {
      重复检查状态: '疑似重复待处理', 疑似重复候选人JSON: JSON.stringify([...suspicious]), 更新时间: now(),
    })
    this.invalidateDirectoryCache()
    this.logSlow('markCandidateSuspicious', start)
  }

  private mapDuplicateCase(row: TeableRecord, candidates: TeableRecord[]) {
    const leftId = text(row.fields['候选人AID'])
    const rightId = text(row.fields['候选人BID'])
    const left = candidates.find((item) => text(item.fields['候选人ID']) === leftId || item.id === leftId)
    const right = candidates.find((item) => text(item.fields['候选人ID']) === rightId || item.id === rightId)
    return {
      id: text(row.fields['重复案件ID']) || row.id, status: text(row.fields['案件状态']), score: num(row.fields['综合相似分']),
      left: { id: leftId, name: text(left?.fields['姓名']), phone: text(left?.fields['电话']), currentCompany: text(left?.fields['当前公司']) },
      right: { id: rightId, name: text(right?.fields['姓名']), phone: text(right?.fields['电话']), currentCompany: text(right?.fields['当前公司']) },
      scores: { name: num(row.fields['姓名相似分']), contact: num(row.fields['联系方式相似分']), education: num(row.fields['教育经历相似分']), work: num(row.fields['工作经历相似分']) },
      reasons: json<string[]>(row.fields['命中原因JSON'], []), conclusion: text(row.fields['处理结论']),
      primaryCandidateId: text(row.fields['主档候选人ID']), secondaryCandidateId: text(row.fields['被合并候选人ID']),
      mergeId: text(row.fields['合并事件ID']), operator: text(row.fields['处理人']), note: text(row.fields['处理说明']),
      createdAt: text(row.fields['创建时间']), updatedAt: text(row.fields['更新时间']),
    }
  }

  private candidateSnapshot(row: TeableRecord) {
    return {
      id: text(row.fields['候选人ID']) || row.id, recordId: row.id,
      name: text(row.fields['姓名']), phone: text(row.fields['电话']), email: text(row.fields['邮箱']), wechat: text(row.fields['微信']),
      currentCompany: text(row.fields['当前公司']), currentRole: text(row.fields['当前职位']), owner: text(row.fields['负责人']),
      updatedTime: text(row.fields['更新时间']), createdTime: text(row.fields['创建时间']),
      ...row.fields,
    }
  }

  private buildMergedCandidateFields(
    primary: Record<string, any>,
    secondary: Record<string, any>,
    fieldSources: Record<string, 'primary' | 'secondary'>,
    mergeId: string,
    mergeTime: string,
  ) {
    const fields: Record<string, unknown> = { ...primary }
    for (const [key, field] of Object.entries(CANDIDATE_FIELD_MAP)) {
      const source = fieldSources[key]
      if (source === 'secondary') fields[field] = secondary[field]
      else if (!text(fields[field]) && text(secondary[field])) fields[field] = secondary[field]
    }
    fields['技能JSON'] = JSON.stringify([...new Set([...json<string[]>(primary['技能JSON'], []), ...json<string[]>(secondary['技能JSON'], [])])])
    const firstTimes = [text(primary['首次进入时间']), text(secondary['首次进入时间'])].filter(Boolean).sort()
    fields['首次进入时间'] = firstTimes[0] || mergeTime
    if (text(secondary['更新时间']) > text(primary['更新时间'])) fields['最新简历记录ID'] = secondary['最新简历记录ID'] || primary['最新简历记录ID']
    fields['重复检查状态'] = '已人工合并'
    fields['疑似重复候选人JSON'] = '[]'
    fields['合并状态'] = '主档'
    fields['合并至候选人ID'] = ''
    fields['合并事件ID'] = mergeId
    fields['更新时间'] = mergeTime
    return fields
  }

  private async findCandidateRow(candidateId: string) {
    const candidateTable = this.table('recruitment_candidates')
    const row = await teable.findOneByField(candidateTable, '候选人ID', candidateId)
    if (row) return row
    try {
      return await teable.getRecord(candidateTable, candidateId)
    } catch {
      throw new NotFoundException('人才档案不存在')
    }
  }

  private async talentAudit(action: string, objectType: string, objectId: string, before: unknown, after: unknown, operator: string, reason = '') {
    await teable.createRecord(this.table('recruitment_audit_logs'), {
      日志ID: id('audit'), 操作人: operator, 操作类型: action, 对象类型: objectType, 对象ID: objectId,
      修改前摘要JSON: JSON.stringify(before), 修改后摘要JSON: JSON.stringify(after), 操作原因: reason,
      请求ID: id('req'), 发生时间: now(), 操作结果: '成功', 错误信息: '',
    })
  }

  private findRecordIdByBusinessId(rows: TeableRecord[], field: string, value: string) {
    const row = rows.find((item) => text(item.fields[field]) === value || item.id === value)
    if (!row) throw new NotFoundException('数据记录不存在')
    return row.id
  }

  private birthYearSignals(candidate: TeableRecord, resume?: TeableRecord) {
    const currentYear = new Date().getUTCFullYear(), signals: Array<{ year: number; source: string }> = []
    const add = (year: number, source: string) => {
      const value = Math.round(year)
      if (value >= currentYear - 80 && value <= currentYear - 15 && !signals.some((item) => item.year === value && item.source === source)) signals.push({ year: value, source })
    }
    add(num(candidate.fields['出生年份']), text(candidate.fields['出生年份来源']) || '人才主档出生年份')
    if (num(candidate.fields['年龄'])) add(currentYear - num(candidate.fields['年龄']), '人才主档年龄换算')
    if (num(resume?.fields['年龄'])) add(currentYear - num(resume?.fields['年龄']), '最新简历年龄换算')
    const raw = text(resume?.fields['OCR原文'])
    const rawYear = raw.match(/(?:出生(?:年份|年)?|生于)\s*[:：]?\s*((?:19|20)\d{2})/)?.[1]
    const rawAge = raw.match(/(?:年龄|Age)\s*[:：]?\s*(\d{1,2})/i)?.[1]
    if (rawYear) add(Number(rawYear), '简历原文出生年份')
    if (rawAge) add(currentYear - Number(rawAge), '简历原文年龄换算')
    const years = [...new Set(signals.map((item) => item.year))]
    return { hasConflict: years.length > 1, years, signals, checkedAt: now() }
  }

  private findStrongCandidate(rows: TeableRecord[], resume: ResumeTalentInput) {
    const contactlessName = !text(resume.phone) && !text(resume.email) && !text(resume.wechat)
      ? normalizeCandidateName(resume.name)
      : ''
    const canMatchByName = Boolean(contactlessName && !['未识别姓名', '未知姓名', '匿名'].includes(contactlessName))
    return rows.find((row) => text(row.fields['合并状态']) !== '已合并' && ((resume.phone && text(row.fields['电话']) === resume.phone)
      || (resume.email && text(row.fields['邮箱']).toLowerCase() === resume.email.toLowerCase())
      || (resume.wechat && text(row.fields['微信']) === resume.wechat)
      // 简历没有任何联系方式时，不能仅凭姓名直接归并——同名不同人的情况很常见。
      // 改为：同名 + 至少一个其他维度（教育经历、工作经历、技能）有交集才算强匹配。
      || (canMatchByName && normalizeCandidateName(row.fields['姓名']) === contactlessName
          && this.sharedTokens(`${text(row.fields['教育经历'])} ${text(row.fields['工作经历'])}`, `${resume.educationBackground} ${resume.workExperience}`) >= 1)))
  }

  private findSuspiciousCandidates(rows: TeableRecord[], resume: ResumeTalentInput) {
    const name = resume.name.replace(/\s+/g, '')
    if (!name) return []
    return rows.filter((row) => {
      if (text(row.fields['合并状态']) === '已合并') return false
      if (text(row.fields['姓名']).replace(/\s+/g, '') !== name) return false
      const previous = `${text(row.fields['教育经历'])} ${text(row.fields['工作经历'])}`
      return this.sharedTokens(previous, `${resume.educationBackground} ${resume.workExperience}`) >= 1
    }).slice(0, 10)
  }

  private sharedTokens(a: string, b: string) {
    const tokens = (value: string) => new Set(value.toLowerCase().split(/[\s、,，。；;：:\/|（）()]+/).filter((item) => item.length >= 2))
    const left = tokens(a)
    return [...tokens(b)].filter((item) => left.has(item)).length
  }

  private extractSkills(value: string) {
    return [...new Set(value.split(/[、,，。；;\n\/|]+/).map((item) => item.trim()).filter((item) => item.length >= 2))].slice(0, 20)
  }

  private async analyzeRun(resume: ResumeTalentInput): Promise<AnalysisRun> {
    const fallback = this.fallbackAnalysis(resume)
    const startedAt = now(), started = Date.now(), promptVersion = 'talent-analysis-prompt-v4', modelVersion = 'platform-llm'
    const positions = await teable.listAllRecords(this.table('recruitment_positions'))
    const positionCatalog = positions.map((row) => {
      const name = text(row.fields['职位名称'])
      if (!name) return ''
      const department = text(row.fields['部门'])
      const details = [row.fields['岗位JD'], row.fields['工作职责'], row.fields['任职要求']]
        .map(text).filter(Boolean).join('；').replace(/\s+/g, ' ').slice(0, 96)
      return `- ${department ? `${department} / ` : ''}${name}${details ? `：${details}` : ''}`
    }).filter(Boolean).join('\n')
    const prompt = `你是企业招聘人才分析助手。只能依据简历内容和下方真实岗位目录，不得根据年龄、性别等无关特征评分，不得编造。\n评分方法：skillMatch 30%、experience 25%、industryMatch 20%、education 15%、stability 10%；overall按这个权重综合，不要用四个能力分的平均值。experience根据工作经历时间推断；stability根据平均在职时长和跳槽频率推断；authenticityRisk检查时间重叠、夸大描述、模糊描述、经验与年限矛盾。信息不足时降低confidence和对应分，并写入risks。推荐岗位时必须检查完整目录及部门，优先选择与简历经历、技能和任职要求最吻合的岗位；recommendedRoles最多5个，必须使用目录中的准确岗位名称，并与summary中的适配方向保持一致；没有合适岗位时才允许按求职意向给出岗位名。\n返回纯JSON：summary字符串；strengths字符串数组；risks字符串数组（只写待面试确认项）；skills字符串数组；recommendedRoles字符串数组；scores对象含business、management、logic、communication、overall，均为0-100；scoreDimensions对象含education、experience、skillMatch、industryMatch、stability，均为0-100；authenticityRisk只能是低、中、较高、高；evidence对象含business、management、logic、communication，每项必须引用或概括简历证据；confidence只能是高、中、低。\n\n真实岗位目录（每个岗位均列出部门和名称）：\n${positionCatalog}\n\n姓名：${resume.name}\n求职意向：${resume.jobIntention}\n技能：${resume.skillsCertificates}\n教育：${resume.educationBackground}\n工作经历：${resume.workExperience}\n自我评价：${resume.selfEvaluation}\n原文：${resume.rawText.slice(0, 18000)}`
    try {
      const answer = await withTimeout(llm.chat([{ role: 'user', content: prompt }]), 120_000, 'AI分析超时')
      const value = JSON.parse(answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim())
      return { analysis: this.validateAnalysis(value, fallback), status: '成功', durationMs: Date.now() - started, error: '', promptVersion, modelVersion, inputChars: prompt.length, outputChars: answer.length, startedAt, completedAt: now() }
    } catch (error) {
      return { analysis: fallback, status: '规则降级', durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error), promptVersion, modelVersion, inputChars: prompt.length, outputChars: 0, startedAt, completedAt: now() }
    }
  }

  private validateAnalysis(value: any, fallback: TalentAnalysis): TalentAnalysis {
    const list = (input: unknown, base: string[]) => Array.isArray(input) ? input.map(text).filter(Boolean).slice(0, 20) : base
    const score = (input: unknown, base: number) => Number.isFinite(Number(input)) ? clamp(Number(input)) : base
    return {
      summary: text(value?.summary) || fallback.summary,
      strengths: list(value?.strengths, fallback.strengths), risks: list(value?.risks, fallback.risks),
      skills: list(value?.skills, fallback.skills), recommendedRoles: list(value?.recommendedRoles, fallback.recommendedRoles),
      scores: {
        business: score(value?.scores?.business, fallback.scores.business), management: score(value?.scores?.management, fallback.scores.management),
        logic: score(value?.scores?.logic, fallback.scores.logic), communication: score(value?.scores?.communication, fallback.scores.communication),
        overall: score(value?.scores?.overall, fallback.scores.overall),
      },
      scoreDimensions: value?.scoreDimensions ? {
        education: score(value.scoreDimensions.education, 60), experience: score(value.scoreDimensions.experience, fallback.scores.business),
        skillMatch: score(value.scoreDimensions.skillMatch, fallback.scores.business), industryMatch: score(value.scoreDimensions.industryMatch, fallback.scores.business),
        stability: score(value.scoreDimensions.stability, 60),
      } : undefined,
      authenticityRisk: ['低', '中', '较高', '高'].includes(value?.authenticityRisk) ? value.authenticityRisk : undefined,
      evidence: {
        business: text(value?.evidence?.business) || fallback.evidence.business,
        management: text(value?.evidence?.management) || fallback.evidence.management,
        logic: text(value?.evidence?.logic) || fallback.evidence.logic,
        communication: text(value?.evidence?.communication) || fallback.evidence.communication,
      },
      confidence: ['高', '中', '低'].includes(value?.confidence) ? value.confidence : fallback.confidence,
    }
  }

  private fallbackAnalysis(resume: ResumeTalentInput): TalentAnalysis {
    const combined = `${resume.workExperience}\n${resume.selfEvaluation}\n${resume.skillsCertificates}`
    const skills = this.extractSkills(resume.skillsCertificates)
    const managementEvidence = combined.match(/[^。\n]*(?:带领|带队|管理|负责人|团队|副主席|组织)[^。\n]*/)?.[0] || '简历中未发现明确带队规模，需要面试确认。'
    const businessEvidence = combined.match(/[^。\n]*(?:业绩|增长|营收|转化|项目|客户|合作|商户|品牌)[^。\n]*/)?.[0] || '简历中业务结果描述有限，需要补充量化案例。'
    const logicEvidence = combined.match(/[^。\n]*(?:分析|策略|流程|复盘|数据|对标|竞品)[^。\n]*/)?.[0] || '简历中逻辑分析证据有限，需要通过结构化问题验证。'
    const communicationEvidence = combined.match(/[^。\n]*(?:沟通|协调|客户|汇报|谈判|对接|品牌方|互动)[^。\n]*/)?.[0] || ''
    const management = /带领|带队|管理|负责人|团队|副主席|组织协调/.test(combined) ? 72 : 48
    const business = /业绩|增长|营收|转化|项目|客户|合作|商户|品牌|运营/.test(combined) ? 74 : 58
    const logic = /分析|策略|流程|复盘|数据|对标|竞品|策划/.test(combined) ? 72 : 56
    const communication = /沟通|协调|客户|汇报|谈判|对接|品牌方|互动|文案/.test(combined) ? 74 : 58
    const roleMap: { keywords: string[]; roles: string[] }[] = [
      { keywords: ['内容运营', '新媒体', '小红书', '账号运营', '代运营', '文案', '博主'], roles: ['内容运营', '新媒体运营', '小红书运营', '账号代运营'] },
      { keywords: ['视频', '剪辑', '拍摄', 'Pr', 'Ae', '编导', '导演', '宣传片'], roles: ['视频编导', '短视频运营', '影视编导', '拍摄剪辑'] },
      { keywords: ['直播', '主播', '带货'], roles: ['直播运营', '直播编导'] },
      { keywords: ['品牌', '品推', '推广', '市场'], roles: ['品牌运营', '市场推广'] },
      { keywords: ['设计', '美工', 'PS', 'AI', '视觉'], roles: ['视觉设计', '平面设计'] },
      { keywords: ['人才', '招聘', 'HR', '人事', '简历'], roles: ['招聘专员', '人才顾问'] },
    ]
    const matchedRoles = new Set<string>()
    for (const { keywords, roles } of roleMap) {
      if (keywords.some((kw) => combined.includes(kw) || resume.jobIntention.includes(kw))) {
        roles.forEach((r) => matchedRoles.add(r))
      }
    }
    if (resume.jobIntention) matchedRoles.add(resume.jobIntention)
    if (matchedRoles.size === 0) skills.slice(0, 2).forEach((s) => matchedRoles.add(s))
    const recommendedRoles = [...matchedRoles].slice(0, 5)
    const overall = clamp((business + management + logic + communication) / 4)
    return {
      summary: `${resume.name || '该候选人'}${resume.yearsOfExperience ? `具备${resume.yearsOfExperience}工作经验，` : ''}主要方向为${resume.jobIntention || recommendedRoles.slice(0, 3).join('、') || '待进一步识别'}。${resume.address ? `期望城市：${resume.address}。` : ''}${businessEvidence ? `核心亮点：${businessEvidence.slice(0, 80)}。` : ''}`,
      strengths: [businessEvidence, communicationEvidence].filter(Boolean),
      risks: [managementEvidence.includes('未发现') ? managementEvidence : '', !resume.jobIntention ? '求职意向未明确，需要沟通确认。' : ''].filter(Boolean),
      skills, recommendedRoles,
      scores: { business, management, logic, communication, overall },
      evidence: {
        business: businessEvidence,
        management: managementEvidence,
        logic: logicEvidence,
        communication: communicationEvidence || (communication >= 72 ? '经历中包含客户对接、品牌协作或内容互动相关描述。' : '沟通协作证据有限，需要面试确认。'),
      },
      confidence: resume.workExperience && resume.skillsCertificates ? '中' : '低',
    }
  }

  private async saveAssessment(candidateId: string, resumeId: string, analysis: TalentAnalysis, options: Partial<AnalysisRun> & { version?: number; parentId?: string; type?: string; reason?: string; operator?: string; operatorUserId?: string } = {}) {
    const start = Date.now()
    const assessmentId = id('ai')
    const timestamp = now()
    const inputTokens = Math.ceil((options.inputChars || 0) / 4), outputTokens = Math.ceil((options.outputChars || 0) / 4)
    const inputRate = num(process.env.AI_INPUT_COST_PER_MILLION), outputRate = num(process.env.AI_OUTPUT_COST_PER_MILLION)
    const estimatedCost = Number(((inputTokens / 1_000_000 * inputRate) + (outputTokens / 1_000_000 * outputRate)).toFixed(6))
    const costBasis = inputRate || outputRate ? `字符数÷4估算Token；输入${inputRate}元/百万Token，输出${outputRate}元/百万Token` : '按字符数÷4估算Token；未配置模型单价，成本暂记0元'
    await teable.createRecord(this.table('recruitment_ai_assessments'), {
      分析记录ID: assessmentId, 候选人ID: candidateId, 简历记录ID: resumeId, 分析版本: `talent-v${options.version || 1}`, 版本号: options.version || 1, 父分析记录ID: options.parentId || '',
      分析类型: options.type || '首次分析', 重跑原因: options.reason || '', 提示词版本: options.promptVersion || 'talent-analysis-prompt-v2', 模型版本: options.modelVersion || 'platform-llm',
      运行状态: options.status || '成功', 耗时毫秒: options.durationMs || 0, 输入字符数: options.inputChars || 0, 输出字符数: options.outputChars || 0, 运行错误: options.error || '',
      输入估算Token: inputTokens, 输出估算Token: outputTokens, 估算成本元: estimatedCost, 成本估算口径: costBasis,
      人才摘要: analysis.summary, 优势JSON: JSON.stringify(analysis.strengths), 风险与待确认JSON: JSON.stringify(analysis.risks), 技能JSON: JSON.stringify(analysis.skills),
      业务能力分: analysis.scores.business, 管理能力分: analysis.scores.management, 逻辑能力分: analysis.scores.logic,
      沟通协作分: analysis.scores.communication, 综合建议分: analysis.scores.overall, 评分证据JSON: JSON.stringify(analysis.evidence),
      推荐岗位JSON: JSON.stringify(analysis.recommendedRoles), 置信度: analysis.confidence, 人工确认状态: '待人工确认',
      运行人用户ID: options.operatorUserId || '', 运行人: options.operator || '系统', 开始时间: options.startedAt || timestamp, 完成时间: options.completedAt || timestamp, 创建时间: timestamp, 更新时间: timestamp,
    })
    this.invalidateDirectoryCache()
    this.logSlow('saveAssessment', start)
    return assessmentId
  }

  private async saveTags(candidateId: string, assessmentId: string, analysis: TalentAnalysis) {
    const start = Date.now()
    const table = this.table('recruitment_candidate_tags')
    const existing = await teable.listAllRecords(table)
    const timestamp = now()
    const tags = [
      ...analysis.skills.map((name) => ({ name, category: '技能标签', evidence: '来自简历技能和经历分析' })),
      ...analysis.recommendedRoles.map((name) => ({ name: `适合${name}`, category: '岗位推荐', evidence: analysis.summary })),
    ].slice(0, 30)
    const activeNames = new Set(tags.map((item) => item.name))
    for (const row of existing.filter((item) => text(item.fields['候选人ID']) === candidateId && text(item.fields['标签来源']) === 'AI' && !activeNames.has(text(item.fields['标签名称'])))) {
      await teable.updateRecord(table, row.id, { 标签状态: '历史', 更新时间: timestamp })
    }
    for (const tag of tags) {
      const row = existing.find((item) => text(item.fields['候选人ID']) === candidateId && text(item.fields['标签名称']) === tag.name)
      const fields = { 标签记录ID: text(row?.fields['标签记录ID']) || id('tag'), 候选人ID: candidateId, 标签名称: tag.name, 标签分类: tag.category, 标签来源: 'AI', 置信度: analysis.confidence === '高' ? 90 : analysis.confidence === '中' ? 72 : 55, 证据: tag.evidence, 人工确认状态: '待人工确认', 标签状态: '当前', 分析版本: assessmentId, 创建时间: text(row?.fields['创建时间']) || timestamp, 更新时间: timestamp }
      if (row) await teable.updateRecord(table, row.id, fields)
      else await teable.createRecord(table, fields)
    }
    this.invalidateDirectoryCache()
    this.logSlow('saveTags', start)
  }

  private async saveMatches(candidateId: string, assessmentId: string, resume: ResumeTalentInput, analysis: TalentAnalysis, selectedPositionId = '') {
    const start = Date.now()
    const positions = await teable.listAllRecords(this.table('recruitment_positions'))
    const scored = positions.map((position) => {
      const positionName = text(position.fields['职位名称'])
      const requirementText = `${text(position.fields['工作职责'])} ${text(position.fields['任职要求'])} ${text(position.fields['岗位JD'])}`
      const resumeText = `${resume.jobIntention} ${analysis.recommendedRoles.join(' ')} ${analysis.skills.join(' ')} ${resume.workExperience}`
      const overlap = this.sharedTokens(requirementText, resumeText)
      const direct = positionName && (resume.jobIntention.includes(positionName) || analysis.recommendedRoles.some((role) => role.includes(positionName) || positionName.includes(role)))
      const skillScore = clamp(45 + Math.min(35, overlap * 6) + (direct ? 20 : 0))
      const requiredYears = Number(requirementText.match(/(\d+)\s*年以上/)?.[1] || 0)
      const resumeYears = Number(String(resume.yearsOfExperience).match(/\d+(?:\.\d+)?/)?.[0] || 0)
      const experienceScore = requiredYears && resumeYears ? resumeYears >= requiredYears ? 90 : resumeYears >= requiredYears - 1 ? 78 : resumeYears >= requiredYears - 2 ? 66 : 52 : analysis.scores.business
      const score = clamp(skillScore * 0.45 + experienceScore * 0.25 + analysis.scores.business * 0.20 + analysis.scores.management * 0.10 + (direct ? 5 : 0))
      return { row: position, positionName, score, overlap, direct, skillScore, experienceScore }
    }).filter((item) => item.positionName && (item.score >= 60 || item.direct)).sort((a, b) => b.score - a.score)
    const selected = selectedPositionId
      ? scored.find((item) => text(item.row.fields['职位ID']) === selectedPositionId || item.row.id === selectedPositionId)
      : undefined
    const candidates = selected
      ? [selected, ...scored.filter((item) => item !== selected && text(item.row.fields['职位ID']) !== selectedPositionId && item.row.id !== selectedPositionId).slice(0, 4)]
      : scored.slice(0, 5)
    if (!candidates.length && resume.jobIntention) candidates.push({ row: { id: '', fields: {} }, positionName: resume.jobIntention, score: analysis.scores.overall, overlap: 0, direct: true, skillScore: analysis.scores.business, experienceScore: analysis.scores.business })
    const result = []
    for (const match of candidates) {
      const matchId = id('match')
      await teable.createRecord(this.table('recruitment_job_matches'), {
        匹配记录ID: matchId, 候选人ID: candidateId, 职位ID: text(match.row.fields['职位ID']) || match.row.id, 职位名称: match.positionName,
        需求ID: text(match.row.fields['需求ID']), 分析记录ID: assessmentId, 匹配总分: match.score,
        技能匹配分: match.skillScore, 经验匹配分: match.experienceScore,
        管理匹配分: analysis.scores.management, 业务匹配分: analysis.scores.business,
        推荐理由: match === selected
          ? `上传人选择该岗位；AI仍完成评分和证据分析。${analysis.summary}`
          : `简历技能、经历与${match.positionName}要求存在${match.direct ? '直接' : '较高'}匹配；${analysis.summary}`,
        差距与待确认项: analysis.risks.join('；'), 置信度: analysis.confidence, 人工确认状态: match === selected ? '已确认' : '待人工确认', 分析版本: assessmentId,
        ...(match === selected ? { 匹配人用户ID: '', 匹配人: '上传人选择' } : {}),
        岗位JD版本: num(match.row.fields['JD版本']) || 1, 匹配状态: '当前', 创建时间: now(), 更新时间: now(),
      })
      result.push({ matchId, positionId: text(match.row.fields['职位ID']) || match.row.id, positionName: match.positionName, score: match.score })
    }
    this.invalidateDirectoryCache()
    this.logSlow('saveMatches', start)
    return result
  }

  private async ensureApplication(candidateId: string, resume: ResumeTalentInput, bestMatch?: { positionId: string; positionName: string; score: number }) {
    const table = this.table('recruitment_applications')
    const rows = await teable.listAllRecords(table)
    const existing = rows.find((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['简历记录ID']) === resume.id)
    if (existing) return text(existing.fields['应聘记录ID'])
    const applicationId = id('app')
    await teable.createRecord(table, {
      应聘记录ID: applicationId, 候选人ID: candidateId, 职位ID: bestMatch?.positionId || '', 简历记录ID: resume.id,
      来源类型: '简历解析', 来源名称: resume.sourceFileName, 当前阶段: 'AI分析中', 当前状态: '进行中',
      AI匹配分: bestMatch?.score || 0, AI评分版本: bestMatch ? 'talent-v1' : '', 人工复核结果: bestMatch ? '待确认' : '待分析', 投递时间: now(), 最近处理时间: now(), 创建时间: now(), 更新时间: now(),
    })
    return applicationId
  }

  private async ensureInitialEvent(candidateId: string, applicationId: string, positionId: string) {
    const table = this.table('recruitment_stage_events')
    const rows = await teable.listAllRecords(table)
    if (rows.some((row) => text(row.fields['应聘记录ID']) === applicationId && text(row.fields['新阶段']) === 'AI分析中')) return
    await teable.createRecord(table, {
      事件ID: id('evt'), 应聘记录ID: applicationId, 候选人ID: candidateId, 职位ID: positionId,
      原阶段: '简历采集', 新阶段: 'AI分析中', 操作: '简历解析入库', 结果: '成功', 操作人: '系统', 发生时间: now(), 来源类型: '系统自动',
    })
  }

  private async loadAll(candidateId?: string) {
    const related = (name: string) => candidateId
      ? teable.listByField(this.table(name), '候选人ID', candidateId, 1000)
      : teable.listAllRecords(this.table(name))
    const candidatesPromise = candidateId
      ? teable.listByField(this.table('recruitment_candidates'), '候选人ID', candidateId, 2)
      : teable.listAllRecords(this.table('recruitment_candidates'))
    const [candidates, resumes, applications, assessments, matches, tags, events, communications, reviews, assessmentInvites, assessmentReviews, positions, interviews, interviewFeedback, offers, backgroundChecks, onboardings, probationReviews, offboardings, followups, reviewShares, reviewResponses] = await Promise.all([
      candidatesPromise,
      related('resume_extraction_records'), related('recruitment_applications'), related('recruitment_ai_assessments'),
      related('recruitment_job_matches'), related('recruitment_candidate_tags'), related('recruitment_stage_events'),
      related('recruitment_communications'), related('recruitment_candidate_reviews'), related('recruitment_assessment_invites'),
      related('recruitment_assessment_reviews'), this.cached('talents-positions', DIRECTORY_CACHE_TTL_MS, () => teable.listAllRecords(this.table('recruitment_positions'))),
      related('recruitment_interviews'), related('recruitment_interview_feedback'), related('recruitment_offers'),
      related('recruitment_background_checks'), related('recruitment_onboarding_cases'), related('recruitment_probation_reviews'), related('recruitment_offboarding_cases'),
      related('recruitment_followups'), related('recruitment_talent_review_shares'), related('recruitment_talent_review_responses'),
    ])
    if (candidateId) {
      const candidate = candidates.find((item) => text(item.fields['候选人ID']) === candidateId || item.id === candidateId)
      const latestResumeId = text(candidate?.fields['最新简历记录ID'])
      // 历史导入中有些简历的“候选人ID”为空或曾被写成旧 ID，
      // 但人才主档仍保留了准确的“最新简历记录ID”。详情读取必须以这个直接引用为准。
      if (latestResumeId && !resumes.some((item) => item.id === latestResumeId || text(item.fields['解析记录ID']) === latestResumeId)) {
        let latestResume: TeableRecord | undefined
        try {
          latestResume = await teable.getRecord(this.table('resume_extraction_records'), latestResumeId)
        } catch {
          try {
            const rows = await teable.listRecords(this.table('resume_extraction_records'), {
              take: 1, filterByTql: `{解析记录ID} = "${latestResumeId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
            })
            latestResume = rows.find((item) => item.id === latestResumeId || text(item.fields['解析记录ID']) === latestResumeId)
          } catch {
            latestResume = undefined
          }
        }
        if (!latestResume?.fields || (latestResume.id !== latestResumeId && text(latestResume.fields['解析记录ID']) !== latestResumeId)) {
          const rows = await teable.listByField(this.table('resume_extraction_records'), '解析记录ID', latestResumeId, 1000)
          latestResume = rows.find((item) => item.id === latestResumeId || text(item.fields['解析记录ID']) === latestResumeId)
        }
        if (latestResume && !resumes.some((item) => item.id === latestResume.id)) resumes.push(latestResume)
      }

      const resumeIds = [...new Set(resumes.map((item) => [item.id, text(item.fields['解析记录ID'])]).flat().filter(Boolean))]
      const linkedApplicationIds = [...new Set(resumes.map((item) => text(item.fields['应聘记录ID'])).filter(Boolean))]
      const linkedApplications = await Promise.all([
        resumeIds.length ? teable.listByAnyField(this.table('recruitment_applications'), '简历记录ID', resumeIds, 1000) : [],
        linkedApplicationIds.length ? teable.listByAnyField(this.table('recruitment_applications'), '应聘记录ID', linkedApplicationIds, 1000) : [],
      ])
      for (const row of linkedApplications.flat()) if (!applications.some((item) => item.id === row.id)) applications.push(row)
      const applicationIds = [...new Set(applications.map((item) => text(item.fields['应聘记录ID'])).filter(Boolean))]
      if (applicationIds.length) {
        const linkedEvents = await teable.listByAnyField(this.table('recruitment_stage_events'), '应聘记录ID', applicationIds, 1000)
        for (const row of linkedEvents) if (!events.some((item) => item.id === row.id)) events.push(row)
      }
    }
    return { candidates, resumes, applications, assessments, matches, tags, events, communications, reviews, assessmentInvites, assessmentReviews, positions, interviews, interviewFeedback, offers, backgroundChecks, onboardings, probationReviews, offboardings, followups, reviewShares, reviewResponses }
  }

  /** 列表目录只保留筛选、统计、权限范围与列表行需要的轻量数据。 */
  private async loadDirectory() {
    const summaryRows = (name: string) => teable.listAllRecords(this.table(name), { fields: TALENT_DIRECTORY_FIELDS[name] })
    const [candidates, applications, assessments, matches, tags, positions, interviews] = await Promise.all([
      summaryRows('recruitment_candidates'), summaryRows('recruitment_applications'),
      summaryRows('recruitment_ai_assessments'), summaryRows('recruitment_job_matches'),
      summaryRows('recruitment_candidate_tags'), summaryRows('recruitment_positions'), summaryRows('recruitment_interviews'),
    ])
    const resumes = await this.loadDirectoryResumes(candidates)
    return { candidates, applications, assessments, matches, tags, positions, interviews, resumes, referrals: [] as TeableRecord[], total: candidates.length }
  }

  private async directoryTotal(filterByTql?: string) {
    const tableId = this.table('recruitment_candidates')
    const fields = ['候选人ID', '合并状态', '候选人状态']
    const excluded = (row: TeableRecord) => text(row.fields['合并状态']) === '已合并' || text(row.fields['候选人状态']) === '已删除'
    if (!filterByTql) {
      try {
        const [total, hiddenRows] = await Promise.all([
          teable.countRecords(tableId),
          teable.listAllRecords(tableId, { fields, filterByTql: '{合并状态} = "已合并" OR {候选人状态} = "已删除"' }),
        ])
        const hiddenCount = hiddenRows.filter(excluded).length
        if (hiddenCount > total) throw new Error('计数期间数据发生变化，需要重新核对总数')
        return total - hiddenCount
      } catch (error) {
        console.warn(`[Talents] 聚合计数不可用，改用摘要计数：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const rows = await teable.listAllRecords(tableId, { fields, filterByTql })
    return rows.filter(row => !excluded(row)).length
  }

  private complexFilterCacheKey(query: Pick<TalentDirectoryQuery, 'q' | 'job' | 'status' | 'source' | 'tag' | 'importer' | 'minScore' | 'age' | 'region' | 'score'>) {
    return [
      text(query.q), text(query.job), text(query.status), text(query.source), text(query.tag), text(query.importer),
      text(query.minScore), text(query.age), text(query.region), text(query.score),
    ].join('\u0001')
  }

  /** 复杂筛选先建轻量索引，避免为了一个筛选读取全量标签与简历。 */
  private async loadComplexDirectory(query: TalentDirectoryQuery, serverFilter?: string) {
    const tagName = query.tag && query.tag !== '全部标签' ? query.tag : ''
    const tagRows = tagName
      ? await teable.listAllRecords(this.table('recruitment_candidate_tags'), {
          filterByTql: `{标签名称} = "${tagName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
          fields: TALENT_DIRECTORY_FILTER_FIELDS.recruitment_candidate_tags,
        })
      : []
    const [candidates, applications, assessments, matches, positions] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates'), { fields: TALENT_DIRECTORY_FIELDS.recruitment_candidates, filterByTql: serverFilter }),
      teable.listAllRecords(this.table('recruitment_applications'), { fields: TALENT_DIRECTORY_FILTER_FIELDS.recruitment_applications }),
      teable.listAllRecords(this.table('recruitment_ai_assessments'), { fields: TALENT_DIRECTORY_FILTER_FIELDS.recruitment_ai_assessments }),
      teable.listAllRecords(this.table('recruitment_job_matches'), { fields: TALENT_DIRECTORY_FILTER_FIELDS.recruitment_job_matches }),
      teable.listAllRecords(this.table('recruitment_positions'), { fields: TALENT_DIRECTORY_FILTER_FIELDS.recruitment_positions }),
    ])
    return {
      candidates, applications, assessments, matches,
      tags: tagRows, positions, interviews: [], resumes: [], referrals: [] as TeableRecord[],
      total: candidates.length,
    }
  }

  private async hydrateComplexDirectoryPage(data: Awaited<ReturnType<TalentsService['loadDirectory']>>, items: any[]) {
    const rowsByCandidateId = new Map(data.candidates.map((row) => [text(row.fields['候选人ID']) || row.id, row]))
    const rows = items.map((item) => rowsByCandidateId.get(item.id)).filter((row): row is TeableRecord => Boolean(row))
    if (!rows.length) return items
    const pageKey = rows.map((row) => text(row.fields['候选人ID']) || row.id).join(',')
    const detailedData = await this.detailCache.get(
      `talents-complex-page:${pageKey}`,
      DIRECTORY_CACHE_TTL_MS,
      Object.keys(TALENT_DIRECTORY_FIELDS).map((name) => this.table(name)),
      () => this.loadComplexDirectoryPage(data, rows),
    )
    const index = this.directoryIndex(detailedData)
    return items.map((item) => {
      const row = rowsByCandidateId.get(item.id)
      if (!row) return item
      const detailed = this.directoryProfile(row, index)
      for (const field of ['phone', 'email', 'wechat', 'rawText', 'sourceFileUrl', 'editableWordUrl', 'salary', 'baseSalary', 'performanceSalary', 'allowance', 'retentionInfo', 'resumeVersions', 'access']) {
        if (field in item) (detailed as any)[field] = item[field]
      }
      detailed.matches = item.matches
      detailed.bestMatchRole = item.bestMatchRole
      detailed.bestMatchScore = item.bestMatchScore
      detailed.employmentStatus = item.employmentStatus
      return detailed
    })
  }

  private async loadComplexDirectoryPage(data: Awaited<ReturnType<TalentsService['loadDirectory']>>, candidates: TeableRecord[]) {
    const ids = candidates.map((row) => text(row.fields['候选人ID']) || row.id)
    const byIds = (name: keyof typeof TALENT_DIRECTORY_FIELDS, field = '候选人ID') =>
      teable.listByAnyField(this.table(name), field, ids, 1000, TALENT_DIRECTORY_FIELDS[name])
    const [applications, assessments, matches, interviews, tags, resumes, referrals] = await Promise.all([
      byIds('recruitment_applications'), byIds('recruitment_ai_assessments'), byIds('recruitment_job_matches'),
      byIds('recruitment_interviews'), this.loadDirectoryTags(ids), this.loadDirectoryResumes(candidates),
      byIds('recruitment_referrals'),
    ])
    return {
      ...data,
      candidates, applications, assessments, matches, interviews, tags, resumes, referrals,
      positions: data.positions,
    }
  }

  private async loadDirectoryPage(page: number, pageSize: number, filterByTql?: string) {
    let result: { records: TeableRecord[]; total?: number; totalIsExact?: boolean }
    const totalResult = this.cached(`talents-total:${filterByTql || ''}`, DIRECTORY_CACHE_TTL_MS, () => this.directoryTotal(filterByTql))
      .then(total => ({ total, error: undefined }), error => ({ total: 0, error }))
    try {
      result = await teable.listRecordsPage(this.table('recruitment_candidates'), {
        take: pageSize, skip: (page - 1) * pageSize, filterByTql, orderBy: [{ field: '创建时间', order: 'desc' }], fields: TALENT_DIRECTORY_FIELDS.recruitment_candidates,
      })
    } catch (error) {
      // 兼容旧平台代理：分页翻页失败时回退全量目录，不能让人才档案只显示首页后无法继续。
      console.warn(`[Talents] 服务端分页不可用，回退兼容查询：${error instanceof Error ? error.message : String(error)}`)
      return this.loadDirectory()
    }
    const candidates = result.records.filter((row) => text(row.fields['合并状态']) !== '已合并' && text(row.fields['候选人状态']) !== '已删除')
    const ids = candidates.map((row) => text(row.fields['候选人ID']) || row.id)
    const byIds = (name: string, field = '候选人ID') => teable.listByAnyField(this.table(name), field, ids, 1000, TALENT_DIRECTORY_FIELDS[name])
    const [applications, assessments, matches, tags, interviews, positions, resumes, referrals, count] = await Promise.all([
      byIds('recruitment_applications'), byIds('recruitment_ai_assessments'), byIds('recruitment_job_matches'),
      this.loadDirectoryTags(ids), byIds('recruitment_interviews'),
      this.cached('talents-positions', DIRECTORY_CACHE_TTL_MS, () => teable.listAllRecords(this.table('recruitment_positions'), { fields: TALENT_DIRECTORY_FIELDS.recruitment_positions })),
      this.loadDirectoryResumes(candidates),
      byIds('recruitment_referrals'),
      totalResult,
    ])
    if (count.error) throw count.error
    return { candidates, applications, assessments, matches, tags, interviews, positions, resumes, referrals, total: count.total }
  }

  private async loadDirectoryTags(candidateIds: string[]) {
    const tableId = this.table('recruitment_candidate_tags')
    const chunks: string[][] = []
    for (let index = 0; index < candidateIds.length; index += 25) chunks.push(candidateIds.slice(index, index + 25))
    const batches = await Promise.all(chunks.map((ids) => {
      const filterByTql = ids.map((candidateId) => {
        const escaped = candidateId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        return `{候选人ID} = "${escaped}"`
      }).join(' OR ')
      return teable.listAllRecords(tableId, { filterByTql, fields: TALENT_DIRECTORY_FIELDS.recruitment_candidate_tags })
    }))
    return [...new Map(batches.flat().map((row) => [row.id, row])).values()]
  }

  private async loadDirectoryResumes(candidates: TeableRecord[]) {
    const ids = candidates.filter(row => !text(row.fields['工作经历']) || !text(row.fields['当前简历文件名']) || !text(row.fields['当前简历地址']))
      .map(row => text(row.fields['候选人ID']) || row.id)
    const batches: TeableRecord[][] = []
    for (let offset = 0; offset < ids.length; offset += 100) {
      const rows = await teable.listByAnyField(this.table('resume_extraction_records'), '候选人ID', ids.slice(offset, offset + 100), 1000, TALENT_DIRECTORY_FIELDS.resume_extraction_records)
      const missingWork = rows.filter(row => !text(row.fields['工作经历'])).map(row => text(row.fields['候选人ID'])).filter(Boolean)
      const originals = missingWork.length ? await teable.listByAnyField(this.table('resume_extraction_records'), '候选人ID', missingWork, 1000, ['候选人ID', 'OCR原文']) : []
      const originalById = new Map(originals.map(row => [row.id, row]))
      batches.push(rows.map(row => ({ ...row, fields: { ...row.fields, OCR原文: originalById.get(row.id)?.fields['OCR原文'] || '' } })))
    }
    return batches.flat()
  }

  private async importerReferralCandidateIds(keyword: string) {
    const escaped = keyword.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const rows = await teable.listAllRecords(this.table('recruitment_referrals'), {
      filterByTql: `{推荐人} LIKE "%${escaped}%" OR {推荐人用户ID} LIKE "%${escaped}%"`,
      fields: TALENT_DIRECTORY_FILTER_FIELDS.recruitment_referrals,
    })
    return [...new Set(rows.map((row) => text(row.fields['候选人ID'])).filter(Boolean))]
  }

  private directoryFilter(query: Pick<TalentDirectoryQuery, 'q' | 'status' | 'source' | 'importer'>, referralCandidateIds: string[] = []) {
    const escape = (value: unknown) => String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const conditions: string[] = []
    const keyword = text(query.q)
    if (query.status === '在职' || query.status === '离职') conditions.push(`{天玑人事状态} = "${escape(query.status)}"`)
    else if (query.status && query.status !== '全部状态' && query.status !== '未入职') conditions.push(`{候选人状态} = "${escape(query.status)}"`)
    if (query.source && query.source !== '全部来源') conditions.push(`{来源类型} = "${escape(query.source)}"`)
    const keywordClauses = keyword ? [`{姓名} LIKE "%${escape(keyword)}%"`] : []
    const importer = text(query.importer)
    const importerClauses = importer
      ? [
          `{创建人} LIKE "%${escape(importer)}%"`,
          `{创建人用户ID} LIKE "%${escape(importer)}%"`,
          ...referralCandidateIds.map((candidateId) => `{候选人ID} = "${escape(candidateId)}"`),
        ]
      : []
    const clauses = keywordClauses.length && importerClauses.length
      ? keywordClauses.flatMap((keywordClause) => importerClauses.map((importerClause) => `${keywordClause} AND ${importerClause}`))
      : keywordClauses.length ? keywordClauses : importerClauses
    if (!clauses.length) return conditions.join(' AND ')
    // 平台 TQL 对括号和函数式 OR 的支持不一致，采用分配律保证关键词与状态/来源正确组合。
    return conditions.length
      ? clauses.map((clause) => `${clause} AND ${conditions.join(' AND ')}`).join(' OR ')
      : clauses.join(' OR ')
  }

  /** 把关联表一次建索引，避免 737/10000 位人才逐个 filter/find 产生平方级扫描。 */
  private directoryIndex(data: Awaited<ReturnType<TalentsService['loadDirectory']>>) {
    const latestByCandidate = (rows: TeableRecord[], rank: (row: TeableRecord) => string) => {
      const result = new Map<string, TeableRecord>()
      for (const row of rows) {
        const candidateId = text(row.fields['候选人ID'])
        if (!candidateId) continue
        const current = result.get(candidateId)
        if (!current || rank(row) > rank(current)) result.set(candidateId, row)
      }
      return result
    }
    const groupedByCandidate = (rows: TeableRecord[]) => {
      const result = new Map<string, TeableRecord[]>()
      for (const row of rows) {
        const candidateId = text(row.fields['候选人ID'])
        if (!candidateId) continue
        const items = result.get(candidateId) || []
        items.push(row)
        result.set(candidateId, items)
      }
      return result
    }
    const applications = latestByCandidate(data.applications, (row) => text(row.fields['更新时间']) || text(row.fields['创建时间']))
    const assessments = new Map<string, TeableRecord>()
    for (const row of data.assessments) {
      const candidateId = text(row.fields['候选人ID'])
      if (!candidateId) continue
      const current = assessments.get(candidateId)
      const currentVersion = num(current?.fields['版本号']), version = num(row.fields['版本号'])
      if (!current || version > currentVersion || (version === currentVersion && (text(row.fields['创建时间']) > text(current.fields['创建时间'])))) assessments.set(candidateId, row)
    }
    const interviewerUserIds = new Map<string, string[]>()
    for (const [candidateId, rows] of groupedByCandidate(data.interviews)) interviewerUserIds.set(candidateId, [...new Set(rows.flatMap((row) => json<string[]>(row.fields['面试官用户IDJSON'], [])))])
    const resumes = latestByCandidate(data.resumes, (row) => text(row.fields['更新时间']) || text(row.fields['创建时间']) || row.createdTime || '')
    const referrals = groupedByCandidate(data.referrals)
    return {
      applications,
      assessments,
      matches: groupedByCandidate(data.matches),
      tags: groupedByCandidate(data.tags),
      positions: new Map(data.positions.map((row) => [text(row.fields['职位ID']) || row.id, row])),
      
      interviewerUserIds, resumes, referrals,
    }
  }

  /** 人才列表摘要。完整附件、OCR、时间线与评审明细只由 detail() 返回。 */
  private directoryProfile(row: TeableRecord, index: ReturnType<TalentsService['directoryIndex']>) {
    const f = row.fields, candidateId = text(f['候选人ID']) || row.id
    const application = index.applications.get(candidateId)
    const assessment = index.assessments.get(candidateId)
    const assessmentId = text(assessment?.fields['分析记录ID']) || assessment?.id || ''
    const analysisCorrection = assessment ? json<any>(assessment.fields['人工修正JSON'], null) : null
    const originalAnalysis = assessment ? this.analysisFromAssessment(assessment) : null
    const effectiveAnalysis = analysisCorrection?.effective || originalAnalysis
    const candidateMatches = (index.matches.get(candidateId) || []).filter((item) => !['历史', '已失效'].includes(text(item.fields['匹配状态'])))
    const currentMatches = assessmentId && candidateMatches.some((item) => text(item.fields['分析记录ID']) === assessmentId)
      ? candidateMatches.filter((item) => text(item.fields['分析记录ID']) === assessmentId)
      : candidateMatches
    const matches = [...currentMatches].sort((a, b) => num(b.fields['匹配总分']) - num(a.fields['匹配总分'])).map((item) => ({
      id: text(item.fields['匹配记录ID']) || item.id, positionId: text(item.fields['职位ID']), positionName: text(item.fields['职位名称']), score: num(item.fields['匹配总分']),
      skillScore: num(item.fields['技能匹配分']), experienceScore: num(item.fields['经验匹配分']), managementScore: num(item.fields['管理匹配分']), businessScore: num(item.fields['业务匹配分']),
      reason: text(item.fields['推荐理由']), gaps: text(item.fields['差距与待确认项']), confidence: text(item.fields['置信度']), reviewStatus: text(item.fields['人工确认状态']),
      manualCorrection: text(item.fields['人工修正原因']) ? {
        previousPositionId: text(item.fields['修正前岗位ID']), previousPositionName: text(item.fields['修正前岗位']),
        reason: text(item.fields['人工修正原因']), operator: text(item.fields['人工修正人']), correctedAt: text(item.fields['人工修正时间']),
      } : null,
    }))
    const position = index.positions.get(text(application?.fields['职位ID']))
    const demand = position
    const departmentIds = [...new Set([text(position?.fields['部门ID']), text(demand?.fields['部门ID'])].filter(Boolean))]
    const tagKey = text(f['候选人ID']) || row.id
    const tagRows = (index.tags.get(tagKey) || []).filter((item) => !['历史', '人工移除'].includes(text(item.fields['标签状态'])))
    const activeSkills = tagRows.filter((item) => text(item.fields['标签分类']) === '技能标签').map((item) => text(item.fields['标签名称'])).filter(Boolean)
    const birthYear = num(f['出生年份']), age = birthYear ? new Date().getUTCFullYear() - birthYear : num(f['年龄']) || null
    const birthYearSignals = this.birthYearSignals(row)
    const birthYearReviewStatus = text(f['出生年份确认状态']) || '待人工复核'
    const referral = [...(index.referrals.get(candidateId) || [])]
      .sort((left, right) => text(right.fields['推荐时间'] || right.fields['创建时间'] || right.createdTime).localeCompare(text(left.fields['推荐时间'] || left.fields['创建时间'] || left.createdTime)))[0]
    return {
      id: candidateId, recordId: row.id, name: text(f['姓名']), gender: safeGender(f['性别']), birthYear: birthYear || null, age,
      birthYearSource: text(f['出生年份来源']) || (birthYear ? '简历年龄换算' : ''), birthYearReviewStatus,
      birthYearConflict: { ...birthYearSignals, hasConflict: birthYearSignals.hasConflict && birthYearReviewStatus !== '人工已确认' },
      phone: text(f['电话']), email: text(f['邮箱']), wechat: text(f['微信']), address: text(f['当前城市']),
      educationBackground: text(f['教育经历']),
      workExperience: (() => {
        const fromCandidate = text(f['工作经历'])
        const fromResume = text(index.resumes.get(candidateId)?.fields['工作经历'])
        if (fromCandidate || fromResume) return fromCandidate || fromResume
        const raw = text(index.resumes.get(candidateId)?.fields['OCR原文'])
        if (!raw) return ''
        const headingMatch = raw.match(/(?:^|\n)\s*(?:工作经历|工作经验)\s*[:：]?\s*(?=\n|$)/i)
        if (!headingMatch) return ''
        const section = raw.slice((headingMatch.index ?? 0) + headingMatch[0].length)
        const nextHeading = section.search(/\n\s*(?:教育经历|教育背景|项目经历|项目经验|技能特长|技能与证书|自我评价)\s*[:：]?\s*(?=\n|$)/i)
        const extracted = (nextHeading >= 0 ? section.slice(0, nextHeading) : section).trim()
        return extracted ? extracted.slice(0, 3000) : ''
      })(), selfEvaluation: text(f['自我评价']), yearsOfExperience: text(f['工作年限']),
      currentCompany: text(f['当前公司']), currentRole: text(f['当前职位']), jobIntention: text(f['期望职位']),
      status: text(application?.fields['当前阶段']) || text(f['候选人状态']) || 'AI分析中', employmentStatus: ['在职','离职'].includes(text(f['天玑人事状态'])) ? text(f['天玑人事状态']) : '未入职', tianjiHireDate: text(f['天玑入职日期']), tianjiLeaveDate: text(f['天玑离职日期']), talentPool: text(f['人才池']) || '公司人才库',
      owner: text(f['负责人']) || '待分配', source: text(f['来源类型']) || '简历解析', duplicateStatus: text(f['重复检查状态']), ownerUserId: text(f['负责人用户ID']),
      importedById: text(f['创建人用户ID']), importedBy: text(f['创建人']) || '系统导入',
      referrerId: text(referral?.fields['推荐人用户ID']), referrer: text(referral?.fields['推荐人']), referrerDepartment: text(referral?.fields['推荐人部门']),
      mergeStatus: text(f['合并状态']) || '独立档案', mergedIntoCandidateId: text(f['合并至候选人ID']), mergeEventId: text(f['合并事件ID']),
      suspiciousCandidateIds: json<string[]>(f['疑似重复候选人JSON'], []), contactLock: { status: text(f['联系锁定状态']), holderUserId: text(f['锁定人用户ID']), holder: text(f['锁定人']), expiresAt: text(f['锁定到期时间']) },
      createdTime: text(f['创建时间']) || row.createdTime || '', updatedTime: text(f['更新时间']), latestResumeId: text(f['最新简历记录ID']),
      // 列表不传输 OCR 正文；文件名/地址来自主档缓存，详情再按最新简历校准。
      sourceFileName: text(f['当前简历文件名']) || text(index.resumes.get(candidateId)?.fields['源文件名']) || '', sourceFileUrl: text(f['当前简历地址']) || text(index.resumes.get(candidateId)?.fields['源文件地址']) || '', rawText: '完整简历原文将在打开详情时按需加载。', avatarUrl: text(f['头像地址']), avatarStatus: text(f['头像提取状态']), editableWordUrl: '', tags: tagRows.map((item) => ({ name: text(item.fields['标签名称']), category: text(item.fields['标签分类']), source: text(item.fields['标签来源']), confidence: num(item.fields['置信度']), evidence: '', reviewStatus: text(item.fields['人工确认状态']), status: text(item.fields['标签状态']) || '当前' })),
      skills: activeSkills.length ? activeSkills : json<string[]>(f['技能JSON'], []), matches, bestMatchScore: matches[0]?.score || num(application?.fields['AI匹配分']), bestMatchRole: matches[0]?.positionName || text(f['期望职位']),
      analysis: assessment && effectiveAnalysis ? { id: assessmentId, reviewStatus: text(assessment.fields['人工确认状态']) || '待人工确认', scores: effectiveAnalysis.scores, confidence: effectiveAnalysis.confidence, strengths: effectiveAnalysis.strengths || [], summary: effectiveAnalysis.summary || '' } : null,
      _access: { candidateId, ownerUserId: text(application?.fields['负责人用户ID']) || text(f['负责人用户ID']), departmentIds, businessUnitId: text(demand?.fields['事业部ID']), interviewerUserIds: index.interviewerUserIds.get(candidateId) || [], stage: text(application?.fields['当前阶段']) || text(f['候选人状态']) } satisfies TalentAccessContext,
    }
  }

  private withoutAccessMetadata<T extends Record<string, any>>(item: T) {
    const result = { ...item }
    delete result._access
    return result
  }

  private profile(row: TeableRecord, data: Awaited<ReturnType<TalentsService['loadAll']>>, full = false) {
    const f = row.fields
    const candidateId = text(f['候选人ID']) || row.id
    const latestResumeId = text(f['最新简历记录ID'])
    const resume = data.resumes.find((item) => Boolean(latestResumeId) && (item.id === latestResumeId || text(item.fields['解析记录ID']) === latestResumeId))
      || data.resumes.filter((item) => text(item.fields['候选人ID']) === candidateId)
        .sort((left, right) => (text(right.fields['更新时间']) || text(right.fields['创建时间']) || right.createdTime || '').localeCompare(text(left.fields['更新时间']) || text(left.fields['创建时间']) || left.createdTime || ''))[0]
    const resumeApplicationId = text(resume?.fields['应聘记录ID'])
    const resumeIds = new Set(data.resumes.filter((item) => item === resume || text(item.fields['候选人ID']) === candidateId).flatMap((item) => [item.id, text(item.fields['解析记录ID'])]).filter(Boolean))
    const candidateApplications = data.applications.filter((item) =>
      text(item.fields['候选人ID']) === candidateId
      || resumeIds.has(text(item.fields['简历记录ID']))
      || Boolean(resumeApplicationId && text(item.fields['应聘记录ID']) === resumeApplicationId),
    )
    const candidateApplicationIds = new Set(candidateApplications.map((item) => text(item.fields['应聘记录ID'])).filter(Boolean))
    const assessments = data.assessments.filter((item) => text(item.fields['候选人ID']) === candidateId)
      .sort((a, b) => (num(b.fields['版本号']) || 1) - (num(a.fields['版本号']) || 1) || text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))
    const assessment = assessments[0]
    const assessmentId = text(assessment?.fields['分析记录ID']) || assessment?.id || ''
    const originalAnalysis = assessment ? this.analysisFromAssessment(assessment) : null
    const analysisCorrection = assessment ? json<any>(assessment.fields['人工修正JSON'], null) : null
    const effectiveAnalysis = analysisCorrection?.effective || originalAnalysis
    const candidateMatches = data.matches.filter((item) => text(item.fields['候选人ID']) === candidateId && !['历史', '已失效'].includes(text(item.fields['匹配状态'])))
    const currentMatches = assessmentId && candidateMatches.some((item) => text(item.fields['分析记录ID']) === assessmentId) ? candidateMatches.filter((item) => text(item.fields['分析记录ID']) === assessmentId) : candidateMatches
    const matches = currentMatches.sort((a, b) => num(b.fields['匹配总分']) - num(a.fields['匹配总分'])).map((item) => ({
      id: text(item.fields['匹配记录ID']) || item.id, positionId: text(item.fields['职位ID']), positionName: text(item.fields['职位名称']), score: num(item.fields['匹配总分']),
      skillScore: num(item.fields['技能匹配分']), experienceScore: num(item.fields['经验匹配分']), managementScore: num(item.fields['管理匹配分']), businessScore: num(item.fields['业务匹配分']),
      reason: text(item.fields['推荐理由']), gaps: text(item.fields['差距与待确认项']), confidence: text(item.fields['置信度']), reviewStatus: text(item.fields['人工确认状态']),
      manualCorrection: text(item.fields['人工修正原因']) ? {
        previousPositionId: text(item.fields['修正前岗位ID']), previousPositionName: text(item.fields['修正前岗位']),
        reason: text(item.fields['人工修正原因']), operator: text(item.fields['人工修正人']), correctedAt: text(item.fields['人工修正时间']),
      } : null,
    }))
    const sortedCandidateApplications = candidateApplications.slice().sort((a, b) => (text(b.fields['更新时间']) || text(b.fields['创建时间'])).localeCompare(text(a.fields['更新时间']) || text(a.fields['创建时间'])))
    const application = sortedCandidateApplications[0]
    const currentApplicationId = text(application?.fields['应聘记录ID']) || application?.id || ''
    const belongsToCurrentApplication = (item: TeableRecord) => {
      if (!currentApplicationId) return text(item.fields['候选人ID']) === candidateId
      return text(item.fields['应聘记录ID']) === currentApplicationId
    }
    const position = data.positions.find((item) => text(item.fields['职位ID']) === text(application?.fields['职位ID']))
    const demand = position
    const departmentIds = [...new Set([text(position?.fields['部门ID']), text(demand?.fields['部门ID'])].filter(Boolean))]
    const interviewerUserIds = [...new Set(data.interviews.filter((item) =>
      text(item.fields['候选人ID']) === candidateId || candidateApplicationIds.has(text(item.fields['应聘记录ID'])),
    ).flatMap((item) => json<string[]>(item.fields['面试官用户IDJSON'], [])))]
    const birthYear = num(f['出生年份'])
    const age = birthYear ? new Date().getUTCFullYear() - birthYear : num(f['年龄']) || null
    const birthYearSignals = this.birthYearSignals(row, resume)
    const birthYearReviewStatus = text(f['出生年份确认状态']) || '待人工复核'
    const result: any = {
      id: candidateId, recordId: row.id, name: text(f['姓名']), gender: safeGender(f['性别']), birthYear: birthYear || null, age,
      birthYearSource: text(f['出生年份来源']) || (birthYear ? '简历年龄换算' : ''), birthYearReviewStatus,
      birthYearConflict: { ...birthYearSignals, hasConflict: birthYearSignals.hasConflict && birthYearReviewStatus !== '人工已确认' },
      birthYearCorrection: { reason: text(f['出生年份修正原因']), operatorUserId: text(f['出生年份修正人用户ID']), operator: text(f['出生年份修正人']), correctedAt: text(f['出生年份修正时间']), previousSignals: json(f['出生年份冲突JSON'], null) },
      phone: text(f['电话']), email: text(f['邮箱']), wechat: text(f['微信']), address: text(f['当前城市']),
      educationBackground: text(f['教育经历']) || text(resume?.fields['教育背景']), workExperience: text(f['工作经历']) || text(resume?.fields['工作经历']),
      selfEvaluation: text(f['自我评价']) || text(resume?.fields['自我评价']), yearsOfExperience: text(f['工作年限']),
      currentCompany: text(f['当前公司']) || text(resume?.fields['当前公司']), currentRole: text(f['当前职位']) || text(resume?.fields['当前职位']),
      jobIntention: text(f['期望职位']) || text(resume?.fields['求职意向']),
      status: text(application?.fields['当前阶段']) || text(f['候选人状态']) || 'AI分析中', employmentStatus: ['在职', '离职'].includes(text(f['天玑人事状态'])) ? text(f['天玑人事状态']) : '未入职', tianjiHireDate: text(f['天玑入职日期']), tianjiLeaveDate: text(f['天玑离职日期']), talentPool: text(f['人才池']) || '公司人才库',
      owner: text(f['负责人']) || '待分配', source: text(f['来源类型']) || '简历解析', duplicateStatus: text(f['重复检查状态']), suppressGroupPush: text(f['不推送企微群']) === '是',
      importedById: text(f['创建人用户ID']), importedBy: text(f['创建人']) || '系统导入',
      ownerUserId: text(f['负责人用户ID']), mergeStatus: text(f['合并状态']) || '独立档案', mergedIntoCandidateId: text(f['合并至候选人ID']),
      mergeEventId: text(f['合并事件ID']), suspiciousCandidateIds: json<string[]>(f['疑似重复候选人JSON'], []),
      contactLock: {
        status: text(f['联系锁定状态']), holderUserId: text(f['锁定人用户ID']), holder: text(f['锁定人']), expiresAt: text(f['锁定到期时间']),
      },
      createdTime: text(f['创建时间']) || row.createdTime || '', latestApplicationTime: text(application?.fields['投递时间']) || text(application?.fields['创建时间']), updatedTime: text(f['更新时间']), latestResumeId,
      sourceFileName: text(resume?.fields['源文件名']), sourceFileUrl: text(resume?.fields['源文件地址']), rawText: text(resume?.fields['OCR原文']),
      avatarUrl: text(resume?.fields['头像地址']), avatarStatus: text(resume?.fields['头像提取状态']),
      editableWordFileName: text(resume?.fields['可编辑Word文件名']), editableWordUrl: text(resume?.fields['可编辑Word地址']),
      wordConversionStatus: text(resume?.fields['Word转换状态']), wordConversionError: text(resume?.fields['Word转换错误']), wordConversionVersion: num(resume?.fields['Word转换版本']),
      wordConvertedBy: text(resume?.fields['Word转换人']), wordConvertedAt: text(resume?.fields['Word转换时间']),
      resumeReviewStatus: text(resume?.fields['人工复核状态']) || '待复核', resumeCorrectionSummary: text(resume?.fields['人工修正内容']),
      qualityWarnings: json<string[]>(resume?.fields['解析质量JSON'], []),
      skills: (() => {
        const activeSkills = data.tags.filter((item) => text(item.fields['候选人ID']) === candidateId && text(item.fields['标签分类']) === '技能标签' && !['历史', '人工移除'].includes(text(item.fields['标签状态']))).map((item) => text(item.fields['标签名称'])).filter(Boolean)
        return activeSkills.length ? activeSkills : json<string[]>(f['技能JSON'], []).length ? json<string[]>(f['技能JSON'], []) : this.extractSkills(text(resume?.fields['技能证书']))
      })(),
      tags: data.tags.filter((item) => text(item.fields['候选人ID']) === candidateId && !['历史', '人工移除'].includes(text(item.fields['标签状态']))).map((item) => ({ name: text(item.fields['标签名称']), category: text(item.fields['标签分类']), source: text(item.fields['标签来源']), confidence: num(item.fields['置信度']), evidence: text(item.fields['证据']), reviewStatus: text(item.fields['人工确认状态']), status: text(item.fields['标签状态']) || '当前' })),
      matches, bestMatchScore: matches[0]?.score || num(application?.fields['AI匹配分']), bestMatchRole: matches[0]?.positionName || text(f['期望职位']),
      analysis: assessment && effectiveAnalysis ? { id: assessmentId, version: num(assessment.fields['版本号']) || 1, versionName: text(assessment.fields['分析版本']) || 'talent-v1', parentId: text(assessment.fields['父分析记录ID']), type: text(assessment.fields['分析类型']), rerunReason: text(assessment.fields['重跑原因']), promptVersion: text(assessment.fields['提示词版本']), modelVersion: text(assessment.fields['模型版本']), runStatus: text(assessment.fields['运行状态']), durationMs: num(assessment.fields['耗时毫秒']), runError: text(assessment.fields['运行错误']), createdAt: text(assessment.fields['创建时间']), ...effectiveAnalysis, aiOriginal: originalAnalysis, corrected: Boolean(analysisCorrection), correction: analysisCorrection ? { changedFields: analysisCorrection.changedFields || [], reason: text(assessment.fields['人工修正原因']) || analysisCorrection.reason, operator: text(assessment.fields['修正人']) || analysisCorrection.operator, correctedAt: text(assessment.fields['修正时间']) || analysisCorrection.correctedAt } : null, reviewStatus: text(assessment.fields['人工确认状态']) || '待人工确认', humanNote: text(assessment.fields['人工修正内容']) } : null,
      _access: { candidateId, ownerUserId: text(application?.fields['负责人用户ID']) || text(f['负责人用户ID']), departmentIds, businessUnitId: text(demand?.fields['事业部ID']), interviewerUserIds, stage: text(application?.fields['当前阶段']) || text(f['候选人状态']) } satisfies TalentAccessContext,
    }
    if (full) {
      const applicationStart = (item: TeableRecord) => Date.parse(text(item.fields['投递时间']) || text(item.fields['创建时间']) || item.createdTime || '')
      const currentCommunications = data.communications.filter(item => {
        if (text(item.fields['应聘记录ID']) || !currentApplicationId) return belongsToCurrentApplication(item)
        if (text(item.fields['候选人ID']) !== candidateId) return false
        const occurredAt = Date.parse(text(item.fields['发生时间']) || text(item.fields['创建时间']) || item.createdTime || '')
        if (sortedCandidateApplications.length === 1) {
          const startedAt = applicationStart(application!)
          return !Number.isFinite(startedAt) || !Number.isFinite(occurredAt) || occurredAt >= startedAt
        }
        if (!Number.isFinite(occurredAt) || sortedCandidateApplications.some(record => !Number.isFinite(applicationStart(record)))) return false
        const preceding = sortedCandidateApplications.filter(record => applicationStart(record) <= occurredAt)
          .sort((first, second) => applicationStart(second) - applicationStart(first))
        if (!preceding.length || (preceding[1] && applicationStart(preceding[0]) === applicationStart(preceding[1]))) return false
        return (text(preceding[0].fields['应聘记录ID']) || preceding[0].id) === currentApplicationId
      })
      const currentInterviews = data.interviews.filter(belongsToCurrentApplication)
      const currentFeedback = data.interviewFeedback.filter(belongsToCurrentApplication)
      const currentOffers = data.offers.filter(belongsToCurrentApplication)
      const currentBackgroundChecks = data.backgroundChecks.filter(belongsToCurrentApplication)
      const currentOnboardings = data.onboardings.filter(belongsToCurrentApplication)
      const currentOffboardings = data.offboardings.filter(belongsToCurrentApplication)
      const currentReviewShares = data.reviewShares.filter(belongsToCurrentApplication)
      const latestInterview = currentInterviews
        .sort((a, b) => text(b.fields['开始时间']).localeCompare(text(a.fields['开始时间'])))[0]
      const latestFeedback = currentFeedback
        .sort((a, b) => (text(b.fields['提交时间']) || text(b.fields['更新时间'])).localeCompare(text(a.fields['提交时间']) || text(a.fields['更新时间'])))[0]
      const latestOffer = currentOffers
        .sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
      const latestBackground = currentBackgroundChecks
        .sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
      const latestOnboarding = currentOnboardings.sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
      const latestOnboardingId = text(latestOnboarding?.fields['入职单ID']) || latestOnboarding?.id || ''
      const latestOnboardingReview = data.probationReviews.filter((item) => text(item.fields['入职单ID']) === latestOnboardingId && text(item.fields['节点类型']) === '入职一月评价')
        .sort((a, b) => (text(b.fields['实际处理日期']) || text(b.fields['计划日期']) || text(b.fields['更新时间'])).localeCompare(text(a.fields['实际处理日期']) || text(a.fields['计划日期']) || text(a.fields['更新时间'])))[0]
      const latestOffboarding = currentOffboardings
        .sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
      const latestOffboardingId = text(latestOffboarding?.fields['离职单ID']) || latestOffboarding?.id || ''
      const latestFollowup = data.followups.filter((item) =>
        Boolean(latestOnboardingId && text(item.fields['入职单ID']) === latestOnboardingId)
        || Boolean(latestOffboardingId && text(item.fields['离职单ID']) === latestOffboardingId),
      )
        .sort((a, b) => text(b.fields['计划回访日期']).localeCompare(text(a.fields['计划回访日期'])))[0]
      result.flowEvidence = {
        communications: currentCommunications.length,
        interviews: currentInterviews.length,
        interviewFeedback: currentFeedback.filter((item) => text(item.fields['评价状态']) === '已提交').length,
        interviewQuestions: currentInterviews.length,
        interviewQuestionStatus: latestInterview ? text(latestInterview.fields['面试题状态']) || '待生成' : '',
        interview: latestInterview ? { id: text(latestInterview.fields['面试ID']) || latestInterview.id, status: text(latestInterview.fields['面试状态']), confirmationStatus: text(latestInterview.fields['候选人确认状态']), startedAt: text(latestInterview.fields['开始时间']), questionStatus: text(latestInterview.fields['面试题状态']) || '待生成' } : null,
        interviewFeedbackItem: latestFeedback ? { score: num(latestFeedback.fields['综合分']), conclusion: text(latestFeedback.fields['推荐结论']), candidateRating: text(latestFeedback.fields['候选人评级']), submittedAt: text(latestFeedback.fields['提交时间']) } : null,
        offer: latestOffer ? { status: text(latestOffer.fields['Offer状态']), response: text(latestOffer.fields['候选人答复']), sentAt: text(latestOffer.fields['发送时间']) } : null,
        background: latestBackground ? { status: text(latestBackground.fields['背调状态']), riskLevel: text(latestBackground.fields['风险等级']) } : null,
        onboarding: latestOnboarding ? { status: text(latestOnboarding.fields['入职状态']), actualDate: text(latestOnboarding.fields['实际到岗日期']), probation: text(latestOnboarding.fields['转正状态']) } : null,
        onboardingReview: latestOnboardingReview ? { id: text(latestOnboardingReview.fields['试用期记录ID']) || latestOnboardingReview.id, status: text(latestOnboardingReview.fields['处理状态']), plannedDate: text(latestOnboardingReview.fields['计划日期']), actualDate: text(latestOnboardingReview.fields['实际处理日期']), performanceRating: text(latestOnboardingReview.fields['述职评级']), growthLevel: text(latestOnboardingReview.fields['新人成长等级']), appraisal: text(latestOnboardingReview.fields['述职评价']) } : null,
        offboarding: latestOffboarding ? { status: text(latestOffboarding.fields['离职状态']), actualDate: text(latestOffboarding.fields['实际离职日期']), reason: text(latestOffboarding.fields['离职原因分类']) } : null,
        followup: latestFollowup ? { status: text(latestFollowup.fields['回访状态']), result: text(latestFollowup.fields['回访结果']), plannedDate: text(latestFollowup.fields['计划回访日期']), returnIntent: text(latestFollowup.fields['回流意向']) } : null,
      }
      result.applications = sortedCandidateApplications.map((item) => {
        const positionId = text(item.fields['职位ID'])
        const linkedPosition = data.positions.find((positionItem) => text(positionItem.fields['职位ID']) === positionId || positionItem.id === positionId)
        return { ...item.fields, positionName: text(linkedPosition?.fields['职位名称']) || text(item.fields['职位名称']) }
      })
      result.timeline = data.events.filter(belongsToCurrentApplication)
        .sort((a, b) => text(b.fields['发生时间']).localeCompare(text(a.fields['发生时间']))).map((item) => ({ id: text(item.fields['事件ID']) || item.id, from: text(item.fields['原阶段']), to: text(item.fields['新阶段']), action: text(item.fields['操作']), reason: text(item.fields['原因']), operator: text(item.fields['操作人']), time: text(item.fields['发生时间']), source: text(item.fields['来源类型']) }))
      result.communications = currentCommunications
        .sort((a, b) => text(b.fields['发生时间']).localeCompare(text(a.fields['发生时间']))).map((item) => this.mapCommunication(item))
      result.reviews = data.reviews.filter(belongsToCurrentApplication)
        .sort((a, b) => text(b.fields['审查时间']).localeCompare(text(a.fields['审查时间']))).map((item) => ({
          id: text(item.fields['审查记录ID']) || item.id, decision: text(item.fields['审查结论']), opinion: text(item.fields['审查意见']),
          evidence: json<string[]>(item.fields['证据JSON'], []), riskFeedback: json<Record<string, string>>(item.fields['风险项反馈JSON'], {}),
          operator: text(item.fields['审查人']), time: text(item.fields['审查时间']), from: text(item.fields['原阶段']), to: text(item.fields['目标阶段']),
        }))
      result.wecomReviews = currentReviewShares
        .sort((a, b) => text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间']))).map((share) => ({
          id: text(share.fields['分享批次ID']) || share.id, status: text(share.fields['分享状态']), responseCount: num(share.fields['反馈数']),
          claimedDepartment: text(share.fields['认领部门']), claimedPosition: text(share.fields['认领职位']), creator: text(share.fields['创建人']),
          sentAt: text(share.fields['发送时间']), expiresAt: text(share.fields['过期时间']), error: text(share.fields['发送错误']),
          responses: data.reviewResponses.filter((row) => text(row.fields['分享批次ID']) === (text(share.fields['分享批次ID']) || share.id)).map((row) => ({
            id: text(row.fields['反馈ID']) || row.id, decision: text(row.fields['反馈结论']), department: text(row.fields['部门']), position: text(row.fields['职位']),
            reviewer: text(row.fields['评审人']), comment: text(row.fields['评审意见']), processing: text(row.fields['处理结果']), submittedAt: text(row.fields['提交时间']),
          })),
        }))
      result.assessmentResults = data.assessmentInvites.filter(belongsToCurrentApplication)
        .sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间']))).map((item) => {
          const inviteId = text(item.fields['测评邀请ID']) || item.id
          const review = data.assessmentReviews.filter((row) => text(row.fields['测评邀请ID']) === inviteId)
            .sort((a, b) => text(b.fields['评审时间']).localeCompare(text(a.fields['评审时间'])))[0]
          return { id: inviteId, templateId: text(item.fields['题单ID']), status: text(item.fields['邀请状态']), completion: num(item.fields['完成度']),
            aiScore: num(item.fields['AI建议分']), aiScoreStatus: text(item.fields['AI评分状态']), finalScore: num(review?.fields['人工最终分']) || num(item.fields['人工最终分']),
            conclusion: text(review?.fields['人工结论']) || text(item.fields['人工结论']), reviewer: text(review?.fields['评审人']), submittedAt: text(item.fields['提交时间']), updatedAt: text(item.fields['更新时间']) }
        })
    }
    return result
  }

  private jobMap(candidates: any[]) {
    const map = new Map<string, { role: string; count: number; highScore: number; average: number; total: number }>()
    candidates.forEach((candidate) => candidate.matches.forEach((match: any) => {
      const current = map.get(match.positionName) || { role: match.positionName, count: 0, highScore: 0, average: 0, total: 0 }
      current.count += 1; current.total += match.score; if (match.score >= 80) current.highScore += 1; current.average = Math.round(current.total / current.count); map.set(match.positionName, current)
    }))
    return [...map.values()].sort((a, b) => b.count - a.count).map(({ total, ...item }) => item)
  }

  private overview(candidates: any[]) {
    return {
      total: candidates.length, pendingReview: candidates.filter((item) => item.analysis?.reviewStatus === '待人工确认').length,
      highMatch: candidates.filter((item) => item.bestMatchScore >= 80).length, referral: candidates.filter((item) => item.source.includes('内推')).length,
      duplicatePending: candidates.filter((item) => item.duplicateStatus.includes('疑似')).length,
    }
  }
}
