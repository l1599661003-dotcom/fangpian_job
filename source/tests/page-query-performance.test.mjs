import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { RecruitmentService } from '../dist/modules/recruitment/recruitment.service.js';
import { OffersService } from '../dist/modules/offers/offers.service.js';
import { InterviewsService } from '../dist/modules/interviews/interviews.service.js';
import { QuestionBankService } from '../dist/modules/assessments/question-bank.service.js';
import { RoleAccessService } from '../dist/modules/database/role-access.service.js';
import { TasksService } from '../dist/platform/tasks.js';
import { ResumeApiKeyService } from '../dist/modules/resumes/resume-api-key.service.js';
import { AnalyticsService } from '../dist/modules/analytics/analytics.service.js';
import { invalidateReadTables } from '../dist/platform/read-cache.js';

const database = { requireTableId: name => name, getTableId: name => name };
const row = (id, fields) => ({ id, fields });

test('analytics dashboard and drilldown reuse one dataset, invalidate writes and preserve scope', async () => {
  const original = teable.listAllRecords;
  const positions = [];
  let reads = 0;
  teable.listAllRecords = async table => {
    reads++;
    return table === 'recruitment_positions' ? positions : [];
  };
  try {
    const service = new AnalyticsService(database);
    const all = { roleCodes: ['system_admin'], dataScopes: [{ type: 'all' }] };
    await service.dashboard({}, all);
    const coldReads = reads;
    assert.equal(coldReads, 19);
    await service.drilldown('hc', {}, 1, 50, all);
    await service.dashboard({}, all);
    assert.equal(reads, coldReads);
    positions.push(row('position', { 职位ID: 'position', 部门ID: 'dept_a', 部门: '技术', 职位名称: '工程师', 招聘人数: 2 }));
    invalidateReadTables('recruitment_positions');
    const updated = await service.dashboard({}, all);
    assert.equal(updated.hc.rows.length, 1);
    assert.equal(reads, coldReads * 2);
    const restricted = await service.dashboard({}, { roleCodes: ['recruiter'], dataScopes: [{ type: 'assigned_departments', departmentIds: ['dept_b'] }] });
    assert.equal(restricted.hc.rows.length, 0);
    await assert.rejects(service.dashboard({}, { roleCodes: ['employee'], dataScopes: [] }), /数据范围/);
  } finally { teable.listAllRecords = original; }
});

