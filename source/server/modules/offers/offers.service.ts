import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PDFDict, PDFImage, PDFName, PDFNumber, PDFRawStream, PDFDocument, JpegEmbedder, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { storage } from '../../platform/storage'
import { teable, TeableRecord } from '../../platform/teable'
import { ReadCache } from '../../platform/read-cache'
import { tianjiWeixinMessage } from '../../platform/tianji-weixin-message'
import { appFlowUrl } from '../../platform/app-links'
import { CandidateEmailDetail, candidateEmailCard } from '../../platform/candidate-email'
import { DatabaseService } from '../database/database.service'
import { MessagesService } from '../messages/messages.service'
import { InternshipPayUnit, OfferApprovalInput, OfferInput, OfferNegotiationInput, OfferTemplateCreateInput, OfferTemplateFieldInput, OfferTemplateType, OfferTemplateUpdateInput } from './offer.types'

const execFileAsync = promisify(execFile)
const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
const text = (value: unknown) => String(value ?? '').trim()
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const offerNote = (value: unknown) => text(value)
const offerNoteAmount = (value: unknown) => {
  const note = offerNote(value).replace(/,/g, '')
  return /^-?\d+(?:\.\d+)?$/.test(note) ? num(note) : 0
}
const offerNoteText = (value: unknown) => {
  const note = offerNote(value)
  return /^-?\d+(?:\.\d+)?$/.test(note.replace(/,/g, '')) ? `${note}元` : note
}
const internshipPayUnitOf = (input: OfferInput): InternshipPayUnit => input.internshipPayUnit === 'month' ? 'month' : 'day'
type StoredSalary = { 日薪?: number; 月薪?: number; 底薪?: number; 绩效?: number | string; 其他?: number | string; 提成?: number | string }
const internshipPayFromSalary = (salary: StoredSalary) => {
  if (salary['月薪'] !== undefined) return { unit: 'month' as const, amount: num(salary['月薪']) }
  return { unit: 'day' as const, amount: num(salary['日薪']) }
}
const json = <T>(value: unknown, fallback: T): T => {
  try { return value ? JSON.parse(String(value)) as T : fallback } catch { return fallback }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const offerCommissionValue = (salary: { 其他?: number | string; 提成?: number | string }) => salary['其他'] ?? salary['提成']
const OFFER_TEMPLATE_FIELDS: Record<OfferTemplateType, OfferTemplateFieldInput[]> = {
  实习: [
    { key: 'location', label: '工作地点', inputType: 'text', enabled: true, placeholder: '例如：山东省烟台市' },
    { key: 'startDate', label: '入职日期', inputType: 'date', required: true, enabled: true, locked: true },
    { key: 'baseSalary', label: '实习薪资', inputType: 'number', required: true, enabled: true, locked: true },
    { key: 'probationMonths', label: '试用期（月数与薪资比例）', inputType: 'text', enabled: true, placeholder: '例如：3个月，试用期薪资80%' },
  ],
  社招: [
    { key: 'location', label: '工作地点', inputType: 'text', enabled: true, placeholder: '例如：山东省烟台市' },
    { key: 'startDate', label: '入职日期', inputType: 'date', required: true, enabled: true, locked: true },
    { key: 'baseSalary', label: '底薪（元/月）', inputType: 'number', required: true, enabled: true, locked: true },
    { key: 'performanceSalary', label: '绩效月薪（元）', inputType: 'text', enabled: true },
    { key: 'commission', label: '其他（元）', inputType: 'text', enabled: true },
    { key: 'probationMonths', label: '试用期（月数与薪资比例）', inputType: 'text', enabled: true, placeholder: '例如：3个月，试用期薪资80%' },
  ],
}

const normalizeTemplateType = (value: unknown): OfferTemplateType => text(value) === '实习' ? '实习' : '社招'
const templateFields = (type: OfferTemplateType, value?: OfferTemplateFieldInput[]) => {
  const catalog = OFFER_TEMPLATE_FIELDS[type]
  const source = Array.isArray(value) && value.length ? value : catalog
  const used = new Set<string>()
  const normalized = source.flatMap((item) => {
    const definition = catalog.find((field) => field.key === text(item?.key))
    if (!definition || used.has(definition.key)) return []
    used.add(definition.key)
    return [{
      ...definition,
      inputType: definition.inputType,
      label: text(item.label) || definition.label,
      required: definition.locked ? true : Boolean(item.required),
      enabled: definition.locked ? true : item.enabled !== false,
    }]
  })
  for (const definition of catalog.filter((field) => field.locked && !used.has(field.key))) normalized.push({ ...definition, required: true, enabled: true })
  const commissionDefinition = catalog.find((field) => field.key === 'commission')
  if (commissionDefinition
    && type === '社招'
    && source.some((item) => ['allowance', 'probationSalaryRate', 'backgroundRequired', 'retentionInfo'].includes(text(item?.key)))
    && !used.has('commission')) {
    normalized.push({ ...commissionDefinition, required: false, enabled: true })
  }
  return normalized
}
const parseTemplateContent = (value: unknown, type: OfferTemplateType) => {
  const raw = text(value)
  try {
    const parsed = raw ? JSON.parse(raw) as { schemaVersion?:number; description?:string; fields?:OfferTemplateFieldInput[] } : undefined
    if (parsed?.schemaVersion === 1) return { description: text(parsed.description), fields: templateFields(type, parsed.fields) }
  } catch {}
  return { description: raw, fields: templateFields(type) }
}
const serializeTemplateContent = (description: string, fields: OfferTemplateFieldInput[]) => JSON.stringify({ schemaVersion: 1, description, fields })

const honorificFromGender = (gender: string) => gender === '男' ? '先生' : gender === '女' ? '女士' : '女士/先生'

interface OfferFileValues {
  candidateName: string
  candidateHonorific: string
  offerNumber: string
  role: string
  department: string
  location: string
  contractType: string
  startDate: string
  monthlySalary: string
  totalSalary: string
  dailySalary: string
  internshipPayUnit: 'day' | 'month'
  performanceSalary: string
  commissionSalary: string
  performanceIncluded: boolean
  commissionIncluded: boolean
  probationMonths: string
  deadlineDate: string
  validFrom: string
  validTo: string
  reportingTo: string
}

const isDateOnly = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const blankLines = (count: number) => Array.from({ length: count }, () => '<text:p text:style-name="P_Gap"/>').join('')

const listItem = (value: string) => `<text:list text:style-name="L1"><text:list-item><text:p text:style-name="P_List">${escapeXml(value)}</text:p></text:list-item></text:list>`

const fieldLine = (label: string, value = '') => `<text:p text:style-name="P_Field">${escapeXml(label)}${value ? ` ${escapeXml(value)}` : ''}</text:p>`

const underline = (value = '') => `<text:span text:style-name="T_Underline">${value ? escapeXml(value) : '        '}</text:span>`

const offerEmailHtml = (candidateName: string, responseUrl: string, note: string, details: CandidateEmailDetail[]) => candidateEmailCard({
  candidateName,
  title: '录用通知书',
  brandSub: 'FANGPIAN · OFFER',
  intro: ['我们很高兴通知你通过面试。请在专属页面查看完整录用通知书，并在有效期内确认答复。'],
  details,
  note,
  noteTitle: '备注',
  primaryLink: { label: '查看并确认Offer', href: responseUrl },
  footer: '期待与你一起开始下一段旅程。\n方片新媒体招聘团队',
})

const offerDocument = (values: OfferFileValues, templateType: OfferTemplateType) => {
  const internship = templateType === '实习'
  const salaryParts = [`底薪${underline(values.monthlySalary)}元`]
  if (values.performanceIncluded) salaryParts.push(underline(values.performanceSalary))
  if (values.commissionIncluded) salaryParts.push(underline(values.commissionSalary))
  const socialSalaryText = `${salaryParts.join('+')}${text(values.probationMonths) ? `，${underline(values.probationMonths)}` : ''}。`
  const internshipUnit = values.internshipPayUnit === 'month' ? '月' : '天'
  const salaryText = internship
    ? `薪酬${underline(values.internshipPayUnit === 'month' ? values.monthlySalary : values.dailySalary)}元/${internshipUnit}，入职后缴纳意外险。`
    : socialSalaryText
  const materialItems = internship
    ? ['学生证原件及复印件1份', '身份证原件及复印件1份（正反面在一张上）', '招商银行卡复印件1份（用于薪酬发放）']
    : ['身份证原件及复印件1份（正反面在一张上）', '上一家工作单位解除劳动合同证明原件', '最高学历毕业证书、学位证书原件及复印件各1份', '招商银行卡复印件1份（用于薪酬发放）']
  const contractType = internship ? '实习合同' : `${underline('3')}年`, contractTypeText = internship ? '实习合同' : '3年'
  const effectiveText = internship
    ? `本通知书有效期为${underline(values.validFrom)}至${underline(values.validTo)}。`
    : `本通知书有效期为${underline(values.validFrom)}至${underline(values.validTo)}。`

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
  <office:automatic-styles>
    <style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="21.0cm" fo:page-height="29.7cm" fo:margin-top="4.3cm" fo:margin-bottom="3.7cm" fo:margin-left="3.17cm" fo:margin-right="2.83cm"/></style:page-layout>
    <style:style style:name="dp1" style:family="drawing-page"/>
    <style:style style:name="T_Underline" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>
    <style:style style:name="P_Title" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="20pt" fo:font-weight="bold"/></style:style>
    <style:style style:name="P_Label" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="11pt" fo:font-weight="bold"/></style:style>
    <style:style style:name="P_Section" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0.3cm" fo:padding-top="0.2cm" fo:border-top="0.75pt solid #d0d0d0"/><style:text-properties fo:font-size="11pt" fo:font-weight="bold"/></style:style>
    <style:style style:name="P_Field" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0.14cm" fo:margin-bottom="0.14cm"/><style:text-properties fo:font-size="10.5pt"/></style:style>
    <style:style style:name="P_Indent" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="1.0cm"/><style:text-properties fo:font-size="10.5pt"/></style:style>
    <style:style style:name="P_List" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="1.1cm" fo:margin-top="0.32cm" fo:margin-bottom="0.32cm"/><style:text-properties fo:font-size="10.5pt"/></style:style>
    <style:style style:name="P_Gap" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0.16cm" fo:margin-bottom="0.16cm"/><style:text-properties fo:font-size="10.5pt"/></style:style>
    <text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0.18cm" text:min-label-width="0.34cm"/></text:list-level-style-bullet></text:list-style>
  </office:automatic-styles>
  <office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PM1" style:drawing-page-style-name="dp1"/></office:master-styles>
  <office:body><office:text>
    <text:p text:style-name="P_Title">录用通知书</text:p>
    ${blankLines(1)}
    <text:p text:style-name="P_Label">录用信息</text:p>
    <text:p text:style-name="P_Field">致： ${escapeXml(values.candidateName)} ${escapeXml(values.candidateHonorific)}</text:p>
    ${fieldLine('录用单位：', '方片新媒体')}
    <text:p text:style-name="P_Field">根据面试评估结果，本公司决定录用您担任以下职位：</text:p>
    ${fieldLine('入职岗位：', values.role)}
    ${fieldLine('汇报上级：', values.reportingTo)}
    ${fieldLine('工作地点：', values.location || '山东省烟台市')}
    ${internship ? fieldLine('合同类型：', contractType) : fieldLine('合同期限：', '3年')}
    ${fieldLine('入职日期：', values.startDate)}
    ${blankLines(1)}
    <text:p text:style-name="P_Section">一、薪酬待遇</text:p>
    <text:p text:style-name="P_Label">薪酬待遇及试用期：</text:p>
    <text:p text:style-name="P_Indent">${salaryText}</text:p>
    ${blankLines(1)}
    <text:p text:style-name="P_Section">二、入职必备流程</text:p>
    <text:p text:style-name="P_Label">资料提交清单（入职当日完成）</text:p>
    ${materialItems.map(listItem).join('')}
    ${blankLines(1)}
    <text:p text:style-name="P_Label">三、确认与生效</text:p>
    <text:p text:style-name="P_Label">本人声明：</text:p>
    <text:p text:style-name="P_Field">已完全知悉本通知书全部条款，自愿接受录用并承诺：</text:p>
    <text:p text:style-name="P_Field">1. 于 ${escapeXml(values.deadlineDate)} 18:00 前签署本文件并扫描件发送至 HR 邮箱：fangpianhr@fangpian999.com</text:p>
    <text:p text:style-name="P_Field">2. 如逾期未确认，视为自动放弃录用资格</text:p>
    ${blankLines(1)}
    <text:p text:style-name="P_Label">备注：</text:p>
    <text:p text:style-name="P_Field">若录用者之前在我司应聘过程中提供的信息与录用者报到后提供的信息不符，存在有违诚实守信、遵纪守法等问题，我司有权不予录用。</text:p>
    <text:p text:style-name="P_Field">${effectiveText}</text:p>
    <text:p text:style-name="P_Field">若录用者延长报到时间，需事先电话或书面通知我司同意后方可延长，否则本通知书自动失效。</text:p>
    ${blankLines(3)}
    <text:p text:style-name="P_Label">签署栏：</text:p>
    <text:p text:style-name="P_Field">公司：${underline()} 候选人：${underline()}</text:p>
    <text:p text:style-name="P_Field">签字：${underline()} 日期：${underline()}</text:p>
  </office:text></office:body>
</office:document>`
}

@Injectable()
export class OffersService {
  private listCache = new ReadCache()
  private templateEnsurePromise?: Promise<void>

  constructor(private readonly database: DatabaseService, private readonly messages: MessagesService) {}

  private table(name: string) {
    return this.database.requireTableId(name)
  }

  async list(query: { status?: string; candidateId?: string }) {
    return this.listCache.get(JSON.stringify([query.status || '', query.candidateId || '']), 30_000,
      ['recruitment_offers', 'recruitment_candidates'].map(name => this.table(name)), () => this.loadList(query))
  }

  private async loadList(query: { status?: string; candidateId?: string }) {
    const offers = (await teable.listAllRecords(this.table('recruitment_offers')))
      .filter(row => (!query.status || text(row.fields['Offer状态']) === query.status) && (!query.candidateId || text(row.fields['候选人ID']) === query.candidateId))
    const candidates = await teable.listAllByAnyField(this.table('recruitment_candidates'), '候选人ID', offers.map(row => row.fields['候选人ID']), ['候选人ID', '姓名', '邮箱'])
    const rows = offers
      .filter((row) => !query.status || text(row.fields['Offer状态']) === query.status)
      .filter((row) => !query.candidateId || text(row.fields['候选人ID']) === query.candidateId)
      .map((row) => this.mapOffer(row, candidates.find((candidate) => text(candidate.fields['候选人ID']) === text(row.fields['候选人ID']))))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { total: rows.length, offers: rows }
  }

  async templates() {
    await this.ensureTemplates()
    const rows = await teable.listAllRecords(this.table('recruitment_offer_templates'))
    return {
      templates: rows
        .filter((row) => text(row.fields['模板状态']) !== '停用')
        .map((row) => this.mapTemplate(row))
        .sort((a, b) => a.type.localeCompare(b.type) || b.updatedAt.localeCompare(a.updatedAt)),
    }
  }

  async createTemplate(input: OfferTemplateCreateInput) {
    await this.ensureTemplates()
    const name = text(input.name)
    const type = normalizeTemplateType(input.type)
    if (!name) throw new BadRequestException('模板名称不能为空')
    if (!['实习', '社招'].includes(text(input.type))) throw new BadRequestException('适用类型必须为实习或社招')
    const description = text(input.description ?? input.content)
    const fields = templateFields(type, input.fields)
    const timestamp = now(), templateId = id('offertpl')
    const created = await teable.createRecord(this.table('recruitment_offer_templates'), {
      Offer模板ID: templateId,
      模板名称: name,
      适用类型: type,
      模板内容: serializeTemplateContent(description, fields),
      变量JSON: JSON.stringify(fields.filter((field) => field.enabled !== false).map((field) => field.label)),
      原始模板地址: '',
      模板状态: input.status === '停用' ? '停用' : '启用',
      版本: 1,
      创建人: text(input.operator) || '当前用户',
      创建时间: timestamp,
      更新时间: timestamp,
    })
    await this.audit('新建Offer模板', 'Offer模板', templateId, {}, created.fields, text(input.operator) || '当前用户')
    return this.mapTemplate(created)
  }

  async updateTemplate(templateId: string, input: OfferTemplateUpdateInput) {
    await this.ensureTemplates()
    const rows = await teable.listAllRecords(this.table('recruitment_offer_templates'))
    const row = rows.find((item) => text(item.fields['Offer模板ID']) === templateId || item.id === templateId)
    if (!row) throw new NotFoundException('Offer模板不存在')
    const name = text(input.name) || text(row.fields['模板名称'])
    if (!name) throw new BadRequestException('模板名称不能为空')
    const type = normalizeTemplateType(row.fields['适用类型'])
    const current = parseTemplateContent(row.fields['模板内容'], type)
    const description = typeof input.description === 'string'
      ? text(input.description)
      : typeof input.content === 'string' ? text(input.content) : current.description
    const fields = Array.isArray(input.fields) ? templateFields(type, input.fields) : current.fields
    const variables = Array.isArray(input.variables)
      ? input.variables.map(text).filter(Boolean)
      : fields.filter((field) => field.enabled !== false).map((field) => field.label)
    const updated = await teable.updateRecord(this.table('recruitment_offer_templates'), row.id, {
      模板名称: name,
      模板内容: serializeTemplateContent(description, fields),
      变量JSON: JSON.stringify(variables),
      模板状态: input.status === '停用' ? '停用' : text(row.fields['模板状态']) || '启用',
      版本: num(row.fields['版本']) + 1,
      更新时间: now(),
    })
    await this.audit('修改Offer模板', 'Offer模板', text(row.fields['Offer模板ID']) || row.id, row.fields, updated.fields, text(input.operator) || '当前用户')
    return this.mapTemplate(updated)
  }

  async interviewOfferContext(input: { interviewId: string; candidateId?: string; applicationId?: string; positionId?: string }) {
    const interviewId = text(input.interviewId)
    if (!interviewId) throw new BadRequestException('面试ID不能为空')
    const interviewTable = this.table('recruitment_interviews')
    const interview = await teable.findOneByField(interviewTable, '面试ID', interviewId)
      || await teable.getRecord(interviewTable, interviewId).catch(() => undefined)
    if (!interview) throw new NotFoundException('未找到关联面试，无法填写 Offer')

    const linkedCandidateId = text(interview.fields['候选人ID'])
    const linkedApplicationId = text(interview.fields['应聘记录ID'])
    const applicationTable = this.table('recruitment_applications')
    const linkedApplication = linkedApplicationId
      ? await teable.findOneByField(applicationTable, '应聘记录ID', linkedApplicationId)
        || await teable.getRecord(applicationTable, linkedApplicationId).catch(() => undefined)
      : undefined
    const linkedPositionId = text(interview.fields['职位ID'])
      || text(linkedApplication?.fields['职位ID'])
      || text(input.positionId)
    if (input.candidateId && input.candidateId !== linkedCandidateId) throw new BadRequestException('候选人与本次面试不一致，请重新打开 HR 待办')
    if (input.applicationId && input.applicationId !== linkedApplicationId) throw new BadRequestException('应聘记录与本次面试不一致，请重新打开 HR 待办')
    if (input.positionId && input.positionId !== linkedPositionId) throw new BadRequestException('岗位与本次面试不一致，请重新打开 HR 待办')
    if (!linkedCandidateId || !linkedPositionId) throw new BadRequestException('本次面试未关联完整候选人和岗位，无法填写 Offer')

    const candidateTable = this.table('recruitment_candidates')
    const candidate = await teable.findOneByField(candidateTable, '候选人ID', linkedCandidateId)
      || await teable.getRecord(candidateTable, linkedCandidateId).catch(() => undefined)
    if (!candidate) throw new NotFoundException('未找到本次面试关联的候选人')
    const canonicalCandidateId = text(candidate.fields['候选人ID']) || candidate.id

    const positionTable = this.table('recruitment_positions')
    const position = await teable.findOneByField(positionTable, '职位ID', linkedPositionId)
      || await teable.getRecord(positionTable, linkedPositionId).catch(() => undefined)
    if (!position) throw new NotFoundException('未找到本次面试关联的岗位')
    const canonicalPositionId = text(position.fields['职位ID']) || position.id
    const candidateIds = [...new Set([linkedCandidateId, canonicalCandidateId, candidate.id])]
    const positionIds = [...new Set([linkedPositionId, canonicalPositionId, position.id])]
    let application: TeableRecord | undefined
    if (linkedApplicationId) {
      application = await teable.findOneByField(applicationTable, '应聘记录ID', linkedApplicationId)
        || await teable.getRecord(applicationTable, linkedApplicationId).catch(() => undefined)
    } else {
      const rows = (await Promise.all(candidateIds.map(candidateId => teable.listByField(applicationTable, '候选人ID', candidateId, 200)))).flat()
      application = [...new Map(rows.map(row => [row.id, row])).values()]
        .filter(row => candidateIds.includes(text(row.fields['候选人ID'])) && positionIds.includes(text(row.fields['职位ID'])))
        .sort((first, second) => text(second.fields['更新时间']).localeCompare(text(first.fields['更新时间'])))[0]
    }
    if (!application) throw new NotFoundException('本次面试未关联有效应聘记录，请联系招聘负责人核实')
    const applicationCandidateId = text(application.fields['候选人ID'])
    const applicationPositionId = text(application.fields['职位ID'])
    if (!candidateIds.includes(applicationCandidateId) || !positionIds.includes(applicationPositionId)) {
      throw new BadRequestException('面试、候选人与应聘岗位关联不一致，请联系招聘负责人核实')
    }
    const applicationId = text(application.fields['应聘记录ID']) || application.id

    return {
      interviewId: text(interview.fields['面试ID']) || interview.id,
      candidate: {
        id: canonicalCandidateId,
        name: text(candidate.fields['姓名']) || '未识别姓名',
        gender: text(candidate.fields['性别']),
        phone: text(candidate.fields['电话']),
        email: text(candidate.fields['邮箱']),
        bestMatchRole: text(candidate.fields['期望职位']),
        jobIntention: text(candidate.fields['期望职位']),
      },
      applicationId,
      position: {
        id: canonicalPositionId,
        name: text(position.fields['职位名称']) || text(application.fields['职位名称']) || '未命名岗位',
        department: text(position.fields['部门']),
        location: text(position.fields['工作地点']),
      },
    }
  }

  async create(input: OfferInput) {
    if (!text(input.candidateId) || !text(input.role) || !text(input.startDate)) throw new BadRequestException('候选人、岗位和入职日期不能为空')
    const templateType = await this.resolveTemplateType(input.templateId)
    if (templateType === '实习' && num(input.baseSalary) <= 0) throw new BadRequestException('实习薪资不能为空')
    if (templateType === '社招' && num(input.baseSalary) <= 0) throw new BadRequestException('社招底薪不能为空')
    const startDate = text(input.startDate)
    const parsedStartDate = new Date(`${startDate}T00:00:00.000Z`)
    if (Number.isNaN(parsedStartDate.getTime()) || parsedStartDate.toISOString().slice(0, 10) !== startDate) throw new BadRequestException('入职日期格式无效')
    if (parsedStartDate.getTime() < Date.now() - 86_400_000) throw new BadRequestException('入职日期不能早于当前日期')
    const internshipMonthly = templateType === '实习' && internshipPayUnitOf(input) === 'month'
    const performanceIncluded = templateType === '社招' && input.performanceSalary !== undefined
    const commissionIncluded = templateType === '社招' && input.commission !== undefined
    const baseSalary = num(input.baseSalary)
    const performanceNote = performanceIncluded ? offerNote(input.performanceSalary) : ''
    const commissionNote = commissionIncluded ? offerNote(input.commission) : ''
    if (baseSalary < 0) throw new BadRequestException('薪资不能小于0')
    if (performanceIncluded && !performanceNote) throw new BadRequestException('已勾选绩效时请填写绩效说明')
    if (commissionIncluded && !commissionNote) throw new BadRequestException('已勾选其他时请填写其他说明')
    const probationMonths = text(input.probationMonths) || '试用期3个月，试用期薪资100%'
    const scheduleFields = this.offerScheduleInput(input)
    const honorific = this.offerHonorificInput(input)

    const [candidates, applications] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_applications')),
    ])
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === input.candidateId || row.id === input.candidateId)
    if (!candidate) throw new NotFoundException('候选人不存在')
    const canonicalCandidateId = text(candidate.fields['候选人ID']) || candidate.id
    const candidateApplicationRows = applications.filter((row) => [canonicalCandidateId, candidate.id, input.candidateId].includes(text(row.fields['候选人ID'])))
    const latestApplication = (rows: TeableRecord[]) => rows.sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    let application = input.applicationId
      ? candidateApplicationRows.find((row) => text(row.fields['应聘记录ID']) === input.applicationId)
      : input.positionId
        ? latestApplication(candidateApplicationRows.filter((row) => text(row.fields['职位ID']) === input.positionId && text(row.fields['当前状态']) !== '已结束'))
        : latestApplication(candidateApplicationRows)
    if (application
      && input.positionId
      && text(application.fields['候选人ID']) === canonicalCandidateId
      && !text(application.fields['职位ID'])
      && text(application.fields['当前状态']) !== '已结束') {
      await teable.updateRecord(this.table('recruitment_applications'), application.id, {
        职位ID: input.positionId, 更新时间: now(),
      })
      application = { ...application, fields: { ...application.fields, 职位ID: input.positionId } }
    }
    if (!input.applicationId && input.positionId && !application) {
      const activeBlankApplications = candidateApplicationRows.filter((row) => text(row.fields['当前状态']) !== '已结束' && !text(row.fields['职位ID']))
      if (activeBlankApplications.length === 1) {
        application = activeBlankApplications[0]
        await teable.updateRecord(this.table('recruitment_applications'), application.id, {
          职位ID: input.positionId, 更新时间: now(),
        })
        application = { ...application, fields: { ...application.fields, 职位ID: input.positionId } }
      } else if (activeBlankApplications.length > 1) {
        application = latestApplication(activeBlankApplications)
        await teable.updateRecord(this.table('recruitment_applications'), application.id, {
          职位ID: input.positionId, 更新时间: now(),
        })
        application = { ...application, fields: { ...application.fields, 职位ID: input.positionId } }
      } else {
        const timestamp = now()
        application = await teable.createRecord(this.table('recruitment_applications'), {
          应聘记录ID: id('app'), 候选人ID: canonicalCandidateId, 职位ID: input.positionId,
          当前阶段: '待Offer决策', 当前状态: '进行中', 来源类型: 'HR创建Offer',
          创建时间: timestamp, 更新时间: timestamp, 最近处理时间: timestamp,
        })
      }
    }
    if (input.applicationId && (!application || text(application.fields['应聘记录ID']) !== input.applicationId || text(application.fields['候选人ID']) !== canonicalCandidateId || (input.positionId && text(application.fields['职位ID']) !== input.positionId))) throw new BadRequestException('Offer的候选人、岗位与面试应聘记录不一致，请重新打开HR待办')
    if (!input.applicationId && input.positionId && !application) throw new BadRequestException('候选人未应聘所选岗位，无法创建Offer')
    if (application && text(application.fields['当前状态']) === '已结束') throw new BadRequestException('候选人该岗位应聘记录已结束，不能创建Offer')

    const offerId = id('offer'), timestamp = now(), number = `FP-${timestamp.slice(0, 10).replace(/-/g, '')}-${offerId.slice(-6).toUpperCase()}`
    const fields = {
      OfferID: offerId,
      候选人ID: canonicalCandidateId,
      应聘记录ID: text(application?.fields['应聘记录ID']),
      职位ID: text(input.positionId) || text(application?.fields['职位ID']),
      需求ID: text(input.demandId) || text(application?.fields['需求ID']),
      Offer编号: number,
      岗位名称: input.role,
      部门: text(input.department),
      工作地点: text(input.location),
      基本月薪: templateType === '社招' || internshipMonthly ? baseSalary : 0,
      绩效月薪: offerNoteAmount(performanceNote),
      补贴月额: 0,
      奖金月数: num(input.bonusMonths) || 0,
      薪资结构JSON: JSON.stringify(templateType === '实习'
        ? (internshipMonthly ? { 月薪: baseSalary } : { 日薪: baseSalary })
        : {
            底薪: baseSalary,
            ...(performanceIncluded ? { 绩效: performanceNote } : {}),
            ...(commissionIncluded ? { 其他: commissionNote } : {}),
          }),
      入职日期: startDate,
      汇报上级: scheduleFields.reportingTo,
      有效期开始: scheduleFields.validFrom,
      有效期结束: scheduleFields.validTo,
      称谓: honorific,
      试用期月数: probationMonths,
      试用期薪资比例: '100',
      保录信息: '',
      是否需要背调: '',
      Offer状态: '生成中',
      审批状态: '已通过',
      当前版本: 1,
      模板ID: text(input.templateId) || templateType,
      发送状态: '生成中',
      创建人用户ID: text(input.operatorUserId),
      创建人: text(input.operator) || '当前用户',
      创建时间: timestamp,
      更新时间: timestamp,
    }
    await teable.createRecord(this.table('recruitment_offers'), fields)
    await this.version(offerId, 1, fields, '创建Offer', '初始版本', fields.创建人)
    await this.audit('创建Offer', 'Offer', offerId, {}, fields, fields.创建人)
    try {
      const generated = await this.generateFile(offerId, { operator: fields.创建人 })
      return { ...generated, offerNumber: number, approvalStatus: '已通过', templateType }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        const row = await this.find(offerId)
        await teable.updateRecord(this.table('recruitment_offers'), row.id, { Offer状态: '生成失败', 发送状态: '生成失败', 更新时间: now() })
        await this.audit('生成Offer文件失败', 'Offer', offerId, row.fields, { error: message }, fields.创建人, '失败', message)
      } catch (recordingError) {
        console.error(`Offer生成失败状态记录失败: ${recordingError instanceof Error ? recordingError.message : String(recordingError)}`)
      }
      throw error
    }
  }

  async update(offerId: string, input: OfferInput) {
    if (!text(input.candidateId) || !text(input.role) || !text(input.startDate)) throw new BadRequestException('候选人、岗位和入职日期不能为空')
    const templateType = await this.resolveTemplateType(input.templateId)
    if (templateType === '实习' && num(input.baseSalary) <= 0) throw new BadRequestException('实习薪资不能为空')
    if (templateType === '社招' && num(input.baseSalary) <= 0) throw new BadRequestException('社招底薪不能为空')
    const startDate = text(input.startDate)
    const parsedStartDate = new Date(`${startDate}T00:00:00.000Z`)
    if (Number.isNaN(parsedStartDate.getTime()) || parsedStartDate.toISOString().slice(0, 10) !== startDate) throw new BadRequestException('入职日期格式无效')
    if (parsedStartDate.getTime() < Date.now() - 86_400_000) throw new BadRequestException('入职日期不能早于当前日期')

    const row = await this.find(offerId)
    this.assertOfferNotAnswered(row)
    if (!['已通过', '待重新审批'].includes(text(row.fields['审批状态']))) throw new ConflictException('Offer审批通过后才能修改')
    if (text(row.fields['发送状态']) === '已发送') throw new ConflictException('Offer邮件已发送，不能在发送前预览中修改')
    if (text(input.candidateId) !== text(row.fields['候选人ID'])) throw new BadRequestException('已创建的Offer不能更换候选人，请返回新建Offer')
    const positionApplication = text(input.positionId) && text(input.positionId) !== text(row.fields['职位ID'])
      ? await this.applicationForPosition(text(row.fields['候选人ID']), text(input.positionId))
      : undefined

    const internshipMonthly = templateType === '实习' && internshipPayUnitOf(input) === 'month'
    const performanceIncluded = templateType === '社招' && input.performanceSalary !== undefined
    const commissionIncluded = templateType === '社招' && input.commission !== undefined
    const baseSalary = num(input.baseSalary)
    const performanceNote = performanceIncluded ? offerNote(input.performanceSalary) : ''
    const commissionNote = commissionIncluded ? offerNote(input.commission) : ''
    if (baseSalary < 0) throw new BadRequestException('薪资不能小于0')
    if (performanceIncluded && !performanceNote) throw new BadRequestException('已勾选绩效时请填写绩效说明')
    if (commissionIncluded && !commissionNote) throw new BadRequestException('已勾选其他时请填写其他说明')
    const probationMonths = text(input.probationMonths) || '试用期3个月，试用期薪资100%'
    const scheduleFields = this.offerScheduleInput(input)
    const honorific = this.offerHonorificInput(input)
    const newVersion = (num(row.fields['当前版本']) || 1) + 1
    const timestamp = now()
    const fields = {
      ...(positionApplication ? { 职位ID: text(input.positionId), 应聘记录ID: text(positionApplication.fields['应聘记录ID']), 需求ID: text(positionApplication.fields['需求ID']) } : {}),
      岗位名称: input.role,
      部门: text(input.department),
      工作地点: text(input.location),
      基本月薪: templateType === '社招' || internshipMonthly ? baseSalary : 0,
      绩效月薪: offerNoteAmount(performanceNote),
      补贴月额: 0,
      奖金月数: num(input.bonusMonths) || 0,
      薪资结构JSON: JSON.stringify(templateType === '实习'
        ? (internshipMonthly ? { 月薪: baseSalary } : { 日薪: baseSalary })
        : {
            底薪: baseSalary,
            ...(performanceIncluded ? { 绩效: performanceNote } : {}),
            ...(commissionIncluded ? { 其他: commissionNote } : {}),
          }),
      入职日期: startDate,
      汇报上级: scheduleFields.reportingTo,
      有效期开始: scheduleFields.validFrom,
      有效期结束: scheduleFields.validTo,
      称谓: honorific || text(row.fields['称谓']),
      试用期月数: probationMonths,
      试用期薪资比例: '100',
      保录信息: '',
      是否需要背调: '',
      模板ID: text(input.templateId) || templateType,
      Offer状态: '待发送',
      审批状态: '已通过',
      当前版本: newVersion,
      发送状态: '待人工发送',
      更新时间: timestamp,
    }
    const previousFields = Object.fromEntries(Object.keys(fields).map((key) => [key, row.fields[key] ?? null]))
    await teable.updateRecord(this.table('recruitment_offers'), row.id, fields)
    const generated = await this.generateFile(offerId, { operator: text(input.operator) || '当前用户' }).catch(async (error) => {
      await teable.updateRecord(this.table('recruitment_offers'), row.id, previousFields)
      throw error
    })
    await this.version(offerId, newVersion, { ...row.fields, ...fields }, '发送前修改', 'HR在发送前预览中修改Offer内容', text(input.operator) || '当前用户')
    await this.audit('发送前修改Offer', 'Offer', offerId, row.fields, fields, text(input.operator) || '当前用户')
    return { ...generated, offerNumber: text(row.fields['Offer编号']), version: newVersion, templateType }
  }

  async submit(offerId: string, body: { operator?: string }) {
    const row = await this.find(offerId)
    if (!['草稿', '审批驳回'].includes(text(row.fields['Offer状态']))) throw new ConflictException('当前Offer不能提交审批')
    await teable.updateRecord(this.table('recruitment_offers'), row.id, { Offer状态: '审批中', 审批状态: '部门审批', 更新时间: now() })
    await this.approvalEvent(offerId, text(row.fields['审批状态']), '部门审批', 'submit', 'department', text(body.operator) || '当前用户', '', '提交Offer审批')
    return { offerId, status: '审批中', approvalStatus: '部门审批' }
  }

  async approve(offerId: string, input: OfferApprovalInput) {
    if (!text(input.opinion)) throw new BadRequestException('审批意见不能为空')
    const row = await this.find(offerId), current = text(row.fields['审批状态'])
    const expected = { department: '部门审批', hr: 'HR复核', executive: '高管终审' }[input.node]
    if (current !== expected) throw new ConflictException(`当前审批节点为${current}，不能执行${input.node}`)
    if (input.action === 'reject') {
      await teable.updateRecord(this.table('recruitment_offers'), row.id, { Offer状态: '审批驳回', 审批状态: '已驳回', 更新时间: now() })
      await this.approvalEvent(offerId, current, '已驳回', 'reject', input.node, text(input.operator) || '当前用户', text(input.operatorUserId), input.opinion)
      return { offerId, status: '审批驳回' }
    }
    const next = input.node === 'department' ? 'HR复核' : input.node === 'hr' ? '高管终审' : '已通过'
    const status = next === '已通过' ? '审批通过' : '审批中'
    await teable.updateRecord(this.table('recruitment_offers'), row.id, { Offer状态: status, 审批状态: next, 更新时间: now() })
    await this.approvalEvent(offerId, current, next, 'approve', input.node, text(input.operator) || '当前用户', text(input.operatorUserId), input.opinion)
    return { offerId, status, approvalStatus: next }
  }

  async generateFile(offerId: string, body: { operator?: string }) {
    const row = await this.find(offerId)
    this.assertOfferNotAnswered(row)
    if (text(row.fields['审批状态']) !== '已通过') throw new ConflictException('Offer审批通过后才能生成文件')
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const templateType = await this.resolveTemplateType(text(row.fields['模板ID']))
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    const values = this.fileValues(row, candidate, templateType)
    const pdfBytes = await this.renderPdf(values, templateType, text(row.fields['OfferID']) || row.id)
    const fileName = `${values.offerNumber}-${values.candidateName || '候选人'}-录用通知书.pdf`
    const uploaded = await storage.upload(`offers/${offerId}/${fileName}`, 'application/pdf', pdfBytes)
    await teable.updateRecord(this.table('recruitment_offers'), row.id, {
      Offer文件地址: uploaded.cdnUrl,
      Offer文件名: fileName,
      Offer状态: '待发送',
      发送状态: '待人工发送',
      更新时间: now(),
    })
    await this.audit('生成Offer文件', 'Offer', offerId, row.fields, { fileUrl: uploaded.cdnUrl, templateType }, text(body.operator) || '当前用户')
    return { offerId, fileName, fileUrl: uploaded.cdnUrl, status: '待发送', templateType, bytes: pdfBytes }
  }

  async createResponseLink(offerId: string, body: { channel?: string; recipient?: string; expiresHours?: number; operator?: string }) {
    const row = await this.find(offerId)
    this.assertOfferNotAnswered(row)
    if (!text(row.fields['Offer文件地址'])) throw new ConflictException('请先生成Offer文件')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + Math.max(1, Math.min(168, num(body.expiresHours) || 72)) * 3_600_000).toISOString()
    await teable.updateRecord(this.table('recruitment_offers'), row.id, {
      答复Token哈希: hash(token),
      Token前缀: token.slice(0, 8),
      答复过期时间: expiresAt,
      发送状态: '待人工发送',
      Offer状态: '待候选人答复',
      更新时间: now(),
    })
    await teable.createRecord(this.table('recruitment_offer_send_events'), {
      发送事件ID: id('send'),
      OfferID: offerId,
      发送渠道: text(body.channel) || '手动链接',
      接收地址: text(body.recipient),
      发送状态: '待人工发送',
      内容摘要JSON: JSON.stringify({ fileUrl: text(row.fields['Offer文件地址']), expiresAt }),
      操作人: text(body.operator) || '当前用户',
      发生时间: now(),
    })
    return { offerId, token, path: `?offer_token=${encodeURIComponent(token)}`, expiresAt, sendStatus: '待人工发送' }
  }

  async sendEmail(offerId: string, body: { recipient?: string; expiresHours?: number; note?: string; operator?: string; operatorUserId?: string }) {
    const row = await this.find(offerId)
    this.assertOfferNotAnswered(row)
    if (!text(row.fields['Offer文件地址'])) throw new ConflictException('请先生成Offer PDF')
    if (text(row.fields['审批状态']) !== '已通过') throw new ConflictException('Offer未审批通过，不能发送；如已调整信息，请先修改并重新生成PDF')
    const [candidates] = await Promise.all([teable.listAllRecords(this.table('recruitment_candidates'))])
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    const recipient = text(body.recipient) || text(candidate?.fields['邮箱'])
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(recipient)) throw new BadRequestException('请填写正确的候选人邮箱')
    const publicBase = text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')
    if (!publicBase) throw new BadRequestException('未配置应用公开地址，无法生成Offer答复链接')
    try {
      const expiresAt = new Date(Date.now() + Math.max(1, Math.min(168, num(body.expiresHours) || 72)) * 3_600_000).toISOString()
      const token = randomBytes(32).toString('base64url')
      const responseUrl = new URL(publicBase)
      responseUrl.searchParams.set('offer_token', token)
      const subject = `方片新媒体录用通知书｜${text(candidate?.fields['姓名']) || '候选人'}`
      const content = offerEmailHtml(
        text(candidate?.fields['姓名']) || '候选人',
        responseUrl.toString(),
        text(body.note),
        [
          { label: '应聘岗位', value: text(row.fields['岗位名称']) },
          { label: '所属部门', value: text(row.fields['部门']) },
          { label: '工作地点', value: text(row.fields['工作地点']) },
          { label: '计划入职', value: text(row.fields['入职日期']) },
          { label: 'Offer编号', value: text(row.fields['Offer编号']) },
        ],
      )
      const preparedAt = now()
      await teable.updateRecord(this.table('recruitment_offers'), row.id, {
        答复Token哈希: hash(token),
        Token前缀: token.slice(0, 8),
        答复过期时间: expiresAt,
        发送状态: '发送中',
        Offer状态: '待候选人答复',
        更新时间: preparedAt,
      })
      const mail = await tianjiWeixinMessage.sendMail({
        toEmails: [recipient],
        subject,
        content,
        contentType: 'html',
      })
      const timestamp = now()
      await teable.updateRecord(this.table('recruitment_offers'), row.id, {
        发送状态: '已发送',
        发送时间: timestamp,
        更新时间: timestamp,
      })
      await teable.createRecord(this.table('recruitment_offer_send_events'), {
        发送事件ID: id('send'), OfferID: text(row.fields['OfferID']) || offerId, 发送渠道: '邮件', 接收地址: recipient, 发送状态: '已发送',
        内容摘要JSON: JSON.stringify({ fileUrl: text(row.fields['Offer文件地址']), responseUrl: responseUrl.toString(), expiresAt, subject }),
        错误信息: '', 操作人: text(body.operator) || '当前用户', 发生时间: timestamp,
      })
      return { offerId: text(row.fields['OfferID']) || offerId, status: '已发送', recipient, subject, expiresAt, responseUrl: responseUrl.toString(), externalId: text(mail.messageId) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await teable.createRecord(this.table('recruitment_offer_send_events'), {
        发送事件ID: id('send'), OfferID: text(row.fields['OfferID']) || offerId, 发送渠道: '邮件', 接收地址: recipient, 发送状态: '发送失败',
        内容摘要JSON: JSON.stringify({ fileUrl: text(row.fields['Offer文件地址']) }), 错误信息: message.slice(0, 1000),
        操作人: text(body.operator) || '当前用户', 发生时间: now(),
      })
      await teable.updateRecord(this.table('recruitment_offers'), row.id, { 发送状态: '发送失败', Offer状态: '待发送', 更新时间: now() })
      throw error
    }
  }

  async negotiate(offerId: string, input: OfferNegotiationInput) {
    const row = await this.find(offerId), oldVersion = num(row.fields['当前版本']) || 1, newVersion = oldVersion + 1, adjustments = input.adjustments || {}
    await teable.updateRecord(this.table('recruitment_offers'), row.id, { ...adjustments, 当前版本: newVersion, Offer状态: '谈薪中', 审批状态: '待重新审批', 更新时间: now() })
    await teable.createRecord(this.table('recruitment_offer_negotiations'), {
      谈薪记录ID: id('negotiation'), OfferID: offerId, 原版本: oldVersion, 新版本: newVersion, 候选人诉求: input.candidateRequest,
      公司答复: input.companyResponse, 调整项JSON: JSON.stringify(adjustments), 谈薪结果: input.result,
      操作人: text(input.operator) || '当前用户', 发生时间: now(),
    })
    await this.version(offerId, newVersion, { ...row.fields, ...adjustments }, '谈薪调整', input.candidateRequest, text(input.operator) || '当前用户')
    return { offerId, version: newVersion, status: '谈薪中', approvalStatus: '待重新审批' }
  }

  async publicOffer(token: string) {
    const row = await this.resolve(token, { allowAnswered: true })
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    const salary = json<StoredSalary>(row.fields['薪资结构JSON'], {}) || {}
    const internshipPay = internshipPayFromSalary(salary)
    const performanceIncluded = salary['绩效'] !== undefined
    const commissionValue = offerCommissionValue(salary)
    const commissionIncluded = commissionValue !== undefined
    const performanceAmount = performanceIncluded ? offerNoteAmount(salary['绩效']) : 0
    const commissionAmount = commissionIncluded ? offerNoteAmount(commissionValue) : 0
    return {
      offerId: text(row.fields['OfferID']) || row.id,
      candidateName: text(candidate?.fields['姓名']),
      offerNumber: text(row.fields['Offer编号']),
      role: text(row.fields['岗位名称']),
      department: text(row.fields['部门']),
      location: text(row.fields['工作地点']),
      salary: {
        base: num(salary['底薪'] ?? row.fields['基本月薪']),
        performance: performanceAmount,
        commission: commissionAmount,
        performanceNote: performanceIncluded ? offerNote(salary['绩效']) : '',
        commissionNote: commissionIncluded ? offerNote(commissionValue) : '',
        performanceIncluded,
        commissionIncluded,
        total: num(salary['底薪'] ?? row.fields['基本月薪']) + performanceAmount + commissionAmount,
        bonusMonths: num(row.fields['奖金月数']),
        daily: internshipPay.unit === 'day' ? internshipPay.amount : 0,
        monthly: internshipPay.unit === 'month' ? internshipPay.amount : 0,
        internshipPayUnit: salary['月薪'] !== undefined || salary['日薪'] !== undefined ? internshipPay.unit : '',
      },
      startDate: text(row.fields['入职日期']),
      probationMonths: text(row.fields['试用期月数']),
      fileUrl: text(row.fields['Offer文件地址']),
      expiresAt: text(row.fields['答复过期时间']),
      status: text(row.fields['Offer状态']),
      response: text(row.fields['候选人答复']),
    }
  }

  async respond(token: string, body: { response: 'accept' | 'reject'; note?: string }) {
    const row = await this.resolve(token)
    if (!['accept', 'reject'].includes(body.response)) throw new BadRequestException('答复必须是接受或拒绝')
    const accepted = body.response === 'accept', timestamp = now()
    const stage = accepted ? (text(row.fields['是否需要背调']) === '是' ? '背调' : '待入职') : 'Offer已拒绝'
    const response = accepted ? '接受' : '拒绝'
    await teable.updateRecord(this.table('recruitment_offers'), row.id, {
      候选人答复: response, 候选人答复说明: text(body.note), 答复时间: timestamp,
      Offer状态: accepted ? '已接受' : '已拒绝', 发送状态: '候选人已答复', 更新时间: timestamp,
    })
    const [apps, candidates] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_applications')),
      teable.listAllRecords(this.table('recruitment_candidates')),
    ])
    const app = apps.find((item) => text(item.fields['应聘记录ID']) === text(row.fields['应聘记录ID']))
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    if (app) {
      const oldStage = text(app.fields['当前阶段']) || '待Offer决策'
      await teable.updateRecord(this.table('recruitment_applications'), app.id, {
        当前阶段: stage, 当前状态: accepted ? '进行中' : '已结束', 最近处理时间: timestamp,
        流程结束时间: accepted ? '' : timestamp, 更新时间: timestamp,
      })
      await teable.createRecord(this.table('recruitment_stage_events'), {
        事件ID: id('evt'), 应聘记录ID: text(app.fields['应聘记录ID']) || app.id, 候选人ID: text(row.fields['候选人ID']),
        职位ID: text(app.fields['职位ID']), 原阶段: oldStage, 新阶段: stage, 操作: '候选人答复Offer', 结果: response,
        原因: text(body.note) || `候选人${response}Offer`, 操作人用户ID: '', 操作人: '候选人', 发生时间: timestamp,
        来源类型: 'Offer', 来源记录ID: text(row.fields['OfferID']) || row.id,
        扩展信息JSON: '{}',
      })
    }
    if (candidate) await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 候选人状态: stage, 更新时间: timestamp })
    if (accepted) {
      await this.messages.notifyPositionHr({
        category: 'Offer接受跟进入职', candidateId: text(row.fields['候选人ID']), objectId: text(row.fields['OfferID']) || row.id, applicationId: text(row.fields['应聘记录ID']),
        markdown: `## 【入职跟进】${text(candidate?.fields['姓名']) || '候选人'}\n> 候选人已接受Offer\n- 计划入职：${text(row.fields['入职日期'])}\n[进入入职管理 →](${appFlowUrl('onboarding', { candidate_id: text(row.fields['候选人ID']), offer_id: text(row.fields['OfferID']) }) || `${text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')}/#employees`})`,
        operator: '候选人',
      }).catch((error) => console.error(`[流程私信] Offer接受跟进入职 失败: ${error instanceof Error ? error.message : String(error)}`))
    }
    await this.audit('候选人答复Offer', 'Offer', text(row.fields['OfferID']) || row.id, row.fields, { response, stage }, '候选人')
    return { response, targetStage: stage }
  }

  private ensureTemplates() {
    if (this.templateEnsurePromise) return this.templateEnsurePromise
    this.templateEnsurePromise = (async () => {
      const table = this.table('recruitment_offer_templates')
      let rows = await teable.listAllRecords(table)
      const requiredTypes = ['实习', '社招']

      for (const type of requiredTypes) {
        if (!rows.some((row) => text(row.fields['适用类型']) === type)) {
          const templateId = id('offertpl'), timestamp = now()
          const normalizedType = normalizeTemplateType(type)
          const fields = templateFields(normalizedType)
          const created = await teable.createRecord(table, {
            Offer模板ID: templateId, 模板名称: `方片新媒体${type}录用通知书`, 适用类型: type,
            模板内容: serializeTemplateContent(type === '实习' ? '按实习录用通知书生成。' : '按社招录用通知书生成。', fields),
            变量JSON: JSON.stringify(fields.map((field) => field.label)),
            原始模板地址: '', 模板状态: '启用', 版本: 1, 创建人: '系统', 创建时间: timestamp, 更新时间: timestamp,
          })
          rows = [...rows, created]
        }
      }
    })().catch((error) => {
      this.templateEnsurePromise = undefined
      throw error
    })
    return this.templateEnsurePromise
  }

  private async resolveTemplateType(templateId?: string): Promise<OfferTemplateType> {
    await this.ensureTemplates()
    const rows = await teable.listAllRecords(this.table('recruitment_offer_templates'))
    const requested = text(templateId)
    const matched = requested
      ? rows.find((row) => text(row.fields['Offer模板ID']) === requested)
        || rows.find((row) => text(row.fields['适用类型']) === requested)
      : rows.find((row) => text(row.fields['适用类型']) === '社招' && text(row.fields['模板状态']) !== '停用')
    if (!matched) throw new BadRequestException('Offer模板不存在或已停用')
    if (matched && text(matched.fields['模板状态']) === '停用') throw new BadRequestException('Offer模板已停用')
    return (text(matched?.fields['适用类型']) || '社招') as OfferTemplateType
  }

  private mapTemplate(row: TeableRecord) {
    const type = normalizeTemplateType(row.fields['适用类型'])
    const config = parseTemplateContent(row.fields['模板内容'], type)
    return {
      id: text(row.fields['Offer模板ID']) || row.id,
      name: text(row.fields['模板名称']),
      type,
      content: config.description,
      description: config.description,
      fields: config.fields,
      variables: config.fields.filter((field) => field.enabled !== false).map((field) => field.label),
      originalUrl: text(row.fields['原始模板地址']),
      version: num(row.fields['版本']),
      createdAt: text(row.fields['创建时间']) || text(row.createdTime),
      updatedAt: text(row.fields['更新时间']) || text(row.fields['创建时间']) || text(row.createdTime),
    }
  }

  private offerHonorificInput(input: OfferInput) {
    const honorific = text(input.candidateHonorific)
    if (honorific && !['先生', '女士'].includes(honorific)) throw new BadRequestException('候选人称谓只能选择先生或女士')
    return honorific
  }

  private offerScheduleInput(input: OfferInput) {
    const reportingTo = text(input.reportingTo), validFrom = text(input.validFrom), validTo = text(input.validTo)
    if (!reportingTo) throw new BadRequestException('汇报上级不能为空')
    if (!isDateOnly(validFrom) || !isDateOnly(validTo) || validTo < validFrom) throw new BadRequestException('本通知书有效期不完整或结束日期早于开始日期，请重新填写')
    return { reportingTo, validFrom, validTo }
  }

  private fileValues(row: TeableRecord, candidate: TeableRecord | undefined, templateType: OfferTemplateType): OfferFileValues {
    const salary = json<StoredSalary>(row.fields['薪资结构JSON'], {}) || {}
    const internshipPay = internshipPayFromSalary(salary)
    const baseSalaryValue = templateType === '实习' ? internshipPay.amount : num(salary['底薪'] ?? row.fields['基本月薪'])
    const performanceIncluded = salary['绩效'] !== undefined
    const commissionValue = offerCommissionValue(salary)
    const commissionIncluded = commissionValue !== undefined
    const performanceNote = performanceIncluded ? offerNoteText(salary['绩效']) : ''
    const commissionNote = commissionIncluded ? offerNoteText(commissionValue) : ''
    const totalSalaryValue = baseSalaryValue + (performanceIncluded ? offerNoteAmount(salary['绩效']) : 0) + (commissionIncluded ? offerNoteAmount(commissionValue) : 0)
    const startDate = text(row.fields['入职日期'])
    const validFrom = text(row.fields['有效期开始']) || new Date().toISOString().slice(0, 10), validTo = text(row.fields['有效期结束']) || new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
    return {
      candidateName: text(candidate?.fields['姓名']) || '候选人',
      candidateHonorific: text(row.fields['称谓']) || honorificFromGender(text(candidate?.fields['性别'])),
      offerNumber: text(row.fields['Offer编号']),
      role: text(row.fields['岗位名称']),
      department: text(row.fields['部门']),
      location: text(row.fields['工作地点']),
      contractType: templateType === '实习' ? '实习合同' : '劳动合同',
      startDate,
      monthlySalary: String(baseSalaryValue),
      totalSalary: String(totalSalaryValue),
      dailySalary: String(templateType === '实习' && internshipPay.unit === 'day' ? internshipPay.amount : baseSalaryValue),
      internshipPayUnit: templateType === '实习' ? internshipPay.unit : 'month',
      performanceSalary: performanceNote,
      commissionSalary: commissionNote,
      performanceIncluded,
      commissionIncluded,
      probationMonths: /^\d+$/.test(text(row.fields['试用期月数'])) ? `${text(row.fields['试用期月数'])}个月` : text(row.fields['试用期月数']) || '试用期3个月，试用期薪资100%',
      deadlineDate: validTo,
      validFrom,
      validTo,
      reportingTo: text(row.fields['汇报上级']),
    }
  }

  private async renderPdf(values: OfferFileValues, templateType: OfferTemplateType, offerId: string) {
    if (templateType === '社招') return this.renderSocialTemplatePdf(values)
    const tempDir = await mkdtemp(path.join(tmpdir(), 'offer-pdf-'))
    const sourceFile = path.join(tempDir, 'offer.fodt'), outputDir = path.join(tempDir, 'out')
    try {
      await writeFile(sourceFile, offerDocument(values, templateType), 'utf8')
      await execFileAsync('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', outputDir, sourceFile], {
        timeout: 30_000, maxBuffer: 2_000_000,
      })
      const pdfPath = path.join(outputDir, 'offer.pdf')
      return await this.applyOfferBackground(await readFile(pdfPath))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ConflictException(`Offer PDF生成失败：${message.slice(0, 300)}`)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  private async renderSocialTemplatePdf(values: OfferFileValues) {
    const templatePath = await this.socialTemplatePath()
    const document = await PDFDocument.load(await readFile(templatePath))
    document.registerFontkit(fontkit)
    const requiredText = [...Object.values(values), '方片新媒体录用通知书薪酬包含底薪绩效其他试用期'].join(' ')
    const font = await document.embedFont(await this.offerPdfFontBytes(requiredText), { subset: true })
    const textColor = rgb(0.12, 0.12, 0.12)
    const pages = document.getPages()
    const first = pages[0], second = pages[1]
    const backgroundImage = await this.socialTemplateBackgroundImage(document, first)
    const backgroundBox = { x: 89.25, y: 277.3, width: 415.3, height: 336.7 }
    const cover = (page: any, x: number, y: number, width: number, height: number) => {
      const left = Math.max(x, backgroundBox.x)
      const right = Math.min(x + width, backgroundBox.x + backgroundBox.width)
      const top = Math.min(y + height, backgroundBox.y + backgroundBox.height)
      const bottom = Math.max(y, backgroundBox.y)
      if (right > left && top > bottom) {
        page.pushOperators(pushGraphicsState(), rectangle(left, bottom, right - left, top - bottom), clip(), endPath())
        page.drawImage(backgroundImage, backgroundBox)
        page.pushOperators(popGraphicsState())
      }
      if (x < left) page.drawRectangle({ x, y, width: left - x, height, color: rgb(1, 1, 1) })
      if (x + width > right) page.drawRectangle({ x: right, y, width: x + width - right, height, color: rgb(1, 1, 1) })
    }
    const bodySize = 10.5
    const put = (page: any, value: string, x: number, y: number, size = bodySize) => page.drawText(value, { x, y, size, font, color: textColor })
    const wrapText = (value: string, maxWidth: number, size = bodySize) => {
      const lines: string[] = []
      let line = ''
      for (const char of Array.from(value)) {
        const next = line + char
        if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
          lines.push(line)
          line = char
        } else line = next
      }
      if (line) lines.push(line)
      return lines
    }
    const dateParts = (value: string) => {
      const match = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
      return match ? [match[1], String(Number(match[2])), String(Number(match[3]))] : ['', '', '']
    }
    // Coordinates follow the supplied A4 template (PDF origin is bottom-left).
    first.drawRectangle({ x: 150, y: 625.5, width: 52, height: 16, color: rgb(1, 1, 1) })
    put(first, values.candidateName, 116, 629.6, bodySize)
    put(first, values.candidateHonorific, 116 + font.widthOfTextAtSize(values.candidateName, bodySize) + 6, 629.6, bodySize)
    put(first, `${values.role}${values.department ? `（${values.department}）` : ''}`, 190, 562)
    if (values.location && values.location !== '山东省烟台市') {
      cover(first, 176, 503, 170, 18); put(first, values.location, 180, 513)
    }
    put(first, values.reportingTo, 190, 537, bodySize)
    const startParts = dateParts(values.startDate)
    const centerInSlot = (page: any, value: string, left: number, right: number, y: number, size = 10.5) => {
      const width = font.widthOfTextAtSize(value, size)
      put(page, value, left + Math.max(0, (right - left - width) / 2), y, size)
    }
    put(first, startParts[0], 184, 463, 10.5)
    centerInSlot(first, startParts[1], 228, 248, 463)
    centerInSlot(first, startParts[2], 262, 286, 463)
    const salaryExtras: string[] = []
    if (values.performanceIncluded) salaryExtras.push(values.performanceSalary)
    if (values.commissionIncluded) salaryExtras.push(values.commissionSalary)
    const probationText = text(values.probationMonths)
    const salarySummary = `底薪${values.monthlySalary}元${salaryExtras.length ? `+${salaryExtras.join('+')}` : ''}${probationText ? `，${probationText}` : ''}。`
    const salaryLines = wrapText(salarySummary, 386, bodySize).slice(0, 3)
    cover(first, 88, 322, 432, 58)
    const salaryTop = 368
    salaryLines.forEach((line, index) => put(first, line, 124, salaryTop - index * 15, bodySize))
    const deadlineParts = dateParts(values.deadlineDate)
    put(second, deadlineParts[0], 137, 593, 10.5)
    centerInSlot(second, deadlineParts[1], 178, 198, 593)
    centerInSlot(second, deadlineParts[2], 214, 236, 593)
    const validFrom = dateParts(values.validFrom), validTo = dateParts(values.validTo)
    put(second, validFrom[0], 205, 420, 10.5)
    centerInSlot(second, validFrom[1], 246, 266, 420)
    centerInSlot(second, validFrom[2], 282, 304, 420)
    put(second, validTo[0], 331, 420, 10.5)
    centerInSlot(second, validTo[1], 368, 388, 420)
    centerInSlot(second, validTo[2], 402, 424, 420)
    return Buffer.from(await document.save())
  }

  private async socialTemplateBackgroundImage(document: PDFDocument, page: any) {
    const xObjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    let backgroundRef: any, backgroundStream: PDFRawStream | undefined, width = 0, height = 0
    for (const [, value] of xObjects?.entries() ?? []) {
      const stream = document.context.lookup(value)
      if (!(stream instanceof PDFRawStream)) continue
      if (stream.dict.lookupMaybe(PDFName.of('Filter'), PDFName)?.toString() !== '/DCTDecode') continue
      const streamWidth = stream.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0
      const streamHeight = stream.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0
      if (streamWidth * streamHeight > width * height) {
        backgroundRef = value
        backgroundStream = stream
        width = streamWidth
        height = streamHeight
      }
    }
    if (!backgroundRef || !backgroundStream) throw new ConflictException('社招Offer模板背景图不存在')
    const embedder = await JpegEmbedder.for(new Uint8Array(backgroundStream.contents))
    return PDFImage.of(backgroundRef, document, embedder)
  }

  private async offerPdfFontBytes(requiredText = '中文录用通知书') {
    const configuredPath = text(process.env.OFFER_PDF_FONT_PATH)
    const knownPaths = [
      configuredPath,
      path.resolve(__dirname, '../../client/assets/fonts/HarmonyOS_Sans_SC_Regular.ttf'),
      '/usr/share/fonts/arp/harmonyos-sans/HarmonyOS_Sans_SC_Regular.ttf',
      path.resolve(__dirname, '../../client/assets/fonts/SourceHanSansCN-Regular.otf'),
      '/usr/share/fonts/arp/oppo-sans/OPPOSans4-Regular.ttf',
      '/usr/share/fonts/arp/source-han-sans/SourceHanSansCN-Regular.otf',
    ].filter(Boolean)
    for (const fontPath of knownPaths) {
      try {
        const fontBytes = await readFile(fontPath)
        if (this.offerFontSupportsText(fontBytes, requiredText)) return fontBytes
      } catch {}
    }

    for (const family of ['HarmonyOS Sans SC', 'OPPO Sans 4.0', 'Source Han Sans CN', 'Noto Sans CJK SC', 'sans-serif']) {
      try {
        const { stdout } = await execFileAsync('fc-match', ['-f', '%{file}', family], { timeout: 5_000, maxBuffer: 100_000 })
        const fontPath = text(stdout)
        if (fontPath) {
          const fontBytes = await readFile(fontPath)
          if (this.offerFontSupportsText(fontBytes, requiredText)) return fontBytes
        }
      } catch {}
    }
    throw new ConflictException('Offer PDF生成失败：未找到支持本次姓名、岗位等内容的中文完整字体，请配置 OFFER_PDF_FONT_PATH 指向系统字体文件')
  }

  private offerFontSupportsText(fontBytes: Buffer, requiredText: string) {
    try {
      const font = (fontkit as unknown as { create: (bytes: Buffer) => { hasGlyphForCodePoint: (codePoint: number) => boolean } }).create(fontBytes)
      return [...requiredText].every((char) => !char.trim() || font.hasGlyphForCodePoint(char.codePointAt(0) ?? 0))
    } catch {
      return false
    }
  }

  private assertOfferNotAnswered(row: TeableRecord) {
    if (text(row.fields['候选人答复']) || ['已接受', '已拒绝'].includes(text(row.fields['Offer状态']))) {
      throw new ConflictException('候选人已答复Offer，不能重复生成或发送')
    }
  }

  private async applicationForPosition(candidateId: string, positionId: string) {
    const applications = await teable.listAllRecords(this.table('recruitment_applications'))
    const application = applications
      .filter((row) => text(row.fields['候选人ID']) === candidateId && text(row.fields['职位ID']) === positionId && text(row.fields['当前状态']) !== '已结束')
      .sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    if (!application) throw new BadRequestException('候选人未应聘所选岗位，无法更换岗位')
    return application
  }

  private async socialTemplatePath() {
    return this.templateAssetPath('方片新媒体-录用通知书-社招模板.pdf', '社招Offer模板文件不存在，请检查模板资源是否发布到应用中')
  }

  private async templateAssetPath(filename: string, missingMessage: string) {
    const candidates = [path.join(process.cwd(), 'dist', 'client', 'uploads', filename), path.join(process.cwd(), 'source-app', 'uploads', filename)]
    for (const candidate of candidates) {
      try { await access(candidate); return candidate } catch {}
    }
    throw new ConflictException(missingMessage)
  }

  private async applyOfferBackground(contentPdf: Buffer) {
    const backgroundPath = await this.templateAssetPath('方片新媒体-录用通知书-背景.pdf', 'Offer背景模板文件不存在，请检查模板资源是否发布到应用中')
    const background = await PDFDocument.load(await readFile(backgroundPath))
    const content = await PDFDocument.load(contentPdf)
    const output = await PDFDocument.create()
    const backgroundPages = await output.embedPages(background.getPages())
    const contentPages = await output.embedPages(content.getPages())
    contentPages.forEach((page, index) => {
      const { width, height } = page
      const sheet = output.addPage([width, height])
      sheet.drawPage(backgroundPages[Math.min(index, backgroundPages.length - 1)], { x: 0, y: 0, width, height })
      sheet.drawPage(page, { x: 0, y: 0, width, height })
    })
    return Buffer.from(await output.save())
  }

  private async find(offerId: string) {
    const rows = await teable.listAllRecords(this.table('recruitment_offers'))
    const row = rows.find((item) => text(item.fields['OfferID']) === offerId || item.id === offerId)
    if (!row) throw new NotFoundException('Offer不存在')
    return row
  }

  private async resolve(token: string, options: { allowAnswered?: boolean } = {}) {
    const rows = await teable.listAllRecords(this.table('recruitment_offers'))
    const row = rows.find((item) => text(item.fields['答复Token哈希']) === hash(token))
    if (!row) throw new UnauthorizedException('Offer答复链接无效')
    if (text(row.fields['候选人答复']) || ['已接受', '已拒绝'].includes(text(row.fields['Offer状态']))) {
      if (options.allowAnswered) return row
      throw new ConflictException('该Offer已经答复，不能重复提交')
    }
    if (Date.parse(text(row.fields['答复过期时间'])) <= Date.now()) {
      await teable.updateRecord(this.table('recruitment_offers'), row.id, { Offer状态: '已逾期', 更新时间: now() })
      throw new UnauthorizedException('Offer答复链接已过期')
    }
    return row
  }

  private async version(offerId: string, version: number, snapshot: unknown, type: string, reason: string, operator: string) {
    await teable.createRecord(this.table('recruitment_offer_versions'), {
      Offer版本ID: id('offerversion'), OfferID: offerId, 版本号: version, Offer快照JSON: JSON.stringify(snapshot),
      变更类型: type, 变更原因: reason, 创建人: operator, 创建时间: now(),
    })
  }

  private async approvalEvent(offerId: string, oldStatus: string, newStatus: string, action: string, node: string, operator: string, operatorUserId: string, opinion: string) {
    await teable.createRecord(this.table('recruitment_offer_approval_events'), {
      审批事件ID: id('approval'), OfferID: offerId, 原审批状态: oldStatus, 新审批状态: newStatus, 审批动作: action,
      审批节点: node, 审批人用户ID: operatorUserId, 审批人: operator, 审批角色: node, 审批意见: opinion, 发生时间: now(),
    })
  }

  private mapOffer(row: TeableRecord, candidate?: TeableRecord) {
    const salary = json<StoredSalary>(row.fields['薪资结构JSON'], {}) || {}
    const internshipPay = internshipPayFromSalary(salary)
    const performanceIncluded = salary['绩效'] !== undefined
    const commissionValue = offerCommissionValue(salary)
    const commissionIncluded = commissionValue !== undefined
    const performanceNote = performanceIncluded ? offerNote(salary['绩效']) : ''
    const commissionNote = commissionIncluded ? offerNote(commissionValue) : ''
    return {
      id: text(row.fields['OfferID']) || row.id,
      number: text(row.fields['Offer编号']),
      candidateId: text(row.fields['候选人ID']),
      candidateName: text(candidate?.fields['姓名']),
      candidateEmail: text(candidate?.fields['邮箱']),
      role: text(row.fields['岗位名称']),
      department: text(row.fields['部门']),
      templateType: text(row.fields['模板ID']) === '实习' ? '实习' : text(row.fields['模板ID']) === '社招' ? '社招' : '',
      dailySalary: internshipPay.unit === 'day' ? internshipPay.amount : 0,
      internshipPayUnit: salary['月薪'] !== undefined ? 'month' : salary['日薪'] !== undefined ? 'day' : '',
      baseSalary: salary['月薪'] !== undefined ? internshipPay.amount : num(salary['底薪'] ?? row.fields['基本月薪']),
      performanceSalary: performanceNote,
      commission: commissionNote,
      performanceIncluded,
      commissionIncluded,
      startDate: text(row.fields['入职日期']),
      status: text(row.fields['Offer状态']),
      approvalStatus: text(row.fields['审批状态']),
      version: num(row.fields['当前版本']),
      fileUrl: text(row.fields['Offer文件地址']),
      sendStatus: text(row.fields['发送状态']),
      response: text(row.fields['候选人答复']),
      positionId: text(row.fields['职位ID']),
      templateId: text(row.fields['模板ID']),
      candidateHonorific: text(row.fields['称谓']),
      location: text(row.fields['工作地点']),
      probationMonths: text(row.fields['试用期月数']),
      reportingTo: text(row.fields['汇报上级']),
      validFrom: text(row.fields['有效期开始']),
      validTo: text(row.fields['有效期结束']),
      updatedAt: text(row.fields['更新时间']),
    }
  }

  private async audit(action: string, type: string, object: string, before: unknown, after: unknown, operator: string, result = '成功', error = '') {
    await teable.createRecord(this.table('recruitment_audit_logs'), {
      日志ID: id('audit'), 操作人: operator, 操作类型: action, 对象类型: type, 对象ID: object,
      修改前摘要JSON: JSON.stringify(before), 修改后摘要JSON: JSON.stringify(after), 请求ID: id('req'),
      发生时间: now(), 操作结果: result, 错误信息: error.slice(0, 1000),
    })
  }
}
