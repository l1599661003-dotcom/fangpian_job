import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { callMcp } from './mcp'
import { invalidateReadTables } from './read-cache'

const BASE = (process.env.STUDIO_PLATFORM_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.STUDIO_APP_TOKEN || ''
const PROJECTION_FIELD_LIMIT = 21

export interface TeableField { id: string; name: string; type: string }
export interface TeableRecord { id: string; fields: Record<string, any>; createdTime?: string }
export interface TeableRecordPage { records: TeableRecord[]; total?: number; totalIsExact?: boolean }
export interface TeableReadOptions { take?: number; skip?: number; filterByTql?: string; orderBy?: any[]; fields?: string[] }

const localExportDir = join(process.cwd(), '..', 'database')
const localExportEnabled = () => process.env.LOCAL_EXPORT_DB === 'true' && process.env.NODE_ENV !== 'production'
const localTables = new Map<string, TeableRecord[]>()
let localTablesLoaded = false

function loadLocalTables() {
  if (localTablesLoaded) return
  localTablesLoaded = true
  if (!existsSync(localExportDir)) return
  for (const fileName of readdirSync(localExportDir)) {
    const matched = /^(\d+)_(.+)\.json$/.exec(fileName)
    if (!matched) continue
    const parsed = JSON.parse(readFileSync(join(localExportDir, fileName), 'utf8'))
    if (!Array.isArray(parsed)) continue
    localTables.set(`local:${matched[2]}`, parsed.filter((row) => row && typeof row === 'object' && row.fields && typeof row.fields === 'object'))
  }
}

function localTableId(path: string) {
  return /^\/tables\/(local:[^/?]+)/.exec(path)?.[1] || ''
}

function localTableName(tableId: string) {
  return tableId.startsWith('local:') ? tableId.slice('local:'.length) : ''
}

function filterLocalRecords(records: TeableRecord[], filterByTql?: string) {
  if (!filterByTql) return records
  const comparisons = [...filterByTql.matchAll(/\{([^{}]+)\}\s*(=|!=|>=|<=|>|<)\s*"((?:\\.|[^"])*)"/g)].map((match) => ({
    field: match[1],
    operator: match[2],
    value: match[3].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
  }))
  const prefixes = [...filterByTql.matchAll(/\{([^{}]+)\}\s*(?:=|LIKE)\s*"((?:\\.|[^"])*)%?"/g)].map((match) => ({
    field: match[1],
    value: match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
  }))
  if (!comparisons.length && !prefixes.length) return records
  const orGroups = filterByTql.split(/\s+OR\s+/i)
  return records.filter((record) => orGroups.some((group) => {
    const groupComparisons = comparisons.filter((item) => group.includes(`{${item.field}}`) && group.includes(`"${item.value}"`))
    const groupPrefixes = prefixes.filter((item) => group.includes(`{${item.field}}`) && group.includes(`"${item.value}`))
    return [...groupComparisons, ...groupPrefixes].every((item) => {
      const actual = String(record.fields[item.field] ?? '')
      if ('operator' in item) {
        if (item.operator === '!=') return actual !== item.value
        if (item.operator === '>') return actual > item.value
        if (item.operator === '>=') return actual >= item.value
        if (item.operator === '<') return actual < item.value
        if (item.operator === '<=') return actual <= item.value
        return actual === item.value
      }
      return actual.startsWith(item.value)
    })
  }))
}

function localRead(path: string, options: TeableReadOptions = {}): TeableRecordPage | TeableField[] | TeableRecord | undefined {
  loadLocalTables()
  if (path.endsWith('/fields')) {
    const tableId = localTableId(path)
    const sample = localTables.get(tableId)?.[0]
    return Object.keys(sample?.fields || {}).map((name) => ({ id: `${tableId}:${name}`, name, type: 'singleLineText' }))
  }
  const recordMatch = /^\/tables\/(local:[^/]+)\/records\/([^/?]+)$/.exec(path)
  if (recordMatch) return localTables.get(recordMatch[1])?.find((row) => row.id === decodeURIComponent(recordMatch[2]))
  const tableId = localTableId(path)
  let records = filterLocalRecords([...(localTables.get(tableId) || [])], options.filterByTql)
  if (options.fields?.length) records = records.map((row) => ({ ...row, fields: Object.fromEntries(options.fields!.filter((field) => field in row.fields).map((field) => [field, row.fields[field]])) }))
  const skip = options.skip || 0
  const take = options.take ?? records.length
  return { records: records.slice(skip, skip + take), total: records.length, totalIsExact: true }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const tableId = method !== 'GET' ? /^\/tables\/([^/?]+)/.exec(path)?.[1] : undefined
  if (tableId) invalidateReadTables(decodeURIComponent(tableId))
  try {
    return await sendRequest<T>(method, path, body)
  } finally {
    if (tableId) invalidateReadTables(decodeURIComponent(tableId))
  }
}

