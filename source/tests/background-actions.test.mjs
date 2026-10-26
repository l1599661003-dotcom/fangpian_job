import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { from, lastValueFrom, of } from 'rxjs';
import { BackgroundActionsInterceptor, BACKGROUND_ACTION_PATHS } from '../dist/platform/background-actions.js';
import { jobs, jobAccessContext } from '../dist/platform/jobs.js';
import { AccessAuditInterceptor } from '../dist/modules/database/access-audit.interceptor.js';
import { RecruitmentController } from '../dist/modules/recruitment/recruitment.controller.js';
import { EvaluationsController } from '../dist/modules/interviews/evaluations.controller.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function contextFor(path, userId = 'hr', requestId = randomUUID()) {
  const request = {
    path, method: 'POST', body: { note: 'test' }, query: {}, headers: { 'x-background-action': requestId },
    ...(userId ? { recruitmentAccess: { identity: { userId, userName: userId }, profile: {} }, recruitmentAccessPolicy: { pagesAny: ['interviews'], actionsAny: ['submit_interview_feedback'] } } : {}),
  };
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }), request };
}

test('slow writes return immediately, keep access context, and deduplicate retry requests', async () => {
  const interceptor = new BackgroundActionsInterceptor();
  const context = contextFor('/api/interview-evaluations/interviews/interview/feedback');
  let complete, executions = 0;
  const next = { handle: () => {
    executions += 1;
    assert.equal(jobAccessContext.getStore().userId, 'hr');
    return from(new Promise(resolve => { complete = resolve; }));
  } };
  const first = await lastValueFrom(interceptor.intercept(context, next));
  const repeated = await lastValueFrom(interceptor.intercept(context, next));
  assert.equal(first.jobId, repeated.jobId);
  assert.equal(executions, 1);
  assert.equal(jobs.get(first.jobId).status, 'running');
  assert.equal(jobs.getAccess(first.jobId).userId, 'hr');
  assert.equal(jobs.isPublic(first.jobId), false);
  complete({ saved: true });
  await flush();
  assert.equal(jobs.get(first.jobId).data.saved, true);
  assert.equal((await lastValueFrom(interceptor.intercept(context, next))).jobId, first.jobId);
  assert.equal(executions, 1);
});

test('background writes preserve redaction and only audit business success after completion', async () => {
  const interceptor = new BackgroundActionsInterceptor();
  const context = contextFor('/api/offers');
  const audits = [];
  const audit = new AccessAuditInterceptor({
    redactSensitiveResponse: value => ({ ...value, salary: 'hidden' }),
    auditAccess: async (...args) => { audits.push(args[4]); },
  });
  let complete;
  const started = await lastValueFrom(interceptor.intercept(context, {
    handle: () => audit.intercept(context, { handle: () => from(new Promise(resolve => { complete = resolve; })) }),
  }));
  assert.equal(audits.length, 0);
  complete({ salary: 123 });
  await flush();
  assert.equal(jobs.get(started.jobId).data.salary, 'hidden');
  assert.deepEqual(audits, ['成功']);
});

test('opt-in only wraps approved JSON writes and never bypasses login', async () => {
  const interceptor = new BackgroundActionsInterceptor();
  const next = { handle: () => of({ original: true }) };
  assert.equal((await lastValueFrom(interceptor.intercept(contextFor('/api/access/login'), next))).original, true);
  const legacy = contextFor('/api/recruitment/monthly-demands');
  delete legacy.request.headers['x-background-action'];
  assert.equal((await lastValueFrom(interceptor.intercept(legacy, next))).original, true);
  assert.throws(() => interceptor.intercept(contextFor('/api/offers', ''), next), /请先登录/);
  const invalid = contextFor('/api/offers');
  invalid.request.headers['x-background-action'] = 'bad';
  assert.throws(() => interceptor.intercept(invalid, next), /标识无效/);
});