test('homepage and position reads use the employee department while administrators retain company-wide access', async () => {
  const original = teable.listAllRecords;
  const originalByField = teable.listByField;
  const records = {
    recruitment_positions: [
      row('position_a', { 职位ID: 'position_a', 职位名称: '产品经理', 部门ID: 'dept_a', 部门: '产品部', 发布状态: '招聘中', 招聘状态: '招聘中' }),
      row('position_team_a', { 职位ID: 'position_team_a', 职位名称: '产品运营', 部门ID: 'team_a', 部门: '产品小组', 发布状态: '招聘中', 招聘状态: '招聘中' }),
      row('position_team_b', { 职位ID: 'position_team_b', 职位名称: '产品设计', 部门ID: 'team_b', 部门: '设计小组', 发布状态: '招聘中', 招聘状态: '招聘中' }),
      row('position_legacy_a', { 职位ID: 'position_legacy_a', 职位名称: '产品顾问', 部门ID: 'legacy_dept_a', 部门: '历史产品部门', 发布状态: '招聘中', 招聘状态: '招聘中' }),
      row('position_b', { 职位ID: 'position_b', 职位名称: '运营专员', 部门ID: 'dept_b', 部门: '运营部', 发布状态: '招聘中', 招聘状态: '招聘中' }),
    ],
    recruitment_monthly_demands: [
      row('demand_a', { 需求月份: '2026-09', 需求状态: '进行中', 需求数量: 2, 审批状态: '已通过', 职位ID: 'position_a', 部门: '产品部', 职位名称: '产品经理', 优先级: '紧急' }),
      row('demand_team_a', { 需求月份: '2026-09', 需求状态: '进行中', 需求数量: 1, 审批状态: '已通过', 职位ID: 'position_team_a', 部门: '产品小组', 职位名称: '产品运营', 优先级: '重要' }),
      row('demand_team_b', { 需求月份: '2026-09', 需求状态: '进行中', 需求数量: 4, 审批状态: '已通过', 职位ID: 'position_team_b', 部门: '设计小组', 职位名称: '产品设计', 优先级: '重要' }),
      row('demand_legacy_a', { 需求月份: '2026-09', 需求状态: '进行中', 需求数量: 1, 审批状态: '已通过', 职位ID: 'position_legacy_a', 部门: '历史产品部门', 职位名称: '产品顾问', 优先级: '储备' }),
      row('demand_b', { 需求月份: '2026-09', 需求状态: '进行中', 需求数量: 1, 审批状态: '已通过', 职位ID: 'position_b', 部门: '运营部', 职位名称: '运营专员', 优先级: '重要' }),
    ],
    recruitment_organization_units: [
      row('root', { 组织单元ID: 'root', 组织名称: '方片', 组织状态: '启用' }),
      row('dept_a', { 组织单元ID: 'dept_a', 组织名称: '产品部', 上级组织单元ID: 'root', 组织状态: '启用' }),
      row('team_a', { 组织单元ID: 'team_a', 组织名称: '产品小组', 上级组织单元ID: 'dept_a', 组织状态: '启用' }),
      row('team_b', { 组织单元ID: 'team_b', 组织名称: '设计小组', 上级组织单元ID: 'dept_a', 组织状态: '启用' }),
      row('legacy_dept_a', { 组织单元ID: 'legacy_dept_a', 组织名称: '产品部', 上级组织单元ID: 'root', 组织状态: '停用' }),
      row('dept_b', { 组织单元ID: 'dept_b', 组织名称: '运营部', 上级组织单元ID: 'root', 组织状态: '启用' }),
      row('hq', { 组织单元ID: 'hq', 组织名称: '总经办', 上级组织单元ID: 'root', 组织状态: '启用' }),
    ],
  };
  teable.listAllRecords = async table => records[table] || [];
  teable.listByField = async (table, field, value) => table === 'recruitment_users' && field === '用户ID'
    ? [row(`employee_${value}`, { 用户ID: value, 用户状态: '启用', 部门IDJSON: '["team_a"]', 部门JSON: '["产品小组"]' })]
    : [];
  try {
    const service = new RecruitmentService(database);
    const leaderProfile = { userId: 'leader-a', roleCodes: ['department_leader'], dataScopes: [{ roleCode: 'department_leader', type: 'assigned_departments', departmentIds: ['hq'] }] };
    const leaderBoard = await service.monthlyHiring('2026-09', leaderProfile);
    assert.equal(leaderBoard.departments.length, 3);
    assert.equal(leaderBoard.summary.demand, 4);
    assert.deepEqual(leaderBoard.departments.map(item => item.department).sort(), ['产品小组', '产品部', '历史产品部门']);

    const employeeProfile = { userId: 'employee-a', roleCodes: ['business_manager'], dataScopes: [{ roleCode: 'business_manager', type: 'assigned_departments', departmentIds: ['hq'] }] };
    const employeeBoard = await service.monthlyHiring('2026-09', employeeProfile);
    assert.equal(employeeBoard.departments.length, 3);
    assert.equal(employeeBoard.summary.demand, 4);

    const catalog = await service.positionCatalog(employeeProfile);
    assert.deepEqual(catalog.positions.map(item => item.id).sort(), ['position_a', 'position_legacy_a', 'position_team_a']);
    const demands = await service.listMonthlyDemands('2026-09', '', employeeProfile);
    assert.deepEqual(demands.demands.map(item => item.positionId).sort(), ['position_a', 'position_legacy_a', 'position_team_a']);
    assert.equal((await service.positionOptions(employeeProfile)).positions.length, 3);

    const adminProfile = { userId: 'admin', roleCodes: ['system_admin'], dataScopes: [{ roleCode: 'system_admin', type: 'all', departmentIds: [] }] };
    assert.equal((await service.positionCatalog(adminProfile)).positions.length, records.recruitment_positions.length);
    assert.equal((await service.monthlyHiring('2026-09', adminProfile)).summary.demand, 9);
  } finally {
    teable.listAllRecords = original;
    teable.listByField = originalByField;
  }
});

