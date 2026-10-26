import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TalentsController } from '../dist/modules/talents/talents.controller.js';
import { PublicInterviewsController } from '../dist/modules/interviews/public-interviews.controller.js';
import { jobs, jobAccessContext } from '../dist/platform/jobs.js';

test('internal communication extraction returns a protected job before AI completes', async () => {
  let finish;
  const controller = new TalentsController({
    extractCommunicationTranscript: (transcript, timeout) => {
      assert.equal(transcript, '沟通原文');
      assert.equal(timeout, 120000);
      return new Promise(resolve => { finish = resolve; });
    },
  });
  const started = jobAccessContext.run({ userId: 'hr', actionsAny: ['record_communication'] }, () => controller.extractCommunicationTranscript({ transcript: '沟通原文', background: true }));
  assert.equal(jobs.get(started.jobId).status, 'running');
  assert.equal(jobs.getAccess(started.jobId).userId, 'hr');
  assert.equal(jobs.isPublic(started.jobId), false);
  finish({ extraction: { channel: '电话' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.get(started.jobId).data.extraction.channel, '电话');
});

test('public communication extraction validates the link before creating a public polling job', async () => {
  let valid = false;
  let calls = 0;
  const controller = new PublicInterviewsController({
    publicCommunicationDetail: async () => { if (!valid) throw new Error('链接已过期'); },
  }, {
    extractCommunicationTranscript: async () => { calls += 1; throw new Error('AI服务暂不可用'); },
  });
  await assert.rejects(() => controller.extractCommunicationLink('invalid', { transcript: '原文', background: true }), /链接已过期/);
  assert.equal(calls, 0);
  valid = true;
  const started = await controller.extractCommunicationLink('valid', { transcript: '原文', background: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.isPublic(started.jobId), true);
  assert.equal(jobs.get(started.jobId).status, 'failed');
  assert.match(jobs.get(started.jobId).error, /AI服务暂不可用/);
});

test('communication extraction keeps the existing synchronous API contract', async () => {
  const controller = new TalentsController({ extractCommunicationTranscript: async () => ({ extraction: { channel: '电话' } }) });
  assert.equal((await controller.extractCommunicationTranscript({ transcript: '原文' })).extraction.channel, '电话');
});

const source = readFileSync(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('  async function waitForBackgroundJob('), source.indexOf('  async function extractCommunicationTranscript()'));
function extractionHarness(request) {
  let elapsed = 0;
  const context = vm.createContext({ request, Date: { now: () => elapsed }, setTimeout: callback => { elapsed += 1500; callback(); } });
  vm.runInContext(`${helper}\nthis.extract = requestCommunicationExtraction;`, context);
  return context.extract;
}

test('frontend continues polling beyond 15 seconds and tolerates a temporary network failure', async () => {
  let polls = 0;
  const status = { textContent: '' };
  const extract = extractionHarness(async (path, options) => {
    if (options?.method === 'POST') {
      assert.equal(JSON.parse(options.body).background, true);
      return { jobId: 'test' };
    }
    polls += 1;
    if (polls === 2) throw new Error('网络暂时不可用');
    return polls < 15 ? { status: 'running', progress: '正在解析' } : { status: 'done', data: { extraction: { channel: '电话' } } };
  });
  assert.equal((await extract('api/extract', '原文', status)).extraction.channel, '电话');
  assert.equal(polls, 15);
  assert.match(status.textContent, /无需重复点击/);
});

test('frontend reports background failures and rejects oversized input without sending', async () => {
  let requests = 0;
  const extract = extractionHarness(async () => {
    requests += 1;
    return requests === 1 ? { jobId: 'test' } : { status: 'failed', error: 'AI解析超时' };
  });
  await assert.rejects(() => extract('api/extract', '原文'), /AI解析超时/);
  await assert.rejects(() => extract('api/extract', '字'.repeat(20001)), /最多20000字/);
  assert.equal(requests, 2);
});
