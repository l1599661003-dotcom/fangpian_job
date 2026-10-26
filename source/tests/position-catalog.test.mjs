import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { RecruitmentService } from '../dist/modules/recruitment/recruitment.service.js';
import { RecruitmentController } from '../dist/modules/recruitment/recruitment.controller.js';

test('position catalog avoids workflow tables and preserves scope and fresh edits', async () => {
  const original = teable.listAllRecords;
  const positions = [
    { id: 'record_one', fields: { 职位ID: 'one', 职位名称: '产品经理', 部门ID: 'dept_one', 招聘HR: '招聘负责人', 岗位JD: '完整JD', 发布状态: '招聘中' } },
    { id: 'record_two', fields: { 职位ID: 'two', 职位名称: '其他部门岗位', 部门ID: 'dept_two' } },
  ];
  const calls = [];
  teable.listAllRecords = async (table) => {
    calls.push(table);
    if (table === 'recruitment_positions') return positions;
    if (table === 'recruitment_organization_units') return [];
    throw new Error(`Unexpected table: ${table}`);
  };
  try {
    const service = new RecruitmentService({ requireTableId: name => name });
    const admin = { roleCodes: ['system_admin'], dataScopes: [] };
    const first = await service.positionCatalog(admin);
    assert.equal(first.positions.length, 2);
    assert.deepEqual(calls, ['recruitment_positions']);
    assert.equal(first.positions[0].jobDescription, '完整JD');
    assert.equal(first.positions[0].recruiter, '招聘负责人');
    assert.equal('applicantCount' in first.positions[0], false);
    positions[0].fields['职位名称'] = '高级产品经理';
    const scoped = await service.positionCatalog({ roleCodes: ['employee'], dataScopes: [{ type: 'department', departmentIds: ['dept_one'] }] });
    assert.deepEqual(scoped.positions.map(row => row.id), ['one']);
    assert.equal(scoped.positions[0].name, '高级产品经理');
    const none = await service.positionCatalog({ roleCodes: ['employee'], dataScopes: [] });
    assert.equal(none.positions.length, 0);
    const controller = new RecruitmentController(service, { getRequestAccess: async () => ({ profile: admin }) });
    assert.equal((await controller.overview({}, 'positions')).positions.length, 2);
  } finally { teable.listAllRecords = original; }
});

test('monthly demand reads are parallel, month-filtered and department-scoped without schema writes', async () => {
  const original = teable.listAllRecords;
  const calls = [];
  teable.listAllRecords = async (table, options) => {
    calls.push({ table, options });
    if (table === 'recruitment_monthly_demands') {
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(calls.some(call => call.table === 'recruitment_positions'));
      return ['one', 'two'].map(positionId => ({ id: positionId, fields: { 职位ID: positionId, 需求月份: '2026-09', 需求数量: 3 } }));
    }
    if (table === 'recruitment_positions') return ['one', 'two'].map(positionId => ({ id: positionId, fields: { 职位ID: positionId, 部门ID: `dept_${positionId}` } }));
    if (table === 'recruitment_organization_units') return [];
    throw new Error(`Unexpected table: ${table}`);
  };
  try {
    const service = new RecruitmentService({ requireTableId: name => name });
    const data = await service.listMonthlyDemands('2026-09', '', { roleCodes: ['employee'], dataScopes: [{ type: 'department', departmentIds: ['dept_one'] }] });
    assert.deepEqual(data.demands.map(row => row.positionId), ['one']);
    assert.equal(calls[0].options.filterByTql, "{需求月份} = '2026-09'");
    await assert.rejects(() => service.listMonthlyDemands("2026-09' OR 1=1"), /月份格式无效/);
  } finally { teable.listAllRecords = original; }
});