async function sendRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const decodedPath = decodeURIComponent(path)
  if (localExportEnabled() && decodedPath.startsWith('/tables/local:')) {
    if (method !== 'GET') throw new Error('本地导出数据库是只读快照，不能写入')
    const query = new URLSearchParams(decodedPath.split('?')[1] || '')
    const options: TeableReadOptions = {
      take: query.has('take') ? Number(query.get('take')) : undefined,
      skip: query.has('skip') ? Number(query.get('skip')) : undefined,
      filterByTql: query.get('filterByTql') || undefined,
      fields: query.has('fields') ? String(query.get('fields')).split(',') : undefined,
    }
    return localRead(decodedPath.split('?')[0], options) as T
  }
  if (!BASE) throw new Error(`缺少 STUDIO_PLATFORM_URL，无法访问平台数据服务：${method} ${path}`)
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
  const response = await fetch(`${BASE}/teable${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Teable 请求失败 (${response.status}): ${text.slice(0, 300) || 'none'}`)
  if (!text) return undefined as T
  const parsed = JSON.parse(text)
  return (parsed?.data ?? parsed) as T
}

async function listRecordPage(tableId: string, options: number | TeableReadOptions = 1000): Promise<TeableRecordPage> {
  const opts = typeof options === 'number' ? { take: options } : options
  if (localExportEnabled() && tableId.startsWith('local:')) {
    const query = new URLSearchParams()
    query.set('take', String(opts.take ?? 1000))
    if (opts.skip != null) query.set('skip', String(opts.skip))
    if (opts.filterByTql) query.set('filterByTql', opts.filterByTql)
    if (opts.fields?.length) query.set('fields', opts.fields.map((field) => encodeURIComponent(field)).join(','))
    const result: any = await request('GET', `/tables/${encodeURIComponent(tableId)}/records?${query}`)
    const records = result?.records || []
    return { records, total: result?.total, totalIsExact: Boolean(result?.totalIsExact) }
  }
  if (opts.fields?.length) {
    const fieldBatches: string[][] = []
    for (let index = 0; index < opts.fields.length; index += PROJECTION_FIELD_LIMIT) {
      fieldBatches.push(opts.fields.slice(index, index + PROJECTION_FIELD_LIMIT))
    }
    const pages = await Promise.all(fieldBatches.map(async fields => {
      let result: any = await callMcp('teable_list_records', {
        table_id: tableId, take: opts.take ?? 1000, skip: opts.skip ?? 0, fields,
        ...(opts.filterByTql ? { filter: opts.filterByTql } : {}),
        ...(opts.orderBy ? { sort: JSON.stringify(opts.orderBy) } : {}),
      })
      if (result?.isError || result?.error) throw new Error('Teable 摘要查询失败')
      if (Array.isArray(result?.content)) result = JSON.parse(result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n'))
      else if (typeof result?.text === 'string') result = JSON.parse(result.text)
      result = result?.data ?? result
      if (!Array.isArray(result?.records)) throw new Error('Teable 摘要查询未返回记录列表')
      return { records: result.records, total: result.total, totalIsExact: result.totalIsExact }
    }))
    const records = pages[0].records.map((record: TeableRecord) => ({ ...record, fields: { ...record.fields } }))
    for (let pageIndex = 1; pageIndex < pages.length; pageIndex += 1) {
      const pageRecords = pages[pageIndex].records
      if (pageRecords.length !== records.length) throw new Error('Teable 分批字段查询返回的记录数不一致')
      for (let recordIndex = 0; recordIndex < pageRecords.length; recordIndex += 1) {
        if (pageRecords[recordIndex].id !== records[recordIndex].id) throw new Error('Teable 分批字段查询返回的记录顺序不一致')
        Object.assign(records[recordIndex].fields, pageRecords[recordIndex].fields)
      }
    }
    return { records, total: pages[0].total, totalIsExact: Boolean(pages[0].totalIsExact) }
  }
  const query = new URLSearchParams()
  query.set('take', String(opts.take ?? 1000))
  if (opts.skip != null) query.set('skip', String(opts.skip))
  if (opts.filterByTql) query.set('filterByTql', opts.filterByTql)
  if (opts.orderBy) query.set('orderBy', JSON.stringify(opts.orderBy))
  const result: any = await request('GET', `/tables/${encodeURIComponent(tableId)}/records?${query}`)
  const records = result?.records || result?.items || (Array.isArray(result) ? result : [])
  // 平台网关目前会把 total 返回为“本页条数”，不能把 100 当成人才总数。
  // 只有当总数确实大于本页条数时，才认为这是可用于分页的精确总数。
  const reportedTotal = Number(result?.total ?? result?.totalCount ?? result?.count) || undefined
  const totalIsExact = Boolean(reportedTotal && reportedTotal > records.length)
  return { records, total: totalIsExact ? reportedTotal : undefined, totalIsExact }
}

export const teable = {
  async countRecords(tableId: string): Promise<number> {
    if (localExportEnabled() && tableId.startsWith('local:')) {
      loadLocalTables()
      return localTables.get(tableId)?.length || 0
    }
    let result: any = await callMcp('teable_get_table_row_count', { table_id: tableId })
    if (result?.isError || result?.error) throw new Error('Teable 记录计数失败')
    if (Array.isArray(result?.content)) result = JSON.parse(result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n'))
    else if (typeof result?.text === 'string') result = JSON.parse(result.text)
    result = result?.data ?? result
    if (result?.isError || result?.error || !Number.isSafeInteger(result?.row_count) || result.row_count < 0) throw new Error('Teable 未返回有效记录总数')
    return result.row_count
  },
  async ensureTable(name: string) {
    if (localExportEnabled()) {
      loadLocalTables()
      const tableId = `local:${name}`
      if (!localTables.has(tableId)) throw new Error(`本地导出数据库缺少表：${name}`)
      return { id: tableId, name, created: false }
    }
    const result: any = await request('POST', '/tables', { name, base_id: process.env.STUDIO_TEABLE_BASE_ID || '' })
    return { id: result.id, name: result.name, created: !result.reused }
  },
  async listFields(tableId: string): Promise<TeableField[]> {
    const result: any = await request('GET', `/tables/${encodeURIComponent(tableId)}/fields`)
    return result?.fields || result?.items || result || []
  },
  async createField(tableId: string, field: { name: string; type: string; options?: Record<string, any> }) {
    return request('POST', `/tables/${encodeURIComponent(tableId)}/fields`, field)
  },
  async updateField(tableId: string, fieldId: string, patch: { name?: string }) {
    return request('PATCH', `/tables/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(fieldId)}`, patch)
  },
  async listRecords(tableId: string, options: number | TeableReadOptions = 1000): Promise<TeableRecord[]> {
    return (await listRecordPage(tableId, options)).records
  },
  async listRecordsPage(tableId: string, options: TeableReadOptions = {}): Promise<TeableRecordPage> {
    return listRecordPage(tableId, options)
  },
  /**
   * 循环分页拉取全部记录，不受 1000 条上限影响。
   * 用于查重、统计等需要全量数据的场景。
   * 注意：大表慎用，优先考虑 filterByTql + take/skip 做服务端分页。
   */
  async listAllRecords(tableId: string, options: { filterByTql?: string; orderBy?: any[]; pageSize?: number; fields?: string[] } = {}): Promise<TeableRecord[]> {
    const maximumPageSize = options.fields?.length ? 1000 : 500
    let pageSize = Math.min(maximumPageSize, Math.max(50, options.pageSize ?? maximumPageSize))
    const all: TeableRecord[] = []
    let skip = 0
    // Teable 最多返回 pageSize 条；不足说明已到末尾。
    // 为防止无限循环，设置 100 页硬上限 (500*100 = 50000 条)。
    for (let page = 0; page < 100; page++) {
      const batch = await this.listRecords(tableId, { take: pageSize, skip, filterByTql: options.filterByTql, orderBy: options.orderBy, fields: options.fields })
      if (!batch.length) break
      all.push(...batch)
      if (batch.length < pageSize) {
        // 部分代理会把 take 压到 100。返回不足时再探测一次下一页，确认是否真的到底。
        const next = await this.listRecords(tableId, { take: 1, skip: skip + batch.length, filterByTql: options.filterByTql, orderBy: options.orderBy, fields: options.fields })
        if (!next.length) break
        pageSize = batch.length
      }
      skip += batch.length
    }
    return all
  },

  async createRecord(tableId: string, fields: Record<string, any>): Promise<TeableRecord> {
    const result: any = await request('POST', `/tables/${encodeURIComponent(tableId)}/records`, { records: [{ fields }], typecast: true })
    return (result?.records || result?.items || result)[0]
  },
  async createRecords(tableId: string, fieldsList: Record<string, any>[]): Promise<TeableRecord[]> {
    if (!fieldsList.length) return []
    const result: any = await request('POST', `/tables/${encodeURIComponent(tableId)}/records`, { records: fieldsList.map((fields) => ({ fields })), typecast: true })
    return result?.records || result?.items || (Array.isArray(result) ? result : [])
  },
  async updateRecord(tableId: string, recordId: string, fields: Record<string, any>): Promise<TeableRecord> {
    return request('PATCH', `/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`, { fields, typecast: true })
  },
  async deleteRecord(tableId: string, recordId: string) {
    return request('DELETE', `/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`)
  },
  async getRecord(tableId: string, recordId: string): Promise<TeableRecord> {
    const result: any = await request('GET', `/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`)
    return result?.record || result?.data || result
  },
  /**
   * 按业务字段查询一条记录。调用方传入字段名和值，过滤在 Teable 服务端完成。
   */
  async findOneByField(tableId: string, fieldName: string, value: unknown): Promise<TeableRecord | undefined> {
    const escapedField = String(fieldName).replace(/[{}]/g, '')
    const escapedValue = String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const rows = await this.listRecords(tableId, {
      take: 1,
      filterByTql: `{${escapedField}} = "${escapedValue}"`,
    })
    return rows[0]
  },
  /**
   * 按业务字段查询关联记录。默认只取一页，调用方可按业务场景设置上限。
   */
  async listByField(tableId: string, fieldName: string, value: unknown, take = 200): Promise<TeableRecord[]> {
    const escapedField = String(fieldName).replace(/[{}]/g, '')
    const escapedValue = String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return this.listRecords(tableId, {
      take: Math.max(1, Math.min(1000, take)),
      filterByTql: `{${escapedField}} = "${escapedValue}"`,
    })
  },
  async listByAnyField(tableId: string, fieldName: string, values: unknown[], take = 1000, fields?: string[]): Promise<TeableRecord[]> {
    const clean = values.map((value) => String(value ?? '').trim()).filter(Boolean)
    if (!clean.length) return []
    const clauses = clean.map((value) => {
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return `{${String(fieldName).replace(/[{}]/g, '')}} = "${escaped}"`
    })
    // 平台网关的 TQL 版本不支持函数式 OR(...)，这里改用链式比较的兼容写法。
    const expression = clauses.length === 1 ? clauses[0] : clauses.join(' OR ')
    return this.listRecords(tableId, { take: Math.min(1000, Math.max(1, take)), filterByTql: expression, fields })
  },
  async listAllByAnyField(tableId: string, fieldName: string, values: unknown[], fields?: string[]): Promise<TeableRecord[]> {
    const clean = [...new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))]
    const batches: string[][] = []
    for (let index = 0; index < clean.length; index += 50) batches.push(clean.slice(index, index + 50))
    const records: TeableRecord[] = []
    for (let index = 0; index < batches.length; index += 4) {
      const results = await Promise.all(batches.slice(index, index + 4).map(batch => {
        const filterByTql = batch.map(value => `{${String(fieldName).replace(/[{}]/g, '')}} = "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' OR ')
        return this.listAllRecords(tableId, { filterByTql, fields })
      }))
      records.push(...results.flat())
    }
    return [...new Map(records.map(record => [record.id, record])).values()]
  },
}
