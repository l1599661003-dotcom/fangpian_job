import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { teable } from '../../platform/teable'
import { RECRUITMENT_TABLES, RecruitmentTableDefinition, SYSTEM_ROLE_TEMPLATES } from './database.schema'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name)
  private tableIds = new Map<string, string>()
  private state: 'initializing' | 'ready' | 'degraded' = 'initializing'
  private lastAttemptAt = ''
  private readyAt = ''
  private lastError = ''
  private retryCount = 0
  private retryTimer?: NodeJS.Timeout
  private initializing?: Promise<void>

  async onModuleInit() {
    await this.tryInitialize()
  }

  onModuleDestroy() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
  }

  async initialize() {
    const created: string[] = []
    const reused: string[] = []
    for (const definition of RECRUITMENT_TABLES) {
      const result = await this.ensureTable(definition)
      ;(result.created ? created : reused).push(definition.name)
    }
    await this.seedSystemRoles()
    this.logger.log(`招聘数据库初始化完成：新建 ${created.length} 张，复用 ${reused.length} 张，角色模板 ${SYSTEM_ROLE_TEMPLATES.length} 个`)
    return { created, reused, roleTemplates: SYSTEM_ROLE_TEMPLATES.length }
  }

  getTableId(name: string) {
    return this.tableIds.get(name) || ''
  }

  requireTableId(name: string) {
    const tableId = this.getTableId(name)
    if (!tableId || this.state !== 'ready') {
      throw new ServiceUnavailableException({
        message: '招聘数据库尚未就绪，请稍后重试',
        code: 'DATABASE_NOT_READY',
        table: name,
        database: this.getHealth(),
      })
    }
    return tableId
  }

  getHealth() {
    return {
      status: this.state,
      ready: this.state === 'ready',
      expectedTables: RECRUITMENT_TABLES.length,
      initializedTables: this.tableIds.size,
      missingTables: RECRUITMENT_TABLES.map((table) => table.name).filter((name) => !this.tableIds.has(name)),
      lastAttemptAt: this.lastAttemptAt,
      readyAt: this.readyAt,
      retryCount: this.retryCount,
      error: this.lastError,
    }
  }

  async retryInitialization() {
    await this.tryInitialize(true)
    return this.getHealth()
  }

  private async tryInitialize(manual = false) {
    if (this.initializing) return this.initializing
    if (this.state === 'ready' && !manual) return
    this.initializing = (async () => {
      this.state = 'initializing'
      this.lastAttemptAt = new Date().toISOString()
      try {
        await this.initialize()
        this.state = 'ready'
        this.readyAt = new Date().toISOString()
        this.lastError = ''
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.retryTimer = undefined
      } catch (error) {
        this.state = 'degraded'
        this.retryCount += 1
        this.lastError = error instanceof Error ? error.message : String(error)
        this.logger.error(`招聘数据库初始化失败，应用将以降级状态启动并自动重试：${this.lastError}`)
        this.scheduleRetry()
      } finally {
        this.initializing = undefined
      }
    })()
    return this.initializing
  }

  private scheduleRetry() {
    if (this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.tryInitialize()
    }, 15_000)
    this.retryTimer.unref()
  }

  private async ensureTable(definition: RecruitmentTableDefinition) {
    const table = await teable.ensureTable(definition.name)
    this.tableIds.set(definition.name, table.id)
    let fields = await teable.listFields(table.id)
    const first = definition.fields[0]
    if (table.created && fields.length === 1 && fields[0].name !== first.name) {
      await teable.updateField(table.id, fields[0].id, { name: first.name })
      fields = await teable.listFields(table.id)
    }
    const existing = new Set(fields.map((field) => field.name))
    for (const field of definition.fields) {
      if (existing.has(field.name)) continue
      await teable.createField(table.id, field)
      existing.add(field.name)
    }
    return table
  }

  private async seedSystemRoles() {
    const tableId = this.getTableId('recruitment_roles')
    if (!tableId) throw new Error('角色表尚未初始化')
    const fields = await teable.listFields(tableId)
    const available = new Set(fields.map((field) => field.name))
    const required = RECRUITMENT_TABLES.find((table) => table.name === 'recruitment_roles')?.fields || []
    for (const field of required) {
      if (!available.has(field.name)) throw new Error(`角色表缺少字段：${field.name}`)
    }
    const rows = await teable.listAllRecords(tableId)
    const existing = new Set(rows.map((row) => String(row.fields['角色编码'] || '')))
    const now = new Date().toISOString()
    for (const role of SYSTEM_ROLE_TEMPLATES) {
      const fields = {
        角色编码: role.code,
        角色名称: role.name,
        角色说明: role.description,
        角色层级: role.level,
        数据范围类型: role.dataScope,
        页面权限JSON: JSON.stringify(role.pages),
        操作权限JSON: JSON.stringify(role.actions),
        敏感字段策略JSON: JSON.stringify(role.sensitiveFields),
        是否系统角色: '是',
        角色状态: '启用',
        版本: 1,
        更新时间: now,
      }
      const existingRow = rows.find((row) => String(row.fields['角色编码'] || '') === role.code)
      if (existingRow) {
        if (['hrbp', 'recruiter'].includes(role.code)) {
          let pages: string[] = []
          try { pages = JSON.parse(String(existingRow.fields['页面权限JSON'] || '[]')) } catch { pages = [] }
          if (!Array.isArray(pages) || !pages.includes('points')) {
            const mergedPages = [...new Set([...(Array.isArray(pages) ? pages : []), 'points'])]
            await teable.updateRecord(tableId, existingRow.id, { 页面权限JSON: JSON.stringify(mergedPages), 更新时间: now })
          }
        }
        const previousDepartmentLeaderDescriptions = new Set([
          '只读查看所属部门的招聘看板、岗位、人才和面试；操作权限由管理员按需配置。',
          '可查看公司完整招聘看板（含所有部门的招聘需求、岗位达成及招聘HR）；岗位、人才档案和面试仍按所属部门范围查看，操作权限由管理员按需配置。',
        ])
        if (role.code === 'department_leader' && previousDepartmentLeaderDescriptions.has(String(existingRow.fields['角色说明'] || '').trim())) {
          await teable.updateRecord(tableId, existingRow.id, { 角色说明: role.description, 更新时间: now })
        }
        continue
      }
      await teable.createRecord(tableId, { ...fields, 创建时间: now })
    }

    // 旧版本角色不再出现在权限配置中，但保留历史记录，避免删除后影响审计数据。
    const activeCodes = new Set(SYSTEM_ROLE_TEMPLATES.map((role) => role.code))
    for (const row of rows) {
      const code = String(row.fields['角色编码'] || '')
      if (code && !activeCodes.has(code) && String(row.fields['是否系统角色'] || '') !== '否' && String(row.fields['角色状态'] || '') === '启用') {
        await teable.updateRecord(tableId, row.id, { 角色状态: '停用', 更新时间: now })
      }
    }
  }
}
