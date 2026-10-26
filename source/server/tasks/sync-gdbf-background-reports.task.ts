import { defineTask } from '../platform/tasks'

defineTask({
  name: '八方背调报告同步',
  description: '按天拉取八方锦程背调报告，并回写到对应背调任务',
  cron: '0 */6 * * *',
  schedule: '每6小时',
  handler: async ({ log }) => {
    const port = process.env.PORT || 3000
    const response = await fetch(`http://localhost:${port}/api/background-checks/sync-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 1, operator: '系统定时任务' }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`八方报告同步失败 (${response.status}): ${text.slice(0, 500)}`)
    const result = JSON.parse(text || '{}') as { total?: number; updated?: number; start?: string; end?: string }
    log(`八方报告同步完成：区间 ${result.start || ''} 至 ${result.end || ''}，上游 ${result.total || 0} 条，命中更新 ${result.updated || 0} 条`)
  },
})
