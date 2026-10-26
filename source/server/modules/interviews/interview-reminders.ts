import type { TeableRecord } from '../../platform/teable'

export function isInterviewStartingSoon(interview: TeableRecord, current = Date.now()): boolean {
  const start = Date.parse(String(interview.fields['开始时间'] || ''))
  return !['已取消', '已完成'].includes(String(interview.fields['面试状态'] || ''))
    && Number.isFinite(start) && start > current && start - current <= 10 * 60_000
}
