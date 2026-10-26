import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { interviewScheduleUrl, interviewQuestionsUrl } from '../dist/platform/app-links.js';
import { teable } from '../dist/platform/teable.js';
import { wecom } from '../dist/platform/mcp.js';
import { llm } from '../dist/platform/llm.js';
import { jobs } from '../dist/platform/jobs.js';
import { tianjiWeixinMessage } from '../dist/platform/tianji-weixin-message.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { EvaluationService } from '../dist/modules/interviews/evaluation.service.js';
import { InterviewsService } from '../dist/modules/interviews/interviews.service.js';
import { PublicInterviewsController } from '../dist/modules/interviews/public-interviews.controller.js';
import { MessagesService } from '../dist/modules/messages/messages.service.js';
import { RecruitmentFlowTaskRunner } from '../dist/tasks/recruitment-flow.task.js';
import { isInterviewStartingSoon } from '../dist/modules/interviews/interview-reminders.js';

function installMemory() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const originals = {};
  for (const method of ['listRecords', 'listAllRecords', 'listByField', 'findOneByField', 'getRecord', 'createRecord', 'updateRecord']) originals[method] = teable[method];
  let sequence = 0;
  teable.listRecords = teable.listAllRecords = async (table) => [...(records.get(table) || [])];
  teable.listByField = async (table, field, value) => (records.get(table) || []).filter(row => row.fields[field] === value);
  teable.findOneByField = async (table, field, value) => (records.get(table) || []).find(row => row.fields[field] === value);
  teable.getRecord = async (table, recordId) => (records.get(table) || []).find(row => row.id === recordId);
  teable.createRecord = async (table, fields) => { const row = { id: `record_${++sequence}`, fields: {...fields} }; records.get(table).push(row); return row; };
  teable.updateRecord = async (table, recordId, fields) => { const row = records.get(table).find(item => item.id === recordId); Object.assign(row.fields, fields); return row; };
  return { records, restore: () => Object.assign(teable, originals) };
}

test('scheduling resolves only a unique candidate phone or a consistent interview identity', async () => {
  const memory = installMemory();
  try {
    const service = new InterviewsService({ requireTableId: name => name }, {}, {});
    const candidate = await teable.createRecord('recruitment_candidates', { 候选人ID: 'person-a', 姓名: '候选人甲', 电话: '13800138000' });
    await teable.createRecord('recruitment_interviews', { 面试ID: 'interview-a', 候选人ID: 'person-a' });
    assert.equal((await service.resolveSchedulingCandidate({ phone: '+86 13800138000' })).candidate.id, 'person-a');
    assert.equal((await service.resolveSchedulingCandidate({ interviewId: 'interview-a' })).candidate.id, 'person-a');
    assert.equal((await service.resolveSchedulingCandidate({ candidateId: 'old-id', phone: '13800138000' })).candidate.id, 'person-a');
    await assert.rejects(() => service.resolveSchedulingCandidate({ candidateId: 'person-a', phone: '13900139000' }), /不一致/);
    await assert.rejects(() => service.resolveSchedulingCandidate({ candidateId: 'other', interviewId: 'interview-a' }), /不一致/);
    await assert.rejects(() => service.resolveSchedulingCandidate({ phone: '138****8000' }), /完整11位/);
    await assert.rejects(() => service.resolveSchedulingCandidate({ phone: '13900139000' }), /没有匹配/);
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'person-b', 姓名: '同手机号', 电话: '13800138000' });
    await assert.rejects(() => service.resolveSchedulingCandidate({ phone: '13800138000' }), /多份人才档案/);
    candidate.fields['合并状态'] = '已合并';
    assert.equal((await service.resolveSchedulingCandidate({ phone: '13800138000' })).candidate.id, 'person-b');
    await assert.rejects(() => service.resolveSchedulingCandidate({}), /没有匹配/);
  } finally { memory.restore(); }
});

test('schedule links always contain their candidate with or without a configured public base', () => {
  const previous = process.env.APP_PUBLIC_URL;
  try {
    for (const base of ['', 'https://talent.example.test/', 'https://studio.example.test/apps/talent/']) {
      process.env.APP_PUBLIC_URL = base;
      const url = new URL(interviewScheduleUrl('candidate & one', 'interview-one'), 'https://fallback.example.test');
      assert.equal(url.searchParams.get('candidate_id'), 'candidate & one');
      assert.equal(url.searchParams.get('flow_action'), 'schedule');
      assert.equal(url.searchParams.get('interview_id'), 'interview-one');
      assert.equal(url.hash, '');
    }
    assert.throws(() => interviewScheduleUrl(''), /必须绑定候选人/);
  } finally { if (previous === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = previous; }
});

test('question links use one durable interview parameter and never fall back to evaluation', () => {
  const previous = process.env.APP_PUBLIC_URL;
  try {
    process.env.APP_PUBLIC_URL = 'https://example.test/app/?evaluation_token=stale#evaluation';
    const url = new URL(interviewQuestionsUrl('interview & one'));
    assert.equal(url.pathname, '/app/');
    assert.deepEqual([...url.searchParams], [['interview_questions', 'interview & one']]);
    assert.equal(url.hash, '');
    assert.throws(() => interviewQuestionsUrl(''), /绑定面试记录/);
    process.env.APP_PUBLIC_URL = '';
    assert.throws(() => interviewQuestionsUrl('interview'), /缺少应用公开地址/);
  } finally { if (previous === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = previous; }
});

test('public communication binds the saved record and next reminder to the token candidate', async () => {
  const memory = installMemory();
  try {
    const notices = [];
    const service = new InterviewsService({ requireTableId: name => name }, { notifyPositionHr: async input => { notices.push(input); } }, {});
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'linked-person', 姓名: '沟通候选人' });
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'linked-application', 候选人ID: 'linked-person', 当前阶段: '意向沟通', 创建时间: '2026-09-01T00:00:00.000Z', 更新时间: '2026-09-01T00:00:00.000Z' });
    await teable.createRecord('recruitment_public_links', { 候选人ID: 'linked-person', 链接类型: '意向沟通', 访问Token哈希: createHash('sha256').update('valid-token').digest('hex'), 链接状态: '有效', 过期时间: new Date(Date.now() + 86400000).toISOString() });
    const body = { channel: '电话', answerStatus: '已接通', interestLevel: '高', jobStatus: '已离职', result: '推进面试' };
    await assert.rejects(() => service.submitPublicCommunicationByToken('valid-token', { ...body, candidateId: 'different-person' }), /不一致/);
    assert.equal(memory.records.get('recruitment_communications').length, 0);
    const result = await service.submitPublicCommunicationByToken('valid-token', body);
    assert.equal(result.status, '已提交');
    assert.equal(result.candidateId, 'linked-person');
    assert.equal(new URL(result.scheduleUrl, 'https://example.test').searchParams.get('candidate_id'), 'linked-person');
    assert.equal(memory.records.get('recruitment_communications')[0].fields['候选人ID'], 'linked-person');
    assert.equal(memory.records.get('recruitment_communications')[0].fields['应聘记录ID'], 'linked-application');
    assert.equal(notices[0].candidateId, 'linked-person');
    assert.equal(notices.length, 1);
    assert.ok(notices[0].markdown.includes(`](${result.scheduleUrl})`));
  } finally { memory.restore(); }
});

