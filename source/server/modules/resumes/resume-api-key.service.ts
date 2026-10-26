import { Injectable } from '@nestjs/common'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { teable } from '../../platform/teable'
import { API_FIELDS, API_SETTINGS_TABLE, MAX_FILE_SIZE, SUPPORTED_EXTENSIONS } from './resume.constants'
import { DatabaseService } from '../database/database.service'

@Injectable()
export class ResumeApiKeyService {
  private configCache?: { expiresAt: number; value: Awaited<ReturnType<ResumeApiKeyService['loadConfig']>> }

  constructor(private readonly database: DatabaseService) {}

  private table() { return this.database.requireTableId(API_SETTINGS_TABLE) }

  private async ensureConfig() {
    const tableId = this.table()
    const [fields, rows] = await Promise.all([teable.listFields(tableId), teable.listAllRecords(tableId)])
    for (const [name] of API_FIELDS) {
      if (!fields.some((field) => field.name === name)) throw new Error(`API配置表缺少字段：${name}`)
    }
    if (!rows.some((row) => row.fields['状态'] === 'active')) {
      await this.createKey()
      return teable.listAllRecords(tableId)
    }
    return rows
  }

  private generateKey() { return `rf_live_${randomBytes(32).toString('base64url')}` }

  private async createKey() {
    const now = new Date().toISOString()
    const apiKey = this.generateKey()
    await teable.createRecord(this.table(), { '配置名称': 'ResumeFlow', 'API Key': apiKey, '状态': 'active', '创建时间': now, '更新时间': now })
    return apiKey
  }

  async getConfig() {
    if (this.configCache && this.configCache.expiresAt > Date.now()) return this.configCache.value
    const value = await this.loadConfig()
    this.configCache = { expiresAt: Date.now() + 30_000, value }
    return value
  }

  private async loadConfig() {
    const rows = await this.ensureConfig()
    const row = rows.find((item) => item.fields['状态'] === 'active')
    if (!row?.fields['API Key']) throw new Error('API 配置不存在')
    return {
      apiKey: String(row.fields['API Key']),
      createdAt: String(row.fields['创建时间'] || ''),
      expiresAt: null,
      validity: '长期有效，直到主动轮换密钥',
      uploadEndpoint: '/api/public/resumes/parse',
      statusEndpoint: '/api/public/resumes/jobs/{jobId}',
      formatsEndpoint: '/api/public/resumes/formats',
      headerName: 'X-API-Key',
      maxFileSizeMB: MAX_FILE_SIZE / 1024 / 1024,
      supportedExtensions: [...SUPPORTED_EXTENSIONS],
    }
  }

  async validate(value?: string) {
    if (!value) return false
    const current = (await this.getConfig()).apiKey
    const a = Buffer.from(value)
    const b = Buffer.from(current)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  async rotate() {
    this.configCache = undefined
    await this.ensureConfig()
    const tableId = this.table()
    const rows = await teable.listAllRecords(tableId)
    const now = new Date().toISOString()
    for (const row of rows.filter((item) => item.fields['状态'] === 'active')) {
      await teable.updateRecord(tableId, row.id, { '状态': 'rotated', '更新时间': now })
    }
    await this.createKey()
    return this.getConfig()
  }
}
