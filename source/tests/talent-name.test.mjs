import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { TalentsService } from '../dist/modules/talents/talents.service.js';

function memoryStore() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const originals = {}, methods = ['listAllRecords', 'listByField', 'listByAnyField', 'listRecords', 'getRecord', 'findOneByField', 'createRecord', 'updateRecord'];
  for (const method of methods) originals[method] = teable[method];
  let sequence = 0;
  const matchesField = (row, field, value) => String(row.fields[field] ?? '') === String(value ?? '');
  teable.listAllRecords = async (tableId) => records.get(tableId) || [];
  teable.listByField = async (tableId, field, value, take = 100) =>
    (records.get(tableId) || []).filter((row) => matchesField(row, field, value)).slice(0, take);
  teable.listByAnyField = async (tableId, field, values, take = 100) =>
    (records.get(tableId) || []).filter((row) => values.some((value) => matchesField(row, field, value))).slice(0, take);
  teable.listRecords = async () => [];
  teable.getRecord = async (tableId, recordId) =>
    (records.get(tableId) || []).find((row) => row.id === recordId) || null;
  teable.findOneByField = async (tableId, field, value) =>
    (records.get(tableId) || []).find((row) => matchesField(row, field, value)) || null;
  teable.createRecord = async (tableId, fields) => {
    const row = { id: `${tableId}_record_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() };
    records.get(tableId).push(row);
    return row;
  };
  teable.updateRecord = async (tableId, recordId, fields) => {
    const row = (records.get(tableId) || []).find((item) => item.id === recordId);
    if (!row) throw new Error(`record not found: ${tableId}/${recordId}`);
    row.fields = { ...row.fields, ...fields };
    return row;
  };
  return { records, restore: () => Object.assign(teable, originals) };
}

test('talent name update syncs the current resume and writes an audit log', async () => {
  const memory = memoryStore();
  try {
    const candidate = await teable.createRecord('recruitment_candidates', {
      候选人ID: 'talent_name', 姓名: '旧姓名', 最新简历记录ID: 'resume_name', 合并状态: '独立档案',
    });
    const resume = await teable.createRecord('resume_extraction_records', {
      解析记录ID: 'resume_name', 候选人ID: 'talent_name', 姓名: '旧姓名',
    });
    await teable.createRecord('resume_extraction_records', {
      解析记录ID: 'resume_history', 候选人ID: 'talent_name', 姓名: '历史姓名',
    });
    const service = new TalentsService({ requireTableId: (name) => name }, {});
    service.detail = async () => ({ id: 'talent_name', name: '新姓名' });

    const result = await service.updateName('talent_name', { name: '新姓名', operator: '王HR', operatorUserId: 'hr_1' });

    assert.equal(result.candidateId, 'talent_name');
    assert.equal(result.name, '新姓名');
    assert.equal(result.talent.name, '新姓名');
    assert.equal(candidate.fields['姓名'], '新姓名');
    assert.equal(resume.fields['姓名'], '新姓名');
    assert.equal(resume.fields['人工复核状态'], '已修正');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '修改人才名称');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作人'], '王HR');

    await assert.rejects(() => service.updateName('talent_name', { name: '' }), /请填写人才姓名/);
    await assert.rejects(() => service.updateName('talent_name', { name: 'x'.repeat(51) }), /不能超过50个字符/);
  } finally {
    memory.restore();
  }
});

test('renaming a talent keeps interviews on a different application visible', async () => {
  const memory = memoryStore();
  try {
    await teable.createRecord('recruitment_candidates', {
      候选人ID: 'talent_flow', 姓名: '于女士', 最新简历记录ID: 'resume_new', 合并状态: '独立档案', 更新时间: '2026-11-20T10:00:00.000Z',
    });
    await teable.createRecord('resume_extraction_records', {
      解析记录ID: 'resume_new', 候选人ID: 'talent_flow', 姓名: '于女士', 应聘记录ID: 'application_new', 更新时间: '2026-11-20T10:00:00.000Z',
    });
    await teable.createRecord('recruitment_applications', {
      应聘记录ID: 'application_old', 候选人ID: 'talent_flow', 当前阶段: '面试评价', 更新时间: '2026-11-19T10:00:00.000Z',
    });
    await teable.createRecord('recruitment_applications', {
      应聘记录ID: 'application_new', 候选人ID: 'talent_flow', 当前阶段: 'AI分析中', 更新时间: '2026-11-20T09:00:00.000Z',
    });
    await teable.createRecord('recruitment_interviews', {
      面试ID: 'interview_old', 候选人ID: 'talent_flow', 应聘记录ID: 'application_old', 面试状态: '已完成', 开始时间: '2026-11-19T02:00:00.000Z',
    });
    await teable.createRecord('recruitment_interview_feedback', {
      评价ID: 'feedback_old', 面试ID: 'interview_old', 候选人ID: 'talent_flow', 评价状态: '已提交', 提交时间: '2026-11-19T04:00:00.000Z',
    });
    const service = new TalentsService({ requireTableId: (name) => name }, {});
    service.detailCache = { get: async (_id, _ttl, _tables, loader) => loader(), clear() {} };

    const renamed = await service.updateName('talent_flow', { name: '于明', operator: '王HR' });

    assert.equal(renamed.talent.name, '于明');
    assert.equal(renamed.talent.flowEvidence.interviews, 1);
    assert.equal(renamed.talent.flowEvidence.interview.id, 'interview_old');
    assert.equal(renamed.talent.flowEvidence.interviewFeedback, 1);
  } finally {
    memory.restore();
  }
});
