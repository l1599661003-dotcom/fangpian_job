import type { TeableRecord } from '../../platform/teable'
import { normalizeInterviewMode } from '../interviews/interview-mode'

export interface DailyHiringActivityInput {
  date: string
  from: number
  to: number
  resumeVersions: TeableRecord[]
  candidates: TeableRecord[]
  interviews: TeableRecord[]
  offers: TeableRecord[]
  offerSendEvents?: TeableRecord[]
  onboardings: TeableRecord[]
  positions?: TeableRecord[]
  users?: TeableRecord[]
  organizations?: TeableRecord[]
  allowedCandidateIds: Set<string>
  allowedPositionIds: Set<string>
  allAccess: boolean
}

const text = (value: unknown) => String(value ?? '').trim()
const stringArray = (value: unknown) => {
  try { return value ? JSON.parse(String(value)) as unknown[] : [] } catch { return [] }
}

export function groupByCandidate(rows: Record<string, string>[], timeField: string, summarize: (rows: Record<string, string>[]) => Record<string, unknown>) {
  const grouped = new Map<string, Record<string, string>[]>()
  for (const row of rows) {
    const key = text(row.candidateId) || text(row.candidateName) || JSON.stringify(row)
    grouped.set(key, [...(grouped.get(key) || []), row])
  }
  return [...grouped.values()].map((items) => {
    const latest = [...items].sort((left, right) => text(right[timeField]).localeCompare(text(left[timeField])))[0]
    return { ...latest, ...summarize(items) }
  }).sort((left, right) => text(right[timeField]).localeCompare(text(left[timeField]))
    || text(left.candidateName).localeCompare(text(right.candidateName), 'zh-CN'))
}