test('interview creation pre-generates questions and only sends concise access at the right times', async () => {
  const memory = installMemory();
  const previous = { wecom: wecom.cli, tianji: tianjiWeixinMessage.send, llm: llm.chat, publicUrl: process.env.APP_PUBLIC_URL };
  const previousDateNow = Date.now, fixedNow = Date.parse('2026-10-10T02:00:00.000Z');
  process.env.APP_PUBLIC_URL = 'https://interview.example.test';
  Date.now = () => fixedNow;
  const sent = [], calendars = [];
  let failReminder = true;
  try {
    wecom.cli = async (argv) => { calendars.push(argv); return { schedule_id: 'existing_calendar' }; };
    tianjiWeixinMessage.send = async (input) => {
      if (input.message.includes('面试即将开始') && failReminder) { failReminder = false; throw new Error('temporary Tianji failure'); }
      sent.push(input); return { message_id: `sent_${sent.length}` };
    };
    llm.chat = async () => JSON.stringify([{question:'请说明你的项目成果',dimension:'专业能力',why:'核实经验',observation:'事实证据'}]);
    await teable.createRecord('recruitment_candidates', { 候选人ID:'candidate', 姓名:'测试候选人', 期望职位:'产品经理' });
    await teable.createRecord('recruitment_positions', { 职位ID:'position', 职位名称:'产品经理' });
    for (const user of ['manager_a','manager_b']) await teable.createRecord('recruitment_users', { 用户ID:user, 姓名:user, 天玑微信ID:`tianji_${user}`, 用户状态:'启用' });
    const interview = await teable.createRecord('recruitment_interviews', {
      面试ID:'interview', 候选人ID:'candidate', 职位ID:'position', 面试轮次:'一面',
      面试状态:'已确认', 候选人确认状态:'已确认', 面试题状态:'待生成', 外部预约ID:'existing_calendar',
      面试官用户IDJSON:JSON.stringify(['manager_a','manager_b']), 面试官姓名JSON:JSON.stringify(['面试官甲','面试官乙']),
      开始时间:new Date(Date.now()+20*60_000).toISOString(), 结束时间:new Date(Date.now()+80*60_000).toISOString(), 面试地点:'3楼会议室A',
      候选人操作Token哈希:createHash('sha256').update('candidate_token').digest('hex'), 操作链接过期时间:new Date(Date.now()+86400000).toISOString(),
    });
    const database = { requireTableId: name => name };
    const messages = new MessagesService(database);
    const evaluation = new EvaluationService(database, messages);
    assert.equal((await evaluation.checkBeforeInterviews()).notified, 0);
    assert.equal(sent.length, 0);
    const questionJob = evaluation.queueInterviewQuestionGeneration({interviewId:'interview'});
    for (let attempt=0; attempt<100 && jobs.get(questionJob.jobId)?.status==='running'; attempt++) await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(jobs.get(questionJob.jobId).status, 'done');
    assert.equal(calendars.length, 0);
    assert.equal(interview.fields['外部预约ID'], 'existing_calendar');
    assert.equal(interview.fields['面试题状态'], '已生成待推送');
    assert.ok(JSON.parse(interview.fields['面试题快照JSON']).length >= 1);
    assert.equal(sent.length, 0);
    interview.fields['开始时间'] = new Date(Date.now() + 9 * 60_000).toISOString();
    const firstCheck = await evaluation.checkBeforeInterviews();
    assert.equal(firstCheck.errors.length, 1);
    const secondCheck = await evaluation.checkBeforeInterviews();
    assert.equal(secondCheck.errors.length, 0);
    assert.equal(interview.fields['面试题状态'], '已发布');
    assert.equal(sent.filter(item=>item.message.includes('【面试即将开始】')).length, 2);
    for (const item of sent.filter(item=>item.message.includes('【面试即将开始】'))) {
      assert.equal(item.message.includes('【面试题】'), false);
      assert.equal(item.message.includes('请说明你的项目成果'), false);
      assert.match(item.message, /时间：.+（北京时间）/);
      assert.match(item.message, /地点：3楼会议室A/);
      const target = new URL(item.message.match(/\[打开并打印面试题 →\]\(([^)]+)\)/)[1]);
      assert.equal(target.searchParams.get('interview_questions'), 'interview');
      assert.equal(target.searchParams.has('evaluation_token'), false);
      assert.equal(target.hash, '');
    }
    assert.deepEqual(new Set(sent.map(item=>item.wechatId)), new Set(['tianji_manager_a','tianji_manager_b']));
    const sentCount = sent.length;
    await evaluation.checkBeforeInterviews();
    assert.equal(sent.length, sentCount);
    interview.fields['开始时间'] = new Date(Date.now()-37*3_600_000).toISOString();
    interview.fields['结束时间'] = new Date(Date.now()-36*3_600_000).toISOString();
    const feedbackSla = await evaluation.checkFeedbackSla('测试');
    assert.equal(feedbackSla.errors.length, 0);
    assert.equal(sent.filter(item=>item.message.includes('【面试评价入口】')).length, 2);
    const initialMessageCount = sent.filter(item=>item.message.includes('【面试评价入口】')).length;
    await evaluation.checkFeedbackSla('测试');
    assert.equal(sent.filter(item=>item.message.includes('【面试评价待提交】')).length, 2);
    const dailyCount = sent.length;
    await evaluation.checkFeedbackSla('测试');
    assert.equal(sent.length, dailyCount);
    assert.equal(initialMessageCount, 2);
    const links = memory.records.get('recruitment_public_links');
    assert.equal(links.length, 2);
    const linkA = links.find(row=>row.fields['对象ID']==='interview:manager_a');
    const tokenA = new URL(linkA.fields['访问路径']).searchParams.get('evaluation_token');
    const tokenB = new URL(links.find(row=>row.fields['对象ID']==='interview:manager_b').fields['访问路径']).searchParams.get('evaluation_token');
    interview.fields['面试题快照JSON'] = JSON.stringify([{question:'公共题'}, {question:'甲的专属题',interviewerIds:['manager_a']}, {question:'乙的专属题',interviewerIds:['manager_b']}]);
    await evaluation.savePublicEvaluationDraft(tokenA, {transcript:'会议全程记录',comment:'甲的评价草稿',questionAnswers:{公共题:{answer:'项目数据'}}});
    assert.equal((await evaluation.publicEvaluationDetail(tokenA)).draft.transcript, '会议全程记录');
    assert.equal((await evaluation.publicEvaluationDetail(tokenB)).draft, null);
    assert.deepEqual((await evaluation.publicEvaluationDetail(tokenA)).questionSnapshot.map(item=>item.question), ['公共题','甲的专属题']);
    llm.chat = async () => JSON.stringify({recommendation:'通过',strengths:'项目证据明确',comment:'建议推进'});
    assert.equal((await evaluation.extractPublicEvaluation(tokenA,'面试总结建议通过')).extraction.recommendation, '通过');
    const publicEvaluation='面试官已根据候选人的实际项目经历、个人职责、量化成果和岗位要求完成独立评价，关键事实清晰，建议按流程推进。'.repeat(2);
    const submitted = await evaluation.submitPublicEvaluation(tokenA,{scores:{professional:80},recommendation:'通过',candidateRating:'S',strengths:'项目证据明确',notes:'会议全程记录',aiSummary:'AI整理的项目总结',interviewerEvaluation:publicEvaluation,comment:publicEvaluation,evidence:{transcript:'会议全程记录'}});
    assert.equal(submitted.submitted, 1);
    assert.equal(linkA.fields['链接状态'], '已完成');
    const repeated = await evaluation.submitPublicEvaluation(tokenA,{recommendation:'淘汰',comment:'不得覆盖已提交评价'});
    assert.equal(repeated.alreadySubmitted, true);
    assert.equal(repeated.feedbackId, submitted.feedbackId);
    assert.equal(memory.records.get('recruitment_interview_feedback').find(row=>row.fields['评价ID']===submitted.feedbackId).fields['推荐结论'], '通过');
    assert.equal(memory.records.get('recruitment_interview_feedback').find(row=>row.fields['评价ID']===submitted.feedbackId).fields['候选人评级'], 'S');
    assert.equal(memory.records.get('recruitment_interview_feedback').find(row=>row.fields['评价ID']===submitted.feedbackId).fields['AI面试总结'], 'AI整理的项目总结');
    assert.equal(memory.records.get('recruitment_interview_feedback').find(row=>row.fields['评价ID']===submitted.feedbackId).fields['面试官评价'], publicEvaluation);
    await assert.rejects(()=>evaluation.savePublicEvaluationDraft(tokenA,{transcript:'覆盖已提交记录'}), /失效/);
    interview.fields['面试状态']='已取消';
    await assert.rejects(()=>evaluation.publicEvaluationDetail(tokenB), /取消/);
  } finally {
    Date.now = previousDateNow;
    wecom.cli=previous.wecom; tianjiWeixinMessage.send=previous.tianji; llm.chat=previous.llm;
    if(previous.publicUrl===undefined)delete process.env.APP_PUBLIC_URL;else process.env.APP_PUBLIC_URL=previous.publicUrl;
    memory.restore();
  }
});

