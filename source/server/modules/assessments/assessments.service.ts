import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { jobs } from '../../platform/jobs'
import { llm } from '../../platform/llm'
import { storage } from '../../platform/storage'
import { teable, TeableRecord } from '../../platform/teable'
import { DatabaseService } from '../database/database.service'
import { AssessmentInviteInput, AssessmentReviewInput, AssessmentTemplateInput, QuestionInput } from './assessment.types'

const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
const text = (value: unknown) => String(value ?? '').trim()
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const json = <T>(value: unknown, fallback: T): T => { try { return value ? JSON.parse(String(value)) as T : fallback } catch { return fallback } }
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

@Injectable()
export class AssessmentsService {
  constructor(private readonly database: DatabaseService) {}

  private table(name: string) { return this.database.requireTableId(name) }

  async listQuestions(query: { category?: string; type?: string; position?: string; status?: string }, actor?: { userId: string; positionIds: string[] }) {
    const rows = await teable.listAllRecords(this.table('recruitment_question_bank'))
    const questions = rows.filter(row => {
      const owner = text(row.fields['适用面试官用户ID']), ownerIds = json<string[]>(owner, owner ? [owner] : [])
      const positionId = text(json<any>(row.fields['评分规则JSON'], {}).positionId)
      return (!ownerIds.length || Boolean(actor && ownerIds.includes(actor.userId))) && (!positionId || Boolean(actor?.positionIds.includes(positionId)))
    }).map((row) => this.mapQuestion(row, true)).filter((item) =>
      (!query.category || item.category === query.category) && (!query.type || item.type === query.type)
      && (!query.position || !item.position || item.position === query.position)
      && (!query.status || item.status === query.status))
    return { total: questions.length, questions }
  }

  async createQuestion(input: QuestionInput) {
    this.validateQuestion(input)
    const timestamp = now()
    const questionId = id('question')
    await teable.createRecord(this.table('recruitment_question_bank'), {
      题目ID: questionId, 题目分类: input.category, 题目类型: input.type, 题干: input.title, 题目说明: text(input.description),
      选项JSON: JSON.stringify(input.options || []), 参考答案: text(input.referenceAnswer), 评分规则JSON: JSON.stringify(input.scoringRules || {}),
      满分: Math.max(1, Math.min(100, Math.round(num(input.score) || 10))), 是否必答: input.required === false ? '否' : '是',
      题目来源: text(input.source) || '人工', 题目状态: text(input.status) || '草稿', 适用岗位: text(input.position),
      创建人用户ID: text(input.operatorUserId), 创建人: text(input.operator) || '当前用户', 创建时间: timestamp, 更新时间: timestamp,
    })
    await this.audit('新增测评题目', '测评题目', questionId, {}, { category: input.category, type: input.type, title: input.title }, text(input.operator) || '当前用户')
    return { questionId, status: text(input.status) || '草稿' }
  }

  async updateQuestion(questionId: string, input: Partial<QuestionInput>, allowedPositionIds?: string[]) {
    const rows = await teable.listAllRecords(this.table('recruitment_question_bank'))
    const row = rows.find((item) => text(item.fields['题目ID']) === questionId || item.id === questionId)
    if (!row) throw new NotFoundException('题目不存在')
    const owner = text(row.fields['适用面试官用户ID']), ownerIds = json<string[]>(owner, owner ? [owner] : [])
    const positionId = text(json<any>(row.fields['评分规则JSON'], {}).positionId)
    if (ownerIds.length && !ownerIds.includes(text(input.operatorUserId))) throw new ForbiddenException('只能维护自己的个人题库')
    if (positionId && !allowedPositionIds?.includes(positionId)) throw new ForbiddenException('没有该岗位的题库权限')
    if (text(row.fields['题目状态']) === '已发布' && input.type && input.type !== text(row.fields['题目类型'])) throw new ConflictException('已发布题目不能修改题型，请复制为新题目')
    const merged: QuestionInput = {
      category: text(input.category) || text(row.fields['题目分类']), type: (input.type || text(row.fields['题目类型'])) as any,
      title: text(input.title) || text(row.fields['题干']), description: input.description ?? text(row.fields['题目说明']),
      options: input.options || json<string[]>(row.fields['选项JSON'], []), referenceAnswer: input.referenceAnswer ?? text(row.fields['参考答案']),
      scoringRules: input.scoringRules || json(row.fields['评分规则JSON'], {}), score: input.score ?? num(row.fields['满分']),
      required: input.required ?? text(row.fields['是否必答']) !== '否', position: input.position ?? text(row.fields['适用岗位']),
      source: input.source ?? text(row.fields['题目来源']), status: input.status ?? text(row.fields['题目状态']),
    }
    this.validateQuestion(merged)
    await teable.updateRecord(this.table('recruitment_question_bank'), row.id, {
      题目分类: merged.category, 题目类型: merged.type, 题干: merged.title, 题目说明: text(merged.description),
      选项JSON: JSON.stringify(merged.options || []), 参考答案: text(merged.referenceAnswer), 评分规则JSON: JSON.stringify(merged.scoringRules || {}),
      满分: merged.score, 是否必答: merged.required === false ? '否' : '是', 题目来源: text(merged.source), 题目状态: text(merged.status),
      适用岗位: text(merged.position), 更新时间: now(),
    })
    await this.audit('修改测评题目', '测评题目', text(row.fields['题目ID']) || questionId, row.fields, merged, text(input.operator) || '当前用户')
    return this.mapQuestion({ ...row, fields: { ...row.fields, 题目分类: merged.category, 题目类型: merged.type, 题干: merged.title } }, true)
  }

