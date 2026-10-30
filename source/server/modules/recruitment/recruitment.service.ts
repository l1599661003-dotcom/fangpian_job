import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, Optional, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { appFlowUrl } from '../../platform/app-links'
import { llm } from '../../platform/llm'
import { teable, TeableRecord } from '../../platform/teable'
import { ReadCache } from '../../platform/read-cache'
import { DatabaseService } from '../database/database.service'
import type { RoleAccessProfile } from '../database/role-access.service'
import { MessagesService } from '../messages/messages.service'
import { loadCompanyPositionCatalog } from './company-position-catalog'
import { buildDailyHiringActivity } from './daily-hiring-activity'
import { CollectionTaskInput, CollectionTaskProgressInput, MonthlyDemandInput, MonthlyDemandTranscriptExtraction, PositionChannelBindingInput, PositionInput, RecruitmentChannelInput } from './recruitment.types'

const companyCalendar = require('../../company-calendar.js') as {
  dateKey(value: Date | number | string): string
  monthForDate(value: Date | number | string): string
  monthRange(month: string): { start: string; end: string; startDate: string; endDate: string } | null
  isCompanyMonth(month: string): boolean
}
const timestamp = () => new Date().toISOString()
const businessId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
const normalizeHiringPriority = (value: unknown) => ({ 高: '紧急', 中: '重要', 低: '储备', 一般: '储备' }[String(value ?? '').trim()] || String(value ?? '').trim() || '储备')
const text = (value: unknown) => String(value ?? '').trim()
const recruitmentApproverUserId = 'wozR29DwAACxXU8MVtW44tVUZ4ZMF0qg'
const recruitmentApproverWechatId = 'LiSiQi'
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const currentShanghaiMonth = () => companyCalendar.monthForDate(Date.now())
const DAY_MS = 24 * 60 * 60 * 1000
const shanghaiMonthRange = (month: string) => {
  const range = companyCalendar.monthRange(month)
  if (!range) throw new BadRequestException('月份格式必须是有效的 YYYY-MM')
  return {
    from: Date.parse(range.start),
    to: Date.parse(range.end),
  }
}
const datePrefixesInRange = (from: number, to: number, granularity: 'day' | 'month') => {
  const prefixes = new Set<string>()
  for (let cursor = Math.floor(from / DAY_MS) * DAY_MS; cursor < to; cursor += DAY_MS) {
    const isoDate = new Date(cursor).toISOString()
    prefixes.add(granularity === 'month' ? `${isoDate.slice(0, 7)}-` : isoDate.slice(0, 10))
  }
  return [...prefixes]
}
const companyDatePrefixesInRange = (from: number, to: number, granularity: 'day' | 'month') => {
  const prefixes = new Set<string>()
  for (let cursor = from; cursor < to; cursor += DAY_MS) {
    const date = companyCalendar.dateKey(cursor)
    prefixes.add(granularity === 'month' ? `${date.slice(0, 7)}-` : date)
  }
  return [...prefixes]
}
const prefixFilter = (field: string, prefixes: string[]) => prefixes.map((prefix) => `{${field}} LIKE "${prefix}%"`).join(' OR ')
const json = <T>(value: unknown, fallback: T): T => {
  try { return value ? JSON.parse(String(value)) as T : fallback } catch { return fallback }
}
const compact = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
const normalizeDepartmentName = (value: unknown) => text(value).normalize('NFKC').replace(/\s+/g, '').replace(/(事业部|部门|中心|部)$/, '')
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
})

