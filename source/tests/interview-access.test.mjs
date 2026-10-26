import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { RoleAccessService } from '../dist/modules/database/role-access.service.js';
import { AccessGuard } from '../dist/modules/database/access.guard.js';
import { InterviewsService } from '../dist/modules/interviews/interviews.service.js';
import { InterviewsController } from '../dist/modules/interviews/interviews.controller.js';
import { EvaluationService } from '../dist/modules/interviews/evaluation.service.js';
import { EvaluationsController } from '../dist/modules/interviews/evaluations.controller.js';
import { canReadInterview } from '../dist/modules/interviews/interview-access.js';

function setup(context) {
  const row = (id, fields) => ({ id, fields });
  const interview = (id, users, extra = {}) => row(`rec_${id}`, { 面试ID: id, 候选人ID: 'candidate', 面试官用户IDJSON: JSON.stringify(users), 面试状态: '待评价', 开始时间: '2026-10-01T10:00:00Z', 结束时间: '2026-10-01T11:00:00Z', ...extra });
  const tables = {
    recruitment_users: [row('rec_user_a', { 用户ID: 'user_a', 企业微信用户ID: 'wecom_a', 姓名: '同名用户' }), row('rec_user_b', { 用户ID: 'user_b', 企业微信用户ID: 'wecom_b', 姓名: '同名用户' })],
    recruitment_interviewer_pool: [row('rec_pool_a', { 面试官ID: 'legacy_a', 用户ID: 'wecom_a' })],
    recruitment_interviews: [interview('own', ['user_a']), interview('other', ['user_b']), interview('legacy', ['legacy_a']), interview('organized', ['user_b'], { 组织者用户ID: 'user_a' }), interview('unassigned', [], { 面试官用户IDJSON: 'invalid' })],
    recruitment_candidates: [row('rec_candidate', { 候选人ID: 'candidate', 姓名: '测试候选人' })],
    recruitment_interview_feedback: [row('rec_feedback_a', { 面试ID: 'own', 面试官用户ID: 'user_a', 面试官: '甲', 评价状态: '已提交' }), row('rec_feedback_b', { 面试ID: 'other', 面试官用户ID: 'user_b', 面试官: '乙', 评价状态: '已提交' })],
  };
  const originals = {};
  for (const method of ['listAllRecords', 'listByField', 'findOneByField', 'getRecord']) originals[method] = teable[method];
  teable.listAllRecords = async name => tables[name] || [];
  teable.listByField = async (name, field, value) => (tables[name] || []).filter(record => record.fields[field] === value);
  teable.findOneByField = async (name, field, value) => (tables[name] || []).find(record => record.fields[field] === value);
  teable.getRecord = async (name, id) => (tables[name] || []).find(record => record.id === id);
  context.after(() => Object.assign(teable, originals));
  const database = { requireTableId: name => name };
  const access = new RoleAccessService(database);
  const profile = { userId: 'user_a', roleCodes: ['interviewer'], pages: ['interviews'], actions: ['*'], dataScopes: [{ type: 'all' }] };
  const identity = { userId: 'user_a', userName: '甲', source: 'session' };
  access.getRequestAccess = async () => ({ identity, profile });
  const guard = new AccessGuard(access);
  const authorize = async (path, method = 'GET', body = {}) => {
    const request = { path, method, body, headers: {}, query: { interviewerUserId: 'user_b', admin: true } };
    await guard.canActivate({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }) });
    return request;
  };
  return { tables, database, access, profile, identity, authorize };
}

test('interview scope resolves stable historical IDs without trusting names or broad menu permissions', async context => {
  const { access, identity, profile } = setup(context);
  const scope = await access.interviewScope(identity, profile);
  assert.equal(scope.all, false);
  for (const value of ['user_a', 'wecom_a', 'rec_user_a', 'legacy_a', 'rec_pool_a']) assert.ok(scope.userIds.includes(value));
  assert.ok(!scope.userIds.includes('user_b'));
  assert.equal(canReadInterview({ fields: { 面试官用户IDJSON: 'not-json' } }, scope), false);
  assert.equal(canReadInterview({ fields: {} }, { all: false, userIds: [''] }), false);
  profile.roleCodes = ['system_admin'];
  assert.equal((await access.interviewScope(identity, profile)).all, true);
});