test('candidates cannot cancel interviews; the public link exposes only confirm and reschedule', () => {
  assert.equal(InterviewsService.prototype.candidateDecline, undefined);
  assert.equal(PublicInterviewsController.prototype.decline, undefined);
  assert.equal(typeof PublicInterviewsController.prototype.reschedule, 'function');
});

test('failed room cancellation is retried as cancellation, never as a new reservation', async (context) => {
  const memory=installMemory();
  const originalTianji={cancelSchedule:tianjiWeixinMessage.cancelSchedule,createSchedule:tianjiWeixinMessage.createSchedule};
  const cancellations=[], schedules=[];
  context.after(()=>{memory.restore();Object.assign(tianjiWeixinMessage,originalTianji);});
  const row=await teable.createRecord('recruitment_interviews',{面试ID:'cancel_retry',候选人ID:'candidate',面试状态:'已取消',候选人确认状态:'已取消',同步状态:'同步失败',外部预约ID:'calendar_existing',面试官用户IDJSON:'[]',开始时间:new Date(Date.now()+3600000).toISOString(),结束时间:new Date(Date.now()+7200000).toISOString()});
  const interviews=new InterviewsService({requireTableId:name=>name},{notifyPositionHr:async()=>({status:'已发送'})},{});
  interviews.resolveWecomAttendees=async()=>[];
  tianjiWeixinMessage.cancelSchedule=async()=>{throw new Error('temporary cancellation failure');};
  assert.equal((await interviews.checkDeliveryRecovery()).errors.length,1);
  assert.equal(memory.records.get('recruitment_tasks')[0].fields['待办状态'],'待处理');
  tianjiWeixinMessage.cancelSchedule=async(scheduleId)=>{cancellations.push(scheduleId);return{scheduleId,response:{errcode:0}};};
  tianjiWeixinMessage.createSchedule=async(input)=>{schedules.push(input);return{scheduleId:'calendar_replacement',response:{errcode:0}};};
  assert.equal((await interviews.checkDeliveryRecovery()).recovered,1);
  assert.equal(row.fields['同步状态'],'已同步');
  assert.equal(memory.records.get('recruitment_tasks')[0].fields['待办状态'],'已完成');
  assert.deepEqual(cancellations,['calendar_existing']);
  row.fields['面试状态']='待候选人确认';
  await interviews.retrySync('cancel_retry');
  assert.equal(schedules.length,1);
  assert.deepEqual(cancellations,['calendar_existing','calendar_existing']);
});

