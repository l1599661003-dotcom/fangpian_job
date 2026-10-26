import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { teable, TeableRecord } from '../../platform/teable'
import { ReadCache } from '../../platform/read-cache'
import { DatabaseService } from '../database/database.service'

const text = (value: unknown) => String(value ?? '').trim()
const metadata = (row: TeableRecord) => { try { return JSON.parse(text(row.fields['评分规则JSON']) || '{}') } catch { return {} } }
const owners = (row: TeableRecord): string[] => { const value = text(row.fields['适用面试官用户ID']); try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(text) : [value] } catch { return value ? [value] : [] } }
type Position = { id: string; name: string; department?: string }
export interface BankQuestionInput { title: string; category?: string; referenceAnswer?: string; description?: string }

@Injectable()
export class QuestionBankService {
  private readCache = new ReadCache()
  private imports = new Map<string, Promise<any>>()
  constructor(private readonly database: DatabaseService) {}
  private table() { return this.database.requireTableId('recruitment_question_bank') }

  async list(positions: Position[], userId: string, query: { positionId?: string; scope?: string; status?: string }) {
    const selected = query.positionId ? positions.filter(item => item.id === query.positionId) : positions
    if (query.positionId && !selected.length) throw new ForbiddenException('没有该岗位的题库权限')
    const [rows, feedbackJobs] = await Promise.all([
      this.readCache.get('questions', 30_000, [this.table()], () => teable.listAllRecords(this.table())),
      this.readCache.get(`feedback:${JSON.stringify(selected.map(position => position.id).sort())}`, 15_000,
        ['recruitment_onboarding_cases', 'recruitment_probation_reviews', 'recruitment_offboarding_cases'].map(name => this.database.requireTableId(name)), () => this.feedbackJobs(selected)),
    ])
    const questions = rows.filter(row => {
      const ownerIds = owners(row), positionId = text(metadata(row).positionId)
      return (query.scope === 'personal' ? ownerIds.includes(userId) : !ownerIds.length)
        && selected.some(position => positionId ? position.id === positionId : position.name === text(row.fields['适用岗位']))
        && (!query.status || text(row.fields['题目状态']) === query.status)
    }).map(row => ({ id: text(row.fields['题目ID']) || row.id, title: text(row.fields['题干']), category: text(row.fields['题目分类']), description: text(row.fields['题目说明']), referenceAnswer: text(row.fields['参考答案']), source: text(row.fields['题目来源']), status: text(row.fields['题目状态']), position: text(row.fields['适用岗位']), positionId: text(metadata(row).positionId), scope: owners(row).length ? 'personal' : 'position', updatedAt: text(row.fields['更新时间']) }))
    return { questions: questions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), positions, feedbackJobs }
  }

  private async feedbackJobs(positions: Position[]) {
    if (!positions.length) return []
    const onboardings = await teable.listAllByAnyField(this.database.requireTableId('recruitment_onboarding_cases'), '职位ID', positions.map(position => position.id), ['入职单ID', '职位ID'])
    const allowed = new Set(onboardings.filter(row => positions.some(position => position.id === text(row.fields['职位ID']))).map(row => text(row.fields['入职单ID'])))
    const [reviews, offboardings] = await Promise.all([
      teable.listAllByAnyField(this.database.requireTableId('recruitment_probation_reviews'), '入职单ID', [...allowed], ['入职单ID', '试用期记录ID', '扩展信息JSON']),
      teable.listAllByAnyField(this.database.requireTableId('recruitment_offboarding_cases'), '入职单ID', [...allowed], ['入职单ID', '离职单ID', '题库反哺状态', '题库反哺错误']),
    ])
    const result: { id: string; type: string; label: string; status: string; error: string }[] = []
    for (const row of reviews.filter(row => allowed.has(text(row.fields['入职单ID'])))) {
      let state: any = {}
      try { state = JSON.parse(text(row.fields['扩展信息JSON']) || '{}').questionBank || {} } catch {}
      if (state.status && state.status !== '已完成') result.push({ id: text(row.fields['试用期记录ID']), type: 'reviews', label: '入职评价题库完善', status: state.status, error: text(state.error) })
    }
    for (const row of offboardings.filter(row => allowed.has(text(row.fields['入职单ID'])))) {
      const status = text(row.fields['题库反哺状态'])
      if (status && status !== '已完成') result.push({ id: text(row.fields['离职单ID']), type: 'offboarding', label: '离职复盘题库完善', status, error: text(row.fields['题库反哺错误']) })
    }
    return result
  }

  import(position: Position, userId: string, userName: string, input: { scope?: string; questions: BankQuestionInput[] }) {
    if (!userId) throw new ForbiddenException('缺少可信员工身份')
    if (input.scope && !['personal', 'position'].includes(input.scope)) throw new BadRequestException('题库类型无效')
    if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 200) throw new BadRequestException('每次导入 1–200 道题目')
    const normalized = input.questions.map((item, index) => {
      const question = { title: text(item?.title), category: text(item?.category) || '岗位基础', referenceAnswer: text(item?.referenceAnswer), description: text(item?.description) }
      if (!question.title || question.title.length > 2000 || question.referenceAnswer.length > 5000 || question.description.length > 3000 || question.category.length > 80) throw new BadRequestException(`第 ${index + 1} 行题目为空或超过长度限制`)
      return question
    })
    const key = `${position.id}:${input.scope === 'personal' ? userId : 'position'}`
    const previous = this.imports.get(key) || Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      const rows = await teable.listAllRecords(this.table())
      const owner = input.scope === 'personal' ? userId : ''
      const normalize = (value: unknown) => text(value).normalize('NFKC').replace(/\s+/g, ' ')
      const existing = new Set(rows.filter(row => {
        const ids = owners(row), positionId = text(metadata(row).positionId)
        return (positionId ? positionId === position.id : text(row.fields['适用岗位']) === position.name) && (owner ? ids.includes(owner) : !ids.length)
      }).map(row => normalize(row.fields['题干'])))
      let created = 0, skipped = 0
      const errors: { row: number; message: string }[] = []
      for (const [index, question] of normalized.entries()) {
        if (existing.has(normalize(question.title))) { skipped++; continue }
        const timestamp = new Date().toISOString()
        try {
          await teable.createRecord(this.table(), { 题目ID: `bank_${createHash('sha256').update(`${key}:${normalize(question.title)}`).digest('hex').slice(0, 24)}`, 题目分类: question.category, 题目类型: 'text', 题干: question.title, 题目说明: question.description, 参考答案: question.referenceAnswer, 评分规则JSON: JSON.stringify({ positionId: position.id, department: position.department || '' }), 满分: 10, 是否必答: '否', 题目来源: '基础题库导入', 题目状态: '已发布', 适用岗位: position.name, 适用面试官用户ID: owner, 创建人用户ID: userId, 创建人: userName, 创建时间: timestamp, 更新时间: timestamp })
          existing.add(normalize(question.title)); created++
        } catch (error) { errors.push({ row: index + 1, message: error instanceof Error ? error.message : String(error) }) }
      }
      return { created, skipped, failed: errors.length, errors }
    })
    this.imports.set(key, pending)
    return pending.finally(() => { if (this.imports.get(key) === pending) this.imports.delete(key) })
  }

  async update(questionId: string, positions: Position[], userId: string, input: { status?: string; title?: string; referenceAnswer?: string }) {
    const rows = await teable.listByField(this.table(), '题目ID', questionId, 2)
    const row = rows[0]
    if (!row) throw new NotFoundException('题目不存在')
    const ownerIds = owners(row), positionId = text(metadata(row).positionId)
    if (ownerIds.length && !ownerIds.includes(userId)) throw new ForbiddenException('只能维护自己的个人题库')
    if (!positions.some(position => positionId ? position.id === positionId : position.name === text(row.fields['适用岗位']))) throw new ForbiddenException('没有该岗位的题库权限')
    const fields: Record<string, unknown> = { 更新时间: new Date().toISOString() }
    if (input.status !== undefined) {
      if (!['草稿', '已发布', '已停用'].includes(input.status)) throw new BadRequestException('题目状态无效')
      fields['题目状态'] = input.status
    }
    if (input.title !== undefined) {
      if (!text(input.title) || text(input.title).length > 2000) throw new BadRequestException('请填写有效题目，最多2000字')
      fields['题干'] = text(input.title)
    }
    if (input.referenceAnswer !== undefined) {
      if (text(input.referenceAnswer).length > 5000) throw new BadRequestException('观察要点最多5000字')
      fields['参考答案'] = text(input.referenceAnswer)
    }
    await teable.updateRecord(this.table(), row.id, fields)
    return { questionId, status: fields['题目状态'] || text(row.fields['题目状态']) }
  }
}