export function buildDailyHiringActivity(input: DailyHiringActivityInput) {
  const isToday = (value: unknown) => {
    const raw = text(value)
    if (!raw) return false
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T00:00:00+08:00`) : Date.parse(raw)
    return Number.isFinite(timestamp) && timestamp >= input.from && timestamp < input.to
  }
  const canSee = (row: TeableRecord) => input.allAccess
    || input.allowedCandidateIds.has(text(row.fields['候选人ID']))
    || input.allowedPositionIds.has(text(row.fields['职位ID']))
  const candidates = new Map(input.candidates.map((row) => [text(row.fields['候选人ID']) || row.id, row]))
  const resumeUploadsById = new Map<string, Record<string, string>>()
  const users = input.users || []
  const organizations = input.organizations || []
  const organizationById = new Map(organizations.map((row) => [text(row.fields['组织单元ID']) || row.id, row]))
  const userById = new Map(users.map((row) => [text(row.fields['用户ID']) || row.id, row]))
  const positions = input.positions || []
  const positionsById = new Map(positions.map((row) => [text(row.fields['职位ID']) || row.id, row]))

  const employeeForUploader = (uploaderUserId: string, uploaderName: string) => {
    if (uploaderUserId && userById.has(uploaderUserId)) return userById.get(uploaderUserId)
    const activeMatches = users.filter((row) => text(row.fields['姓名']) === uploaderName && ['启用', ''].includes(text(row.fields['用户状态'])))
    if (activeMatches.length === 1) return activeMatches[0]
    const allMatches = users.filter((row) => text(row.fields['姓名']) === uploaderName)
    return allMatches.length === 1 ? allMatches[0] : undefined
  }

  const parentDepartmentFor = (employee?: TeableRecord) => {
    if (!employee) return '未归属部门'
    const departmentIds = stringArray(employee.fields['部门IDJSON']).map(text).filter(Boolean)
    for (const departmentId of departmentIds) {
      const department = organizationById.get(departmentId)
      if (!department) continue
      let current = department
      let guard = 0
      while (guard++ < 20) {
        const parentId = text(current.fields['上级组织单元ID'])
        const parent = parentId ? organizationById.get(parentId) : undefined
        if (!parent || text(parent.fields['组织类型']) === '事业部') break
        current = parent
      }
      return text(current.fields['组织名称']) || '未归属部门'
    }
    const departmentNames = stringArray(employee.fields['部门JSON']).map(text).filter(Boolean)
    for (const departmentName of departmentNames) {
      const matches = organizations.filter((row) => text(row.fields['组织名称']) === departmentName)
      if (matches.length === 1) return text(matches[0].fields['组织名称'])
    }
    return departmentNames[0] || '未归属部门'
  }

  for (const row of input.resumeVersions) {
    const candidateId = text(row.fields['候选人ID'])
    const createdAt = text(row.fields['创建时间']) || text(row.createdTime)
    const parseStatus = text(row.fields['解析状态'])
    if (!candidateId || !isToday(createdAt) || parseStatus && parseStatus !== '已完成') continue
    const resumeId = text(row.fields['简历记录ID']) || text(row.fields['简历版本ID']) || row.id
    if (resumeUploadsById.has(resumeId)) continue
    const candidate = candidates.get(candidateId)
    const source = text(row.fields['来源类型']) || '简历上传'
    const isReferral = source.includes('内推')
    const uploaderUserId = text(row.fields['创建人用户ID'])
    const uploader = isReferral ? '内推' : text(row.fields['创建人']) || '未记录'
    const department = parentDepartmentFor(employeeForUploader(uploaderUserId, uploader))
    resumeUploadsById.set(resumeId, {
      candidateId,
      candidateName: text(candidate?.fields['姓名']) || candidateId,
      fileName: text(row.fields['文件名']) || '未命名简历',
      sourceUrl: input.allAccess || input.allowedCandidateIds.has(candidateId) ? text(row.fields['文件地址']) : '',
      uploader,
      uploaderUserId: isReferral ? '' : uploaderUserId,
      department,
      uploadedAt: createdAt,
      source,
    })
  }

  const resumeUploads = groupByCandidate([...resumeUploadsById.values()], 'uploadedAt', (rows) => ({
    fileName: rows.map((row) => row.fileName).filter(Boolean).join('、'),
    sourceUrl: rows.find((row) => row.sourceUrl)?.sourceUrl || '',
    uploader: [...new Set(rows.map((row) => row.uploader).filter(Boolean))].join('、'),
    department: [...new Set(rows.map((row) => row.department).filter(Boolean))].join('、'),
    source: [...new Set(rows.map((row) => row.source).filter(Boolean))].join('、'),
    count: rows.length,
  }))
  const resumeUploadEvents = [...resumeUploadsById.values()]
  const uploaderCounts = new Map<string, { name: string; count: number; department: string }>()
  for (const row of resumeUploadEvents) {
    const current = uploaderCounts.get(row.uploader) || { name: row.uploader, count: 0, department: row.department }
    current.count += 1
    uploaderCounts.set(row.uploader, current)
  }
  const departmentUploaders = new Map<string, Map<string, number>>()
  for (const row of resumeUploadEvents) {
    const uploaders = departmentUploaders.get(row.department) || new Map<string, number>()
    uploaders.set(row.uploader, (uploaders.get(row.uploader) || 0) + 1)
    departmentUploaders.set(row.department, uploaders)
  }
  const positionInfo = (positionId: string, row?: TeableRecord) => ({
    position: text(row?.fields['岗位名称']) || text(positionsById.get(positionId)?.fields['职位名称']) || '未命名岗位',
    department: text(row?.fields['部门']) || text(positionsById.get(positionId)?.fields['部门']) || '未分配部门',
  })
  const interviewDetailsById = new Map<string, Record<string, string>>()
  for (const row of input.interviews) {
    if (!isToday(row.fields['开始时间']) || text(row.fields['面试状态']) === '已取消' || !canSee(row)) continue
    const interviewId = text(row.fields['面试ID']) || row.id
    if (interviewDetailsById.has(interviewId)) continue
    const candidateId = text(row.fields['候选人ID'])
    const positionId = text(row.fields['职位ID'])
    interviewDetailsById.set(interviewId, {
      interviewId,
      candidateId,
      candidateName: text(candidates.get(candidateId)?.fields['姓名']) || candidateId || '未命名候选人',
      ...positionInfo(positionId),
      round: text(row.fields['面试轮次']) || '待定轮次',
      method: normalizeInterviewMode(row.fields['面试方式']) || '待定方式',
      startsAt: text(row.fields['开始时间']),
      location: text(row.fields['面试地点']) || text(row.fields['会议地址']) || '待定地点',
      interviewers: stringArray(row.fields['面试官姓名JSON']).map(text).filter(Boolean).join('、') || '待定',
      status: text(row.fields['面试状态']) || '待确认',
    })
  }
  const interviewDetails = groupByCandidate([...interviewDetailsById.values()], 'startsAt', (rows) => ({
    interviewId: rows.map((row) => row.interviewId).filter(Boolean).join('、'),
    position: [...new Set(rows.map((row) => row.position).filter(Boolean))].join('、'),
    department: [...new Set(rows.map((row) => row.department).filter(Boolean))].join('、'),
    round: rows.map((row) => row.round).filter(Boolean).join('、'),
    method: [...new Set(rows.map((row) => row.method).filter(Boolean))].join('、'),
    location: [...new Set(rows.map((row) => row.location).filter(Boolean))].join('、'),
    interviewers: [...new Set(rows.flatMap((row) => row.interviewers.split('、')).filter(Boolean))].join('、') || '待定',
    status: [...new Set(rows.map((row) => row.status).filter(Boolean))].join('、'),
    count: rows.length,
  }))

  const offerSenderById = new Map<string, string>()
  for (const row of input.offerSendEvents || []) {
    if (text(row.fields['发送状态']) !== '已发送') continue
    const offerId = text(row.fields['OfferID'])
    const sender = text(row.fields['操作人']) || '未记录'
    if (!offerId || offerSenderById.has(offerId)) continue
    offerSenderById.set(offerId, sender)
  }
  const offerDetailsById = new Map<string, Record<string, string>>()
  for (const row of input.offers) {
    if (!isToday(row.fields['发送时间']) || !['已发送', '发送成功', '候选人已答复'].includes(text(row.fields['发送状态'])) || !canSee(row)) continue
    const offerId = text(row.fields['OfferID']) || row.id
    if (offerDetailsById.has(offerId)) continue
    const candidateId = text(row.fields['候选人ID'])
    const positionId = text(row.fields['职位ID'])
    offerDetailsById.set(offerId, {
      offerId,
      candidateId,
      candidateName: text(candidates.get(candidateId)?.fields['姓名']) || candidateId || '未命名候选人',
      ...positionInfo(positionId, row),
      offerNo: text(row.fields['Offer编号']) || offerId,
      sender: offerSenderById.get(offerId) || text(row.fields['创建人']) || '未记录',
      sentAt: text(row.fields['发送时间']),
      status: text(row.fields['发送状态']) || '待发送',
    })
  }
  const offerDetails = groupByCandidate([...offerDetailsById.values()], 'sentAt', (rows) => ({
    offerId: rows.map((row) => row.offerId).filter(Boolean).join('、'),
    offerNo: rows.map((row) => row.offerNo).filter(Boolean).join('、'),
    sender: [...new Set(rows.map((row) => row.sender).filter(Boolean))].join('、') || '未记录',
    position: [...new Set(rows.map((row) => row.position).filter(Boolean))].join('、'),
    department: [...new Set(rows.map((row) => row.department).filter(Boolean))].join('、'),
    status: [...new Set(rows.map((row) => row.status).filter(Boolean))].join('、'),
    count: rows.length,
  }))

  const arrivalDetailsByCandidate = new Map<string, Record<string, string>>()
  for (const row of input.onboardings) {
    if (!isToday(row.fields['实际到岗日期']) || !canSee(row)) continue
    const candidateId = text(row.fields['候选人ID']) || row.id
    if (arrivalDetailsByCandidate.has(candidateId)) continue
    const positionId = text(row.fields['职位ID'])
    arrivalDetailsByCandidate.set(candidateId, {
      candidateId,
      candidateName: text(candidates.get(candidateId)?.fields['姓名']) || candidateId || '未命名候选人',
      ...positionInfo(positionId, row),
      arrivalDate: text(row.fields['实际到岗日期']),
      status: text(row.fields['入职状态']) || '已到岗',
    })
  }
  const arrivalDetails = [...arrivalDetailsByCandidate.values()].sort((left, right) => right.arrivalDate.localeCompare(left.arrivalDate)
    || String(right.candidateName).localeCompare(String(left.candidateName), 'zh-CN'))
  const arrivedCandidates = new Set(arrivalDetails.map((row) => row.candidateId))

  return {
    date: input.date,
    timeZone: 'Asia/Shanghai',
    summary: {
      resumes: resumeUploads.length,
      interviews: interviewDetails.length,
      offers: offerDetails.length,
      arrived: arrivedCandidates.size,
    },
    uploaders: [...uploaderCounts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN')),
    departmentUploads: [...departmentUploaders].map(([department, uploaders]) => ({
      department,
      count: [...uploaders.values()].reduce((sum, count) => sum + count, 0),
      uploaders: [...uploaders].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN')),
    })).sort((left, right) => right.count - left.count || left.department.localeCompare(right.department, 'zh-CN')),
    resumeUploads,
    interviewDetails,
    offerDetails,
    arrivalDetails,
  }
}