test('legacy cancelled interviews without an external schedule are archived without failing recovery', async (context) => {
  const memory=installMemory();
  context.after(()=>memory.restore());
  const row=await teable.createRecord('recruitment_interviews',{面试ID:'legacy_cancel_without_calendar',候选人ID:'candidate',面试状态:'已取消',候选人确认状态:'已取消',同步状态:'同步失败',外部预约ID:'',面试官用户IDJSON:'[]',开始时间:new Date(Date.now()+3600000).toISOString(),结束时间:new Date(Date.now()+7200000).toISOString()});
  await teable.createRecord('recruitment_tasks',{待办ID:'todo_legacy_cancel',待办类型:'面试异常处理',对象类型:'面试',对象ID:'legacy_cancel_without_calendar',待办状态:'待处理',创建时间:new Date().toISOString(),更新时间:new Date().toISOString()});
  const interviews=new InterviewsService({requireTableId:name=>name},{notifyPositionHr:async()=>({status:'已发送'})},{});
  interviews.retrySync=async()=>{throw new Error('cancelled record must not call external retry');};
  const result=await interviews.checkDeliveryRecovery();
  assert.equal(result.errors.length,0);
  assert.equal(result.recovered,1);
  assert.equal(row.fields['同步状态'],'已同步');
  assert.equal(row.fields['同步错误'],'');
  assert.equal(memory.records.get('recruitment_tasks')[0].fields['待办状态'],'已完成');
});

test('missing candidate email creates one pending task and does not fail scheduled recovery', async (context) => {
  const memory=installMemory();
  const notices=[];
  context.after(()=>memory.restore());
  await teable.createRecord('recruitment_candidates',{候选人ID:'candidate_without_email',姓名:'缺邮箱候选人',邮箱:''});
  await teable.createRecord('recruitment_interviews',{面试ID:'interview_without_email',候选人ID:'candidate_without_email',面试状态:'待候选人确认',候选人确认状态:'待确认',同步状态:'已同步',外部预约ID:'existing',面试官用户IDJSON:'[]',开始时间:new Date(Date.now()+3600000).toISOString(),结束时间:new Date(Date.now()+7200000).toISOString()});
  const interviews=new InterviewsService({requireTableId:name=>name},{notifyPositionHr:async input=>{notices.push(input);return{status:'已发送'}}},{});
  const first=await interviews.checkDeliveryRecovery();
  assert.equal(first.errors.length,0);
  assert.equal(first.pending,1);
  const tasks=memory.records.get('recruitment_tasks');
  assert.equal(tasks.length,1);
  assert.match(tasks[0].fields['描述'],/候选人邮箱不存在/);
  assert.equal(tasks[0].fields['待办状态'],'待处理');
  const second=await interviews.checkDeliveryRecovery();
  assert.equal(second.errors.length,0);
  assert.equal(second.pending,1);
  assert.equal(memory.records.get('recruitment_tasks').length,1);
  assert.equal(memory.records.get('recruitment_public_links').length,0);
  assert.equal(notices.length,1);
});

test('failed invitations reuse their link and successful delivery stops automatic resends', async (context) => {
  const memory=installMemory(), originalSendMail=tianjiWeixinMessage.sendMail, previousUrl=process.env.APP_PUBLIC_URL;
  context.after(()=>{memory.restore();tianjiWeixinMessage.sendMail=originalSendMail;if(previousUrl===undefined)delete process.env.APP_PUBLIC_URL;else process.env.APP_PUBLIC_URL=previousUrl;});
  process.env.APP_PUBLIC_URL='https://interview.example.test';
  await teable.createRecord('recruitment_candidates',{候选人ID:'candidate',姓名:'测试候选人',邮箱:'candidate@example.test'});
  await teable.createRecord('recruitment_interviews',{面试ID:'mail_retry',候选人ID:'candidate',面试状态:'待候选人确认',候选人确认状态:'待确认',同步状态:'已同步',外部预约ID:'existing',面试官用户IDJSON:'[]',开始时间:new Date(Date.now()+3600000).toISOString(),结束时间:new Date(Date.now()+7200000).toISOString()});
  const interviews=new InterviewsService({requireTableId:name=>name},{notifyPositionHr:async()=>({status:'已发送'})},{});
  tianjiWeixinMessage.sendMail=async()=>{throw new Error('temporary mail failure');};
  assert.equal((await interviews.retryInvitation('mail_retry')).status,'发送失败');
  const savedUrl=memory.records.get('recruitment_public_links')[0].fields['访问路径'];
  memory.records.get('recruitment_interview_mail_events')[0].fields['创建时间']=new Date(Date.now()-120000).toISOString();
  const calls=[];
  tianjiWeixinMessage.sendMail=async(input)=>{calls.push(input);return{messageId:'mail_sent',response:{errcode:0}};};
  assert.equal((await interviews.checkDeliveryRecovery()).recovered,1);
  assert.equal(memory.records.get('recruitment_public_links').length,1);
  assert.equal(calls[0].contentType, 'html');
  assert.deepEqual(calls[0].toEmails, ['candidate@example.test']);
  assert.match(calls[0].content, /查看面试安排/);
  assert.ok(calls[0].content.includes(savedUrl.replaceAll('&','&amp;'))||calls[0].content.includes(savedUrl));
  assert.equal((await interviews.checkDeliveryRecovery()).recovered,0);
  assert.equal(calls.length,1);
  const interview=memory.records.get('recruitment_interviews')[0];
  interview.fields['候选人确认状态']='待重新确认';
  interview.fields['最近同步时间']=new Date().toISOString();
  for(const event of memory.records.get('recruitment_interview_mail_events'))event.fields['创建时间']=new Date(Date.now()-120000).toISOString();
  assert.equal((await interviews.checkDeliveryRecovery()).recovered,1);
  assert.equal(calls.length,2);
  assert.equal((await interviews.checkDeliveryRecovery()).recovered,0);
});

