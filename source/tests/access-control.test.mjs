import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { RECRUITMENT_TABLES, SYSTEM_ROLE_TEMPLATES } from '../dist/modules/database/database.schema.js';
import { RoleAccessService } from '../dist/modules/database/role-access.service.js';
import { AccessAdminService } from '../dist/modules/database/access-admin.service.js';
import { DatabaseService } from '../dist/modules/database/database.service.js';
import { AccessController } from '../dist/modules/database/access.controller.js';
import { TalentsService } from '../dist/modules/talents/talents.service.js';
import { MessagesService } from '../dist/modules/messages/messages.service.js';
import { AccessGuard, resolveAccessPolicy } from '../dist/modules/database/access.guard.js';
import { AccessAuditInterceptor } from '../dist/modules/database/access-audit.interceptor.js';
import { wecom } from '../dist/platform/mcp.js';
import { defer, lastValueFrom, of, throwError } from 'rxjs';
import { jobs, jobAccessContext } from '../dist/platform/jobs.js';
import { ReferralsService } from '../dist/modules/referrals/referrals.service.js';
import { ReferralsController } from '../dist/modules/referrals/referrals.controller.js';

function installMemory() {
  const definitions = new Map(RECRUITMENT_TABLES.map((table) => [table.name, table]));
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const originals = {}, methods = ['countRecords', 'listFields', 'listRecords', 'findOneByField', 'createRecord', 'createRecords', 'updateRecord', 'deleteRecord'];
  for (const method of methods) originals[method] = teable[method];
  let sequence = 0;
  teable.countRecords = async tableId => (records.get(tableId) || []).length;
  teable.listFields = async (tableId) => (definitions.get(tableId)?.fields || []).map((field, index) => ({ id: `${tableId}_field_${index}`, name: field.name, type: field.type }));
  teable.listRecords = async (tableId, options) => [...(records.get(tableId) || [])].slice(options?.skip || 0, (options?.skip || 0) + (options?.take || 1000));
  teable.findOneByField = async (tableId, field, value) => records.get(tableId)?.find(row => String(row.fields[field] || '') === String(value));
  teable.createRecord = async (tableId, fields) => {
    const row = { id: `${tableId}_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() };
    records.get(tableId).push(row);
    return row;
  };
  teable.createRecords = async (tableId, rows) => Promise.all(rows.map((fields) => teable.createRecord(tableId, fields)));
  teable.updateRecord = async (tableId, recordId, fields) => {
    const row = records.get(tableId).find((item) => item.id === recordId);
    if (!row) throw new Error(`record missing ${tableId}/${recordId}`);
    row.fields = { ...row.fields, ...fields };
    return row;
  };
  teable.deleteRecord = async () => {};
  return { records, restore: () => Object.assign(teable, originals) };
}

async function seedAccessData(memory) {
  const create = teable.createRecord;
  for (const role of SYSTEM_ROLE_TEMPLATES) await create('recruitment_roles', {
    角色编码: role.code, 角色名称: role.name, 角色层级: role.level, 数据范围类型: role.dataScope,
    页面权限JSON: JSON.stringify(role.pages), 操作权限JSON: JSON.stringify(role.actions),
    敏感字段策略JSON: JSON.stringify(role.sensitiveFields), 角色状态: '启用',
  });
  const bindings = [
    ['admin_1', '系统管理员', 'system_admin', '', []],
    ['recruiter_a', 'A部门招聘专员', 'business_manager', 'bu_1', ['dept_a']],
    ['hrbp_1', '业务HRBP', 'hrbp', 'bu_1', ['dept_a', 'dept_b']],
    ['manager_b', 'B部门负责人', 'business_manager', 'bu_1', ['dept_b']],
    ['interviewer_1', '面试官一', 'interviewer', 'bu_1', []],
    ['ai_1', 'AI运营', 'ai_operations', '', []],
  ];
  for (const [userId, userName, roleCode, businessUnitId, departmentIds] of bindings) await create('recruitment_user_roles', {
    用户角色ID: `binding_${userId}`, 用户ID: userId, 用户姓名: userName, 角色编码: roleCode,
    事业部ID: businessUnitId, 部门IDJSON: JSON.stringify(departmentIds), 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z',
  });
  await create('recruitment_user_roles', { 用户角色ID: 'expired_binding', 用户ID: 'recruiter_a', 角色编码: 'system_admin', 绑定状态: '启用', 失效时间: '2026-08-01T00:00:00.000Z' });
  await create('recruitment_positions', { 职位ID: 'pos_a', 职位名称: '产品经理', 部门ID: 'dept_a', 部门: '产品部', 招聘人数: 2, 已到岗人数: 1, 招聘状态: '招聘中', 发布状态: '招聘中' });
  await create('recruitment_positions', { 职位ID: 'pos_b', 职位名称: '运营经理', 部门ID: 'dept_b', 部门: '运营部', 招聘人数: 3, 已到岗人数: 0, 招聘状态: '招聘中', 发布状态: '招聘中' });
  await create('recruitment_positions', { 职位ID: 'position_a', 需求ID: 'demand_a', 职位名称: '产品经理', 部门ID: 'dept_a', 部门: '产品部' });
  await create('recruitment_positions', { 职位ID: 'position_b', 需求ID: 'demand_b', 职位名称: '运营经理', 部门ID: 'dept_b', 部门: '运营部' });
  await create('recruitment_candidates', { 候选人ID: 'talent_a', 姓名: '林悦', 电话: '13800138001', 邮箱: 'linyue@example.com', 微信: 'linyue_pm', 候选人状态: '约面', 人才池: '公司人才库', 合并状态: '独立档案', 最新简历记录ID: 'resume_a', 创建时间: '2026-08-20T00:00:00.000Z', 更新时间: '2026-08-20T00:00:00.000Z' });
  await create('recruitment_candidates', { 候选人ID: 'talent_b', 姓名: '陈晨', 电话: '13900139002', 邮箱: 'chenchen@example.com', 微信: 'chen_ops', 候选人状态: '负责人审查', 人才池: '公司人才库', 合并状态: '独立档案', 最新简历记录ID: 'resume_b', 创建时间: '2026-08-21T00:00:00.000Z', 更新时间: '2026-08-21T00:00:00.000Z' });
  await create('resume_extraction_records', { 解析记录ID: 'resume_a', 候选人ID: 'talent_a', 源文件名: '林悦.pdf', 源文件地址: 'https://files.example.test/linyue.pdf', OCR原文: '林悦 13800138001 linyue@example.com 微信linyue_pm' });
  await create('resume_extraction_records', { 解析记录ID: 'resume_b', 候选人ID: 'talent_b', 源文件名: '陈晨.pdf', 源文件地址: 'https://files.example.test/chenchen.pdf', OCR原文: '陈晨 13900139002 chenchen@example.com 微信chen_ops' });
  await create('recruitment_applications', { 应聘记录ID: 'app_a', 候选人ID: 'talent_a', 职位ID: 'position_a', 需求ID: 'demand_a', 负责人用户ID: 'recruiter_a', 当前阶段: '约面', 当前状态: '进行中', 更新时间: '2026-08-25T00:00:00.000Z' });
  await create('recruitment_applications', { 应聘记录ID: 'app_b', 候选人ID: 'talent_b', 职位ID: 'position_b', 需求ID: 'demand_b', 负责人用户ID: 'recruiter_b', 当前阶段: '负责人审查', 当前状态: '进行中', 更新时间: '2026-08-25T00:00:00.000Z' });
  await create('recruitment_interviews', { 面试ID: 'interview_a', 候选人ID: 'talent_a', 应聘记录ID: 'app_a', 面试官用户IDJSON: JSON.stringify(['interviewer_1']), 面试状态: '已预约' });
  return memory;
}

test('employee session stays valid until logout and never falls back to platform owner identity', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: name => name, requireTableId: name => name };
    const access = new RoleAccessService(database);
    const account = await teable.createRecord('recruitment_users', { 用户ID: 'employee', 姓名: '测试员工', 手机: '13800138099', 用户状态: '启用' });
    const login = await access.loginWithEmployeeProfile({ name: '测试员工', mobile: '13800138099' }, {});
    const headers = { cookie: `rf_session=${login.token}`, 'x-studio-user-id': 'admin_1' };
    assert.equal((await access.resolveRequestIdentity(headers)).userId, 'employee');
    const session = memory.records.get('recruitment_login_sessions')[0];
    for (const expiry of ['', 'invalid', '2020-01-01T00:00:00Z']) {
      session.fields['过期时间'] = expiry;
      assert.equal((await access.resolveRequestIdentity(headers)).userId, 'employee');
    }
    session.fields['过期时间'] = login.expiresAt;
    session.fields['会话状态'] = '已退出';
    assert.equal(await access.resolveRequestIdentity(headers), null);
    session.fields['会话状态'] = '有效';
    account.fields['用户状态'] = '停用';
    assert.equal(await access.resolveRequestIdentity(headers), null);
    await assert.rejects(() => access.getRequestAccess({ 'x-studio-user-id': 'employee' }), /未启用/);
    account.fields['用户状态'] = '启用';
    await access.logoutSession(headers);
    assert.equal(await access.resolveRequestIdentity(headers), null);
    assert.equal(await access.resolveRequestIdentity({ ...headers, cookie: 'rf_session=unknown' }), null);
  } finally { memory.restore(); }
});

test('authenticated session checks renew the persistent http-only cookie', async () => {
  const cookies = [];
  const access = {
    async resolveRequestIdentity() { return { userId: 'employee', userName: '测试员工', source: 'session' }; },
    sessionTokenForCookie() { return 'session-token'; },
    async getUserAccess() { return { userId: 'employee', roleCodes: ['employee'], pages: ['home'], actions: [], dataScopes: [], sensitiveFields: [] }; },
    async auditAccess() {},
    async recordLoginHeartbeat(headers) { return { recorded: Boolean(headers.cookie) }; },
  };
  const administration = { async account() { return { id: 'employee', name: '测试员工', mobile: '13800138000', status: '启用' }; } };
  const controller = new AccessController(access, administration);
  const response = { cookie: (...args) => cookies.push(args) };

  const result = await controller.me({}, { headers: {} }, response);

  assert.equal(result.authenticated, true);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0][0], 'rf_session');
  assert.equal(cookies[0][1], 'session-token');
  assert.equal(cookies[0][2].httpOnly, true);
  assert.equal(cookies[0][2].secure, false);
  assert.equal(cookies[0][2].expires.getTime(), Date.parse('2099-12-31T23:59:59.999Z'));
  assert.equal((await controller.heartbeat({ cookie: 'rf_session=session-token' })).recorded, true);
});

test('session cookies follow the request protocol so HTTP login survives identity checks', async () => {
  const cookies = [];
  const access = {
    async loginWithEmployeeProfile() {
      return { token: 'http-session-token', expiresAt: '2099-12-31T23:59:59.999Z', identity: { userId: 'employee', userName: '测试员工', source: 'session' } };
    },
  };
  const controller = new AccessController(access, {});
  const response = { cookie: (...args) => cookies.push(args) };

  const httpRequest = { headers: {}, secure: false, ip: '', socket: { remoteAddress: '' } };
  const httpsRequest = { headers: { 'x-forwarded-proto': 'https' }, secure: false, ip: '', socket: { remoteAddress: '' } };
  await controller.login({}, httpRequest, response);
  await controller.login({}, httpsRequest, response);

  assert.equal(cookies[0][2].secure, false);
  assert.equal(cookies[1][2].secure, true);
});

test('login heartbeat refreshes employee sessions and stores Studio SSO activity once per employee', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: name => name, requireTableId: name => name };
    const access = new RoleAccessService(database);
    await teable.createRecord('recruitment_users', { 用户ID: 'employee_session', 姓名: '会话员工', 手机: '13800138098', 用户状态: '启用' });
    await teable.createRecord('recruitment_users', { 用户ID: 'employee_sso', 姓名: '单点员工', 用户状态: '启用' });
    const login = await access.loginWithEmployeeProfile({ name: '会话员工', mobile: '13800138098' }, {});
    const sessionHeaders = { cookie: `rf_session=${login.token}` };
    const session = memory.records.get('recruitment_login_sessions').find(row => row.fields['用户ID'] === 'employee_session');
    session.fields['最近访问时间'] = '2020-01-01T00:00:00.000Z';

    const sessionResult = await access.recordLoginHeartbeat(sessionHeaders);
    assert.equal(sessionResult.recorded, true);
    assert.ok(Date.parse(session.fields['最近访问时间']) > Date.parse('2020-01-01T00:00:00.000Z'));
    assert.equal(session.fields['过期时间'], '2099-12-31T23:59:59.999Z');
    assert.equal(session.fields['身份来源'], 'session');

    const studioHeaders = { 'x-studio-user-id': 'employee_sso', 'x-studio-user-name': '单点员工' };
    await access.recordLoginHeartbeat(studioHeaders);
    await access.recordLoginHeartbeat(studioHeaders);
    const studioSessions = memory.records.get('recruitment_login_sessions').filter(row => row.fields['用户ID'] === 'employee_sso');
    assert.equal(studioSessions.length, 1);
    assert.equal(studioSessions[0].fields['身份来源'], 'studio');
    assert.equal(studioSessions[0].fields['会话状态'], '有效');
  } finally { memory.restore(); }
});

test('login activity aggregates sessions by employee and applies the online time window', async () => {
  const memory = installMemory();
  try {
    const asOf = new Date('2026-10-09T12:00:00.000Z');
    await teable.createRecord('recruitment_users', { 用户ID: 'employee_online', 姓名: '在线员工', 部门IDJSON: JSON.stringify(['dept_child']), 用户状态: '启用' });
    await teable.createRecord('recruitment_users', { 用户ID: 'employee_offline', 姓名: '离线员工', 部门JSON: JSON.stringify(['财务部']), 用户状态: '启用' });
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_parent', 组织名称: '中台', 上级组织单元ID: '', 组织状态: '启用' });
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_child', 组织名称: '技术部', 上级组织单元ID: 'dept_parent', 组织状态: '启用' });
    await teable.createRecord('recruitment_login_sessions', { 用户ID: 'employee_online', 用户姓名: '在线员工', 会话状态: '有效', 创建时间: '2026-10-01T12:00:00.000Z', 最近访问时间: '2026-10-09T11:59:00.000Z' });
    await teable.createRecord('recruitment_login_sessions', { 用户ID: 'employee_online', 用户姓名: '在线员工', 会话状态: '已退出', 创建时间: '2026-10-02T12:00:00.000Z', 最近访问时间: '2026-10-09T11:50:00.000Z' });
    await teable.createRecord('recruitment_login_sessions', { 用户ID: 'employee_offline', 用户姓名: '离线员工', 会话状态: '有效', 创建时间: '2026-10-01T12:00:00.000Z', 最近访问时间: '2026-10-09T11:55:00.000Z' });
    const administration = new AccessAdminService({ getTableId: name => name, requireTableId: name => name }, {});

    const activity = await administration.loginActivity(asOf);

    assert.equal(activity.loggedInUserCount, 2);
    assert.equal(activity.onlineUserCount, 1);
    assert.equal(activity.onlineUsers[0].name, '在线员工');
    assert.equal(activity.onlineUsers[0].department, '中台 / 技术部');
    assert.equal(activity.loggedInUsers.find(user => user.userId === 'employee_offline').isOnline, false);
  } finally { memory.restore(); }
});

test('role permission changes invalidate cached and in-flight access and disabled roles grant nothing', async () => {
  const memory = await seedAccessData(installMemory());
  const originalList = teable.listByAnyField;
  try {
    const database = { getTableId: name => name, requireTableId: name => name };
    const access = new RoleAccessService(database), administration = new AccessAdminService(database, access);
    await access.getUserAccess('admin_1');
    await administration.updateRolePermissions('system_admin', { pages: ['referrals'], actions: ['view_referrals'] });
    assert.deepEqual((await access.getUserAccess('admin_1')).pages, ['referrals']);
    access.invalidateRoleMetadata();
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    teable.listByAnyField = async (...args) => {
      const snapshot = structuredClone(await originalList.apply(teable, args));
      entered();
      await new Promise(resolve => { release = resolve; });
      return snapshot;
    };
    const pending = access.getUserAccess('admin_1');
    const concurrent = access.getUserAccess('admin_1');
    await waiting;
    teable.listByAnyField = originalList;
    const role = memory.records.get('recruitment_roles').find(row => row.fields['角色编码'] === 'system_admin');
    role.fields['角色状态'] = '停用';
    access.invalidateRoleMetadata();
    release();
    const profile = await pending;
    assert.deepEqual(profile.roleCodes, []);
    assert.deepEqual(profile.pages, []);
    assert.deepEqual(profile.dataScopes, []);
    assert.deepEqual((await concurrent).pages, []);
    assert.deepEqual((await access.getUserAccess('admin_1')).actions, []);
  } finally { teable.listByAnyField = originalList; memory.restore(); }
});

test('custom roles support creation editing disabling and re-enabling', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: name => name, requireTableId: name => name };
    const access = new RoleAccessService(database);
    const administration = new AccessAdminService(database, access);
    await administration.createRole({
      code: 'referral_support',
      name: '内推支持',
      description: '负责维护内推活动。',
      level: 'L2',
      dataScope: 'self',
      pages: ['referrals'],
      actions: ['manage_referrals'],
      sensitiveFields: { salary: 'hidden' },
      operator: '管理员',
      operatorUserId: 'admin_1',
    });
    await teable.createRecord('recruitment_users', { 用户ID: 'support_user', 姓名: '内推支持', 用户状态: '启用' });
    await teable.createRecord('recruitment_user_roles', { 用户ID: 'support_user', 用户姓名: '内推支持', 角色编码: 'referral_support', 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z' });
    let profile = await access.getUserAccess('support_user');
    assert.deepEqual(profile.roleCodes, ['referral_support']);
    assert.deepEqual(profile.pages, ['referrals']);
    assert.deepEqual(profile.actions, ['manage_referrals']);

    await administration.updateRole('referral_support', { name: '内推运营', description: '负责内推活动运营。', level: 'L3', dataScope: 'assigned_departments', operator: '管理员', operatorUserId: 'admin_1' });
    let administrationData = await administration.administration();
    let managedRole = administrationData.roles.find(role => role.code === 'referral_support');
    assert.equal(managedRole.name, '内推运营');
    assert.equal(managedRole.level, 'L3');
    assert.equal(managedRole.dataScope, 'assigned_departments');
    assert.equal(managedRole.system, false);

    await administration.updateRoleStatus('referral_support', '停用', { operator: '管理员', operatorUserId: 'admin_1' });
    profile = await access.getUserAccess('support_user');
    assert.deepEqual(profile.roleCodes, []);
    administrationData = await administration.administration();
    assert.equal(administrationData.roles.find(role => role.code === 'referral_support').status, '停用');

    await administration.updateRoleStatus('referral_support', '启用', { operator: '管理员', operatorUserId: 'admin_1' });
    profile = await access.getUserAccess('support_user');
    assert.deepEqual(profile.roleCodes, ['referral_support']);

    const databaseService = new DatabaseService();
    databaseService.tableIds.set('recruitment_roles', 'recruitment_roles');
    await databaseService.seedSystemRoles();
    administrationData = await administration.administration();
    assert.equal(administrationData.roles.find(role => role.code === 'referral_support').status, '启用');

    await assert.rejects(() => administration.updateRoleStatus('system_admin', '停用'), /超级管理员角色不能停用/);
    await assert.rejects(() => administration.createRole({ code: 'referral_support', name: '重复角色', pages: ['referrals'], actions: ['manage_referrals'] }), /角色编码已存在/);
  } finally { memory.restore(); }
});

test('referrer-only authorization denies every other module and reward administration', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    await teable.createRecord('recruitment_users', { 用户ID: 'employee', 用户状态: '启用' });
    await teable.createRecord('recruitment_user_roles', { 用户ID: 'employee', 角色编码: 'referrer', 绑定状态: '启用' });
    const database = { getTableId: name => name, requireTableId: name => name };
    const access = new RoleAccessService(database), guard = new AccessGuard(access);
    const check = (method, path) => guard.canActivate({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method, path, headers: { 'x-studio-user-id': 'employee' } }) }) });
    assert.deepEqual((await access.getUserAccess('employee')).pages, ['referrals']);
    await assert.rejects(() => check('POST', '/api/interviews/wecom/authorization-notice'), /没有页面权限|没有操作权限/);
    for (const path of ['/api/recruitment/overview', '/api/recruitment/positions', '/api/recruitment/department-demands', '/api/talents', '/api/interviews/appointments', '/api/interview-evaluations/workbench', '/api/assessments/bank', '/api/offers', '/api/resumes', '/api/resumes/api-config', '/api/studio-tasks', '/api/analytics', '/api/access/administration', '/api/messages', '/api/governance', '/api/background-checks', '/api/employee-lifecycle', '/api/health/system', '/api/unknown']) {
      for (const method of ['GET', 'POST', 'DELETE']) await assert.rejects(() => check(method, path), /没有页面权限|没有操作权限/, `${method} ${path}`);
    }
    for (const path of ['/api/referrals', '/api/referrals/campaigns', '/api/referrals/positions', '/api/referrals/analytics', '/api/referrals/reward-rules', '/api/recruitment/referral-poster-order']) assert.equal(await check('GET', path), true);
    assert.deepEqual(resolveAccessPolicy('GET', '/api/recruitment/referral-poster-order').pagesAny, ['referrals']);
    assert.equal(await check('POST', '/api/referrals/campaigns'), true);
    for (const path of ['/api/referrals/reward-rules', '/api/referrals/one/validity', '/api/referrals/one/evaluate-rewards', '/api/referrals/rewards/one/pay']) await assert.rejects(() => check('POST', path), /个人内推权限/);
    assert.equal(resolveAccessPolicy('GET', '/api/interview-evaluations/publicity').public, undefined);
    assert.equal(resolveAccessPolicy('POST', '/api/health/database/retry').public, undefined);
  } finally { memory.restore(); }
});

test('job results require their initiating identity and current original permissions', async () => {
  const profile = { pages: ['candidates'], actions: ['edit_candidate'], dataScopes: [] };
  let userId = 'owner';
  const access = { rememberRequestAccess: () => {}, getRequestAccess: async () => ({ identity: { userId }, profile }), hasPage: (value, page) => value.pages.includes(page), hasAction: (value, action) => value.actions.includes(action) };
  const guard = new AccessGuard(access);
  const jobId = jobAccessContext.run({ userId: 'owner', pagesAny: ['candidates'], actionsAny: ['edit_candidate'] }, () => jobs.start(async () => ({ confidential: true })));
  const context = id => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method: 'GET', path: `/api/jobs/${id}`, headers: {} }) }) });
  assert.equal(await guard.canActivate(context(jobId)), true);
  userId = 'other';
  await assert.rejects(() => guard.canActivate(context(jobId)), /其他用户/);
  userId = 'owner';
  profile.pages = ['referrals'];
  await assert.rejects(() => guard.canActivate(context(jobId)), /页面权限已被收回/);
  profile.pages = ['candidates']; profile.actions = [];
  await assert.rejects(() => guard.canActivate(context(jobId)), /操作权限已被收回/);
  const systemJob = jobs.start(async () => ({}));
  await assert.rejects(() => guard.canActivate(context(systemJob)), /系统后台任务/);
  const publicJob = jobs.start(async () => ({ status: 'submitted' }), { publicPolling: true });
  assert.equal(await guard.canActivate(context(publicJob)), true);
});

test('request interceptor preserves independent job owners through asynchronous subscriptions', async () => {
  const interceptor = new AccessAuditInterceptor({});
  const launch = userId => {
    const request = { method: 'GET', path: '/api/recruitment/positions', recruitmentAccess: { identity: { userId }, profile: {} }, recruitmentAccessPolicy: { pagesAny: ['positions'], actionsAny: ['manage_positions'] } };
    const context = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }) };
    return lastValueFrom(interceptor.intercept(context, { handle: () => defer(async () => { await Promise.resolve(); return jobs.start(async () => ({ userId })); }) }));
  };
  const [first, second] = await Promise.all([launch('first'), launch('second')]);
  assert.equal(jobs.getAccess(first).userId, 'first');
  assert.equal(jobs.getAccess(second).userId, 'second');
  assert.deepEqual(jobs.getAccess(first).pagesAny, ['positions']);
  assert.equal(jobAccessContext.getStore(), undefined);
});

test('referral lists, campaigns, statistics and campaign identity are server scoped', async () => {
  const memory = installMemory();
  try {
    const database = { getTableId: name => name, requireTableId: name => name };
    const service = new ReferralsService(database, {});
    const scope = { userId: 'self', name: '本人', mobile: '13800138000' };
    await teable.createRecord('recruitment_users', { 用户ID: 'self', 姓名: scope.name, 手机: scope.mobile, 用户状态: '启用' });
    for (const [id, owner, name, phone] of [['mine', 'self', '本人', scope.mobile], ['legacy', '', '本人', scope.mobile], ['other', 'other', '本人', scope.mobile], ['same-name', '', '本人', '13900139000']]) {
      const fields = { 推荐人用户ID: owner, 推荐人: name, 推荐人手机号: phone, 内推记录ID: id, 内推活动ID: id, 有效性结论: '有效' };
      await teable.createRecord('recruitment_referrals', fields);
      await teable.createRecord('recruitment_referral_campaigns', fields);
      await teable.createRecord('recruitment_referral_rewards', { 内推记录ID: id, 发放状态: '已发放', 实发金额: 100 });
    }
    assert.deepEqual((await service.list(scope)).referrals.map(row => row.id), ['mine', 'legacy']);
    assert.deepEqual((await service.campaigns(scope)).campaigns.map(row => row.id), ['mine', 'legacy']);
    const analytics = await service.analytics(scope);
    assert.equal(analytics.total, 2); assert.equal(analytics.rewardPaid, 200); assert.equal(analytics.byCampaign.length, 2);
    assert.equal((await service.list()).referrals.length, 4);
    let saved;
    const controller = new ReferralsController({ createCampaign: async body => { saved = body; return body; } }, database);
    await controller.campaign({ recruitmentAccess: { identity: { userId: 'self', userName: '本人' }, profile: { actions: ['manage_referrals'], dataScopes: [{ type: 'self' }] } } }, { referrerUserId: 'other', referrerName: '冒充他人', referrerMobile: '13900139000', operatorUserId: 'admin' });
    assert.equal(saved.referrerUserId, 'self'); assert.equal(saved.referrerName, '本人'); assert.equal(saved.referrerMobile, scope.mobile); assert.equal(saved.operatorUserId, 'self');
    await teable.createRecord('recruitment_referral_campaigns', { 内推活动ID: 'conflicting-owner', 推荐人用户ID: 'other', 推荐人: scope.name, 推荐人手机号: scope.mobile, 岗位名称: '全部岗位', 活动状态: '启用', 公开页面地址: 'https://example.test/other' });
    const campaign = await service.createCampaign({ name: '本人内推', role: '全部岗位', publicBaseUrl: 'https://example.test/', referrerUserId: scope.userId, referrerName: scope.name, referrerMobile: scope.mobile });
    assert.notEqual(campaign.reused, true);
    assert.equal(memory.records.get('recruitment_referral_campaigns').at(-1).fields['推荐人用户ID'], 'self');
  } finally { memory.restore(); }
});

test('trusted identity, role bindings and permission checks reject spoofed or unauthorized access', async () => {
  const memory = await seedAccessData(installMemory());
  const previous = { mode: process.env.ACCESS_CONTROL_MODE, nodeEnv: process.env.NODE_ENV, dev: process.env.ALLOW_DEV_IDENTITY_HEADERS };
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    const access = new RoleAccessService(database);
    const identity = access.resolveIdentity({ 'x-studio-user-id': encodeURIComponent('recruiter_a'), 'x-studio-user-name': encodeURIComponent('王小明') });
    assert.deepEqual(identity, { userId: 'recruiter_a', userName: '王小明', source: 'studio' });
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_IDENTITY_HEADERS = 'true';
    assert.equal(access.resolveIdentity({ 'x-user-id': 'admin_1' }), null, 'production must not trust browser-controlled development headers');
    process.env.ACCESS_CONTROL_MODE = 'strict';
    await assert.rejects(() => access.getRequestAccess({}), /可信登录身份/);

    const recruiter = await access.getUserAccess('recruiter_a');
    assert.deepEqual(recruiter.roleCodes, ['business_manager']);
    assert.equal(access.hasPage(recruiter, 'candidates'), true);
    assert.equal(access.hasAction(recruiter, 'edit_candidate'), true);
    assert.equal(access.hasPage(recruiter, 'offers'), false);
    assert.throws(() => access.assertPage(recruiter, 'offers'), /没有页面权限/);
    const interviewer = await access.getUserAccess('interviewer_1');
    assert.throws(() => access.assertPage(interviewer, 'candidates'), /没有页面权限/);
  } finally {
    if (previous.mode === undefined) delete process.env.ACCESS_CONTROL_MODE; else process.env.ACCESS_CONTROL_MODE = previous.mode;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.dev === undefined) delete process.env.ALLOW_DEV_IDENTITY_HEADERS; else process.env.ALLOW_DEV_IDENTITY_HEADERS = previous.dev;
    memory.restore();
  }
});

test('employee name and mobile create a hashed remembered-device session that can be logged out', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    const access = new RoleAccessService(database);
    await teable.createRecord('recruitment_users', {
      用户ID: 'admin_1', 姓名: '高子云', 手机: '15762703457', 用户状态: '启用',
      身份来源: '管理员开通', 创建时间: '2026-08-01T00:00:00.000Z', 更新时间: '2026-08-31T00:00:00.000Z',
    });
    await assert.rejects(() => access.loginWithEmployeeProfile({ name: '高子云', mobile: '13800138000' }, { ip: '10.0.0.8' }), /姓名或手机号不正确/);
    const login = await access.loginWithEmployeeProfile({ name: ' 高 子 云 ', mobile: '157-6270-3457' }, { ip: '10.0.0.8', userAgent: 'node-test' });
    assert.ok(login.token.length >= 32);
    assert.equal(login.expiresAt, '2099-12-31T23:59:59.999Z');
    const session = memory.records.get('recruitment_login_sessions')[0];
    assert.equal(session.fields['用户ID'], 'admin_1');
    assert.equal(session.fields['用户姓名'], '高子云');
    assert.equal(session.fields['会话状态'], '有效');
    assert.notEqual(session.fields['令牌哈希'], login.token, 'database must not store the raw cookie token');
    assert.equal(String(session.fields['令牌哈希']).length, 64);
    const headers = { cookie: `other=value; rf_session=${encodeURIComponent(login.token)}` };
    assert.deepEqual(await access.resolveRequestIdentity(headers), { userId: 'admin_1', userName: '高子云', source: 'session' });
    const profile = await access.getRequestAccess(headers);
    assert.deepEqual(profile.profile.roleCodes, ['system_admin']);
    await access.logoutSession(headers);
    assert.equal(session.fields['会话状态'], '已退出');
    assert.equal(await access.resolveRequestIdentity(headers), null);
  } finally { memory.restore(); }
});

test('global controller guard covers every internal API family and audits sensitive reads', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    for (const userId of ['recruiter_a', 'interviewer_1', 'manager_b']) await teable.createRecord('recruitment_users', { 用户ID: userId, 用户状态: '启用' });
    assert.equal(resolveAccessPolicy('GET', '/api/public/offers/token').public, true);
    assert.equal(resolveAccessPolicy('POST', '/api/access/apply').public, true);
    assert.equal(resolveAccessPolicy('POST', '/api/access/profile').public, true);
    assert.equal(resolveAccessPolicy('POST', '/api/access/login').public, true);
    assert.equal(resolveAccessPolicy('POST', '/api/access/logout').public, true);
    assert.equal(resolveAccessPolicy('POST', '/api/access/heartbeat').public, true);
    assert.deepEqual(resolveAccessPolicy('GET', '/api/access/login-activity').actionsAny, ['manage_access_control']);
    assert.deepEqual(resolveAccessPolicy('POST', '/api/offers').pagesAny, ['offers']);
    assert.deepEqual(resolveAccessPolicy('POST', '/api/offers').actionsAny, ['manage_offer']);
    assert.deepEqual(resolveAccessPolicy('POST', '/api/offers/offer_a/approval').actionsAny, ['review_offer']);
    assert.deepEqual(resolveAccessPolicy('GET', '/api/access/administration').actionsAny, ['manage_access_control']);
    assert.deepEqual(resolveAccessPolicy('GET', '/api/resumes/api-config').actionsAny, ['manage_resume_api']);
    assert.deepEqual(resolveAccessPolicy('POST', '/api/studio-tasks/daily/run-now').actionsAny, ['manage_system']);
    assert.deepEqual(resolveAccessPolicy('GET', '/api/talents/talent_a').pagesAny, ['candidates']);
    assert.deepEqual(resolveAccessPolicy('DELETE', '/api/resumes/resume_a').pagesAny, ['candidates', 'resume_parse']);
    assert.deepEqual(resolveAccessPolicy('DELETE', '/api/resumes/resume_a').actionsAny, ['edit_candidate']);
    assert.deepEqual(resolveAccessPolicy('POST', '/api/resumes/backfill-identity').pagesAny, ['resume_parse']);
    assert.deepEqual(resolveAccessPolicy('POST', '/api/resumes/backfill-identity').actionsAny, ['manage_system']);
    assert.equal(resolveAccessPolicy('GET', '/api/talents/talent_a').sensitiveRead, true);
    assert.deepEqual(resolveAccessPolicy('GET', '/api/analytics/export').actionsAny, ['export_authorized_data']);
    const database = { getTableId: (name) => name, requireTableId: (name) => name }, access = new RoleAccessService(database), guard = new AccessGuard(access), audit = new AccessAuditInterceptor(access);
    const context = (request) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }) });
    assert.equal(await guard.canActivate(context({ method: 'POST', path: '/api/access/heartbeat', headers: {} })), true);
    const recruiterRequest = { method: 'GET', path: '/api/talents/talent_a', headers: { 'x-studio-user-id': 'recruiter_a', 'x-studio-user-name': encodeURIComponent('A部门招聘专员'), 'user-agent': 'node-test' }, ip: '10.0.0.9', socket: { remoteAddress: '10.0.0.9' } };
    await assert.rejects(() => guard.canActivate(context({ ...recruiterRequest, headers: {} })), /可信登录身份/);
    assert.equal(await guard.canActivate(context(recruiterRequest)), true);
    assert.equal(await guard.canActivate(context({ ...recruiterRequest, method: 'DELETE', path: '/api/resumes/resume_a' })), true);
    assert.deepEqual(await lastValueFrom(audit.intercept(context(recruiterRequest), { handle: () => of({ ok: true }) })), { ok: true });
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '读取敏感业务数据');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作结果'], '成功');
    const failedWrite = { ...recruiterRequest, method: 'POST', path: '/api/talents/talent_a/review' };
    assert.equal(await guard.canActivate(context(failedWrite)), true);
    await assert.rejects(lastValueFrom(audit.intercept(context(failedWrite), { handle: () => throwError(() => new Error('review failed')) })), /review failed/);
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '修改业务数据');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作结果'], '失败');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['错误信息'], 'review failed');
    const interviewerRequest = { ...recruiterRequest, headers: { ...recruiterRequest.headers, 'x-studio-user-id': 'interviewer_1' } };
    await assert.rejects(() => guard.canActivate(context(interviewerRequest)), /没有页面权限/);
    const managerOfferRequest = { ...recruiterRequest, method: 'POST', path: '/api/offers', headers: { ...recruiterRequest.headers, 'x-studio-user-id': 'manager_b' } };
    await assert.rejects(() => guard.canActivate(context(managerOfferRequest)), /没有页面权限/);
    assert.equal(await guard.canActivate(context({ method: 'GET', path: '/api/public/offers/token', headers: {}, ip: '', socket: {} })), true);
  } finally { memory.restore(); }
});

test('enterprise identity can request access, role assignment activates the account, and the last administrator is protected', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    const administration = new AccessAdminService(database, new RoleAccessService(database));
    await teable.createRecord('recruitment_users', { 用户ID: 'admin_1', 姓名: '系统管理员', 用户状态: '启用', 身份来源: '初始化', 创建时间: '2026-08-01T00:00:00.000Z', 更新时间: '2026-08-01T00:00:00.000Z' });
    const applied = await administration.applyForAccess({ userId: 'employee_new', userName: '新员工', source: 'studio' }, { department: '产品部', mobile: '13800138088', purpose: '参与面试', reason: '作为产品岗位面试官参与招聘' });
    assert.equal(applied.status, '待开通');
    assert.equal((await administration.account('employee_new')).status, '待开通');
    const binding = await administration.assignRole({ userId: 'employee_new', roleCode: 'interviewer', departmentIds: ['dept_a'], reason: '参与产品岗位面试', operator: '系统管理员', operatorUserId: 'admin_1' });
    assert.equal(binding.status, '启用');
    assert.equal((await administration.account('employee_new')).status, '启用');
    assert.equal((await administration.account('employee_new')).mobile, '13800138088');
    await teable.createRecord('recruitment_users', { 用户ID: 'legacy_user', 姓名: '历史员工', 手机: '', 用户状态: '启用', 身份来源: '历史导入', 创建时间: '2026-08-01T00:00:00.000Z', 更新时间: '2026-08-01T00:00:00.000Z' });
    const completed = await administration.completeProfile({ userId: 'legacy_user', userName: '历史员工', source: 'studio' }, { name: '历史员工', mobile: '13900139000' });
    assert.equal(completed.mobile, '13900139000');
    assert.equal((await administration.account('legacy_user')).mobile, '13900139000');
    await assert.rejects(() => administration.revokeRole('binding_admin_1', { reason: '误操作验证', operator: '系统管理员', operatorUserId: 'admin_1' }), /最后一名有效管理员/);
    const auditActions = memory.records.get('recruitment_audit_logs').map((row) => row.fields['操作类型']);
    assert.ok(auditActions.includes('提交系统开通申请'));
    assert.ok(auditActions.includes('配置员工权限'));
    assert.ok(auditActions.includes('完善首次登录资料'));
  } finally { memory.restore(); }
});

test('batch employee import keeps a single department and returns row-level failures without blocking valid employees', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    const administration = new AccessAdminService(database, new RoleAccessService(database));
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_a', 组织类型: '部门', 组织名称: '产品部', 组织状态: '启用' });
    const result = await administration.batchUpsertUsers({
      departmentId: 'dept_a', department: '产品部', operator: '系统管理员', operatorUserId: 'admin_1',
      items: [
        { name: '批量员工甲', mobile: '13800138081' },
        { name: '批量员工乙', mobile: '13900139082' },
        { name: '错误手机号', mobile: '123' },
      ],
    });
    assert.equal(result.total, 3);
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 1);
    assert.equal((await administration.account('employee_13800138081')).departments[0], '产品部');
    assert.equal((await administration.account('employee_13900139082')).departmentIds.length, 1);
    assert.equal(result.results.find((item) => item.name === '错误手机号').status, 'failed');
  } finally { memory.restore(); }
});

test('batch role assignment appends multiple roles, skips existing bindings, activates pending users, and rejects invalid departments before writes', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    const access = new RoleAccessService(database), administration = new AccessAdminService(database, access);
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_a', 组织类型: '部门', 组织名称: '产品部', 组织状态: '启用' });
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_disabled', 组织类型: '部门', 组织名称: '已停用部', 组织状态: '停用' });
    await teable.createRecord('recruitment_users', { 用户ID: 'employee_batch_a', 姓名: '批量员工甲', 部门IDJSON: '["dept_a"]', 部门JSON: '["产品部"]', 用户状态: '启用' });
    await teable.createRecord('recruitment_users', { 用户ID: 'employee_batch_b', 姓名: '批量员工乙', 部门IDJSON: '["dept_a"]', 部门JSON: '["产品部"]', 用户状态: '待开通' });
    await teable.createRecord('recruitment_users', { 用户ID: 'employee_batch_invalid', 姓名: '无有效部门员工', 部门IDJSON: '["dept_disabled"]', 部门JSON: '["已停用部"]', 用户状态: '启用' });
    await teable.createRecord('recruitment_user_roles', { 用户角色ID: 'existing_batch_binding', 用户ID: 'employee_batch_a', 角色编码: 'business_manager', 绑定状态: '启用', 失效时间: '' });

    const result = await administration.assignRolesBatch({ userIds: ['employee_batch_a', 'employee_batch_b'], roleCodes: ['business_manager', 'interviewer'], operator: '系统管理员', operatorUserId: 'admin_1' });
    assert.deepEqual(result, { assigned: 3, alreadyHad: 1, activatedUsers: 1, userCount: 2, roleCount: 2 });
    assert.equal((await administration.account('employee_batch_b')).status, '启用');
    const createdBindings = memory.records.get('recruitment_user_roles').filter((row) => row.fields['用户ID'].startsWith('employee_batch_') && row.fields['用户角色ID'] !== 'existing_batch_binding');
    assert.equal(createdBindings.length, 3);
    assert.ok(createdBindings.every((row) => row.fields['部门IDJSON'] === '["dept_a"]'));
    assert.equal(memory.records.get('recruitment_audit_logs').filter((row) => row.fields['操作类型'] === '批量配置员工权限').length, 3);

    const bindingCount = memory.records.get('recruitment_user_roles').length;
    await assert.rejects(() => administration.assignRolesBatch({ userIds: ['employee_batch_a', 'employee_batch_invalid'], roleCodes: ['hrbp'] }), /未进行任何授权/);
    assert.equal(memory.records.get('recruitment_user_roles').length, bindingCount);
  } finally { memory.restore(); }
});

test('talent archive menu grants visibility to every talent while sensitive fields remain protected', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    const access = new RoleAccessService(database);
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database), access);
    talents.cache.clear();

    const adminResult = await talents.list({ pageSize: '25' }, await access.getUserAccess('admin_1'));
    assert.equal(adminResult.total, 2);
    assert.equal(adminResult.talents[0].access.contactPolicy, 'full');
    assert.ok(adminResult.talents.some((item) => item.phone !== ''));

    const recruiterProfile = await access.getUserAccess('recruiter_a');
    const redacted = access.redactSensitiveResponse({ candidateEmail: 'candidate@example.com', candidatePhone: '13800138001', baseSalary: 12000, versions: [{ fileUrl: 'https://files.example.test/resume.pdf', fingerprint: 'secret' }] }, recruiterProfile, ['contacts', 'salary', 'resume']);
    assert.equal(redacted.candidateEmail, '');
    assert.equal(redacted.candidatePhone, '');
    assert.equal(redacted.baseSalary, null);
    assert.equal(redacted.versions[0].fileUrl, '');
    assert.equal(redacted.versions[0].fingerprint, '');
    const recruiterResult = await talents.list({}, recruiterProfile);
    assert.equal(recruiterResult.total, 2);
    assert.deepEqual(recruiterResult.talents.map((item) => item.id).sort(), ['talent_a', 'talent_b']);
    assert.ok(recruiterResult.talents.every((item) => item.phone === ''));
    assert.ok(recruiterResult.talents.every((item) => item.sourceFileUrl === ''));
    assert.ok(recruiterResult.talents.every((item) => item.rawText === ''));
    assert.ok(recruiterResult.talents.every((item) => item.access.resumePolicy === 'hidden'));
    assert.ok(recruiterResult.talents.every((item) => !('_access' in item)));
    const recruiterCrossDepartmentDetail = await talents.detail('talent_b', recruiterProfile);
    assert.equal(recruiterCrossDepartmentDetail.id, 'talent_b');
    assert.equal(recruiterCrossDepartmentDetail.phone, '');

    const managerResult = await talents.list({}, await access.getUserAccess('manager_b'));
    assert.equal(managerResult.total, 2);
    assert.deepEqual(managerResult.talents.map((item) => item.id).sort(), ['talent_a', 'talent_b']);

    const interviewerProfile = await access.getUserAccess('interviewer_1');
    assert.equal(access.canAccessTalent(interviewerProfile, { candidateId: 'talent_a', interviewerUserIds: ['interviewer_1'] }), true);
    const interviewerResult = await talents.list({}, interviewerProfile);
    assert.equal(interviewerResult.total, 0, '没有人才档案菜单时不得查看任何人才');
    await assert.rejects(() => talents.detail('talent_a', interviewerProfile), /没有人才档案菜单权限/);

    const aiResult = await talents.list({}, await access.getUserAccess('ai_1'));
    assert.equal(aiResult.total, 0, 'AI运营角色没有人才档案菜单时不得查看人才');

    const noRoleResult = await talents.list({}, await access.getUserAccess('unknown_user'));
    assert.equal(noRoleResult.total, 0);
    const noRoleProfile = await access.getUserAccess('unknown_user');
    await assert.rejects(() => talents.detail('talent_b', noRoleProfile), /没有人才档案菜单权限/);
  } finally { memory.restore(); }
});

test('administrators maintain organization roles and time-limited sensitive-field approvals with audit history', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    const access = new RoleAccessService(database), administration = new AccessAdminService(database, new RoleAccessService(database));
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'bu_1', 组织类型: '事业部', 组织名称: '第一事业部', 组织状态: '启用' });
    const organization = await administration.upsertOrganization({ type: '部门', code: 'DEPT-C', name: '商业化部', parentId: 'bu_1', ownerUserId: 'manager_c', owner: '周经理', operator: '系统管理员', operatorUserId: 'admin_1' });
    assert.equal(organization.status, '启用');
    await assert.rejects(() => administration.upsertOrganization({ id: organization.organizationId, type: '部门', name: '商业化部', parentId: organization.organizationId }), /本部门或其下级/);
    await administration.upsertUser({ userId: 'recruiter_c', name: '赵招聘', employeeNumber: 'FP1008', businessUnitId: 'bu_1', businessUnit: '第一事业部', departmentIds: [organization.organizationId], departments: ['商业化部'], operator: '系统管理员', operatorUserId: 'admin_1' });
    await assert.rejects(() => administration.upsertOrganization({ id: organization.organizationId, type: '部门', name: '商业化部', parentId: 'bu_1', status: '停用' }), /员工归属/);
    const binding = await administration.assignRole({ userId: 'recruiter_c', roleCode: 'business_manager', departmentIds: [organization.organizationId], reason: '负责商业化部招聘需求', operator: '系统管理员', operatorUserId: 'admin_1' });
    assert.equal(binding.status, '启用');
    await assert.rejects(() => administration.assignRole({ userId: 'recruiter_c', roleCode: 'business_manager', departmentIds: [organization.organizationId], reason: '重复授权验证' }), /已经拥有/);
    const revoked = await administration.revokeRole(binding.bindingId, { reason: '人员职责调整', operator: '系统管理员', operatorUserId: 'admin_1' });
    assert.equal(revoked.status, '停用');

    const hrbp = await access.getUserAccess('hrbp_1');
    hrbp.sensitiveFields.push({ roleCode: 'hrbp', unlock: 'approval_required' });
    const request = await administration.requestSensitiveAccess(hrbp, { candidateId: 'talent_a', fields: ['contacts', 'resume'], reason: '需要与候选人确认Offer前置材料', operator: '业务HRBP' });
    assert.equal(request.status, '待审批');
    await assert.rejects(() => administration.requestSensitiveAccess(hrbp, { candidateId: 'talent_a', fields: ['contacts'], reason: '重复申请', operator: '业务HRBP' }), /已有待审批/);
    const decision = await administration.decideSensitiveAccess(request.requestId, { decision: '通过', opinion: '业务目的明确，限时两小时查看', durationHours: 2, operator: '系统管理员', operatorUserId: 'admin_1' });
    assert.equal(decision.status, '已通过');
    assert.ok(Date.parse(decision.expiresAt) > Date.now());
    await assert.rejects(() => administration.decideSensitiveAccess(request.requestId, { decision: '通过', opinion: '重复审批' }), /已经处理/);

    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database), access, administration);
    const unlocked = await talents.detail('talent_a', hrbp);
    assert.equal(unlocked.phone, '13800138001');
    assert.equal(unlocked.sourceFileUrl, 'https://files.example.test/linyue.pdf');
    assert.equal(unlocked.access.contactPolicy, 'full');
    assert.equal(unlocked.access.resumePolicy, 'full');
    const unlockRow = memory.records.get('recruitment_sensitive_access_requests')[0];
    unlockRow.fields['授权到期时间'] = '2026-08-01T00:00:00.000Z';
    const expired = await talents.detail('talent_a', hrbp);
    assert.equal(expired.phone, '');
    assert.equal(expired.sourceFileUrl, '');
    assert.equal(expired.access.resumePolicy, 'hidden');

    const administrationView = await administration.administration();
    assert.equal(administrationView.organizations.length, 2);
    assert.equal(administrationView.users.length, 1);
    assert.equal(administrationView.sensitiveRequests[0].status, '已通过');
    const auditActions = memory.records.get('recruitment_audit_logs').map((row) => row.fields['操作类型']);
    for (const action of ['创建组织单元', '创建系统用户', '配置员工权限', '撤销用户角色', '申请敏感字段解锁', '审批敏感字段解锁']) assert.ok(auditActions.includes(action), `missing audit ${action}`);
  } finally { memory.restore(); }
});

test('editing an employee department updates active role scopes without changing expired bindings', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: name => name, requireTableId: name => name };
    const access = new RoleAccessService(database), administration = new AccessAdminService(database, access);
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_before', 组织类型: '部门', 组织名称: '调整前部门', 组织状态: '启用' });
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_after', 组织类型: '部门', 组织名称: '调整后部门', 组织状态: '启用' });
    await teable.createRecord('recruitment_users', { 用户ID: 'moving_user', 姓名: '调岗员工', 手机: '13800138100', 部门IDJSON: JSON.stringify(['dept_before']), 部门JSON: JSON.stringify(['调整前部门']), 用户状态: '启用' });
    await teable.createRecord('recruitment_user_roles', { 用户角色ID: 'binding_moving', 用户ID: 'moving_user', 角色编码: 'business_manager', 部门IDJSON: JSON.stringify(['dept_before']), 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z' });
    await teable.createRecord('recruitment_user_roles', { 用户角色ID: 'binding_moving_expired', 用户ID: 'moving_user', 角色编码: 'business_manager', 部门IDJSON: JSON.stringify(['dept_before']), 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z', 失效时间: '2026-08-01T00:00:00.000Z' });
    await access.getUserAccess('moving_user');

    await administration.upsertUser({ userId: 'moving_user', name: '调岗员工', mobile: '13800138100', departmentIds: ['dept_after'], departments: ['调整后部门'], operator: '系统管理员', operatorUserId: 'admin_1' });

    const user = memory.records.get('recruitment_users').find((row) => row.fields['用户ID'] === 'moving_user');
    assert.equal(user.fields['部门IDJSON'], JSON.stringify(['dept_after']));
    assert.equal(user.fields['部门JSON'], JSON.stringify(['调整后部门']));
    assert.equal(memory.records.get('recruitment_user_roles').find((row) => row.fields['用户角色ID'] === 'binding_moving').fields['部门IDJSON'], JSON.stringify(['dept_after']));
    assert.equal(memory.records.get('recruitment_user_roles').find((row) => row.fields['用户角色ID'] === 'binding_moving_expired').fields['部门IDJSON'], JSON.stringify(['dept_before']));
    const profile = await access.getUserAccess('moving_user');
    assert.deepEqual(profile.dataScopes[0].departmentIds, ['dept_after']);
  } finally { memory.restore(); }
});

test('report exports use role data scope, per-row watermark and immutable export audit', async () => {
  const memory = await seedAccessData(installMemory());
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    const access = new RoleAccessService(database);
    const recruiter = await access.getUserAccess('recruiter_a');
    assert.throws(() => access.assertAction(recruiter, 'export_authorized_data'), /没有操作权限/);
    await teable.createRecord('recruitment_stage_events', { 事件ID: 'event_export', 应聘记录ID: 'app_a', 候选人ID: 'talent_a', 原阶段: '意向沟通', 新阶段: '约面', 操作: '安排面试', 原因: '候选人确认参加', 操作人: 'A部门招聘专员', 发生时间: '2026-08-26T10:00:00.000Z', 来源类型: '测试' });
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database), access);
    await talents.detail('talent_a', recruiter);
    const manager = await access.getUserAccess('manager_b');
    assert.throws(() => access.assertAction(manager, 'export_authorized_data'), /没有操作权限/);
  } finally { memory.restore(); }
});

test('WeCom member-ID sync unwraps connector responses and uses contact fields to resolve duplicate names', async () => {
  const memory = installMemory(), originalWecom = wecom.cli;
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name }, administration = new AccessAdminService(database, new RoleAccessService(database));
    await teable.createRecord('recruitment_users', { 用户ID: 'user_unique', 姓名: '陈经理', 企业微信用户ID: '', 用户状态: '启用', 创建时间: '2026-09-04T00:00:00.000Z', 更新时间: '2026-09-04T00:00:00.000Z' });
    await teable.createRecord('recruitment_users', { 用户ID: 'user_contact', 姓名: '王老师', 邮箱: 'target@example.com', 企业微信用户ID: '', 用户状态: '启用', 创建时间: '2026-09-04T00:00:00.000Z', 更新时间: '2026-09-04T00:00:00.000Z' });
    await teable.createRecord('recruitment_users', { 用户ID: 'user_duplicate', 姓名: '赵老师', 企业微信用户ID: '', 用户状态: '启用', 创建时间: '2026-09-04T00:00:00.000Z', 更新时间: '2026-09-04T00:00:00.000Z' });
    await teable.createRecord('recruitment_users', { 用户ID: 'user_missing', 姓名: '李同学', 企业微信用户ID: '', 用户状态: '启用', 创建时间: '2026-09-04T00:00:00.000Z', 更新时间: '2026-09-04T00:00:00.000Z' });
    await teable.createRecord('recruitment_users', { 用户ID: 'user_existing', 姓名: '已有成员', 企业微信用户ID: 'wecom_existing', 用户状态: '启用', 创建时间: '2026-09-04T00:00:00.000Z', 更新时间: '2026-09-04T00:00:00.000Z' });
    let calls = 0;
    wecom.cli = async (argv) => {
      calls += 1;
      const body = JSON.parse(argv[argv.indexOf('--json') + 1]), name = body.keywords[0];
      if (name === '陈经理') return { content: [{ type: 'text', text: JSON.stringify({ users: [{ userid: 'wecom_chen', name: '陈经理' }] }) }] };
      if (name === '王老师') return { users: [{ userid: 'wecom_wang_a', name: '王老师', email: 'other@example.com' }, { userid: 'wecom_wang_b', name: '王老师', email: 'target@example.com' }] };
      if (name === '赵老师') return { users: [{ userid: 'wecom_zhao_a', name: '赵老师' }, { userid: 'wecom_zhao_b', name: '赵老师' }] };
      return { users: [] };
    };
    const result = await administration.syncWecomUserIds(() => {}, { operator: '管理员', operatorUserId: 'admin_1' });
    assert.equal(result.synced, 2);
    assert.equal(result.normalized, 0);
    assert.equal(result.unchanged, 1);
    assert.equal(result.ambiguous.length, 1);
    assert.equal(result.notFound.length, 1);
    assert.equal(calls, 4);
    const rows = memory.records.get('recruitment_users');
    assert.equal(rows.find((row) => row.fields['用户ID'] === 'user_unique').fields['企业微信用户ID'], 'wecom_chen');
    assert.equal(rows.find((row) => row.fields['用户ID'] === 'user_unique').fields['天玑微信ID'], undefined);
    assert.equal(rows.find((row) => row.fields['用户ID'] === 'user_contact').fields['企业微信用户ID'], 'wecom_wang_b');
    assert.equal(rows.find((row) => row.fields['用户ID'] === 'user_existing').fields['天玑微信ID'], undefined);
    assert.equal(rows.find((row) => row.fields['用户ID'] === 'user_duplicate').fields['企业微信用户ID'], '');
    assert.equal(rows.find((row) => row.fields['用户ID'] === 'user_missing').fields['企业微信用户ID'], '');
  } finally { wecom.cli = originalWecom; memory.restore(); }
});

test('organization administration keeps WeCom and Tianji member IDs separate', async () => {
  const memory = installMemory();
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name }, administration = new AccessAdminService(database, new RoleAccessService(database));
    await teable.createRecord('recruitment_users', { 用户ID: 'user_wecom_only', 姓名: '企微员工', 企业微信用户ID: 'WECOM_ONLY', 天玑微信ID: 'TIANJI_ONLY', 用户状态: '启用' });
    const data = await administration.administration();
    const user = data.users.find((item) => item.id === 'user_wecom_only');
    assert.equal(user.wecomUserId, 'WECOM_ONLY');
    assert.equal(user.tianjiWechatId, 'TIANJI_ONLY');
  } finally { memory.restore(); }
});

test('Tianji employee sync matches the talent library by phone without marking unmatched resumes as departed', async () => {
  const memory = installMemory();
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name }, administration = new AccessAdminService(database, new RoleAccessService(database));
    await teable.createRecord('recruitment_users', { 用户ID: 'user_active', 姓名: '在职员工', 手机: '13800138001', 用户状态: '启用' });
    await teable.createRecord('recruitment_users', { 用户ID: 'user_unknown', 姓名: '未匹配员工', 手机: '13700137003', 用户状态: '启用', 天玑人事状态: '在职' });
    const activeCandidate = await teable.createRecord('recruitment_candidates', { 候选人ID: 'talent_active', 姓名: '在职员工', 电话: '+86 13800138001', 最新简历记录ID: 'resume_active', 合并状态: '独立档案' });
    const leftCandidate = await teable.createRecord('recruitment_candidates', { 候选人ID: 'talent_left', 姓名: '离职员工', 电话: '', 最新简历记录ID: 'resume_left', 合并状态: '独立档案' });
    const unknownCandidate = await teable.createRecord('recruitment_candidates', { 候选人ID: 'talent_unknown', 姓名: '未匹配人才', 电话: '13700137003', 最新简历记录ID: 'resume_unknown', 合并状态: '独立档案', 天玑人事状态: '在职' });
    const activeResume = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_active', 候选人ID: 'talent_active', 电话: '13800138001' });
    const leftResume = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_left', 候选人ID: 'talent_left', 电话: '13900139002' });
    const unknownResume = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_unknown', 候选人ID: 'talent_unknown', 电话: '13700137003', 天玑人事状态: '在职' });
    const orphanResume = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_orphan', 候选人ID: 'legacy_candidate_id', 电话: '13800138001' });
    const activeOnboarding = await teable.createRecord('recruitment_onboarding_cases', { 入职单ID: 'on_active', 候选人ID: 'talent_active', 入职状态: '待入职', 更新时间: '2026-01-01T00:00:00.000Z' });
    const leftOnboarding = await teable.createRecord('recruitment_onboarding_cases', { 入职单ID: 'on_left', 候选人ID: 'talent_left', 入职状态: '已入职', 更新时间: '2026-01-01T00:00:00.000Z' });
    const leftOffboarding = await teable.createRecord('recruitment_offboarding_cases', { 离职单ID: 'off_left', 入职单ID: 'on_left', 候选人ID: 'talent_left', 离职状态: '交接中', 更新时间: '2026-01-02T00:00:00.000Z' });
    administration.fetchTianjiRosterPage = async () => ({ count: 2, list: [
      { id: 101, employee_phone: '13800138001', status: 1, status_text: '在职', hire_date: Date.UTC(2026, 0, 10) / 1000, leave_date: 0 },
      { id: 102, employee_phone: '13900139002', status: 0, status_text: '离职', hire_date: Date.UTC(2025, 0, 10) / 1000, leave_date: Date.UTC(2026, 8, 1) / 1000 },
    ] });
    administration.fetchTianjiRosterDetail = async (employeeId) => employeeId === '101'
      ? { id: 101, create_time: Date.UTC(2026, 0, 11, 17) / 1000, leave_date: 0 }
      : { id: 102, create_time: Date.UTC(2025, 0, 15) / 1000, leave_date: Date.UTC(2026, 8, 1) / 1000 };

    const result = await administration.syncTianjiEmployeeStatus(() => {}, { operator: '管理员', operatorUserId: 'admin_1' });

    assert.equal(result.matched, 2);
    assert.equal(result.active, 1);
    assert.equal(result.left, 1);
    assert.equal(result.hireDateSynced, 2);
    assert.equal(result.leaveDateSynced, 1);
    assert.equal(result.missing, 1);
    assert.equal(result.lifecycleUpdated, 2);
    assert.equal(result.systemUsers.matched, 1);
    assert.equal(result.resumeRecords.matched, 3);
    assert.equal(activeCandidate.fields['天玑人事状态'], '在职');
    assert.equal(activeCandidate.fields['天玑员工ID'], '101');
    assert.equal(activeCandidate.fields['天玑入职日期'], '2026-01-12');
    assert.equal(activeCandidate.fields['天玑离职日期'], '');
    assert.equal(leftCandidate.fields['天玑人事状态'], '离职');
    assert.equal(leftCandidate.fields['天玑入职日期'], '2025-01-15');
    assert.equal(leftCandidate.fields['天玑离职日期'], '2026-09-01');
    assert.equal(unknownCandidate.fields['天玑人事状态'], '在职');
    assert.equal(activeResume.fields['天玑人事状态'], '在职');
    assert.equal(leftResume.fields['天玑人事状态'], '离职');
    assert.equal(unknownResume.fields['天玑人事状态'], '在职');
    assert.equal(orphanResume.fields['天玑人事状态'], '在职');
    assert.equal(activeOnboarding.fields['实际到岗日期'], '2026-01-12');
    assert.equal(activeOnboarding.fields['入职状态'], '已入职');
    assert.equal(leftOnboarding.fields['入职状态'], '已离职');
    assert.equal(leftOffboarding.fields['实际离职日期'], '2026-09-01');
    assert.equal(leftOffboarding.fields['离职状态'], '已离职');
  } finally { memory.restore(); }
});

test('talent employment filters use the synced Tianji status field before pagination', () => {
  const talents = new TalentsService({}, {}, {});
  assert.equal(talents.directoryFilter({ status: '在职' }), '{天玑人事状态} = "在职"');
  assert.equal(talents.directoryFilter({ status: '离职' }), '{天玑人事状态} = "离职"');
  assert.equal(talents.directoryFilter({ status: '未入职' }), '');
  const keywordFilter = talents.directoryFilter({ q: '产品规划', status: '在职', source: '内部推荐' });
  assert.match(keywordFilter, /\{期望职位\} LIKE "%产品规划%"/);
  assert.match(keywordFilter, /\{技能JSON\} LIKE "%产品规划%"/);
  for (const clause of keywordFilter.split(' OR ')) {
    assert.match(clause, /\{天玑人事状态\} = "在职"/);
    assert.match(clause, /\{来源类型\} = "内部推荐"/);
  }
});

test('talent search uses raw contact data before masking and applies age region and score filters', async () => {
  const memory = installMemory();
  try {
    const database = { getTableId: (name) => name, requireTableId: (name) => name };
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'talent_search', 姓名: '搜索候选人', 年龄: 28, 电话: '13800138001', 当前城市: '武汉', 当前公司: '示例科技', 当前职位: '产品经理', 期望职位: '高级产品经理', 技能JSON: JSON.stringify(['数据分析', '产品规划']), 候选人状态: '人才库', 合并状态: '独立档案', 创建时间: '2026-09-20T00:00:00.000Z' });
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'app_search', 候选人ID: 'talent_search', 当前阶段: '人才库', 当前状态: '进行中', AI匹配分: 86, 更新时间: '2026-09-20T00:00:00.000Z' });
    const access = { hasPage: () => true, protectTalent: (item) => ({ ...item, phone: '138****8001' }) };
    const talents = new TalentsService(database, {}, {}, access);
    const profile = { userId: 'hr_search' };
    const byPhone = await talents.list({ q: '13800138001', age: '26-30岁', region: '武汉', score: '80-89分' }, profile);
    assert.equal(byPhone.total, 1);
    assert.equal(byPhone.talents[0].name, '搜索候选人');
    assert.equal(byPhone.talents[0].phone, '138****8001');
    const bySkill = await talents.list({ q: '数据分析', age: '26-30岁', region: '武汉', score: '80-89分' }, profile);
    assert.equal(bySkill.total, 1);
    assert.equal(bySkill.talents[0].bestMatchScore, 86);
  } finally { memory.restore(); }
});
