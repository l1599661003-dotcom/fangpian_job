export const ONLINE_INTERVIEW_MODE = '线上面试'

const LEGACY_ONLINE_INTERVIEW_MODES = ['视频面试', '电话面试']

export function normalizeInterviewMode(value: unknown) {
  const mode = String(value ?? '').trim()
  return LEGACY_ONLINE_INTERVIEW_MODES.includes(mode) ? ONLINE_INTERVIEW_MODE : mode
}

export function isOnlineInterviewMode(value: unknown) {
  return normalizeInterviewMode(value) === ONLINE_INTERVIEW_MODE
}
