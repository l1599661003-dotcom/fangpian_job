import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { llm } from '../dist/platform/llm.js';
import { jobs } from '../dist/platform/jobs.js';
import { QuestionBankService } from '../dist/modules/assessments/question-bank.service.js';
import { EmployeeLifecycleService } from '../dist/modules/employee-lifecycle/employee-lifecycle.service.js';

function fixture(context) {
  const records = new Map();
  const saved = Object.fromEntries(['listAllRecords', 'listByField', 'findOneByField', 'createRecord', 'updateRecord'].map(key => [key, teable[key]]));
  const chat = llm.chat;
  context.after(() => { Object.assign(teable, saved); llm.chat = chat; });
  let sequence = 0;
  teable.listAllRecords = async name => records.get(name) || [];
  teable.listByField = async (name, field, value) => (records.get(name) || []).filter(row => row.fields[field] === value);
  teable.findOneByField = async (name, field, value) => (await teable.listByField(name, field, value))[0];
  teable.createRecord = async (name, fields) => { const row = { id: `rec_${++sequence}`, fields: { ...fields } }; records.set(name, [...(records.get(name) || []), row]); return row; };
  teable.updateRecord = async (name, recordId, fields) => { const row = (records.get(name) || []).find(row => row.id === recordId); assert.ok(row); Object.assign(row.fields, fields); return row; };
  const database = { requireTableId: name => name };
  return { records, bank: new QuestionBankService(database), lifecycle: new EmployeeLifecycleService(database, {}, {}) };
}
const positions = [{ id: 'pos_a', name: '产品经理', department: '自孵' }, { id: 'pos_b', name: '产品经理', department: '签约' }];
async function waitJob(jobId) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const job = jobs.get(jobId);
    if (job?.status !== 'running') return job;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('job did not finish');
}

test('question import validates all rows, deduplicates retries and isolates same-name jobs and personal ownership', async context => {
  const { bank, records } = fixture(context);
  assert.throws(() => bank.import(positions[0], 'manager', '面试官', { questions: [{ title: '有效题目' }, { title: '' }] }), /第 2 行/);
  assert.equal(records.get('recruitment_question_bank'), undefined);
  const input = { questions: [{ title: '请说明一次项目复盘', referenceAnswer: '职责、证据和改进' }, { title: '请说明一次项目复盘' }] };
  const [first, second] = await Promise.all([bank.import(positions[0], 'manager', '面试官', input), bank.import(positions[0], 'manager', '面试官', input)]);
  assert.equal(first.created + second.created, 1);
  assert.equal(first.skipped + second.skipped, 3);
  await bank.import(positions[1], 'manager', '面试官', input);
  await bank.import(positions[0], 'other', '其他面试官', { ...input, scope: 'personal' });
  assert.equal((await bank.list(positions, 'manager', { positionId: 'pos_a' })).questions.length, 1);
  assert.equal((await bank.list(positions, 'manager', { scope: 'personal' })).questions.length, 0);
  const personal = (await bank.list(positions, 'other', { scope: 'personal' })).questions[0];
  await assert.rejects(() => bank.update(personal.id, positions, 'manager', { status: '已发布' }), /自己的/);
  await assert.rejects(() => bank.list([positions[0]], 'manager', { positionId: 'pos_b' }), /权限/);
  const question = (await bank.list(positions, 'manager', { positionId: 'pos_b' })).questions[0];
  await assert.rejects(() => bank.update(question.id, [positions[0]], 'manager', { title: '不允许跨部门修改' }), /权限/);
  await bank.update(question.id, positions, 'manager', { status: '已停用' });
  assert.equal((await bank.list(positions, 'manager', { positionId: 'pos_b', status: '已发布' })).questions.length, 0);
});

test('partial import reports failed rows and retry only adds missing questions', async context => {
  const { bank } = fixture(context), create = teable.createRecord;
  let fail = true;
  teable.createRecord = async (table, fields) => { if (fail && fields['题干'] === '题目二') throw new Error('模拟暂时失败'); return create(table, fields); };
  const input = { questions: [{ title: '题目一' }, { title: '题目二' }] };
  assert.deepEqual(await bank.import(positions[0], 'manager', '面试官', input), { created: 1, skipped: 0, failed: 1, errors: [{ row: 2, message: '模拟暂时失败' }] });
  fail = false;
  assert.deepEqual(await bank.import(positions[0], 'manager', '面试官', input), { created: 1, skipped: 1, failed: 0, errors: [] });
});

test('completed onboarding evaluation persists feedback failure and retries into shared and personal drafts once', async context => {
  const { lifecycle, records, bank } = fixture(context);
  await teable.createRecord('recruitment_positions', { 职位ID: 'pos_a', 职位名称: '产品经理' });
  await teable.createRecord('recruitment_onboarding_cases', { 入职单ID: 'onboard_a', 候选人ID: 'candidate', 职位ID: 'pos_a', 岗位: '产品经理' });
  const review = await teable.createRecord('recruitment_probation_reviews', { 试用期记录ID: 'review_a', 入职单ID: 'onboard_a', 候选人ID: 'candidate', 处理状态: '已完成', 述职评价: '目标拆解能力需要提升', 扩展信息JSON: JSON.stringify({ evaluationUrl: 'keep-existing' }) });
  await teable.createRecord('recruitment_interviews', { 面试ID: 'interview_a', 候选人ID: 'candidate', 面试状态: '已完成', 面试官用户IDJSON: '["manager"]' });
  let calls = 0;
  llm.chat = async () => { calls++; if (calls === 2) throw new Error('模拟个人题库失败'); return JSON.stringify([{ question: '请举例说明你如何拆解目标', why: '检验目标拆解', observation: '责任与验收标准' }]); };
  await assert.rejects(() => lifecycle.startProbationQuestionFeedback('review_a', ['pos_b']), /权限/);
  assert.equal(JSON.parse(review.fields['扩展信息JSON']).questionBank, undefined);
  const first = await lifecycle.startProbationQuestionFeedback('review_a');
  assert.equal((await waitJob(first.jobId)).status, 'failed');
  assert.equal(JSON.parse(review.fields['扩展信息JSON']).questionBank.status, '失败');
  assert.equal((await bank.list(positions, 'manager', {})).feedbackJobs[0].status, '失败');
  const second = await lifecycle.startProbationQuestionFeedback('review_a', ['pos_a']);
  assert.equal((await waitJob(second.jobId)).status, 'done');
  const questions = records.get('recruitment_question_bank');
  assert.equal(questions.length, 2);
  assert.deepEqual(new Set(questions.map(row => row.fields['适用面试官用户ID'])), new Set(['', 'manager']));
  assert.ok(questions.every(row => row.fields['题目状态'] === '草稿' && row.fields['题目来源'] === '入职评价反哺'));
  assert.equal(JSON.parse(review.fields['扩展信息JSON']).evaluationUrl, 'keep-existing');
  assert.equal((await lifecycle.startProbationQuestionFeedback('review_a')).status, '已完成');
  assert.equal(calls, 3);
});
