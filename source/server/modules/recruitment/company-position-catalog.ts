import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import path from 'node:path'

export interface CompanyPositionCatalogItem {
  sourceId: string
  sourceSheet: string
  sourceRow: number
  businessUnit: string
  department: string
  name: string
  responsibilities: string
  requirements: string
  salaryText: string
  minSalary: number | null
  maxSalary: number | null
}

const CATALOG_FILENAME = '岗位大全-2026.10.xlsx'
const CATALOG_RELATIVE_PATH = path.join('dist', 'client', 'uploads', CATALOG_FILENAME)

const clean = (value: unknown) => String(value ?? '').replace(/\u200b/g, '').trim()
const decodeXml = (value: string) => value
  .replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function zipEntries(buffer: Buffer) {
  let end = -1
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 0xffff - 22); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break }
  }
  if (end < 0) throw new Error('岗位大全文件格式不正确：未找到 ZIP 目录')
  const count = buffer.readUInt16LE(end + 10)
  let cursor = buffer.readUInt32LE(end + 16)
  const entries = new Map<string, Buffer>()
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('岗位大全文件格式不正确：ZIP 目录损坏')
    const compression = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`岗位大全文件格式不正确：无法读取 ${name}`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const content = buffer.subarray(dataStart, dataStart + compressedSize)
    entries.set(name, compression === 0 ? content : compression === 8 ? inflateRawSync(content) : (() => { throw new Error(`岗位大全文件使用了不支持的压缩方式：${compression}`) })())
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function sharedStrings(xml: string) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => decodeXml(match[1]))
}

function worksheetRows(xml: string, shared: string[]) {
  const rows = new Map<number, Map<string, string>>()
  for (const rowMatch of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<string, string>()
    // 工作表中存在空白的自闭合单元格（例如 <c r="A26" .../>）；
    // 必须把它们单独识别，不能让其吞掉同一行后面的真实单元格。
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cellMatch[1])?.[1]
      if (!ref) continue
      const type = /\bt="([^"]+)"/.exec(cellMatch[1])?.[1]
      const content = cellMatch[2] || ''
      const raw = /<v>([\s\S]*?)<\/v>/.exec(content)?.[1] || ''
      const inline = /<is>([\s\S]*?)<\/is>/.exec(content)?.[1]
      cells.set(ref, type === 's' ? clean(shared[Number(raw)]) : clean(inline ? decodeXml(inline) : decodeXml(raw)))
    }
    rows.set(Number(rowMatch[1]), cells)
  }
  return rows
}

function parseSalary(value: string) {
  const matched = /(\d+(?:\.\d+)?)\s*[-~～至到—–]\s*(\d+(?:\.\d+)?)\s*[kK]/.exec(value)
  if (!matched) return { minSalary: null, maxSalary: null }
  return { minSalary: Math.round(Number(matched[1]) * 1000), maxSalary: Math.round(Number(matched[2]) * 1000) }
}

export async function loadCompanyPositionCatalog(): Promise<CompanyPositionCatalogItem[]> {
  const filePath = path.resolve(process.cwd(), CATALOG_RELATIVE_PATH)
  let workbook: Buffer
  try { workbook = await readFile(filePath) } catch { throw new Error(`未找到岗位大全源文件：${CATALOG_RELATIVE_PATH}`) }
  const entries = zipEntries(workbook)
  const shared = sharedStrings(clean(entries.get('xl/sharedStrings.xml')?.toString('utf8')))
  const executive = worksheetRows(clean(entries.get('xl/worksheets/sheet1.xml')?.toString('utf8')), shared)
  const historical = worksheetRows(clean(entries.get('xl/worksheets/sheet2.xml')?.toString('utf8')), shared)
  const output: CompanyPositionCatalogItem[] = []
  for (const [row, cells] of executive) {
    if (row < 2 || !cells.get('B') || !cells.get('C')) continue
    const salaryText = clean(cells.get('E'))
    output.push({ sourceId: `company-position-catalog:中高层岗位:${row}`, sourceSheet: '中高层岗位', sourceRow: row, businessUnit: '中高层', department: '中高层', name: clean(cells.get('B')), responsibilities: clean(cells.get('C')), requirements: clean(cells.get('D')), salaryText, ...parseSalary(salaryText) })
  }
  let businessUnit = '', department = ''
  for (const [row, cells] of historical) {
    if (row < 2) continue
    businessUnit = clean(cells.get('A')) || businessUnit
    department = clean(cells.get('B')) || department
    if (!cells.get('D') || !cells.get('E')) continue
    const salaryText = clean(cells.get('G'))
    output.push({ sourceId: `company-position-catalog:历史岗位大全:${row}`, sourceSheet: '历史岗位大全', sourceRow: row, businessUnit, department, name: clean(cells.get('D')), responsibilities: clean(cells.get('E')), requirements: clean(cells.get('F')), salaryText, ...parseSalary(salaryText) })
  }
  if (output.length !== 77) throw new Error(`岗位大全数据校验失败：应为77个有效岗位，实际读取到${output.length}个`)
  return output
}
