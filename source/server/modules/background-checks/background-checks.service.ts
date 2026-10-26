import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { gdbfAdminClient, type GdbfAdminPackage } from './gdbf-client'
import { storage } from '../../platform/storage'
import { teable, TeableRecord } from '../../platform/teable'
import { DatabaseService } from '../database/database.service'
import {
  BackgroundAuthorizationInput,
  BackgroundCheckInput,
  BackgroundConclusionInput,
  BackgroundContactInput,
  BackgroundRiskInput,
  BackgroundVerificationInput,
} from './background-check.types'

const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
const text = (value: unknown) => String(value ?? '').trim()
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const json = <T>(value: unknown, fallback: T): T => { try { return value ? JSON.parse(String(value)) as T : fallback } catch { return fallback } }
const escapeHtml = (value: unknown) => text(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
interface GdbfPackageResponse {
  packages: GdbfAdminPackage[]
  items: Array<{ itemId: string; itemName: string; itemPrice: number; contractId: string }>
  contract: Awaited<ReturnType<typeof gdbfAdminClient.contract>>
  degraded?: boolean
  message?: string
}

const packageCache: { data?: GdbfPackageResponse; expiresAt?: number } = {}

const externalRiskLevel = (reportResult: unknown, reportResultLabel: unknown) => {
  const label = text(reportResultLabel)
  const result = String(reportResult || '')
  if (label.includes('红灯') || result === '2') return '高'
  if (label.includes('黄灯') || result === '3') return '中'
  if (label.includes('绿灯') || result === '1') return '低'
  return ''
}

@Injectable()
export class BackgroundChecksService {
  constructor(private readonly database: DatabaseService) {}
  private table(name: string) { return this.database.requireTableId(name) }

  async list(query: { candidateId?: string; status?: string }) {
    const [checks, candidates, contacts, verifications, risks, events] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_background_checks')),
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_background_contacts')),
      teable.listAllRecords(this.table('recruitment_background_verifications')),
      teable.listAllRecords(this.table('recruitment_background_risks')),
      teable.listAllRecords(this.table('recruitment_background_events')),
    ])
    const rows = checks
      .filter((row) => !query.candidateId || text(row.fields['候选人ID']) === query.candidateId)
      .filter((row) => !query.status || text(row.fields['背调状态']) === query.status)
      .map((row) => this.mapCheck(
        row,
        candidates.find((candidate) => text(candidate.fields['候选人ID']) === text(row.fields['候选人ID'])),
        contacts.filter((item) => text(item.fields['背调ID']) === text(row.fields['背调ID'])),
        verifications.filter((item) => text(item.fields['背调ID']) === text(row.fields['背调ID'])),
        risks.filter((item) => text(item.fields['背调ID']) === text(row.fields['背调ID'])),
        events.filter((item) => text(item.fields['背调ID']) === text(row.fields['背调ID'])),
      ))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { total: rows.length, checks: rows }
  }

  async create(input: BackgroundCheckInput) {
    if (!text(input.candidateId)) throw new BadRequestException('候选人不能为空')
    const [candidates, applications, offers, checks] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_applications')),
      teable.listAllRecords(this.table('recruitment_offers')),
      teable.listAllRecords(this.table('recruitment_background_checks')),
    ])
    const candidate = candidates.find((row) => text(row.fields['候选人ID']) === input.candidateId || row.id === input.candidateId)
    if (!candidate) throw new NotFoundException('候选人不存在')
    const active = checks.find((row) => text(row.fields['候选人ID']) === input.candidateId && !['已通过', '已终止'].includes(text(row.fields['背调状态'])))
    if (active) throw new ConflictException('该候选人已有进行中的背调')
    const application = applications.find((row) => text(row.fields['应聘记录ID']) === input.applicationId)
      || applications.filter((row) => text(row.fields['候选人ID']) === input.candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    const offer = offers.find((row) => text(row.fields['OfferID']) === input.offerId)
      || offers.filter((row) => text(row.fields['候选人ID']) === input.candidateId && text(row.fields['候选人答复']) === '接受').sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
    if (offer && text(offer.fields['是否需要背调']) === '否') throw new ConflictException('当前Offer已标记无需背调')
    const backgroundId = id('background'), timestamp = now()
    const number = `BG-${timestamp.slice(0, 10).replace(/-/g, '')}-${backgroundId.slice(-6).toUpperCase()}`
    const scopes = input.scopes?.length ? input.scopes : ['身份与学历', '工作履历', '离职原因', '工作表现', '管理与带队能力']
    const fields = {
      背调ID: backgroundId, 候选人ID: input.candidateId, 应聘记录ID: text(application?.fields['应聘记录ID']), OfferID: text(offer?.fields['OfferID']),
      背调编号: number, 背调状态: '待授权', 授权状态: '待授权', 核验范围JSON: JSON.stringify(scopes), 外部服务商: text(input.provider) || '未选择',
      外部同步状态: '未发起', 风险等级: '待评估', 背调结论: '待确认', 报告版本: 0, 人工确认状态: '待确认',
      创建人用户ID: text(input.operatorUserId), 创建人: text(input.operator) || '当前用户', 创建时间: timestamp, 更新时间: timestamp,
    }
    await teable.createRecord(this.table('recruitment_background_checks'), fields)
    await this.event(backgroundId, input.candidateId, '', '待授权', '创建背调', '已创建背调任务，等待候选人授权', { scopes }, input.operator, input.operatorUserId)
    await this.audit('创建背调', '背调', backgroundId, {}, fields, input.operator)
    return { backgroundId, number, status: '待授权', authorizationStatus: '待授权' }
  }

  async authorize(backgroundId: string, input: BackgroundAuthorizationInput) {
    if (!text(input.method)) throw new BadRequestException('授权方式不能为空')
    const row = await this.find(backgroundId), oldStatus = text(row.fields['背调状态'])
    if (['已通过', '已终止'].includes(oldStatus)) throw new ConflictException('已结束的背调不能修改授权')
    const authorized = input.status === '已授权', next = authorized ? '信息收集中' : input.status === '拒绝授权' ? '授权拒绝' : '授权撤回'
    const patch = { 授权状态: input.status, 授权方式: input.method, 授权时间: input.authorizedAt || now(), 授权文件地址: text(input.fileUrl), 背调状态: next, 更新时间: now() }
    await teable.updateRecord(this.table('recruitment_background_checks'), row.id, patch)
    await this.event(backgroundId, text(row.fields['候选人ID']), oldStatus, next, '授权状态变更', text(input.note) || `${input.status}，方式：${input.method}`, patch, input.operator, input.operatorUserId)
    return { backgroundId, status: next, authorizationStatus: input.status }
  }

  async addContact(backgroundId: string, input: BackgroundContactInput) {
    const row = await this.find(backgroundId)
    if (text(row.fields['授权状态']) !== '已授权') throw new ConflictException('候选人授权后才能录入背调联系人')
    if (!text(input.name) || !text(input.relationship) || (!text(input.phone) && !text(input.email))) throw new BadRequestException('联系人姓名、关系及至少一种联系方式不能为空')
    const contactId = id('bgcontact'), timestamp = now()
    await teable.createRecord(this.table('recruitment_background_contacts'), {
      背调联系人ID: contactId, 背调ID: backgroundId, 候选人ID: text(row.fields['候选人ID']), 联系人姓名: input.name,
      与候选人关系: input.relationship, 公司名称: text(input.company), 职位: text(input.role), 电话: text(input.phone), 邮箱: text(input.email),
      核验状态: text(input.status) || '待联系', 联系备注: text(input.note), 创建人: text(input.operator) || '当前用户', 创建时间: timestamp, 更新时间: timestamp,
    })
    await this.touch(row, '信息收集中')
    return { contactId, status: text(input.status) || '待联系' }
  }

  async addVerification(backgroundId: string, input: BackgroundVerificationInput) {
    const row = await this.find(backgroundId)
    if (text(row.fields['授权状态']) !== '已授权') throw new ConflictException('候选人授权后才能开展核验')
    if (!text(input.type) || !text(input.result) || !text(input.evidenceSource)) throw new BadRequestException('核验类型、结果和证据来源不能为空')
    const verificationId = id('bgverify'), timestamp = now()
    await teable.createRecord(this.table('recruitment_background_verifications'), {
      核验项ID: verificationId, 背调ID: backgroundId, 候选人ID: text(row.fields['候选人ID']), 核验类型: input.type,
      公司名称: text(input.company), 任职岗位: text(input.role), 候选人声明开始时间: text(input.declaredStart), 候选人声明结束时间: text(input.declaredEnd),
      核验开始时间: text(input.verifiedStart), 核验结束时间: text(input.verifiedEnd), 候选人声明内容: text(input.declaration), 核验结果: input.result,
      离职原因: text(input.leavingReason), 工作表现: text(input.performance), 带队与管理表现: text(input.managementPerformance),
      一致性结论: input.consistency || '待确认', 证据来源: input.evidenceSource, 核验人: text(input.verifier) || '当前用户', 核验时间: timestamp, 创建时间: timestamp, 更新时间: timestamp,
    })
    await this.touch(row, '核验中')
    return { verificationId, consistency: input.consistency }
  }

  async addRisk(backgroundId: string, input: BackgroundRiskInput) {
    const row = await this.find(backgroundId)
    if (!text(input.title) || !text(input.description) || !text(input.evidenceSummary)) throw new BadRequestException('风险标题、说明和证据摘要不能为空')
    const riskId = id('bgrisk'), timestamp = now()
    await teable.createRecord(this.table('recruitment_background_risks'), {
      风险项ID: riskId, 背调ID: backgroundId, 候选人ID: text(row.fields['候选人ID']), 风险类型: text(input.type) || '其他', 风险等级: input.level,
      风险标题: input.title, 风险说明: input.description, 证据摘要: input.evidenceSummary, 证据附件JSON: JSON.stringify(input.attachments || []),
      处理状态: '待确认', 创建人: text(input.operator) || '当前用户', 创建时间: timestamp, 更新时间: timestamp,
    })
    const levels = ['待评估', '低', '中', '高', '严重'], current = text(row.fields['风险等级']) || '待评估'
    if (levels.indexOf(input.level) > levels.indexOf(current)) await teable.updateRecord(this.table('recruitment_background_checks'), row.id, { 风险等级: input.level, 更新时间: timestamp })
    return { riskId, level: input.level, status: '待确认' }
  }

  async uploadEvidence(backgroundId: string, file: Express.Multer.File, body: { riskId?: string; operator?: string }) {
    const row = await this.find(backgroundId)
    if (!file?.buffer) throw new BadRequestException('请选择证据附件')
    if (file.size > 15 * 1024 * 1024) throw new BadRequestException('证据附件不能超过15MB')
    const safeName = file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    const uploaded = await storage.upload(`background-checks/${backgroundId}/${Date.now()}-${safeName}`, file.mimetype || 'application/octet-stream', file.buffer)
    if (body.riskId) {
      const risks = await teable.listAllRecords(this.table('recruitment_background_risks'))
      const risk = risks.find((item) => text(item.fields['风险项ID']) === body.riskId && text(item.fields['背调ID']) === backgroundId)
      if (!risk) throw new NotFoundException('风险项不存在')
      const attachments = json<any[]>(risk.fields['证据附件JSON'], [])
      attachments.push({ name: file.originalname, url: uploaded.cdnUrl, contentType: file.mimetype, uploadedAt: now() })
      await teable.updateRecord(this.table('recruitment_background_risks'), risk.id, { 证据附件JSON: JSON.stringify(attachments), 更新时间: now() })
    }
    await this.event(backgroundId, text(row.fields['候选人ID']), text(row.fields['背调状态']), text(row.fields['背调状态']), '上传背调证据', file.originalname, { url: uploaded.cdnUrl, riskId: body.riskId }, body.operator)
    return { fileName: file.originalname, fileUrl: uploaded.cdnUrl, contentType: file.mimetype }
  }

  async packages() {
    if (packageCache.data && packageCache.expiresAt && Date.now() < packageCache.expiresAt) return packageCache.data
    try {
      const result = { packages: [] as GdbfAdminPackage[], items: [] as Array<{ itemId: string; itemName: string; itemPrice: number; contractId: string }>, contract: await gdbfAdminClient.contract() }
      result.packages = result.contract.packages
      result.items = result.contract.items
      packageCache.data = result
      packageCache.expiresAt = Date.now() + 10 * 60_000
      return result
    } catch (error) {
      if (packageCache.data && packageCache.expiresAt && Date.now() < packageCache.expiresAt + 60 * 60_000) {
        packageCache.expiresAt = Date.now() + 60_000
        return { ...packageCache.data, degraded: true, message: error instanceof Error ? error.message : String(error) }
      }
      throw error
    }
  }

  async externalRequest(backgroundId: string, body: { provider?: string; packageId: string; operator?: string }, progress?: (message: string) => void) {
    const row = await this.find(backgroundId)
    if (text(row.fields['授权状态']) !== '已授权') throw new ConflictException('候选人授权后才能发起八方背调')
    if (!text(body.packageId)) throw new BadRequestException('请选择八方背调套餐')
    progress?.('正在校验候选人授权与联系信息…')
    const [candidates, applications] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_applications')),
    ])
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']) || item.id === row.id)
    const application = applications.find((item) => text(item.fields['应聘记录ID']) === text(row.fields['应聘记录ID']))
    const name = text(candidate?.fields['姓名'])
    const gender = text(candidate?.fields['性别'])
    const phone = text(candidate?.fields['电话']).replace(/\s|-/g, '')
    if (!name) throw new BadRequestException('候选人姓名缺失，无法发起八方背调')
    if (!['男', '女'].includes(gender)) throw new BadRequestException('候选人性别缺失或无效，无法发起八方背调')
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new BadRequestException('候选人手机号缺失或格式不正确，无法发起八方背调')
    progress?.('正在读取八方套餐与合同信息…')
    const contract = await gdbfAdminClient.contract()
    const packages = contract.packages
    const pkg = packages.find((item: { packageId: string }) => item.packageId === body.packageId)
    if (!pkg) throw new BadRequestException('八方套餐不存在或不可用')
    const timestamp = now()
    progress?.('正在创建八方锦程订单…')
    const order = await gdbfAdminClient.createOrder({
      employeeName: name,
      employeeSex: gender === '男' ? '1' : '2',
      employeePhone: phone,
      employeeEmail: text(candidate?.fields['邮箱']),
      employeeIdCard: text(candidate?.fields['身份证号']),
      employeeNationality: '中国',
      employeeDept: text(application?.fields['部门']) || '',
      employeePost: text(application?.fields['职位名称']) || pkg.packageName,
      packageId: body.packageId,
      isUrgent: '0', isEnReport: '0', isOverseas: '0',
      reportEmail: contract.customerEmail || '',
      remarks: `ResumeFlow backgroundId=${backgroundId}`,
      contractId: pkg.contractId || contract.contractId,
      packageName: pkg.packageName,
      packagePrice: pkg.packagePrice,
    })
    progress?.('正在回写订单信息…')
    await teable.updateRecord(this.table('recruitment_background_checks'), row.id, {
      外部服务商: '八方锦程', 外部任务ID: order.orderId, 外部同步状态: '待受理', 外部错误信息: '',
      八方订单ID: order.orderId, 八方套餐ID: pkg.packageId, 八方套餐名称: pkg.packageName,
      八方订单状态: '待受理', 八方下单时间: timestamp, 背调状态: '外部核验中', 更新时间: timestamp,
    })
    await this.event(backgroundId, text(row.fields['候选人ID']), text(row.fields['背调状态']), '外部核验中', '发起八方背调', `套餐：${pkg.packageName}`, order, body.operator)
    return { backgroundId, orderId: order.orderId, status: '待受理', packageName: pkg.packageName }
  }

  async syncExternal(backgroundId: string, body: { operator?: string } = {}) {
    const row = await this.find(backgroundId)
    const orderId = text(row.fields['八方订单ID'])
    if (!orderId) throw new BadRequestException('当前背调尚未发起八方订单')
    const timestamp = now()
    try {
      const order = await gdbfAdminClient.getOrder(orderId)
      const reports = await gdbfAdminClient.getReports(orderId)
      const complete = reports.find((item) => String(item.type || '') === '2') || reports[0]
      const report = complete ? {
        reportResult: String(complete.result || ''),
        reportResultLabel: String(complete.resultText || ''),
        reportType: String(complete.type || ''),
        reportTypeLabel: String(complete.typeText || ''),
        reportUrl: await gdbfAdminClient.reportDownloadUrl(String(complete.fileId || '')),
      } : null
      const statusMap: Record<string, string> = { '完成': '待结论确认', '阶段性': '核验中', '待受理': '外部核验中', '待授权': '待授权', '进行中': '外部核验中', '已撤单': '外部核验异常' }
      const next = report?.reportUrl ? '待结论确认' : statusMap[order.statusLabel || ''] || '外部核验中'
      const patch: Record<string, unknown> = {
        外部同步状态: order.statusLabel, 外部错误信息: '', 八方订单状态: order.statusLabel, 背调状态: next, 更新时间: timestamp,
      }
      if (report) {
        patch['八方报告结果'] = report.reportResultLabel || ''
        patch['八方报告地址'] = report.reportUrl || ''
        patch['八方报告类型'] = report.reportTypeLabel || ''
        patch['八方报告同步时间'] = timestamp
        if (report.reportUrl) { patch['报告地址'] = report.reportUrl; patch['报告文件名'] = `八方背调报告-${orderId}` }
      }
      await teable.updateRecord(this.table('recruitment_background_checks'), row.id, patch)
      await this.event(backgroundId, text(row.fields['候选人ID']), text(row.fields['背调状态']), next, '同步八方背调', `订单状态：${order.statusLabel}${report?.reportResultLabel ? `；报告：${report.reportResultLabel}` : ''}`, { order, report }, body.operator)
      return { backgroundId, orderId, status: next, externalStatus: order.statusLabel, report }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await teable.updateRecord(this.table('recruitment_background_checks'), row.id, { 外部同步状态: '同步失败', 外部错误信息: message.slice(0, 500), 更新时间: timestamp })
      await this.event(backgroundId, text(row.fields['候选人ID']), text(row.fields['背调状态']), text(row.fields['背调状态']), '同步八方失败', message, {}, body.operator)
      throw error
    }
  }

  async pullReports(days = 1) {
    const dayCount = Math.max(1, Math.min(31, days))
    const end = now().slice(0, 10)
    const start = new Date(Date.now() - (dayCount - 1) * 86_400_000).toISOString().slice(0, 10)
    const checks = await teable.listAllRecords(this.table('recruitment_background_checks'))
    const rows = checks.filter((item) => text(item.fields['八方订单ID']))
    let updated = 0
    for (const row of rows) {
      const orderId = text(row.fields['八方订单ID'])
      const timestamp = now()
      try {
        const [reports, order] = await Promise.all([
          gdbfAdminClient.getReports(orderId),
          gdbfAdminClient.getOrder(orderId).catch(() => null),
        ])
        const complete = reports.find((item) => String(item.type || '') === '2') || reports.find((item) => String(item.fileId || '')) || reports[0]
        const orderStatus = text(order?.statusLabel)
        const patch: Record<string, unknown> = {
          外部同步状态: orderStatus || (complete ? (String(complete.type || '') === '2' ? '完成' : '阶段性') : '同步失败'),
          外部错误信息: '',
          八方订单状态: orderStatus || text(row.fields['八方订单状态']),
          更新时间: timestamp,
        }
        if (complete) {
          const reportUrl = text(complete.fileId) ? await gdbfAdminClient.reportDownloadUrl(String(complete.fileId || '')) : text(complete.fileUrl)
          const reportResult = String(complete.result || '')
          const reportResultLabel = String(complete.resultText || '')
          const riskLevel = externalRiskLevel(reportResult, reportResultLabel)
          if (reportUrl) patch['八方报告地址'] = reportUrl
          if (reportResultLabel) patch['八方报告结果'] = reportResultLabel
          patch['八方报告类型'] = String(complete.typeText || '')
          patch['八方报告同步时间'] = timestamp
          if (reportUrl) { patch['报告地址'] = reportUrl; patch['报告文件名'] = String(complete.fileName || `八方背调报告-${orderId}`) }
          if (riskLevel) patch['风险等级'] = riskLevel
          patch['背调状态'] = String(complete.type || '') === '2' ? '待结论确认' : '核验中'
          patch['外部同步状态'] = String(complete.type || '') === '2' ? '完成' : '阶段性'
        }
        await teable.updateRecord(this.table('recruitment_background_checks'), row.id, patch)
        if (complete || orderStatus) {
          await this.event(text(row.fields['背调ID']), text(row.fields['候选人ID']), text(row.fields['背调状态']), text(patch['背调状态']) || text(row.fields['背调状态']), '自动同步八方报告', orderStatus ? `订单状态：${orderStatus}${complete?.resultText ? `；报告：${complete.resultText}` : ''}` : text(complete?.resultText || ''), { order, report: complete }, '系统定时任务')
          updated += 1
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await teable.updateRecord(this.table('recruitment_background_checks'), row.id, {
          外部同步状态: '同步失败', 外部错误信息: message.slice(0, 500), 更新时间: timestamp,
        })
      }
    }
    return { total: rows.length, updated, start, end }
  }

  async externalResult(backgroundId: string, body: { externalTaskId: string; status: '成功' | '失败' | '处理中'; summary?: string; error?: string; operator?: string }) {
    const row = await this.find(backgroundId)
    if (!text(row.fields['外部任务ID']) || text(row.fields['外部任务ID']) !== text(body.externalTaskId)) throw new ConflictException('外部任务ID不匹配')
    const next = body.status === '成功' ? '核验中' : body.status === '失败' ? '外部核验异常' : '外部核验中'
    await teable.updateRecord(this.table('recruitment_background_checks'), row.id, { 外部同步状态: body.status, 外部错误信息: text(body.error), 背调状态: next, 更新时间: now() })
    await this.event(backgroundId, text(row.fields['候选人ID']), text(row.fields['背调状态']), next, '外部结果回填', text(body.summary) || text(body.error), body, body.operator)
    return { backgroundId, syncStatus: body.status, status: next }
  }

  async generateReport(backgroundId: string, body: { operator?: string }) {
    const row = await this.find(backgroundId)
    const [candidates, contacts, verifications, risks] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_background_contacts')),
      teable.listAllRecords(this.table('recruitment_background_verifications')),
      teable.listAllRecords(this.table('recruitment_background_risks')),
    ])
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    const ownContacts = contacts.filter((item) => text(item.fields['背调ID']) === backgroundId)
    const ownVerifications = verifications.filter((item) => text(item.fields['背调ID']) === backgroundId)
    const ownRisks = risks.filter((item) => text(item.fields['背调ID']) === backgroundId)
    if (!ownVerifications.length) throw new ConflictException('至少完成一项履历或信息核验后才能生成报告')
    const version = num(row.fields['报告版本']) + 1, generatedAt = now()
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(row.fields['背调编号'])}</title><style>body{font-family:Arial,'Microsoft YaHei';max-width:860px;margin:40px auto;color:#263b33;line-height:1.7}h1{color:#194f3d}section{margin:24px 0;padding:18px;border:1px solid #dfe7e2;border-radius:12px}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #e7ece9;text-align:left}small{color:#7b8982}.risk-high{color:#a33}</style><h1>候选人背调报告</h1><p>${escapeHtml(candidate?.fields['姓名'])} · ${escapeHtml(row.fields['背调编号'])} · 第${version}版</p><small>生成时间：${generatedAt}。本报告基于已授权范围和人工录入/回填证据，最终录用决策须由有权限人员确认。</small><section><h2>授权与范围</h2><p>${escapeHtml(row.fields['授权状态'])} · ${escapeHtml(row.fields['授权方式'])}</p><p>${json<string[]>(row.fields['核验范围JSON'], []).map(escapeHtml).join('、')}</p></section><section><h2>联系人</h2>${ownContacts.length ? `<table>${ownContacts.map((item) => `<tr><td>${escapeHtml(item.fields['联系人姓名'])}</td><td>${escapeHtml(item.fields['与候选人关系'])}</td><td>${escapeHtml(item.fields['公司名称'])}</td><td>${escapeHtml(item.fields['核验状态'])}</td></tr>`).join('')}</table>` : '<p>无联系人记录</p>'}</section><section><h2>履历与表现核验</h2>${ownVerifications.map((item) => `<h3>${escapeHtml(item.fields['核验类型'])} · ${escapeHtml(item.fields['公司名称'])}</h3><p>${escapeHtml(item.fields['核验结果'])}</p><p>离职原因：${escapeHtml(item.fields['离职原因']) || '未记录'}；工作表现：${escapeHtml(item.fields['工作表现']) || '未记录'}；管理表现：${escapeHtml(item.fields['带队与管理表现']) || '未记录'}</p><small>一致性：${escapeHtml(item.fields['一致性结论'])} · 证据来源：${escapeHtml(item.fields['证据来源'])}</small>`).join('')}</section><section><h2>风险项</h2>${ownRisks.length ? ownRisks.map((item) => `<h3 class="${['高', '严重'].includes(text(item.fields['风险等级'])) ? 'risk-high' : ''}">${escapeHtml(item.fields['风险等级'])} · ${escapeHtml(item.fields['风险标题'])}</h3><p>${escapeHtml(item.fields['风险说明'])}</p><small>${escapeHtml(item.fields['证据摘要'])}</small>`).join('') : '<p>当前未记录风险项，不代表不存在风险。</p>'}</section></html>`
    const fileName = `${text(row.fields['背调编号'])}-${text(candidate?.fields['姓名']) || '候选人'}-v${version}.html`
    const uploaded = await storage.upload(`background-checks/${backgroundId}/reports/${fileName}`, 'text/html; charset=utf-8', Buffer.from(html))
    await teable.updateRecord(this.table('recruitment_background_checks'), row.id, { 报告地址: uploaded.cdnUrl, 报告文件名: fileName, 报告版本: version, 背调状态: '待结论确认', 更新时间: generatedAt })
    await this.event(backgroundId, text(row.fields['候选人ID']), text(row.fields['背调状态']), '待结论确认', '生成背调报告', `生成第${version}版报告`, { fileUrl: uploaded.cdnUrl }, body.operator)
    return { backgroundId, version, fileName, fileUrl: uploaded.cdnUrl, status: '待结论确认' }
  }

  async conclude(backgroundId: string, input: BackgroundConclusionInput) {
    if (!text(input.opinion)) throw new BadRequestException('人工确认意见不能为空')
    const row = await this.find(backgroundId)
    if (!text(row.fields['报告地址'])) throw new ConflictException('生成背调报告后才能确认结论')
    const statusMap: Record<string, string> = { '通过': '已通过', '有条件通过': '异常待决策', '异常待决策': '异常待决策', '终止录用': '已终止' }
    const next = statusMap[input.conclusion], timestamp = now()
    await teable.updateRecord(this.table('recruitment_background_checks'), row.id, { 背调结论: input.conclusion, 结论摘要: input.opinion, 人工确认状态: '已确认', 确认人用户ID: text(input.operatorUserId), 确认人: text(input.operator) || '当前用户', 确认时间: timestamp, 确认意见: input.opinion, 背调状态: next, 完成时间: ['已通过', '已终止'].includes(next) ? timestamp : '', 更新时间: timestamp })
    const applications = await teable.listAllRecords(this.table('recruitment_applications'))
    const application = applications.find((item) => text(item.fields['应聘记录ID']) === text(row.fields['应聘记录ID']))
    if (application) {
      const oldStage = text(application.fields['当前阶段']) || '背调'
      const stage = input.conclusion === '通过' ? '待入职' : input.conclusion === '终止录用' ? '已终止' : '背调异常待决策'
      await teable.updateRecord(this.table('recruitment_applications'), application.id, { 当前阶段: stage, 当前状态: input.conclusion === '终止录用' ? '已结束' : '进行中', 最近处理时间: timestamp, 流程结束时间: input.conclusion === '终止录用' ? timestamp : '', 更新时间: timestamp })
      await teable.createRecord(this.table('recruitment_stage_events'), {
        事件ID: id('evt'), 应聘记录ID: text(application.fields['应聘记录ID']) || application.id, 候选人ID: text(row.fields['候选人ID']),
        职位ID: text(application.fields['职位ID']), 原阶段: oldStage, 新阶段: stage, 操作: '确认背调结论', 结果: input.conclusion,
        原因: input.opinion, 操作人用户ID: text(input.operatorUserId), 操作人: text(input.operator) || '当前用户', 发生时间: timestamp,
        来源类型: '背调', 来源记录ID: backgroundId, 扩展信息JSON: JSON.stringify({ reportUrl: text(row.fields['报告地址']), riskLevel: text(row.fields['风险等级']) }),
      })
    }
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find((item) => text(item.fields['候选人ID']) === text(row.fields['候选人ID']))
    if (candidate) await teable.updateRecord(this.table('recruitment_candidates'), candidate.id, { 候选人状态: input.conclusion === '通过' ? '待入职' : input.conclusion === '终止录用' ? '已终止' : '背调异常待决策', 更新时间: timestamp })
    await this.event(backgroundId, text(row.fields['候选人ID']), text(row.fields['背调状态']), next, '人工确认结论', input.opinion, { conclusion: input.conclusion }, input.operator, input.operatorUserId)
    await this.audit('确认背调结论', '背调', backgroundId, row.fields, { conclusion: input.conclusion, status: next }, input.operator)
    return { backgroundId, conclusion: input.conclusion, status: next, targetStage: input.conclusion === '通过' ? '待入职' : input.conclusion === '终止录用' ? '已终止' : '背调异常待决策' }
  }

  private async find(backgroundId: string) {
    const rows = await teable.listAllRecords(this.table('recruitment_background_checks'))
    const row = rows.find((item) => text(item.fields['背调ID']) === backgroundId || item.id === backgroundId)
    if (!row) throw new NotFoundException('背调任务不存在')
    return row
  }
  private async touch(row: TeableRecord, status: string) { await teable.updateRecord(this.table('recruitment_background_checks'), row.id, { 背调状态: status, 更新时间: now() }) }
  private async event(backgroundId: string, candidateId: string, from: string, to: string, type: string, note: string, extra: unknown, operator?: string, operatorUserId?: string) {
    await teable.createRecord(this.table('recruitment_background_events'), { 背调事件ID: id('bgevent'), 背调ID: backgroundId, 候选人ID: candidateId, 原状态: from, 新状态: to, 事件类型: type, 事件说明: note, 扩展信息JSON: JSON.stringify(extra || {}), 操作人用户ID: text(operatorUserId), 操作人: text(operator) || '当前用户', 发生时间: now() })
  }
  private mapCheck(row: TeableRecord, candidate?: TeableRecord, contacts: TeableRecord[] = [], verifications: TeableRecord[] = [], risks: TeableRecord[] = [], events: TeableRecord[] = []) {
    return {
      id: text(row.fields['背调ID']) || row.id, number: text(row.fields['背调编号']), candidateId: text(row.fields['候选人ID']), candidateName: text(candidate?.fields['姓名']),
      applicationId: text(row.fields['应聘记录ID']), offerId: text(row.fields['OfferID']), status: text(row.fields['背调状态']), authorizationStatus: text(row.fields['授权状态']), authorizationMethod: text(row.fields['授权方式']),
      scopes: json<string[]>(row.fields['核验范围JSON'], []), provider: text(row.fields['外部服务商']), externalTaskId: text(row.fields['外部任务ID']), syncStatus: text(row.fields['外部同步状态']), syncError: text(row.fields['外部错误信息']), packageId: text(row.fields['八方套餐ID']), packageName: text(row.fields['八方套餐名称']), externalStatus: text(row.fields['八方订单状态']), externalReportResult: text(row.fields['八方报告结果']), externalReportType: text(row.fields['八方报告类型']), externalReportSyncedAt: text(row.fields['八方报告同步时间']),
      riskLevel: text(row.fields['风险等级']), conclusion: text(row.fields['背调结论']), conclusionSummary: text(row.fields['结论摘要']), reportUrl: text(row.fields['报告地址']), reportName: text(row.fields['报告文件名']), reportVersion: num(row.fields['报告版本']),
      humanStatus: text(row.fields['人工确认状态']), confirmer: text(row.fields['确认人']), confirmedAt: text(row.fields['确认时间']), updatedAt: text(row.fields['更新时间']),
      contacts: contacts.map((item) => ({ id: text(item.fields['背调联系人ID']), name: text(item.fields['联系人姓名']), relationship: text(item.fields['与候选人关系']), company: text(item.fields['公司名称']), role: text(item.fields['职位']), phone: text(item.fields['电话']), email: text(item.fields['邮箱']), status: text(item.fields['核验状态']), note: text(item.fields['联系备注']) })),
      verifications: verifications.map((item) => ({ id: text(item.fields['核验项ID']), type: text(item.fields['核验类型']), company: text(item.fields['公司名称']), role: text(item.fields['任职岗位']), result: text(item.fields['核验结果']), leavingReason: text(item.fields['离职原因']), performance: text(item.fields['工作表现']), managementPerformance: text(item.fields['带队与管理表现']), consistency: text(item.fields['一致性结论']), evidenceSource: text(item.fields['证据来源']), verifiedAt: text(item.fields['核验时间']) })),
      risks: risks.map((item) => ({ id: text(item.fields['风险项ID']), type: text(item.fields['风险类型']), level: text(item.fields['风险等级']), title: text(item.fields['风险标题']), description: text(item.fields['风险说明']), evidenceSummary: text(item.fields['证据摘要']), attachments: json<any[]>(item.fields['证据附件JSON'], []), status: text(item.fields['处理状态']) })),
      events: events.sort((a, b) => text(b.fields['发生时间']).localeCompare(text(a.fields['发生时间']))).map((item) => ({ id: text(item.fields['背调事件ID']), type: text(item.fields['事件类型']), from: text(item.fields['原状态']), to: text(item.fields['新状态']), note: text(item.fields['事件说明']), operator: text(item.fields['操作人']), time: text(item.fields['发生时间']) })),
    }
  }
  private async audit(action: string, type: string, objectId: string, before: unknown, after: unknown, operator?: string) {
    await teable.createRecord(this.table('recruitment_audit_logs'), { 日志ID: id('audit'), 操作人: text(operator) || '当前用户', 操作类型: action, 对象类型: type, 对象ID: objectId, 修改前摘要JSON: JSON.stringify(before), 修改后摘要JSON: JSON.stringify(after), 请求ID: id('req'), 发生时间: now(), 操作结果: '成功', 错误信息: '' })
  }
}
