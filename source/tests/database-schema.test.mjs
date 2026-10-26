import test from 'node:test';
import assert from 'node:assert/strict';
import { RECRUITMENT_TABLES, SYSTEM_ROLE_TEMPLATES } from '../dist/modules/database/database.schema.js';

const byName = new Map(RECRUITMENT_TABLES.map((table) => [table.name, table]));
const required = {
  recruitment_positions: ['职位ID', '职位名称', '招聘人数', '已到岗人数', '招聘状态', '发布状态'],
  recruitment_positions: ['职位ID', '需求ID', '职位名称', '岗位JD', '任职要求', '发布状态'],
  recruitment_candidates: ['候选人ID', '姓名', '出生年份', '电话', '邮箱', '微信', '候选人状态', '负责人'],
  recruitment_applications: ['应聘记录ID', '候选人ID', '职位ID', '当前阶段', '当前状态', '投递时间'],
  recruitment_stage_events: ['事件ID', '应聘记录ID', '候选人ID', '原阶段', '新阶段', '发生时间'],
  recruitment_candidate_tags: ['标签记录ID', '候选人ID', '标签名称', '标签来源', '人工确认状态'],
  recruitment_interviews: ['面试ID', '候选人ID', '开始时间', '结束时间', '面试状态', '同步状态'],
  recruitment_offers: ['OfferID', '候选人ID', '岗位名称', 'Offer状态', '发送时间', '候选人答复'],
  recruitment_onboarding_cases: ['入职单ID', '候选人ID', '计划入职日期', '实际到岗日期', '入职状态'],
  recruitment_probation_reviews: ['试用期记录ID', '候选人ID', '节点类型', '述职评级', '新人成长等级', '述职评价', '处理状态'],
  recruitment_offboarding_cases: ['离职单ID', '候选人ID', '实际离职日期', '离职状态', '题库反哺状态', '题库反哺数量', '题库反哺错误', '题库反哺时间'],
  recruitment_exit_interviews: ['离职面谈ID', '离职单ID', '候选人ID', '离职主因', '题库反哺状态', '题库反哺数量', '题库反哺错误', '题库反哺时间'],
  recruitment_followups: ['回访ID', '候选人ID', '回访状态', '回流意向', '负责人'],
  recruitment_referral_campaigns: ['内推活动ID', '推荐人', '推荐人手机号', '岗位名称', '二维码DataURL'],
  recruitment_referrals: ['内推记录ID', '候选人ID', '推荐人', '推荐人手机号', '候选人姓名快照', '候选人电话快照'],
  recruitment_user_roles: ['用户角色ID', '用户ID', '角色编码', '绑定状态'],
  recruitment_users: ['用户ID', '姓名', '事业部ID', '部门IDJSON', '用户状态'],
  recruitment_login_sessions: ['会话ID', '用户ID', '令牌哈希', '会话状态', '过期时间'],
  recruitment_organization_units: ['组织单元ID', '组织类型', '组织名称', '组织状态'],
  recruitment_sensitive_access_requests: ['解锁申请ID', '申请人用户ID', '候选人ID', '敏感字段JSON', '申请状态', '授权到期时间'],
  recruitment_audit_logs: ['日志ID', '操作人', '操作类型', '对象类型', '对象ID', '发生时间'],
  recruitment_report_exports: ['导出记录ID', '报表类型', '导出人用户ID', '权限角色', '导出水印', '请求ID', '导出状态'],
  recruitment_talent_review_shares: ['分享批次ID', '候选人ID', '访问Token哈希', '分享状态', '认领部门', '过期时间'],
  recruitment_talent_review_responses: ['反馈ID', '分享批次ID', '候选人ID', '反馈结论', '评审人', '处理结果'],
};

test('all recruitment tables use fixed unique names and valid field definitions', () => {
  assert.equal(RECRUITMENT_TABLES.length, 88);
  assert.equal(byName.size, RECRUITMENT_TABLES.length, 'table names must be unique');
  for (const table of RECRUITMENT_TABLES) {
    assert.match(table.name, /^(recruitment_|resume_)[a-z0-9_]+$/);
    assert.ok(table.fields.length > 0, `${table.name} must define fields`);
    const names = table.fields.map((field) => field.name);
    assert.equal(new Set(names).size, names.length, `${table.name} has duplicate field names`);
    for (const field of table.fields) assert.ok(['singleLineText', 'longText', 'number'].includes(field.type), `${table.name}.${field.name} has invalid type`);
  }
});

test('core business tables contain their required anchor fields', () => {
  for (const [tableName, fields] of Object.entries(required)) {
    const table = byName.get(tableName);
    assert.ok(table, `missing fixed table ${tableName}`);
    const actual = new Set(table.fields.map((field) => field.name));
    for (const field of fields) assert.ok(actual.has(field), `${tableName} missing field ${field}`);
  }
});

test('system role templates are unique and carry pages actions and sensitive-field policy', () => {
  assert.ok(SYSTEM_ROLE_TEMPLATES.length >= 4);
  assert.equal(new Set(SYSTEM_ROLE_TEMPLATES.map((role) => role.code)).size, SYSTEM_ROLE_TEMPLATES.length);
  for (const role of SYSTEM_ROLE_TEMPLATES) {
    assert.ok(role.code && role.name && role.level && role.dataScope);
    assert.ok(Array.isArray(role.pages), `${role.code} pages must be an array`);
    assert.ok(Array.isArray(role.actions), `${role.code} actions must be an array`);
    assert.equal(typeof role.sensitiveFields, 'object');
  }
  const admin = SYSTEM_ROLE_TEMPLATES.find((role) => role.code === 'system_admin');
  assert.deepEqual(admin?.pages, ['*']);
  assert.deepEqual(admin?.actions, ['*']);
  assert.equal(admin?.sensitiveFields.contacts, 'full');
  assert.equal(admin?.sensitiveFields.resume, 'full');
  const departmentLeader = SYSTEM_ROLE_TEMPLATES.find((role) => role.code === 'department_leader');
  assert.equal(departmentLeader?.name, '部门负责人');
  assert.match(departmentLeader?.description || '', /员工档案所属部门组织范围/);
  assert.equal(departmentLeader?.dataScope, 'assigned_departments');
  assert.deepEqual(departmentLeader?.pages, ['home', 'positions', 'candidates', 'interviews']);
  assert.deepEqual(departmentLeader?.actions, []);
  assert.deepEqual(departmentLeader?.sensitiveFields, { salary: 'hidden', contacts: 'hidden', resume: 'hidden' });
});
