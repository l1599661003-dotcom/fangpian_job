import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { teable } from '../../platform/teable'
import { DatabaseService } from './database.service'
import type { Request } from 'express'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canReadInterview, InterviewAccessScope } from '../interviews/interview-access'

export const EMPLOYEE_SESSION_COOKIE_EXPIRES_AT = '2099-12-31T23:59:59.999Z'

export interface UserRoleBinding {
  id: string
  userId: string
  userName: string
  roleCode: string
  businessUnitId: string
  departmentIds: string[]
  startsAt: string
  expiresAt: string
}

export interface RoleAccessProfile {
  userId: string
  roleCodes: string[]
  pages: string[]
  actions: string[]
  dataScopes: Array<{
    roleCode: string
    type: string
    businessUnitId: string
    departmentIds: string[]
  }>
  sensitiveFields: Record<string, unknown>[]
}

export interface RequestIdentity {
  userId: string
  userName: string
  source: 'studio' | 'development' | 'session'
}

export interface TalentAccessContext {
  candidateId: string
  subjectUserId?: string
  ownerUserId?: string
  departmentIds?: string[]
  businessUnitId?: string
  interviewerUserIds?: string[]
  stage?: string
  unlockedFields?: string[]
}

function parseStringArray(value: unknown): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isActiveBinding(status: unknown, startsAt: unknown, expiresAt: unknown, now = Date.now()) {
  if (String(status || '') !== '启用') return false
  const start = startsAt ? Date.parse(String(startsAt)) : Number.NaN
  const end = expiresAt ? Date.parse(String(expiresAt)) : Number.NaN
  if ((startsAt && !Number.isFinite(start)) || (expiresAt && !Number.isFinite(end))) return false
  if (Number.isFinite(start) && start > now) return false
  if (Number.isFinite(end) && end <= now) return false
  return true
}

@Injectable()
export class RoleAccessService {
  private readonly loginAttempts = new Map<string, { count: number; resetAt: number }>()
  // 进程内权限缓存：避免每个非公开 API 请求重复查询角色元数据。
  // TTL 60 秒，写操作 (assignRole/revokeRole) 主动失效。
  private static readonly ACCESS_CACHE_TTL_MS = 60_000
  private accessCache = new Map<string, { profile: RoleAccessProfile; expiresAt: number }>()
  private fieldsCache = new Map<string, { fields: Awaited<ReturnType<typeof teable.listFields>>; expiresAt: number }>()
  private accessInflight = new Map<string, Promise<RoleAccessProfile>>()
  private accessRevision = 0
  constructor(private readonly database: DatabaseService) {}

  async interviewScope(identity: RequestIdentity, profile: RoleAccessProfile): Promise<InterviewAccessScope> {
    if (profile.roleCodes.includes('system_admin')) return { all: true, userIds: [identity.userId] }
    const userIds = new Set([identity.userId].filter(Boolean))
    const users = await teable.listByField(this.database.requireTableId('recruitment_users'), '用户ID', identity.userId, 2)
    const user = users.find(row => String(row.fields['用户ID'] || '') === identity.userId)
    if (user) {
      userIds.add(user.id)
      const wecomId = String(user.fields['企业微信用户ID'] || '').trim()
      if (wecomId) userIds.add(wecomId)
    }
    const pool = await teable.listAllRecords(this.database.requireTableId('recruitment_interviewer_pool'))
    const accountIds = new Set(userIds)
    for (const row of pool) {
      if (!accountIds.has(String(row.fields['用户ID'] || ''))) continue
      const interviewerId = String(row.fields['面试官ID'] || '')
      if (interviewerId) userIds.add(interviewerId)
      userIds.add(row.id)
    }
    return { all: false, userIds: [...userIds] }
  }

  async assertInterviewAccess(interviewId: string, scope: InterviewAccessScope) {
    const table = this.database.requireTableId('recruitment_interviews')
    let row = await teable.findOneByField(table, '面试ID', interviewId)
    if (!row && interviewId.startsWith('rec')) row = await teable.getRecord(table, interviewId)
    if (!row || !canReadInterview(row, scope)) throw new ForbiddenException('只能查看或操作本人参与、组织的面试记录')
  }

  /** 使某个用户的权限缓存失效。assignRole / revokeRole 等写操作后必须调用。 */
  invalidateUserAccess(userId: string) {
    if (userId) this.invalidateRoleMetadata()
  }

