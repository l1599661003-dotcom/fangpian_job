import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { callMcp } from '../../platform/mcp'
import { tianji } from '../../platform/tianji'
import { teable } from '../../platform/teable'
import { DatabaseService } from './database.service'
import { RequestIdentity, RoleAccessProfile, RoleAccessService } from './role-access.service'

const now = () => new Date().toISOString()
const LOGIN_ONLINE_WINDOW_MS = 3 * 60 * 1000
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
const text = (value: unknown) => String(value ?? '').trim()
const ROLE_LEVELS = new Set(['L1', 'L2', 'L3', 'L4'])
const ROLE_DATA_SCOPES = new Set(['all', 'business_unit', 'assigned_departments', 'assigned_interviews', 'self'])
const json = <T>(value: unknown, fallback: T): T => { try { return value ? JSON.parse(String(value)) as T : fallback } catch { return fallback } }
const normalizePhone = (value: unknown) => { const digits = text(value).replace(/\D/g, ''); return digits.length === 13 && digits.startsWith('86') ? digits.slice(2) : digits.length === 11 ? digits : '' }
const normalizeName = (value: unknown) => text(value).normalize('NFKC').replace(/\s+/g, '')
const normalizeEmail = (value: unknown) => text(value).toLowerCase()
const directMessageId = (fields: Record<string, unknown>) => text(fields['天玑微信ID']) || text(fields['企业微信用户ID'])
const parseJsonText = (value: unknown) => { const raw = text(value).split(/\n\n\[diagnosis\]/)[0].trim(); if (!raw) return null; try { return JSON.parse(raw) } catch { return null } }
const wecomPayload = (value: any, depth = 0): any => {
  if (depth > 5 || value == null) return {}
  if (typeof value === 'string') return parseJsonText(value) || {}
  if (Array.isArray(value?.users)) return value
  if (typeof value?.text === 'string') return parseJsonText(value.text) || {}
  if (Array.isArray(value?.content)) {
    for (const item of value.content) {
      const parsed = wecomPayload(item, depth + 1)
      if (Array.isArray(parsed?.users)) return parsed
    }
  }
  for (const key of ['structuredContent', 'data', 'result']) {
    if (value?.[key] == null || value[key] === value) continue
    const parsed = wecomPayload(value[key], depth + 1)
    if (Array.isArray(parsed?.users)) return parsed
  }
  return value || {}
}
const tianjiStatus = (person: any) => { const status = text(person?.status_text); if (['在职', '离职'].includes(status)) return status; if (Number(person?.status) === 1) return '在职'; if (Number(person?.status) === 0 || Number(person?.leave_date) > 0) return '离职'; return '' }
const tianjiDate = (value: unknown) => { const raw = text(value); if (!raw || raw === '0') return ''; const numeric = Number(raw); const parsed = Number.isFinite(numeric) && numeric > 0 ? numeric > 10_000_000_000 ? numeric : numeric * 1000 : Date.parse(raw); return Number.isFinite(parsed) ? new Date(parsed + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : '' }

// 内推码是员工的稳定业务标识，不使用姓名或手机号直接作为码，避免员工资料变更后历史内推链接失效。
const referralPinyin: Record<string, string> = { 高: 'GAO', 子: 'ZI', 云: 'YUN', 张: 'ZHANG', 静: 'JING', 王: 'WANG', 李: 'LI', 刘: 'LIU', 陈: 'CHEN', 杨: 'YANG', 赵: 'ZHAO', 黄: 'HUANG', 周: 'ZHOU', 吴: 'WU', 徐: 'XU', 孙: 'SUN', 胡: 'HU', 朱: 'ZHU', 林: 'LIN', 何: 'HE', 郭: 'GUO', 马: 'MA', 罗: 'LUO', 梁: 'LIANG', 宋: 'SONG', 郑: 'ZHENG', 谢: 'XIE', 韩: 'HAN', 唐: 'TANG', 冯: 'FENG', 于: 'YU', 董: 'DONG', 程: 'CHENG', 曹: 'CAO', 袁: 'YUAN', 邓: 'DENG', 许: 'XU', 傅: 'FU', 沈: 'SHEN', 曾: 'ZENG', 彭: 'PENG', 吕: 'LYU', 苏: 'SU', 卢: 'LU', 蒋: 'JIANG', 蔡: 'CAI', 贾: 'JIA', 丁: 'DING', 魏: 'WEI', 薛: 'XUE', 叶: 'YE', 阎: 'YAN', 余: 'YU', 潘: 'PAN', 杜: 'DU', 戴: 'DAI', 夏: 'XIA', 钟: 'ZHONG', 汪: 'WANG', 田: 'TIAN', 任: 'REN', 姜: 'JIANG', 范: 'FAN', 方: 'FANG', 石: 'SHI', 姚: 'YAO', 谭: 'TAN', 廖: 'LIAO', 邹: 'ZOU', 熊: 'XIONG', 金: 'JIN', 陆: 'LU', 郝: 'HAO', 孔: 'KONG', 白: 'BAI', 崔: 'CUI', 康: 'KANG', 毛: 'MAO', 邱: 'QIU', 秦: 'QIN', 江: 'JIANG', 史: 'SHI', 顾: 'GU', 侯: 'HOU', 邵: 'SHAO', 孟: 'MENG', 龙: 'LONG', 万: 'WAN', 段: 'DUAN', 雷: 'LEI', 钱: 'QIAN', 汤: 'TANG', 尹: 'YIN', 黎: 'LI', 易: 'YI', 常: 'CHANG', 武: 'WU', 乔: 'QIAO', 贺: 'HE', 赖: 'LAI', 龚: 'GONG', 文: 'WEN', 琳: 'LIN', 婷: 'TING', 佳: 'JIA', 雨: 'YU', 欣: 'XIN', 宇: 'YU', 明: 'MING', 伟: 'WEI', 杰: 'JIE', 俊: 'JUN', 磊: 'LEI', 鑫: 'XIN', 超: 'CHAO', 鹏: 'PENG', 昊: 'HAO', 瑞: 'RUI', 洋: 'YANG', 玲: 'LING', 娜: 'NA', 倩: 'QIAN', 雪: 'XUE', 梅: 'MEI', 华: 'HUA', 强: 'QIANG', 勇: 'YONG', 峰: 'FENG', 涛: 'TAO', 斌: 'BIN', 凯: 'KAI', 博: 'BO', 宁: 'NING', 颖: 'YING', 莉: 'LI', 露: 'LU', 丹: 'DAN', 洁: 'JIE', 荣: 'RONG', 远: 'YUAN', 诚: 'CHENG', 朗: 'LANG', 皓: 'HAO', 轩: 'XUAN', 晨: 'CHEN', 旭: 'XU', 薇: 'WEI', 芳: 'FANG', 兰: 'LAN', 丽: 'LI', 玉: 'YU', 凤: 'FENG', 春: 'CHUN', 秋: 'QIU', 冬: 'DONG', 海: 'HAI', 维: 'WEI', 嘉: 'JIA', 恩: 'EN', 彤: 'TONG', 思: 'SI', 萱: 'XUAN', 昕: 'XIN', 妍: 'YAN', 曦: 'XI', 霖: 'LIN', 泽: 'ZE', 睿: 'RUI', 清: 'QING', 航: 'HANG', 宸: 'CHEN', 亦: 'YI', 安: 'AN', 乐: 'LE', 昱: 'YU', 斐: 'FEI', 悦: 'YUE', 诗: 'SHI', 语: 'YU', 桐: 'TONG', 柔: 'ROU', 依: 'YI', 诺: 'NUO', 可: 'KE', 沫: 'MO', 曼: 'MAN', 琪: 'QI', 瑶: 'YAO', 璇: 'XUAN', 研: 'YAN', 之: 'ZHI', 煜: 'YU', 赫: 'HE', 哲: 'ZHE', 恺: 'KAI', 凡: 'FAN', 童: 'TONG', 莹: 'YING', 婕: 'JIE', 艺: 'YI', 纯: 'CHUN', 璐: 'LU', 芮: 'RUI', 璟: 'JING', 书: 'SHU', 霏: 'FEI', 若: 'RUO', 初: 'CHU', 蕾: 'LEI', 瀚: 'HAN', 铭: 'MING', 锐: 'RUI', 译: 'YI', 慧: 'HUI', 珊: 'SHAN', 祺: 'QI', 越: 'YUE', 也: 'YE', 彦: 'YAN', 彬: 'BIN', 玮: 'WEI', 玥: 'YUE', 婉: 'WAN' };
const referralSlug = (name: string) => {
  const normalized = name.normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
  const ascii = normalized.replace(/[^A-Za-z0-9]/g, '')
  if (ascii) return ascii.toUpperCase().slice(0, 18)
  const pinyin = [...name].map((char) => referralPinyin[char] || '').join('')
  return (pinyin || 'EMPLOYEE').toUpperCase().slice(0, 18)
}

@Injectable()
export class AccessAdminService {
  constructor(private readonly database: DatabaseService, private readonly roleAccess: RoleAccessService) {}
  private table(name: string) { return this.database.requireTableId(name) }

  private buildReferralCode(name: string, used: Set<string>) {
    const base = `FANGPIAN${referralSlug(name)}`
    let sequence = 1
    let code = `${base}${String(sequence).padStart(3, '0')}`
    while (used.has(code)) {
      sequence += 1
      code = `${base}${String(sequence).padStart(3, '0')}`
    }
    used.add(code)
    return code
  }

  private async ensureReferralCodes(rows: any[]) {
    const tableId = this.table('recruitment_users')
    const used = new Set(rows.map((row) => text(row.fields['内推码'])).filter(Boolean))
    for (const row of rows) {
      if (text(row.fields['内推码']) || !text(row.fields['姓名'])) continue
      const referralCode = this.buildReferralCode(text(row.fields['姓名']), used)
      await teable.updateRecord(tableId, row.id, { 内推码: referralCode, 更新时间: now() })
      row.fields = { ...row.fields, 内推码: referralCode }
    }
    return rows
  }

  async account(userId: string) {
    if (!text(userId)) return null
    const table = this.table('recruitment_users')
    let row = await teable.findOneByField(table, '用户ID', text(userId))
    if (row && text(row.fields['用户ID']) !== text(userId)) {
      row = (await teable.listAllRecords(table)).find((item) => text(item.fields['用户ID']) === text(userId))
    }
    if (!row) return null
    return {
      id: text(row.fields['用户ID']) || row.id,
      name: text(row.fields['姓名']),
      employeeNumber: text(row.fields['工号']),
      email: text(row.fields['邮箱']),
      mobile: text(row.fields['手机']),
      referralCode: text(row.fields['内推码']),
      wecomUserId: text(row.fields['企业微信用户ID']) || text(row.fields['天玑微信ID']),
      businessUnitId: text(row.fields['事业部ID']),
      businessUnit: text(row.fields['事业部']),
      departmentIds: json<string[]>(row.fields['部门IDJSON'], []),
      departments: json<string[]>(row.fields['部门JSON'], []),
      status: text(row.fields['用户状态']) || '待开通',
      source: text(row.fields['身份来源']),
      updatedAt: text(row.fields['更新时间']),
    }
  }

  async completeProfile(identity: RequestIdentity, input: { name?: string; mobile?: string }) {
    const name = text(input.name) || text(identity.userName), mobile = text(input.mobile).replace(/\s|-/g, '')
    if (!name) throw new BadRequestException('请填写姓名')
    if (!/^1[3-9]\d{9}$/.test(mobile)) throw new BadRequestException('请填写正确的11位手机号')
    const tableId = this.table('recruitment_users'), fields = await teable.listFields(tableId)
    const available = new Set(fields.map((field) => field.name))
    for (const required of ['用户ID', '姓名', '手机', '用户状态', '更新时间']) if (!available.has(required)) throw new Error(`系统用户表缺少字段：${required}`)
    const rows = await teable.listAllRecords(tableId)
    const row = rows.find((item) => text(item.fields['用户ID']) === identity.userId)
    if (!row) throw new NotFoundException('系统用户不存在，请先申请开通')
    if (text(row.fields['用户状态']) === '停用') throw new ForbiddenException('当前账号已停用，请联系管理员处理')
    const duplicate = rows.find((item) => item.id !== row.id && text(item.fields['姓名']) === name && text(item.fields['手机']).replace(/\s|-/g, '') === mobile)
    if (duplicate) throw new ConflictException('该姓名和手机号已经绑定其他账号，请联系管理员核对')
    const usedReferralCodes = new Set(rows.map((item) => text(item.fields['内推码'])).filter(Boolean))
    const referralCode = text(row.fields['内推码']) || this.buildReferralCode(name, usedReferralCodes)
    const timestamp = now(), patch = { 姓名: name, 手机: mobile, 内推码: referralCode, 最近同步时间: timestamp, 更新时间: timestamp }
    await teable.updateRecord(tableId, row.id, patch)
    await this.audit('完善首次登录资料', '系统用户', identity.userId, row.fields, patch, name, identity.userId, '首次登录必须确认姓名和手机号')
    return { userId: identity.userId, name, mobile, status: text(row.fields['用户状态']), completedAt: timestamp }
  }

  async applyForAccess(identity: RequestIdentity, input: { department?: string; departmentId?: string; businessUnit?: string; businessUnitId?: string; email?: string; mobile?: string; purpose?: string; reason?: string }) {
    if (!text(input.reason)) throw new BadRequestException('请填写申请开通原因')
    const normalizedMobile = text(input.mobile).replace(/\s|-/g, '')
    if (!/^1[3-9]\d{9}$/.test(normalizedMobile)) throw new BadRequestException('首次登录必须填写正确的11位手机号')
    const tableId = this.table('recruitment_users')
    const fields = await teable.listFields(tableId)
    const available = new Set(fields.map((field) => field.name))
    for (const required of ['用户ID', '姓名', '用户状态', '身份来源', '更新时间']) if (!available.has(required)) throw new Error(`系统用户表缺少字段：${required}`)
    const rows = await teable.listAllRecords(tableId)
    const existing = rows.find((row) => text(row.fields['用户ID']) === identity.userId)
    const duplicateIdentity = rows.find((row) => text(row.fields['用户ID']) !== identity.userId && text(row.fields['姓名']) === (identity.userName || identity.userId) && text(row.fields['手机']).replace(/\s|-/g, '') === normalizedMobile)
    if (duplicateIdentity) throw new ConflictException('该姓名和手机号已经绑定其他账号，请联系管理员核对')
    if (existing && text(existing.fields['用户状态']) === '启用') throw new ConflictException('当前账号已经开通，无需重复申请')
    if (existing && text(existing.fields['用户状态']) === '停用') throw new ForbiddenException('当前账号已停用，请联系管理员处理')
    const timestamp = now()
    const usedReferralCodes = new Set(rows.map((row) => text(row.fields['内推码'])).filter(Boolean))
    const referralCode = text(existing?.fields['内推码']) || this.buildReferralCode(identity.userName || identity.userId, usedReferralCodes)
    const applicationNote = [text(input.purpose), text(input.reason)].filter(Boolean).join('：')
    const patch = {
      用户ID: identity.userId,
      姓名: identity.userName || identity.userId,
      内推码: referralCode,
      邮箱: text(input.email),
      手机: normalizedMobile,
      事业部ID: text(input.businessUnitId),
      事业部: text(input.businessUnit),
      部门IDJSON: JSON.stringify(input.departmentId ? [text(input.departmentId)] : []),
      部门JSON: JSON.stringify(input.department ? [text(input.department)] : []),
      用户状态: '待开通',
      身份来源: `企业身份申请${applicationNote ? `｜${applicationNote}` : ''}`,
      最近同步时间: timestamp,
      更新时间: timestamp,
    }
    if (existing) await teable.updateRecord(tableId, existing.id, patch)
    else await teable.createRecord(tableId, { ...patch, 创建时间: timestamp })
    await this.audit(existing ? '更新系统开通申请' : '提交系统开通申请', '系统用户', identity.userId, existing?.fields || {}, patch, identity.userName, identity.userId, input.reason)
    return { userId: identity.userId, name: identity.userName, status: '待开通', submittedAt: timestamp }
  }

  async administration() {
    const [roles, bindings, users, organizations, requests] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_roles')),
      teable.listAllRecords(this.table('recruitment_user_roles')),
      teable.listAllRecords(this.table('recruitment_users')),
      teable.listAllRecords(this.table('recruitment_organization_units')),
      teable.listAllRecords(this.table('recruitment_sensitive_access_requests')),
    ])
    await this.ensureReferralCodes(users)
    return {
      roles: roles.map((row) => ({ code: text(row.fields['角色编码']), name: text(row.fields['角色名称']), description: text(row.fields['角色说明']), level: text(row.fields['角色层级']), dataScope: text(row.fields['数据范围类型']), pages: json(row.fields['页面权限JSON'], []), actions: json(row.fields['操作权限JSON'], []), sensitiveFields: json(row.fields['敏感字段策略JSON'], {}), status: text(row.fields['角色状态']), system: text(row.fields['是否系统角色']) === '是' })),
      bindings: bindings.map((row) => ({ id: text(row.fields['用户角色ID']) || row.id, userId: text(row.fields['用户ID']), userName: text(row.fields['用户姓名']), roleCode: text(row.fields['角色编码']), businessUnitId: text(row.fields['事业部ID']), businessUnit: text(row.fields['事业部']), departmentIds: json(row.fields['部门IDJSON'], []), status: text(row.fields['绑定状态']), startsAt: text(row.fields['生效时间']), expiresAt: text(row.fields['失效时间']), authorizedBy: text(row.fields['授权人']), reason: text(row.fields['授权原因']) })),
      users: users.map((row) => ({ id: text(row.fields['用户ID']) || row.id, name: text(row.fields['姓名']), employeeNumber: text(row.fields['工号']), email: text(row.fields['邮箱']), mobile: text(row.fields['手机']), referralCode: text(row.fields['内推码']), wecomUserId: text(row.fields['企业微信用户ID']), tianjiWechatId: directMessageId(row.fields), tianjiEmployeeStatus: text(row.fields['天玑人事状态']), businessUnitId: text(row.fields['事业部ID']), businessUnit: text(row.fields['事业部']), departmentIds: json(row.fields['部门IDJSON'], []), departments: json(row.fields['部门JSON'], []), status: text(row.fields['用户状态']), source: text(row.fields['身份来源']), updatedAt: text(row.fields['更新时间']) })),
      organizations: organizations.map((row) => ({ id: text(row.fields['组织单元ID']) || row.id, type: text(row.fields['组织类型']), code: text(row.fields['组织编码']), name: text(row.fields['组织名称']), parentId: text(row.fields['上级组织单元ID']), ownerUserId: text(row.fields['负责人用户ID']), owner: text(row.fields['负责人']), status: text(row.fields['组织状态']), order: Number(row.fields['排序'] || 0) })),
      sensitiveRequests: requests.map((row) => this.mapRequest(row)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }
  }

  async loginActivity(asOf = new Date()) {
    const [sessions, users, organizations] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_login_sessions'), { pageSize: 1000, fields: ['用户ID', '用户姓名', '会话状态', '创建时间', '最近访问时间', '身份来源'] }),
      teable.listAllRecords(this.table('recruitment_users'), { pageSize: 1000, fields: ['用户ID', '姓名', '部门IDJSON', '部门JSON', '事业部', '用户状态'] }),
      teable.listAllRecords(this.table('recruitment_organization_units'), { pageSize: 1000, fields: ['组织单元ID', '组织名称', '上级组织单元ID', '组织状态'] }),
    ])
    const usersById = new Map(users.map((row) => [text(row.fields['用户ID']), row]))
    const organizationsById = new Map(organizations.map((row) => [text(row.fields['组织单元ID']) || row.id, row]))
    const formatDepartment = (user: any) => {
      const departmentIds = json<string[]>(user?.fields['部门IDJSON'], []).map(text).filter(Boolean)
      if (departmentIds.length) {
        const path: string[] = [], visited = new Set<string>()
        let currentId = departmentIds[0]
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId)
          const organization = organizationsById.get(currentId)
          if (!organization) break
          if (text(organization.fields['组织状态']) !== '停用') path.push(text(organization.fields['组织名称']))
          currentId = text(organization.fields['上级组织单元ID'])
        }
        if (path.length) return path.reverse().join(' / ')
      }
      return json<string[]>(user?.fields['部门JSON'], []).map(text).filter(Boolean).join(' / ')
        || text(user?.fields['事业部'])
        || '暂未归属部门'
    }
    const people = new Map<string, { userId: string; name: string; department: string; lastLoginAt: string; lastActiveAt: string; isOnline: boolean }>()
    const timestamp = asOf.getTime()
    for (const session of sessions) {
      const userId = text(session.fields['用户ID'])
      if (!userId) continue
      const account = usersById.get(userId)
      const createdAt = text(session.fields['创建时间'])
      const lastActiveAt = text(session.fields['最近访问时间']) || createdAt
      const current = people.get(userId) || {
        userId,
        name: text(account?.fields['姓名']) || text(session.fields['用户姓名']) || userId,
        department: formatDepartment(account),
        lastLoginAt: '',
        lastActiveAt: '',
        isOnline: false,
      }
      if (Date.parse(createdAt) > Date.parse(current.lastLoginAt || '')) current.lastLoginAt = createdAt
      if (Date.parse(lastActiveAt) > Date.parse(current.lastActiveAt || '')) current.lastActiveAt = lastActiveAt
      const lastActiveTimestamp = Date.parse(lastActiveAt)
      if (text(session.fields['会话状态']) === '有效'
        && text(account?.fields['用户状态']) === '启用'
        && Number.isFinite(lastActiveTimestamp)
        && lastActiveTimestamp <= timestamp
        && timestamp - lastActiveTimestamp <= LOGIN_ONLINE_WINDOW_MS) current.isOnline = true
      people.set(userId, current)
    }
    const loggedInUsers = [...people.values()].sort((left, right) => {
      if (left.isOnline !== right.isOnline) return left.isOnline ? -1 : 1
      return Date.parse(right.lastActiveAt || '') - Date.parse(left.lastActiveAt || '')
    })
    const onlineUsers = loggedInUsers.filter((user) => user.isOnline)
    return {
      generatedAt: asOf.toISOString(),
      onlineWindowSeconds: LOGIN_ONLINE_WINDOW_MS / 1000,
      loggedInUserCount: loggedInUsers.length,
      onlineUserCount: onlineUsers.length,
      onlineUsers,
      loggedInUsers,
    }
  }

  async upsertOrganization(input: { id?: string; type: string; code?: string; name: string; parentId?: string; ownerUserId?: string; owner?: string; status?: string; order?: number; operator?: string; operatorUserId?: string }) {
    if (!['事业部', '部门'].includes(text(input.type)) || !text(input.name)) throw new BadRequestException('组织类型和组织名称不能为空')
    const tableId = this.table('recruitment_organization_units'), rows = await teable.listAllRecords(tableId), suppliedId = text(input.id)
    const existing = rows.find((row) => (suppliedId && (text(row.fields['组织单元ID']) === suppliedId || row.id === suppliedId)) || (text(input.code) && text(row.fields['组织编码']) === text(input.code)))
    if (suppliedId && !existing) throw new NotFoundException('要编辑的部门不存在，请刷新后重试')
    const organizationId = text(existing?.fields['组织单元ID']) || suppliedId || id('org'), parentId = text(input.parentId)
    const parent = parentId ? rows.find((row) => text(row.fields['组织单元ID']) === parentId || row.id === parentId) : undefined
    if (parentId && (!parent || !['事业部', '部门'].includes(text(parent.fields['组织类型'])) || text(parent.fields['组织状态']) === '停用')) throw new BadRequestException('上级部门不存在、已停用或类型不正确')
    const visited = new Set<string>()
    let ancestor = parent
    while (ancestor) {
      const ancestorId = text(ancestor.fields['组织单元ID']) || ancestor.id
      if (ancestorId === organizationId) throw new BadRequestException('上级部门不能设置为本部门或其下级部门')
      if (visited.has(ancestorId)) break
      visited.add(ancestorId)
      const ancestorParentId = text(ancestor.fields['上级组织单元ID'])
      ancestor = ancestorParentId ? rows.find((row) => text(row.fields['组织单元ID']) === ancestorParentId || row.id === ancestorParentId) : undefined
    }
    const status = text(input.status) || '启用'
    if (!['启用', '停用'].includes(status)) throw new BadRequestException('部门状态只能是启用或停用')
    if (status === '停用' && existing && text(existing.fields['组织状态']) !== '停用') {
      const children = rows.filter((row) => text(row.fields['上级组织单元ID']) === organizationId && text(row.fields['组织状态']) !== '停用')
      if (children.length) throw new BadRequestException('该部门仍有启用的下级部门，请先调整下级部门归属')
      const users = await teable.listAllRecords(this.table('recruitment_users'))
      const activeDepartmentIds = new Set(rows.filter((row) => text(row.fields['组织类型']) === '部门' && text(row.fields['组织状态']) !== '停用').map((row) => text(row.fields['组织单元ID']) || row.id))
      const departmentName = text(existing.fields['组织名称'])
      const assignedUsers = users.filter((row) => {
        const departmentIds = json<string[]>(row.fields['部门IDJSON'], []).map(text).filter(Boolean)
        const departmentNames = json<string[]>(row.fields['部门JSON'], []).map(text).filter(Boolean)
        const hasActiveDepartmentId = departmentIds.some((id) => activeDepartmentIds.has(id))
        return departmentIds.includes(organizationId) || (!hasActiveDepartmentId && departmentNames.includes(departmentName))
      })
      if (assignedUsers.length) throw new BadRequestException('该部门仍有员工归属，请先调整员工部门后再停用')
    }
    const timestamp = now()
    const fields = { 组织单元ID: organizationId, 组织类型: input.type, 组织编码: text(input.code) || text(existing?.fields['组织编码']), 组织名称: text(input.name), 上级组织单元ID: parentId, 负责人用户ID: text(input.ownerUserId), 负责人: text(input.owner), 组织状态: status, 排序: Number(input.order ?? existing?.fields['排序'] ?? 0), 来源类型: text(existing?.fields['来源类型']) || '系统维护', 更新时间: timestamp }
    const recordFields = existing ? fields : { ...fields, 创建时间: timestamp }
    const availableFields = new Set((await teable.listFields(tableId)).map((field) => field.name))
    const missingFields = Object.keys(recordFields).filter((field) => !availableFields.has(field))
    if (missingFields.length) throw new Error(`组织架构表缺少字段：${missingFields.join('、')}，请先初始化数据库`)
    if (existing) await teable.updateRecord(tableId, existing.id, fields)
    else await teable.createRecord(tableId, recordFields)
    await this.audit(existing ? '修改组织单元' : '创建组织单元', '组织单元', organizationId, existing?.fields || {}, fields, input.operator, input.operatorUserId)
    return { organizationId, status: fields.组织状态 }
  }

  async upsertUser(input: { userId?: string; name: string; employeeNumber?: string; email?: string; mobile?: string; wecomUserId?: string; tianjiWechatId?: string; businessUnitId?: string; businessUnit?: string; departmentIds?: string[]; departments?: string[]; status?: string; source?: string; operator?: string; operatorUserId?: string }) {
    const name = text(input.name), mobile = text(input.mobile).replace(/\s|-/g, ''), suppliedUserId = text(input.userId)
    if (!name) throw new BadRequestException('姓名不能为空')
    // 新增员工只填写姓名、手机号和部门；系统用手机号创建稳定的内部账号标识。
    if (!suppliedUserId && !/^1[3-9]\d{9}$/.test(mobile)) throw new BadRequestException('请填写正确的11位手机号')
    if (!suppliedUserId && !(input.departmentIds || []).filter(Boolean).length) throw new BadRequestException('请选择所属部门')
    const rows = await teable.listAllRecords(this.table('recruitment_users'))
    const existing = rows.find((row) => text(row.fields['用户ID']) === suppliedUserId)
      || (mobile ? rows.find((row) => text(row.fields['手机']).replace(/\s|-/g, '') === mobile) : undefined)
    const duplicateIdentity = rows.find((row) => row.id !== existing?.id
      && text(row.fields['姓名']) === name
      && text(row.fields['手机']).replace(/\s|-/g, '') === mobile)
    if (duplicateIdentity) throw new ConflictException(`姓名“${name}”和手机号“${mobile}”已存在员工账号，请勿重复新增`)
    if (!suppliedUserId) {
      const duplicateMobile = rows.find((row) => text(row.fields['手机']).replace(/\s|-/g, '') === mobile)
      if (duplicateMobile) throw new ConflictException(`手机号“${mobile}”已绑定员工“${text(duplicateMobile.fields['姓名']) || '未命名员工'}”，请核对后再新增`)
    }
    const userId = text(existing?.fields['用户ID']) || suppliedUserId || `employee_${mobile}`
    const usedReferralCodes = new Set(rows.map((row) => text(row.fields['内推码'])).filter(Boolean))
    const referralCode = text(existing?.fields['内推码']) || this.buildReferralCode(name, usedReferralCodes)
    const timestamp = now()
    const requestedDepartmentIds = (input.departmentIds || []).map(text).filter(Boolean).slice(0, 1)
    let departmentIds = requestedDepartmentIds
    let departments = (input.departments || []).map(text).filter(Boolean).slice(0, 1)
    if (requestedDepartmentIds.length) {
      const organizations = await teable.listAllRecords(this.table('recruitment_organization_units'))
      const department = organizations.find((row) => {
        const organizationId = text(row.fields['组织单元ID']) || row.id
        return requestedDepartmentIds.some((requestedId) => requestedId === organizationId || requestedId === row.id)
      })
      if (!department || text(department.fields['组织类型']) !== '部门' || text(department.fields['组织状态']) === '停用') throw new BadRequestException('所选部门不存在或已停用，请刷新组织架构后重试')
      departments = [text(department.fields['组织名称'])]
    } else if (existing) {
      departmentIds = json<string[]>(existing.fields['部门IDJSON'], []).map(text).filter(Boolean).slice(0, 1)
      departments = departments.length ? departments : json<string[]>(existing.fields['部门JSON'], []).map(text).filter(Boolean).slice(0, 1)
    }
    const existingWecomId = text(existing?.fields['企业微信用户ID']), existingDirectId = text(existing?.fields['天玑微信ID'])
    const requestedWecomId = input.wecomUserId === undefined ? existingWecomId : text(input.wecomUserId)
    const requestedDirectId = input.tianjiWechatId === undefined ? existingDirectId : text(input.tianjiWechatId)
    const unifiedWecomId = requestedWecomId || requestedDirectId, unifiedDirectId = requestedDirectId || requestedWecomId
    const fields = { 用户ID: userId, 姓名: name, 工号: text(input.employeeNumber), 邮箱: text(input.email), 手机: mobile, 内推码: referralCode, 企业微信用户ID: unifiedWecomId, 天玑微信ID: unifiedDirectId, 事业部ID: text(input.businessUnitId), 事业部: text(input.businessUnit), 部门IDJSON: JSON.stringify(departmentIds), 部门JSON: JSON.stringify(departments), 用户状态: text(input.status) || '启用', 身份来源: text(input.source) || '管理员维护', 最近同步时间: timestamp, 更新时间: timestamp }
    if (existing) await teable.updateRecord(this.table('recruitment_users'), existing.id, fields)
    else await teable.createRecord(this.table('recruitment_users'), { ...fields, 创建时间: timestamp })
    if (!existing) await this.ensureDefaultReferrerRole(userId, name, departmentIds, input.operator, input.operatorUserId)
    if (existing && departmentIds[0]) {
      const bindings = await teable.listAllRecords(this.table('recruitment_user_roles'))
      const currentTime = Date.now()
      for (const binding of bindings.filter((row) => text(row.fields['用户ID']) === userId
        && text(row.fields['绑定状态']) === '启用'
        && (!text(row.fields['失效时间']) || Date.parse(text(row.fields['失效时间'])) > currentTime))) {
        await teable.updateRecord(this.table('recruitment_user_roles'), binding.id, { 部门IDJSON: JSON.stringify(departmentIds), 更新时间: timestamp })
      }
    }
    if (existing) this.roleAccess.invalidateUserAccess(userId)
    await this.audit(existing ? '修改系统用户' : '创建系统用户', '系统用户', userId, existing?.fields || {}, fields, input.operator, input.operatorUserId)
    return { userId, status: fields.用户状态 }
  }

  async batchUpsertUsers(input: { items?: Array<{ name?: string; mobile?: string }>; departmentId?: string; department?: string; operator?: string; operatorUserId?: string }) {
    const items = Array.isArray(input.items) ? input.items : []
    const departmentId = text(input.departmentId), department = text(input.department)
    if (!items.length) throw new BadRequestException('请至少提供一名员工的姓名和手机号')
    if (items.length > 500) throw new BadRequestException('单次最多批量导入500名员工')
    if (!departmentId || !department) throw new BadRequestException('请选择所属部门')
    const results: Array<{ index: number; name: string; mobile: string; status: 'success' | 'failed'; message: string; userId?: string }> = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] || {}, name = text(item.name), mobile = text(item.mobile)
      try {
        const saved = await this.upsertUser({ name, mobile, departmentIds: [departmentId], departments: [department], source: '批量导入', operator: input.operator, operatorUserId: input.operatorUserId })
        results.push({ index: index + 1, name, mobile, status: 'success', message: '已导入', userId: saved.userId })
      } catch (error) {
        results.push({ index: index + 1, name, mobile, status: 'failed', message: error instanceof Error ? error.message : '导入失败' })
      }
    }
    const succeeded = results.filter((item) => item.status === 'success').length
    return { total: items.length, succeeded, failed: results.length - succeeded, results }
  }

  private async ensureDefaultReferrerRole(userId: string, userName: string, departmentIds: string[], operator?: string, operatorUserId?: string) {
    const [roles, bindings] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_roles')),
      teable.listAllRecords(this.table('recruitment_user_roles')),
    ])
    const role = roles.find((row) => text(row.fields['角色编码']) === 'referrer' && text(row.fields['角色状态']) === '启用')
    if (!role) throw new Error('系统角色“内推人”尚未初始化，请先重试数据库初始化')
    const duplicate = bindings.find((row) => text(row.fields['用户ID']) === userId && text(row.fields['角色编码']) === 'referrer' && text(row.fields['绑定状态']) === '启用' && (!text(row.fields['失效时间']) || Date.parse(text(row.fields['失效时间'])) > Date.now()))
    if (duplicate) return false
    const timestamp = now(), bindingId = id('userrole'), fields = {
      用户角色ID: bindingId, 用户ID: userId, 用户姓名: userName, 角色编码: 'referrer', 事业部ID: '', 事业部: '',
      部门IDJSON: JSON.stringify(departmentIds.slice(0, 1)), 绑定状态: '启用', 生效时间: timestamp, 失效时间: '',
      授权人用户ID: text(operatorUserId), 授权人: text(operator) || '系统默认', 授权原因: '新建员工账号默认绑定内推人角色', 创建时间: timestamp, 更新时间: timestamp,
    }
    await teable.createRecord(this.table('recruitment_user_roles'), fields)
    this.roleAccess.invalidateUserAccess(userId)
    await this.audit('默认绑定内推人角色', '用户角色', bindingId, {}, fields, operator, operatorUserId, '新建员工账号默认角色')
    return true
  }

  async syncWecomUserIds(progress: (message: string) => void, input: { operator?: string; operatorUserId?: string }) {
    const tableId = this.table('recruitment_users'), fields = await teable.listFields(tableId), available = new Set(fields.map((field) => field.name))
    for (const required of ['用户ID', '姓名', '企业微信用户ID', '用户状态', '更新时间']) if (!available.has(required)) throw new Error(`系统用户表缺少字段：${required}`)
    const rows = (await teable.listAllRecords(tableId)).filter((row) => text(row.fields['用户状态']) !== '停用' && text(row.fields['姓名']))
    const summary: { total: number; queried: number; synced: number; normalized: number; unchanged: number; ambiguous: Array<{ userId: string; name: string }>; notFound: Array<{ userId: string; name: string }>; failed: Array<{ userId: string; name: string; message: string }> } = { total: rows.length, queried: 0, synced: 0, normalized: 0, unchanged: 0, ambiguous: [], notFound: [], failed: [] }
    const pending = rows.filter((row) => {
      const wecomUserId = text(row.fields['企业微信用户ID'])
      const tianjiWechatId = text(row.fields['天玑微信ID'])
      return !wecomUserId || (available.has('天玑微信ID') && wecomUserId !== tianjiWechatId)
    })
    summary.unchanged = rows.length - pending.length
    for (let offset = 0; offset < pending.length; offset += 4) {
      const batch = pending.slice(offset, offset + 4)
      await Promise.all(batch.map(async (row) => {
        const userId = text(row.fields['用户ID']) || row.id, name = text(row.fields['姓名']), mobile = normalizePhone(row.fields['手机']), email = normalizeEmail(row.fields['邮箱'])
        const keywords = [...new Set([name, mobile, email].filter(Boolean))]
        try {
          const employees = await tianji.searchEmployees(name)
          const found: any[] = [...new Map<string, any>(employees.filter((item: any) => text(item?.wechat_id)).map((item: any) => [text(item.wechat_id), item])).values()]
          const contactMatches = found.filter((item) => (email && normalizeEmail(item?.employee_email) === email) || (mobile && normalizePhone(item?.employee_phone) === mobile))
          const nameMatches = found.filter((item) => normalizeName(item?.employee_name) === normalizeName(name))
          const matches = contactMatches.length ? contactMatches : nameMatches
          if (!matches.length) { summary.notFound.push({ userId, name }); return }
          if (matches.length > 1) { summary.ambiguous.push({ userId, name }); return }
          const matchedUserId = text(matches[0]?.wechat_id), patch: Record<string, unknown> = { 企业微信用户ID: matchedUserId, 最近同步时间: now(), 更新时间: now() }
          if (available.has('天玑微信ID')) patch['天玑微信ID'] = matchedUserId
          await teable.updateRecord(tableId, row.id, patch)
          summary.synced += 1
        } catch (error) { summary.failed.push({ userId, name, message: error instanceof Error ? error.message : '企业微信查询失败' }) }
      }))
      summary.queried += batch.length
      progress(`正在核对企业微信成员 ${Math.min(offset + batch.length, pending.length)}/${pending.length}`)
    }
    progress(`同步完成：通讯录更新 ${summary.synced} 人，兼容回填 ${summary.normalized} 人，待人工处理 ${summary.ambiguous.length + summary.notFound.length + summary.failed.length} 人`)
    await this.audit('同步企业微信成员ID', '系统用户', 'wecom-directory-sync', {}, { total: summary.total, synced: summary.synced, normalized: summary.normalized, unchanged: summary.unchanged, ambiguous: summary.ambiguous.length, notFound: summary.notFound.length, failed: summary.failed.length }, input.operator, input.operatorUserId, '企微成员ID同时作为个人机器人私信ID；按姓名、手机号、邮箱查询通讯录，仅唯一精确结果自动回填')
    return summary
  }

  async syncTianjiEmployeeStatus(progress: (message: string) => void, input: { operator?: string; operatorUserId?: string }) {
    const tableId = this.table('recruitment_users'), available = new Set((await teable.listFields(tableId)).map((field) => field.name))
    if (!available.has('天玑人事状态')) throw new Error('系统用户表缺少天玑人事状态字段，请重新初始化数据库')
    const roster: any[] = []
    for (let page = 1; page <= 100; page += 1) {
      progress(`正在读取天玑花名册第 ${page} 页`)
      const data = await this.fetchTianjiRosterPage(page), list = Array.isArray(data.list) ? data.list : []
      roster.push(...list)
      if (!list.length || list.length < 200 || (Number(data.count) > 0 && roster.length >= Number(data.count))) break
    }
    const rows = await teable.listAllRecords(tableId), byPhone = new Map<string, any[]>()
    for (const person of roster) { const phone = normalizePhone(person.employee_phone); if (phone) byPhone.set(phone, [...(byPhone.get(phone) || []), person]) }
    const userSummary = { total: rows.length, matched: 0, active: 0, left: 0, ambiguous: 0, missing: 0 }
    for (const row of rows) {
      const matches = byPhone.get(normalizePhone(row.fields['手机'])) || []
      if (matches.length !== 1) { if (matches.length > 1) userSummary.ambiguous += 1; else userSummary.missing += 1; continue }
      const status = tianjiStatus(matches[0])
      if (!['在职', '离职'].includes(status)) continue
      await teable.updateRecord(tableId, row.id, { 天玑人事状态: status, 最近同步时间: now(), 更新时间: now() })
      userSummary.matched += 1; if (status === '在职') userSummary.active += 1; else userSummary.left += 1
    }
    const candidateTable = this.table('recruitment_candidates'), resumeTable = this.table('resume_extraction_records')
    const [candidateFields, resumeFields, candidates, resumes, onboardings, offboardings] = await Promise.all([
      teable.listFields(candidateTable), teable.listFields(resumeTable), teable.listAllRecords(candidateTable), teable.listAllRecords(resumeTable),
      teable.listAllRecords(this.table('recruitment_onboarding_cases')), teable.listAllRecords(this.table('recruitment_offboarding_cases')),
    ])
    for (const required of ['天玑人事状态', '天玑员工ID', '天玑入职日期', '天玑离职日期', '天玑最近同步时间']) if (!candidateFields.some((field) => field.name === required)) throw new Error(`人才主档缺少字段：${required}，请重新初始化数据库`)
    if (!resumeFields.some((field) => field.name === '天玑人事状态')) throw new Error('简历记录表缺少天玑人事状态字段，请重新初始化数据库')
    const resumesByCandidate = new Map<string, any[]>(), resumesById = new Map<string, any>()
    for (const resume of resumes) {
      const candidateId = text(resume.fields['候选人ID'])
      if (candidateId) resumesByCandidate.set(candidateId, [...(resumesByCandidate.get(candidateId) || []), resume])
      resumesById.set(resume.id, resume)
      const resumeId = text(resume.fields['解析记录ID'])
      if (resumeId) resumesById.set(resumeId, resume)
    }
    const resumeSummary = { total: resumes.length, matched: 0, active: 0, left: 0, ambiguous: 0, missing: 0 }
    const summary = { roster: roster.length, matched: 0, active: 0, left: 0, hireDateSynced: 0, leaveDateSynced: 0, ambiguous: 0, missing: 0, lifecycleUpdated: 0, systemUsers: userSummary, resumeRecords: resumeSummary }
    const updatedResumeIds = new Set<string>()
    const visibleCandidates = candidates.filter((row) => text(row.fields['合并状态']) !== '已合并' && text(row.fields['候选人状态']) !== '已删除')
    const candidateContexts = visibleCandidates.map((row) => {
      const candidateId = text(row.fields['候选人ID']) || row.id, linkedResume = resumesById.get(text(row.fields['最新简历记录ID']))
      const candidateResumes = [...new Map([...(resumesByCandidate.get(candidateId) || []), ...(linkedResume ? [linkedResume] : [])].map((resume) => [resume.id, resume])).values()]
      const phone = normalizePhone(row.fields['电话']) || candidateResumes.map((resume) => normalizePhone(resume.fields['电话'])).find(Boolean) || ''
      return { row, candidateId, candidateResumes, phone, matches: phone ? byPhone.get(phone) || [] : [] }
    })
    const detailTargets = [...new Map(candidateContexts.filter((item) => item.matches.length === 1).map((item) => [text(item.matches[0].id), item.matches[0]])).values()].filter((person) => text(person.id))
    const rosterDetails = new Map<string, any>()
    for (let index = 0; index < detailTargets.length; index += 4) {
      const batch = detailTargets.slice(index, index + 4)
      await Promise.all(batch.map(async (person) => {
        const personId = text(person.id)
        if (text(person.create_time)) { rosterDetails.set(personId, person); return }
        try { rosterDetails.set(personId, { ...person, ...(await this.fetchTianjiRosterDetail(personId)) }) }
        catch { rosterDetails.set(personId, person) }
      }))
      progress(`正在读取天玑员工入职时间 ${Math.min(index + batch.length, detailTargets.length)}/${detailTargets.length}`)
    }
    for (let index = 0; index < candidateContexts.length; index += 1) {
      const { row, candidateId, candidateResumes, phone, matches } = candidateContexts[index]
      if (!phone) { summary.missing += 1; continue }
      if (matches.length !== 1) { if (matches.length > 1) summary.ambiguous += 1; else summary.missing += 1; continue }
      const person = rosterDetails.get(text(matches[0].id)) || matches[0], status = tianjiStatus(person)
      if (!status) continue
      const timestamp = now(), hireDate = tianjiDate(person.create_time), leaveDate = tianjiDate(person.leave_date)
      const candidatePatch: Record<string, unknown> = { 天玑人事状态: status, 天玑员工ID: text(person.id), 天玑离职日期: leaveDate, 天玑最近同步时间: timestamp, 更新时间: timestamp }
      if (hireDate) candidatePatch['天玑入职日期'] = hireDate
      await teable.updateRecord(candidateTable, row.id, candidatePatch)
      if (hireDate) summary.hireDateSynced += 1
      if (leaveDate) summary.leaveDateSynced += 1
      for (const resume of candidateResumes) {
        await teable.updateRecord(resumeTable, resume.id, { 天玑人事状态: status, 更新时间: timestamp })
        updatedResumeIds.add(resume.id)
        resumeSummary.matched += 1
        if (status === '在职') resumeSummary.active += 1
        else resumeSummary.left += 1
      }
      let lifecycleChanged = false
      const onboarding = onboardings.filter((item) => text(item.fields['候选人ID']) === candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
      if (onboarding) {
        const patch: Record<string, unknown> = { 更新时间: timestamp }
        if (hireDate && text(onboarding.fields['实际到岗日期']) !== hireDate) patch['实际到岗日期'] = hireDate
        if (status === '在职' && ['待入职', ''].includes(text(onboarding.fields['入职状态']))) patch['入职状态'] = '已入职'
        if (status === '离职' && text(onboarding.fields['入职状态']) !== '已离职') patch['入职状态'] = '已离职'
        if (Object.keys(patch).length > 1) { await teable.updateRecord(this.table('recruitment_onboarding_cases'), onboarding.id, patch); lifecycleChanged = true }
      }
      if (status === '离职') {
        const offboarding = offboardings.filter((item) => text(item.fields['候选人ID']) === candidateId).sort((a, b) => text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0]
        if (offboarding) {
          const patch: Record<string, unknown> = { 离职状态: '已离职', 更新时间: timestamp }
          if (leaveDate && !text(offboarding.fields['实际离职日期'])) patch['实际离职日期'] = leaveDate
          await teable.updateRecord(this.table('recruitment_offboarding_cases'), offboarding.id, patch)
          lifecycleChanged = true
        }
      }
      if (lifecycleChanged) summary.lifecycleUpdated += 1
      summary.matched += 1
      if (status === '在职') summary.active += 1
      else summary.left += 1
      if ((index + 1) % 25 === 0 || index + 1 === visibleCandidates.length) progress(`正在同步人才库员工状态 ${index + 1}/${visibleCandidates.length}`)
    }
    for (const resume of resumes) {
      if (updatedResumeIds.has(resume.id)) continue
      const phone = normalizePhone(resume.fields['电话'])
      if (!phone) { resumeSummary.missing += 1; continue }
      const matches = byPhone.get(phone) || []
      if (matches.length !== 1) { if (matches.length > 1) resumeSummary.ambiguous += 1; else resumeSummary.missing += 1; continue }
      const status = tianjiStatus(matches[0])
      if (!status) continue
      await teable.updateRecord(resumeTable, resume.id, { 天玑人事状态: status, 更新时间: now() })
      resumeSummary.matched += 1
      if (status === '在职') resumeSummary.active += 1
      else resumeSummary.left += 1
    }
    await this.audit('同步天玑员工状态', '系统用户', 'tianji-roster-sync', {}, summary, input.operator, input.operatorUserId, '按手机号匹配天玑花名册并同步在职离职状态')
    progress(`同步完成：人才库匹配 ${summary.matched} 人，在职 ${summary.active} 人，离职 ${summary.left} 人，未匹配 ${summary.missing} 人（状态保持不变）`)
    return summary
  }

  private async fetchTianjiRosterPage(page: number) {
    const response: any = await callMcp('tianji_call', {
      path: '/api/admin/organization/roster/getRosterList',
      query: { page, pageSize: 200 },
      fields: ['id', 'employee_name', 'employee_phone', 'status', 'status_text', 'create_time', 'hire_date', 'leave_date'],
    })
    return response?.data || response?.result || response || {}
  }

  private async fetchTianjiRosterDetail(id: string) {
    const response: any = await callMcp('tianji_call', {
      path: '/api/admin/organization/roster/getRosterDetail',
      query: { id },
      fields: ['id', 'employee_phone', 'status', 'status_text', 'create_time', 'leave_date'],
    })
    return response?.data || response?.result || response || {}
  }

  async updateRolePermissions(code: string, input: { pages?: string[]; actions?: string[]; sensitiveFields?: Record<string, unknown>; operator?: string; operatorUserId?: string }) {
    const tableId = this.table('recruitment_roles'), rows = await teable.listAllRecords(tableId), row = rows.find((item) => text(item.fields['角色编码']) === code)
    if (!row) throw new NotFoundException('角色不存在')
    const fields = { 页面权限JSON: JSON.stringify(Array.isArray(input.pages) ? input.pages : []), 操作权限JSON: JSON.stringify(Array.isArray(input.actions) ? input.actions : []), 敏感字段策略JSON: JSON.stringify(input.sensitiveFields || {}), 更新时间: now() }
    await teable.updateRecord(tableId, row.id, fields)
    this.roleAccess.invalidateRoleMetadata()
    await this.audit('更新角色权限', '角色', code, {}, fields, input.operator, input.operatorUserId, '管理员配置菜单、操作和字段权限')
    return { code, ...fields }
  }

  async createRole(input: { code?: string; name?: string; description?: string; level?: string; dataScope?: string; pages?: string[]; actions?: string[]; sensitiveFields?: Record<string, unknown>; operator?: string; operatorUserId?: string }) {
    const code = text(input.code).toLowerCase()
    const name = text(input.name)
    const description = text(input.description)
    const level = text(input.level) || 'L1'
    const dataScope = text(input.dataScope) || 'self'
    if (!/^[a-z][a-z0-9_:-]{1,63}$/.test(code)) throw new BadRequestException('角色编码需以字母开头，可包含小写字母、数字、下划线、冒号或中划线，长度2-64位')
    if (name.length < 2 || name.length > 30) throw new BadRequestException('角色名称需为2-30个字符')
    if (description.length > 300) throw new BadRequestException('角色说明不能超过300个字符')
    if (!ROLE_LEVELS.has(level)) throw new BadRequestException('角色层级无效')
    if (!ROLE_DATA_SCOPES.has(dataScope)) throw new BadRequestException('角色数据范围无效')
    const pages = (input.pages || []).map(text).filter(Boolean)
    const actions = (input.actions || []).map(text).filter(Boolean)
    if (!pages.length) throw new BadRequestException('请至少选择一个页面权限')
    if (!actions.length) throw new BadRequestException('请至少选择一个操作权限')
    const tableId = this.table('recruitment_roles'), rows = await teable.listAllRecords(tableId)
    if (rows.some((row) => text(row.fields['角色编码']).toLowerCase() === code)) throw new ConflictException('角色编码已存在')
    if (rows.some((row) => text(row.fields['角色名称']) === name)) throw new ConflictException('角色名称已存在')
    const fields = { 角色编码: code, 角色名称: name, 角色说明: description, 角色层级: level, 数据范围类型: dataScope, 页面权限JSON: JSON.stringify(pages), 操作权限JSON: JSON.stringify(actions), 敏感字段策略JSON: JSON.stringify(input.sensitiveFields || {}), 是否系统角色: '否', 角色状态: '启用', 版本: 1, 创建时间: now(), 更新时间: now() }
    await teable.createRecord(tableId, fields)
    this.roleAccess.invalidateRoleMetadata()
    await this.audit('新增角色', '角色', code, {}, fields, input.operator, input.operatorUserId, '管理员新增自定义角色')
    return { code, name, status: '启用', system: false }
  }

  async updateRole(code: string, input: { name?: string; description?: string; level?: string; dataScope?: string; operator?: string; operatorUserId?: string }) {
    const tableId = this.table('recruitment_roles'), rows = await teable.listAllRecords(tableId), row = rows.find((item) => text(item.fields['角色编码']) === code)
    if (!row) throw new NotFoundException('角色不存在')
    const name = text(input.name)
    const description = text(input.description)
    const level = text(input.level) || text(row.fields['角色层级']) || 'L1'
    const dataScope = text(input.dataScope) || text(row.fields['数据范围类型']) || 'self'
    if (name.length < 2 || name.length > 30) throw new BadRequestException('角色名称需为2-30个字符')
    if (description.length > 300) throw new BadRequestException('角色说明不能超过300个字符')
    if (!ROLE_LEVELS.has(level)) throw new BadRequestException('角色层级无效')
    if (!ROLE_DATA_SCOPES.has(dataScope)) throw new BadRequestException('角色数据范围无效')
    if (rows.some((item) => item.id !== row.id && text(item.fields['角色名称']) === name)) throw new ConflictException('角色名称已存在')
    const fields = { 角色名称: name, 角色说明: description, 角色层级: level, 数据范围类型: dataScope, 更新时间: now() }
    await teable.updateRecord(tableId, row.id, fields)
    this.roleAccess.invalidateRoleMetadata()
    await this.audit('更新角色', '角色', code, { name: text(row.fields['角色名称']), level: text(row.fields['角色层级']), dataScope: text(row.fields['数据范围类型']) }, fields, input.operator, input.operatorUserId, '管理员维护角色基础信息')
    return { code, ...fields }
  }

  async updateRoleStatus(code: string, status: string, input: { operator?: string; operatorUserId?: string } = {}) {
    const tableId = this.table('recruitment_roles'), rows = await teable.listAllRecords(tableId), row = rows.find((item) => text(item.fields['角色编码']) === code)
    if (!row) throw new NotFoundException('角色不存在')
    if (!['启用', '停用'].includes(status)) throw new BadRequestException('角色状态无效')
    if (status === '停用' && code === 'system_admin') throw new BadRequestException('超级管理员角色不能停用')
    if (text(row.fields['角色状态']) === status) return { code, status, changed: false }
    const fields = { 角色状态: status, 更新时间: now() }
    await teable.updateRecord(tableId, row.id, fields)
    this.roleAccess.invalidateRoleMetadata()
    await this.audit(status === '启用' ? '启用角色' : '停用角色', '角色', code, { status: text(row.fields['角色状态']) }, fields, input.operator, input.operatorUserId, `管理员${status}角色，绑定关系保留`)
    return { code, status, changed: true }
  }

  async assignRole(input: { userId: string; roleCode: string; businessUnitId?: string; businessUnit?: string; departmentIds?: string[]; startsAt?: string; expiresAt?: string; reason?: string; operator?: string; operatorUserId?: string }) {
    if (!text(input.userId) || !text(input.roleCode)) throw new BadRequestException('用户和权限角色不能为空')
    const [users, roles, bindings] = await Promise.all(['recruitment_users', 'recruitment_roles', 'recruitment_user_roles'].map((name) => teable.listAllRecords(this.table(name))))
    const user = users.find((row) => text(row.fields['用户ID']) === input.userId && text(row.fields['用户状态']) !== '停用')
    if (!user) throw new NotFoundException('系统用户不存在或已停用')
    const role = roles.find((row) => text(row.fields['角色编码']) === input.roleCode && text(row.fields['角色状态']) === '启用')
    if (!role) throw new NotFoundException('角色不存在或已停用')
    const duplicate = bindings.find((row) => text(row.fields['用户ID']) === input.userId && text(row.fields['角色编码']) === input.roleCode && text(row.fields['绑定状态']) === '启用' && (!text(row.fields['失效时间']) || Date.parse(text(row.fields['失效时间'])) > Date.now()))
    if (duplicate) throw new ConflictException('该用户已经拥有此有效角色')
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) throw new BadRequestException('角色失效时间必须晚于当前时间')
    const employeeDepartments = json<string[]>(user.fields['部门IDJSON'], []).filter(Boolean).slice(0, 1)
    // 兼容历史申请账号：旧记录可能只有部门名称而无部门ID；新页面不会传此字段。
    const inheritedDepartments = employeeDepartments.length ? employeeDepartments : (input.departmentIds || []).map(text).filter(Boolean).slice(0, 1)
    if (!inheritedDepartments.length) throw new BadRequestException('该员工尚未归属部门，无法配置权限')
    const reason = text(input.reason) || `管理员配置${text(role.fields['角色名称']) || input.roleCode}权限`
    const bindingId = id('userrole'), timestamp = now(), fields = { 用户角色ID: bindingId, 用户ID: input.userId, 用户姓名: text(user.fields['姓名']), 角色编码: input.roleCode, 事业部ID: text(input.businessUnitId) || text(user.fields['事业部ID']), 事业部: text(input.businessUnit) || text(user.fields['事业部']), 部门IDJSON: JSON.stringify(inheritedDepartments), 绑定状态: '启用', 生效时间: input.startsAt || timestamp, 失效时间: text(input.expiresAt), 授权人用户ID: text(input.operatorUserId), 授权人: text(input.operator) || '管理员', 授权原因: reason, 创建时间: timestamp, 更新时间: timestamp }
    await teable.createRecord(this.table('recruitment_user_roles'), fields)
    if (text(user.fields['用户状态']) !== '启用') {
      const usersTableId = this.table('recruitment_users')
      const userFields = await teable.listFields(usersTableId)
      if (!userFields.some((field) => field.name === '用户状态')) throw new Error('系统用户表缺少用户状态字段')
      await teable.updateRecord(usersTableId, user.id, { 用户状态: '启用', 更新时间: timestamp })
    }
    this.roleAccess.invalidateUserAccess(input.userId)
    await this.audit('配置员工权限', '用户角色', bindingId, {}, fields, input.operator, input.operatorUserId, reason)
    return { bindingId, userId: input.userId, roleCode: input.roleCode, status: '启用' }
  }

  async assignRolesBatch(input: { userIds?: string[]; roleCodes?: string[]; expiresAt?: string; reason?: string; operator?: string; operatorUserId?: string }) {
    const userIds = [...new Set((input.userIds || []).map(text).filter(Boolean))]
    const roleCodes = [...new Set((input.roleCodes || []).map(text).filter(Boolean))]
    if (!userIds.length || !roleCodes.length) throw new BadRequestException('请选择员工和至少一个权限角色')
    if (userIds.length > 100) throw new BadRequestException('单次最多为100名员工批量分配权限')
    if (roleCodes.length > 20 || userIds.length * roleCodes.length > 200) throw new BadRequestException('单次最多新增200条角色绑定，请减少员工或角色后分批操作')
    const expiresAt = text(input.expiresAt)
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) throw new BadRequestException('角色失效时间必须晚于当前时间')
    const [users, roles, bindings, organizations] = await Promise.all(['recruitment_users', 'recruitment_roles', 'recruitment_user_roles', 'recruitment_organization_units'].map((name) => teable.listAllRecords(this.table(name))))
    const userById = new Map(users.map((row) => [text(row.fields['用户ID']), row]))
    const roleByCode = new Map(roles.map((row) => [text(row.fields['角色编码']), row]))
    const selectedUsers = userIds.map((userId) => userById.get(userId))
    if (selectedUsers.some((row) => !row || text(row.fields['用户状态']) === '停用')) throw new NotFoundException('所选员工中包含不存在或已停用的账号，请刷新员工列表后重试')
    const selectedRoles = roleCodes.map((roleCode) => roleByCode.get(roleCode))
    if (selectedRoles.some((row) => !row || text(row.fields['角色状态']) !== '启用')) throw new NotFoundException('所选角色中包含不存在或已停用的权限，请刷新后重试')
    const currentTime = Date.now()
    const activeBindings = new Set(bindings.filter((row) => text(row.fields['绑定状态']) === '启用' && (!text(row.fields['失效时间']) || Date.parse(text(row.fields['失效时间'])) > currentTime)).map((row) => `${text(row.fields['用户ID'])}\u0000${text(row.fields['角色编码'])}`))
    const timestamp = now()
    const grants: Array<{ fields: Record<string, any>; userId: string; roleCode: string }> = []
    const activeDepartmentIds = new Set(organizations.filter((row) => text(row.fields['组织类型']) === '部门' && text(row.fields['组织状态']) !== '停用').map((row) => text(row.fields['组织单元ID']) || row.id))
    const missingDepartments: string[] = []
    let alreadyHad = 0
    for (const user of selectedUsers) {
      const userId = text(user!.fields['用户ID'])
      let departmentIds = json<string[]>(user!.fields['部门IDJSON'], []).map(text).filter((departmentId) => activeDepartmentIds.has(departmentId)).slice(0, 1)
      if (!departmentIds.length) {
        const departmentNames = json<string[]>(user!.fields['部门JSON'], []).map(text).filter(Boolean)
        const matches = organizations.filter((row) => departmentNames.includes(text(row.fields['组织名称'])) && text(row.fields['组织类型']) === '部门' && text(row.fields['组织状态']) !== '停用')
        const matchedDepartmentIds = [...new Set(matches.map((row) => text(row.fields['组织单元ID']) || row.id))]
        if (matchedDepartmentIds.length === 1) departmentIds = matchedDepartmentIds
      }
      if (!departmentIds.length) {
        missingDepartments.push(`${text(user!.fields['姓名']) || userId}（部门未配置或名称不唯一）`)
        continue
      }
      for (const role of selectedRoles) {
        const roleCode = text(role!.fields['角色编码']), key = `${userId}\u0000${roleCode}`
        if (activeBindings.has(key)) { alreadyHad += 1; continue }
        const bindingId = id('userrole'), reason = text(input.reason) || `管理员批量追加${text(role!.fields['角色名称']) || roleCode}权限`
        const fields = { 用户角色ID: bindingId, 用户ID: userId, 用户姓名: text(user!.fields['姓名']), 角色编码: roleCode, 事业部ID: text(user!.fields['事业部ID']), 事业部: text(user!.fields['事业部']), 部门IDJSON: JSON.stringify(departmentIds), 绑定状态: '启用', 生效时间: timestamp, 失效时间: expiresAt, 授权人用户ID: text(input.operatorUserId), 授权人: text(input.operator) || '管理员', 授权原因: reason, 创建时间: timestamp, 更新时间: timestamp }
        grants.push({ fields, userId, roleCode })
        activeBindings.add(key)
      }
    }
    if (missingDepartments.length) throw new BadRequestException(`以下员工尚未归属有效部门，未进行任何授权：${missingDepartments.slice(0, 8).join('、')}${missingDepartments.length > 8 ? '等' : ''}`)
    if (!grants.length) return { assigned: 0, alreadyHad, activatedUsers: 0, userCount: userIds.length, roleCount: roleCodes.length }
    const bindingTable = this.table('recruitment_user_roles'), auditTable = this.table('recruitment_audit_logs'), usersTable = this.table('recruitment_users')
    const activatedUsers = selectedUsers.filter((user) => text(user!.fields['用户状态']) !== '启用' && grants.some((grant) => grant.userId === text(user!.fields['用户ID'])))
    const [bindingFields, auditFields] = await Promise.all([teable.listFields(bindingTable), teable.listFields(auditTable)])
    const availableBindingFields = new Set(bindingFields.map((field) => field.name)), availableAuditFields = new Set(auditFields.map((field) => field.name))
    const missingBindingFields = [...new Set(grants.flatMap((grant) => Object.keys(grant.fields)))].filter((field) => !availableBindingFields.has(field))
    if (missingBindingFields.length) throw new Error(`员工权限表缺少字段：${missingBindingFields.join('、')}，请先初始化数据库`)
    const auditRows = grants.map(({ fields }) => ({ 日志ID: id('audit'), 操作人用户ID: text(input.operatorUserId), 操作人: text(input.operator) || '当前用户', 操作角色: '', 操作类型: '批量配置员工权限', 对象类型: '用户角色', 对象ID: fields.用户角色ID, 修改前摘要JSON: '{}', 修改后摘要JSON: JSON.stringify(fields), 操作原因: text(fields['授权原因']), 请求ID: id('req'), 发生时间: timestamp, 操作结果: '成功', 错误信息: '' }))
    const missingAuditFields = [...new Set(auditRows.flatMap((fields) => Object.keys(fields)))].filter((field) => !availableAuditFields.has(field))
    if (missingAuditFields.length) throw new Error(`权限审计表缺少字段：${missingAuditFields.join('、')}，请先初始化数据库`)
    if (activatedUsers.length) {
      const availableUserFields = new Set((await teable.listFields(usersTable)).map((field) => field.name))
      const missingUserFields = ['用户状态', '更新时间'].filter((field) => !availableUserFields.has(field))
      if (missingUserFields.length) throw new Error(`系统用户表缺少字段：${missingUserFields.join('、')}，请先初始化数据库`)
    }
    for (let index = 0; index < grants.length; index += 20) {
      const batch = grants.slice(index, index + 20)
      const created = await teable.createRecords(bindingTable, batch.map((grant) => grant.fields))
      if (created.length !== batch.length) throw new Error(`批量授权写入返回${created.length}条，预期${batch.length}条`)
      await teable.createRecords(auditTable, auditRows.slice(index, index + 20))
    }
    for (let index = 0; index < activatedUsers.length; index += 10) {
      await Promise.all(activatedUsers.slice(index, index + 10).map((user) => teable.updateRecord(usersTable, user!.id, { 用户状态: '启用', 更新时间: timestamp })))
    }
    for (const userId of new Set(grants.map((grant) => grant.userId))) this.roleAccess.invalidateUserAccess(userId)
    return { assigned: grants.length, alreadyHad, activatedUsers: activatedUsers.length, userCount: userIds.length, roleCount: roleCodes.length }
  }

  async revokeRole(bindingId: string, input: { reason: string; operator?: string; operatorUserId?: string }) {
    if (!text(input.reason)) throw new BadRequestException('撤销原因不能为空')
    const rows = await teable.listAllRecords(this.table('recruitment_user_roles')), row = rows.find((item) => text(item.fields['用户角色ID']) === bindingId || item.id === bindingId)
    if (!row) throw new NotFoundException('用户角色绑定不存在')
    if (text(row.fields['绑定状态']) !== '启用') throw new ConflictException('该角色绑定已经停用')
    if (text(row.fields['角色编码']) === 'system_admin') {
      const activeAdministrators = rows.filter((item) => text(item.fields['角色编码']) === 'system_admin' && text(item.fields['绑定状态']) === '启用' && (!text(item.fields['失效时间']) || Date.parse(text(item.fields['失效时间'])) > Date.now()))
      if (activeAdministrators.length <= 1) throw new ConflictException('不能撤销系统中最后一名有效管理员')
    }
    const patch = { 绑定状态: '停用', 失效时间: now(), 更新时间: now() }
    await teable.updateRecord(this.table('recruitment_user_roles'), row.id, patch)
    this.roleAccess.invalidateUserAccess(text(row.fields['用户ID']))
    await this.audit('撤销用户角色', '用户角色', text(row.fields['用户角色ID']) || row.id, row.fields, patch, input.operator, input.operatorUserId, input.reason)
    return { bindingId: text(row.fields['用户角色ID']) || row.id, status: '停用' }
  }

  async requestSensitiveAccess(profile: RoleAccessProfile, input: { candidateId: string; fields: string[]; reason: string; operator?: string }) {
    if (!text(input.candidateId) || !input.fields?.length || !text(input.reason)) throw new BadRequestException('候选人、敏感字段和申请原因不能为空')
    const canRequest = profile.sensitiveFields.some((policy) => policy.unlock === true || policy.unlock === 'approval_required')
    if (!canRequest) throw new ForbiddenException('当前角色不允许申请敏感字段解锁')
    const pending = (await teable.listAllRecords(this.table('recruitment_sensitive_access_requests'))).find((row) => text(row.fields['申请人用户ID']) === profile.userId && text(row.fields['候选人ID']) === input.candidateId && text(row.fields['申请状态']) === '待审批')
    if (pending) throw new ConflictException('该人才已有待审批的敏感字段申请')
    const requestId = id('unlock'), timestamp = now(), fields = { 解锁申请ID: requestId, 申请人用户ID: profile.userId, 申请人: text(input.operator) || profile.userId, 申请角色JSON: JSON.stringify(profile.roleCodes), 对象类型: '人才档案', 对象ID: input.candidateId, 候选人ID: input.candidateId, 敏感字段JSON: JSON.stringify([...new Set(input.fields)]), 申请原因: input.reason, 申请状态: '待审批', 创建时间: timestamp, 更新时间: timestamp }
    await teable.createRecord(this.table('recruitment_sensitive_access_requests'), fields)
    await this.audit('申请敏感字段解锁', '敏感字段申请', requestId, {}, fields, input.operator, profile.userId, input.reason)
    return { requestId, status: '待审批' }
  }

  async decideSensitiveAccess(requestId: string, input: { decision: '通过' | '驳回'; opinion: string; durationHours?: number; operator?: string; operatorUserId?: string }) {
    if (!text(input.opinion)) throw new BadRequestException('审批意见不能为空')
    const rows = await teable.listAllRecords(this.table('recruitment_sensitive_access_requests')), row = rows.find((item) => text(item.fields['解锁申请ID']) === requestId || item.id === requestId)
    if (!row) throw new NotFoundException('敏感字段申请不存在')
    if (text(row.fields['申请状态']) !== '待审批') throw new ConflictException('该申请已经处理')
    const timestamp = now(), approved = input.decision === '通过', durationHours = Math.max(1, Math.min(24, Math.round(Number(input.durationHours) || 2))), expiresAt = approved ? new Date(Date.now() + durationHours * 3600000).toISOString() : ''
    const patch = { 申请状态: approved ? '已通过' : '已驳回', 审批人用户ID: text(input.operatorUserId), 审批人: text(input.operator) || '管理员', 审批意见: input.opinion, 审批时间: timestamp, 授权开始时间: approved ? timestamp : '', 授权到期时间: expiresAt, 更新时间: timestamp }
    await teable.updateRecord(this.table('recruitment_sensitive_access_requests'), row.id, patch)
    await this.audit('审批敏感字段解锁', '敏感字段申请', text(row.fields['解锁申请ID']) || row.id, row.fields, patch, input.operator, input.operatorUserId, input.opinion)
    return { requestId: text(row.fields['解锁申请ID']) || row.id, status: patch.申请状态, expiresAt }
  }

  async activeUnlockFields(userId: string, candidateId: string) {
    return (await this.activeUnlockFieldsForCandidates(userId, [candidateId])).get(candidateId) || []
  }

  /**
   * 人才档案列表会一次返回一页人才。授权记录必须只读取一次，再按候选人分组；
   * 不能为列表中的每一个人重复请求同一张授权表。
   */
  async activeUnlockFieldsForCandidates(userId: string, candidateIds: string[]) {
    const wanted = new Set(candidateIds.map(text).filter(Boolean)), result = new Map<string, string[]>()
    if (!text(userId) || !wanted.size) return result
    const applicant = text(userId).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const rows = await teable.listAllRecords(this.table('recruitment_sensitive_access_requests'), { filterByTql: `{申请人用户ID} = "${applicant}"` }), timestamp = Date.now(), fieldsByCandidate = new Map<string, Set<string>>()
    for (const row of rows) {
      const candidateId = text(row.fields['候选人ID'])
      if (!wanted.has(candidateId) || text(row.fields['申请人用户ID']) !== userId || text(row.fields['申请状态']) !== '已通过') continue
      if (Date.parse(text(row.fields['授权开始时间'])) > timestamp || Date.parse(text(row.fields['授权到期时间'])) <= timestamp) continue
      const fields = fieldsByCandidate.get(candidateId) || new Set<string>()
      for (const field of json<string[]>(row.fields['敏感字段JSON'], [])) fields.add(field)
      fieldsByCandidate.set(candidateId, fields)
    }
    for (const [candidateId, fields] of fieldsByCandidate) result.set(candidateId, [...fields])
    return result
  }

  private mapRequest(row: any) { return { id: text(row.fields['解锁申请ID']) || row.id, applicantUserId: text(row.fields['申请人用户ID']), applicant: text(row.fields['申请人']), roles: json(row.fields['申请角色JSON'], []), candidateId: text(row.fields['候选人ID']), fields: json(row.fields['敏感字段JSON'], []), reason: text(row.fields['申请原因']), status: text(row.fields['申请状态']), approver: text(row.fields['审批人']), opinion: text(row.fields['审批意见']), startsAt: text(row.fields['授权开始时间']), expiresAt: text(row.fields['授权到期时间']), createdAt: text(row.fields['创建时间']) } }
  private async audit(action: string, objectType: string, objectId: string, before: unknown, after: unknown, operator?: string, operatorUserId?: string, reason?: string) { await teable.createRecord(this.table('recruitment_audit_logs'), { 日志ID: id('audit'), 操作人用户ID: text(operatorUserId), 操作人: text(operator) || '当前用户', 操作角色: '', 操作类型: action, 对象类型: objectType, 对象ID: objectId, 修改前摘要JSON: JSON.stringify(before), 修改后摘要JSON: JSON.stringify(after), 操作原因: text(reason), 请求ID: id('req'), 发生时间: now(), 操作结果: '成功', 错误信息: '' }) }
}