test('online interview invitation emails carry one meeting link for unified and legacy modes', () => {
  const interviews = new InterviewsService({}, {}, {});
  const meetingUrl = 'https://work.weixin.qq.com/webapp/tm/video';
  const online = interviews.candidateEmailContent({ fields: { 开始时间: '2026-10-15T02:00:00Z', 面试方式: '线上面试', 会议地址: meetingUrl, 面试地点: '山东省烟台市莱山区方片新媒体' } }, { fields: { 姓名: '林悦' } }, 'https://example.test/?interview_token=abc');
  assert.match(online, /进入会议/);
  assert.ok(online.includes(`href="${meetingUrl}"`));
  assert.doesNotMatch(online, /进入视频会议|进入电话会议/);
  const legacy = interviews.candidateEmailContent({ fields: { 开始时间: '2026-10-15T02:00:00Z', 面试方式: '电话面试', 会议地址: meetingUrl, 面试地点: '山东省烟台市莱山区方片新媒体' } }, { fields: { 姓名: '林悦' } }, 'https://example.test/?interview_token=abc');
  assert.match(legacy, /线上面试/);
  assert.match(legacy, /进入会议/);
  assert.ok(legacy.includes(`href="${meetingUrl}"`));
  const withoutLink = interviews.candidateEmailContent({ fields: { 开始时间: '2026-10-15T02:00:00Z', 面试方式: '线上面试', 面试地点: '山东省烟台市莱山区方片新媒体' } }, { fields: { 姓名: '林悦' } }, 'https://example.test/?interview_token=abc');
  assert.doesNotMatch(withoutLink, /进入会议/);
});

test('invitation email is minimal and provides a safe no-login link', () => {
  const interviews = new InterviewsService({}, {}, {});
  const html = interviews.candidateEmailContent({ fields: { 开始时间: '2026-10-15T02:00:00Z', 面试地点: '<script>alert(1)</script>', 备注: '请带作品集\n提前到达' } }, { fields: { 姓名: '<img src=x onerror=alert(1)>' } }, 'https://example.test/?interview_token=abc&source=email');
  assert.ok(html.startsWith('<div style="margin:0;padding:18px 8px'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img/);
  assert.match(html, /面试邀请/);
  assert.match(html, /FANGPIAN · INTERVIEW/);
  assert.match(html, /查看面试安排/);
  assert.match(html, /interview_token=abc&amp;source=email/);
  assert.doesNotMatch(html, /温馨提示/);

});

test('start reminders run in the ten-minute window for active interviews', () => {
  const current = Date.parse('2026-10-01T11:50:00Z');
  const fields = { 候选人确认状态: '已确认', 面试状态: '已确认', 开始时间: new Date(current + 600_000).toISOString() };
  assert.equal(isInterviewStartingSoon({ fields }, current), true);
  for (const minutes of [11, 30, 0, -1]) assert.equal(isInterviewStartingSoon({ fields: { ...fields, 开始时间: new Date(current + minutes * 60_000).toISOString() } }, current), false);
  for (const status of ['已取消', '已完成']) assert.equal(isInterviewStartingSoon({ fields: { ...fields, 面试状态: status } }, current), false);
  assert.equal(isInterviewStartingSoon({ fields: { ...fields, 开始时间: 'invalid' } }, current), false);
});

test('candidate day-before reminders retry failures, deduplicate parallel checks and reschedule by the new start time', async context => {
  const memory = installMemory(), originalSendMail = tianjiWeixinMessage.sendMail;
  context.after(() => { memory.restore(); tianjiWeixinMessage.sendMail = originalSendMail; });
  const nextDayTenAmBeijing = new Date();
  nextDayTenAmBeijing.setUTCDate(nextDayTenAmBeijing.getUTCDate() + 1);
  nextDayTenAmBeijing.setUTCHours(2, 0, 0, 0);
  const interview = await teable.createRecord('recruitment_interviews', { 面试ID: 'start_reminder', 候选人ID: 'candidate', 候选人确认状态: '已确认', 面试状态: '已确认', 同步状态: '已同步', 开始时间: nextDayTenAmBeijing.toISOString(), 面试地点: '<会议室>', 面试方式: '线下面试' });
  const candidate = await teable.createRecord('recruitment_candidates', { 候选人ID: 'candidate', 姓名: '测试候选人', 邮箱: 'candidate@example.test' });
  await teable.createRecord('recruitment_public_links', { 对象ID: 'start_reminder', 链接类型: '面试邀请', 链接状态: '有效', 过期时间: new Date(Date.now() + 86400000).toISOString(), 访问路径: 'https://example.test/?interview_token=valid' });
  const service = new InterviewsService({ requireTableId: name => name }, {}, {});
  const sent = [];
  let fail = true;
  tianjiWeixinMessage.sendMail = async input => { if (fail) { fail = false; throw new Error('mail temporarily unavailable'); } sent.push(input); return { messageId: 'delivered', response: { errcode: 0 } }; };
  assert.equal((await service.checkCandidateDayBeforeReminders()).sent, 0);
  assert.equal((await service.checkCandidateDayBeforeReminders()).errors.length, 0);
  assert.equal(memory.records.get('recruitment_interview_mail_events')[0].fields['发送状态'], '发送失败');
  const failedEvent = memory.records.get('recruitment_interview_mail_events')[0];
  const cooledDown = new Date(Date.now() - 31 * 60_000).toISOString();
  failedEvent.fields['发送时间'] = cooledDown;
  failedEvent.fields['创建时间'] = cooledDown;
  await Promise.all([service.checkCandidateDayBeforeReminders(), service.checkCandidateDayBeforeReminders()]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].contentType, 'html');
  assert.deepEqual(sent[0].toEmails, ['candidate@example.test']);
  assert.match(sent[0].content, /面试安排提醒/);
  assert.match(sent[0].content, /&lt;会议室&gt;/);
  assert.match(sent[0].content, /interview_token=valid/);
  const restarted = new InterviewsService({ requireTableId: name => name }, {}, {});
  assert.equal((await restarted.checkCandidateDayBeforeReminders()).sent, 0);
  assert.equal(sent.length, 1);
  nextDayTenAmBeijing.setUTCHours(7, 0, 0, 0);
  interview.fields['开始时间'] = nextDayTenAmBeijing.toISOString();
  assert.equal((await service.checkCandidateDayBeforeReminders()).sent, 1);
  interview.fields['面试状态'] = '已取消';
  assert.equal((await service.checkCandidateDayBeforeReminders()).sent, 0);
  interview.fields['面试状态'] = '已确认';
  interview.fields['开始时间'] = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  candidate.fields['邮箱'] = '';
  const missing = await service.checkCandidateDayBeforeReminders();
  assert.equal(missing.errors.length, 1);
  assert.match(missing.errors[0], /未配置邮箱/);
  assert.equal(sent.length, 2);
});