test('public submission executes token validation in its job and records failure rather than success', async () => {
  const started = await lastValueFrom(new BackgroundActionsInterceptor().intercept(contextFor('/api/public/interviews/communication', ''), {
    handle: () => { throw new Error('沟通链接已过期'); },
  }));
  await flush();
  assert.equal(jobs.isPublic(started.jobId), true);
  assert.equal(jobs.get(started.jobId).status, 'failed');
  assert.match(jobs.get(started.jobId).error, /链接已过期/);
});

test('demand extraction retains actor and department scope inside background jobs', async () => {
  const seen = [];
  const actor = { identity: { userId: 'hr' }, profile: { scope: 'actor' } };
  const controller = new RecruitmentController({
    departmentDemandScope: async () => ({ profile: { scope: 'department' } }),
    extractMonthlyDemandTranscript: async (transcript, profile, timeout) => { seen.push([transcript, profile.scope, timeout]); return { extraction: {} }; },
  }, { getRequestAccess: async () => actor });
  const first = await controller.extractMonthlyDemandTranscript({}, { transcript: '需求', background: true });
  const second = await controller.extractDepartmentDemand({}, { transcript: '部门需求', background: true });
  await flush();
  assert.deepEqual(seen, [['需求', 'actor', 120000], ['部门需求', 'department', 120000]]);
  assert.equal(jobs.get(first.jobId).status, 'done');
  assert.equal(jobs.get(second.jobId).status, 'done');
});

test('public interview extraction validates its token before starting and keeps the interview identity', async () => {
  let valid = false;
  const controller = new EvaluationsController({
    publicEvaluationDetail: async () => { if (!valid) throw new Error('评价链接无效'); return { interviewId: 'interview' }; },
    extractFeedbackTranscript: async (interviewId, transcript, timeout) => ({ interviewId, transcript, timeout }),
  });
  await assert.rejects(() => controller.extractPublic('token', { transcript: '记录', background: true }), /链接无效/);
  valid = true;
  const started = await controller.extractPublic('token', { transcript: '记录', background: true });
  await flush();
  assert.deepEqual(jobs.get(started.jobId).data, { interviewId: 'interview', transcript: '记录', timeout: 120000 });
});

const source = readFileSync(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
const frontend = source.slice(source.indexOf('  const backgroundActionPaths ='), source.indexOf('  async function request(path,'));
function frontendHarness(request, waitForBackgroundJob = async () => ({ saved: true })) {
  const context = vm.createContext({
    accessEpoch: 0, crypto: { randomUUID }, Headers, HTMLButtonElement: class {},
    document: { activeElement: null }, setRequestButtonBusy: () => {}, request, waitForBackgroundJob,
  });
  vm.runInContext(`${frontend}\nthis.run = requestBackgroundAction; this.paths = backgroundActionPaths;`, context);
  return context;
}

test('frontend and backend background action allowlists match', () => {
  const context = frontendHarness();
  assert.deepEqual(Array.from(context.paths, pattern => `^\\/${pattern.source.slice(1)}`), BACKGROUND_ACTION_PATHS.map(pattern => pattern.source));
});

test('lost acknowledgement retries use the same request identity, then resume the existing job', async () => {
  const ids = [];
  let polls = 0;
  const context = frontendHarness(async (path, options) => {
    ids.push(options.headers.get('x-background-action'));
    if (ids.length === 1) throw new Error('网络中断');
    return { jobId: 'same-job' };
  }, async jobId => {
    assert.equal(jobId, 'same-job');
    polls += 1;
    if (polls === 1) throw new Error('查询超时');
    return { saved: true };
  });
  const options = { method: 'POST', body: '{}' };
  await assert.rejects(() => context.run('api/offers', options), /不会重复提交/);
  await assert.rejects(() => context.run('api/offers', options), /不会重复提交/);
  assert.equal((await context.run('api/offers', options)).saved, true);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});