  invalidateRoleMetadata() {
    this.accessRevision += 1
    this.accessCache.clear()
    this.fieldsCache.clear()
    this.accessInflight.clear()
  }

  async getUserAccess(userId: string): Promise<RoleAccessProfile> {
    if (process.env.LOCAL_EMPLOYEE_LOGIN === 'true' && process.env.NODE_ENV !== 'production' && this.exportedEmployees().some((row) => String(row.fields['用户ID'] || row.id) === userId)) {
      return this.exportedEmployeeAccess(userId)
    }
    if (userId === 'local-preview' && process.env.LOCAL_PREVIEW_LOGIN === 'true' && process.env.NODE_ENV !== 'production') {
      return this.localPreviewAccess()
    }
    if (!userId.trim()) return { userId: '', roleCodes: [], pages: [], actions: [], dataScopes: [], sensitiveFields: [] }
    const cached = this.accessCache.get(userId)
    if (cached && cached.expiresAt > Date.now()) return cached.profile
    const inflight = this.accessInflight.get(userId)
    if (inflight) return inflight
    const revision = this.accessRevision
    const loading = this.loadUserAccess(userId, revision).then((profile) => revision === this.accessRevision ? profile : this.getUserAccess(userId))
    this.accessInflight.set(userId, loading)
    try {
      return await loading
    } finally {
      if (this.accessInflight.get(userId) === loading) this.accessInflight.delete(userId)
    }
  }

  private async loadUserAccess(userId: string, revision: number): Promise<RoleAccessProfile> {
    const bindingsTableId = this.database.getTableId('recruitment_user_roles')
    const rolesTableId = this.database.getTableId('recruitment_roles')
    if (!bindingsTableId || !rolesTableId) throw new Error('角色权限数据库尚未初始化')

    const fields = async (tableId: string) => {
      const cached = this.fieldsCache.get(tableId)
      if (cached && cached.expiresAt > Date.now()) return cached.fields
      const value = await teable.listFields(tableId)
      this.fieldsCache.set(tableId, { fields: value, expiresAt: Date.now() + RoleAccessService.ACCESS_CACHE_TTL_MS })
      return value
    }
    const [bindingFields, roleFields] = await Promise.all([fields(bindingsTableId), fields(rolesTableId)])
    if (!bindingFields.some((field) => field.name === '用户ID')) throw new Error('用户角色表缺少用户ID字段')
    if (!roleFields.some((field) => field.name === '角色编码')) throw new Error('角色表缺少角色编码字段')

    const bindingRows = await teable.listByField(bindingsTableId, '用户ID', userId, 100)
    const bindings: UserRoleBinding[] = bindingRows
      .filter((row) => String(row.fields['用户ID'] || '') === userId && isActiveBinding(row.fields['绑定状态'], row.fields['生效时间'], row.fields['失效时间']))
      .map((row) => ({
        id: row.id,
        userId,
        userName: String(row.fields['用户姓名'] || ''),
        roleCode: String(row.fields['角色编码'] || ''),
        businessUnitId: String(row.fields['事业部ID'] || ''),
      // 员工与权限配置均采用单部门模型；历史多部门绑定只使用第一个部门，避免扩大数据范围。
      departmentIds: parseStringArray(row.fields['部门IDJSON']).slice(0, 1),
        startsAt: String(row.fields['生效时间'] || ''),
        expiresAt: String(row.fields['失效时间'] || ''),
      }))
    const roleCodes = new Set(bindings.map((binding) => binding.roleCode).filter(Boolean))
    const roleRows = await teable.listByAnyField(rolesTableId, '角色编码', [...roleCodes], 100)
    const activeRoles = roleRows.filter((row) => roleCodes.has(String(row.fields['角色编码'] || '')) && String(row.fields['角色状态'] || '') === '启用')
    const pages = new Set<string>()
    const actions = new Set<string>()
    const sensitiveFields: Record<string, unknown>[] = []
    const dataScopes: RoleAccessProfile['dataScopes'] = []

    for (const role of activeRoles) {
      const roleCode = String(role.fields['角色编码'] || '')
      parseStringArray(role.fields['页面权限JSON']).forEach((page) => pages.add(page))
      parseStringArray(role.fields['操作权限JSON']).forEach((action) => actions.add(action))
      sensitiveFields.push({ roleCode, ...parseObject(role.fields['敏感字段策略JSON']) })
      for (const binding of bindings.filter((item) => item.roleCode === roleCode)) {
        dataScopes.push({
          roleCode,
          type: String(role.fields['数据范围类型'] || ''),
          businessUnitId: binding.businessUnitId,
          departmentIds: binding.departmentIds,
        })
      }
    }

    const profile = { userId, roleCodes: activeRoles.map((role) => String(role.fields['角色编码'])), pages: [...pages], actions: [...actions], dataScopes, sensitiveFields }
    const expiresAt = Math.min(Date.now() + RoleAccessService.ACCESS_CACHE_TTL_MS, ...bindingRows.flatMap((row) => [row.fields['生效时间'], row.fields['失效时间']]).map((value) => Date.parse(String(value || ''))).filter((value) => value > Date.now()))
    if (revision === this.accessRevision) this.accessCache.set(userId, { profile, expiresAt })
    return profile
  }

