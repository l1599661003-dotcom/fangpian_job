import test from 'node:test';
import assert from 'node:assert/strict';
import { RecruitmentService } from '../dist/modules/recruitment/recruitment.service.js';
import { RecruitmentController } from '../dist/modules/recruitment/recruitment.controller.js';
import { resolveAccessPolicy } from '../dist/modules/database/access.guard.js';
import { teable } from '../dist/platform/teable.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';

const admin = { userId: 'user_a', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], dataScopes: [{ type: 'all', departmentIds: [] }], sensitiveFields: [] };
function fixture(context) {
  const records = new Map(RECRUITMENT_TABLES.map(table => [table.name, []]));
  const keys = ['listFields', 'listAllRecords', 'listByField', 'findOneByField', 'updateRecord', 'createRecord'];
  const original = Object.fromEntries(keys.map(key => [key, teable[key]]));
  context.after(() => Object.assign(teable, original));
  teable.listFields = async table => RECRUITMENT_TABLES.find(item => item.name === table)?.fields || [];
  teable.listAllRecords = async table => records.get(table) || [];
  teable.listByField = async (table, field, value) => (records.get(table) || []).filter(row => row.fields[field] === value);
  teable.findOneByField = async (table, field, value) => (await teable.listByField(table, field, value))[0];
  teable.updateRecord = async (table, id, fields) => { const row = records.get(table).find(item => item.id === id); Object.assign(row.fields, fields); return row; };
  teable.createRecord = async (table, fields) => { const row = { id: `${table}_${records.get(table).length}`, fields }; records.get(table).push(row); return row; };
  records.set('recruitment_users', [{ id: 'user_row', fields: { 用户ID: 'user_a', 用户状态: '启用', 部门IDJSON: '["dept_a"]' } }]);
  records.set('recruitment_organization_units', [
    { id: 'org_a', fields: { 组织单元ID: 'dept_a', 组织名称: '商务', 组织类型: '部门' } },
    { id: 'org_child', fields: { 组织单元ID: 'dept_child', 组织名称: '商务二组', 上级组织单元ID: 'dept_a' } },
    { id: 'org_b', fields: { 组织单元ID: 'dept_b', 组织名称: '技术', 组织类型: '部门' } },
  ]);
  records.set('recruitment_positions', [
    { id: 'row_a', fields: { 职位ID: 'pos_a', 职位名称: '商务开发', 部门ID: 'dept_a', 部门: '商务', 发布状态: '招聘中', 招聘状态: '招聘中', 招聘HR: '招聘甲' } },
    { id: 'row_b', fields: { 职位ID: 'pos_b', 职位名称: '商务开发', 部门ID: 'dept_b', 部门: '商务', 发布状态: '招聘中' } },
    { id: 'row_child', fields: { 职位ID: 'pos_child', 职位名称: '客户经理', 部门ID: 'dept_child', 部门: '商务二组', 发布状态: '已下线', 招聘状态: '暂停招聘' } },
  ]);
  records.set('recruitment_monthly_demands', [{ id: 'demand_a', fields: { 月度需求ID: 'demand_a', 职位ID: 'pos_a', 需求月份: '2026-09', 需求数量: 3, 需求状态: '已确认' } }]);
  records.set('recruitment_applications', [{ id: 'application_a', fields: { 应聘记录ID: 'application_a', 职位ID: 'pos_a', 候选人ID: 'candidate_a', 当前阶段: '已入职' } }]);
  const service = new RecruitmentService({ requireTableId: name => name });
  service.auditAsync = () => {};
  return { service, records };
}

