import { createHash, randomUUID } from 'node:crypto'
import gdbfDes from './gdbf-des.cjs'

const BASE = (process.env.GDBF_API_BASE || 'https://beta.gdbf.com').replace(/\/+$/, '')
const ORGAN_ID = process.env.GDBF_ORGAN_ID || ''
const SIGN_KEY = (process.env.GDBF_PRIVATE_KEY || process.env.GDBF_PUBLIC_KEY || '').trim()
const SIGN_SCHEME = (process.env.GDBF_SIGN_SCHEME || 'md5').trim()
const GDBF_USER_NAME = (process.env.GDBF_ADMIN_USER_NAME || '').trim()
const GDBF_PASSWORD = (process.env.GDBF_ADMIN_PASSWORD || '').trim()

// 八方锦程前端使用自实现的单字节 CBC-DES，key 由前端 secretMask 解出，输出 hex。
const DES_KEY_TEXT = 'com.cheetah.gdbf'
const ORDER_STATUS: Record<string, string> = { '1': '完成', '2': '阶段性', '3': '待受理', '4': '待授权', '5': '进行中', '6': '已撤单' }
const REPORT_RESULT: Record<string, string> = { '1': '绿灯', '2': '红灯', '3': '黄灯', '4': '蓝灯' }
const REPORT_TYPE: Record<string, string> = { '1': '阶段性报告', '2': '完整报告' }

export interface GdbfOrderInput {
  orderId?: string
  userName?: string
  userEmail?: string
  employeeName: string
  employeeSex: '1' | '2'
  employeePhone: string
  employeeEmail?: string
  employeeIdCard?: string
  employeeNationality?: string
  employeeDept?: string
  employeePost?: string
  employeeEntryDate?: string
  packageId: string
  itemIds?: string
  isUrgent?: '0' | '1'
  isEnReport?: '0' | '1'
  isOverseas?: '0' | '1'
  reportEmail?: string
  ext?: string
  remarks?: string
  fileList?: Array<{ fileName: string; fileType: 'base64' | 'URL'; fileData: string }>
}

export interface GdbfOrderDetail {
  orderId: string
  orderNo?: string
  officeName?: string
  employeeName?: string
  employeeIdCard?: string
  employeeSex?: string
  employeePhone?: string
  employeeEmail?: string
  employeeDept?: string
  employeePost?: string
  employeeNationality?: string
  employeeEntryDate?: string
  status: string
  statusLabel?: string
}

export interface GdbfReport {
  reportResult: string
  reportResultLabel?: string
  reportDesc?: string
  reportUrl?: string
  enReportUrl?: string
  reportType?: string
  reportTypeLabel?: string
  packageId?: string
  orderPrice?: number
}

export interface GdbfAdminSession {
  sessionId: string
  user: { id: string; name: string; email: string; officeId: string; officeName: string }
}

export interface GdbfAdminPackage {
  packageId: string
  packageName: string
  packagePrice: number
  packageItems: string
  contractId: string
}

export interface GdbfAdminReportRow {
  id: string
  createDate?: string
  type?: string
  typeText?: string
  result?: string
  resultText?: string
  fileId?: string
  fileName?: string
  fileUrl?: string
}

function md5(value: string) { return createHash('md5').update(value, 'utf8').digest('hex') }
function sha256(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex') }

type Bits = number[]

function strToBt(str: string): Bits {
  const bits = new Array<number>(64).fill(0)
  for (let i = 0; i < 4; i += 1) {
    const code = str.charCodeAt(i) || 0
    for (let j = 0; j < 16; j += 1) bits[i * 16 + j] = Math.floor(code / (2 ** (15 - j))) % 2
  }
  return bits
}

function getKeyBytes(key: string): Bits[] {
  const bytes: Bits[] = []
  const chunks = Math.floor(key.length / 4)
  for (let i = 0; i < chunks; i += 1) bytes[i] = strToBt(key.slice(i * 4, i * 4 + 4))
  if (key.length % 4) bytes[chunks] = strToBt(key.slice(chunks * 4))
  return bytes
}

function bt4ToHex(binary: string) {
  return '0123456789ABCDEF'[Number.parseInt(binary, 2)]
}

function hexToBt64(hex: string): Bits {
  const bits: Bits = []
  for (const char of hex) {
    const value = Number.parseInt(char, 16)
    for (let shift = 3; shift >= 0; shift -= 1) bits.push((value >> shift) & 1)
  }
  return bits
}

function byteToString(byteData: Bits) {
  let str = ''
  for (let i = 0; i < 4; i += 1) {
    let count = 0
    for (let j = 0; j < 16; j += 1) count += byteData[i * 16 + j] * (1 << (15 - j))
    if (count) str += String.fromCharCode(count)
  }
  return str
}

function bt64ToHex(byteData: Bits) {
  let hex = ''
  for (let i = 0; i < 16; i += 1) hex += bt4ToHex(byteData.slice(i * 4, i * 4 + 4).join(''))
  return hex
}

const EXPANSION = [31, 0, 1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 7, 8, 9, 10, 11, 12, 11, 12, 13, 14, 15, 16, 15, 16, 17, 18, 19, 20, 19, 20, 21, 22, 23, 24, 23, 24, 25, 26, 27, 28, 27, 28, 29, 30, 31, 0]
const IP = [57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7, 56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6]
const FP = [39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24]
const P = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24] as Bits
const SBOXES = [
  [[14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7], [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8], [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0], [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13]],
  [[15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10], [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5], [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15], [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9]],
  [[10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8], [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1], [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 6, 10, 14, 7], [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12]],
  [[7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15], [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9], [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4], [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14]],
  [[2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9], [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6], [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14], [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3]],
  [[12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11], [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8], [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6], [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13]],
  [[4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1], [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6], [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2], [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12]],
  [[13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7], [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2], [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8], [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]],
]