test('online day-before reminder keeps the link as a clickable meeting button', async context => {
  const memory = installMemory(), originalSendMail = tianjiWeixinMessage.sendMail;
  context.after(() => { memory.restore(); tianjiWeixinMessage.sendMail = originalSendMail; });
  const meetingUrl = 'https://work.weixin.qq.com/webapp/tm/remind';
  await teable.createRecord('recruitment_interviews', { 面试ID: 'online_reminder', 候选人ID: 'candidate', 候选人确认状态: '已确认', 面试状态: '已确认', 同步状态: '已同步', 开始时间: new Date(Date.now() + 2 * 60 * 60_000).toISOString(), 面试地点: '山东省烟台市莱山区方片新媒体', 面试方式: '视频面试', 会议地址: meetingUrl });
  await teable.createRecord('recruitment_candidates', { 候选人ID: 'candidate', 姓名: '测试候选人', 邮箱: 'candidate@example.test' });
  await teable.createRecord('recruitment_public_links', { 对象ID: 'online_reminder', 链接类型: '面试邀请', 链接状态: '有效', 过期时间: new Date(Date.now() + 86400000).toISOString(), 访问路径: 'https://example.test/?interview_token=online' });
  const sent = [];
  tianjiWeixinMessage.sendMail = async input => { sent.push(input); return { messageId: 'online_reminder_mail', response: { errcode: 0 } }; };
  const result = await new InterviewsService({ requireTableId: name => name }, {}, {}).checkCandidateDayBeforeReminders();
  assert.equal(result.sent, 1);
  assert.match(sent[0].content, /面试方式<\/strong><br>线上面试/);
  assert.ok(sent[0].content.includes(`href="${meetingUrl}"`));
  assert.match(sent[0].content, /进入会议/);
});

test('daily reminder runner still checks candidates when interviewer delivery fails', async () => {
  const calls = [];
  const runner = new RecruitmentFlowTaskRunner({ checkCandidateDayBeforeReminders: async () => { calls.push('candidate'); return { sent: 1, errors: [] }; } }, { checkBeforeInterviews: async () => { throw new Error('Tianji unavailable'); } }, {});
  await assert.rejects(() => runner.runStartReminders(() => {}), /面试官开场提醒.*Tianji unavailable/);
  assert.deepEqual(calls, ['candidate']);
});

test('scheduled flow retries question delivery and continues independent checks after failures', async () => {
  const calls=[];
  const runner=new RecruitmentFlowTaskRunner({checkDeliveryRecovery:async()=>({errors:[]}),checkReminders:async()=>{throw new Error('reminder unavailable');}}, {
    checkFeedbackSla:async()=>{calls.push('after');},
    checkHrHandoffs:async()=>{calls.push('hr');return{errors:[]};},
    workbench:async()=>({items:[
      {id:'pending',confirmationStatus:'待确认',status:'待候选人确认',questionStatus:'待生成'},
      {id:'cancelled',confirmationStatus:'已确认',status:'已取消',questionStatus:'生成失败'},
      {id:'retry',confirmationStatus:'已确认',status:'已确认',questionStatus:'生成失败'},
    ]}),
    generateInterviewQuestions:async(input)=>{calls.push(input.interviewId);return{status:'已生成待推送'};},
  },{checkProbationReviewReminders:async()=>{calls.push('probation');},checkOnboardingArrivalReminders:async()=>{calls.push('arrival');}});
  await assert.rejects(()=>runner.run(()=>{}), /reminder unavailable/);
  assert.deepEqual(calls,['after','hr','pending','retry','probation','arrival']);
});

