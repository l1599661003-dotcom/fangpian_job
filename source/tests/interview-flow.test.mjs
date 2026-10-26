import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { tianjiWeixinMessage } from '../dist/platform/tianji-weixin-message.js';
import { llm } from '../dist/platform/llm.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { TalentsService } from '../dist/modules/talents/talents.service.js';
import { InterviewsService } from '../dist/modules/interviews/interviews.service.js';
import { InterviewsController } from '../dist/modules/interviews/interviews.controller.js';
import { EvaluationService } from '../dist/modules/interviews/evaluation.service.js';

function installMemory() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const originals = {}, methods = ['listRecords', 'listAllRecords', 'listByField', 'createRecord', 'updateRecord', 'deleteRecord'];
  for (const method of methods) originals[method] = teable[method];
  let sequence = 0;
  teable.listRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.listAllRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.listByField = async (tableId, field, value) => (records.get(tableId) || []).filter((row) => row.fields[field] === value);
  teable.createRecord = async (tableId, fields) => { const row = { id: `${tableId}_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() }; records.get(tableId).push(row); return row; };
  teable.updateRecord = async (tableId, recordId, fields) => { const row = records.get(tableId).find((item) => item.id === recordId); if (!row) throw new Error(`record missing ${tableId}/${recordId}`); row.fields = { ...row.fields, ...fields }; return row; };
  teable.deleteRecord = async () => {};
  return { records, restore: () => Object.assign(teable, originals) };
}

test('review, communication, scheduling, feedback and interview decision form one auditable lifecycle', async () => {
  const memory = installMemory(), originalLlm = llm.chat;
  const originalTianji = {
    bookMeetingRoom: tianjiWeixinMessage.bookMeetingRoom,
    freeMeetingRooms: tianjiWeixinMessage.freeMeetingRooms,
    createSchedule: tianjiWeixinMessage.createSchedule,
    cancelSchedule: tianjiWeixinMessage.cancelSchedule,
    sendMail: tianjiWeixinMessage.sendMail,
  };
  const originalPublicUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'https://resume.example.test';
  const scheduleStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  scheduleStart.setMinutes(0, 0, 0);
  const scheduleEnd = new Date(scheduleStart.getTime() + 60 * 60 * 1000);
  const availabilityStart = new Date(scheduleStart.getTime() - 60 * 60 * 1000);
  const conflictStart = new Date(scheduleStart.getTime() + 30 * 60 * 1000);
  const conflictEnd = new Date(scheduleEnd.getTime() + 30 * 60 * 1000);
  let bookingSequence = 0;
  try {
    tianjiWeixinMessage.bookMeetingRoom = async () => ({ bookingId: `tianji_booking_${++bookingSequence}`, scheduleId: `tianji_room_schedule_${bookingSequence}`, response: { errcode: 0 } });
    tianjiWeixinMessage.freeMeetingRooms = async (startTime, endTime) => ({ start_time: startTime, end_time: endTime, free_count: 1, busy_count: 0, free: [{ meetingroom_id: 'room_flow_external', name: '杭州A301', need_approval: 0 }], busy: [] });
    tianjiWeixinMessage.createSchedule = async () => ({ scheduleId: 'tianji_schedule_1', response: { errcode: 0 } });
    tianjiWeixinMessage.cancelSchedule = async scheduleId => ({ scheduleId, response: { errcode: 0 } });
    tianjiWeixinMessage.sendMail = async () => ({ messageId: 'tianji_mail_1', response: { errcode: 0 } });
    const create = teable.createRecord;
    const candidate = await create('recruitment_candidates', { 候选人ID: 'tal_flow', 姓名: '林悦', 电话: '13700137000', 邮箱: 'linyue@example.com', 期望职位: '产品经理', 工作年限: '5年', 候选人状态: '待业务群评审', 人才池: '公司人才库', 合并状态: '独立档案', 创建时间: '2026-08-20T00:00:00.000Z', 更新时间: '2026-08-20T00:00:00.000Z' });
    const application = await create('recruitment_applications', { 应聘记录ID: 'app_flow', 候选人ID: 'tal_flow', 职位ID: 'pos_pm', 当前阶段: '待业务群评审', 当前状态: '进行中', AI匹配分: 88, 创建时间: '2026-08-20T00:00:00.000Z', 更新时间: '2026-08-20T00:00:00.000Z' });
    await create('recruitment_positions', { 职位ID: 'pos_pm', 职位名称: '产品经理', 部门: '产品部', 招聘HR用户ID: 'hr_1', 招聘HR: '王HR', 发布状态: '招聘中' });
    await create('recruitment_ai_assessments', { 分析记录ID: 'ai_flow', 候选人ID: 'tal_flow', 综合建议分: 88, 置信度: '高', 风险与待确认JSON: '["确认复杂项目边界"]', 创建时间: '2026-08-20T01:00:00.000Z' });
    const database = { requireTableId: (name) => name };
    const hrNotifications = [];
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, {
      notifyFlowEvent: async () => ({ status: '已发送' }),
      notifyPositionHr: async (input) => { hrNotifications.push(input); return { status: '已发送' }; },
    });

    const review = await talents.reviewTalent('tal_flow', { decision: '通过', opinion: '岗位经历和量化结果符合进入沟通标准', evidence: ['AI匹配88分', '有完整SaaS产品项目'], operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(review.targetStage, '意向沟通');
    assert.equal(application.fields['当前阶段'], '意向沟通');
    assert.equal(candidate.fields['候选人状态'], '意向沟通');
    assert.equal(hrNotifications[0].positionId, 'pos_pm');
    assert.match(hrNotifications[0].markdown, /待意向沟通/);

    await assert.rejects(() => talents.createCommunication('tal_flow', { type: '意向沟通', channel: '微信', summary: '候选人认可岗位方向和薪资区间，可参加一面', result: '约定面试' }), /接通状态/);
    const communication = await talents.createCommunication('tal_flow', { type: '意向沟通', channel: '微信', answerStatus: '微信回复', interestLevel: '高', jobStatus: '在职已提离职', summary: '候选人认可岗位方向和薪资区间，可参加一面', result: '约定面试', nextAction: '发送面试邀请', nextFollowUpAt: '2026-09-09T10:00:00.000Z', wechat: 'linyue_pm', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(communication.communication.result, '约定面试');
    assert.equal(communication.communication.operatorUserId, 'hr_1');
    const communicationHistory = await talents.listCommunications('tal_flow');
    assert.deepEqual(communicationHistory.defaultHr, { id: 'hr_1', name: '王HR', positionName: '产品经理' });
    assert.equal(communicationHistory.communications[0].operator, '王HR');
    assert.equal(communicationHistory.communications[0].operatorUserId, 'hr_1');
    const position = memory.records.get('recruitment_positions')[0];
    position.fields['招聘HR用户ID'] = 'hr_2';
    position.fields['招聘HR'] = '李HR';
    const changedHistory = await talents.listCommunications('tal_flow');
    assert.equal(changedHistory.defaultHr.id, 'hr_2');
    assert.equal(changedHistory.communications[0].operator, '王HR');
    position.fields['招聘HR用户ID'] = 'hr_1';
    position.fields['招聘HR'] = '王HR';
    assert.equal(communication.candidateId, 'tal_flow');
    assert.equal(new URL(communication.scheduleUrl, 'https://example.test').searchParams.get('candidate_id'), 'tal_flow');
    const scheduleNotifications = hrNotifications.filter(item => item.category === '意向沟通完成');
    assert.equal(scheduleNotifications.length, 1);
    assert.ok(scheduleNotifications[0].markdown.includes(`](${communication.scheduleUrl})`));
    assert.equal(candidate.fields['微信'], 'linyue_pm');
    assert.equal(memory.records.get('recruitment_tasks').length, 1);

    const queuedQuestions = [], interviewNotifications = [];
    const interviews = new InterviewsService(database, {
      notifyFlowEvent: async (input) => { interviewNotifications.push(input); return { status: '已发送', messageId: `message_${interviewNotifications.length}` }; },
      notifyPositionHr: async (input) => { interviewNotifications.push(input); return { status: '已发送', messageId: `message_${interviewNotifications.length}` }; },
    }, {
      queueInterviewQuestionGeneration: (input) => { queuedQuestions.push(input); return { jobId: 'job_questions_1', status: 'running' }; },
    });
    await create('recruitment_users', { 用户ID: 'manager_a', 姓名: '陈经理', 企业微信用户ID: 'manager_a', 部门JSON: JSON.stringify(['产品部']), 用户状态: '启用' });
    await create('recruitment_users', { 用户ID: 'manager_b', 姓名: '赵总监', 企业微信用户ID: 'manager_b', 部门JSON: JSON.stringify(['产品部']), 用户状态: '启用' });
    await create('recruitment_user_roles', { 用户角色ID: 'role_manager_a', 用户ID: 'manager_a', 用户姓名: '陈经理', 角色编码: 'interviewer', 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z' });
    await create('recruitment_user_roles', { 用户角色ID: 'role_manager_b', 用户ID: 'manager_b', 用户姓名: '赵总监', 角色编码: 'interviewer', 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z' });
    const interviewerA = await interviews.createInterviewer({ userId: 'manager_a', name: '陈经理', department: '产品部', roles: ['产品经理'], rounds: ['一面'], maxPerDay: 4 });
    const interviewerB = await interviews.createInterviewer({ userId: 'manager_b', name: '赵总监', department: '产品部', roles: ['产品经理'], rounds: ['一面'], maxPerDay: 4 });
    await create('recruitment_question_bank', { 题目ID: 'question_general', 题目分类: '岗位通用题', 题干: '请说明产品需求优先级冲突时你的判断方法。', 题目状态: '已发布', 适用岗位: '产品经理' });
    await create('recruitment_question_bank', { 题目ID: 'question_manager_a', 题目分类: '面试官追问题', 题干: '请说明一次你主动识别项目延期风险的经历。', 题目状态: '已发布', 适用岗位: '产品经理', 适用面试官用户ID: JSON.stringify([interviewerA.interviewerId]) });
    await create('recruitment_question_bank', { 题目ID: 'question_manager_b', 题目分类: '面试官追问题', 题干: '请说明一次你推动跨部门商业化决策的经历。', 题目状态: '已发布', 适用岗位: '产品经理', 适用面试官用户ID: JSON.stringify([interviewerB.interviewerId]) });
    await interviews.addAvailability({ interviewerId: interviewerA.interviewerId, startAt: availabilityStart.toISOString(), endAt: new Date(scheduleEnd.getTime() + 60 * 60 * 1000).toISOString(), source: '人工维护' });
    await interviews.addAvailability({ interviewerId: interviewerB.interviewerId, startAt: availabilityStart.toISOString(), endAt: new Date(scheduleEnd.getTime() + 60 * 60 * 1000).toISOString(), source: '人工维护' });
    const room = await interviews.createRoom({ name: '杭州A301', location: '杭州总部', floor: '3F', capacity: 6, equipment: ['电视', '白板'], externalResourceId: 'room_flow_external' });
    const appointment = await interviews.createAppointment({ candidateId: 'tal_flow', applicationId: 'app_flow', positionId: 'pos_pm', round: '一面', mode: '线下面试', startAt: scheduleStart.toISOString(), endAt: scheduleEnd.toISOString(), location: '杭州总部', meetingRoomId: room.roomId, interviewerIds: [interviewerA.interviewerId, interviewerB.interviewerId], organizerUserId: 'hr_1', note: '产品岗位一面', operator: '王HR', publicUrl: 'https://resume.example.test' });
    assert.equal(appointment.sync.status, '已同步');
    assert.equal(appointment.invitation.sendStatus, '将随预约自动发送');
    assert.equal(application.fields['当前阶段'], '约面');
    assert.equal(candidate.fields['候选人状态'], '约面');
    const preparation = await interviews.submitCandidatePreparation(appointment.token, { profile: { phone: '15996610031', age: 29, yearsOfExperience: '5年', highestEducation: '本科', gender: '女' } });
    assert.equal(preparation.status, '已提交');
    assert.equal(queuedQuestions.length, 1);
    assert.equal(queuedQuestions[0].interviewId, appointment.interviewId);
    await assert.rejects(() => interviews.createAppointment({ candidateId: 'tal_flow', applicationId: 'app_flow', round: '补充面试', mode: '线下面试', startAt: conflictStart.toISOString(), endAt: conflictEnd.toISOString(), meetingRoomId: room.roomId, interviewerIds: [interviewerA.interviewerId], operator: '王HR' }), /已有面试/);

    const evaluationNotifications = [];
    const evaluation = new EvaluationService(database, {
      notifyFlowEvent: async (input) => { evaluationNotifications.push(input); return { status: '已发送', messageId: 'message_questions_1' }; },
      notifyDirectUsers: async (input) => { evaluationNotifications.push(input); return { status: '已发送', messageId: `message_direct_${evaluationNotifications.length}` }; },
      notifyPositionHr: async (input) => { evaluationNotifications.push(input); return { status: '已发送', messageId: `message_hr_${evaluationNotifications.length}` }; },
    });
    llm.chat = async () => JSON.stringify({
      recommendation: '通过',
      otherRoles: '运营经理',
      strengths: '逻辑清晰，项目数据完整',
      risks: '管理跨度需要继续确认',
      comment: '候选人完整说明了项目目标、个人贡献和量化结果，建议通过一面。',
    });
    const extractedFeedback = await evaluation.extractFeedbackTranscript(
      appointment.interviewId,
      '候选人逻辑清晰，项目数据完整，但管理跨度还需要确认，建议通过一面，运营经理也可以考虑。',
    );
    assert.deepEqual(extractedFeedback.extraction, {
      recommendation: '通过',
      otherRoles: '运营经理',
      strengths: '逻辑清晰，项目数据完整',
      risks: '管理跨度需要继续确认',
      comment: '候选人完整说明了项目目标、个人贡献和量化结果，建议通过一面。',
    });
    let questionPrompt = '';
    llm.chat = async (messages) => {
      questionPrompt = messages[1].content;
      return JSON.stringify([
      { question: '请说明你最近一个产品项目的目标、个人贡献和量化结果。', dimension: '专业能力', why: '核验项目真实性', observation: '目标、行动和结果是否闭环' },
      { question: '当前岗位变动时你最关注哪些条件？', dimension: '求职动机', why: '结合意向沟通继续确认', observation: '动机是否稳定一致' },
      ]);
    };
    const generatedQuestions = await evaluation.generateInterviewQuestions({ interviewId: appointment.interviewId, count: 4, operator: '创建面试后自动生成' });
    assert.equal(generatedQuestions.status, '已生成待推送');
    assert.match(questionPrompt, /生成9道/);
    assert.match(questionPrompt, /结构化面试维度/);
    assert.equal(generatedQuestions.baseCount, 3);
    assert.equal(generatedQuestions.generatedCount, 2);
    assert.equal(generatedQuestions.fallbackCount, 7);
    assert.equal(generatedQuestions.snapshot.length, 12);
    assert.ok(new Set(generatedQuestions.snapshot.map(question => question.dimension)).size >= 8);
    assert.equal(evaluationNotifications.length, 0);
    const exportedQuestions = await evaluation.exportQuestions(appointment.interviewId);
    assert.match(exportedQuestions.fileName, /林悦-产品经理-一面-面试题-.*\.docx$/);
    assert.equal(exportedQuestions.content.subarray(0, 2).toString(), 'PK');
    assert.ok(exportedQuestions.content.length > 1_000);
    const rescheduledStart = new Date(scheduleEnd.getTime());
    const rescheduledEnd = new Date(rescheduledStart.getTime() + 60 * 60 * 1000);
    const reschedule = await interviews.candidateReschedule(appointment.token, { reason: '候选人临时需要参加客户会议', preferredTimes: [rescheduledStart.toISOString()] });
    assert.equal(reschedule.status, '改期审批中');
    assert.equal(interviewNotifications.at(-1).positionId, 'pos_pm');
    assert.match(interviewNotifications.at(-1).markdown, /HR改期确认/);
    assert.match(interviewNotifications.at(-1).markdown, /候选人临时需要参加客户会议/);
    const interviewsController = new InterviewsController(interviews);
    const startedReschedule = interviewsController.rescheduleDecision(appointment.interviewId, { decision: '批准', startAt: rescheduledStart.toISOString(), endAt: rescheduledEnd.toISOString(), meetingRoomId: room.roomId, location: '杭州总部', note: '已与候选人确认新时间', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(startedReschedule.status, 'running');
    assert.match(startedReschedule.jobId, /^job_/);
    let rescheduleJob = interviewsController.rescheduleJob(startedReschedule.jobId);
    for (let attempt = 0; attempt < 100 && rescheduleJob.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      rescheduleJob = interviewsController.rescheduleJob(startedReschedule.jobId);
    }
    assert.equal(rescheduleJob.status, 'done');
    const rescheduleDecision = rescheduleJob.data;
    assert.equal(rescheduleDecision.status, '已批准');
    assert.equal(rescheduleDecision.email.status, '已发送');
    assert.equal(memory.records.get('recruitment_interviews')[0].fields['候选人确认状态'], '已确认');
    assert.equal(memory.records.get('recruitment_interviews')[0].fields['改期审批状态'], '已批准');
    await assert.rejects(() => evaluation.submitFeedback(appointment.interviewId, { interviewerUserId: interviewerA.interviewerId, interviewer: '陈经理', candidateRating: 'D', recommendation: '通过', strengths: '', interviewerEvaluation: '面'.repeat(50), notes: '会议总结原文', aiSummary: 'AI总结已生成' }), /有效的候选人评级/);
    await assert.rejects(() => evaluation.submitFeedback(appointment.interviewId, { interviewerUserId: interviewerA.interviewerId, interviewer: '陈经理', candidateRating: 'a', recommendation: '通过', strengths: '', aiSummary: 'AI总结不能代替面试官评价' }), /面试官评价和面试结论不能为空/);
    const evaluation49 = '面'.repeat(49);
    const evaluation50 = '面'.repeat(50);
    const feedbackBase = { interviewerUserId: interviewerA.interviewerId, interviewer: '陈经理', candidateRating: 'a', recommendation: '通过', notes: '面试会议总结包含项目目标、个人职责和量化结果。', aiSummary: 'AI整理了项目量化成果。' };
    await assert.rejects(() => evaluation.submitFeedback(appointment.interviewId, { ...feedbackBase, interviewerEvaluation: evaluation49 }), /至少填写50字/);
    await assert.rejects(() => evaluation.submitFeedback(appointment.interviewId, { ...feedbackBase, interviewerEvaluation: evaluation50, notes: '' }), /请先粘贴会议总结/);
    await assert.rejects(() => evaluation.submitFeedback(appointment.interviewId, { ...feedbackBase, interviewerEvaluation: evaluation50, aiSummary: '' }), /请先使用会议总结转换/);
    const first = await evaluation.submitFeedback(appointment.interviewId, { ...feedbackBase, scores: { professional: 88, communication: 82, execution: 85, culture: 80, potential: 86 }, strengths: '产品规划和数据分析证据充分', risks: '需确认跨区域协作经验', interviewerEvaluation: evaluation50, comment: evaluation50, evidence: { professional: 'SaaS项目转化率提升' }, operator: '陈经理' });
    assert.equal(first.submitted, 1); assert.equal(first.expected, 2);
    const savedFeedback = memory.records.get('recruitment_interview_feedback')[0].fields;
    assert.equal(savedFeedback['候选人评级'], 'a');
    assert.equal(savedFeedback['AI面试总结'], 'AI整理了项目量化成果。');
    assert.equal(savedFeedback['面试官评价'], evaluation50);
    await assert.rejects(() => evaluation.submitFeedback(appointment.interviewId, { ...feedbackBase, candidateRating: 'b', scores: { professional: 90, communication: 90, execution: 90, culture: 90, potential: 90 }, strengths: '', risks: '', interviewerEvaluation: evaluation50, comment: evaluation50, operator: '陈经理' }), /已经锁定/);
    const second = await evaluation.submitFeedback(appointment.interviewId, { interviewerUserId: interviewerB.interviewerId, interviewer: '赵总监', candidateRating: 'b', scores: { professional: 78, communication: 84, execution: 80, culture: 82, potential: 79 }, recommendation: '待讨论', strengths: '沟通清晰', risks: '商业化深度需要二面确认', aiSummary: 'AI已整理本轮会议中的主要事实和风险。', notes: '本轮会议记录包含候选人的项目案例及待核实项。', interviewerEvaluation: evaluation50, comment: evaluation50, operator: '赵总监' });
    assert.equal(second.submitted, 2); assert.equal(second.expected, 2);
    assert.equal(second.handoff.status, '已通知HR');
    assert.equal(second.handoff.nextStep, '面试待决策');
    const feedbackHistory = await evaluation.feedback(appointment.interviewId);
    assert.equal(feedbackHistory.feedback.length, 2);
    assert.equal(feedbackHistory.history.length, 2);
    assert.ok(feedbackHistory.history.every(item => item.round === '一面'));
    const aggregate = await evaluation.aggregate(appointment.interviewId);
    assert.equal(aggregate.count, 2);
    assert.deepEqual(aggregate.recommendations, { 通过: 1, 待讨论: 1 });
    assert.deepEqual(aggregate.disagreements, { 通过: 1, 待讨论: 1 });

    const decision = await evaluation.decide(appointment.interviewId, { decision: '通过', reason: '两位面试官证据总体支持进入Offer决策，风险项转入二面补充核验', operator: '招聘负责人', operatorUserId: 'hr_lead' });
    assert.equal(decision.handoff.status, '已通知HR');
    assert.equal(evaluationNotifications.filter(item => item.category === '面试通过填Offer').length, 1);
    assert.equal(decision.targetStage, '待Offer决策');
    assert.equal(application.fields['当前阶段'], '待Offer决策');
    assert.equal(candidate.fields['候选人状态'], '待Offer决策');
    assert.equal(memory.records.get('recruitment_candidate_reviews').length, 1);
    assert.equal(memory.records.get('recruitment_communications').length, 1);
    assert.equal(memory.records.get('recruitment_interviews').length, 1);
    assert.equal(memory.records.get('recruitment_interview_feedback').length, 2);
    assert.equal(memory.records.get('recruitment_interview_decisions').length, 1);
    const stages = memory.records.get('recruitment_stage_events').map((row) => row.fields['新阶段']);
    assert.deepEqual(stages, ['意向沟通', '约面', '待Offer决策']);
    const actions = memory.records.get('recruitment_audit_logs').map((row) => row.fields['操作类型']);
    for (const action of ['业务群评审确认', '记录人才沟通', '创建面试预约', '提交面试评价', '面试招聘决策']) assert.ok(actions.includes(action), `missing audit ${action}`);
    const interviewRecord = memory.records.get('recruitment_interviews')[0];
    const priorHrPushes = evaluationNotifications.filter(item => item.objectType === '面试后HR处理').length;
    interviewRecord.fields['面试结果'] = '储备';
    assert.equal((await evaluation.ensureHrHandoff(appointment.interviewId)).status, '无需处理');
    interviewRecord.fields['面试结果'] = '待讨论';
    assert.equal((await evaluation.ensureHrHandoff(appointment.interviewId)).status, '无需处理');
    assert.equal(evaluationNotifications.filter(item => item.objectType === '面试后HR处理').length, priorHrPushes);
    interviewRecord.fields['面试结果'] = '加面';
    const additionalRound = await evaluation.ensureHrHandoff(appointment.interviewId);
    assert.equal(additionalRound.status, '已通知HR');
    assert.equal(new URL(additionalRound.url).searchParams.get('flow_action'), 'schedule');
    assert.equal(evaluationNotifications.filter(item => item.category === '面试加面安排').length, 1);
    interviewRecord.fields['面试结果'] = '淘汰';
    const rejected = await evaluation.ensureHrHandoff(appointment.interviewId);
    assert.equal(rejected.status, '已通知候选人');
    assert.equal(rejected.mail.recipient, 'linyue@example.com');
  } finally { Object.assign(tianjiWeixinMessage, originalTianji); llm.chat = originalLlm; if (originalPublicUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = originalPublicUrl; memory.restore(); }
});