function xorBits(left: Bits, right: Bits): Bits {
  return left.map((bit, index) => bit ^ right[index])
}

function initPermute(data: Bits): Bits {
  const result = new Array<number>(64)
  for (let i = 0, m = 1, n = 0; i < 4; i += 1, m += 2, n += 2) {
    for (let j = 7, k = 0; j >= 0; j -= 1, k += 1) {
      result[i * 8 + k] = data[j * 8 + m]
      result[i * 8 + k + 32] = data[j * 8 + n]
    }
  }
  return result
}

function expandPermute(right: Bits): Bits {
  return EXPANSION.map((index) => right[index])
}

function sBoxPermute(expanded: Bits): Bits {
  const result = new Array<number>(32)
  for (let box = 0; box < 8; box += 1) {
    const row = expanded[box * 6] * 2 + expanded[box * 6 + 5]
    const column = expanded[box * 6 + 1] * 8 + expanded[box * 6 + 2] * 4 + expanded[box * 6 + 3] * 2 + expanded[box * 6 + 4]
    const value = SBOXES[box][row][column]
    for (let bit = 0; bit < 4; bit += 1) result[box * 4 + bit] = (value >> (3 - bit)) & 1
  }
  return result
}

function pPermute(bits: Bits): Bits {
  return P.map((index) => bits[index])
}

function finallyPermute(bits: Bits): Bits {
  return FP.map((index) => bits[index])
}

function generateKeys(keyByte: Bits): Bits[] {
  const key = new Array<number>(56)
  const keys: Bits[] = []
  const loop = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
  for (let i = 0; i < 7; i += 1) {
    for (let j = 0, k = 7; j < 8; j += 1, k -= 1) key[i * 8 + j] = keyByte[8 * k + i]
  }
  for (let round = 0; round < 16; round += 1) {
    for (let shift = 0; shift < loop[round]; shift += 1) {
      const left = key[0]
      const right = key[28]
      for (let i = 0; i < 27; i += 1) {
        key[i] = key[i + 1]
        key[28 + i] = key[29 + i]
      }
      key[27] = left
      key[55] = right
    }
    keys[round] = [
      key[13], key[16], key[10], key[23], key[0], key[4], key[2], key[27], key[14], key[5], key[20], key[9], key[22], key[18], key[11], key[3],
      key[25], key[7], key[15], key[6], key[26], key[19], key[12], key[1], key[40], key[51], key[30], key[36], key[46], key[54], key[29], key[39],
      key[50], key[44], key[32], key[47], key[43], key[48], key[38], key[55], key[33], key[52], key[45], key[41], key[49], key[35], key[28], key[31],
    ]
  }
  return keys
}

function desBlock(data: Bits, key: Bits, decrypt: boolean): Bits {
  const roundKeys = generateKeys(key)
  const ip = initPermute(data)
  let left = ip.slice(0, 32)
  let right = ip.slice(32)
  const rounds = decrypt ? [...Array(16).keys()].reverse() : [...Array(16).keys()]
  for (const round of rounds) {
    const previousLeft = left
    left = right
    right = xorBits(pPermute(sBoxPermute(xorBits(expandPermute(right), roundKeys[round]))), previousLeft)
  }
  return finallyPermute([...right, ...left])
}

function encodeData(data: string) {
  return gdbfDes.encode(data, DES_KEY_TEXT)
}