test('department workbench narrows even an administrator to trusted employee departments and preserves hiring metrics', async context => {
  const { service } = fixture(context);
  const result = await service.departmentDemandWorkbench('2026-09', admin);
  assert.deepEqual(result.positions.map(item => item.id), ['pos_a', 'pos_child']);
  assert.equal(result.positions[0].applicantCount, 1);
  assert.equal(result.positions[0].arrived, 1);
  assert.equal(result.positions[0].recruiter, '招聘甲');
  assert.equal(result.demands[0].headcount, 3);
  const restricted = { ...admin, roleCodes: ['business_owner'], dataScopes: [{ type: 'assigned_departments', departmentIds: ['dept_a'] }] };
  assert.deepEqual((await service.departmentDemandWorkbench('2026-09', restricted)).positions.map(item => item.id), ['pos_a']);
  await assert.rejects(() => service.departmentDemandWorkbench('2026-13', admin), /有效/);
});

test('department leaders can see current-month demands in their department subtree only', async context => {
  const { service, records } = fixture(context);
  records.get('recruitment_monthly_demands').push(
    { id: 'demand_child_current', fields: { 月度需求ID: 'demand_child_current', 职位ID: 'pos_child', 需求月份: '2026-09', 需求数量: 2, 需求状态: '待审批' } },
    { id: 'demand_child_previous', fields: { 月度需求ID: 'demand_child_previous', 职位ID: 'pos_child', 需求月份: '2026-08', 需求数量: 1, 需求状态: '已确认' } },
  );
  const leader = {
    ...admin,
    roleCodes: ['department_leader'],
    dataScopes: [{ roleCode: 'department_leader', type: 'assigned_departments', businessUnitId: '', departmentIds: ['dept_a'] }],
  };

  const result = await service.departmentDemandWorkbench('2026-09', leader);

  assert.deepEqual(result.positions.map(item => item.id), ['pos_a', 'pos_child']);
  assert.deepEqual(new Set(result.demands.map(item => item.id)), new Set(['demand_a', 'demand_child_current']));
  assert.ok(result.departments.some(item => item.id === 'dept_child'));
});

test('department mutations reject other departments and pausing retains demands and candidate history', async context => {
  const { service, records } = fixture(context);
  await assert.rejects(() => service.pauseDepartmentDemand('pos_b', '跨部门暂停', '甲', admin), /所属部门/);
  const scope = await service.departmentDemandScope(admin);
  await assert.rejects(() => service.saveMonthlyDemand({ positionId: 'pos_b', month: '2026-09', headcount: 4, note: '跨部门新增' }, admin.userId, scope.profile), /所属部门/);
  await service.pauseDepartmentDemand('pos_a', '本阶段编制满足', '甲', admin);
  assert.equal(records.get('recruitment_positions')[0].fields['招聘状态'], '暂停招聘');
  assert.equal(records.get('recruitment_monthly_demands')[0].fields['需求数量'], 3);
  assert.equal(records.get('recruitment_applications').length, 1);
  assert.equal((await service.pauseDepartmentDemand('pos_a', '重试', '甲', admin)).unchanged, true);
});

test('missing account departments never fall back to all positions', async context => {
  const { service, records } = fixture(context);
  records.get('recruitment_users')[0].fields['部门IDJSON'] = '[]';
  await assert.rejects(() => service.departmentDemandWorkbench('2026-09', admin), /绑定部门/);
});

test('department actions reuse demand permission and controllers use trusted identity', async () => {
  assert.deepEqual(resolveAccessPolicy('POST', '/api/recruitment/department-demands/pos_a/pause').actionsAny, ['create_demand']);
  let saved;
  const controller = new RecruitmentController({ departmentDemandScope: async () => ({ profile: admin }), saveMonthlyDemand: async (...args) => { saved = args; return {}; } }, { getRequestAccess: async () => ({ identity: { userId: 'user_a', userName: '真实员工' }, profile: admin }) });
  await controller.saveDepartmentDemand({}, { positionId: 'pos_a', month: '2026-09', headcount: 2, operator: '冒充其他人', userId: 'user_b' });
  assert.equal(saved[0].operator, '真实员工');
  assert.equal(saved[1], 'user_a');
});
