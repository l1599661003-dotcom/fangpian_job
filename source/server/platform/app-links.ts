export function appFlowUrl(action: string, params: Record<string, string | number | undefined> = {}) {
  const base = String(process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '')
  if (!base || !action) return ''
  const url = new URL(base)
  url.search = ''
  url.hash = ''
  url.searchParams.set('flow_action', action)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && String(value).trim()) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export function interviewScheduleUrl(candidateId: string, interviewId?: string) {
  const boundCandidateId = String(candidateId || '').trim()
  if (!boundCandidateId) throw new Error('约面链接必须绑定候选人')
  const params = { candidate_id: boundCandidateId, ...(interviewId ? { interview_id: interviewId } : {}) }
  return appFlowUrl('schedule', params) || `/?${new URLSearchParams({ flow_action: 'schedule', ...params }).toString()}`
}

export function interviewQuestionsUrl(interviewId: string) {
  const id = String(interviewId || '').trim()
  if (!id) throw new Error('面试题链接必须绑定面试记录')
  const base = String(process.env.APP_PUBLIC_URL || '').trim()
  if (!base) throw new Error('缺少应用公开地址，无法生成面试题链接')
  const url = new URL(base)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('面试题链接必须使用 HTTP(S)')
  url.search = ''
  url.hash = ''
  url.searchParams.set('interview_questions', id)
  return url.toString()
}