  async listTemplates(query: { status?: string; position?: string }) {
    const [templates, questions] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_assessment_templates')),
      teable.listAllRecords(this.table('recruitment_question_bank')),
    ])
    const items = templates.map((row) => this.mapTemplate(row, questions, true)).filter((item) =>
      (!query.status || item.status === query.status) && (!query.position || !item.position || item.position === query.position))
    return { total: items.length, templates: items }
  }

  async createTemplate(input: AssessmentTemplateInput) {
    if (!text(input.name) || !text(input.category)) throw new BadRequestException('题单名称和分类不能为空')
    if (!Array.isArray(input.questionIds) || !input.questionIds.length) throw new BadRequestException('题单至少需要一道题')
    const questionRows = await teable.listAllRecords(this.table('recruitment_question_bank'))
    const selected = input.questionIds.map((questionId) => questionRows.find((row) => text(row.fields['题目ID']) === questionId || row.id === questionId))
    if (selected.some((row) => !row)) throw new BadRequestException('题单包含不存在的题目')
    const timestamp = now()
    const templateId = id('assessment')
    await teable.createRecord(this.table('recruitment_assessment_templates'), {
      题单ID: templateId, 题单名称: input.name, 题单分类: input.category, 职位ID: text(input.positionId), 适用岗位: text(input.position),
      答题说明: text(input.instructions), 限时分钟: Math.max(5, Math.min(240, Math.round(num(input.durationMinutes) || 30))),
      题目IDJSON: JSON.stringify(input.questionIds), 总分: selected.reduce((sum, row) => sum + num(row?.fields['满分']), 0),
      题单状态: '草稿', 版本: 1, 创建人用户ID: text(input.operatorUserId), 创建人: text(input.operator) || '当前用户',
      创建时间: timestamp, 更新时间: timestamp,
    })
    await this.audit('新增测评题单', '测评题单', templateId, {}, { name: input.name, questionIds: input.questionIds }, text(input.operator) || '当前用户')
    return { templateId, status: '草稿' }
  }

  generateDraft(body: { candidateId: string; positionId?: string; count?: number; operator?: string; operatorUserId?: string }) {
    const jobId = jobs.start((progress) => this.generateDraftJob(body, progress))
    return { jobId, status: 'running' }
  }

  private async generateDraftJob(body: { candidateId: string; positionId?: string; count?: number; operator?: string; operatorUserId?: string }, progress: (message: string) => void) {
    progress('读取候选人简历与岗位JD')
    const [candidates, positions] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_positions')),
    ])
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === body.candidateId || row.id === body.candidateId)
    if (!candidate) throw new NotFoundException('候选人不存在')
    const position = positions.find((row) => text(row.fields['职位ID']) === body.positionId || row.id === body.positionId)
    const count = Math.max(3, Math.min(12, Math.round(num(body.count) || 5)))
    const positionName = text(position?.fields['职位名称']) || text(candidate.fields['期望职位']) || '目标岗位'
    const prompt = `你是招聘测评题目设计助手。根据候选人简历和岗位JD生成${count}道测评题草稿。只返回JSON数组，不要Markdown。每项字段：category,type,title,description,options,referenceAnswer,score,required。type只能是text、single、multiple，避免隐私歧视和无关问题。\n岗位：${positionName}\nJD：${text(position?.fields['岗位JD'])} ${text(position?.fields['任职要求'])}\n经历：${text(candidate.fields['工作经历'])}\n技能：${text(candidate.fields['技能JSON'])}`
    progress('AI生成题目草稿')
    let drafts: QuestionInput[] = []
    try {
      const raw = await llm.chat([{ role: 'system', content: '输出严格JSON。题目用于辅助招聘，必须由人工审核后发布。' }, { role: 'user', content: prompt }])
      drafts = json<QuestionInput[]>(raw.replace(/^```json\s*|\s*```$/g, ''), [])
    } catch {}
    if (!drafts.length) drafts = this.fallbackDrafts(positionName, count)
    progress('保存待人工审核题目')
    const questionIds: string[] = []
    for (const draft of drafts.slice(0, count)) {
      const created = await this.createQuestion({ ...draft, position: positionName, source: 'AI草稿', status: '草稿', operator: text(body.operator) || '当前用户', operatorUserId: body.operatorUserId })
      questionIds.push(created.questionId)
    }
    const template = await this.createTemplate({
      name: `${text(candidate.fields['姓名']) || '候选人'} · ${positionName}定制测评`, category: 'AI定制测评', positionId: body.positionId,
      position: positionName, instructions: '请独立完成。AI生成题目已经进入人工审核流程，发布前需由招聘负责人确认。', durationMinutes: 40,
      questionIds, operator: body.operator, operatorUserId: body.operatorUserId,
    })
    return { ...template, questionIds, generatedCount: questionIds.length, source: 'AI草稿', requiresHumanReview: true }
  }

  async publishTemplate(templateId: string, body: { operator?: string; operatorUserId?: string }) {
    const table = this.table('recruitment_assessment_templates')
    const templates = await teable.listAllRecords(table)
    const template = templates.find((row) => text(row.fields['题单ID']) === templateId || row.id === templateId)
    if (!template) throw new NotFoundException('题单不存在')
    if (text(template.fields['题单状态']) === '已发布') return { templateId: text(template.fields['题单ID']) || templateId, status: '已发布' }
    const questionIds = json<string[]>(template.fields['题目IDJSON'], [])
    const questions = await teable.listAllRecords(this.table('recruitment_question_bank'))
    const selected = questionIds.map((questionId) => questions.find((row) => text(row.fields['题目ID']) === questionId || row.id === questionId))
    if (!questionIds.length || selected.some((row) => !row)) throw new BadRequestException('题单题目不完整，不能发布')
    for (const question of selected) await teable.updateRecord(this.table('recruitment_question_bank'), question!.id, { 题目状态: '已发布', 更新时间: now() })
    const timestamp = now()
    await teable.updateRecord(table, template.id, { 题单状态: '已发布', 发布人用户ID: text(body.operatorUserId), 发布人: text(body.operator) || '当前用户', 发布时间: timestamp, 更新时间: timestamp })
    await this.audit('发布测评题单', '测评题单', text(template.fields['题单ID']) || templateId, template.fields, { status: '已发布', questionIds }, text(body.operator) || '当前用户')
    return { templateId: text(template.fields['题单ID']) || templateId, status: '已发布', questionCount: questionIds.length }
  }

  async createInvite(input: AssessmentInviteInput) {
    const [candidates, templates, applications] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_assessment_templates')),
      teable.listAllRecords(this.table('recruitment_applications')),
    ])
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === input.candidateId || row.id === input.candidateId)
    if (!candidate || text(candidate.fields['合并状态']) === '已合并') throw new NotFoundException('可邀请的候选人不存在')
    const template = templates.find((row) => text(row.fields['题单ID']) === input.templateId || row.id === input.templateId)
    if (!template || text(template.fields['题单状态']) !== '已发布') throw new BadRequestException('只能邀请候选人填写已发布题单')
    const application = applications.find((row) => text(row.fields['应聘记录ID']) === input.applicationId)
      || applications.filter((row) => text(row.fields['候选人ID']) === input.candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const token = randomBytes(32).toString('base64url')
    const inviteId = id('assessmentinvite')
    const timestamp = now()
    const expiresHours = Math.max(1, Math.min(168, Math.round(num(input.expiresHours) || 72)))
    const expiresAt = new Date(Date.now() + expiresHours * 3_600_000).toISOString()
    await teable.createRecord(this.table('recruitment_assessment_invites'), {
      测评邀请ID: inviteId, 候选人ID: input.candidateId, 应聘记录ID: text(application?.fields['应聘记录ID']),
      职位ID: text(application?.fields['职位ID']) || text(template.fields['职位ID']), 题单ID: text(template.fields['题单ID']) || input.templateId,
      题单版本: String(num(template.fields['版本']) || 1), 访问Token哈希: hashToken(token), Token前缀: token.slice(0, 8), 邀请路径: `?assessment_token=${encodeURIComponent(token)}`,
      邀请状态: '待访问', 过期时间: expiresAt, 访问次数: 0, 完成度: 0, 异常JSON: '[]', AI评分状态: '待提交',
      创建人用户ID: text(input.operatorUserId), 创建人: text(input.operator) || '当前用户', 创建时间: timestamp, 更新时间: timestamp,
    })
    await this.audit('创建测评邀请', '测评邀请', inviteId, {}, { candidateId: input.candidateId, templateId: input.templateId, expiresAt }, text(input.operator) || '当前用户')
    return { inviteId, token, path: `?assessment_token=${encodeURIComponent(token)}`, expiresAt, candidateName: text(candidate.fields['姓名']), templateName: text(template.fields['题单名称']) }
  }

  async candidateAssessmentContext(candidateId: string) {
    const result = await this.listSubmissions({ candidateId })
    const latest = result.submissions[0]
    if (!latest) return { candidateId, latest: null, history: [] }
    const detail = await this.submissionDetail(latest.id)
    return {
      candidateId, latest: {
        inviteId: detail.id, templateName: detail.templateName, status: detail.status, completion: detail.completion,
        aiScore: detail.aiScore, aiScoreStatus: detail.aiScoreStatus, finalScore: detail.finalScore, conclusion: detail.conclusion,
        submittedAt: detail.submittedAt, anomalies: detail.anomalies, questions: detail.questions,
      },
      history: result.submissions.map((item) => ({ inviteId: item.id, templateName: item.templateName, status: item.status, aiScore: item.aiScore, finalScore: item.finalScore, conclusion: item.conclusion, submittedAt: item.submittedAt })),
    }
  }

  async getPublicAssessment(token: string) {
    const context = await this.resolveToken(token, true)
    return this.publicPayload(context)
  }

  async saveAnswers(token: string, body: { answers: Array<{ questionId: string; value: unknown }>; clientTime?: string }) {
    const context = await this.resolveToken(token)
    if (!Array.isArray(body.answers)) throw new BadRequestException('答案格式错误')
    const questionIds = new Set(json<string[]>(context.template.fields['题目IDJSON'], []))
    const table = this.table('recruitment_assessment_answers')
    const existing = await teable.listAllRecords(table)
    const timestamp = now()
    for (const answer of body.answers) {
      if (!questionIds.has(text(answer.questionId))) throw new BadRequestException('答案包含不属于本题单的题目')
      const question = context.questions.find((row) => text(row.fields['题目ID']) === answer.questionId || row.id === answer.questionId)
      const row = existing.find((item) => text(item.fields['测评邀请ID']) === context.inviteId && text(item.fields['题目ID']) === answer.questionId)
      const fields = { 测评邀请ID: context.inviteId, 候选人ID: context.candidateId, 题目ID: answer.questionId,
        题目类型: text(question?.fields['题目类型']), 答案JSON: JSON.stringify(answer.value ?? ''), 自动保存时间: timestamp,
        正式提交状态: '草稿', 更新时间: timestamp }
      if (row) await teable.updateRecord(table, row.id, fields)
      else await teable.createRecord(table, { 答案ID: id('answer'), ...fields })
    }
    const answers = await teable.listAllRecords(table)
    const answered = answers.filter((row) => text(row.fields['测评邀请ID']) === context.inviteId && this.hasAnswer(row)).length
    const completion = context.questions.length ? Math.round(answered / context.questions.length * 100) : 0
    await teable.updateRecord(this.table('recruitment_assessment_invites'), context.invite.id, { 邀请状态: '答题中', 完成度: completion, 更新时间: timestamp })
    await this.event(context, '自动保存', { answerCount: body.answers.length, completion }, body.clientTime)
    return { saved: body.answers.length, completion, savedAt: timestamp }
  }

  async uploadAnswerFile(token: string, questionId: string, file: Express.Multer.File) {
    const context = await this.resolveToken(token)
    if (!file?.buffer?.length) throw new BadRequestException('请选择文件')
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('答题附件不能超过10MB')
    const question = context.questions.find((row) => text(row.fields['题目ID']) === questionId || row.id === questionId)
    if (!question || text(question.fields['题目类型']) !== 'file') throw new BadRequestException('该题不是文件上传题')
    const safeName = file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    const uploaded = await storage.upload(`assessments/${context.inviteId}/${questionId}-${Date.now()}-${safeName}`, file.mimetype || 'application/octet-stream', file.buffer)
    const table = this.table('recruitment_assessment_answers')
    const rows = await teable.listAllRecords(table)
    const row = rows.find((item) => text(item.fields['测评邀请ID']) === context.inviteId && text(item.fields['题目ID']) === questionId)
    const timestamp = now()
    const fields = { 测评邀请ID: context.inviteId, 候选人ID: context.candidateId, 题目ID: questionId, 题目类型: 'file',
      答案JSON: JSON.stringify({ fileName: file.originalname, fileUrl: uploaded.cdnUrl }), 文件名: file.originalname,
      文件地址: uploaded.cdnUrl, 文件大小: file.size, 自动保存时间: timestamp, 正式提交状态: '草稿', 更新时间: timestamp }
    if (row) await teable.updateRecord(table, row.id, fields)
    else await teable.createRecord(table, { 答案ID: id('answer'), ...fields })
    return { questionId, fileName: file.originalname, fileUrl: uploaded.cdnUrl, size: file.size }
  }

  async recordPublicEvent(token: string, body: { type: string; detail?: unknown; clientTime?: string }) {
    const allowed = ['页面失焦', '页面恢复', '复制', '粘贴', '全屏退出', '网络离线', '网络恢复']
    if (!allowed.includes(text(body.type))) throw new BadRequestException('不支持的测评事件类型')
    const context = await this.resolveToken(token)
    await this.event(context, body.type, body.detail || {}, body.clientTime)
    return { recorded: true }
  }

  async submit(token: string, body: { clientTime?: string }) {
    const context = await this.resolveToken(token)
    const answerRows = (await teable.listAllRecords(this.table('recruitment_assessment_answers'))).filter((row) => text(row.fields['测评邀请ID']) === context.inviteId)
    const missing = context.questions.filter((question) => text(question.fields['是否必答']) !== '否')
      .filter((question) => !answerRows.some((answer) => text(answer.fields['题目ID']) === text(question.fields['题目ID']) && this.hasAnswer(answer)))
    if (missing.length) throw new BadRequestException({ message: '仍有必答题未完成', missingQuestionIds: missing.map((row) => text(row.fields['题目ID'])) })
    const submittedAt = now()
    const startedAt = text(context.invite.fields['开始答题时间']) || text(context.invite.fields['首次访问时间']) || submittedAt
    const durationSeconds = Math.max(0, Math.round((Date.parse(submittedAt) - Date.parse(startedAt)) / 1000))
    for (const answer of answerRows) await teable.updateRecord(this.table('recruitment_assessment_answers'), answer.id, { 正式提交状态: '已提交', 更新时间: submittedAt })
    await teable.updateRecord(this.table('recruitment_assessment_invites'), context.invite.id, {
      邀请状态: '已提交', 提交时间: submittedAt, 完成度: 100, 答题耗时秒: durationSeconds, AI评分状态: '评分中', 更新时间: submittedAt,
    })
    await this.event(context, '正式提交', { durationSeconds, answerCount: answerRows.length }, body.clientTime)
    const scoreJobId = jobs.start((progress) => this.scoreSubmissionJob(context.inviteId, progress))
    return { inviteId: context.inviteId, status: '已提交', submittedAt, durationSeconds, scoreJobId }
  }

  async listSubmissions(query: { status?: string; candidateId?: string }) {
    const [invites, candidates, templates] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_assessment_invites')),
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_assessment_templates')),
    ])
    const submissions = invites.filter((row) => !query.status || text(row.fields['邀请状态']) === query.status)
      .filter((row) => !query.candidateId || text(row.fields['候选人ID']) === query.candidateId)
      .map((row) => {
        const candidateId = text(row.fields['候选人ID']); const templateId = text(row.fields['题单ID'])
        const candidate = candidates.find((item) => text(item.fields['候选人ID']) === candidateId || item.id === candidateId)
        const template = templates.find((item) => text(item.fields['题单ID']) === templateId || item.id === templateId)
        return this.mapSubmission(row, candidate, template)
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { total: submissions.length, submissions }
  }

  async submissionDetail(inviteId: string) {
    const [invites, candidates, templates, questions, answers, events, reviews] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_assessment_invites')), teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_assessment_templates')), teable.listAllRecords(this.table('recruitment_question_bank')),
      teable.listAllRecords(this.table('recruitment_assessment_answers')), teable.listAllRecords(this.table('recruitment_assessment_events')),
      teable.listAllRecords(this.table('recruitment_assessment_reviews')),
    ])
    const invite = invites.find((row) => text(row.fields['测评邀请ID']) === inviteId || row.id === inviteId)
    if (!invite) throw new NotFoundException('测评记录不存在')
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === text(invite.fields['候选人ID']))
    const template = templates.find((row) => text(row.fields['题单ID']) === text(invite.fields['题单ID']))
    const questionIds = json<string[]>(template?.fields['题目IDJSON'], [])
    return {
      ...this.mapSubmission(invite, candidate, template),
      questions: questionIds.map((questionId) => {
        const question = questions.find((row) => text(row.fields['题目ID']) === questionId || row.id === questionId)
        const answer = answers.find((row) => text(row.fields['测评邀请ID']) === (text(invite.fields['测评邀请ID']) || invite.id) && text(row.fields['题目ID']) === questionId)
        return { question: question ? this.mapQuestion(question, true) : null, answer: answer ? this.mapAnswer(answer) : null }
      }),
      events: events.filter((row) => text(row.fields['测评邀请ID']) === (text(invite.fields['测评邀请ID']) || invite.id)).map((row) => ({ id: text(row.fields['测评事件ID']) || row.id, type: text(row.fields['事件类型']), detail: json(row.fields['事件详情JSON'], {}), time: text(row.fields['发生时间']) })),
      reviews: reviews.filter((row) => text(row.fields['测评邀请ID']) === (text(invite.fields['测评邀请ID']) || invite.id)).map((row) => ({ id: text(row.fields['测评评审ID']) || row.id, finalScore: num(row.fields['人工最终分']), conclusion: text(row.fields['人工结论']), comment: text(row.fields['人工评语']), reviewer: text(row.fields['评审人']), time: text(row.fields['评审时间']) })),
    }
  }

  async reviewSubmission(inviteId: string, input: AssessmentReviewInput) {
    if (num(input.finalScore) < 0 || num(input.finalScore) > 100) throw new BadRequestException('人工最终分必须在0到100之间')
    if (!text(input.conclusion) || !text(input.comment)) throw new BadRequestException('人工结论和评语不能为空')
    let invite: TeableRecord | undefined
    try { invite = await teable.getRecord(this.table('recruitment_assessment_invites'), inviteId) } catch {}
    if (!invite) invite = await teable.findOneByField(this.table('recruitment_assessment_invites'), '测评邀请ID', inviteId)
    if (!invite) throw new NotFoundException('测评记录不存在')
    if (!['已提交', '已评分'].includes(text(invite.fields['邀请状态']))) throw new ConflictException('候选人尚未正式提交，不能进行人工评分')
    const timestamp = now()
    const reviewId = id('assessmentreview')
    await teable.createRecord(this.table('recruitment_assessment_reviews'), {
      测评评审ID: reviewId, 测评邀请ID: text(invite.fields['测评邀请ID']) || inviteId, 候选人ID: text(invite.fields['候选人ID']),
      应聘记录ID: text(invite.fields['应聘记录ID']), AI建议分: num(invite.fields['AI建议分']), AI评分摘要: text(invite.fields['AI评分JSON']),
      人工最终分: input.finalScore, 人工结论: input.conclusion, 人工评语: input.comment, 逐题评分JSON: JSON.stringify(input.questionScores || {}),
      评审人用户ID: text(input.operatorUserId), 评审人: text(input.operator) || '当前用户', 评审时间: timestamp, 创建时间: timestamp,
    })
    await teable.updateRecord(this.table('recruitment_assessment_invites'), invite.id, { 邀请状态: '已评分', 人工最终分: input.finalScore, 人工结论: input.conclusion, 更新时间: timestamp })
    await teable.createRecord(this.table('recruitment_stage_events'), {
      事件ID: id('evt'), 应聘记录ID: text(invite.fields['应聘记录ID']), 候选人ID: text(invite.fields['候选人ID']), 职位ID: text(invite.fields['职位ID']),
      原阶段: '在线测评', 新阶段: '在线测评', 操作: '人工确认测评结果', 结果: input.conclusion, 原因: input.comment,
      操作人用户ID: text(input.operatorUserId), 操作人: text(input.operator) || '当前用户', 发生时间: timestamp, 来源类型: '人工操作', 来源记录ID: reviewId,
      扩展信息JSON: JSON.stringify({ finalScore: input.finalScore, aiScore: num(invite.fields['AI建议分']) }),
    })
    await this.audit('人工确认测评结果', '测评邀请', text(invite.fields['测评邀请ID']) || inviteId, invite.fields,
      { finalScore: input.finalScore, conclusion: input.conclusion, reviewId }, text(input.operator) || '当前用户', input.comment)
    return { reviewId, inviteId: text(invite.fields['测评邀请ID']) || inviteId, finalScore: input.finalScore, conclusion: input.conclusion }
  }

  private async scoreSubmissionJob(inviteId: string, progress: (message: string) => void) {
    progress('读取题目、答案和评分规则')
    const detail = await this.submissionDetail(inviteId)
    const scorable = detail.questions.filter((item: any) => item.question && item.answer)
    const prompt = `你是招聘测评评分助手。根据题目、参考答案、评分规则和候选人答案生成评分建议。只返回JSON：{"score":0到100,"summary":"...","questions":{"题目ID":{"score":0到题目满分,"reason":"..."}}}。这是辅助建议，最终分由人工确认。\n${JSON.stringify(scorable.map((item: any) => ({ id: item.question.id, title: item.question.title, type: item.question.type, maxScore: item.question.score, referenceAnswer: item.question.referenceAnswer, scoringRules: item.question.scoringRules, answer: item.answer.value })))}`
    progress('AI生成辅助评分草稿')
    let scored: any = null
    try {
      const raw = await llm.chat([{ role: 'system', content: '输出严格JSON，不做录用决定，只给评分依据。' }, { role: 'user', content: prompt }])
      scored = json(raw.replace(/^```json\s*|\s*```$/g, ''), null)
    } catch {}
    if (!scored) scored = this.fallbackScore(scorable)
    const answerRows = await teable.listAllRecords(this.table('recruitment_assessment_answers'))
    for (const row of answerRows.filter((item) => text(item.fields['测评邀请ID']) === inviteId)) {
      const questionScore = scored.questions?.[text(row.fields['题目ID'])]
      if (questionScore) await teable.updateRecord(this.table('recruitment_assessment_answers'), row.id, { AI建议分: num(questionScore.score), AI评分说明: text(questionScore.reason), 更新时间: now() })
    }
    const invites = await teable.listAllRecords(this.table('recruitment_assessment_invites'))
    const invite = invites.find((row) => text(row.fields['测评邀请ID']) === inviteId || row.id === inviteId)
    if (!invite) throw new NotFoundException('测评记录不存在')
    await teable.updateRecord(this.table('recruitment_assessment_invites'), invite.id, { AI建议分: Math.max(0, Math.min(100, Math.round(num(scored.score)))), AI评分JSON: JSON.stringify(scored), AI评分状态: '待人工确认', 更新时间: now() })
    return { inviteId, aiScore: Math.round(num(scored.score)), summary: text(scored.summary), requiresHumanReview: true }
  }

  private async resolveToken(token: string, countAccess = false) {
    if (!text(token)) throw new UnauthorizedException('测评链接无效')
    const invite = await teable.findOneByField(this.table('recruitment_assessment_invites'), '访问Token哈希', hashToken(token))
    if (!invite) throw new UnauthorizedException('测评链接无效或已被撤销')
    const status = text(invite.fields['邀请状态'])
    if (['已提交', '已评分', '已撤销'].includes(status)) throw new ConflictException(status === '已撤销' ? '测评链接已被撤销' : '该测评已经正式提交，不能重复作答')
    if (Date.parse(text(invite.fields['过期时间'])) <= Date.now()) {
      await teable.updateRecord(this.table('recruitment_assessment_invites'), invite.id, { 邀请状态: '已过期', 更新时间: now() })
      throw new UnauthorizedException('测评链接已过期')
    }
    const [templates, questions, candidates] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_assessment_templates')), teable.listAllRecords(this.table('recruitment_question_bank')),
      teable.listAllRecords(this.table('recruitment_candidates')),
    ])
    const template = templates.find((row) => text(row.fields['题单ID']) === text(invite.fields['题单ID']) || row.id === text(invite.fields['题单ID']))
    if (!template || text(template.fields['题单状态']) !== '已发布') throw new ConflictException('题单未发布或已下线')
    const questionIds = json<string[]>(template.fields['题目IDJSON'], [])
    const selected = questionIds.map((questionId) => questions.find((row) => text(row.fields['题目ID']) === questionId || row.id === questionId)).filter(Boolean) as TeableRecord[]
    const candidateId = text(invite.fields['候选人ID'])
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === candidateId || row.id === candidateId)
    const inviteId = text(invite.fields['测评邀请ID']) || invite.id
    if (countAccess) {
      const timestamp = now()
      const firstAccess = text(invite.fields['首次访问时间']) || timestamp
      const startedAt = text(invite.fields['开始答题时间']) || timestamp
      await teable.updateRecord(this.table('recruitment_assessment_invites'), invite.id, { 邀请状态: '答题中', 首次访问时间: firstAccess, 开始答题时间: startedAt, 访问次数: num(invite.fields['访问次数']) + 1, 更新时间: timestamp })
      await this.event({ invite, inviteId, candidateId } as any, '打开测评', { accessCount: num(invite.fields['访问次数']) + 1 })
    }
    return { invite, inviteId, candidateId, candidate, template, questions: selected }
  }

  private async publicPayload(context: any) {
    const answers = (await teable.listAllRecords(this.table('recruitment_assessment_answers'))).filter((row) => text(row.fields['测评邀请ID']) === context.inviteId)
    return {
      inviteId: context.inviteId, candidateName: text(context.candidate?.fields['姓名']), status: '答题中', expiresAt: text(context.invite.fields['过期时间']),
      template: { id: text(context.template.fields['题单ID']), name: text(context.template.fields['题单名称']), category: text(context.template.fields['题单分类']), instructions: text(context.template.fields['答题说明']), durationMinutes: num(context.template.fields['限时分钟']), totalScore: num(context.template.fields['总分']) },
      questions: context.questions.map((row: TeableRecord, index: number) => ({ order: index + 1, ...this.mapQuestion(row, false), savedAnswer: this.mapSavedPublicAnswer(answers.find((answer) => text(answer.fields['题目ID']) === text(row.fields['题目ID']))) })),
    }
  }

  private async event(context: { invite: TeableRecord; inviteId: string; candidateId: string }, type: string, detail: unknown, clientTime?: string) {
    const timestamp = now()
    await teable.createRecord(this.table('recruitment_assessment_events'), { 测评事件ID: id('assessmentevent'), 测评邀请ID: context.inviteId, 候选人ID: context.candidateId, 事件类型: type, 事件详情JSON: JSON.stringify(detail || {}), 客户端时间: text(clientTime), 发生时间: timestamp })
    if (['页面失焦', '复制', '粘贴', '全屏退出', '网络离线'].includes(type)) {
      const anomalies = json<any[]>(context.invite.fields['异常JSON'], [])
      anomalies.push({ type, detail, time: timestamp })
      await teable.updateRecord(this.table('recruitment_assessment_invites'), context.invite.id, { 异常JSON: JSON.stringify(anomalies.slice(-100)), 更新时间: timestamp })
    }
  }

  private validateQuestion(input: QuestionInput) {
    if (!text(input.category) || !text(input.title)) throw new BadRequestException('题目分类和题干不能为空')
    if (!['text', 'single', 'multiple', 'file'].includes(input.type)) throw new BadRequestException('题型必须是文本、单选、多选或文件')
    if (['single', 'multiple'].includes(input.type) && (!input.options || input.options.length < 2)) throw new BadRequestException('单选或多选题至少需要两个选项')
  }

  private mapQuestion(row: TeableRecord, includeAnswer: boolean) {
    const item: any = { id: text(row.fields['题目ID']) || row.id, category: text(row.fields['题目分类']), type: text(row.fields['题目类型']), title: text(row.fields['题干']), description: text(row.fields['题目说明']), options: json<string[]>(row.fields['选项JSON'], []), score: num(row.fields['满分']), required: text(row.fields['是否必答']) !== '否', source: text(row.fields['题目来源']), status: text(row.fields['题目状态']), position: text(row.fields['适用岗位']) }
    if (includeAnswer) { item.referenceAnswer = text(row.fields['参考答案']); item.scoringRules = json(row.fields['评分规则JSON'], {}) }
    return item
  }

  private mapTemplate(row: TeableRecord, questions: TeableRecord[], includeAnswers: boolean) {
    const ids = json<string[]>(row.fields['题目IDJSON'], [])
    return { id: text(row.fields['题单ID']) || row.id, name: text(row.fields['题单名称']), category: text(row.fields['题单分类']), positionId: text(row.fields['职位ID']), position: text(row.fields['适用岗位']), instructions: text(row.fields['答题说明']), durationMinutes: num(row.fields['限时分钟']), totalScore: num(row.fields['总分']), status: text(row.fields['题单状态']), version: num(row.fields['版本']), publishedAt: text(row.fields['发布时间']), questions: ids.map((questionId) => questions.find((item) => text(item.fields['题目ID']) === questionId || item.id === questionId)).filter(Boolean).map((question) => this.mapQuestion(question!, includeAnswers)) }
  }

  private mapAnswer(row: TeableRecord) { return { id: text(row.fields['答案ID']) || row.id, questionId: text(row.fields['题目ID']), type: text(row.fields['题目类型']), value: json(row.fields['答案JSON'], ''), fileName: text(row.fields['文件名']), fileUrl: text(row.fields['文件地址']), aiScore: num(row.fields['AI建议分']), aiComment: text(row.fields['AI评分说明']), humanScore: num(row.fields['人工评分']), humanComment: text(row.fields['人工评语']), submitted: text(row.fields['正式提交状态']) === '已提交', updatedAt: text(row.fields['更新时间']) } }
  private mapSavedPublicAnswer(row?: TeableRecord) { return row ? { value: json(row.fields['答案JSON'], ''), fileName: text(row.fields['文件名']), fileUrl: text(row.fields['文件地址']), savedAt: text(row.fields['自动保存时间']) } : null }
  private hasAnswer(row: TeableRecord) { const value = json<any>(row.fields['答案JSON'], ''); return Boolean(text(row.fields['文件地址']) || (Array.isArray(value) ? value.length : text(value))) }
  private mapSubmission(row: TeableRecord, candidate?: TeableRecord, template?: TeableRecord) { return { id: text(row.fields['测评邀请ID']) || row.id, candidateId: text(row.fields['候选人ID']), candidateName: text(candidate?.fields['姓名']), applicationId: text(row.fields['应聘记录ID']), positionId: text(row.fields['职位ID']), templateId: text(row.fields['题单ID']), templateName: text(template?.fields['题单名称']), status: text(row.fields['邀请状态']), expiresAt: text(row.fields['过期时间']), startedAt: text(row.fields['开始答题时间']), submittedAt: text(row.fields['提交时间']), completion: num(row.fields['完成度']), durationSeconds: num(row.fields['答题耗时秒']), anomalies: json<any[]>(row.fields['异常JSON'], []), aiScore: num(row.fields['AI建议分']), aiScoreStatus: text(row.fields['AI评分状态']), finalScore: num(row.fields['人工最终分']), conclusion: text(row.fields['人工结论']), createdAt: text(row.fields['创建时间']), updatedAt: text(row.fields['更新时间']) } }

  private fallbackDrafts(position: string, count: number): QuestionInput[] {
    const seeds: QuestionInput[] = [
      { category: '岗位能力', type: 'text', title: `请介绍一段与${position}最相关的经历，并说明你的具体职责、目标和结果。`, score: 25, required: true },
      { category: '问题解决', type: 'text', title: '请描述一次目标未达预期的项目，你如何定位原因并采取后续行动？', score: 25, required: true },
      { category: '沟通协作', type: 'single', title: '当业务需求临时变化且资源不足时，你通常优先采取哪项行动？', options: ['先确认目标和优先级并同步风险', '立即全部接受', '等待上级安排', '只完成原计划'], referenceAnswer: '先确认目标和优先级并同步风险', score: 15, required: true },
      { category: '信息收集', type: 'multiple', title: '你目前选择新机会时最关注哪些因素？', options: ['岗位职责', '成长空间', '团队氛围', '薪酬福利', '工作地点'], score: 10, required: true },
      { category: '信息收集', type: 'file', title: '如岗位需要，请上传一份可公开查看的代表作品或案例材料。', description: '请勿上传包含原公司机密或他人隐私的材料。', score: 25, required: false },
    ]
    return Array.from({ length: count }, (_, index) => ({ ...(seeds[index % seeds.length]), position, source: 'AI降级草稿', status: '草稿' }))
  }

  private fallbackScore(items: any[]) {
    const questions: Record<string, { score: number; reason: string }> = {}
    let earned = 0; let total = 0
    for (const item of items) {
      const max = num(item.question.score); total += max
      const value = item.answer.value
      let score = 0; let reason = '答案已提交，需人工结合岗位要求复核。'
      if (item.question.type === 'single' && text(value) === text(item.question.referenceAnswer)) { score = max; reason = '选项与参考答案一致。' }
      else if (item.question.type === 'multiple') { score = Math.round(max * (Array.isArray(value) && value.length ? 0.7 : 0)); reason = '按完成度生成基础建议分。' }
      else if (item.question.type === 'file') { score = item.answer.fileUrl ? Math.round(max * 0.6) : 0; reason = item.answer.fileUrl ? '已提交附件，内容需人工评审。' : '未提交附件。' }
      else { const length = text(value).length; score = Math.round(max * (length >= 120 ? 0.8 : length >= 40 ? 0.6 : length ? 0.3 : 0)); reason = '根据回答完整度生成基础建议分，事实质量需人工核验。' }
      earned += score; questions[item.question.id] = { score, reason }
    }
    return { score: total ? Math.round(earned / total * 100) : 0, summary: 'AI服务不可用时生成的规则评分草稿，仅供人工复核。', questions }
  }

  private async audit(action: string, objectType: string, objectId: string, before: unknown, after: unknown, operator: string, reason = '') {
    await teable.createRecord(this.table('recruitment_audit_logs'), {
      日志ID: id('audit'), 操作人: operator, 操作类型: action, 对象类型: objectType, 对象ID: objectId,
      修改前摘要JSON: JSON.stringify(before), 修改后摘要JSON: JSON.stringify(after), 操作原因: reason,
      请求ID: id('req'), 发生时间: now(), 操作结果: '成功', 错误信息: '',
    })
  }
}
