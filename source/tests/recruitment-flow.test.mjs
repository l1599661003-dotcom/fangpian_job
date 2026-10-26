import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { llm } from '../dist/platform/llm.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { RecruitmentService } from '../dist/modules/recruitment/recruitment.service.js';

test('arrival deadlines allow optional values, preserve omitted dates, clear explicitly and reject invalid ranges', () => {
  const service = new RecruitmentService({ requireTableId: name => name });
  assert.deepEqual(service.arrivalDates({ expectedArrivalDate: '2026-10-01', latestArrivalDate: '2026-10-15' }), { expectedArrivalDate: '2026-10-01', latestArrivalDate: '2026-10-15' });
  assert.equal(service.arrivalDates({}, { 最晚到岗日期: '2026-10-15' }).latestArrivalDate, '2026-10-15');
  assert.equal(service.arrivalDates({ latestArrivalDate: '' }, { 最晚到岗日期: '2026-10-15' }).latestArrivalDate, '');
  assert.throws(() => service.arrivalDates({ latestArrivalDate: '2026-02-30' }), /有效日期/);
  assert.throws(() => service.arrivalDates({ expectedArrivalDate: '2026-10-15', latestArrivalDate: '2026-10-01' }), /不能早于/);
  assert.equal(service.arrivalDates({ expectedArrivalDate: '2026-10-15', latestArrivalDate: '2026-10-15' }).latestArrivalDate, '2026-10-15');
});

test('monthly demands persist both arrival dates and expose the earliest dates in the dashboard', async () => {
  const memory = memoryTeable(), restore = memory.install();
  try {
    const service = new RecruitmentService({ requireTableId: name => name });
    service.auditAsync = () => {};
    service.sendRecruitmentApprovalRequest = async () => ({ status: '待发送' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'arrival_position', 职位名称: '测试岗位', 部门: '技术部', 发布状态: '招聘中', 招聘状态: '招聘中' });
    const input = { month: '2026-10', positionId: 'arrival_position', headcount: 2, expectedArrivalDate: '2026-10-05', latestArrivalDate: '2026-10-20', demandRequirement: '重点承接短视频编导岗位，优先有MCN经验', note: '到岗时间测试' };
    const saved = await service.saveMonthlyDemand(input);
    assert.equal(saved.latestArrivalDate, '2026-10-20');
    assert.equal(saved.demandRequirement, '重点承接短视频编导岗位，优先有MCN经验');
    assert.equal((await service.listMonthlyDemands('2026-10')).demands[0].demandRequirement, '重点承接短视频编导岗位，优先有MCN经验');
    assert.equal((await service.listMonthlyDemands('2026-10')).demands[0].expectedArrivalDate, '2026-10-05');
    const updated = await service.saveMonthlyDemand({ ...input, latestArrivalDate: undefined });
    assert.equal(updated.latestArrivalDate, '2026-10-20');
    await assert.rejects(service.saveMonthlyDemand({ ...input, latestArrivalDate: '2026-10-01' }), /不能早于/);
    assert.equal(memory.records.get('recruitment_monthly_demands').length, 1);
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'arrival_earlier', 需求月份: '2026-10', 职位ID: 'arrival_position', 职位名称: '测试岗位', 部门: '技术部', 需求数量: 1, 需求状态: '已确认', 期望到岗日期: '2026-10-03', 最晚到岗日期: '2026-10-18' });
    const dashboard = await service.monthlyHiring('2026-10');
    assert.equal(dashboard.departments[0].expectedArrivalDate, '2026-10-03');
    assert.equal(dashboard.departments[0].latestArrivalDate, '2026-10-18');
    assert.equal(dashboard.summary.demand, 3);
  } finally { restore(); }
});