async function handoffFixture(context, interviewerIds=['manager_a','manager_b']) {
  const memory=installMemory();
  const originalSend=tianjiWeixinMessage.send, originalUrl=process.env.APP_PUBLIC_URL;
  context.after(()=>{memory.restore();tianjiWeixinMessage.send=originalSend;if(originalUrl===undefined)delete process.env.APP_PUBLIC_URL;else process.env.APP_PUBLIC_URL=originalUrl;});
  process.env.APP_PUBLIC_URL='https://interview.example.test';
  const sent=[];
  tianjiWeixinMessage.send=async(input)=>{sent.push(input);return{message_id:`message_${sent.length}`};};
  await teable.createRecord('recruitment_candidates',{候选人ID:'candidate',姓名:'测试候选人',邮箱:'candidate@example.test'});
  await teable.createRecord('recruitment_applications',{应聘记录ID:'application',候选人ID:'candidate',职位ID:'position',当前阶段:'约面'});
  const position=await teable.createRecord('recruitment_positions',{职位ID:'position',职位名称:'产品经理',招聘HR用户ID:'hr_product',招聘HR:'岗位HR'});
  for(const user of [...interviewerIds,'hr_product'])await teable.createRecord('recruitment_users',{用户ID:user,姓名:user,天玑微信ID:`tianji_${user}`,用户状态:'启用'});
  const interview=await teable.createRecord('recruitment_interviews',{面试ID:'interview',应聘记录ID:'application',候选人ID:'candidate',职位ID:'position',面试轮次:'一面',面试状态:'已确认',候选人确认状态:'已确认',面试官用户IDJSON:JSON.stringify(interviewerIds),开始时间:new Date(Date.now()-3600000).toISOString(),结束时间:new Date(Date.now()-60000).toISOString(),创建时间:new Date(Date.now()-86400000).toISOString()});
  const database={requireTableId:name=>name};
  const messages=new MessagesService(database);
  const evaluation=new EvaluationService(database,messages);
  const submit=(user,recommendation='通过')=>evaluation.submitFeedback('interview',{interviewerUserId:user,interviewer:user,candidateRating:'S',scores:{professional:85,communication:85,execution:85,culture:85,potential:85},recommendation,strengths:'证据完整',notes:'会议总结记录了候选人回答、项目事实和岗位相关表现。',aiSummary:'AI根据会议总结整理了候选人的主要经历、表现和岗位匹配情况。',interviewerEvaluation:'面试官已完整记录面试过程，并结合候选人的实际回答、项目成果、岗位要求和风险情况独立完成评价，候选人关键能力符合岗位要求。',comment:'面试官已完整记录面试过程，并结合候选人的实际回答、项目成果、岗位要求和风险情况独立完成评价，候选人关键能力符合岗位要求。'});
  return{memory,position,interview,messages,evaluation,sent,submit};
}

test('all passing evaluations hand off one candidate and job to HR, retry failures, and close the task after Offer creation', async(context)=>{
  const fixture=await handoffFixture(context);
  await fixture.submit('manager_a');
  assert.equal(fixture.sent.filter(item=>item.message.includes('【Offer待填写】')).length,0);
  let failOffer=true;
  const sender=tianjiWeixinMessage.send;
  tianjiWeixinMessage.send=async(input)=>{if(input.message.includes('【Offer待填写】')&&failOffer){failOffer=false;throw new Error('模拟天玑临时故障');}return sender(input);};
  const last=await fixture.submit('manager_b');
  assert.equal(last.handoff.status,'待重试');
  const tasks=fixture.memory.records.get('recruitment_tasks').filter(row=>row.fields['待办类型']==='面试后HR处理');
  assert.equal(tasks.length,1);
  assert.equal(JSON.parse(tasks[0].fields['扩展信息JSON']).notificationStatus,'发送失败');
  assert.deepEqual((await fixture.evaluation.checkHrHandoffs()).errors,[]);
  const notifications=fixture.sent.filter(item=>item.message.includes('【Offer待填写】'));
  assert.equal(notifications.length,1);
  assert.equal(notifications[0].wechatId,'tianji_hr_product');
  const link=notifications[0].message.match(/\]\((https:[^)]+)\)/)[1];
  const target=new URL(link);
  assert.equal(target.searchParams.get('flow_action'),'offer');
  assert.equal(target.searchParams.get('candidate_id'),'candidate');
  assert.equal(target.searchParams.get('application_id'),'application');
  assert.equal(target.searchParams.get('position_id'),'position');
  await fixture.evaluation.checkHrHandoffs();
  assert.equal(fixture.sent.filter(item=>item.message.includes('【Offer待填写】')).length,1);
  await teable.createRecord('recruitment_offers',{OfferID:'offer',候选人ID:'candidate',应聘记录ID:'application',职位ID:'position',Offer状态:'生成中',创建时间:new Date().toISOString()});
  await fixture.evaluation.checkHrHandoffs();
  assert.equal(tasks[0].fields['待办状态'],'已完成');
});

test('mixed evaluations go to HR decision and only an explicit pass opens the Offer branch',async(context)=>{
  const fixture=await handoffFixture(context);
  await fixture.submit('manager_a');
  const last=await fixture.submit('manager_b','加面');
  assert.equal(last.handoff.nextStep,'面试待决策');
  assert.equal(fixture.sent.filter(item=>item.message.includes('【Offer待填写】')).length,0);
  assert.ok(fixture.sent.some(item=>item.message.includes('flow_action=decision')));
  await fixture.evaluation.decide('interview',{decision:'通过',reason:'负责人复核已确认满足岗位要求',operator:'负责人'});
  assert.equal(fixture.sent.filter(item=>item.message.includes('【Offer待填写】')).length,1);
  assert.equal(fixture.memory.records.get('recruitment_tasks').filter(row=>row.fields['待办类型']==='面试后HR处理').length,1);
});