  hasPage(profile: RoleAccessProfile, page: string) {
    return profile.pages.includes('*') || profile.pages.includes(page)
  }

  hasAction(profile: RoleAccessProfile, action: string) {
    return profile.actions.includes('*') || profile.actions.includes(action)
  }

  resolveIdentity(headers: Record<string, string | string[] | undefined>): RequestIdentity | null {
    const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value || '']))
    const idHeader = (process.env.STUDIO_IDENTITY_USER_ID_HEADER || 'x-studio-user-id').toLowerCase()
    const nameHeader = (process.env.STUDIO_IDENTITY_USER_NAME_HEADER || 'x-studio-user-name').toLowerCase()
    const studioUserId = this.decodeHeader(normalized[idHeader])
    if (studioUserId) return { userId: studioUserId, userName: this.decodeHeader(normalized[nameHeader]) || studioUserId, source: 'studio' }
    const developmentAllowed = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_IDENTITY_HEADERS === 'true'
    const developmentUserId = developmentAllowed ? this.decodeHeader(normalized['x-user-id']) : ''
    if (developmentUserId) return { userId: developmentUserId, userName: this.decodeHeader(normalized['x-user-name']) || developmentUserId, source: 'development' }
    return null
  }

  async resolveRequestIdentity(headers: Record<string, string | string[] | undefined>): Promise<RequestIdentity | null> {
    const token = this.sessionToken(headers)
    const exported = this.exportedEmployeeIdentity(token)
    if (exported) return exported
    const preview = this.previewIdentity(token)
    if (preview) return preview
    if (!token) return this.resolveIdentity(headers)
    const tableId = this.database.getTableId('recruitment_login_sessions')
    if (!tableId) return null
    const tokenHash = this.hashToken(token)
    const session = await teable.findOneByField(tableId, '令牌哈希', tokenHash)
    if (!session) return null
    if (String(session.fields['会话状态'] || '') !== '有效') return null
    const usersTableId = this.database.getTableId('recruitment_users')
    if (!usersTableId) return null
    const account = await teable.findOneByField(usersTableId, '用户ID', String(session.fields['用户ID'] || ''))
    if (!account || String(account.fields['用户状态'] || '') !== '启用') return null
    return {
      userId: String(session.fields['用户ID'] || ''),
      userName: String(session.fields['用户姓名'] || session.fields['用户ID'] || ''),
      source: 'session',
    }
  }

  async loginWithEmployeeProfile(input: { name?: string; mobile?: string }, meta: { ip?: string; userAgent?: string }) {
    if (process.env.LOCAL_EMPLOYEE_LOGIN === 'true' && process.env.NODE_ENV !== 'production') {
      return this.loginFromExportedEmployees(input)
    }
    if (process.env.LOCAL_PREVIEW_LOGIN === 'true' && process.env.NODE_ENV !== 'production') {
      return this.loginLocalPreview(input)
    }
    const name = String(input.name || '').normalize('NFKC').trim().replace(/\s+/g, '')
    const mobile = String(input.mobile || '').replace(/\s|-/g, '')
    if (!name) throw new UnauthorizedException('请填写姓名')
    if (!/^1[3-9]\d{9}$/.test(mobile)) throw new UnauthorizedException('请填写正确的11位手机号')
    const attemptKey = `${meta.ip || 'unknown'}:${mobile}`, attempt = this.loginAttempts.get(attemptKey), timestamp = Date.now()
    if (attempt && attempt.resetAt > timestamp && attempt.count >= 5) throw new UnauthorizedException('登录尝试过于频繁，请10分钟后再试')
    const usersTableId = this.database.requireTableId('recruitment_users')
    const userFields = await teable.listFields(usersTableId)
    if (!['用户ID', '姓名', '手机', '用户状态'].every((field) => userFields.some((item) => item.name === field))) throw new Error('员工账号表字段不完整')
    const users = await teable.listByField(usersTableId, '手机', mobile, 20)
    const account = users.find((row) => String(row.fields['姓名'] || '').normalize('NFKC').trim().replace(/\s+/g, '') === name
      && String(row.fields['手机'] || '').replace(/\s|-/g, '') === mobile
      && String(row.fields['用户状态'] || '') === '启用')
    if (!account) {
      this.loginAttempts.set(attemptKey, { count: attempt && attempt.resetAt > timestamp ? attempt.count + 1 : 1, resetAt: timestamp + 10 * 60_000 })
      throw new UnauthorizedException('姓名或手机号不正确，或者账号尚未由管理员启用')
    }
    this.loginAttempts.delete(attemptKey)
    const sessionsTableId = this.database.requireTableId('recruitment_login_sessions')
    const sessionFields = await teable.listFields(sessionsTableId)
    for (const field of ['会话ID', '用户ID', '用户姓名', '令牌哈希', '会话状态', '创建时间', '过期时间']) {
      if (!sessionFields.some((item) => item.name === field)) throw new Error(`登录会话表缺少字段：${field}`)
    }
    const token = randomBytes(32).toString('base64url'), now = new Date(), expiresAt = new Date(EMPLOYEE_SESSION_COOKIE_EXPIRES_AT)
    const userId = String(account.fields['用户ID'] || account.id), userName = String(account.fields['姓名'] || name)
    await teable.createRecord(sessionsTableId, {
      会话ID: `session_${randomUUID().replaceAll('-', '')}`, 用户ID: userId, 用户姓名: userName,
      令牌哈希: this.hashToken(token), 会话状态: '有效', 创建时间: now.toISOString(),
      过期时间: expiresAt.toISOString(), 最近访问时间: now.toISOString(), 来源IP: meta.ip || '', 身份来源: 'session', 客户端信息: meta.userAgent || '',
    })
    return { token, expiresAt: expiresAt.toISOString(), identity: { userId, userName, source: 'session' as const } }
  }

  private localPreviewEnabled() {
    return process.env.LOCAL_PREVIEW_LOGIN === 'true' && process.env.NODE_ENV !== 'production'
  }

  private loginFromExportedEmployees(input: { name?: string; mobile?: string }) {
    const name = String(input.name || '').normalize('NFKC').trim().replace(/\s+/g, '')
    const mobile = String(input.mobile || '').replace(/\s|-/g, '')
    if (!name) throw new UnauthorizedException('请填写姓名')
    if (!/^1[3-9]\d{9}$/.test(mobile)) throw new UnauthorizedException('请填写正确的11位手机号')
    const account = this.exportedEmployees().find((row) => this.sameEmployeeName(row.fields['姓名'], name)
      && String(row.fields['手机'] || '').replace(/\s|-/g, '') === mobile
      && String(row.fields['用户状态'] || '') === '启用')
    if (!account) throw new UnauthorizedException('姓名或手机号不正确，或者账号尚未由管理员启用')
    const userId = String(account.fields['用户ID'] || account.id)
    const userName = String(account.fields['姓名'] || name)
    return {
      token: `local-employee:${userId}`,
      expiresAt: EMPLOYEE_SESSION_COOKIE_EXPIRES_AT,
      identity: { userId, userName, source: 'session' as const },
    }
  }

  private exportedEmployeeIdentity(token: string): RequestIdentity | null {
    if (process.env.LOCAL_EMPLOYEE_LOGIN !== 'true' || process.env.NODE_ENV === 'production' || !token.startsWith('local-employee:')) return null
    const userId = token.slice('local-employee:'.length)
    const account = this.exportedEmployees().find((row) => String(row.fields['用户ID'] || row.id) === userId && String(row.fields['用户状态'] || '') === '启用')
    if (!account) return null
    return { userId, userName: String(account.fields['姓名'] || userId), source: 'session' }
  }

  private exportedEmployeeAccess(userId: string): RoleAccessProfile {
    const bindings = this.exportedRoleBindings().filter((row) => String(row.fields['用户ID'] || '') === userId && String(row.fields['绑定状态'] || '') === '启用')
    const roleCodes = [...new Set(bindings.map((row) => String(row.fields['角色编码'] || '')).filter(Boolean))]
    const activeRoles = this.exportedRoles().filter((role) => roleCodes.includes(String(role.fields['角色编码'] || '')) && String(role.fields['角色状态'] || '启用') !== '停用')
    const pages = new Set<string>()
    const actions = new Set<string>()
    const sensitiveFields: Record<string, unknown>[] = []
    const dataScopes = []
    for (const role of activeRoles) {
      const roleCode = String(role.fields['角色编码'] || '')
      this.parseExportedArray(role.fields['页面权限JSON']).forEach((page) => pages.add(page))
      this.parseExportedArray(role.fields['操作权限JSON']).forEach((action) => actions.add(action))
      sensitiveFields.push({ roleCode, ...this.parseExportedObject(role.fields['敏感字段策略JSON']) })
      for (const binding of bindings.filter((row) => String(row.fields['角色编码'] || '') === roleCode)) {
        dataScopes.push({
          roleCode,
          type: String(role.fields['数据范围类型'] || ''),
          businessUnitId: String(binding.fields['事业部ID'] || ''),
          departmentIds: this.parseExportedArray(binding.fields['部门IDJSON']).slice(0, 1),
        })
      }
    }
    return { userId, roleCodes: activeRoles.map((role) => String(role.fields['角色编码'] || '')), pages: [...pages], actions: [...actions], dataScopes, sensitiveFields }
  }

  exportedAccount(userId: string) {
    return this.exportedEmployees().find((row) => String(row.fields['用户ID'] || row.id) === userId) || null
  }

  private exportedEmployees() {
    return this.readExport('82_recruitment_users.json')
  }

  private exportedRoleBindings() {
    return this.readExport('68_recruitment_user_roles.json')
  }

  private exportedRoles() {
    return this.readExport('67_recruitment_roles.json')
  }

  private readExport(fileName: string) {
    const filePath = join(__dirname, '..', '..', '..', '..', 'database', fileName)
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  }

  private sameEmployeeName(value: unknown, name: string) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, '') === name
  }

  private parseExportedArray(value: unknown) {
    if (Array.isArray(value)) return value.map(String)
    return parseStringArray(value)
  }

  private parseExportedObject(value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    return parseObject(value)
  }

  private loginLocalPreview(input: { name?: string; mobile?: string }) {
    const name = String(input.name || '').normalize('NFKC').trim().replace(/\s+/g, '')
    const mobile = String(input.mobile || '').replace(/\s|-/g, '')
    if (!name) throw new UnauthorizedException('请填写姓名')
    if (!/^1[3-9]\d{9}$/.test(mobile)) throw new UnauthorizedException('请填写正确的11位手机号')
    return {
      token: 'local-preview',
      expiresAt: EMPLOYEE_SESSION_COOKIE_EXPIRES_AT,
      identity: { userId: 'local-preview', userName: name, source: 'session' as const },
    }
  }

  private previewIdentity(token: string): RequestIdentity | null {
    if (!this.localPreviewEnabled() || token !== 'local-preview') return null
    return { userId: 'local-preview', userName: '本地预览', source: 'session' }
  }

  private localPreviewAccess(): RoleAccessProfile {
    return {
      userId: 'local-preview',
      roleCodes: ['system_admin'],
      pages: ['*'],
      actions: ['*'],
      dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }],
      sensitiveFields: [{ roleCode: 'system_admin', salary: 'full', contacts: 'full', resume: 'full' }],
    }
  }

  async recordLoginHeartbeat(headers: Record<string, string | string[] | undefined>) {
    const identity = await this.resolveRequestIdentity(headers)
    if (!identity) throw new UnauthorizedException('登录状态已失效，请重新登录')
    if (process.env.LOCAL_EMPLOYEE_LOGIN === 'true' && process.env.NODE_ENV !== 'production') return { recorded: true, lastActiveAt: new Date().toISOString() }
    const tableId = this.database.requireTableId('recruitment_login_sessions')
    const timestamp = new Date().toISOString()
    if (identity.source === 'session') {
      const token = this.sessionToken(headers)
      if (!token) throw new UnauthorizedException('登录状态已失效，请重新登录')
      const session = await teable.findOneByField(tableId, '令牌哈希', this.hashToken(token))
      if (!session || String(session.fields['会话状态'] || '') !== '有效') throw new UnauthorizedException('登录状态已失效，请重新登录')
      await teable.updateRecord(tableId, session.id, { 用户姓名: identity.userName, 最近访问时间: timestamp, 身份来源: identity.source })
      return { recorded: true, lastActiveAt: timestamp }
    }

    const usersTableId = this.database.requireTableId('recruitment_users')
    const account = await teable.findOneByField(usersTableId, '用户ID', identity.userId)
    if (!account || String(account.fields['用户状态'] || '') !== '启用') throw new UnauthorizedException('员工账号不存在或未启用')
    const userName = String(account.fields['姓名'] || identity.userName || identity.userId)
    const sessionId = `identity_${this.hashToken(`${identity.source}:${identity.userId}`).slice(0, 32)}`
    const session = await teable.findOneByField(tableId, '会话ID', sessionId)
    const fields = {
      会话ID: sessionId,
      用户ID: identity.userId,
      用户姓名: userName,
      令牌哈希: this.hashToken(`${identity.source}:${identity.userId}`),
      会话状态: '有效',
      过期时间: EMPLOYEE_SESSION_COOKIE_EXPIRES_AT,
      最近访问时间: timestamp,
      身份来源: identity.source,
      客户端信息: identity.source === 'studio' ? 'Studio 单点登录' : '开发环境身份',
    }
    if (session) await teable.updateRecord(tableId, session.id, fields)
    else await teable.createRecord(tableId, { ...fields, 创建时间: timestamp })
    return { recorded: true, lastActiveAt: timestamp }
  }

  async logoutSession(headers: Record<string, string | string[] | undefined>) {
    const token = this.sessionToken(headers)
    if (!token) return { loggedOut: true }
    const tableId = this.database.getTableId('recruitment_login_sessions')
    if (!tableId) return { loggedOut: true }
    const tokenHash = this.hashToken(token), session = await teable.findOneByField(tableId, '令牌哈希', tokenHash)
    if (session) await teable.updateRecord(tableId, session.id, { 会话状态: '已退出', 退出时间: new Date().toISOString() })
    return { loggedOut: true }
  }

  async getRequestAccess(headers: Record<string, string | string[] | undefined>) {
    const resolved = this.requestAccess.get(headers)
    if (resolved) return resolved
    const identity = await this.resolveRequestIdentity(headers)
    if (!identity) {
      if (process.env.ACCESS_CONTROL_MODE === 'strict') throw new UnauthorizedException('未获取到可信登录身份')
      return null
    }
    if (identity.source !== 'session') {
      const tableId = this.database.getTableId('recruitment_users')
      const account = tableId ? await teable.findOneByField(tableId, '用户ID', identity.userId) : undefined
      if (!account || String(account.fields['用户状态'] || '') !== '启用') throw new UnauthorizedException('员工账号不存在或未启用')
    }
    return { identity, profile: await this.getUserAccess(identity.userId) }
  }

  private requestAccess = new WeakMap<object, { identity: RequestIdentity; profile: RoleAccessProfile }>()

  rememberRequestAccess(headers: object, resolved: { identity: RequestIdentity; profile: RoleAccessProfile }) {
    this.requestAccess.set(headers, resolved)
  }

  private sessionToken(headers: Record<string, string | string[] | undefined>) {
    const raw = Array.isArray(headers.cookie) ? headers.cookie[0] : headers.cookie
    if (!raw) return ''
    const item = String(raw).split(';').map((part) => part.trim()).find((part) => part.startsWith('rf_session='))
    if (!item) return ''
    try { return decodeURIComponent(item.slice('rf_session='.length)) } catch { return item.slice('rf_session='.length) }
  }

  sessionTokenForCookie(headers: Record<string, string | string[] | undefined>) {
    return this.sessionToken(headers)
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  assertPage(profile: RoleAccessProfile, page: string) {
    if (!this.hasPage(profile, page)) throw new ForbiddenException(`当前角色没有页面权限：${page}`)
  }

  assertAction(profile: RoleAccessProfile, action: string) {
    if (!this.hasAction(profile, action)) throw new ForbiddenException(`当前角色没有操作权限：${action}`)
  }

  async auditAccess(profile: RoleAccessProfile, userName: string, request: Pick<Request, 'method' | 'path' | 'headers' | 'ip' | 'socket'>, action: string, result: '成功' | '失败', error = '') {
    if (process.env.LOCAL_EXPORT_DB === 'true' && process.env.NODE_ENV !== 'production') return String(request.headers['x-request-id'] || randomUUID())
    const tableId = this.database.requireTableId('recruitment_audit_logs'), requestId = String(request.headers['x-request-id'] || randomUUID())
    await teable.createRecord(tableId, {
      日志ID: `audit_${randomUUID().replace(/-/g, '').slice(0, 20)}`, 操作人用户ID: profile.userId, 操作人: userName || profile.userId,
      操作角色: profile.roleCodes.join(','), 操作类型: action, 对象类型: 'HTTP接口', 对象ID: `${request.method} ${request.path}`,
      修改前摘要JSON: '{}', 修改后摘要JSON: '{}', 操作原因: '服务端权限守卫', IP地址: request.ip || request.socket.remoteAddress || '',
      客户端信息: String(request.headers['user-agent'] || ''), 请求ID: requestId, 发生时间: new Date().toISOString(), 操作结果: result, 错误信息: error,
    })
    return requestId
  }

  canAccessTalent(profile: RoleAccessProfile, context: TalentAccessContext) {
    if (context.stage === '待HR审核' && this.hasAction(profile, 'review_candidate')) return true
    if (profile.dataScopes.some((scope) => scope.type === 'all')) return true
    return profile.dataScopes.some((scope) => {
      if (scope.type === 'deidentified_all') return true
      if (scope.type === 'self') return context.subjectUserId === profile.userId || context.candidateId === profile.userId
      if (scope.type === 'assigned_departments' || scope.type === 'managed_departments') return Boolean(context.departmentIds?.some((departmentId) => scope.departmentIds.includes(departmentId)))
      if (scope.type === 'business_unit' || scope.type === 'managed_business_units') return Boolean(scope.businessUnitId && context.businessUnitId === scope.businessUnitId)
      if (scope.type === 'assigned_interviews') return Boolean(context.interviewerUserIds?.includes(profile.userId))
      if (scope.type === 'onboarding_only') return ['待入职', '已入职', '试用期'].includes(context.stage || '')
      return false
    })
  }

  protectTalent<T extends Record<string, any>>(talent: T, profile: RoleAccessProfile, context: TalentAccessContext): T & { access: Record<string, unknown> } {
    const result: Record<string, any> = structuredClone(talent)
    delete result._access
    const contactPolicy = this.policy(profile, 'contacts', context)
    const salaryPolicy = this.policy(profile, 'salary', context)
    const resumePolicy = this.policy(profile, 'resume', context)
    const maskedFields: string[] = []
    if (contactPolicy !== 'full') {
      if (contactPolicy === 'masked') {
        result.phone = this.maskPhone(result.phone)
        result.email = this.maskEmail(result.email)
        result.wechat = this.maskWechat(result.wechat)
      } else {
        result.phone = ''
        result.email = ''
        result.wechat = ''
      }
      maskedFields.push('phone', 'email', 'wechat')
    }
    if (!['full', 'authorized'].includes(resumePolicy)) {
      for (const field of ['rawText', 'sourceFileUrl', 'editableWordUrl']) {
        if (!(field in result)) continue
        result[field] = ''
        maskedFields.push(field)
      }
      if (Array.isArray(result.resumeVersions)) {
        result.resumeVersions = result.resumeVersions.map((version: Record<string, unknown>) => ({ ...version, fileUrl: '' }))
        maskedFields.push('resumeVersions.fileUrl')
      }
    }
    if (!['full', 'authorized'].includes(salaryPolicy)) {
      for (const field of ['salary', 'baseSalary', 'performanceSalary', 'allowance', 'retentionInfo']) {
        if (!(field in result)) continue
        result[field] = salaryPolicy === 'range_only' && field === 'salary' ? result[field] : null
        maskedFields.push(field)
      }
    }
    result.access = { roleCodes: profile.roleCodes, contactPolicy, salaryPolicy, resumePolicy, maskedFields: [...new Set(maskedFields)], dataScopeMatched: true }
    return result as T & { access: Record<string, unknown> }
  }

  sensitiveFieldPolicy(profile: RoleAccessProfile, field: 'contacts' | 'salary' | 'resume', context: TalentAccessContext) {
    return this.policy(profile, field, context)
  }

  redactSensitiveResponse<T>(value: T, profile: RoleAccessProfile, groups: Array<'contacts' | 'salary' | 'resume'>): T {
    const enabled = new Set(groups)
    const contactPolicy = enabled.has('contacts') ? this.policy(profile, 'contacts', { candidateId: '' }) : 'full'
    const salaryPolicy = enabled.has('salary') ? this.policy(profile, 'salary', { candidateId: '' }) : 'full'
    const resumePolicy = enabled.has('resume') ? this.policy(profile, 'resume', { candidateId: '' }) : 'full'
    const contactFields = new Set(['phone', 'mobile', 'email', 'wechat', 'candidatePhone', 'candidateEmail', 'recipient'])
    const salaryFields = new Set(['salary', 'baseSalary', 'performanceSalary', 'allowance', 'dailySalary', 'monthlySalary', 'probationSalary', 'retentionInfo'])
    const resumeFields = new Set(['rawText', 'sourceFileUrl', 'editableWordUrl', 'fingerprint'])
    const visit = (input: any, path: string[]): any => {
      if (input == null || typeof input !== 'object' || input instanceof Date || Buffer.isBuffer(input)) return input
      if (Array.isArray(input)) return input.map((item) => visit(item, path))
      const result: Record<string, unknown> = {}
      for (const [key, raw] of Object.entries(input)) {
        if (enabled.has('contacts') && contactPolicy !== 'full' && contactFields.has(key)) {
          result[key] = contactPolicy === 'masked'
            ? key.toLowerCase().includes('email') || key === 'recipient' ? this.maskEmail(raw) : key === 'wechat' ? this.maskWechat(raw) : this.maskPhone(raw)
            : ''
          continue
        }
        const salaryRangeField = ['min', 'median', 'max'].includes(key) && path.some((item) => /salary|benchmark/i.test(item))
        if (enabled.has('salary') && !['full', 'authorized'].includes(salaryPolicy) && (salaryFields.has(key) || salaryRangeField)) {
          result[key] = salaryPolicy === 'range_only' && (key === 'salary' || salaryRangeField) ? raw : null
          continue
        }
        const resumeVersionFile = key === 'fileUrl' && path.some((item) => /version|resume/i.test(item))
        if (enabled.has('resume') && !['full', 'authorized'].includes(resumePolicy) && (resumeFields.has(key) || resumeVersionFile)) {
          result[key] = ''
          continue
        }
        result[key] = visit(raw, [...path, key])
      }
      return result
    }
    return visit(value, []) as T
  }

  private policy(profile: RoleAccessProfile, field: 'contacts' | 'salary' | 'resume', context: TalentAccessContext) {
    if (profile.roleCodes.includes('system_admin')) return 'full'
    if (field === 'contacts' && context.unlockedFields?.some((item) => ['contacts', 'phone', 'email', 'wechat'].includes(item))) return 'full'
    if (field === 'salary' && context.unlockedFields?.some((item) => ['salary', 'offer_salary'].includes(item))) return 'full'
    if (field === 'resume' && context.unlockedFields?.some((item) => ['resume', 'rawText', 'sourceFileUrl'].includes(item))) return 'full'
    const rank: Record<string, number> = { hidden: 0, false: 0, masked: 1, range_only: 1, own_and_summary: 1, summary_only: 1, authorized_onboarding: 2, approval_required: 2, authorized: 3, self_only: 3, full: 4, true: 4 }
    let selected = 'hidden', selectedRank = 0
    for (const item of profile.sensitiveFields) {
      let value = String(item[field] ?? 'hidden')
      if (value === 'self_only' && context.subjectUserId !== profile.userId && context.candidateId !== profile.userId) value = 'hidden'
      if (value === 'authorized_onboarding' && !['待入职', '已入职', '试用期'].includes(context.stage || '')) value = 'hidden'
      const currentRank = rank[value] ?? 0
      if (currentRank > selectedRank) { selected = value; selectedRank = currentRank }
    }
    if (selected === 'self_only' || selected === 'authorized_onboarding') return 'full'
    return selected
  }

  private decodeHeader(value: unknown) {
    try { return decodeURIComponent(String(value || '')).trim() } catch { return String(value || '').trim() }
  }

  private maskPhone(value: unknown) {
    const phone = String(value || '').trim()
    if (phone.length < 7) return phone ? '***' : ''
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`
  }

  private maskEmail(value: unknown) {
    const email = String(value || '').trim(), at = email.indexOf('@')
    if (at < 1) return email ? '***' : ''
    return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`
  }

  private maskWechat(value: unknown) {
    const wechat = String(value || '').trim()
    if (!wechat) return ''
    return `${wechat.slice(0, Math.min(2, wechat.length))}***`
  }
}