function memoryTeable() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const definitions = new Map(RECRUITMENT_TABLES.map((table) => [table.name, table]));
  let sequence = 0;
  return {
    records,
    install() {
      const originals = {};
      for (const method of ['listFields', 'listRecords', 'listAllRecords', 'createRecord', 'updateRecord', 'deleteRecord']) originals[method] = teable[method];
      teable.listFields = async (tableId) => (definitions.get(tableId)?.fields || []).map((field, index) => ({ id: `${tableId}_field_${index}`, ...field }));
      teable.listRecords = async (tableId) => [...(records.get(tableId) || [])];
      teable.listAllRecords = async (tableId) => [...(records.get(tableId) || [])];
      teable.createRecord = async (tableId, fields) => {
        const row = { id: `${tableId}_record_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() };
        records.get(tableId).push(row);
        return row;
      };
      teable.updateRecord = async (tableId, recordId, fields) => {
        const row = records.get(tableId).find((item) => item.id === recordId);
        if (!row) throw new Error(`record not found: ${tableId}/${recordId}`);
        row.fields = { ...row.fields, ...fields };
        return row;
      };
      teable.deleteRecord = async (tableId, recordId) => {
        const rows = records.get(tableId), index = rows.findIndex((item) => item.id === recordId);
        if (index >= 0) rows.splice(index, 1);
      };
      return () => Object.assign(teable, originals);
    },
  };
}

test('position and demand require the configured WeCom approver before publishing', async () => {
  const memory = memoryTeable(), restore = memory.install(), previousApprover = process.env.WECOM_RECRUITMENT_APPROVER_USER_ID, previousMessageRecipient = process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID, previousPublicUrl = process.env.APP_PUBLIC_URL;
  try {
    process.env.WECOM_RECRUITMENT_APPROVER_USER_ID = 'LiuJinHu';
    process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID = 'LiuJinHu';
    process.env.APP_PUBLIC_URL = 'https://recruitment.example.test/';
    let messageSequence = 0;
    const approvalMessages = [];
    const messages = {
      preview: async (input) => { approvalMessages.push(input); return { messageId: `approval_message_${++messageSequence}` }; },
      send: async (messageId) => ({ messageId, status: '已发送' }),
    };
    await teable.createRecord('recruitment_users', { 用户ID: 'approver_user', 姓名: '刘金虎', 企业微信用户ID: 'LiuJinHu', 天玑微信ID: 'LiuJinHu', 用户状态: '启用' });
    await teable.createRecord('recruitment_users', { 用户ID: 'other_user', 姓名: '其他员工', 企业微信用户ID: 'wecom_other', 用户状态: '启用' });
    const service = new RecruitmentService({ requireTableId: (name) => name }, messages);
    const position = await service.createPosition({
      name: '高级后端工程师', department: '技术部', headcount: 3, priority: '高',
      jobDescription: '负责核心招聘系统服务端建设', owner: '王HR', expectedArrivalDate: '2026-10-15',
      responsibilities: '负责NestJS服务与数据治理', requirements: '5年以上后端经验',
      recruiterUserId: 'other_user', recruiter: '其他员工',
      tags: ['NestJS', '数据治理'],
    }, '招聘管理员', 'recruiter_user');
    assert.equal(position.name, '高级后端工程师');
    assert.equal(position.headcount, 3);
    assert.equal(position.approvalStatus, '待审批');
    assert.equal(position.approvalNotification.status, '已发送');
    assert.equal(approvalMessages[0].recipientAddress, 'LiuJinHu');
    assert.match(approvalMessages[0].content, /新增岗位审批/);
    assert.match(approvalMessages[0].content, /flow_action=recruitment_approval/);
    assert.match(approvalMessages[0].content, /\[点击打开审批页面 →\]\(https:\/\//);
    assert.doesNotMatch(approvalMessages[0].content, /打开审批：https:\/\//);

    const attemptedBypass = await service.updatePosition(position.id, { approvalStatus: '已通过', changeReason: '尝试绕过审批' }, '王HR');
    assert.equal(attemptedBypass.approvalStatus, '待审批');
    await assert.rejects(() => service.publishPosition(position.id, { platforms: ['Boss直聘'] }, '王HR'), /通过后才能发布/);
    await assert.rejects(() => service.getRecruitmentApproval('position', position.id, { userId: 'other_user', userName: '其他员工' }), /当前登录账号不是指定的招聘审批人/);
    const approvedPosition = await service.decideRecruitmentApproval('position', position.id, { decision: '通过', opinion: '编制和预算已确认' }, { userId: 'approver_user', userName: '招聘审批人' });
    assert.equal(approvedPosition.approvalStatus, '已通过');

    const published = await service.publishPosition(position.id, {
      platforms: ['Boss直聘', '猎聘'], targetCount: 80, filters: { city: '杭州', experienceYears: 5 },
    }, '王HR');
    assert.equal(published.position.status, '招聘中');
    assert.equal(published.collectionTask.status, '待对接RPA');
    assert.equal(published.collectionTask.targetCount, 80);
    assert.deepEqual(published.collectionTask.platforms, ['Boss直聘', '猎聘']);
    const notificationsBeforePause = approvalMessages.length;
    const pausedBeforeDemand = await service.changePositionStatus(position.id, '已下线', '暂时停止招聘', '王HR');
    assert.equal(pausedBeforeDemand.status, '已下线');
    assert.equal(pausedBeforeDemand.recruitmentStatus, '暂停招聘');
    assert.equal(approvalMessages.length, notificationsBeforePause);

    await assert.rejects(() => service.saveMonthlyDemand({ month: '2026-10', positionId: position.id, headcount: 0, demandType: '新增需求', priority: '紧急', note: '需求人数不能为0。', operator: '王HR' }, 'recruiter_user'), /需求人数必须大于0/);
    let demand = await service.saveMonthlyDemand({ month: '2026-10', positionId: position.id, headcount: 4, demandType: '新增需求', priority: '紧急', demandRequirement: '重点承接招聘系统后端重构，优先NestJS和AI应用经验', note: '新增业务线，需要补充高级后端研发编制。', operator: '王HR' }, 'recruiter_user');
    assert.equal(demand.approvalStatus, '待审批');
    assert.equal(demand.demandType, '新增需求');
    assert.equal(demand.priority, '紧急');
    assert.equal(demand.demandRequirement, '重点承接招聘系统后端重构，优先NestJS和AI应用经验');
    assert.equal(demand.positionAutoPublished, false);
    assert.equal(demand.approvalNotification.status, '发送中');
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(approvalMessages[1].content, /需求要求：重点承接招聘系统后端重构，优先NestJS和AI应用经验/);
    demand = await service.saveMonthlyDemand({ month: '2026-10', positionId: position.id, headcount: 5, demandType: '新增需求', priority: '紧急', demandRequirement: '重点承接招聘系统后端重构和数据治理', note: '调整为本月新增5名高级后端研发编制。', operator: '王HR' }, 'recruiter_user');
    assert.equal(demand.updated, true);
    assert.equal(demand.headcount, 5);
    assert.equal(demand.approvalStatus, '待审批');
    assert.equal(demand.positionAutoPublished, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(approvalMessages[2].content, /需求人数：5/);
    const pendingHiring = await service.monthlyHiring('2026-10');
    assert.equal(pendingHiring.summary.demand, 0);
    const approvedDemand = await service.decideRecruitmentApproval('demand', demand.id, { decision: '通过', opinion: '需求合理' }, { userId: 'approver_user', userName: '招聘审批人' });
    assert.equal(approvedDemand.approvalStatus, '已通过');
    assert.equal(approvedDemand.demandStatus, '已确认');
    assert.equal(approvedDemand.positionAutoPublished, true);
    assert.equal((await service.getPosition(position.id)).status, '招聘中');
    const activeHiring = await service.monthlyHiring('2026-10');
    assert.equal(activeHiring.summary.demand, 5);
    await service.changePositionStatus(position.id, '已下线', '本轮招聘暂停', '王HR');
    const pausedHiring = await service.monthlyHiring('2026-10');
    assert.equal(pausedHiring.summary.demand, 0);
    assert.equal(pausedHiring.departments.length, 0);

    await teable.createRecord('recruitment_job_matches', { 匹配记录ID: 'match_existing', 候选人ID: 'candidate_existing', 职位ID: position.id, 职位名称: '高级后端工程师', 匹配总分: 82, 匹配状态: '当前', 岗位JD版本: 1, 创建时间: '2026-08-28T10:00:00.000Z' });
    const jdUpdated = await service.updatePosition(position.id, { jobDescription: '建设人才管理系统后端与AI招聘决策平台', responsibilities: '负责NestJS服务、数据治理和AI能力接入', requirements: '5年以上后端经验，具备AI应用落地经验', tags: ['NestJS', '数据治理', 'AI应用'], changeReason: '业务新增AI招聘决策平台职责' }, '王HR');
    assert.equal(jdUpdated.jdVersion, 2);
    assert.equal(jdUpdated.rematchStatus, '待重匹配');
    assert.equal(jdUpdated.pendingRematchCount, 1);

    assert.equal(memory.records.get('recruitment_collection_tasks').length, 1);
    assert.equal(memory.records.get('recruitment_collection_task_events').length, 1);
    const auditActions = memory.records.get('recruitment_audit_logs').map((row) => row.fields['操作类型']);
    assert.ok(auditActions.includes('创建岗位'));
    assert.ok(auditActions.includes('发布职位并创建采集任务'));
  } finally {
    if (previousApprover === undefined) delete process.env.WECOM_RECRUITMENT_APPROVER_USER_ID;
    else process.env.WECOM_RECRUITMENT_APPROVER_USER_ID = previousApprover;
    if (previousMessageRecipient === undefined) delete process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID;
    else process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID = previousMessageRecipient;
    if (previousPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousPublicUrl;
    restore();
  }
});

test('monthly hiring keeps completed roles last and sorts unfinished roles by priority then actual offers', async () => {
  const memory = memoryTeable(), restore = memory.install();
  try {
    const service = new RecruitmentService({ requireTableId: (name) => name });
    const positions = [
      ['pos_urgent_zero', '紧急未到岗', '紧急'],
      ['pos_urgent_one', '紧急已到岗一人', '紧急'],
      ['pos_important_zero', '重要未到岗', '重要'],
      ['pos_normal_zero', '一般未到岗', '一般'],
      ['pos_completed', '紧急已完成', '紧急'],
    ];
    for (const [positionId, name] of positions) {
      await teable.createRecord('recruitment_positions', { 职位ID: positionId, 职位名称: name, 部门: '测试部', 发布状态: '招聘中', 招聘HR: '张杰', 备用招聘HR: '张晓霞' });
    }
    for (const [positionId, name, priority] of positions) {
      await teable.createRecord('recruitment_monthly_demands', { 需求记录ID: `demand_${positionId}`, 需求月份: '2026-09', 职位ID: positionId, 职位名称: name, 部门: '测试部', 需求数量: positionId === 'pos_completed' ? 1 : 3, 需求状态: '已确认', 审批状态: '已通过', 优先级: priority });
    }
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'candidate_urgent_one', 姓名: '候选人甲', 候选人状态: '已入职', 天玑入职日期: '2026-09-10' });
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'candidate_completed', 姓名: '候选人乙', 候选人状态: '已入职', 天玑入职日期: '2026-09-11' });
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'application_urgent_one', 候选人ID: 'candidate_urgent_one', 职位ID: 'pos_urgent_one', 当前阶段: '已入职', 更新时间: '2026-09-10T00:00:00.000Z' });
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'application_completed', 候选人ID: 'candidate_completed', 职位ID: 'pos_completed', 当前阶段: '已入职', 更新时间: '2026-09-11T00:00:00.000Z' });
    await teable.createRecord('recruitment_offers', { OfferID: 'offer_urgent_one', 候选人ID: 'candidate_urgent_one', 职位ID: 'pos_urgent_one', 发送时间: '2026-09-10T10:00:00.000Z', 发送状态: '已发送' });
    await teable.createRecord('recruitment_offers', { OfferID: 'offer_completed', 候选人ID: 'candidate_completed', 职位ID: 'pos_completed', 发送时间: '2026-09-11T10:00:00.000Z', 发送状态: '已发送' });

    const hiring = await service.monthlyHiring('2026-09');
    assert.deepEqual(hiring.departments.map((row) => row.role), ['紧急未到岗', '紧急已到岗一人', '重要未到岗', '一般未到岗', '紧急已完成']);
    assert.deepEqual(hiring.departments.map((row) => row.priority), ['紧急', '紧急', '重要', '储备', '紧急']);
    assert.equal(hiring.departments[0].recruiter, '张杰');
    assert.equal(hiring.departments[0].backupRecruiter, '张晓霞');
    assert.equal(hiring.departments.at(-1).completedAll, true);
    assert.equal(hiring.summary.actualOffers, 2);
    assert.equal(hiring.departments[0].completionRate, 0);
    assert.equal(hiring.departments[1].remaining, 2);
  } finally {
    restore();
  }
});

test('monthly hiring only shows demands for published positions', async () => {
  const memory = memoryTeable(), restore = memory.install();
  try {
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_pending_visible', 职位名称: '待审批紧急岗位', 部门: '商务部', 发布状态: '待发布' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_published_visible', 职位名称: '招聘中重要岗位', 部门: '商务部', 发布状态: '招聘中', 招聘状态: '招聘中' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_paused_hidden', 职位名称: '已暂停一般岗位', 部门: '商务部', 发布状态: '已下线' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_rejected_hidden', 职位名称: '已驳回重要岗位', 部门: '商务部', 发布状态: '待发布' });
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'demand_pending_visible', 需求月份: '2026-09', 职位ID: 'pos_pending_visible', 职位名称: '待审批紧急岗位', 部门: '商务部', 需求数量: 3, 需求状态: '待审批', 审批状态: '待审批', 优先级: '紧急' });
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'demand_published_visible', 需求月份: '2026-09', 职位ID: 'pos_published_visible', 职位名称: '招聘中重要岗位', 部门: '商务部', 需求数量: 2, 需求状态: '已确认', 审批状态: '已通过', 优先级: '重要' });
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'demand_paused_hidden', 需求月份: '2026-09', 职位ID: 'pos_paused_hidden', 职位名称: '已暂停一般岗位', 部门: '商务部', 需求数量: 2, 需求状态: '已确认', 审批状态: '已通过', 优先级: '一般' });
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'demand_rejected_hidden', 需求月份: '2026-09', 职位ID: 'pos_rejected_hidden', 职位名称: '已驳回重要岗位', 部门: '商务部', 需求数量: 1, 需求状态: '审批驳回', 审批状态: '已驳回', 优先级: '重要' });

    const service = new RecruitmentService({ requireTableId: (name) => name });
    const hiring = await service.monthlyHiring('2026-09');
    assert.equal(hiring.summary.demand, 2);
    assert.deepEqual(hiring.departments.map((row) => row.role), ['招聘中重要岗位']);
    assert.equal(hiring.departments[0].priority, '重要');
  } finally { restore(); }
});

test('monthly hiring uses Shanghai month boundaries and real resume and offer events', async () => {
  const memory = memoryTeable(), restore = memory.install();
  try {
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'candidate_in_month', 姓名: '月内候选人', 候选人状态: '面试' });
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'candidate_before_month', 姓名: '月前候选人', 候选人状态: '面试' });
    await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_in_month', 候选人ID: 'candidate_in_month', 解析状态: '已完成', 创建时间: '2026-08-31T16:01:00.000Z' });
    await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_before_month', 候选人ID: 'candidate_before_month', 解析状态: '已完成', 创建时间: '2026-08-22T15:59:00.000Z' });
    await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_failed', 候选人ID: 'candidate_in_month', 解析状态: '失败', 创建时间: '2026-09-05T00:00:00.000Z' });
    await teable.createRecord('recruitment_interviews', { 面试ID: 'interview_in_month', 候选人ID: 'candidate_in_month', 开始时间: '2026-08-31T16:30:00.000Z', 面试状态: '待候选人确认' });
    await teable.createRecord('recruitment_interviews', { 面试ID: 'interview_cancelled', 候选人ID: 'candidate_in_month', 开始时间: '2026-09-02T02:00:00.000Z', 面试状态: '已取消' });
    await teable.createRecord('recruitment_offers', { OfferID: 'offer_sent', 候选人ID: 'candidate_in_month', Offer状态: '待候选人答复', 发送状态: '已发送', 创建时间: '2026-08-15T00:00:00.000Z', 发送时间: '2026-09-03T02:00:00.000Z' });
    await teable.createRecord('recruitment_offers', { OfferID: 'offer_not_sent', 候选人ID: 'candidate_before_month', Offer状态: '待发送', 发送状态: '待人工发送', 创建时间: '2026-09-04T00:00:00.000Z', 发送时间: '' });

    const service = new RecruitmentService({ requireTableId: (name) => name });
    const hiring = await service.monthlyHiring('2026-09');
    assert.equal(hiring.summary.resumes, 1);
    assert.equal(hiring.summary.interviews, 1);
    assert.equal(hiring.summary.offers, 1);
  } finally { restore(); }
});

test('position validation rejects invalid input before writing records', async () => {
  const memory = memoryTeable(), restore = memory.install();
  try {
    const service = new RecruitmentService({ requireTableId: (name) => name });
    await assert.rejects(() => service.createPosition({ name: '', department: '技术部', headcount: 0 }), /岗位名称/);
  } finally { restore(); }
});

test('monthly demand transcript AI only matches positions visible to the current department', async () => {
  const memory = memoryTeable(), restore = memory.install(), originalChat = llm.chat;
  try {
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_sales', 组织名称: '商务部', 组织类型: '部门', 组织状态: '启用' });
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_product', 组织名称: '产品部', 组织类型: '部门', 组织状态: '启用' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_sales', 职位名称: '商务开发', 部门ID: 'dept_sales', 部门: '商务部', 发布状态: '招聘中' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_product', 职位名称: '产品经理', 部门ID: 'dept_product', 部门: '产品部', 发布状态: '招聘中' });
    llm.chat = async (messages) => {
      assert.match(messages[0].content, /商务开发（商务部）/);
      assert.doesNotMatch(messages[0].content, /产品经理（产品部）/);
      return JSON.stringify({ month: '2026-10', positionName: '商务开发', headcount: 3, demandType: '新增需求', priority: '紧急', expectedArrivalDate: '2026-10-15', note: '新业务线启动，需要补充3名商务开发。' });
    };
    const service = new RecruitmentService({ requireTableId: (name) => name });
    const profile = { roleCodes: ['business_manager'], dataScopes: [{ roleCode: 'business_manager', type: 'assigned_departments', businessUnitId: '', departmentIds: ['dept_sales'] }] };
    const result = await service.extractMonthlyDemandTranscript('下个月商务开发要3个人，紧急，10月15日前到岗，因为新业务线启动。', profile);
    assert.deepEqual(result.extraction, {
      month: '2026-10', positionId: 'pos_sales', positionName: '商务开发', headcount: 3, demandType: '新增需求', priority: '紧急',
      expectedArrivalDate: '2026-10-15', latestArrivalDate: '', note: '新业务线启动，需要补充3名商务开发。', matchedPosition: true,
    });
    assert.equal(result.availablePositions, 1);
  } finally {
    llm.chat = originalChat;
    restore();
  }
});

test('historical pending demand approvals are not automatically sent after approver configuration changes', async () => {
  const memory = memoryTeable(), restore = memory.install(), previousApprover = process.env.WECOM_RECRUITMENT_APPROVER_USER_ID, previousMessageRecipient = process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID, previousPublicUrl = process.env.APP_PUBLIC_URL;
  try {
    delete process.env.WECOM_RECRUITMENT_APPROVER_USER_ID;
    await teable.createRecord('recruitment_positions', {
      职位ID: 'pos_retry_demand', 职位名称: '商务开发', 部门: '商务部', 负责人: '王HR', 招聘人数: 2,
      发布状态: '待发布', 招聘状态: '待启动', 审批状态: '已通过', 创建时间: '2026-09-23T12:00:00.000Z', 更新时间: '2026-09-23T12:00:00.000Z',
    });
    const approvalMessages = [];
    const messages = {
      preview: async (input) => { approvalMessages.push(input); return { messageId: 'approval_retry_message' }; },
      send: async (messageId) => ({ messageId, status: '已发送' }),
    };
    const service = new RecruitmentService({ requireTableId: (name) => name }, messages);
    const demand = await service.saveMonthlyDemand({ month: '2026-09', positionId: 'pos_retry_demand', headcount: 2, demandType: '储备需求', priority: '一般', note: '为下一季度商务拓展提前储备候选人。', operator: '王HR' }, 'recruiter_user');
    assert.equal(demand.approvalNotification.status, '未配置');

    process.env.WECOM_RECRUITMENT_APPROVER_USER_ID = 'LiuJinHu';
    process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID = 'LiuJinHu';
    process.env.APP_PUBLIC_URL = 'https://recruitment.example.test/';
    await teable.createRecord('recruitment_users', { 用户ID: 'approver_user', 姓名: '刘金虎', 企业微信用户ID: 'LiuJinHu', 天玑微信ID: 'LiuJinHu', 用户状态: '启用' });
    const retry = await service.retryPendingRecruitmentApprovalNotifications();
    assert.deepEqual(retry, { scanned: 0, sent: 0, failed: 0 });
    assert.equal(approvalMessages.length, 0);
    const stored = memory.records.get('recruitment_monthly_demands')[0];
    assert.equal(stored.fields['审批通知状态'], '未配置');
    assert.match(stored.fields['审批通知错误'], /WECOM_RECRUITMENT_APPROVER_USER_ID/);
  } finally {
    if (previousApprover === undefined) delete process.env.WECOM_RECRUITMENT_APPROVER_USER_ID;
    else process.env.WECOM_RECRUITMENT_APPROVER_USER_ID = previousApprover;
    if (previousMessageRecipient === undefined) delete process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID;
    else process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID = previousMessageRecipient;
    if (previousPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousPublicUrl;
    restore();
  }
});

test('recruitment approval notification stops when approver IDs resolve to different employees', async () => {
  const memory = memoryTeable(), restore = memory.install(), previousApprover = process.env.WECOM_RECRUITMENT_APPROVER_USER_ID, previousMessageRecipient = process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID, previousPublicUrl = process.env.APP_PUBLIC_URL;
  try {
    process.env.WECOM_RECRUITMENT_APPROVER_USER_ID = 'LiuJinHu';
    process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID = 'LiuJinHu';
    process.env.APP_PUBLIC_URL = 'https://recruitment.example.test/';
    await teable.createRecord('recruitment_users', { 用户ID: 'li_user', 姓名: '李思奇', 企业微信用户ID: 'LiSiQi', 天玑微信ID: 'LiuJinHu', 用户状态: '启用' });
    await teable.createRecord('recruitment_users', { 用户ID: 'liu_user', 姓名: '刘金虎', 企业微信用户ID: 'LiuJinHu', 天玑微信ID: 'LiuJinHu', 用户状态: '启用' });
    await teable.createRecord('recruitment_positions', {
      职位ID: 'mismatch_position', 职位名称: '测试岗位', 部门: '测试部门', 招聘人数: 1,
      审批状态: '待审批', 审批提交时间: '2026-09-30T00:00:00.000Z', 审批通知状态: '待发送',
    });
    const previews = [];
    const messages = {
      preview: async (input) => { previews.push(input); return { messageId: 'must_not_send' }; },
      send: async () => { throw new Error('不应调用消息发送'); },
    };
    const service = new RecruitmentService({ requireTableId: (name) => name }, messages);

    const result = await service.retryPendingRecruitmentApprovalNotifications();

    assert.deepEqual(result, { scanned: 1, sent: 0, failed: 1 });
    assert.equal(previews.length, 0);
    assert.equal(memory.records.get('recruitment_positions')[0].fields['审批通知状态'], '发送失败');
    assert.match(memory.records.get('recruitment_positions')[0].fields['审批通知错误'], /指向不同员工/);
  } finally {
    if (previousApprover === undefined) delete process.env.WECOM_RECRUITMENT_APPROVER_USER_ID;
    else process.env.WECOM_RECRUITMENT_APPROVER_USER_ID = previousApprover;
    if (previousMessageRecipient === undefined) delete process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID;
    else process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID = previousMessageRecipient;
    if (previousPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousPublicUrl;
    restore();
  }
});

test('recruitment approval retry sends nothing when configured approver is not LiuJinHu', async () => {
  const memory = memoryTeable(), restore = memory.install(), previousApprover = process.env.WECOM_RECRUITMENT_APPROVER_USER_ID, previousMessageRecipient = process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID;
  try {
    process.env.WECOM_RECRUITMENT_APPROVER_USER_ID = 'LiSiQi';
    process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID = 'LiSiQi';
    await teable.createRecord('recruitment_users', { 用户ID: 'li_user', 姓名: '李思奇', 企业微信用户ID: 'LiSiQi', 天玑微信ID: 'LiSiQi', 用户状态: '启用' });
    await teable.createRecord('recruitment_positions', {
      职位ID: 'wrong_approver_position', 职位名称: '测试岗位', 审批状态: '待审批',
      审批提交时间: '2026-09-30T00:00:00.000Z', 审批通知状态: '待发送',
    });
    const previews = [];
    const messages = {
      preview: async (input) => { previews.push(input); return { messageId: 'must_not_send' }; },
      send: async () => { throw new Error('不应调用消息发送'); },
    };
    const service = new RecruitmentService({ requireTableId: (name) => name }, messages);

    const result = await service.retryPendingRecruitmentApprovalNotifications();

    assert.deepEqual(result, { scanned: 0, sent: 0, failed: 0 });
    assert.equal(previews.length, 0);
  } finally {
    if (previousApprover === undefined) delete process.env.WECOM_RECRUITMENT_APPROVER_USER_ID;
    else process.env.WECOM_RECRUITMENT_APPROVER_USER_ID = previousApprover;
    if (previousMessageRecipient === undefined) delete process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID;
    else process.env.TIANJI_RECRUITMENT_APPROVER_WECHAT_ID = previousMessageRecipient;
    restore();
  }
});

test('existing active demands publish waiting positions without reopening paused positions', async () => {
  const memory = memoryTeable(), restore = memory.install();
  try {
    const month = new Date().toISOString().slice(0, 7);
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_waiting', 职位名称: '待发布岗位', 发布状态: '待发布', 招聘状态: '待启动' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_paused', 职位名称: '暂停岗位', 发布状态: '已下线', 招聘状态: '暂停招聘' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_pending', 职位名称: '待审批岗位', 发布状态: '待发布', 招聘状态: '待启动' });
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'demand_waiting', 需求月份: month, 职位ID: 'pos_waiting', 需求数量: 2, 需求状态: '已确认', 审批状态: '已通过' });
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'demand_paused', 需求月份: month, 职位ID: 'pos_paused', 需求数量: 1, 需求状态: '已确认', 审批状态: '已通过' });
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'demand_pending', 需求月份: month, 职位ID: 'pos_pending', 需求数量: 1, 需求状态: '待审批', 审批状态: '待审批' });
    const service = new RecruitmentService({ requireTableId: (name) => name });
    const result = await service.publishExistingDemandPositions();
    assert.deepEqual(result, { scanned: 3, published: 2, skipped: 1 });
    const positions = memory.records.get('recruitment_positions');
    assert.equal(positions.find((row) => row.fields['职位ID'] === 'pos_waiting').fields['发布状态'], '招聘中');
    assert.equal(positions.find((row) => row.fields['职位ID'] === 'pos_waiting').fields['招聘状态'], '招聘中');
    assert.equal(positions.find((row) => row.fields['职位ID'] === 'pos_paused').fields['发布状态'], '已下线');
    assert.equal(positions.find((row) => row.fields['职位ID'] === 'pos_pending').fields['发布状态'], '招聘中');
    const reopened = await service.batchPublishPositions(['pos_paused'], '招聘管理员');
    assert.deepEqual(reopened, { published: 1, skipped: 0, failed: 0, errors: [] });
    assert.equal(positions.find((row) => row.fields['职位ID'] === 'pos_paused').fields['发布状态'], '招聘中');
    await new Promise((resolve) => setImmediate(resolve));
  } finally { restore(); }
});

test('position update keeps name and responsibilities synchronized', async () => {
  const memory = memoryTeable(), restore = memory.install();
  try {
    await teable.createRecord('recruitment_users', { 用户ID: 'hr_frontend', 姓名: '前端招聘HR', 天玑微信ID: 'HR_FRONTEND', 用户状态: '启用' });
    const service = new RecruitmentService({ requireTableId: (name) => name });
    const position = await service.createPosition({
      name: '前端开发工程师', department: '技术部', headcount: 2, responsibilities: '负责Web前端开发', recruiterUserId: 'hr_frontend',
    }, '招聘管理员');
    const updated = await service.updatePosition(position.id, { name: '高级前端开发工程师', responsibilities: '负责Web前端开发与小程序', changeReason: '岗位升级' }, '招聘管理员');
    assert.equal(updated.name, '高级前端开发工程师');
    assert.equal(updated.responsibilities, '负责Web前端开发与小程序');
    assert.equal(updated.jdVersion, 2);
  } finally { restore(); }
});

test('position selectors are limited to the current department while system administrators see all', async () => {
  const memory = memoryTeable(), restore = memory.install();
  try {
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'org_sales', 组织类型: '部门', 组织名称: '商务', 组织状态: '启用' });
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'org_product', 组织类型: '部门', 组织名称: '产品部', 组织状态: '启用' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_sales', 职位名称: '商务开发', 部门ID: 'org_sales', 部门: '商务', 发布状态: '招聘中' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_sales_legacy', 职位名称: '商务运营', 部门: '商务', 发布状态: '招聘中' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_sales_platform', 职位名称: '商务专员', 部门ID: 'org_sales', 部门: '商务', 发布状态: '招聘中' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_product', 职位名称: '产品经理', 部门ID: 'org_product', 部门: '产品部', 发布状态: '招聘中' });
    await teable.createRecord('recruitment_users', { 用户ID: 'user_sales', 用户状态: '启用', 部门IDJSON: '["org_sales"]', 部门JSON: '["商务"]' });
    await teable.createRecord('recruitment_monthly_demands', { 月度需求ID: 'demand_sales_platform', 需求月份: '2026-10', 需求状态: '进行中', 需求数量: 2, 审批状态: '已通过', 职位ID: 'pos_sales_platform', 部门: '商务', 职位名称: '商务专员' });
    const service = new RecruitmentService({ requireTableId: (name) => name });
    const salesProfile = {
      userId: 'user_sales', roleCodes: ['department_reviewer'], pages: ['positions'], actions: ['create_demand'], sensitiveFields: [],
      dataScopes: [{ roleCode: 'department_reviewer', type: 'assigned_departments', businessUnitId: '', departmentIds: ['org_sales'] }],
    };
    const adminProfile = {
      userId: 'user_admin', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], sensitiveFields: [],
      dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }],
    };

    const scopedOptions = await service.positionOptions(salesProfile);
    assert.deepEqual(scopedOptions.positions.map((item) => item.id).sort(), ['pos_sales', 'pos_sales_legacy', 'pos_sales_platform']);
    const scopedOverview = await service.overview(salesProfile);
    assert.deepEqual(scopedOverview.positions.map((item) => item.id).sort(), ['pos_sales', 'pos_sales_legacy', 'pos_sales_platform']);
    assert.deepEqual((await service.listMonthlyDemands('2026-10', '', salesProfile)).demands.map((item) => item.positionId), ['pos_sales_platform']);
    const scopedBoard = await service.monthlyHiring('2026-10', salesProfile);
    assert.equal(scopedBoard.summary.demand, 2);
    assert.equal(scopedBoard.departments.length, 1);
    const scopedFormOptions = await service.formOptions(salesProfile);
    assert.deepEqual(scopedFormOptions.departments.map((item) => item.id), ['org_sales']);
    await assert.rejects(
      () => service.saveMonthlyDemand({ month: '2026-10', positionId: 'pos_product', headcount: 1, demandType: '新增需求', priority: '重要', note: '跨部门需求测试' }, 'user_sales', salesProfile),
      /只能选择或操作所属部门的岗位/,
    );
    const organizationCount = memory.records.get('recruitment_organization_units').length;
    await assert.rejects(
      () => service.createPosition({ name: '越权岗位', department: '新建部门' }, '商务员工', 'user_sales', salesProfile),
      /只能选择所属部门/,
    );
    assert.equal(memory.records.get('recruitment_organization_units').length, organizationCount);

    const adminOptions = await service.positionOptions(adminProfile);
    assert.deepEqual(adminOptions.positions.map((item) => item.id).sort(), ['pos_product', 'pos_sales', 'pos_sales_legacy', 'pos_sales_platform']);
  } finally { restore(); }
});
