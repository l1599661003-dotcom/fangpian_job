import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { teable } from '../dist/platform/teable.js';
import { TasksService, defineTask } from '../dist/platform/tasks.js';

test('scheduled task dashboard reads the persisted run schema and relies on application access control', async () => {
  const source = await readFile(new URL('../server/platform/tasks.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /x-studio-task-key/);
  assert.match(source, /row\.fields\['TaskName'\]/);
  assert.match(source, /row\.fields\['Artifacts'\]/);
  assert.match(source, /jobs\.start/);

  const taskName = '测试任务看板字段';
  defineTask({ name: taskName, cron: '15 18 * * *', schedule: '每天 18:15', handler: async () => {} });
  const service = new TasksService({});
  service.tasksTableId = 'tasks';
  service.runsTableId = 'runs';
  const original = teable.listRecords;
  try {
    teable.listRecords = async (tableId) => tableId === 'tasks'
      ? [{ id: 'task_row', fields: { Name: taskName, Enabled: true, Cron: '15 18 * * *', Schedule: '每天 18:15', RunCount: 2, LastStatus: 'success', LastRunAt: '2026-09-24T10:15:00.000Z' } }]
      : [{ id: 'run_row', fields: { TaskName: taskName, Trigger: 'manual', Status: 'success', StartedAt: '2026-09-24T10:15:00.000Z', DurationMs: 850, Artifacts: '[{"name":"日报.png"}]', Error: '' } }];
    const dashboard = await service.listForDashboard();
    const task = dashboard.tasks.find((item) => item.name === taskName);
    assert.equal(task.cron, '15 18 * * *');
    assert.ok(task.timezone);
    assert.equal(dashboard.recentRuns[0].task, taskName);
    assert.equal(dashboard.recentRuns[0].trigger, 'manual');
    assert.equal(dashboard.recentRuns[0].artifacts, '[{"name":"日报.png"}]');
  } finally {
    teable.listRecords = original;
  }
});

test('task config rejects invalid cron before writing and saves valid visual schedules', async () => {
  const taskName = '测试可视化执行计划';
  defineTask({ name: taskName, cron: '0 9 * * *', timezone: 'Asia/Shanghai', handler: async () => {} });
  const service = new TasksService({});
  service.tasksTableId = 'tasks';
  service.ensureInit = async () => {};
  const originalList = teable.listRecords, originalUpdate = teable.updateRecord;
  const writes = [];
  try {
    teable.listRecords = async () => [{ id: 'row', fields: { Name: taskName } }];
    teable.updateRecord = async (_table, _row, patch) => { writes.push(patch); };
    await assert.rejects(() => service.updateTaskConfig(taskName, { cron: '75 29 * * *' }), /执行时间无效/);
    assert.equal(writes.length, 0);
    await service.updateTaskConfig(taskName, { cron: '30 20 * * 1,3,5', schedule: '每周一、三、五 20:30', enabled: false });
    assert.equal(writes[0].Cron, '30 20 * * 1,3,5');
    assert.equal(writes[0].Enabled, false);
  } finally { teable.listRecords = originalList; teable.updateRecord = originalUpdate; }
});
