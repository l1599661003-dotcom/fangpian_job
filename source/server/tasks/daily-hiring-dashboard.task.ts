import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { defineTask } from '../platform/tasks'
import { teable, TeableRecord } from '../platform/teable'

const companyCalendar = require('../company-calendar.js') as {
  monthForDate(value: Date | number | string): string
  monthRange(month: string): { label: string } | null
}
const text = (value: unknown) => String(value ?? '').trim()
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const chinaDate = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const escapeXml = (value: unknown) => text(value).replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] || character)
const shorten = (value: unknown, length: number) => { const normalized = text(value); return normalized.length > length ? `${normalized.slice(0, Math.max(1, length - 1))}…` : normalized }

export interface HiringDashboardRow {
  positionId: string
  department: string
  role: string
  recruiter?: string
  backupRecruiter?: string
  priority: string
  demand: number
  completed: number
  remaining: number
  completionRate: number
  completedAll: boolean
  completedNames: string[]
}

export interface HiringDashboardData {
  month: string
  generatedDate: string
  rows: HiringDashboardRow[]
  summary: { demand: number; arrived: number; remaining: number; completedPositions: number }
}

export function buildHiringDashboardData(input: {
  month: string
  generatedDate: string
  positions: TeableRecord[]
  demands: TeableRecord[]
  candidates: TeableRecord[]
  applications: TeableRecord[]
}): HiringDashboardData {
  const priorityAliases: Record<string, string> = { 高: '紧急', 中: '重要', 低: '储备', 一般: '储备' }
  const normalizePriority = (value: unknown) => priorityAliases[text(value)] || text(value) || '储备'
  const priorityRank = (value: unknown) => ({ 紧急: 0, 重要: 1, 储备: 2 }[normalizePriority(value)] ?? 3)
  const positionsById = new Map(input.positions.map((row) => [text(row.fields['职位ID']) || row.id, row]))
  const publishedPositionIds = new Set(input.positions.filter((row) => text(row.fields['发布状态']) === '招聘中' && text(row.fields['招聘状态']) !== '暂停招聘').map((row) => text(row.fields['职位ID']) || row.id))
  const monthDemands = input.demands.filter((row) => text(row.fields['需求月份']) === input.month
    && number(row.fields['需求数量']) > 0
    && text(row.fields['审批状态']) !== '已驳回'
    && !['审批驳回', '已停用'].includes(text(row.fields['需求状态']))
    && publishedPositionIds.has(text(row.fields['职位ID'])))
  const rows = new Map<string, HiringDashboardRow>()
  for (const demand of monthDemands) {
    const positionId = text(demand.fields['职位ID']), position = positionsById.get(positionId)
    const current = rows.get(positionId) || {
      positionId,
      department: text(demand.fields['部门']) || text(position?.fields['部门']) || '未分配部门',
      role: text(demand.fields['职位名称']) || text(position?.fields['职位名称']) || '未命名岗位',
      recruiter: text(position?.fields['招聘HR']),
      backupRecruiter: text(position?.fields['备用招聘HR']),
      priority: '储备',
      demand: 0,
      completed: 0,
      remaining: 0,
      completionRate: 0,
      completedAll: false,
      completedNames: [],
    }
    current.demand += Math.max(0, Math.round(number(demand.fields['需求数量'])))
    const priority = normalizePriority(demand.fields['优先级'])
    if (priorityRank(priority) < priorityRank(current.priority)) current.priority = priority
    rows.set(positionId, current)
  }
  const demandPositionIds = new Set(rows.keys())
  const applicationsByCandidate = new Map<string, TeableRecord[]>()
  for (const application of input.applications) {
    const candidateId = text(application.fields['候选人ID']), positionId = text(application.fields['职位ID'])
    if (!candidateId || !demandPositionIds.has(positionId)) continue
    applicationsByCandidate.set(candidateId, [...(applicationsByCandidate.get(candidateId) || []), application])
  }
  const countedCandidates = new Set<string>()
  for (const candidate of input.candidates) {
    if (text(candidate.fields['候选人状态']) === '已删除' || text(candidate.fields['合并状态']) === '已合并') continue
    const candidateId = text(candidate.fields['候选人ID']) || candidate.id
    if (companyCalendar.monthForDate(text(candidate.fields['天玑入职日期'])) !== input.month || countedCandidates.has(candidateId)) continue
    const application = (applicationsByCandidate.get(candidateId) || []).sort((left, right) => {
      const leftStage = text(left.fields['当前阶段']) === '已入职' ? 1 : 0, rightStage = text(right.fields['当前阶段']) === '已入职' ? 1 : 0
      return rightStage - leftStage || (text(right.fields['更新时间']) || text(right.fields['创建时间'])).localeCompare(text(left.fields['更新时间']) || text(left.fields['创建时间']))
    })[0]
    const row = rows.get(text(application?.fields['职位ID']))
    if (!row) continue
    countedCandidates.add(candidateId)
    row.completed += 1
    row.completedNames.push(text(candidate.fields['姓名']) || candidateId)
  }
  const resultRows = [...rows.values()].map((row) => ({
    ...row,
    completedNames: [...new Set(row.completedNames)],
    remaining: Math.max(0, row.demand - row.completed),
    completionRate: row.demand > 0 ? Math.min(100, Math.round((row.completed / row.demand) * 100)) : 0,
    completedAll: row.demand > 0 && row.completed >= row.demand,
  })).sort((left, right) => Number(left.completedAll) - Number(right.completedAll)
    || priorityRank(left.priority) - priorityRank(right.priority)
    || (!left.completedAll ? left.completed - right.completed : 0)
    || right.demand - left.demand
    || left.department.localeCompare(right.department, 'zh-CN')
    || left.role.localeCompare(right.role, 'zh-CN'))
  return {
    month: input.month,
    generatedDate: input.generatedDate,
    rows: resultRows,
    summary: {
      demand: resultRows.reduce((sum, row) => sum + row.demand, 0),
      arrived: countedCandidates.size,
      remaining: resultRows.reduce((sum, row) => sum + row.remaining, 0),
      completedPositions: resultRows.filter((row) => row.completedAll).length,
    },
  }
}