@Injectable()
export class RecruitmentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecruitmentService.name)
  private readonly verifiedFields = new Map<string, Set<string>>()
  private readonly approvalNotificationLocks = new Set<string>()
  private overviewCache = new Map<string, { expiresAt: number; value: any }>()
  private tableCache = new Map<string, { expiresAt: number; promise: Promise<TeableRecord[]> }>()
  private monthlyHiringCache = new ReadCache(25)
  private monthlyDemandCache?: { expiresAt: number; value: any }

  private cachedTable(name: string, ttlMs: number, loader: () => Promise<TeableRecord[]>): Promise<TeableRecord[]> {
    const entry = this.tableCache.get(name)
    if (entry && entry.expiresAt > Date.now()) return entry.promise
    const promise = loader().catch((error) => { this.tableCache.delete(name); throw error })
    this.tableCache.set(name, { expiresAt: Date.now() + ttlMs, promise })
    return promise
  }

  private invalidateTables(names: string[]) {
    for (const name of names) this.tableCache.delete(name)
    for (const key of this.tableCache.keys()) if (key.startsWith('hiring-')) this.tableCache.delete(key)
  }

  constructor(private readonly database: DatabaseService, @Optional() private readonly messages?: MessagesService) {}

  private hasAllPositionAccess(profile?: RoleAccessProfile) {
    return !profile || profile.roleCodes.includes('system_admin') || profile.dataScopes.some((scope) => scope.type === 'all')
  }

  private positionScopeKey(profile?: RoleAccessProfile) {
    if (this.hasAllPositionAccess(profile)) return 'all'
    return profile?.userId ? `user:${profile.userId}` : 'none'
  }

  private async employeePositionScope(profile: RoleAccessProfile) {
    const [users, organizations] = await Promise.all([
      teable.listByField(this.table('recruitment_users'), '用户ID', profile.userId, 2),
      this.cachedTable('recruitment_organization_units', 30_000, () => teable.listAllRecords(this.table('recruitment_organization_units'))),
    ])
    const employee = users.find(row => text(row.fields['用户ID']) === profile.userId)
    if (!employee || !['启用', ''].includes(text(employee.fields['用户状态']))) return { departmentIds: new Set<string>(), departmentNames: new Set<string>() }

    const organizationById = new Map(organizations.map(row => [text(row.fields['组织单元ID']) || row.id, row]))
    const departmentIds = new Set(json<string[]>(employee.fields['部门IDJSON'], []).slice(0, 1).map(text).filter(Boolean))
    const departmentNames = new Set(json<string[]>(employee.fields['部门JSON'], []).slice(0, 1).map(normalizeDepartmentName).filter(Boolean))
    if (!departmentIds.size) {
      for (const name of departmentNames) {
        const matches = organizations.filter(row => normalizeDepartmentName(row.fields['组织名称']) === name && text(row.fields['组织状态']) !== '停用')
        if (matches.length === 1) departmentIds.add(text(matches[0].fields['组织单元ID']) || matches[0].id)
      }
    }
    if (!departmentIds.size) return { departmentIds, departmentNames: new Set<string>() }

    const ownDepartmentIds = new Set(departmentIds)
    if ([...ownDepartmentIds].some(id => text(organizationById.get(id)?.fields['组织类型']) === '公司' || text(organizationById.get(id)?.fields['组织名称']) === '方片')) {
      return { departmentIds: new Set<string>(), departmentNames: new Set<string>() }
    }
    let previousSize = -1
    while (previousSize !== departmentIds.size) {
      previousSize = departmentIds.size
      for (const row of organizations) {
        const id = text(row.fields['组织单元ID']) || row.id
        if (departmentIds.has(text(row.fields['上级组织单元ID']))) departmentIds.add(id)
      }
    }
    for (const ownId of ownDepartmentIds) {
      let current = organizationById.get(ownId)
      const visited = new Set<string>()
      while (current) {
        const currentId = text(current.fields['组织单元ID']) || current.id
        if (visited.has(currentId)) break
        visited.add(currentId)
        if (text(current.fields['组织类型']) === '公司' || text(current.fields['组织名称']) === '方片') break
        departmentIds.add(currentId)
        const parentId = text(current.fields['上级组织单元ID'])
        if (!parentId) break
        current = organizationById.get(parentId)
      }
    }
    for (const row of organizations) {
      const id = text(row.fields['组织单元ID']) || row.id
      if (departmentIds.has(id)) {
        const name = normalizeDepartmentName(row.fields['组织名称'])
        if (name) departmentNames.add(name)
      }
    }
    return { departmentIds, departmentNames }
  }

  private async filterPositionRows(rows: TeableRecord[], profile?: RoleAccessProfile, scopeMode: 'employee' | 'role' = 'employee') {
    if (this.hasAllPositionAccess(profile)) return rows
    const departmentIds = new Set((profile?.dataScopes || []).flatMap((scope) => scope.departmentIds || []).map(text).filter(Boolean))
    let departmentNames = new Set<string>()
    let organizationById = new Map<string, TeableRecord>()
    if (scopeMode === 'employee' && profile?.userId) {
      const scope = await this.employeePositionScope(profile)
      departmentIds.clear()
      scope.departmentIds.forEach(id => departmentIds.add(id))
      departmentNames = scope.departmentNames
      if (!departmentIds.size) return []
      const organizations = await this.cachedTable('recruitment_organization_units', 30_000, () => teable.listAllRecords(this.table('recruitment_organization_units')))
      organizationById = new Map(organizations.map(row => [text(row.fields['组织单元ID']) || row.id, row]))
    } else {
      if (!departmentIds.size) return []
      const organizations = await this.cachedTable('recruitment_organization_units', 30_000, () => teable.listAllRecords(this.table('recruitment_organization_units')))
      organizationById = new Map(organizations.map(row => [text(row.fields['组织单元ID']) || row.id, row]))
      departmentNames = new Set(organizations
        .filter((row) => departmentIds.has(text(row.fields['组织单元ID']) || row.id))
        .map((row) => normalizeDepartmentName(row.fields['组织名称']))
        .filter(Boolean))
    }
    return rows.filter((row) => {
      const positionDepartmentId = text(row.fields['部门ID'])
      if (positionDepartmentId && departmentIds.has(positionDepartmentId)) return true
      const positionDepartmentRow = positionDepartmentId ? organizationById.get(positionDepartmentId) : undefined
      const positionDepartment = normalizeDepartmentName(positionDepartmentRow?.fields['组织名称'] || row.fields['部门'])
      return Boolean(positionDepartment && departmentNames.has(positionDepartment))
    })
  }

  async positionOptions(_profile?: RoleAccessProfile) {
    const rows = await this.filterPositionRows(await this.cachedTable('recruitment_positions', 30_000, () => teable.listAllRecords(this.table('recruitment_positions'))), _profile)
    return {
      positions: rows.map((row) => ({
        id: text(row.fields['职位ID']) || row.id,
        name: text(row.fields['职位名称']),
        departmentId: text(row.fields['部门ID']),
        department: text(row.fields['部门']),
        location: text(row.fields['工作地点']),
        status: text(row.fields['发布状态']) || '待发布',
        recruitmentStatus: text(row.fields['招聘状态']) || '待启动',
      })).sort((left, right) => left.department.localeCompare(right.department, 'zh-CN') || left.name.localeCompare(right.name, 'zh-CN')),
    }
  }

  async departmentDemandScope(profile: RoleAccessProfile) {
    const [users, organizations] = await Promise.all([
      teable.listByField(this.table('recruitment_users'), '用户ID', profile.userId, 2),
      teable.listAllRecords(this.table('recruitment_organization_units')),
    ])
    const user = users[0]
    if (!user || !['启用', ''].includes(text(user.fields['用户状态']))) throw new ForbiddenException('当前员工账号不可用，请联系管理员确认')
    const ids = new Set(json<string[]>(user.fields['部门IDJSON'], []).map(text).filter(Boolean))
    if (!ids.size) {
      for (const name of json<string[]>(user.fields['部门JSON'], [])) {
        const matches = organizations.filter(row => text(row.fields['组织名称']) === text(name))
        if (matches.length === 1) ids.add(text(matches[0].fields['组织单元ID']) || matches[0].id)
      }
    }
    if (!ids.size) throw new ForbiddenException('当前账号尚未绑定部门，请联系管理员配置后重试')
    let previousSize = -1
    while (previousSize !== ids.size) {
      previousSize = ids.size
      for (const row of organizations) if (ids.has(text(row.fields['上级组织单元ID']))) ids.add(text(row.fields['组织单元ID']) || row.id)
    }
    const authorized = new Set(profile.dataScopes.flatMap(scope => scope.departmentIds || []).map(text).filter(Boolean))
    if (profile.roleCodes.includes('department_leader')) {
      let previousAuthorizedSize = -1
      while (previousAuthorizedSize !== authorized.size) {
        previousAuthorizedSize = authorized.size
        for (const row of organizations) {
          const parentId = text(row.fields['上级组织单元ID'])
          const departmentId = text(row.fields['组织单元ID']) || row.id
          if (parentId && authorized.has(parentId) && departmentId) authorized.add(departmentId)
        }
      }
    }
    const departmentIds = [...ids].filter(id => this.hasAllPositionAccess(profile) || authorized.has(id))
    if (!departmentIds.length) throw new ForbiddenException('当前账号没有所属部门的岗位查看权限，请联系管理员授权')
    const scopedProfile: RoleAccessProfile = { ...profile, roleCodes: [], dataScopes: [{ roleCode: 'department_demand', type: 'assigned_departments', businessUnitId: '', departmentIds }] }
    return { profile: scopedProfile, departments: organizations.filter(row => departmentIds.includes(text(row.fields['组织单元ID']) || row.id)).map(row => ({ id: text(row.fields['组织单元ID']) || row.id, name: text(row.fields['组织名称']) })) }
  }

  async departmentDemandWorkbench(monthInput: string, profile: RoleAccessProfile) {
    const month = text(monthInput) || currentShanghaiMonth()
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('请选择有效的需求月份')
    const scope = await this.departmentDemandScope(profile)
    const [positions, applications, demands] = await Promise.all([
      this.cachedTable('recruitment_positions', 30_000, () => teable.listAllRecords(this.table('recruitment_positions'))),
      this.cachedTable('recruitment_applications', 15_000, () => teable.listAllRecords(this.table('recruitment_applications'))),
      this.listMonthlyDemands(month, '', scope.profile, 'role'),
    ])
    const scoped = await this.filterPositionRows(positions, scope.profile, 'role')
    return { month, departments: scope.departments, positions: scoped.map(row => this.mapPosition(row, [], applications)), demands: demands.demands }
  }

  async pauseDepartmentDemand(positionId: string, reason: string, operator: string, profile: RoleAccessProfile) {
    const scope = await this.departmentDemandScope(profile)
    const { row } = await this.assertPositionAccess(positionId, scope.profile, 'role')
    if (text(row.fields['发布状态']) === '已下线') return { positionId, status: '已下线', unchanged: true }
    if (text(row.fields['发布状态']) !== '招聘中') throw new BadRequestException('只有在招岗位可以暂停招聘')
    return this.changePositionStatus(positionId, '已下线', reason, operator)
  }

  async assertPositionAccess(positionId: string, profile?: RoleAccessProfile, scopeMode: 'employee' | 'role' = 'employee') {
    if (!text(positionId)) throw new BadRequestException('请选择岗位')
    const tableId = await this.verify('recruitment_positions', ['职位ID', '职位名称', '部门ID', '部门'])
    const row = (await teable.listAllRecords(tableId)).find((item) => text(item.fields['职位ID']) === text(positionId) || item.id === text(positionId))
    if (!row) throw new NotFoundException('岗位不存在')
    const visible = await this.filterPositionRows([row], profile, scopeMode)
    if (!visible.length) throw new ForbiddenException('只能选择或操作所属部门的岗位')
    return {
      row,
      position: {
        id: text(row.fields['职位ID']) || row.id,
        name: text(row.fields['职位名称']),
        departmentId: text(row.fields['部门ID']),
        department: text(row.fields['部门']),
        location: text(row.fields['工作地点']),
      },
    }
  }

  private async departmentForAccess(value: unknown, operator: string, profile?: RoleAccessProfile) {
    const name = text(value)
    if (this.hasAllPositionAccess(profile)) return this.ensureDepartment(name, operator)
    const allowedDepartmentIds = new Set((profile?.dataScopes || []).flatMap((scope) => scope.departmentIds || []).map(text).filter(Boolean))
    const rows = await teable.listAllRecords(this.table('recruitment_organization_units'))
    const department = rows.find((row) => text(row.fields['组织类型']) === '部门'
      && normalizeDepartmentName(row.fields['组织名称']) === normalizeDepartmentName(name)
      && allowedDepartmentIds.has(text(row.fields['组织单元ID']) || row.id))
    if (!department) throw new ForbiddenException('只能选择所属部门')
    return { id: text(department.fields['组织单元ID']) || department.id, name: text(department.fields['组织名称']) || name }
  }

  onApplicationBootstrap() {
    void this.publishExistingDemandPositions()
      .then((result) => {
        if (result.published) this.logger.log(`已有招聘需求岗位自动发布完成：发布 ${result.published} 个，跳过 ${result.skipped} 个`)
      })
      .catch((error) => this.logger.error(`已有招聘需求岗位自动发布失败：${error instanceof Error ? error.message : String(error)}`))
    void this.retryPendingRecruitmentApprovalNotifications()
      .then((result) => {
        if (result.scanned) this.logger.log(`岗位审批通知补发完成：检查 ${result.scanned} 条，成功 ${result.sent} 条，失败 ${result.failed} 条`)
      })
      .catch((error) => this.logger.error(`岗位审批通知补发失败：${error instanceof Error ? error.message : String(error)}`))
  }

  async publishExistingDemandPositions() {
    const demandTableId = await this.verify('recruitment_monthly_demands', ['需求月份', '职位ID', '需求数量', '需求状态', '审批状态'])
    const positionTableId = await this.verify('recruitment_positions', ['职位ID', '发布状态', '招聘状态', '发布时间', '下线时间', '更新时间'])
    const [demands, positions] = await Promise.all([teable.listAllRecords(demandTableId), teable.listAllRecords(positionTableId)])
    const currentMonth = currentShanghaiMonth()
    const eligiblePositionIds = new Set(demands.filter((row) => {
      const approvalStatus = text(row.fields['审批状态'])
      const demandStatus = text(row.fields['需求状态'])
      return text(row.fields['需求月份']) >= currentMonth
        && number(row.fields['需求数量']) > 0
        && approvalStatus !== '已驳回'
        && !['审批驳回', '已停用'].includes(demandStatus)
    }).map((row) => text(row.fields['职位ID'])).filter(Boolean))
    const now = timestamp()
    const result = { scanned: eligiblePositionIds.size, published: 0, skipped: 0 }
    for (const positionId of eligiblePositionIds) {
      const position = positions.find((row) => text(row.fields['职位ID']) === positionId || row.id === positionId)
      if (!position || (text(position.fields['发布状态']) || '待发布') !== '待发布') { result.skipped += 1; continue }
      const fields = { 发布状态: '招聘中', 招聘状态: '招聘中', 发布时间: text(position.fields['发布时间']) || now, 下线时间: '', 更新时间: now }
      await teable.updateRecord(positionTableId, position.id, fields)
      this.auditAsync('已有需求自动发布岗位', '职位', positionId, position.fields, fields, '系统', '已有有效招聘需求，无需人工发布')
      result.published += 1
    }
    if (result.published) {
      this.overviewCache.clear()
      this.monthlyHiringCache.clear()
      this.invalidateTables(['recruitment_positions'])
    }
    return result
  }

  private async publishPositionFromDemand(positionId: string, operator: string, reason = '存在有效招聘需求') {
    if (!positionId) return false
    const tableId = await this.verify('recruitment_positions', ['职位ID', '发布状态', '招聘状态', '发布时间', '下线时间', '更新时间'])
    const row = await this.find(tableId, '职位ID', positionId, '需求关联岗位不存在')
    if (text(row.fields['发布状态']) === '招聘中') return false
    const now = timestamp()
    const fields = { 发布状态: '招聘中', 招聘状态: '招聘中', 发布时间: now, 下线时间: '', 更新时间: now }
    await teable.updateRecord(tableId, row.id, fields)
    this.overviewCache.clear()
    this.monthlyHiringCache.clear()
    this.invalidateTables(['recruitment_positions'])
    this.auditAsync('招聘需求自动开放岗位', '职位', positionId, row.fields, fields, operator, reason)
    return true
  }

  private table(name: string) {
    return this.database.requireTableId(name)
  }

  private async verify(name: string, required: string[]) {
    const alreadyVerified = this.verifiedFields.get(name) || new Set<string>()
    if (required.every((field) => alreadyVerified.has(field))) return this.table(name)
    const tableId = this.table(name)
    const fields = await teable.listFields(tableId)
    const available = new Set(fields.map((field) => field.name))
    const missing = required.filter((field) => !available.has(field))
    if (missing.length) throw new Error(`${name} 缺少字段：${missing.join('、')}`)
    this.verifiedFields.set(name, new Set([...alreadyVerified, ...required]))
    return tableId
  }

  async positionCatalog(profile?: RoleAccessProfile) {
    const rows = await this.filterPositionRows(await teable.listAllRecords(this.table('recruitment_positions')), profile)
    return { positions: rows.map((row) => {
      const { arrived, remainingHeadcount, acceptedCount, applicantCount, collectionTaskCount, latestCollectionStatus, ...position } = this.mapPosition(row, [], [])
      return position
    }) }
  }

  async overview(profile?: RoleAccessProfile) {
    const cacheKey = this.positionScopeKey(profile)
    const cached = this.overviewCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const [positions, tasks, applications, channels, channelBindings, resumes, interviews, offers, onboardings] = await Promise.all([
      this.cachedTable('recruitment_positions', 30_000, () => teable.listAllRecords(this.table('recruitment_positions'))),
      this.cachedTable('recruitment_collection_tasks', 10_000, () => teable.listAllRecords(this.table('recruitment_collection_tasks'))),
      this.cachedTable('recruitment_applications', 15_000, () => teable.listAllRecords(this.table('recruitment_applications'))),
      this.cachedTable('recruitment_channels', 30_000, () => teable.listAllRecords(this.table('recruitment_channels'))),
      this.cachedTable('recruitment_position_channels', 30_000, () => teable.listAllRecords(this.table('recruitment_position_channels'))),
      this.cachedTable('resume_extraction_records', 15_000, () => teable.listAllRecords(this.table('resume_extraction_records'))),
      this.cachedTable('recruitment_interviews', 15_000, () => teable.listAllRecords(this.table('recruitment_interviews'))),
      this.cachedTable('recruitment_offers', 15_000, () => teable.listAllRecords(this.table('recruitment_offers'))),
      this.cachedTable('recruitment_onboarding_cases', 30_000, () => teable.listAllRecords(this.table('recruitment_onboarding_cases'))),
    ])
    const scopedPositions = await this.filterPositionRows(positions, profile)
    const positionIds = new Set(scopedPositions.map((row) => text(row.fields['职位ID']) || row.id))
    const scopedApplications = applications.filter((row) => positionIds.has(text(row.fields['职位ID'])))
    const candidateIds = new Set(scopedApplications.map((row) => text(row.fields['候选人ID'])).filter(Boolean))
    const scopedTasks = tasks.filter((row) => positionIds.has(text(row.fields['职位ID'])))
    const scopedBindings = channelBindings.filter((row) => positionIds.has(text(row.fields['职位ID'])))
    const scopedResumes = this.hasAllPositionAccess(profile) ? resumes : resumes.filter((row) => candidateIds.has(text(row.fields['候选人ID'])))
    const scopedInterviews = this.hasAllPositionAccess(profile) ? interviews : interviews.filter((row) => positionIds.has(text(row.fields['职位ID'])) || candidateIds.has(text(row.fields['候选人ID'])))
    const scopedOffers = this.hasAllPositionAccess(profile) ? offers : offers.filter((row) => positionIds.has(text(row.fields['职位ID'])) || candidateIds.has(text(row.fields['候选人ID'])))
    const scopedOnboardings = this.hasAllPositionAccess(profile) ? onboardings : onboardings.filter((row) => positionIds.has(text(row.fields['职位ID'])) || candidateIds.has(text(row.fields['候选人ID'])))
    const positionItems = scopedPositions.map((row) => this.mapPosition(row, scopedTasks, scopedApplications))
    const openPositions = positionItems.filter((item) => item.status === '招聘中')
    const value = {
      positions: positionItems,
      collectionTasks: scopedTasks.map((row) => this.mapTask(row)),
      channels: channels.map((row) => this.mapChannel(row)),
      channelBindings: scopedBindings.map((row) => this.mapChannelBinding(row)),
      overview: {
        openPositions: openPositions.length,
        totalHeadcount: openPositions.reduce((sum, item) => sum + item.headcount, 0),
        remainingHeadcount: openPositions.reduce((sum, item) => sum + Math.max(0, item.headcount - item.arrived), 0),
        activePositions: positionItems.filter((item) => item.status === '招聘中').length,
        pendingCollectionTasks: scopedTasks.filter((row) => ['待触发', '待对接RPA', '执行中'].includes(text(row.fields['任务状态']))).length,
      },
      dashboard: {
        openPositions: openPositions.length,
        parsedResumes: scopedResumes.filter((row) => text(row.fields['解析状态']) === '已完成').length,
        interviews: scopedInterviews.filter((row) => text(row.fields['面试状态']) !== '已取消').length,
        issuedOffers: scopedOffers.filter((row) => !['草稿', '审批驳回', '已拒绝'].includes(text(row.fields['Offer状态']))).length,
        onboarded: new Set(scopedOnboardings.filter((row) => text(row.fields['实际到岗日期'])).map((row) => text(row.fields['候选人ID']) || row.id)).size,
        generatedAt: timestamp(),
      },
    }
    this.overviewCache.set(cacheKey, { expiresAt: Date.now() + 15_000, value })
    return value
  }

  /** 首页按日、周或公司月统计招聘动态，并返回目标公司的月度岗位达成。 */
  async monthlyHiring(monthInput = '', profile?: RoleAccessProfile, periodInput = 'day') {
    const month = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : currentShanghaiMonth()
    const period = ['day', 'week', 'month'].includes(periodInput) ? periodInput : 'day'
    const cacheKey = `${month}:${period}:${this.positionScopeKey(profile)}`
    return this.monthlyHiringCache.get(cacheKey, 30_000,
      ['recruitment_monthly_demands', 'recruitment_positions', 'recruitment_applications', 'recruitment_interviews', 'recruitment_offers', 'recruitment_candidates', 'resume_extraction_records', 'recruitment_resume_versions', 'recruitment_onboarding_cases', 'recruitment_users', 'recruitment_organization_units'].map(name => this.table(name)),
      () => this.loadMonthlyHiring(month, profile, period))
  }

  private async loadMonthlyHiring(month: string, profile?: RoleAccessProfile, period: string = 'day') {
    const range = shanghaiMonthRange(month)

    const today = companyCalendar.dateKey(Date.now())
    const todayFrom = Date.parse(`${today}T00:00:00+08:00`)
    let activityFrom = todayFrom
    let activityTo = todayFrom + DAY_MS
    if (period === 'week') {
      const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay()
      const monday = new Date(Date.parse(`${today}T00:00:00Z`) - ((dayOfWeek + 6) % 7) * DAY_MS).toISOString().slice(0, 10)
      activityFrom = Date.parse(`${monday}T00:00:00+08:00`)
      activityTo = activityFrom + 7 * DAY_MS
    } else if (period === 'month') {
      activityFrom = range.from
      activityTo = range.to
    }
    const activityStartDate = companyCalendar.dateKey(activityFrom)
    const activityEndDate = companyCalendar.dateKey(activityTo - 1)
    const activityLabel = period === 'day' ? activityStartDate : `${activityStartDate} 至 ${activityEndDate}`
    const resumeDateFilter = prefixFilter('创建时间', datePrefixesInRange(activityFrom, activityTo, period === 'month' ? 'month' : 'day'))
    const onboardingPrefixes = companyDatePrefixesInRange(activityFrom, activityTo, period === 'month' ? 'month' : 'day')
    const onboardingFilter = period === 'day'
      ? `{实际到岗日期} = "${activityStartDate}"`
      : prefixFilter('实际到岗日期', onboardingPrefixes)
    const [demandRows, positions, applications, interviews, offers, candidates, resumes, resumeVersions, todayOnboardings, users, organizations] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_monthly_demands'), { filterByTql: `{需求月份} = "${month}"` }),
      teable.listAllRecords(this.table('recruitment_positions')),
      teable.listAllRecords(this.table('recruitment_applications'), { fields: ['候选人ID', '职位ID', '简历记录ID', '当前阶段', '更新时间', '创建时间'] }),
      teable.listAllRecords(this.table('recruitment_interviews'), { fields: ['面试ID', '候选人ID', '职位ID', '面试轮次', '面试方式', '开始时间', '面试地点', '会议地址', '面试官姓名JSON', '面试状态'] }),
      teable.listAllRecords(this.table('recruitment_offers'), { fields: ['OfferID', '候选人ID', '职位ID', 'Offer编号', '岗位名称', '部门', '发送时间', '发送状态'] }),
      teable.listAllRecords(this.table('recruitment_candidates'), { fields: ['候选人ID', '候选人状态', '姓名', '天玑入职日期'] }),
      teable.listAllRecords(this.table('resume_extraction_records'), { fields: ['候选人ID', '解析记录ID', '解析状态', '创建时间'] }),
      teable.listAllRecords(this.table('recruitment_resume_versions'), {
        filterByTql: resumeDateFilter,
        fields: ['候选人ID', '简历记录ID', '简历版本ID', '文件名', '文件地址', '来源类型', '解析状态', '创建人用户ID', '创建人', '创建时间'],
      }),
      teable.listAllRecords(this.table('recruitment_onboarding_cases'), {
        filterByTql: onboardingFilter,
        fields: ['候选人ID', '职位ID', '部门', '岗位', '实际到岗日期', '入职状态'],
      }),
      this.cachedTable('recruitment_users', 30_000, () => teable.listAllRecords(this.table('recruitment_users'), { fields: ['用户ID', '姓名', '部门IDJSON', '部门JSON', '用户状态'] })),
      this.cachedTable('recruitment_organization_units', 30_000, () => teable.listAllRecords(this.table('recruitment_organization_units'), { fields: ['组织单元ID', '组织类型', '组织名称', '上级组织单元ID', '组织状态'] })),
    ])
    const scopedPositions = await this.filterPositionRows(positions, profile)
    const allowedPositionIds = new Set(scopedPositions.map((row) => text(row.fields['职位ID']) || row.id))
    const scopedApplications = applications.filter((row) => allowedPositionIds.has(text(row.fields['职位ID'])))
    const scopedCandidateIds = new Set(scopedApplications.map((row) => text(row.fields['候选人ID'])).filter(Boolean))
    const scopedInterviews = this.hasAllPositionAccess(profile) ? interviews : interviews.filter((row) => allowedPositionIds.has(text(row.fields['职位ID'])) || scopedCandidateIds.has(text(row.fields['候选人ID'])))
    const scopedOffers = this.hasAllPositionAccess(profile) ? offers : offers.filter((row) => allowedPositionIds.has(text(row.fields['职位ID'])) || scopedCandidateIds.has(text(row.fields['候选人ID'])))
    const activeCandidates = candidates.filter((row) => text(row.fields['候选人状态']) !== '已删除' && (this.hasAllPositionAccess(profile) || scopedCandidateIds.has(text(row.fields['候选人ID']) || row.id)))
    const activeCandidateIds = new Set(activeCandidates.map((row) => text(row.fields['候选人ID']) || row.id))
    const hiringActivity = buildDailyHiringActivity({
      date: activityLabel,
      from: activityFrom,
      to: activityTo,
      resumeVersions,
      candidates: activeCandidates,
      interviews: scopedInterviews,
      offers: scopedOffers,
      onboardings: todayOnboardings,
      positions,
      users,
      organizations,
      allowedCandidateIds: scopedCandidateIds,
      allowedPositionIds,
      allAccess: this.hasAllPositionAccess(profile),
    })
    const scopedResumes = resumes.filter((row) => {
      const candidateId = text(row.fields['候选人ID'])
      return candidateId && activeCandidateIds.has(candidateId)
    })
    const candidateNamesById = new Map(activeCandidates.map((row) => [text(row.fields['候选人ID']) || row.id, text(row.fields['姓名']) || text(row.fields['候选人ID'])]))
    const positionId = (row: TeableRecord) => text(row.fields['职位ID'])
    const positionsById = new Map(scopedPositions.map((row) => [positionId(row) || row.id, row]))
    const isOpenPosition = (id: string) => text(positionsById.get(id)?.fields['发布状态']) === '招聘中' && text(positionsById.get(id)?.fields['招聘状态']) !== '暂停招聘'
    const monthDemands = demandRows.filter((row) => {
      if (text(row.fields['需求月份']) !== month || text(row.fields['需求状态']) === '已停用') return false
      const approvalStatus = text(row.fields['审批状态'])
      return number(row.fields['需求数量']) > 0
        && approvalStatus !== '已驳回'
        && text(row.fields['需求状态']) !== '审批驳回'
        && isOpenPosition(text(row.fields['职位ID']))
    })
    const inMonth = (value: unknown) => {
      const time = Date.parse(text(value))
      return Number.isFinite(time) && time >= range.from && time < range.to
    }
    const monthResumes = scopedResumes.filter((row) => text(row.fields['解析状态']) === '已完成' && inMonth(row.fields['创建时间'] || row.createdTime))
    const monthInterviews = scopedInterviews.filter((row) => inMonth(row.fields['开始时间']) && text(row.fields['面试状态']) !== '已取消')
    const monthOffers = scopedOffers.filter((row) => inMonth(row.fields['发送时间']) && !['', '待人工发送', '生成中', '生成失败', '发送失败'].includes(text(row.fields['发送状态'])))
    const demandPositionIds = new Set(monthDemands.map((row) => text(row.fields['职位ID'])).filter(Boolean))
    const applicationsByCandidate = new Map<string, TeableRecord[]>()
    for (const application of scopedApplications) {
      const candidateId = text(application.fields['候选人ID']), applicationPositionId = positionId(application)
      if (!candidateId || !demandPositionIds.has(applicationPositionId)) continue
      applicationsByCandidate.set(candidateId, [...(applicationsByCandidate.get(candidateId) || []), application])
    }
    const monthActualHires = activeCandidates.flatMap((candidate) => {
      const candidateId = text(candidate.fields['候选人ID']) || candidate.id
      if (!inMonth(candidate.fields['天玑入职日期'])) return []
      const application = (applicationsByCandidate.get(candidateId) || []).sort((left, right) => {
        const leftStage = text(left.fields['当前阶段']) === '已入职' ? 1 : 0, rightStage = text(right.fields['当前阶段']) === '已入职' ? 1 : 0
        return rightStage - leftStage || (text(right.fields['更新时间']) || text(right.fields['创建时间'])).localeCompare(text(left.fields['更新时间']) || text(left.fields['创建时间']))
      })[0]
      return application ? [{ candidateId, positionId: positionId(application), candidate }] : []
    })
    const monthOfferCandidatesByPosition = new Map<string, Set<string>>()
    for (const offer of monthOffers) {
      const candidateId = text(offer.fields['候选人ID'])
      const offerPositionId = positionId(offer)
      if (!candidateId || !offerPositionId || !activeCandidateIds.has(candidateId)) continue
      const candidates = monthOfferCandidatesByPosition.get(offerPositionId) || new Set<string>()
      candidates.add(candidateId)
      monthOfferCandidatesByPosition.set(offerPositionId, candidates)
    }

    const priorityAliases: Record<string, string> = { 高: '紧急', 中: '重要', 低: '储备', 一般: '储备' }
    const normalizePriority = (value: unknown) => priorityAliases[text(value)] || text(value) || '储备'
    const priorityRank = (value: unknown) => ({ 紧急: 0, 重要: 1, 储备: 2 }[normalizePriority(value)] ?? 3)
    const rows = new Map<string, { positionId: string; department: string; role: string; demand: number; completed: number; completedNames: Set<string>; status: string; priority: string; expectedArrivalDate: string; latestArrivalDate: string }>()
    const rowFor = (positionIdValue: string, department: string, role: string) => {
      const key = `${department}|${role}`
      if (!rows.has(key)) rows.set(key, { positionId: positionIdValue, department: department || '未分配部门', role: role || '未命名岗位', demand: 0, completed: 0, completedNames: new Set(), status: '进行中', priority: '储备', expectedArrivalDate: '', latestArrivalDate: '' })
      return rows.get(key)!
    }
    for (const row of monthDemands) {
      const position = positionsById.get(text(row.fields['职位ID']))
      const target = rowFor(
        text(row.fields['职位ID']),
        text(position?.fields['部门']) || text(row.fields['部门']),
        text(position?.fields['职位名称']) || text(row.fields['职位名称']),
      )
      target.demand += Math.max(0, Math.round(Number(row.fields['需求数量']) || 0))
      target.status = text(row.fields['需求状态']) || target.status
      for (const [key, field] of [['expectedArrivalDate', '期望到岗日期'], ['latestArrivalDate', '最晚到岗日期']] as const) {
        const date = text(row.fields[field])
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (!target[key] || date < target[key])) target[key] = date
      }
      const demandPriority = normalizePriority(row.fields['优先级'])
      if (priorityRank(demandPriority) < priorityRank(target.priority)) target.priority = demandPriority
    }
    for (const [offerPositionId, candidateIds] of monthOfferCandidatesByPosition) {
      const position = positionsById.get(offerPositionId)
      const target = rowFor(offerPositionId, text(position?.fields['部门']), text(position?.fields['职位名称']))
      target.completed += candidateIds.size
      for (const candidateId of candidateIds) target.completedNames.add(candidateNamesById.get(candidateId) || candidateId)
    }
    const departmentRows = [...rows.values()].filter((row) => row.demand > 0 || row.completed > 0)
      .map((row) => ({
        ...row,
        completedNames: [...row.completedNames],
        recruiter: text(positionsById.get(row.positionId)?.fields['招聘HR']),
        backupRecruiter: text(positionsById.get(row.positionId)?.fields['备用招聘HR']),
        remaining: Math.max(0, row.demand - row.completed),
        completionRate: row.demand > 0 ? Math.min(100, Math.round((row.completed / row.demand) * 100)) : 0,
        completedAll: row.demand > 0 && row.completed >= row.demand,
      }))
      .sort((left, right) => Number(left.completedAll) - Number(right.completedAll)
        || priorityRank(left.priority) - priorityRank(right.priority)
        || (!left.completedAll ? left.completed - right.completed : 0)
        || right.demand - left.demand
        || left.department.localeCompare(right.department, 'zh-CN')
        || left.role.localeCompare(right.role, 'zh-CN'))

    const value = {
      month,
      period,
      generatedAt: timestamp(),
      summary: {
        demand: departmentRows.reduce((sum, row) => sum + row.demand, 0),
        resumes: new Set(monthResumes.map((row) => text(row.fields['解析记录ID']) || row.id)).size,
        interviews: new Set(monthInterviews.map((row) => text(row.fields['候选人ID']) || row.id)).size,
        offers: new Set(monthOffers.map((row) => text(row.fields['候选人ID']) || row.id)).size,
        actualOffers: [...monthOfferCandidatesByPosition.values()].reduce((sum, candidates) => sum + candidates.size, 0),
        arrived: new Set(monthActualHires.map((row) => row.candidateId)).size,
      },
      hiringActivity,
      dailyHiring: hiringActivity,
      departments: departmentRows,
    }
    return value
  }

  /** 新增或更新某个月份的岗位招聘需求；同一岗位同一月份只保留一条需求记录。 */
  async extractMonthlyDemandTranscript(transcriptValue: string, profile?: RoleAccessProfile, timeoutMs = 30_000): Promise<{ extraction: MonthlyDemandTranscriptExtraction; source: 'ai'; availablePositions: number }> {
    const transcript = text(transcriptValue)
    if (!transcript) throw new BadRequestException('请先口述、粘贴或导入招聘需求内容')
    if (transcript.length > 20000) throw new BadRequestException('需求描述最多20000字')
    const rows = await this.filterPositionRows(await this.cachedTable('recruitment_positions', 30_000, () => teable.listAllRecords(this.table('recruitment_positions'))), profile, 'role')
    const positions = rows.map((row) => ({
      id: text(row.fields['职位ID']) || row.id,
      name: text(row.fields['职位名称']),
      department: text(row.fields['部门']),
    })).filter((item) => item.id && item.name)
    if (!positions.length) throw new BadRequestException('当前部门暂无可录入需求的岗位，请先联系管理员维护岗位库')
    const chinaToday = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const positionCatalog = positions.map((item) => `${item.name}（${item.department || '部门待补充'}）`).join('、')
    const currentMonth = currentShanghaiMonth()
    const currentMonthRange = companyCalendar.monthRange(currentMonth)
    const currentMonthContext = currentMonthRange
      ? `${currentMonth}${companyCalendar.isCompanyMonth(currentMonth) ? '公司月份' : '公历月份'}（${currentMonthRange.startDate}至${currentMonthRange.endDate}）`
      : currentMonth
    const nextMonth = currentMonthRange ? companyCalendar.monthForDate(currentMonthRange.end) : ''
    const nextMonthRange = nextMonth && companyCalendar.isCompanyMonth(nextMonth) ? companyCalendar.monthRange(nextMonth) : null
    const nextMonthContext = nextMonthRange
      ? `${nextMonth}（${nextMonthRange.startDate}至${nextMonthRange.endDate}）`
      : nextMonth ? `${nextMonth}（公司时间表未提供日期范围）` : '未能确定'
    const prompt = `你是招聘需求结构化助手。只从用户原话中提取明确事实，没有提到的字段必须返回空字符串或null，不要猜测、不要补默认值。\n今天是${chinaToday}（北京时间）。当前${currentMonthContext}；“本月”指当前月份，“月底前”按该期间的最后一天${currentMonthRange?.endDate || ''}理解；“下个月”按月份顺序指${nextMonthContext}。超出公司时间表已提供范围的日期不要自行推算，写入note提醒确认。\n当前用户有权限选择的岗位只有：${positionCatalog}。positionName只能从这个列表中选择最匹配的一项；无法唯一匹配时返回空字符串。\n返回纯JSON：{"month":"YYYY-MM或空","positionName":"岗位名或空","headcount":人数数字或null,"demandType":"新增需求|储备需求|空","priority":"紧急|重要|储备|空","expectedArrivalDate":"YYYY-MM-DD或空","latestArrivalDate":"YYYY-MM-DD或空","note":"用于审批的一段简洁需求说明或空"}。\n期望到岗是希望到岗的日期，最晚到岗是明确说出的截止日期，两者分别提取；只说一个时不要自动复制到另一个。不要返回Markdown。\n\n用户原话：\n${transcript.slice(0, 18000)}`
    let value: any
    try {
      const answer = await withTimeout(llm.chat([{ role: 'user', content: prompt }], { timeoutMs }), timeoutMs, 'AI解析招聘需求超时')
      value = JSON.parse(answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim())
    } catch (error) {
      this.logger.error(`AI解析招聘需求失败：${error instanceof Error ? error.message : String(error)}`)
      throw new ServiceUnavailableException('AI解析需求失败，请稍后重试或先手动填写')
    }
    const normalizePosition = (value: unknown) => text(value).normalize('NFKC').replace(/[\s·•()（）\-_/]/g, '').toLowerCase()
    const requestedPosition = text(value?.positionName)
    const requestedKey = normalizePosition(requestedPosition)
    const exactMatches = positions.filter((item) => normalizePosition(item.name) === requestedKey)
    const fuzzyMatches = exactMatches.length ? exactMatches : positions.filter((item) => {
      const key = normalizePosition(item.name)
      return Boolean(requestedKey && key && (key.includes(requestedKey) || requestedKey.includes(key)))
    })
    const matched = fuzzyMatches.length === 1 ? fuzzyMatches[0] : undefined
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value?.month)) ? text(value.month) : ''
    const { expectedArrivalDate, latestArrivalDate } = this.arrivalDates({ expectedArrivalDate: text(value?.expectedArrivalDate), latestArrivalDate: text(value?.latestArrivalDate) })
    const headcountValue = value?.headcount
    const headcount = headcountValue === null || headcountValue === undefined || text(headcountValue) === '' || !Number.isFinite(Number(headcountValue))
      ? null
      : Math.max(0, Math.round(Number(headcountValue)))
    const allowed = (input: unknown, options: string[]) => options.includes(text(input)) ? text(input) : ''
    return {
      extraction: {
        month,
        positionId: matched?.id || '',
        positionName: matched?.name || requestedPosition,
        headcount,
        demandType: allowed(value?.demandType, ['新增需求', '储备需求']),
        priority: allowed(value?.priority ? normalizeHiringPriority(value.priority) : '', ['紧急', '重要', '储备']),
        expectedArrivalDate,
        latestArrivalDate,
        note: text(value?.note).slice(0, 2000),
        matchedPosition: Boolean(matched),
      },
      source: 'ai',
      availablePositions: positions.length,
    }
  }

  async saveMonthlyDemand(input: MonthlyDemandInput, operatorUserId = '', profile?: RoleAccessProfile) {
    if (!/^\d{4}-\d{2}$/.test(text(input.month))) throw new BadRequestException('需求月份格式必须是 YYYY-MM')
    const headcount = Math.round(number(input.headcount))
    if (headcount <= 0) throw new BadRequestException('需求人数必须大于0')
    const tableId = await this.verify('recruitment_monthly_demands', ['月度需求ID', '需求月份', '职位ID', '需求数量', '期望到岗日期', '最晚到岗日期', '需求要求', '创建时间', '更新时间'])
    const { row: positionRow } = await this.assertPositionAccess(input.positionId, profile)
    const position = {
      id: text(positionRow.fields['职位ID']) || positionRow.id,
      name: text(positionRow.fields['职位名称']), department: text(positionRow.fields['部门']), owner: text(positionRow.fields['负责人']),
      priority: text(positionRow.fields['优先级']), expectedArrivalDate: text(positionRow.fields['期望到岗日期']), latestArrivalDate: text(positionRow.fields['最晚到岗日期']),
    }
    const timestampNow = timestamp()
    const rows = await teable.listByField(tableId, '职位ID', position.id, 200)
    const demandType = text(input.demandType) || '新增需求'
    if (!['新增需求', '储备需求'].includes(demandType)) throw new BadRequestException('需求类型只能是新增需求或储备需求')
    const existing = rows.find((row) => text(row.fields['需求月份']) === text(input.month) && text(row.fields['职位ID']) === position.id && (text(row.fields['需求类型']) || '新增需求') === demandType)
    const dates = this.arrivalDates(input, existing?.fields || { 期望到岗日期: position.expectedArrivalDate, 最晚到岗日期: position.latestArrivalDate })
    const priorityAliases: Record<string, string> = { 高: '紧急', 中: '重要', 低: '储备', 一般: '储备' }
    const priority = priorityAliases[text(input.priority)] || text(input.priority) || '储备'
    if (!['紧急', '重要', '储备'].includes(priority)) throw new BadRequestException('优先级只能是紧急、重要或储备')
    const note = text(input.note)
    if (!note) throw new BadRequestException('请填写审批用的需求说明')
    const approverUserId = this.recruitmentApproverWecomUserId()
    const fields = {
      需求月份: text(input.month), 职位ID: position.id, 职位名称: position.name, 部门: position.department || '未分配部门',
      负责人: position.owner, 需求数量: headcount, 需求类型: demandType, 需求状态: '待审批', 优先级: priority,
      期望到岗日期: dates.expectedArrivalDate, 最晚到岗日期: dates.latestArrivalDate, 需求说明: note, 需求要求: text(input.demandRequirement),
      变更原因: existing ? '调整需求' : '新建月度需求', 审批状态: '待审批', 审批通过后状态: '已确认',
      审批提交时间: timestampNow, 审批申请人用户ID: operatorUserId, 审批申请人: text(input.operator) || '当前用户', 审批人企微ID: approverUserId,
      审批人用户ID: '', 审批人: '', 审批意见: '', 审批时间: '', 审批通知状态: '待发送', 审批通知错误: '',
      创建人用户ID: operatorUserId, 创建人: text(input.operator) || '当前用户',
      更新时间: timestampNow,
    }
    const result = existing
      ? await teable.updateRecord(tableId, existing.id, { ...fields, 月度需求ID: text(existing.fields['月度需求ID']) || existing.id, 创建时间: text(existing.fields['创建时间']) || timestampNow })
      : await teable.createRecord(tableId, { 月度需求ID: businessId('mdemand'), ...fields, 创建时间: timestampNow })
    this.monthlyDemandCache = undefined
    this.monthlyHiringCache.clear()
    this.auditAsync(existing ? '调整月度招聘需求' : '新建月度招聘需求', '月度需求', text(result.fields?.['月度需求ID']) || result.id, existing?.fields || {}, fields, text(input.operator) || '当前用户', fields.变更原因)
    const approvalId = text(result.fields?.['月度需求ID']) || result.id
    const approvalRow = { ...result, fields: { ...result.fields, ...fields } }
    const canSendInBackground = Boolean(this.recruitmentApproverWecomUserId() && this.messages)
    const notification = canSendInBackground ? { status: '发送中', error: '' } : await this.sendRecruitmentApprovalRequest('demand', approvalId, approvalRow, text(input.operator) || '当前用户')
    if (canSendInBackground) {
      void this.sendRecruitmentApprovalRequest('demand', approvalId, approvalRow, text(input.operator) || '当前用户')
        .catch((error) => this.logger.error(`招聘需求审批通知后台发送失败：${error instanceof Error ? error.message : String(error)}`))
    }
    return { id: approvalId, month: fields.需求月份, positionId: position.id, positionName: position.name, department: fields.部门, headcount, demandType, priority, ...dates, demandRequirement: fields.需求要求, status: fields.需求状态, approvalStatus: fields.审批状态, approvalNotification: notification, positionAutoPublished: false, updated: Boolean(existing) }
  }

  /** 岗位表单使用组织与员工作为下拉数据源，不再让用户手填部门/负责人。 */
  async formOptions(profile?: RoleAccessProfile) {
    const [organizations, users] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_organization_units')),
      teable.listAllRecords(this.table('recruitment_users')),
    ])
    const allowedDepartmentIds = new Set((profile?.dataScopes || []).flatMap((scope) => scope.departmentIds || []).map(text).filter(Boolean))
    return {
      departments: organizations.filter((row) => text(row.fields['组织类型']) === '部门' && text(row.fields['组织状态']) !== '停用')
        .filter((row) => this.hasAllPositionAccess(profile) || allowedDepartmentIds.has(text(row.fields['组织单元ID']) || row.id))
        .map((row) => ({ id: text(row.fields['组织单元ID']) || row.id, name: text(row.fields['组织名称']), owner: text(row.fields['负责人']) }))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      employees: users.filter((row) => ['启用', '待开通', ''].includes(text(row.fields['用户状态'])))
        .map((row) => ({ id: text(row.fields['用户ID']) || row.id, name: text(row.fields['姓名']), department: json<string[]>(row.fields['部门JSON'], [])[0] || '', mobile: text(row.fields['手机']), tianjiWechatId: text(row.fields['天玑微信ID']) || text(row.fields['企业微信用户ID']) }))
        .filter((item) => item.name)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    }
  }

  async listMonthlyDemands(month = '', positionId = '', profile?: RoleAccessProfile, scopeMode: 'employee' | 'role' = 'employee') {
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('需求月份格式无效')
    const [rows, positions] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_monthly_demands'), month ? { filterByTql: `{需求月份} = '${month}'` } : {}),
      teable.listAllRecords(this.table('recruitment_positions')),
    ])
    const visiblePositions = await this.filterPositionRows(positions, profile, scopeMode)
    const visiblePositionIds = new Set(visiblePositions.map((row) => text(row.fields['职位ID']) || row.id))
    return {
      demands: rows
        .filter((row) => visiblePositionIds.has(text(row.fields['职位ID'])) && (!month || text(row.fields['需求月份']) === month) && (!positionId || text(row.fields['职位ID']) === positionId))
        .map((row) => ({
          id: text(row.fields['月度需求ID']) || row.id, month: text(row.fields['需求月份']), positionId: text(row.fields['职位ID']),
          positionName: text(row.fields['职位名称']), department: text(row.fields['部门']), owner: text(row.fields['负责人']),
          headcount: number(row.fields['需求数量']), demandType: text(row.fields['需求类型']) || '新增需求', status: text(row.fields['需求状态']), priority: normalizeHiringPriority(row.fields['优先级']),
          expectedArrivalDate: text(row.fields['期望到岗日期']), latestArrivalDate: text(row.fields['最晚到岗日期']), note: text(row.fields['需求说明']), demandRequirement: text(row.fields['需求要求']), changeReason: text(row.fields['变更原因']),
          approvalStatus: text(row.fields['审批状态']), approvalTargetStatus: text(row.fields['审批通过后状态']), approvalSubmittedAt: text(row.fields['审批提交时间']),
          approver: text(row.fields['审批人']), approvalOpinion: text(row.fields['审批意见']), approvedAt: text(row.fields['审批时间']),
          approvalNotificationStatus: text(row.fields['审批通知状态']), approvalNotificationError: text(row.fields['审批通知错误']),
          createdBy: text(row.fields['创建人']), createdAt: text(row.fields['创建时间']), updatedAt: text(row.fields['更新时间']),
        }))
        .sort((left, right) => right.month.localeCompare(left.month) || right.updatedAt.localeCompare(left.updatedAt)),
    }
  }

  async getRecruitmentApproval(typeInput: string, id: string, actor: { userId: string; userName: string }) {
    const type = this.recruitmentApprovalType(typeInput)
    await this.assertRecruitmentApprover(actor.userId)
    const { row } = await this.recruitmentApprovalRow(type, id)
    return this.mapRecruitmentApproval(type, row)
  }

  async decideRecruitmentApproval(typeInput: string, id: string, input: { decision?: string; opinion?: string }, actor: { userId: string; userName: string }) {
    const type = this.recruitmentApprovalType(typeInput)
    const approverWecomUserId = await this.assertRecruitmentApprover(actor.userId)
    const decision = text(input.decision)
    if (!['通过', '驳回'].includes(decision)) throw new BadRequestException('审批结果只能是通过或驳回')
    const opinion = text(input.opinion)
    if (decision === '驳回' && !opinion) throw new BadRequestException('驳回时必须填写审批意见')
    const { tableId, row } = await this.recruitmentApprovalRow(type, id)
    const current = text(row.fields['审批状态']) || '待审批'
    if (current !== '待审批') throw new ConflictException(`该${type === 'position' ? '岗位' : '需求'}已经${current}，不能重复审批`)
    const now = timestamp()
    const common = {
      审批状态: decision === '通过' ? '已通过' : '已驳回', 审批人企微ID: approverWecomUserId,
      审批人用户ID: actor.userId, 审批人: actor.userName || actor.userId, 审批意见: opinion, 审批时间: now, 更新时间: now,
    }
    const fields = type === 'position'
      ? common
      : { ...common, 需求状态: decision === '通过' ? text(row.fields['审批通过后状态']) || '已确认' : '审批驳回' }
    await teable.updateRecord(tableId, row.id, fields)
    let positionAutoPublished = false
    if (type === 'demand' && decision === '通过') {
      positionAutoPublished = await this.publishPositionFromDemand(text(row.fields['职位ID']), actor.userName || actor.userId, '招聘需求审批通过')
        .catch((error) => {
          this.logger.error(`需求审批通过后自动发布岗位失败：${error instanceof Error ? error.message : String(error)}`)
          return false
        })
    }
    if (type === 'position') this.invalidateTables(['recruitment_positions'])
    else { this.monthlyDemandCache = undefined; this.monthlyHiringCache.clear(); this.invalidateTables(['recruitment_monthly_demands']) }
    await this.audit(`${type === 'position' ? '岗位' : '招聘需求'}审批${decision}`, type === 'position' ? '岗位' : '月度需求', id, row.fields, fields, actor.userName || actor.userId, opinion)
    return { ...this.mapRecruitmentApproval(type, { ...row, fields: { ...row.fields, ...fields } }), positionAutoPublished }
  }

  async createPosition(input: PositionInput, operator = '当前用户', operatorUserId = '', profile?: RoleAccessProfile) {
    this.invalidateTables(['recruitment_positions', 'recruitment_position_versions']);
    this.validatePosition(input)
    const dates = this.arrivalDates(input)
    const department = await this.departmentForAccess(input.department, operator, profile)
    const recruiterFields = await this.resolveRecruiterFields(input.recruiterUserId, input.backupRecruiterUserId, true)
    const tableId = await this.verify('recruitment_positions', ['职位ID', '职位名称', '部门', '发布状态', '最晚到岗日期', '创建时间', '更新时间'])
    const id = businessId('pos')
    const now = timestamp()
    const approverUserId = this.recruitmentApproverWecomUserId()
    const fields = compact({
      职位ID: id, 需求ID: '', 职位名称: input.name, 职位编码: input.code || this.positionCode(),
      部门ID: department.id, 部门: department.name, 负责人用户ID: text(input.ownerUserId), 负责人: input.owner || operator,
      ...recruiterFields,
      招聘类别: input.category || '社招', 岗位层级: input.level || '普通岗位',
      工作城市: input.city || '', 工作地点: input.location || '', 招聘人数: Math.max(0, Math.round(number(input.headcount))),
      在职人数: Math.max(0, Math.round(number(input.currentEmployeeCount))), 已到岗人数: 0,
      最低薪资: number(input.minSalary) || undefined,
      最高薪资: number(input.maxSalary) || undefined, 薪资文本: input.salaryText || '', 岗位JD: input.jobDescription || '',
      工作职责: input.responsibilities || '', 任职要求: input.requirements || '', 福利: input.benefits || '',
      标签JSON: JSON.stringify(input.tags || []), 发布状态: '待发布', 招聘状态: input.recruitmentStatus || '待启动',
      需求类型: input.demandType || '新增需求', 优先级: input.priority || '中', 期望到岗日期: dates.expectedArrivalDate, 最晚到岗日期: dates.latestArrivalDate,
      审批状态: '待审批', 审批提交时间: now, 审批申请人用户ID: operatorUserId, 审批申请人: operator,
      审批人企微ID: approverUserId, 审批人用户ID: '', 审批人: '', 审批意见: '', 审批时间: '', 审批通知状态: '待发送', 审批通知错误: '',
      应聘人数缓存: 0,
      JD版本: 1, 重匹配状态: '无需重匹配', 待重匹配人数: 0,
      创建时间: now, 更新时间: now, 来源类型: input.sourceType || '系统录入', 来源ID: input.sourceId || '',
    })
    const created = await teable.createRecord(tableId, fields)
    await this.savePositionVersion(id, fields, input.headcount || 0, input.changeReason || '创建岗位', operator)
    this.auditAsync('创建岗位', '岗位', id, {}, fields, operator)
    const notification = await this.sendRecruitmentApprovalRequest('position', id, created, operator)
    return { ...(await this.getPosition(id)), approvalNotification: notification }
  }

  async importPositions(body: { rows: Array<Partial<PositionInput> & { id?: string }>; sourceName?: string; operator?: string }) {
    if (!Array.isArray(body.rows) || !body.rows.length) throw new BadRequestException('没有可导入的职位')
    if (body.rows.length > 1000) throw new BadRequestException('单次最多导入1000个职位')
    const tableId = await this.verify('recruitment_positions', ['职位ID', '来源ID', '职位名称', '部门', '创建时间', '更新时间'])
    const existingRows = await teable.listAllRecords(tableId)
    const operator = text(body.operator) || '当前用户'
    const sourceName = text(body.sourceName) || '批量导入'
    const result = { created: 0, updated: 0, failed: 0, errors: [] as Array<{ index: number; message: string }> }
    for (const [index, input] of body.rows.entries()) {
      try {
        const name = text(input.name)
        const department = text(input.department)
        if (!name) throw new Error('岗位名称为必填项')
        const sourceId = text(input.id) || text(input.code) || `${sourceName}-${index + 1}`
        const existing = existingRows.find((row) => text(row.fields['来源ID']) === sourceId || (input.id && text(row.fields['职位ID']) === text(input.id)))
        const now = timestamp()
        const fields = compact({
          职位ID: existing ? undefined : text(input.id) || businessId('pos'), 来源ID: sourceId,
          职位名称: name, 职位编码: input.code || text(existing?.fields['职位编码']) || this.positionCode(),
          部门: department, 负责人用户ID: text(input.ownerUserId), 负责人: input.owner || operator,
          招聘HR用户ID: text(input.recruiterUserId), 招聘HR: text(input.recruiter), 备用招聘HR用户ID: text(input.backupRecruiterUserId), 备用招聘HR: text(input.backupRecruiter), 招聘类别: input.category || '社招', 岗位层级: input.level === undefined ? text(existing?.fields['岗位层级']) || '普通岗位' : input.level,
          工作城市: input.city || '', 工作地点: input.location || '', 招聘人数: Math.max(0, Math.round(number(input.headcount))),
          在职人数: Math.max(0, Math.round(number(input.currentEmployeeCount))),
          最低薪资: input.minSalary, 最高薪资: input.maxSalary, 薪资文本: input.salaryText || '', 岗位JD: input.jobDescription || '',
          工作职责: input.responsibilities || '', 任职要求: input.requirements || '', 福利: input.benefits || '',
          标签JSON: JSON.stringify(input.tags || []), 发布状态: existing ? undefined : '待发布',
          应聘人数缓存: existing ? undefined : 0, JD版本: existing ? undefined : 1, 重匹配状态: existing ? undefined : '无需重匹配',
          待重匹配人数: existing ? undefined : 0, 来源类型: '批量导入', 创建时间: existing ? undefined : now, 更新时间: now,
        })
        let positionId = text(input.id)
        if (existing) {
          await teable.updateRecord(tableId, existing.id, fields)
          existing.fields = { ...existing.fields, ...fields }
          positionId = text(existing.fields['职位ID']) || existing.id
          result.updated += 1
        } else {
          const created = await teable.createRecord(tableId, fields)
          existingRows.push(created)
          positionId = text(created.fields['职位ID']) || created.id
          result.created += 1
        }
        await this.savePositionVersion(positionId, existingRows.find((row) => text(row.fields['职位ID']) === positionId)?.fields || fields, number(input.headcount), input.changeReason || `导入：${sourceName}`, operator)
      } catch (error) {
        result.failed += 1
        result.errors.push({ index: index + 1, message: error instanceof Error ? error.message : String(error) })
      }
    }
    await this.audit('批量导入职位', '职位批次', sourceName, {}, result, operator, sourceName)
    return { total: body.rows.length, ...result }
  }

  async updatePosition(id: string, input: Partial<PositionInput>, operator = '当前用户', profile?: RoleAccessProfile) {
    this.invalidateTables(['recruitment_positions', 'recruitment_job_matches']);
    const tableId = await this.verify('recruitment_positions', ['职位ID', '最晚到岗日期', '更新时间'])
    const { row } = await this.assertPositionAccess(id, profile)
    const dates = input.expectedArrivalDate !== undefined || input.latestArrivalDate !== undefined ? this.arrivalDates(input, row.fields) : null
    const department = input.department === undefined ? null : await this.departmentForAccess(input.department, operator, profile)
    const recruiterFields = input.recruiterUserId !== undefined || input.backupRecruiterUserId !== undefined
      ? await this.resolveRecruiterFields(input.recruiterUserId === undefined ? text(row.fields['招聘HR用户ID']) : input.recruiterUserId, input.backupRecruiterUserId === undefined ? text(row.fields['备用招聘HR用户ID']) : input.backupRecruiterUserId, true)
      : {}
    const fields = compact({
      职位名称: input.name, 职位编码: input.code, 部门ID: department?.id, 部门: department?.name,
      负责人用户ID: input.ownerUserId, 负责人: input.owner,
      ...recruiterFields,
      招聘类别: input.category, 岗位层级: input.level, 工作城市: input.city, 工作地点: input.location,
      招聘人数: input.headcount == null ? undefined : Math.max(0, Math.round(number(input.headcount))),
      在职人数: input.currentEmployeeCount == null ? undefined : Math.max(0, Math.round(number(input.currentEmployeeCount))),
      最低薪资: input.minSalary, 最高薪资: input.maxSalary, 薪资文本: input.salaryText, 岗位JD: input.jobDescription,
      工作职责: input.responsibilities, 任职要求: input.requirements, 福利: input.benefits,
      招聘状态: input.recruitmentStatus, 需求类型: input.demandType, 优先级: input.priority,
      期望到岗日期: input.expectedArrivalDate,
      最晚到岗日期: dates && input.latestArrivalDate !== undefined ? dates.latestArrivalDate : undefined,
      标签JSON: input.tags ? JSON.stringify(input.tags) : undefined, 更新时间: timestamp(),
    })
    const jdFields = ['岗位JD', '工作职责', '任职要求', '标签JSON']
    const jdChanged = jdFields.some((field) => fields[field] !== undefined && JSON.stringify(fields[field]) !== JSON.stringify(row.fields[field] ?? ''))
    if (jdChanged) {
      const matches = (await teable.listAllRecords(this.table('recruitment_job_matches'))).filter((item) => text(item.fields['职位ID']) === id && !['历史', '已失效'].includes(text(item.fields['匹配状态'])))
      const affected = new Set(matches.map((item) => text(item.fields['候选人ID'])).filter(Boolean)).size
      Object.assign(fields, { JD版本: Math.max(1, number(row.fields['JD版本']) || 1) + 1, 重匹配状态: affected ? '待重匹配' : '无需重匹配', 待重匹配人数: affected, 最近JD变更时间: timestamp(), 最近JD变更原因: input.changeReason || '岗位JD内容发生变化' })
    }
    await teable.updateRecord(tableId, row.id, fields)
    await this.savePositionVersion(id, { ...row.fields, ...fields }, input.headcount || 0, input.changeReason || '编辑职位', operator)
    this.auditAsync('修改职位', '职位', id, row.fields, fields, operator)
    return this.getPosition(id)
  }

  async publishPosition(id: string, input: CollectionTaskInput, operator = '当前用户') {
    const positionTable = await this.verify('recruitment_positions', ['职位ID', '发布状态', '招聘状态', '发布时间', '下线时间', '更新时间'])
    const row = await this.find(positionTable, '职位ID', id, '职位不存在')
    this.assertPositionApproved(row)
    const fields = { 发布状态: '招聘中', 招聘状态: '招聘中', 发布时间: timestamp(), 下线时间: '', 更新时间: timestamp() }
    await teable.updateRecord(positionTable, row.id, fields)
    this.overviewCache.clear()
    this.monthlyHiringCache.clear()
    this.invalidateTables(['recruitment_positions'])
    const task = await this.createCollectionTask(id, input, operator)
    this.auditAsync('发布职位并创建采集任务', '职位', id, row.fields, fields, operator)
    return { position: await this.getPosition(id), collectionTask: task }
  }

  async changePositionStatus(id: string, status: '已下线' | '已关闭' | '待发布', reason: string, operator = '当前用户') {
    if (status !== '待发布' && !text(reason)) throw new BadRequestException('下线或关闭职位时必须填写原因')
    const tableId = await this.verify('recruitment_positions', ['职位ID', '发布状态', '招聘状态', '下线时间', '更新时间'])
    const row = await this.find(tableId, '职位ID', id, '职位不存在')
    const current = text(row.fields['发布状态']) || '待发布'
    if (current === status) throw new BadRequestException(`职位已经处于“${status}”状态`)
    if (current === '已关闭' && status !== '待发布') throw new BadRequestException('已关闭职位只能先重新开放')
    const recruitmentStatus = status === '已下线' ? '暂停招聘' : status === '已关闭' ? '已关闭' : '待启动'
    const fields = { 发布状态: status, 招聘状态: recruitmentStatus, 下线时间: status === '待发布' ? '' : timestamp(), 更新时间: timestamp() }
    await teable.updateRecord(tableId, row.id, fields)
    this.overviewCache.clear()
    this.monthlyHiringCache.clear()
    this.invalidateTables(['recruitment_positions'])
    this.auditAsync(`职位状态变更：${current}→${status}`, '职位', id, row.fields, fields, operator, reason)
    return this.getPosition(id)
  }

  async batchPublishPositions(ids: string[], operator = '当前用户') {
    if (!Array.isArray(ids) || !ids.length) throw new BadRequestException('请选择要发布的岗位')
    if (ids.length > 200) throw new BadRequestException('单次最多操作200个岗位')
    const tableId = await this.verify('recruitment_positions', ['职位ID', '发布状态', '招聘状态', '发布时间', '下线时间', '更新时间'])
    const [rows, demands] = await Promise.all([
      teable.listAllRecords(tableId),
      teable.listAllRecords(this.table('recruitment_monthly_demands')),
    ])
    const currentMonth = currentShanghaiMonth()
    const activeDemandPositionIds = new Set(demands.filter((row) => text(row.fields['需求月份']) >= currentMonth
      && number(row.fields['需求数量']) > 0
      && text(row.fields['审批状态']) !== '已驳回'
      && !['审批驳回', '已停用'].includes(text(row.fields['需求状态'])))
      .map((row) => text(row.fields['职位ID'])).filter(Boolean))
    const now = timestamp()
    const result = { published: 0, skipped: 0, failed: 0, errors: [] as Array<{ id: string; message: string }> }
    for (const id of ids) {
      const row = rows.find((r) => text(r.fields['职位ID']) === id || r.id === id)
      if (!row) { result.failed += 1; result.errors.push({ id, message: '岗位不存在' }); continue }
      const current = text(row.fields['发布状态']) || '待发布'
      if (current === '招聘中') { result.skipped += 1; continue }
      if (!activeDemandPositionIds.has(text(row.fields['职位ID']) || row.id)) {
        try { this.assertPositionApproved(row) } catch (error) { result.failed += 1; result.errors.push({ id, message: error instanceof Error ? error.message : String(error) }); continue }
      }
      await teable.updateRecord(tableId, row.id, { 发布状态: '招聘中', 招聘状态: '招聘中', 发布时间: now, 下线时间: '', 更新时间: now })
      result.published += 1
    }
    if (result.published) { this.overviewCache.clear(); this.monthlyHiringCache.clear(); this.invalidateTables(['recruitment_positions']) }
    await this.audit('批量发布岗位', '岗位批次', ids.join(','), {}, result, operator)
    return result
  }

  async batchOfflinePositions(ids: string[], reason: string, operator = '当前用户') {
    if (!Array.isArray(ids) || !ids.length) throw new BadRequestException('请选择要暂停的岗位')
    if (ids.length > 200) throw new BadRequestException('单次最多操作200个岗位')
    if (!text(reason)) throw new BadRequestException('批量暂停岗位时必须填写原因')
    const tableId = await this.verify('recruitment_positions', ['职位ID', '发布状态', '招聘状态', '下线时间', '更新时间'])
    const rows = await teable.listAllRecords(tableId)
    const now = timestamp()
    const result = { offline: 0, skipped: 0, failed: 0, errors: [] as Array<{ id: string; message: string }> }
    for (const id of ids) {
      const row = rows.find((r) => text(r.fields['职位ID']) === id || r.id === id)
      if (!row) { result.failed += 1; result.errors.push({ id, message: '岗位不存在' }); continue }
      const current = text(row.fields['发布状态']) || '待发布'
      if (current !== '招聘中') { result.skipped += 1; continue }
      await teable.updateRecord(tableId, row.id, { 发布状态: '已下线', 招聘状态: '暂停招聘', 下线时间: now, 更新时间: now })
      result.offline += 1
    }
    if (result.offline) { this.overviewCache.clear(); this.monthlyHiringCache.clear(); this.invalidateTables(['recruitment_positions']) }
    await this.audit('批量暂停岗位', '岗位批次', ids.join(','), {}, result, operator, reason)
    return result
  }

  async syncCompanyPositionCatalog(operator = '当前用户') {
    const catalog = await loadCompanyPositionCatalog()
    const tableId = await this.verify('recruitment_positions', ['职位ID', '来源ID', '职位名称', '部门', '薪资文本', '发布状态', '创建时间', '更新时间'])
    const existingRows = await teable.listAllRecords(tableId)
    const existingBySource = new Map(existingRows.map((row) => [text(row.fields['来源ID']), row]))
    const sourceIds = new Set(catalog.map((item) => item.sourceId))
    const result = { total: catalog.length, created: 0, updated: 0, preserved: 0, deleted: 0, salaryPending: 0 }
    for (const item of catalog) {
      const existing = existingBySource.get(item.sourceId)
      const now = timestamp()
      const fields = compact({
        职位ID: existing ? undefined : businessId('pos'), 需求ID: '',
        职位名称: existing ? undefined : item.name,
        职位编码: text(existing?.fields['职位编码']) || this.positionCode(),
        部门: existing ? undefined : item.department,
        负责人: text(existing?.fields['负责人']) || '',
        招聘类别: '社招',
        招聘人数: number(existing?.fields['招聘人数']),
        在职人数: number(existing?.fields['在职人数']),
        最低薪资: existing ? undefined : item.minSalary,
        最高薪资: existing ? undefined : item.maxSalary,
        薪资文本: existing ? undefined : item.salaryText,
        岗位JD: `岗位职责：\n${item.responsibilities}\n\n任职要求：\n${item.requirements || '待确认'}\n\n薪资：\n${item.salaryText || '待确认'}`,
        工作职责: item.responsibilities, 任职要求: item.requirements, 福利: '', 标签JSON: JSON.stringify([item.sourceSheet, item.businessUnit].filter(Boolean)),
        发布状态: existing ? undefined : '待发布', 应聘人数缓存: existing ? undefined : 0, JD版本: existing ? undefined : 1,
        重匹配状态: existing ? undefined : '无需重匹配', 待重匹配人数: existing ? undefined : 0,
        来源类型: '岗位大全-2026.10', 来源ID: item.sourceId, 创建时间: existing ? undefined : now, 更新时间: now,
      })
      if (existing) {
        await teable.updateRecord(tableId, existing.id, fields)
        result.updated += 1
      } else {
        const created = await teable.createRecord(tableId, fields)
        await this.savePositionVersion(text(created.fields['职位ID']) || created.id, created.fields, number(created.fields['招聘人数']), '同步岗位大全-2026.10', operator)
        result.created += 1
      }
      if (!item.salaryText || item.minSalary == null || item.maxSalary == null) result.salaryPending += 1
    }
    result.preserved = existingRows.filter((row) => !sourceIds.has(text(row.fields['来源ID']))).length
    await this.audit('全量同步岗位大全-2026.10', '公司岗位库', '岗位大全-2026.10', { before: existingRows.length }, result, operator)
    return result
  }

  async listChannels() {
    const [rows, bindings] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_channels')),
      teable.listAllRecords(this.table('recruitment_position_channels')),
    ])
    const channels = rows.map((row) => ({
      ...this.mapChannel(row),
      positionCount: new Set(bindings.filter((item) => text(item.fields['渠道ID']) === (text(row.fields['渠道ID']) || row.id) && text(item.fields['绑定状态']) === '启用').map((item) => text(item.fields['职位ID']))).size,
    }))
    return { total: channels.length, channels }
  }

  async createChannel(input: RecruitmentChannelInput) {
    if (!text(input.name)) throw new BadRequestException('请填写渠道名称')
    const tableId = await this.verify('recruitment_channels', ['渠道ID', '渠道名称', '渠道状态', '创建时间', '更新时间'])
    const rows = await teable.listAllRecords(tableId)
    if (rows.some((row) => text(row.fields['渠道名称']).toLowerCase() === text(input.name).toLowerCase())) throw new BadRequestException('渠道名称已存在')
    const id = businessId('channel')
    const now = timestamp()
    const fields = {
      渠道ID: id, 渠道名称: text(input.name), 渠道类型: text(input.type) || '招聘平台', 渠道状态: text(input.status) || '启用',
      渠道负责人用户ID: text(input.ownerUserId), 渠道负责人: text(input.owner) || text(input.operator) || '当前用户',
      默认采集频率: text(input.frequency) || '手动', 单次目标简历数: Math.max(1, Math.round(number(input.targetCount) || 50)),
      平台配置JSON: JSON.stringify(input.config || {}), 说明: text(input.description), 创建时间: now, 更新时间: now,
    }
    await teable.createRecord(tableId, fields)
    await this.audit('创建招聘渠道', '招聘渠道', id, {}, fields, text(input.operator) || '当前用户')
    return this.mapChannel({ id, fields })
  }

  async updateChannel(id: string, input: Partial<RecruitmentChannelInput>) {
    const tableId = await this.verify('recruitment_channels', ['渠道ID', '更新时间'])
    const row = await this.find(tableId, '渠道ID', id, '招聘渠道不存在')
    const fields = compact({
      渠道名称: input.name, 渠道类型: input.type, 渠道状态: input.status,
      渠道负责人用户ID: input.ownerUserId, 渠道负责人: input.owner, 默认采集频率: input.frequency,
      单次目标简历数: input.targetCount == null ? undefined : Math.max(1, Math.round(number(input.targetCount))),
      平台配置JSON: input.config ? JSON.stringify(input.config) : undefined, 说明: input.description, 更新时间: timestamp(),
    })
    await teable.updateRecord(tableId, row.id, fields)
    await this.audit('修改招聘渠道', '招聘渠道', id, row.fields, fields, text(input.operator) || '当前用户')
    return this.mapChannel({ ...row, fields: { ...row.fields, ...fields } })
  }

  async bindPositionChannels(positionId: string, input: PositionChannelBindingInput) {
    const position = await this.getPosition(positionId)
    if (!Array.isArray(input.channelIds) || !input.channelIds.length) throw new BadRequestException('请至少选择一个招聘渠道')
    const [channelRows, bindingRows] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_channels')),
      teable.listAllRecords(this.table('recruitment_position_channels')),
    ])
    const selected = channelRows.filter((row) => input.channelIds.includes(text(row.fields['渠道ID']) || row.id) && text(row.fields['渠道状态']) !== '停用')
    if (selected.length !== new Set(input.channelIds).size) throw new BadRequestException('部分招聘渠道不存在或已停用')
    const tableId = await this.verify('recruitment_position_channels', ['职位渠道ID', '职位ID', '渠道ID', '绑定状态', '创建时间', '更新时间'])
    const now = timestamp()
    for (const existing of bindingRows.filter((row) => text(row.fields['职位ID']) === positionId && !input.channelIds.includes(text(row.fields['渠道ID'])))) {
      await teable.updateRecord(tableId, existing.id, { 绑定状态: '停用', 更新时间: now })
    }
    for (const channel of selected) {
      const channelId = text(channel.fields['渠道ID']) || channel.id
      const existing = bindingRows.find((row) => text(row.fields['职位ID']) === positionId && text(row.fields['渠道ID']) === channelId)
      const fields = {
        职位ID: positionId, 渠道ID: channelId, 渠道名称: text(channel.fields['渠道名称']), 绑定状态: '启用',
        采集频率: text(input.frequency) || text(channel.fields['默认采集频率']) || '手动',
        目标简历数: Math.max(1, Math.round(number(input.targetCount) || number(channel.fields['单次目标简历数']) || 50)),
        采集条件JSON: JSON.stringify(input.filters || {}), 渠道负责人: text(channel.fields['渠道负责人']), 更新时间: now,
      }
      if (existing) await teable.updateRecord(tableId, existing.id, fields)
      else await teable.createRecord(tableId, { 职位渠道ID: businessId('poschannel'), ...fields, 创建时间: now })
    }
    await this.audit('配置职位招聘渠道', '职位', positionId, {}, { channelIds: input.channelIds, frequency: input.frequency, targetCount: input.targetCount }, text(input.operator) || '当前用户')
    const refreshed = await teable.listAllRecords(tableId)
    return {
      positionId,
      bindings: refreshed.filter((row) => text(row.fields['职位ID']) === positionId && text(row.fields['绑定状态']) === '启用').map((row) => this.mapChannelBinding(row)),
    }
  }

  async getPosition(id: string, profile?: RoleAccessProfile) {
    const [positions, tasks, applications] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_positions')),
      teable.listAllRecords(this.table('recruitment_collection_tasks')),
      teable.listAllRecords(this.table('recruitment_applications')),
    ])
    const row = positions.find((item) => text(item.fields['职位ID']) === id || item.id === id)
    if (!row) throw new NotFoundException('岗位不存在')
    if (!(await this.filterPositionRows([row], profile)).length) throw new ForbiddenException('只能查看所属部门的岗位')
    return this.mapPosition(row, tasks, applications)
  }

  async getPositionVersions(id: string, profile?: RoleAccessProfile) {
    await this.getPosition(id, profile)
    return { positionId: id, total: 0, versions: [] }
  }

  async comparePositionVersions(id: string, profile?: RoleAccessProfile) {
    await this.getPosition(id, profile)
    return { positionId: id, from: null, to: null, changedCount: 0, differences: [] }
  }

  async createCollectionTask(positionId: string, input: CollectionTaskInput, operator = '当前用户') {
    const position = await this.getPosition(positionId)
    const tableId = await this.verify('recruitment_collection_tasks', ['采集任务ID', '职位ID', '目标平台JSON', '任务状态', '创建时间', '更新时间'])
    const id = businessId('collect')
    const now = timestamp()
    const bindings = (await teable.listAllRecords(this.table('recruitment_position_channels')))
      .filter((row) => text(row.fields['职位ID']) === positionId && text(row.fields['绑定状态']) === '启用')
    const platforms = (input.platforms?.length ? input.platforms : bindings.map((row) => text(row.fields['渠道名称']))).map(text).filter(Boolean)
    const bindingTarget = bindings.reduce((sum, row) => sum + number(row.fields['目标简历数']), 0)
    const fields = {
      采集任务ID: id, 职位ID: position.id, 任务名称: `${position.name}简历采集`,
      目标平台JSON: JSON.stringify(platforms), 采集条件JSON: JSON.stringify(input.filters || {}),
      目标简历数: Math.max(1, Math.round(number(input.targetCount) || bindingTarget || 50)), 触发方式: '人工发布职位',
      任务状态: platforms.length ? '待对接RPA' : '待配置平台', 外部任务ID: '', 领取人: '', 最近心跳时间: '', 重试次数: 0,
      已采集数量: 0, 成功入库数量: 0,
      最近结果JSON: JSON.stringify({ message: '任务已入库，等待RPA连接器领取执行' }), 错误信息: '',
      创建人: operator, 创建时间: now, 更新时间: now,
    }
    await teable.createRecord(tableId, fields)
    await this.collectionTaskEvent({ id, fields }, '', text(fields.任务状态), '创建采集任务', operator)
    await this.audit('创建RPA采集任务', '采集任务', id, {}, fields, operator)
    return this.mapTask({ id, fields })
  }

  async listCollectionTasks(query: { status?: string; positionId?: string; demandId?: string }) {
    const rows = await teable.listAllRecords(this.table('recruitment_collection_tasks'))
    const tasks = rows.map((row) => this.mapTask(row)).filter((item) =>
      (!query.status || item.status === query.status)
      && (!query.positionId || item.positionId === query.positionId)
      && (!query.demandId || item.demandId === query.demandId))
    return { total: tasks.length, tasks }
  }

  async getCollectionTask(id: string) {
    const tableId = this.table('recruitment_collection_tasks')
    const row = await this.find(tableId, '采集任务ID', id, '采集任务不存在')
    const events = (await teable.listAllRecords(this.table('recruitment_collection_task_events')))
      .filter((item) => text(item.fields['采集任务ID']) === id)
      .sort((a, b) => text(a.fields['发生时间']).localeCompare(text(b.fields['发生时间'])))
      .map((item) => ({
        id: text(item.fields['采集事件ID']) || item.id, from: text(item.fields['原状态']), to: text(item.fields['新状态']),
        action: text(item.fields['操作']), collectedCount: number(item.fields['已采集数量']), importedCount: number(item.fields['成功入库数量']),
        result: json<Record<string, unknown>>(item.fields['结果JSON'], {}), error: text(item.fields['错误信息']),
        operator: text(item.fields['操作人']), occurredAt: text(item.fields['发生时间']),
      }))
    return { ...this.mapTask(row), events }
  }

  async claimCollectionTask(id: string, body: CollectionTaskProgressInput) {
    const { tableId, row } = await this.collectionTaskRow(id)
    const current = text(row.fields['任务状态'])
    if (!['待对接RPA', '待重试'].includes(current)) throw new BadRequestException(`当前任务状态“${current}”不能领取`)
    const externalTaskId = text(body.externalTaskId)
    if (!externalTaskId) throw new BadRequestException('领取任务时必须提供外部任务ID')
    const operator = text(body.operator) || 'RPA连接器'
    const fields = {
      任务状态: '执行中', 外部任务ID: externalTaskId, 领取人: operator,
      最近触发时间: timestamp(), 最近心跳时间: timestamp(), 错误信息: '', 更新时间: timestamp(),
    }
    await teable.updateRecord(tableId, row.id, fields)
    await this.collectionTaskEvent(row, current, '执行中', '领取任务', operator, { ...body, externalTaskId })
    return this.getCollectionTask(id)
  }

  async updateCollectionTaskProgress(id: string, body: CollectionTaskProgressInput) {
    const { tableId, row } = await this.collectionTaskRow(id)
    const current = text(row.fields['任务状态'])
    if (current !== '执行中') throw new BadRequestException(`当前任务状态“${current}”不能回写进度`)
    const collectedCount = Math.max(number(row.fields['已采集数量']), number(body.collectedCount))
    const importedCount = Math.max(number(row.fields['成功入库数量']), number(body.importedCount))
    if (importedCount > collectedCount) throw new BadRequestException('成功入库数量不能大于已采集数量')
    const fields = {
      已采集数量: collectedCount, 成功入库数量: importedCount, 最近心跳时间: timestamp(),
      最近结果JSON: JSON.stringify(body.result || {}), 错误信息: text(body.error), 更新时间: timestamp(),
    }
    await teable.updateRecord(tableId, row.id, fields)
    await this.collectionTaskEvent({ ...row, fields: { ...row.fields, ...fields } }, current, current, '回写进度', text(body.operator) || 'RPA连接器', body)
    return this.getCollectionTask(id)
  }

  async finishCollectionTask(id: string, status: '已完成' | '执行失败', body: CollectionTaskProgressInput) {
    const { tableId, row } = await this.collectionTaskRow(id)
    const current = text(row.fields['任务状态'])
    if (current !== '执行中') throw new BadRequestException(`当前任务状态“${current}”不能结束执行`)
    if (status === '执行失败' && !text(body.error)) throw new BadRequestException('任务失败时必须填写错误信息')
    const collectedCount = Math.max(number(row.fields['已采集数量']), number(body.collectedCount))
    const importedCount = Math.max(number(row.fields['成功入库数量']), number(body.importedCount))
    if (importedCount > collectedCount) throw new BadRequestException('成功入库数量不能大于已采集数量')
    const fields = {
      任务状态: status, 已采集数量: collectedCount, 成功入库数量: importedCount,
      最近结果JSON: JSON.stringify(body.result || {}), 错误信息: text(body.error),
      最近心跳时间: timestamp(), 最近完成时间: timestamp(), 更新时间: timestamp(),
    }
    await teable.updateRecord(tableId, row.id, fields)
    await this.collectionTaskEvent({ ...row, fields: { ...row.fields, ...fields } }, current, status, status === '已完成' ? '完成任务' : '任务失败', text(body.operator) || 'RPA连接器', body)
    await this.audit(status === '已完成' ? '完成RPA采集任务' : 'RPA采集任务失败', '采集任务', id, row.fields, fields, text(body.operator) || 'RPA连接器', text(body.error))
    if (status === '执行失败') await this.createCollectionAlert({ ...row, fields: { ...row.fields, ...fields } }, text(body.error) || 'RPA采集任务执行失败')
    else await this.resolveCollectionAlerts(id)
    return this.getCollectionTask(id)
  }

  async retryCollectionTask(id: string, body: CollectionTaskProgressInput) {
    const { tableId, row } = await this.collectionTaskRow(id)
    const current = text(row.fields['任务状态'])
    if (current !== '执行失败') throw new BadRequestException(`当前任务状态“${current}”不能重试`)
    const fields = {
      任务状态: '待重试', 外部任务ID: '', 领取人: '', 错误信息: '',
      重试次数: number(row.fields['重试次数']) + 1, 更新时间: timestamp(),
    }
    await teable.updateRecord(tableId, row.id, fields)
    await this.collectionTaskEvent({ ...row, fields: { ...row.fields, ...fields } }, current, '待重试', '申请重试', text(body.operator) || '当前用户', body)
    await this.resolveCollectionAlerts(id)
    return this.getCollectionTask(id)
  }

  async cancelCollectionTask(id: string, body: CollectionTaskProgressInput) {
    const { tableId, row } = await this.collectionTaskRow(id)
    const current = text(row.fields['任务状态'])
    if (['已完成', '已取消'].includes(current)) throw new BadRequestException(`当前任务状态“${current}”不能取消`)
    const fields = { 任务状态: '已取消', 最近完成时间: timestamp(), 最近心跳时间: timestamp(), 更新时间: timestamp() }
    await teable.updateRecord(tableId, row.id, fields)
    await this.collectionTaskEvent({ ...row, fields: { ...row.fields, ...fields } }, current, '已取消', '取消任务', text(body.operator) || '当前用户', body)
    await this.audit('取消RPA采集任务', '采集任务', id, row.fields, fields, text(body.operator) || '当前用户', text(body.error))
    return this.getCollectionTask(id)
  }

  async checkStaleCollectionTasks(staleMinutes = 15, operator = '系统巡检') {
    const minutes = Math.max(5, Math.min(1440, Math.round(number(staleMinutes) || 15)))
    const threshold = Date.now() - minutes * 60_000
    const tableId = this.table('recruitment_collection_tasks')
    const rows = await teable.listAllRecords(tableId)
    const stale = rows.filter((row) => {
      if (text(row.fields['任务状态']) !== '执行中') return false
      const heartbeat = Date.parse(text(row.fields['最近心跳时间']) || text(row.fields['最近触发时间']))
      return Number.isFinite(heartbeat) && heartbeat < threshold
    })
    for (const row of stale) {
      const id = text(row.fields['采集任务ID']) || row.id
      const error = `采集任务超过${minutes}分钟未回写心跳`
      const fields = { 任务状态: '执行失败', 错误信息: error, 最近完成时间: timestamp(), 更新时间: timestamp() }
      await teable.updateRecord(tableId, row.id, fields)
      await this.collectionTaskEvent({ ...row, fields: { ...row.fields, ...fields } }, '执行中', '执行失败', '心跳超时', operator, { error })
      await this.createCollectionAlert({ ...row, fields: { ...row.fields, ...fields } }, error)
    }
    return { checked: rows.filter((row) => text(row.fields['任务状态']) === '执行中').length, stale: stale.length, staleMinutes: minutes }
  }

  private arrivalDates(input: { expectedArrivalDate?: string; latestArrivalDate?: string }, existing: Record<string, unknown> = {}) {
    const expectedArrivalDate = input.expectedArrivalDate === undefined ? text(existing['期望到岗日期']) : text(input.expectedArrivalDate)
    const latestArrivalDate = input.latestArrivalDate === undefined ? text(existing['最晚到岗日期']) : text(input.latestArrivalDate)
    for (const [label, value] of [['期望到岗日期', expectedArrivalDate], ['最晚到岗日期', latestArrivalDate]]) {
      if (!value) continue
      const date = new Date(`${value}T00:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label}必须是有效日期（YYYY-MM-DD）`)
    }
    if (expectedArrivalDate && latestArrivalDate && latestArrivalDate < expectedArrivalDate) throw new BadRequestException('最晚到岗日期不能早于期望到岗日期')
    return { expectedArrivalDate, latestArrivalDate }
  }

  private validatePosition(input: PositionInput) {
    if (!text(input.name)) throw new BadRequestException('请填写岗位名称')
  }

  private async resolveRecruiterFields(primaryValue: unknown, backupValue: unknown, requirePrimary: boolean) {
    const primaryUserId = text(primaryValue), backupUserId = text(backupValue)
    if (requirePrimary && !primaryUserId) throw new BadRequestException('请选择接收招聘流程私信的招聘HR')
    const users = await teable.listAllRecords(this.table('recruitment_users'))
    const resolve = (userId: string, label: string) => {
      if (!userId) return undefined
      const user = users.find((row) => text(row.fields['用户ID']) === userId || row.id === userId)
      if (!user || text(user.fields['用户状态']) === '停用') throw new BadRequestException(`${label}不是有效的系统员工`)
      if (!text(user.fields['天玑微信ID']) && !text(user.fields['企业微信用户ID'])) throw new BadRequestException(`${label}“${text(user.fields['姓名']) || userId}”尚未同步企微成员ID`)
      return { userId: text(user.fields['用户ID']) || user.id, name: text(user.fields['姓名']) || userId }
    }
    const primary = resolve(primaryUserId, '招聘HR')
    const backup = resolve(backupUserId, '备用招聘HR')
    if (primary && backup && primary.userId === backup.userId) throw new BadRequestException('备用招聘HR不能与主招聘HR相同')
    return {
      招聘HR用户ID: primary?.userId || '', 招聘HR: primary?.name || '',
      备用招聘HR用户ID: backup?.userId || '', 备用招聘HR: backup?.name || '',
    }
  }

  private recruitmentApproverWecomUserId() {
    const configured = text(process.env.WECOM_RECRUITMENT_APPROVER_USER_ID)
    return configured === recruitmentApproverUserId ? configured : ''
  }

  private recruitmentApproverConfigurationError() {
    const configured = text(process.env.WECOM_RECRUITMENT_APPROVER_USER_ID)
    return configured
      ? `招聘审批人固定为 ${recruitmentApproverUserId}，当前配置不匹配，已停止发送`
      : '缺少 WECOM_RECRUITMENT_APPROVER_USER_ID'
  }

  private async recruitmentApproverMessageWechatId() {
    const approverWecomUserId = this.recruitmentApproverWecomUserId()
    if (!approverWecomUserId) return ''
    const users = await teable.listAllRecords(this.table('recruitment_users'))
    const configuredRecipient = text(process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID)
    const approver = users.find((row) => text(row.fields['企业微信用户ID']) === approverWecomUserId)
    const recipientOwners = users.filter((row) => text(row.fields['天玑微信ID']) === configuredRecipient)
    const approverId = text(approver?.fields['用户ID']) || approver?.id || ''
    const samePerson = recipientOwners.length === 1 && (text(recipientOwners[0].fields['用户ID']) || recipientOwners[0].id) === approverId
    if (!approver || text(approver.fields['天玑微信ID']) !== recruitmentApproverWechatId || configuredRecipient !== recruitmentApproverWechatId || !samePerson) {
      throw new ServiceUnavailableException('招聘审批人配置不一致：企微审批 ID 与天玑私信 ID 指向不同员工，已停止发送。请统一配置后重试。')
    }
    return configuredRecipient
  }

  private recruitmentApprovalType(value: string): 'position' | 'demand' {
    if (value === 'position' || value === 'demand') return value
    throw new BadRequestException('不支持的招聘审批类型')
  }

  private async assertRecruitmentApprover(actorUserId: string) {
    const configured = this.recruitmentApproverWecomUserId()
    if (!configured) throw new ServiceUnavailableException(this.recruitmentApproverConfigurationError())
    if (actorUserId === configured) return configured
    const users = await teable.listAllRecords(this.table('recruitment_users'))
    const actor = users.find((row) => text(row.fields['用户ID']) === actorUserId || row.id === actorUserId)
    if (!actor || text(actor.fields['企业微信用户ID']) !== configured) {
      const approver = users.find((row) => text(row.fields['企业微信用户ID']) === configured)
      const approverName = text(approver?.fields['姓名'])
      throw new ForbiddenException(`当前登录账号不是指定的招聘审批人${approverName ? `（${approverName}）` : ''}，请使用审批人对应的系统账号打开`)
    }
    return configured
  }

  private async recruitmentApprovalRow(type: 'position' | 'demand', id: string) {
    const tableName = type === 'position' ? 'recruitment_positions' : 'recruitment_monthly_demands'
    const idField = type === 'position' ? '职位ID' : '月度需求ID'
    const tableId = await this.verify(tableName, [idField, '审批状态', '更新时间'])
    const row = await this.find(tableId, idField, id, type === 'position' ? '岗位不存在' : '招聘需求不存在')
    return { tableId, row }
  }

  private mapRecruitmentApproval(type: 'position' | 'demand', row: TeableRecord) {
    const fields = row.fields
    const id = text(fields[type === 'position' ? '职位ID' : '月度需求ID']) || row.id
    const common = {
      type, id, approvalStatus: text(fields['审批状态']) || '待审批', applicant: text(fields['审批申请人']) || text(fields['创建人']),
      submittedAt: text(fields['审批提交时间']) || text(fields['创建时间']), approver: text(fields['审批人']), opinion: text(fields['审批意见']),
      approvedAt: text(fields['审批时间']), notificationStatus: text(fields['审批通知状态']), notificationError: text(fields['审批通知错误']),
    }
    if (type === 'position') return {
      ...common, title: text(fields['职位名称']) || '未命名岗位', department: text(fields['部门']), owner: text(fields['负责人']),
      headcount: number(fields['招聘人数']), salaryText: text(fields['薪资文本']), responsibilities: text(fields['工作职责']), requirements: text(fields['任职要求']),
      publishStatus: text(fields['发布状态']) || '待发布',
    }
    return {
      ...common, title: `${text(fields['需求月份'])} ${text(fields['职位名称']) || '招聘需求'}`, month: text(fields['需求月份']),
      positionName: text(fields['职位名称']), department: text(fields['部门']), owner: text(fields['负责人']), headcount: number(fields['需求数量']),
      demandType: text(fields['需求类型']) || '新增需求', priority: normalizeHiringPriority(fields['优先级']), expectedArrivalDate: text(fields['期望到岗日期']), latestArrivalDate: text(fields['最晚到岗日期']), note: text(fields['需求说明']), demandRequirement: text(fields['需求要求']),
      targetStatus: text(fields['审批通过后状态']) || '已确认', demandStatus: text(fields['需求状态']) || '待审批',
    }
  }

  async retryPendingRecruitmentApprovalNotifications() {
    if (!this.recruitmentApproverWecomUserId() || !this.messages) return { scanned: 0, sent: 0, failed: 0 }
    const sources: Array<{ type: 'position'; table: string }> = [
      { type: 'position', table: 'recruitment_positions' },
    ]
    const result = { scanned: 0, sent: 0, failed: 0 }
    for (const source of sources) {
      const rows = await teable.listAllRecords(this.table(source.table))
      const pending = rows
        .filter((row) => text(row.fields['审批状态']) === '待审批'
          && Boolean(text(row.fields['审批提交时间']))
          && text(row.fields['审批通知状态']) !== '已发送')
        .sort((left, right) => text(left.fields['审批提交时间']).localeCompare(text(right.fields['审批提交时间'])))
        .slice(0, 100)
      for (const row of pending) {
        const idField = source.type === 'position' ? '职位ID' : '月度需求ID'
        const id = text(row.fields[idField]) || row.id
        result.scanned += 1
        const notification = await this.sendRecruitmentApprovalRequest(source.type, id, row, text(row.fields['审批申请人']) || text(row.fields['创建人']) || '系统补发')
        if (notification.status === '已发送') result.sent += 1
        else if (notification.status !== '发送中') result.failed += 1
      }
    }
    return result
  }

  private approvalDemandNote(approval: { demandRequirement?: string; note?: string }) {
    const requirement = text(approval.demandRequirement)
    const rawNote = text(approval.note)
    const marker = rawNote.match(/(?:^|[\s;；])招聘要求[:：]/)
    if (!marker || marker.index === undefined) return { requirement: requirement || '未填写', note: rawNote || '未填写' }
    const requirementStart = marker.index + marker[0].length
    const parsedRequirement = rawNote.slice(requirementStart).trim()
    const parsedNote = rawNote.slice(0, marker.index).replace(/[;；\s]+$/g, '').trim()
    return {
      requirement: requirement || parsedRequirement || '未填写',
      note: parsedNote || '未填写',
    }
  }

  private async sendRecruitmentApprovalRequest(type: 'position' | 'demand', id: string, row: TeableRecord, operator: string) {
    const lockKey = `${type}:${id}`
    if (this.approvalNotificationLocks.has(lockKey)) return { status: '发送中', error: '' }
    if (text(row.fields['审批通知状态']) === '已发送') return { status: '已发送', error: '' }
    this.approvalNotificationLocks.add(lockKey)
    const approver = this.recruitmentApproverWecomUserId()
    const tableId = this.table(type === 'position' ? 'recruitment_positions' : 'recruitment_monthly_demands')
    const updateNotification = async (status: string, error = '') => {
      const notificationFields = { 审批人企微ID: approver || text(row.fields['审批人企微ID']), 审批通知状态: status, 审批通知错误: error, 更新时间: timestamp() }
      await teable.updateRecord(tableId, row.id, notificationFields)
      row.fields = { ...row.fields, ...notificationFields }
      return { status, error }
    }
    try {
      if (!approver) return await updateNotification('未配置', this.recruitmentApproverConfigurationError())
      if (!this.messages) return await updateNotification('未发送', '消息服务不可用')
      const messageRecipient = await this.recruitmentApproverMessageWechatId()
      if (!messageRecipient) return await updateNotification('未配置', '无法匹配指定招聘审批人的天玑微信ID，请先同步审批人员工信息')
      await updateNotification('发送中')
      const approval: any = this.mapRecruitmentApproval(type, row)
      const approvalUrl = appFlowUrl('recruitment_approval', { approval_type: type, approval_id: id })
      const demandNote = this.approvalDemandNote(approval)
      const lines = type === 'position'
        ? [`【新增岗位审批】${approval.title}`, `申请人：${approval.applicant || operator}`, `部门：${approval.department || '待补充'}`, `薪资：${approval.salaryText || '待补充'}`]
        : [`【新增招聘需求审批】${approval.positionName || approval.title}`, `申请人：${approval.applicant || operator}`, `申请岗位：${approval.positionName || '待补充'}`, `部门：${approval.department || '待补充'}`, `需求人数：${approval.headcount || 0}`, `需求类型：${approval.demandType || '新增需求'}`, `优先级：${approval.priority || '储备'}`, `需求要求：${demandNote.requirement}`, `需求说明：${demandNote.note}`]
      if (approvalUrl) lines.push(`[点击打开审批页面 →](${approvalUrl})`)
      lines.push('只有你审批通过后，该需求或岗位才允许生效和发布。')
      const preview = await this.messages.preview({
        category: type === 'position' ? '新增岗位审批' : '新增招聘需求审批', channel: '企业微信单聊', recipientType: '员工',
        recipientAddress: messageRecipient, objectType: type === 'position' ? '岗位' : '月度需求', objectId: id, content: lines.join('\n'), operator,
      })
      await this.messages.send(preview.messageId, { confirmed: true, operator })
      return updateNotification('已发送')
    } catch (error) {
      return updateNotification('发送失败', error instanceof Error ? error.message : String(error))
    } finally {
      this.approvalNotificationLocks.delete(lockKey)
    }
  }

  private assertPositionApproved(row: TeableRecord) {
    if (!text(row.fields['审批提交时间'])) return
    const status = text(row.fields['审批状态']) || '待审批'
    if (status !== '已通过') throw new BadRequestException(`岗位审批状态为“${status}”，指定审批人通过后才能发布`)
  }

  private async find(tableId: string, field: string, id: string, message: string) {
    let row: TeableRecord | undefined
    try {
      row = await teable.getRecord(tableId, id)
    } catch {
      row = await teable.findOneByField(tableId, field, id)
    }
    if (!row) throw new NotFoundException(message)
    return row
  }

  private mapPosition(row: TeableRecord, tasks: TeableRecord[], applications: TeableRecord[]) {
    const f = row.fields
    const id = text(f['职位ID']) || row.id
    const headcount = number(f['招聘人数'])
    const taskRows = tasks.filter((item) => text(item.fields['职位ID']) === id)
    const applicationRows = applications.filter((item) => text(item.fields['职位ID']) === id)
    const arrivedCandidates = this.uniqueApplicationCandidates(applicationRows.filter((item) => this.isArrived(item)))
    const acceptedCandidates = this.uniqueApplicationCandidates(applicationRows.filter((item) => this.isOfferAccepted(item)))
    const arrived = Math.max(number(f['已到岗人数']), arrivedCandidates.size)
    return {
      id, name: text(f['职位名称']), code: text(f['职位编码']),
      departmentId: text(f['部门ID']), department: text(f['部门']), ownerUserId: text(f['负责人用户ID']), owner: text(f['负责人']),
      recruiterUserId: text(f['招聘HR用户ID']), recruiter: text(f['招聘HR']), backupRecruiterUserId: text(f['备用招聘HR用户ID']), backupRecruiter: text(f['备用招聘HR']),
      category: text(f['招聘类别']), level: text(f['岗位层级']) || '普通岗位', city: text(f['工作城市']),
      location: text(f['工作地点']), minSalary: number(f['最低薪资']), maxSalary: number(f['最高薪资']), salaryText: text(f['薪资文本']),
      jobDescription: text(f['岗位JD']), responsibilities: text(f['工作职责']), requirements: text(f['任职要求']),
      benefits: text(f['福利']), tags: json<string[]>(f['标签JSON'], []), status: text(f['发布状态']) || '待发布',
      recruitmentStatus: text(f['招聘状态']) || '待启动', demandType: text(f['需求类型']) || '新增需求',
      priority: normalizeHiringPriority(text(f['优先级']) || '中'), expectedArrivalDate: text(f['期望到岗日期']), latestArrivalDate: text(f['最晚到岗日期']), approvalStatus: text(f['审批状态']) || (text(f['审批提交时间']) ? '待审批' : '已通过'),
      approvalSubmittedAt: text(f['审批提交时间']), approvalApplicant: text(f['审批申请人']), approver: text(f['审批人']),
      approvalOpinion: text(f['审批意见']), approvedAt: text(f['审批时间']), approvalNotificationStatus: text(f['审批通知状态']),
      approvalNotificationError: text(f['审批通知错误']),
      headcount, arrived, remainingHeadcount: Math.max(0, headcount - arrived),
      currentEmployeeCount: number(f['在职人数']), acceptedCount: acceptedCandidates.size,
      publishedAt: text(f['发布时间']), applicantCount: applicationRows.length || number(f['应聘人数缓存']),
      collectionTaskCount: taskRows.length, latestCollectionStatus: text(taskRows.at(-1)?.fields['任务状态']),
      jdVersion: number(f['JD版本']) || 1, rematchStatus: text(f['重匹配状态']) || '无需重匹配', pendingRematchCount: number(f['待重匹配人数']),
      latestJdChangedAt: text(f['最近JD变更时间']), latestJdChangeReason: text(f['最近JD变更原因']), lastRematchedAt: text(f['最近重匹配时间']),
      createdAt: text(f['创建时间']), updatedAt: text(f['更新时间']),
    }
  }

  private mapTask(row: TeableRecord) {
    const f = row.fields
    return {
      id: text(f['采集任务ID']) || row.id, demandId: text(f['需求ID']), positionId: text(f['职位ID']),
      name: text(f['任务名称']), platforms: json<string[]>(f['目标平台JSON'], []), filters: json<Record<string, unknown>>(f['采集条件JSON'], {}),
      targetCount: number(f['目标简历数']), status: text(f['任务状态']), externalTaskId: text(f['外部任务ID']),
      claimedBy: text(f['领取人']), lastHeartbeatAt: text(f['最近心跳时间']), retryCount: number(f['重试次数']),
      collectedCount: number(f['已采集数量']), importedCount: number(f['成功入库数量']),
      lastResult: json<Record<string, unknown>>(f['最近结果JSON'], {}), error: text(f['错误信息']),
      createdAt: text(f['创建时间']), updatedAt: text(f['更新时间']),
    }
  }

  private mapChannel(row: TeableRecord) {
    const f = row.fields
    return {
      id: text(f['渠道ID']) || row.id, name: text(f['渠道名称']), type: text(f['渠道类型']), status: text(f['渠道状态']) || '启用',
      ownerUserId: text(f['渠道负责人用户ID']), owner: text(f['渠道负责人']), frequency: text(f['默认采集频率']) || '手动',
      targetCount: number(f['单次目标简历数']), config: json<Record<string, unknown>>(f['平台配置JSON'], {}), description: text(f['说明']),
      lastRunAt: text(f['最近运行时间']), nextRunAt: text(f['下次运行时间']), createdAt: text(f['创建时间']), updatedAt: text(f['更新时间']),
    }
  }

  private mapChannelBinding(row: TeableRecord) {
    const f = row.fields
    return {
      id: text(f['职位渠道ID']) || row.id, positionId: text(f['职位ID']), demandId: text(f['需求ID']), channelId: text(f['渠道ID']),
      channelName: text(f['渠道名称']), status: text(f['绑定状态']), frequency: text(f['采集频率']), targetCount: number(f['目标简历数']),
      filters: json<Record<string, unknown>>(f['采集条件JSON'], {}), owner: text(f['渠道负责人']), createdAt: text(f['创建时间']), updatedAt: text(f['更新时间']),
    }
  }


  private uniqueApplicationCandidates(rows: TeableRecord[]) {
    return new Set(rows.map((row) => text(row.fields['候选人ID']) || text(row.fields['应聘记录ID']) || row.id))
  }

  private isArrived(row: TeableRecord) {
    return ['已入职', '入职'].includes(text(row.fields['当前阶段'])) || ['已入职', '已完成'].includes(text(row.fields['当前状态']))
  }

  private isOfferAccepted(row: TeableRecord) {
    return ['背调', '待入职', '已入职', '入职'].includes(text(row.fields['当前阶段']))
      || ['Offer已接受', '待入职', '已入职'].includes(text(row.fields['当前状态']))
  }

  private async ensureDepartment(value: unknown, operator: string) {
    const name = text(value)
    if (!name) return { id: '', name: '' }
    const tableId = await this.verify('recruitment_organization_units', ['组织单元ID', '组织类型', '组织名称', '组织状态', '创建时间', '更新时间'])
    const rows = await teable.listAllRecords(tableId)
    const existing = rows.find((row) => text(row.fields['组织类型']) === '部门' && normalizeDepartmentName(row.fields['组织名称']) === normalizeDepartmentName(name))
    if (existing) return { id: text(existing.fields['组织单元ID']) || existing.id, name: text(existing.fields['组织名称']) || name }
    const departmentId = businessId('org'), now = timestamp()
    const fields = {
      组织单元ID: departmentId, 组织类型: '部门', 组织编码: '', 组织名称: name, 上级组织单元ID: '',
      负责人用户ID: '', 负责人: '', 组织状态: '启用', 排序: 0, 来源类型: '岗位自动同步',
      创建时间: now, 更新时间: now,
    }
    await teable.createRecord(tableId, fields)
    await this.audit('从岗位同步部门', '组织单元', departmentId, {}, fields, operator, `需求部门：${name}`)
    return { id: departmentId, name }
  }

  private async collectionTaskRow(id: string) {
    const tableId = await this.verify('recruitment_collection_tasks', ['采集任务ID', '任务状态', '已采集数量', '成功入库数量', '更新时间'])
    const row = await this.find(tableId, '采集任务ID', id, '采集任务不存在')
    return { tableId, row }
  }

  private async collectionTaskEvent(
    row: TeableRecord,
    from: string,
    to: string,
    action: string,
    operator: string,
    body: CollectionTaskProgressInput = {},
  ) {
    const tableId = await this.verify('recruitment_collection_task_events', ['采集事件ID', '采集任务ID', '原状态', '新状态', '操作', '发生时间'])
    const fields = row.fields || {}
    await teable.createRecord(tableId, {
      采集事件ID: businessId('collectevt'), 采集任务ID: text(fields['采集任务ID']) || row.id,
      职位ID: text(fields['职位ID']), 需求ID: text(fields['需求ID']), 原状态: from, 新状态: to, 操作: action,
      外部任务ID: text(body.externalTaskId) || text(fields['外部任务ID']),
      已采集数量: number(body.collectedCount ?? fields['已采集数量']),
      成功入库数量: number(body.importedCount ?? fields['成功入库数量']),
      结果JSON: JSON.stringify(body.result || json<Record<string, unknown>>(fields['最近结果JSON'], {})),
      错误信息: text(body.error) || text(fields['错误信息']), 操作人: operator, 发生时间: timestamp(),
    })
  }

  private async createCollectionAlert(row: TeableRecord, error: string) {
    const taskId = text(row.fields['采集任务ID']) || row.id
    const tableId = await this.verify('recruitment_tasks', ['待办ID', '待办类型', '对象类型', '对象ID', '标题', '待办状态', '创建时间', '更新时间'])
    const rows = await teable.listAllRecords(tableId)
    const existing = rows.find((item) => text(item.fields['待办类型']) === 'RPA采集异常' && text(item.fields['对象ID']) === taskId && text(item.fields['待办状态']) !== '已完成')
    const now = timestamp()
    const deadline = new Date(Date.now() + 4 * 60 * 60_000).toISOString()
    const fields = {
      待办类型: 'RPA采集异常', 对象类型: '采集任务', 对象ID: taskId,
      标题: `RPA采集异常：${text(row.fields['任务名称']) || taskId}`, 描述: error,
      处理人: text(row.fields['创建人']) || '招聘管理员', 优先级: '高', 待办状态: '待处理',
      截止时间: deadline, 提醒时间: now, 更新时间: now,
    }
    if (existing) await teable.updateRecord(tableId, existing.id, fields)
    else await teable.createRecord(tableId, { 待办ID: businessId('todo'), ...fields, 创建时间: now })
  }

  private async resolveCollectionAlerts(collectionTaskId: string) {
    const tableId = this.table('recruitment_tasks')
    const rows = await teable.listAllRecords(tableId)
    const now = timestamp()
    for (const row of rows.filter((item) => text(item.fields['待办类型']) === 'RPA采集异常' && text(item.fields['对象ID']) === collectionTaskId && text(item.fields['待办状态']) !== '已完成')) {
      await teable.updateRecord(tableId, row.id, { 待办状态: '已完成', 完成时间: now, 更新时间: now })
    }
  }

  private async savePositionVersion(_positionId: string, _fields: Record<string, unknown>, _headcount: number, _reason: string, _operator: string) {
    // Position version tracking removed during demand-position merge simplification
  }

  private async audit(action: string, objectType: string, objectId: string, before: unknown, after: unknown, operator: string, reason = '') {
    const tableId = await this.verify('recruitment_audit_logs', ['日志ID', '操作类型', '对象类型', '对象ID', '发生时间'])
    await teable.createRecord(tableId, {
      日志ID: businessId('audit'), 操作人: operator, 操作类型: action, 对象类型: objectType, 对象ID: objectId,
      修改前摘要JSON: JSON.stringify(before), 修改后摘要JSON: JSON.stringify(after), 操作原因: reason,
      请求ID: businessId('req'), 发生时间: timestamp(), 操作结果: '成功', 错误信息: '',
    })
  }

  private auditAsync(action: string, objectType: string, objectId: string, before: unknown, after: unknown, operator: string, reason = '') {
    void this.audit(action, objectType, objectId, before, after, operator, reason).catch((error) => {
      console.error(`[Recruitment audit] ${action} failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private positionCode() {
    const date = new Date()
    const day = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
    return `JOB-${day}-${randomUUID().slice(0, 4).toUpperCase()}`
  }
}