test('rejection decision sends a unified HTML result email to the candidate',async(context)=>{
  const fixture=await handoffFixture(context);
  const originalSendMail=tianjiWeixinMessage.sendMail,mails=[];
  context.after(()=>{tianjiWeixinMessage.sendMail=originalSendMail});
  tianjiWeixinMessage.sendMail=async input=>{mails.push(input);return{messageId:'rejection_mail'}};
  await fixture.submit('manager_a','淘汰');
  await fixture.submit('manager_b','加面');
  await fixture.evaluation.decide('interview',{decision:'淘汰',reason:'<script>alert(1)</script>当前岗位匹配度不足，感谢你投入时间。',operator:'招聘负责人'});
  assert.equal(mails.length,1);
  assert.equal(mails[0].contentType,'html');
  assert.equal(mails[0].toEmails[0],'candidate@example.test');
  assert.match(mails[0].content,/面试结果通知/);
  assert.match(mails[0].content,/暂不通过/);
  assert.match(mails[0].content,/结果说明/);
  assert.ok(!mails[0].content.includes('<script>'));
});

test('missing handoff position is recorded as pending and resumes after the position is restored',async(context)=>{
  const fixture=await handoffFixture(context,['manager_a']);
  fixture.interview.fields['职位ID']='';
  const application=fixture.memory.records.get('recruitment_applications')[0];
  application.fields['职位ID']='';
  const submitted=await fixture.submit('manager_a');
  assert.equal(submitted.handoff.status,'待重试');
  assert.equal(submitted.handoff.blockedReason,'未找到应聘记录对应岗位');
  const blocked=await fixture.evaluation.checkHrHandoffs();
  assert.equal(blocked.errors.length,0);
  assert.equal(blocked.pending,1);
  assert.equal(fixture.sent.length,0);
  fixture.interview.fields['职位ID']='position';
  application.fields['职位ID']='position';
  const resumed=await fixture.evaluation.checkHrHandoffs();
  assert.equal(resumed.errors.length,0);
  assert.equal(resumed.pending,0);
  assert.equal(fixture.sent.filter(item=>item.message.includes('【Offer待填写】')).length,1);
});

test('missing HR binding retains the handoff and automatically delivers after the binding is restored',async(context)=>{
  const fixture=await handoffFixture(context,['manager_a']);
  fixture.position.fields['招聘HR用户ID']='';
  const result=await fixture.submit('manager_a');
  assert.equal(result.handoff.status,'待重试');
  assert.equal(fixture.sent.length,0);
  fixture.position.fields['招聘HR用户ID']='hr_product';
  assert.deepEqual((await fixture.evaluation.checkHrHandoffs()).errors,[]);
  assert.equal(fixture.sent[0].wechatId,'tianji_hr_product');
});

test('messages stuck in sending are not treated as delivered and stale sends recover',async(context)=>{
  const fixture=await handoffFixture(context,['manager_a']);
  const row=await teable.createRecord('recruitment_messages',{消息ID:'stuck',消息分类:'面试通过填Offer',候选人ID:'candidate',对象ID:'interview',接收地址:'tianji_hr_product',发送状态:'发送中',更新时间:new Date().toISOString()});
  const input={category:'面试通过填Offer',candidateId:'candidate',objectId:'interview',userIds:['hr_product'],markdown:'Offer待填写'};
  assert.equal((await fixture.messages.notifyDirectUsers(input)).status,'发送失败');
  assert.equal(fixture.sent.length,0);
  row.fields['更新时间']=new Date(Date.now()-6*60_000).toISOString();
  assert.equal((await fixture.messages.notifyDirectUsers(input)).status,'已发送');
  assert.equal(fixture.sent.length,1);
  assert.equal(row.fields['发送状态'],'发送失败');
});

test('configured job and own personal bank are reused without AI or cross-job questions', async context => {
  const fixture = await handoffFixture(context, ['manager_a']);
  const originalLlm = llm.chat;
  context.after(() => { llm.chat = originalLlm; });
  llm.chat = async () => { throw new Error('configured base questions must not need AI'); };
  const configuredQuestionIds = Array.from({ length: 11 }, (_, index) => `shared_${index + 1}`);
  for (const [questionId, positionId, owner, status] of [
    ...configuredQuestionIds.map(questionId => [questionId, 'position', '', '已发布']),
    ['personal', 'position', 'manager_a', '已发布'],
    ['foreign', 'other_position', '', '已发布'],
    ['draft', 'position', '', '草稿'],
    ['other_person', 'position', 'manager_b', '已发布'],
  ]) {
    await teable.createRecord('recruitment_question_bank', { 题目ID: questionId, 题干: questionId, 适用岗位: '产品经理', 题目状态: status, 适用面试官用户ID: owner, 参考答案: '核验事实', 评分规则JSON: JSON.stringify({ positionId }) });
  }
  const result = await fixture.evaluation.generateInterviewQuestions({ interviewId: 'interview' });
  assert.equal(result.status, '已生成待推送');
  const snapshot = JSON.parse(fixture.interview.fields['面试题快照JSON']);
  assert.deepEqual(snapshot.map(question => question.questionId), [...configuredQuestionIds, 'personal']);
  assert.equal(snapshot[0].observation, '核验事实');
});

test('stale question generation resumes after a worker interruption',async(context)=>{
  const fixture=await handoffFixture(context,['manager_a']);
  const originalLlm=llm.chat;
  context.after(()=>{llm.chat=originalLlm;});
  llm.chat=async()=>JSON.stringify([{question:'请说明项目成果',dimension:'专业能力'}]);
  fixture.interview.fields['面试题状态']='生成中';
  fixture.interview.fields['面试题生成时间']=new Date(Date.now()-11*60_000).toISOString();
  const result=await fixture.evaluation.generateInterviewQuestions({interviewId:'interview'});
  assert.equal(result.status,'已生成待推送');
  assert.equal(fixture.sent.filter(item=>item.message.includes('【面试题】')).length,0);
});