export function buildHiringDashboardSvg(input: HiringDashboardData) {
  const companyPeriod = companyCalendar.monthRange(input.month)
  const data = { ...input, month: companyPeriod ? `${input.month} · ${companyPeriod.label}` : input.month }
  const rowHeight = 82
  const rowsStartY = 252
  const footerY = rowsStartY + data.rows.length * rowHeight + 36
  const canvasHeight = Math.max(630, footerY + 20)
  const priorityStyle: Record<string, { background: string; foreground: string }> = {
    紧急: { background: '#FDE4E1', foreground: '#B83B32' },
    重要: { background: '#FCEBD2', foreground: '#B66518' },
    储备: { background: '#FFF3C7', foreground: '#8A6814' },
  }
  const metric = (x: number, label: string, value: number, note: string, accent: string) => `<g transform="translate(${x} 118)"><rect width="258" height="100" rx="18" fill="#FFFDF8"/><rect x="18" y="20" width="5" height="60" rx="3" fill="${accent}"/><text x="42" y="42" class="metric-label">${escapeXml(label)}</text><text x="42" y="78" class="metric-value">${value}</text><text x="98" y="76" class="metric-note">${escapeXml(note)}</text></g>`
  const rows = data.rows.map((row, index) => {
    const y = rowsStartY + index * rowHeight, style = priorityStyle[row.priority] || priorityStyle['储备'], progress = Math.round(245 * row.completionRate / 100)
    const names = row.completedNames.length ? shorten(row.completedNames.slice(0, 3).join('、'), 18) : '暂无入职人员'
    return `<g transform="translate(42 ${y})"><rect width="1116" height="72" rx="13" fill="${row.completedAll ? '#F0F5EA' : '#FFFDF8'}"/><rect x="0" width="6" height="72" rx="3" fill="${style.foreground}"/><rect x="20" y="13" width="58" height="26" rx="13" fill="${style.background}"/><text x="49" y="31" text-anchor="middle" class="priority" fill="${style.foreground}">${escapeXml(row.priority)}</text><text x="96" y="22" class="department">${escapeXml(shorten(row.department, 10))}</text><text x="96" y="41" class="role">${escapeXml(shorten(row.role, 18))}</text><text x="96" y="61" class="names">${escapeXml(`招聘HR：${row.recruiter || '待分配'}${row.backupRecruiter ? ` · 备用HR：${row.backupRecruiter}` : ''}`)}</text><text x="405" y="22" class="small">需求 / 实际入职 / 剩余</text><text x="405" y="42" class="numbers">${row.demand} / ${row.completed} / ${row.remaining}</text><rect x="590" y="20" width="245" height="10" rx="5" fill="#EDE8DD"/><rect x="590" y="20" width="${progress}" height="10" rx="5" fill="${row.completedAll ? '#6E925D' : style.foreground}"/><text x="850" y="31" class="rate">${row.completionRate}%</text><text x="930" y="31" class="names">${escapeXml(names)}</text></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${canvasHeight}" viewBox="0 0 1200 ${canvasHeight}"><defs><linearGradient id="header" x1="0" x2="1"><stop stop-color="#2C2118"/><stop offset="1" stop-color="#5C4328"/></linearGradient></defs><style>text{font-family:'Source Han Sans CN','Noto Sans CJK SC',sans-serif}.brand{font-size:18px;font-weight:700;letter-spacing:2px;fill:#EFDDBA}.title{font-size:38px;font-weight:800;fill:#FFFDF7}.subtitle{font-size:16px;fill:#D8C9B5}.date{font-size:16px;font-weight:700;fill:#FFF3D8}.metric-label{font-size:15px;font-weight:700;fill:#756959}.metric-value{font-size:34px;font-weight:800;fill:#2C2118}.metric-note{font-size:13px;fill:#9B8F7F}.priority{font-size:13px;font-weight:800}.department{font-size:11px;fill:#948777}.role{font-size:16px;font-weight:750;fill:#2C2118}.small{font-size:10px;fill:#A29788}.numbers{font-size:16px;font-weight:800;fill:#4A3A2A}.rate{font-size:15px;font-weight:800;fill:#4A3A2A}.names{font-size:12px;fill:#6F6457}.footer{font-size:12px;fill:#8D8172}</style><rect width="1200" height="${canvasHeight}" fill="#F6F1E8"/><rect width="1200" height="96" fill="url(#header)"/><text x="42" y="34" class="brand">FANGPIAN RECRUITMENT</text><text x="42" y="76" class="title">部门岗位达成日报</text><text x="1158" y="38" text-anchor="end" class="date">${escapeXml(data.month)}</text><text x="1158" y="70" text-anchor="end" class="subtitle">${escapeXml(data.generatedDate)} 21:00 · 人才群</text>${metric(42, '本月招聘需求', data.summary.demand, '人', '#B83B32')}${metric(328, '实际入职', data.summary.arrived, '人', '#6E925D')}${metric(614, '仍需招聘', data.summary.remaining, '人', '#B66518')}${metric(900, '已达成岗位', data.summary.completedPositions, '个', '#6A5A8A')}<text x="42" y="244" class="subtitle" fill="#4A3A2A">共 ${data.rows.length} 个招聘中岗位，按未完成、优先级和达成数排序</text>${rows}<text x="42" y="${footerY}" class="footer">口径：仅统计招聘中岗位；实际入职按天玑花名册 create_time（北京时间）</text></svg>`
}

export function resolveHiringDashboardFont(fileExists: (path: string) => boolean = existsSync) {
  const candidates = [
    {
      family: 'Source Han Sans CN',
      files: ['/usr/share/fonts/arp/source-han-sans/SourceHanSansCN-Regular.otf', '/usr/share/fonts/arp/source-han-sans/SourceHanSansCN-Bold.otf'],
    },
    {
      family: 'Noto Sans CJK SC',
      files: ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'],
    },
  ]
  const selected = candidates.find((candidate) => candidate.files.every(fileExists))
  if (!selected) throw new Error('招聘日报缺少中文字体，已停止生成和发送图片。请重新构建并发布包含 fonts-noto-cjk 的运行镜像。')
  return { loadSystemFonts: false, fontFiles: selected.files, defaultFontFamily: selected.family, sansSerifFamily: selected.family }
}

export function renderHiringDashboardPng(data: HiringDashboardData) {
  const renderer = new Resvg(buildHiringDashboardSvg(data), {
    background: '#F6F1E8',
    fitTo: { mode: 'width', value: 1200 },
    font: resolveHiringDashboardFont(),
  })
  return Buffer.from(renderer.render().asPng())
}

export function buildHiringDashboardImageMessage(png: Buffer | Uint8Array) {
  const bytes = Buffer.from(png)
  if (bytes.length > 2 * 1024 * 1024) throw new Error('招聘达成日报图片超过企微 2MB 限制')
  return {
    msgtype: 'image',
    image: {
      base64: bytes.toString('base64'),
      md5: createHash('md5').update(bytes).digest('hex'),
    },
  }
}

defineTask({
  name: '每日部门岗位达成看板',
  description: '每天晚上9点生成部门岗位达成长图，并以图片消息推送到人才群',
  cron: '0 21 * * *',
  schedule: '每天 21:00',
  handler: async ({ deliver, log }) => {
    const webhookKey = text(process.env.WECOM_TALENT_GROUP_WEBHOOK_KEY)
    if (!webhookKey) throw new Error('未配置 WECOM_TALENT_GROUP_WEBHOOK_KEY，无法推送人才群')
    const generatedDate = chinaDate(), month = companyCalendar.monthForDate(Date.now())
    const tableNames = ['recruitment_positions', 'recruitment_monthly_demands', 'recruitment_candidates', 'recruitment_applications']
    const tables = await Promise.all(tableNames.map((name) => teable.ensureTable(name)))
    const [positions, demands, candidates, applications] = await Promise.all(tables.map((table) => teable.listAllRecords(table.id)))
    const data = buildHiringDashboardData({ month, generatedDate, positions, demands, candidates, applications })
    const png = renderHiringDashboardPng(data)
    await deliver(`部门岗位达成日报-${generatedDate}.png`, png, 'image/png')
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(webhookKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildHiringDashboardImageMessage(png)),
    })
    const result = await response.json().catch(() => ({} as any))
    if (!response.ok || result?.errcode !== 0) throw new Error(`部门岗位达成看板发送失败：${text(result?.errmsg) || `未收到企微成功回执（HTTP ${response.status}）`}`)
    log(`已向人才群推送 ${month} 部门岗位达成看板：需求 ${data.summary.demand} 人，实际入职 ${data.summary.arrived} 人`)
  },
})