test('homepage summary excludes resume OCR and candidate biographies while retaining HR and totals', async () => {
  const original = teable.listAllRecords;
  const calls = [];
  const records = {
    recruitment_positions: [row('position', { 职位ID: 'position', 职位名称: '工程师', 部门: '技术', 发布状态: '招聘中', 招聘HR: 'HR甲' })],
    recruitment_monthly_demands: [row('demand', { 职位ID: 'position', 需求月份: '2026-09', 需求数量: 2 })],
    recruitment_candidates: [row('candidate', { 候选人ID: 'candidate', 姓名: '甲', 天玑入职日期: '2026-09-20', 工作经历: 'heavy'.repeat(10000) })],
    recruitment_applications: [row('application', { 候选人ID: 'candidate', 职位ID: 'position', 当前阶段: '已入职' })],
    resume_extraction_records: [row('resume', { 候选人ID: 'candidate', 解析状态: '已完成', 创建时间: '2026-09-20', OCR原文: 'heavy'.repeat(10000) })],
  };
  teable.listAllRecords = async (table, options = {}) => {
    calls.push({ table, options });
    return (records[table] || []).map(record => options.fields ? { ...record, fields: Object.fromEntries(options.fields.map(field => [field, record.fields[field]])) } : record);
  };
  try {
    const service = new RecruitmentService(database);
    const result = await service.monthlyHiring('2026-09');
    assert.equal(result.summary.resumes, 1);
    assert.equal(result.summary.arrived, 1);
    assert.equal(result.departments[0].recruiter, 'HR甲');
    for (const table of ['recruitment_candidates', 'resume_extraction_records']) {
      assert.ok(calls.find(call => call.table === table).options.fields.length <= 4);
    }
    assert.match(calls.find(call => call.table === 'recruitment_monthly_demands').options.filterByTql, /2026-09/);
  } finally { teable.listAllRecords = original; }
});

test('Offer history only hydrates referenced candidates and never initializes templates', async () => {
  const original = teable.listAllRecords;
  const calls = [];
  teable.listAllRecords = async (table, options = {}) => {
    calls.push({ table, options });
    if (table === 'recruitment_offers') return [row('offer', { OfferID: 'offer', 候选人ID: 'chosen', Offer状态: '待审批' })];
    assert.equal(table, 'recruitment_candidates');
    assert.match(options.filterByTql, /chosen/);
    assert.deepEqual(options.fields, ['候选人ID', '姓名', '邮箱']);
    return [row('candidate', { 候选人ID: 'chosen', 姓名: '甲', 邮箱: 'test@example.test' })];
  };
  try {
    const service = new OffersService(database, {});
    service.ensureTemplates = () => { throw new Error('history must not initialize templates'); };
    assert.equal((await service.list({})).offers[0].candidateName, '甲');
    calls.length = 0;
    assert.equal((await service.list({ status: '已拒绝' })).total, 0);
    assert.equal(calls.length, 1);
  } finally { teable.listAllRecords = original; }
});

