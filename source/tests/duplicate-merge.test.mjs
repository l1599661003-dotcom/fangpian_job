import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { TalentsService } from '../dist/modules/talents/talents.service.js';

function memoryStore() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const originals = {}, methods = ['listRecords', 'listAllRecords', 'createRecord', 'updateRecord', 'deleteRecord'];
  for (const method of methods) originals[method] = teable[method];
  let sequence = 0;
  teable.listRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.listAllRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.createRecord = async (tableId, fields) => { const row = { id: `${tableId}_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() }; records.get(tableId).push(row); return row; };
  teable.updateRecord = async (tableId, recordId, fields) => { const row = records.get(tableId).find((item) => item.id === recordId); if (!row) throw new Error(`record missing ${tableId}/${recordId}`); row.fields = { ...row.fields, ...fields }; return row; };
  teable.deleteRecord = async () => {};
  return { records, restore: () => Object.assign(teable, originals) };
}

test('duplicate scan, merge and undo preserve candidate and relation history', async () => {
  const memory = memoryStore();
  try {
    const create = teable.createRecord;
    await create('recruitment_candidates', { 候选人ID: 'tal_a', 姓名: '陈晓', 电话: '13900139000', 邮箱: 'chen@example.com', 当前城市: '杭州', 教育经历: '浙江大学 本科', 工作经历: '方片科技 产品经理', 候选人状态: '负责人审查', 人才池: '公司人才库', 合并状态: '独立档案', 创建时间: '2026-07-01T00:00:00.000Z', 更新时间: '2026-08-01T00:00:00.000Z' });
    await create('recruitment_candidates', { 候选人ID: 'tal_b', 姓名: '陈晓', 电话: '13900139000', 邮箱: 'chen@example.com', 微信: 'chenxiao88', 当前城市: '上海', 教育经历: '浙江大学 本科', 工作经历: '方片科技 产品负责人', 候选人状态: '意向沟通', 人才池: '公司人才库', 合并状态: '独立档案', 创建时间: '2026-07-15T00:00:00.000Z', 更新时间: '2026-08-02T00:00:00.000Z' });
    const related = await create('recruitment_applications', { 应聘记录ID: 'app_b', 候选人ID: 'tal_b', 当前阶段: '意向沟通', 当前状态: '进行中', 创建时间: '2026-08-02T00:00:00.000Z' });
    const service = new TalentsService({ requireTableId: (name) => name }, { syncDemandMetrics: async () => ({}) });

    const scan = await service.scanDuplicateCandidates('测试扫描');
    assert.deepEqual(scan, { scanned: 2, matchedPairs: 1, createdCases: 1 });
    const cases = await service.listDuplicateCases('待处理');
    assert.equal(cases.total, 1);
    assert.ok(cases.cases[0].score >= 80);
    assert.equal(cases.cases[0].scores.contact, 100);

    const merged = await service.mergeDuplicateCase(cases.cases[0].id, { primaryCandidateId: 'tal_a', fieldSources: { wechat: 'secondary', address: 'secondary' }, reason: '姓名、电话、邮箱及教育工作经历一致，人工确认为同一人', operator: '招聘管理员' });
    assert.equal(merged.primaryCandidateId, 'tal_a');
    assert.equal(merged.secondaryCandidateId, 'tal_b');
    assert.equal(merged.migratedRecords, 1);
    assert.equal(related.fields['候选人ID'], 'tal_a');
    const secondary = memory.records.get('recruitment_candidates').find((row) => row.fields['候选人ID'] === 'tal_b');
    assert.equal(secondary.fields['合并状态'], '已合并');
    assert.equal(secondary.fields['合并至候选人ID'], 'tal_a');
    const primary = memory.records.get('recruitment_candidates').find((row) => row.fields['候选人ID'] === 'tal_a');
    assert.equal(primary.fields['微信'], 'chenxiao88');
    assert.equal(primary.fields['当前城市'], '上海');

    const undone = await service.undoMerge(merged.mergeId, { reason: '复核后发现需要拆分为两份独立档案', operator: '招聘管理员' });
    assert.equal(undone.status, '已撤销');
    assert.equal(undone.restoredRecords, 1);
    assert.equal(related.fields['候选人ID'], 'tal_b');
    assert.equal(primary.fields['合并状态'], '独立档案');
    assert.equal(secondary.fields['合并状态'], '独立档案');
    assert.equal(memory.records.get('recruitment_candidate_duplicate_cases')[0].fields['案件状态'], '已撤销');
    assert.equal(memory.records.get('recruitment_candidate_merge_events')[0].fields['合并状态'], '已撤销');
    const actions = memory.records.get('recruitment_audit_logs').map((row) => row.fields['操作类型']);
    assert.ok(actions.includes('合并人才档案'));
    assert.ok(actions.includes('撤销人才合并'));
  } finally { memory.restore(); }
});