test('appointment and evaluation lists filter before counts even when the shared cache was loaded by an admin', async context => {
  const { database, profile, authorize } = setup(context);
  const interviews = new InterviewsService(database, {}, {});
  interviews.listInterviewers = async () => ({ interviewers: [] });
  const controller = new InterviewsController(interviews);
  const evaluations = new EvaluationService(database, {});
  const evaluationController = new EvaluationsController(evaluations);
  profile.roleCodes = ['system_admin'];
  const admin = await authorize('/api/interviews/appointments');
  assert.equal((await controller.appointments({}, admin)).total, 5);
  profile.roleCodes = ['interviewer'];
  const mine = await authorize('/api/interviews/appointments');
  const list = await controller.appointments({}, mine);
  assert.equal(list.total, 3);
  assert.deepEqual(list.appointments.map(item => item.id).sort(), ['legacy', 'organized', 'own']);
  const workbench = await evaluationController.workbench({}, mine);
  assert.equal(workbench.total, 3);
  assert.equal(workbench.pendingFeedback, 2);
  const filtered = await evaluationController.workbench({ interviewerUserId: 'user_b' }, mine);
  assert.deepEqual(filtered.items.map(item => item.id), ['organized']);
  assert.deepEqual((await evaluationController.analytics(mine)).interviewers.map(item => item.userId), ['user_a']);
  assert.throws(() => controller.appointments({}, {}), /可信面试访问范围/);
});

test('direct detail, question export, feedback, writes and alternate scheduling entry deny unrelated interviews', async context => {
  const { authorize, profile } = setup(context);
  for (const path of ['/api/interviews/appointments/other', '/api/interviews/appointments/rec_other', '/api/interview-evaluations/interviews/other/feedback', '/api/interview-evaluations/interviews/other/aggregate', '/api/interview-evaluations/interviews/other/questions', '/api/interview-evaluations/interviews/other/questions/export']) {
    await assert.rejects(() => authorize(path), /本人参与、组织/);
  }
  for (const action of ['cancel', 'retry-sync', 'retry-invitation', 'result', 'reschedule-decision']) await assert.rejects(() => authorize(`/api/interviews/appointments/other/${action}`, 'POST'), /本人参与、组织/);
  await assert.rejects(() => authorize('/api/interviews/scheduling-candidate', 'POST', { interviewId: 'other' }), /本人参与、组织/);
  await assert.rejects(() => authorize('/api/interview-evaluations/interviews/own/feedback', 'POST', { interviewerUserId: 'user_b' }), /代替其他/);
  await authorize('/api/interview-evaluations/interviews/own/feedback', 'POST', { interviewerUserId: 'user_a' });
  await authorize('/api/interviews/appointments/legacy');
  await assert.rejects(() => authorize('/api/interviews/reschedule-jobs/unknown'), /其他用户/);
  profile.roleCodes = ['system_admin'];
  await authorize('/api/interviews/appointments/other');
  await authorize('/api/interview-evaluations/interviews/other/questions/export');
});

test('new invitations bind organizer to the authenticated identity instead of client payload', async context => {
  const { authorize } = setup(context);
  let saved;
  const controller = new InterviewsController({ createAppointment: async body => { saved = body; return {}; } });
  const request = await authorize('/api/interviews/appointments', 'POST');
  await controller.create({ candidateId: 'candidate', organizerUserId: 'forged', operator: '伪造管理员' }, undefined, undefined, request);
  assert.equal(saved.organizerUserId, 'user_a');
  assert.equal(saved.operator, '甲');
});