test('interview calendar hydrates only visible candidates in the selected date range', async () => {
  const original = teable.listAllRecords;
  teable.listAllRecords = async (table, options = {}) => {
    if (table === 'recruitment_interviews') return [
      row('mine', { 面试ID: 'mine', 候选人ID: 'visible', 面试官用户IDJSON: '["me"]', 开始时间: '2026-09-29', 结束时间: '2026-09-29' }),
      row('other', { 面试ID: 'other', 候选人ID: 'hidden', 面试官用户IDJSON: '["other"]', 开始时间: '2026-09-29', 结束时间: '2026-09-29' }),
      row('old', { 面试ID: 'old', 候选人ID: 'old', 面试官用户IDJSON: '["me"]', 开始时间: '2026-08-29', 结束时间: '2026-08-29' }),
    ];
    if (table === 'recruitment_candidates') {
      assert.match(options.filterByTql, /visible/);
      assert.doesNotMatch(options.filterByTql, /hidden|old/);
      return [row('candidate', { 候选人ID: 'visible', 姓名: '甲' })];
    }
    return [];
  };
  try {
    const service = new InterviewsService(database);
    service.listInterviewers = async () => ({ interviewers: [] });
    const result = await service.listAppointments({ from: '2026-09-01', to: '2026-09-30' }, { all: false, userIds: ['me'] });
    assert.equal(result.total, 1);
    assert.equal(result.appointments[0].candidateName, '甲');
  } finally { teable.listAllRecords = original; }
});

test('question bank skips lifecycle scans when there are no accessible positions', async () => {
  const original = teable.listAllRecords;
  const calls = [];
  teable.listAllRecords = async table => { calls.push(table); return []; };
  try {
    const result = await new QuestionBankService(database).list([], 'me', {});
    assert.deepEqual(result.feedbackJobs, []);
    assert.deepEqual(calls, ['recruitment_question_bank']);
  } finally { teable.listAllRecords = original; }
});

test('request access reuse never persists login identity into the next HTTP request', async () => {
  const original = teable.findOneByField;
  let enabled = true, reads = 0;
  teable.findOneByField = async table => {
    reads++;
    return table === 'recruitment_login_sessions'
      ? row('session', { 用户ID: 'me', 会话状态: '有效', 过期时间: '2099-01-01' })
      : row('account', { 用户状态: enabled ? '启用' : '停用' });
  };
  try {
    const service = new RoleAccessService(database);
    service.getUserAccess = async () => ({ userId: 'me', pages: [], actions: [], roleCodes: [], dataScopes: [] });
    const headers = { cookie: 'rf_session=test-token' };
    const result = await service.getRequestAccess(headers);
    service.rememberRequestAccess(headers, result);
    assert.equal((await service.getRequestAccess(headers)).identity.userId, 'me');
    assert.equal(reads, 2);
    enabled = false;
    assert.equal(await service.getRequestAccess({ ...headers }), null);
    assert.equal(reads, 4);
  } finally { teable.findOneByField = original; }
});

test('scheduled task dashboard requests the latest 50 runs in parallel with task configuration', async () => {
  const original = teable.listRecords;
  const calls = [];
  let releaseTasks;
  teable.listRecords = async (table, options) => {
    calls.push({ table, options });
    if (table === 'tasks') return new Promise(resolve => { releaseTasks = () => resolve([]); });
    releaseTasks();
    return [row('latest', { TaskName: 'new', StartedAt: '2026-09-29' }), row('previous', { TaskName: 'old', StartedAt: '2026-09-28' })];
  };
  try {
    const service = new TasksService({});
    service.tasksTableId = 'tasks'; service.runsTableId = 'runs';
    const result = await service.listForDashboard();
    assert.deepEqual(calls[1].options, { take: 50, orderBy: [{ field: 'StartedAt', order: 'desc' }] });
    assert.deepEqual(result.recentRuns.map(run => run.task), ['new', 'old']);
  } finally { teable.listRecords = original; }
});

test('developer config reads existing API settings only once without generating a key', async () => {
  const originals = { listFields: teable.listFields, listAllRecords: teable.listAllRecords };
  let reads = 0;
  teable.listFields = async () => ['配置名称', 'API Key', '状态', '创建时间', '更新时间'].map(name => ({ name }));
  teable.listAllRecords = async () => { reads++; return [row('settings', { 状态: 'active', 'API Key': 'test-only' })]; };
  try {
    const service = new ResumeApiKeyService(database);
    service.createKey = () => { throw new Error('must preserve current key'); };
    assert.equal((await service.getConfig()).apiKey, 'test-only');
    assert.equal(reads, 1);
  } finally { Object.assign(teable, originals); }
});