function decodeData(value: string) {
  const ciphertext = value.trim()
  if (!/^[0-9A-Fa-f]+$/.test(ciphertext) || ciphertext.length % 16 !== 0) {
    throw new Error('八方接口返回数据不是有效的 DES hex')
  }
  return gdbfDes.decode(ciphertext, DES_KEY_TEXT)
}

function decryptData(value: unknown) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(decodeData(value))
  } catch (error) {
    throw new Error(`八方接口返回数据解密失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function encryptParam(data: unknown) {
  return encodeData(JSON.stringify(data || {}))
}

function validateSign(sign: string) { return /^[0-9A-Fa-f]{32}$/.test(sign) }

function signPayload(param: string) {
  const normalized = SIGN_SCHEME.toLowerCase()
  const materials: Array<[string, string]> = [
    [`${ORGAN_ID}${param}`, 'md5(organId + param)'],
    [param, 'md5(param)'],
    [`${SIGN_KEY}${param}`, 'md5(key + param)'],
    [`${param}${SIGN_KEY}`, 'md5(param + key)'],
    [`${ORGAN_ID}${param}${SIGN_KEY}`, 'md5(organId + param + key)'],
  ]
  if (normalized.startsWith('sha256')) {
    materials.unshift([`${ORGAN_ID}${param}`, 'sha256(organId + param)'])
  }
  const selected = materials.find(([material, scheme]) => {
    const sign = normalized.startsWith('sha256') && scheme.startsWith('sha256') ? sha256(material) : md5(material)
    return validateSign(sign)
  })
  const [material, scheme] = selected || materials[0]
  return normalized.startsWith('sha256') && scheme.startsWith('sha256') ? sha256(material) : md5(material)
}

async function post<T>(path: string, param: unknown): Promise<T> {
  if (!ORGAN_ID) throw new Error('缺少 GDBF_ORGAN_ID，无法调用八方接口')
  const encrypted = encryptParam(param)
  const sign = signPayload(encrypted)
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ organId: ORGAN_ID, param: encrypted, sign }),
  })
  const raw = await response.text()
  let parsed: any = null
  try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
  if (!response.ok) throw new Error(`八方接口请求失败 (${response.status}): ${raw.slice(0, 300) || '无返回内容'}`)
  if (!parsed) throw new Error('八方接口返回了无效响应')
  if (String(parsed.code || '') !== '100' || parsed.flag === false) {
    throw new Error(`八方接口业务失败：${parsed.msg || parsed.message || '未知错误'}（code=${parsed.code || 'unknown'}）`)
  }
  const data = decryptData(parsed.data)
  return (data ?? parsed.data) as T
}

export const gdbfClient = {
  enabled() { return Boolean(BASE && ORGAN_ID) },
  async getPackages() {
    const rows = await post<any[]>('/api/order/v4/getPackageInfo', {})
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      packageId: String(row.packageId || row.id || ''),
      packageName: String(row.packageName || row.name || ''),
      packagePrice: Number(row.packagePrice || row.price || 0),
      packageItems: String(row.packageItems || row.items || ''),
      packageDesc: String(row.packageDesc || row.description || ''),
    })).filter((row) => row.packageId && row.packageName)
  },
  async getItems() {
    const rows = await post<any[]>('/api/order/v4/getItemInfo', {})
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      itemId: String(row.itemId || row.id || ''),
      itemName: String(row.itemName || row.name || ''),
      itemPrice: Number(row.itemPrice || row.price || 0),
    }))
  },
  async createOrder(input: GdbfOrderInput) {
    const orderId = input.orderId || `FPRF${Date.now().toString(36).toUpperCase()}${createHash('md5').update(JSON.stringify(input)).digest('hex').slice(0, 12).toUpperCase()}`
    const result = await post<{ orderId?: string } | any>('/api/order/v4/createOrder', { ...input, orderId })
    return { orderId: String(result?.orderId || result?.id || orderId) }
  },
  async getOrder(orderId: string): Promise<GdbfOrderDetail> {
    const row = await post<GdbfOrderDetail>('/api/order/v4/getOrderById', { orderId })
    return { ...row, orderId: String(row?.orderId || orderId), status: String(row?.status || ''), statusLabel: ORDER_STATUS[String(row?.status || '')] || '未知状态' }
  },
  async getReport(orderId: string): Promise<GdbfReport | null> {
    const row = await post<GdbfReport | null>('/api/order/v4/getOrderResult', { orderId })
    if (!row || (!row.reportUrl && !row.reportResult)) return null
    return { ...row, reportResultLabel: REPORT_RESULT[String(row.reportResult)] || '未知结果', reportTypeLabel: REPORT_TYPE[String(row.reportType)] || '未知报告' }
  },
  async getReports(startDate: string, endDate: string): Promise<any[]> {
    const rows = await post<any[]>('/api/order/v4/getUpdateReportList', { startDate, endDate })
    return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, reportResultLabel: REPORT_RESULT[String(row.reportResult)] || '未知结果', reportTypeLabel: REPORT_TYPE[String(row.reportType)] || '未知报告' }))
  },
  async diagnose() {
    try {
      const packages = await this.getPackages()
      return { connected: true, packageCount: packages.length, packages }
    } catch (error) {
      return { connected: false, message: error instanceof Error ? error.message : String(error) }
    }
  },
}

const ADMIN_LOGIN_URL = new URL('/system/login', BASE)
const adminCache: { session?: GdbfAdminSession; expiresAt?: number } = {}

function adminNameEncode(value: string) {
  return encodeData(value)
}

async function adminLogin(): Promise<GdbfAdminSession> {
  const now = Date.now()
  if (adminCache.session && adminCache.expiresAt && now < adminCache.expiresAt) return adminCache.session
  if (!GDBF_USER_NAME || !GDBF_PASSWORD) throw new Error('缺少 GDBF_ADMIN_USER_NAME 或 GDBF_ADMIN_PASSWORD，无法登录八方后台')
  const body = new URLSearchParams()
  body.set('userName', adminNameEncode(GDBF_USER_NAME))
  body.set('password', adminNameEncode(GDBF_PASSWORD))
  body.set('source', '1')
  const response = await fetch(ADMIN_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`八方后台登录失败 (${response.status}): ${raw.slice(0, 300) || '无返回内容'}`)
  let parsed: any
  try { parsed = JSON.parse(raw) } catch { parsed = null }
  const sessionId = String(parsed?.data?.sessionId || '')
  if (!parsed?.flag || !sessionId) throw new Error(`八方后台登录失败：${parsed?.msg || raw.slice(0, 300) || '未返回会话'}`)
  const profile = await adminFetch<any>(sessionId, '/admin/getLoginUser', { method: 'GET' })
  const session: GdbfAdminSession = {
    sessionId,
    user: {
      id: String(profile?.user?.id || ''),
      name: String(profile?.user?.name || ''),
      email: String(profile?.user?.email || ''),
      officeId: String(profile?.user?.officeRootId || profile?.user?.officeId || ''),
      officeName: String(profile?.user?.officeName || ''),
    },
  }
  adminCache.session = session
  adminCache.expiresAt = now + 30 * 60_000
  return session
}

async function adminFetch<T>(sessionId: string, path: string, init: RequestInit = {}, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path, BASE)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', Cookie: `cheetah.session.id=${sessionId}`, 'CHEETAH-TOKEN': sessionId, 'cheetah-lang': 'zh', ...(init.headers || {}) },
  })
  const raw = await response.text()
  if (response.status === 401) {
    adminCache.session = undefined
    adminCache.expiresAt = undefined
    throw new Error('八方后台会话已失效，请重试')
  }
  if (!response.ok) throw new Error(`八方后台请求失败 (${response.status}): ${raw.slice(0, 300) || '无返回内容'}`)
  let parsed: any
  try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
  if (parsed && typeof parsed === 'object' && 'flag' in parsed) {
    if (parsed.flag === false) throw new Error(`八方后台业务失败：${parsed.msg || parsed.message || '未知错误'}`)
    return (parsed.data ?? parsed) as T
  }
  return parsed as T
}

async function adminPostForm<T>(path: string, fields: Record<string, string | number | undefined>) {
  const session = await adminLogin()
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) body.set(key, String(value))
  }
  return adminFetch<T>(session.sessionId, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

export const gdbfAdminClient = {
  async session() {
    return adminLogin()
  },
  async contract() {
    const session = await adminLogin()
    const officeId = session.user.officeId
    if (!officeId) throw new Error('八方后台缺少委托机构信息')
    const [contractInfo, users] = await Promise.all([
      adminFetch<any>(session.sessionId, '/admin/public/getContractInfo', {}, { officeId }),
      adminFetch<any[]>(session.sessionId, '/admin/public/getClientUserList', {}, { officeId, group: 'true' }),
    ])
    const contract = contractInfo?.contract || {}
    const customer = Array.isArray(users) ? users[0] : null
    return {
      officeId,
      officeName: session.user.officeName,
      contractId: String(contract.id || ''),
      contractName: String(contract.name || ''),
      customerId: String(customer?.id || session.user.id || ''),
      customerName: String(customer?.name || session.user.name || ''),
      customerEmail: String(customer?.email || session.user.email || ''),
      packages: (Array.isArray(contractInfo?.packageList) ? contractInfo.packageList : []).map((item: any) => ({
        packageId: String(item.id || ''),
        packageName: String(item.name || ''),
        packagePrice: Number(item.price || 0),
        packageItems: String(item.itemsText || (item.itemList || []).map((row: any) => row.name).join(',') || ''),
        contractId: String(contract.id || ''),
      })).filter((item: GdbfAdminPackage) => item.packageId && item.packageName),
      items: (Array.isArray(contractInfo?.itemList) ? contractInfo.itemList : []).map((item: any) => ({
        itemId: String(item.id || ''),
        itemName: String(item.name || ''),
        itemPrice: Number(item.price || 0),
        contractId: String(contract.id || ''),
      })).filter((item: any) => item.itemId && item.itemName),
    }
  },
  async createOrder(input: GdbfOrderInput & { contractId: string; packageName: string; packagePrice: number }) {
    const session = await adminLogin()
    const contract = await this.contract()
    const orderId = input.orderId || randomUUID().replace(/-/g, '')
    const form = {
      id: orderId,
      officeId: contract.officeId,
      customerId: contract.customerId,
      employeeName: input.employeeName,
      employeeSex: input.employeeSex,
      employeeIdCard: input.employeeIdCard || '',
      employeeEnName: '',
      employeeEntryDate: input.employeeEntryDate || '',
      employeePhone: input.employeePhone,
      employeeEmail: input.employeeEmail || '',
      employeeEntryAddress: '',
      employeeDept: input.employeeDept || '',
      employeePost: input.employeePost || input.packageName,
      packageId: input.packageId,
      packagePrice: input.packagePrice,
      itemsPrice: 0,
      isUrgent: input.isUrgent || '0',
      isEnReport: input.isEnReport || '0',
      isOverseas: input.isOverseas || '0',
      rightType: '0',
      reportEmail: input.reportEmail || '',
      remarks: input.remarks || '',
      contractId: input.contractId || contract.contractId,
      packageName: input.packageName,
      itemsData: '[]',
      totalPrice: Number(input.packagePrice || 0).toFixed(2),
      ext: input.ext || '{}',
    }
    const result = await adminFetch<any>(session.sessionId, '/admin/research/order/createBeforeCheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form as unknown as Record<string, string>),
    })
    if (Array.isArray(result) && result.length) {
      throw new Error(`八方检测到重复或受限的候选人记录：${JSON.stringify(result).slice(0, 300)}`)
    }
    const created = await adminFetch<any>(session.sessionId, '/admin/research/order/createOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form as unknown as Record<string, string>),
    })
    if (!created) throw new Error('八方订单创建成功但未返回订单ID')
    return { orderId: String(created), orderNo: '' }
  },
  async getOrder(orderId: string): Promise<GdbfOrderDetail> {
    const session = await adminLogin()
    const detail = await adminFetch<any>(session.sessionId, '/admin/research/orderClient/detail', {}, { id: orderId })
    const row = detail?.order || {}
    const statusText = String(row.clientStatusText || row.status || '')
    return {
      orderId: String(row.id || orderId),
      orderNo: String(row.orderCode || ''),
      officeName: String(row.officeName || ''),
      employeeName: String(row.employeeName || ''),
      employeeIdCard: String(row.employeeIdCard || ''),
      employeeSex: String(row.employeeSex || ''),
      employeePhone: String(row.employeePhone || ''),
      employeeEmail: String(row.employeeEmail || ''),
      employeeDept: String(row.employeeDept || ''),
      employeePost: String(row.employeePost || ''),
      status: String(row.status || ''),
      statusLabel: statusText,
    }
  },
  async getReports(orderId: string): Promise<GdbfAdminReportRow[]> {
    const session = await adminLogin()
    const result = await adminFetch<any>(session.sessionId, '/admin/research/orderClient/getReportList', {}, { id: orderId })
    const cn = Array.isArray(result?.cn) ? result.cn : []
    const en = Array.isArray(result?.en) ? result.en : []
    return [...cn.map((row: any) => ({ ...row, language: '中文' })), ...en.map((row: any) => ({ ...row, language: '英文' }))]
  },
  async reportDownloadUrl(fileId: string) {
    if (!fileId) return ''
    const sign = md5(fileId)
    return `${BASE}/attach/downloadV2?id=${encodeURIComponent(adminNameEncode(fileId))}&sign=${sign}`
  },
}
