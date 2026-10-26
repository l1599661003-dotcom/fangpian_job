import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { teable } from '../dist/platform/teable.js';
import { tianjiWeixinMessage } from '../dist/platform/tianji-weixin-message.js';
import { storage } from '../dist/platform/storage.js';
import { jobs } from '../dist/platform/jobs.js';
import { llm } from '../dist/platform/llm.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { OffersService } from '../dist/modules/offers/offers.service.js';
import { OffersController } from '../dist/modules/offers/offers.controller.js';
import { MessagesService } from '../dist/modules/messages/messages.service.js';
import { BackgroundChecksService } from '../dist/modules/background-checks/background-checks.service.js';
import { EmployeeLifecycleService } from '../dist/modules/employee-lifecycle/employee-lifecycle.service.js';

function installMemory() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const originals = {}, methods = ['listRecords', 'listAllRecords', 'listByField', 'findOneByField', 'getRecord', 'createRecord', 'updateRecord', 'deleteRecord'];
  for (const method of methods) originals[method] = teable[method];
  let sequence = 0;
  teable.listRecords = async (tableId, options = {}) => {
    const rows = records.get(tableId) || [];
    const skip = Number(options.skip || 0), take = Number(options.take || rows.length || 1);
    return rows.slice(skip, skip + take);
  };
  teable.listAllRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.listByField = async (tableId, fieldName, value, take = 200) => (records.get(tableId) || []).filter((row) => String(row.fields[fieldName] ?? '') === String(value ?? '')).slice(0, take);
  teable.findOneByField = async (tableId, fieldName, value) => (records.get(tableId) || []).find((row) => String(row.fields[fieldName] ?? '') === String(value ?? ''));
  teable.getRecord = async (tableId, recordId) => (records.get(tableId) || []).find((row) => row.id === recordId);
  teable.createRecord = async (tableId, fields) => {
    const row = { id: `${tableId}_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() };
    records.get(tableId).push(row);
    return row;
  };
  teable.updateRecord = async (tableId, recordId, fields) => {
    const row = records.get(tableId).find((item) => item.id === recordId);
    if (!row) throw new Error(`record missing ${tableId}/${recordId}`);
    row.fields = { ...row.fields, ...fields };
    return row;
  };
  teable.deleteRecord = async () => {};
  return { records, restore: () => Object.assign(teable, originals) };
}

test('social Offer PDF uses a stable embedded TrueType font', async () => {
  const execute = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'offer-pdf-font-'));
  try {
    const offers = new OffersService({ requireTableId: (name) => name }, new MessagesService({ requireTableId: (name) => name }));
    const values = {
      candidateName: '顾承昀', candidateHonorific: '女士', offerNumber: 'FP-FONT-001', role: 'AI产品经理', department: '产品',
      location: '山东省烟台市', contractType: '劳动合同', startDate: '2026-10-22', reportingTo: '张总',
      monthlySalary: '5000', totalSalary: '5000', dailySalary: '0', performanceSalary: '0',
      commissionSalary: '0', performanceIncluded: false, commissionIncluded: false,
      probationMonths: '3个月，试用期薪资100%', deadlineDate: '2026-11-02',
      validFrom: '2026-10-19', validTo: '2026-11-02',
    };
    const pdfPath = join(directory, 'offer.pdf');
    await writeFile(pdfPath, Buffer.from(await offers.renderPdf(values, '社招', 'font-test')));
    const text = await execute('pdftotext', ['-layout', pdfPath, '-']);
    assert.match(text.stdout, /顾承昀/);
    assert.match(text.stdout, /AI产品经理/);
    assert.match(text.stdout, /顾承昀\s+女士/);
    assert.match(text.stdout, /薪酬5000元\/月，包含底薪5000元，试用期3个月，试用薪资100%，试用期即缴纳五险一金。/);
    const fonts = await execute('pdffonts', [pdfPath]);
    assert.match(fonts.stdout, /HarmonyOS_Sans_SC/);
    assert.doesNotMatch(fonts.stdout, /SourceHanSansCN-Regular/);
    assert.doesNotMatch(fonts.stderr, /Embedded font file may be invalid|Mismatch between font type and embedded font file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Offer signing deadline follows the validity end date in both templates', async () => {
  const execute = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'offer-deadline-'));
  try {
    const offers = new OffersService({ requireTableId: (name) => name }, new MessagesService({ requireTableId: (name) => name }));
    const row = { id: 'rec_deadline', fields: {
      'OfferID': 'offer_deadline', 'Offer编号': 'FP-DEADLINE-001', '岗位名称': 'AI产品经理', '部门': '产品部', '工作地点': '山东省烟台市',
      '入职日期': '2026-10-22', '有效期开始': '2026-10-19', '有效期结束': '2026-11-02', '汇报上级': '张总', '称谓': '女士',
      '试用期月数': '3', '基本月薪': 5000, '薪资结构JSON': JSON.stringify({ 底薪: 5000 }),
    } };
    const candidate = { id: 'cand_deadline', fields: { '姓名': '顾承昀', '性别': '女' } };
    const expectations = [
      ['社招', /1\.\s*于\s*2026\s*年\s*11\s*月\s*2\s*日\s*18:00\s*前\s*签署本文件/],
      ['实习', /1\.\s*于\s*2026-11-02\s*18:00\s*前\s*签署本文件/],
    ];
    for (const [templateType, sentence] of expectations) {
      const values = offers.fileValues(row, candidate, templateType);
      assert.equal(values.deadlineDate, values.validTo);
      assert.equal(values.validTo, '2026-11-02');
      const pdfPath = join(directory, `${templateType}.pdf`);
      await writeFile(pdfPath, Buffer.from(await offers.renderPdf(values, templateType, 'deadline-test')));
      const text = await execute('pdftotext', ['-layout', pdfPath, '-']);
      assert.match(text.stdout, sentence);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Offer PDF font selection verifies every required Chinese character', async () => {
  const offers = new OffersService({ requireTableId: (name) => name }, new MessagesService({ requireTableId: (name) => name }));
  const requiredText = '顾承昀 产品负责人 其他';
  const fontBytes = await offers.offerPdfFontBytes(requiredText);
  assert.ok(fontBytes.length > 100_000);
  assert.equal(offers.offerFontSupportsText(fontBytes, requiredText), true);
  const interBytes = await readFile('/usr/share/fonts/arp/inter/Inter-Regular.ttf');
  assert.equal(offers.offerFontSupportsText(interBytes, requiredText), false);
});

test('interview Offer context uses the linked candidate and position without department position access', async () => {
  const memory = installMemory();
  try {
    const create = teable.createRecord;
    await create('recruitment_candidates', { 候选人ID: 'tal_interview_offer', 姓名: '面试候选人', 性别: '女', 电话: '13600136000', 邮箱: 'candidate@example.com' });
    await create('recruitment_positions', { 职位ID: 'pos_interview_offer', 职位名称: '定向岗位', 部门: '其他部门', 工作地点: '烟台' });
    await create('recruitment_applications', { 应聘记录ID: 'app_interview_offer', 候选人ID: 'tal_interview_offer', 职位ID: 'pos_interview_offer' });
    await create('recruitment_interviews', { 面试ID: 'interview_offer', 候选人ID: 'tal_interview_offer', 应聘记录ID: 'app_interview_offer', 职位ID: 'pos_interview_offer' });

    const database = { requireTableId: (name) => name };
    const offers = new OffersService(database, new MessagesService(database));
    const context = await offers.interviewOfferContext({ interviewId: 'interview_offer', candidateId: 'tal_interview_offer', applicationId: 'app_interview_offer', positionId: 'pos_interview_offer' });
    assert.deepEqual(context, {
      interviewId: 'interview_offer',
      candidate: { id: 'tal_interview_offer', name: '面试候选人', gender: '女', phone: '13600136000', email: 'candidate@example.com', bestMatchRole: '', jobIntention: '' },
      applicationId: 'app_interview_offer',
      position: { id: 'pos_interview_offer', name: '定向岗位', department: '其他部门', location: '烟台' },
    });
    await assert.rejects(() => offers.interviewOfferContext({ interviewId: 'interview_offer', positionId: 'pos_another' }), /岗位与本次面试不一致/);

    let positionAccessChecks = 0;
    const controller = new OffersController(
      { interviewOfferContext: async () => context, create: async input => input },
      { assertPositionAccess: async () => { positionAccessChecks++; throw new Error('不应检查部门岗位范围'); } },
      { getRequestAccess: async () => ({ identity: { userName: '招聘HR', userId: 'hr_1' }, profile: {} }) },
    );
    const created = await controller.create({}, { candidateId: 'tal_interview_offer', interviewId: 'interview_offer', applicationId: 'app_interview_offer', positionId: 'pos_interview_offer', role: '不可信岗位', department: '不可信部门', baseSalary: 12000, startDate: '2026-10-01', reportingTo: '张总', validFrom: '2026-10-01', validTo: '2026-10-31' });
    assert.equal(positionAccessChecks, 0);
    assert.equal(created.role, '定向岗位');
    assert.equal(created.department, '其他部门');
    assert.equal(created.candidateId, 'tal_interview_offer');
  } finally { memory.restore(); }
});

test('approved Offer, secure acceptance, background check and onboarding form one auditable lifecycle', async () => {
  const memory = installMemory(), originalUpload = storage.upload, originalPublicUrl = process.env.APP_PUBLIC_URL, originalOfferFontPath = process.env.OFFER_PDF_FONT_PATH;
  const today = new Date().toISOString().slice(0, 10);
  const uploads = [];
  try {
    process.env.OFFER_PDF_FONT_PATH = '/usr/share/fonts/arp/does-not-exist.ttf';
    storage.upload = async (filename, contentType, bytes) => {
      uploads.push({ filename, contentType, bytes: Buffer.from(bytes) });
      return { uploadUrl: 'memory://upload', method: 'PUT', objectKey: filename, cdnUrl: `https://files.example.test/${encodeURIComponent(filename)}`, contentType, expiresIn: 900 };
    };
    const create = teable.createRecord;
    const candidate = await create('recruitment_candidates', { 候选人ID: 'tal_offer', 姓名: '周敏', 电话: '13600136000', 候选人状态: '待Offer决策', 人才池: '公司人才库', 合并状态: '独立档案', 创建时间: '2026-08-20T00:00:00.000Z', 更新时间: '2026-08-20T00:00:00.000Z' });
    const application = await create('recruitment_applications', { 应聘记录ID: 'app_offer', 候选人ID: 'tal_offer', 职位ID: 'pos_product', 需求ID: 'demand_product', 当前阶段: '待Offer决策', 当前状态: '进行中', 创建时间: '2026-08-20T00:00:00.000Z', 更新时间: '2026-08-20T00:00:00.000Z' });
    const database = { requireTableId: (name) => name };

    const offers = new OffersService(database, new MessagesService(database));
    const initialTemplates = await offers.templates();
    assert.equal(initialTemplates.templates.length, 2);
    const customTemplate = await offers.createTemplate({
      name: '产品负责人社招模板',
      type: '社招',
      description: '用于产品负责人及以上岗位',
      fields: [
        { key: 'startDate', label: '计划入职日期', inputType: 'date', required: true, locked: true },
        { key: 'baseSalary', label: '固定月薪（元）', inputType: 'number', required: true, locked: true },
        { key: 'performanceSalary', label: '绩效月薪（元）', inputType: 'number' },
        { key: 'commission', label: '岗位其他（元）', inputType: 'text' },
      ],
      operator: '王HR',
    });
    assert.equal(customTemplate.type, '社招');
    assert.equal(customTemplate.fields.find((field) => field.key === 'baseSalary').label, '固定月薪（元）');
    assert.equal(customTemplate.fields.find((field) => field.key === 'commission').label, '岗位其他（元）');
    const reloadedTemplates = await new OffersService(database, new MessagesService(database)).templates();
    assert.equal(reloadedTemplates.templates.length, 3, 'custom templates must not be deleted when defaults are ensured');
    const created = await offers.create({ candidateId: 'tal_offer', applicationId: 'app_offer', role: '高级产品经理', department: '产品部', location: '杭州', baseSalary: 26000, performanceSalary: 4000, commission: 1500, bonusMonths: 2, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, probationMonths: '3个月，试用期薪资80%', templateId: customTemplate.id, operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(created.status, '待发送');
    assert.equal(created.approvalStatus, '已通过');
    assert.equal(memory.records.get('recruitment_offer_approval_events').length, 0);
    assert.equal(uploads[0].contentType, 'application/pdf');
    assert.equal(uploads[0].bytes.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(uploads[0].bytes.length > 1000);
    const link = await offers.createResponseLink(created.offerId, { channel: '手动链接', recipient: '候选人微信', expiresHours: 72, operator: '王HR' });
    assert.equal(link.sendStatus, '待人工发送');
    const offerRow = memory.records.get('recruitment_offers')[0];
    const persistedSalary = JSON.parse(offerRow.fields['薪资结构JSON']);
    assert.equal(persistedSalary['底薪'], 26000);
    assert.equal(persistedSalary['绩效'], 4000);
    assert.equal(persistedSalary['其他'], 1500);
    assert.equal(offerRow.fields['试用期月数'], '3个月，试用期薪资80%');
    assert.notEqual(offerRow.fields['答复Token哈希'], link.token);
    assert.equal(offerRow.fields['Token前缀'], link.token.slice(0, 8));
    assert.ok(!Object.values(offerRow.fields).includes(link.token), 'raw Offer token must not be persisted');
    assert.equal(memory.records.get('recruitment_offer_send_events')[0].fields['发送状态'], '待人工发送');
    const publicOffer = await offers.publicOffer(link.token);
    assert.equal(publicOffer.candidateName, '周敏');
    assert.equal(publicOffer.salary.total, 31500);
    assert.equal(publicOffer.probationMonths, '3个月，试用期薪资80%');

    const response = await offers.respond(link.token, { response: 'accept', note: '确认接受，按约定日期到岗' });
    assert.deepEqual(response, { response: '接受', targetStage: '待入职' });
    assert.equal(application.fields['当前阶段'], '待入职');
    assert.equal(candidate.fields['候选人状态'], '待入职');
    await assert.rejects(() => offers.respond(link.token, { response: 'accept' }), /已经答复/);
    const answeredOffer = await offers.publicOffer(link.token);
    assert.equal(answeredOffer.status, '已接受');
    assert.equal(answeredOffer.response, '接受');
    assert.equal(answeredOffer.fileUrl, offerRow.fields['Offer文件地址']);
    assert.ok(answeredOffer.fileUrl.startsWith('https://files.example.test/'));

    const background = new BackgroundChecksService(database);
    const backgroundCase = await background.create({ candidateId: 'tal_offer', applicationId: 'app_offer', offerId: created.offerId, scopes: ['身份与学历', '工作履历', '工作表现'], operator: '王HR', operatorUserId: 'hr_1' });
    await assert.rejects(() => background.addVerification(backgroundCase.backgroundId, { type: '工作履历', result: '经历一致', consistency: '一致', evidenceSource: '前雇主HR回访' }), /授权后/);
    await background.authorize(backgroundCase.backgroundId, { status: '已授权', method: '候选人在线确认', authorizedAt: new Date().toISOString(), note: '仅授权本次录用所需范围', operator: '王HR', operatorUserId: 'hr_1' });
    await background.addContact(backgroundCase.backgroundId, { name: '李女士', relationship: '前雇主HR', company: '某科技公司', phone: '13500135000', status: '已联系', note: '候选人授权联系人', operator: '王HR' });
    await background.addVerification(backgroundCase.backgroundId, { type: '工作履历', company: '某科技公司', role: '产品经理', declaredStart: '2021-03', declaredEnd: '2026-07', verifiedStart: '2021-03', verifiedEnd: '2026-07', declaration: '负责产品规划和团队协作', result: '任职时间、岗位和主要职责一致', leavingReason: '寻求更大业务空间', performance: '绩效稳定，项目交付良好', managementPerformance: '带领4人项目组', consistency: '一致', evidenceSource: '候选人授权的前雇主HR电话核验', verifier: '王HR' });
    const report = await background.generateReport(backgroundCase.backgroundId, { operator: '王HR' });
    assert.equal(report.status, '待结论确认');
    assert.equal(uploads.length, 2);
    const conclusion = await background.conclude(backgroundCase.backgroundId, { conclusion: '通过', opinion: '授权范围内核验信息一致，无阻断录用风险', operator: 'HR负责人', operatorUserId: 'hr_lead' });
    assert.equal(conclusion.targetStage, '待入职');
    assert.equal(application.fields['当前阶段'], '待入职');
    assert.equal(candidate.fields['候选人状态'], '待入职');

    const recruitment = { syncDemandMetrics: async (demandId, operator) => ({ demandId, operator }) };
    const lifecycle = new EmployeeLifecycleService(database, recruitment, new MessagesService(database));
    lifecycle.startProbationQuestionFeedback = async () => ({ status: '处理中', jobId: 'mock-feedback' });
    const onboarding = await lifecycle.create({ candidateId: 'tal_offer', applicationId: 'app_offer', offerId: created.offerId, plannedStartDate: today, manager: '陈经理', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(onboarding.status, '待入职');
    assert.equal(memory.records.get('recruitment_onboarding_tasks').length, 5);
    const external = await lifecycle.externalRequest(onboarding.onboardingId, { system: '公司OA', operator: '王HR' });
    assert.equal(external.status, '待外部系统接收');
    assert.match(external.boundary, /未连接/);
    const arrival = await lifecycle.arrive(onboarding.onboardingId, { actualDate: today, note: '本人已到岗并完成身份核验', probationMonths: 3, operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(arrival.status, '试用期');
    assert.equal(application.fields['当前阶段'], '已入职');
    assert.equal(candidate.fields['候选人状态'], '已入职');
    assert.equal(memory.records.get('recruitment_probation_reviews').length, 3);
    await assert.rejects(() => lifecycle.arrive(onboarding.onboardingId, { actualDate: today, note: '重复确认' }), /已经确认到岗/);

    const probationRows = memory.records.get('recruitment_probation_reviews');
    const monthlyReview = probationRows.find((row) => row.fields['节点类型'] === '入职一月评价');
    assert.ok(monthlyReview, 'arrival must create the one-month onboarding review');
    const expectedMonthlyDate = new Date(`${today}T12:00:00.000Z`);
    expectedMonthlyDate.setUTCMonth(expectedMonthlyDate.getUTCMonth() + 1);
    assert.equal(monthlyReview.fields['计划日期'], expectedMonthlyDate.toISOString().slice(0, 10));

    process.env.APP_PUBLIC_URL = 'https://resume.example.test';
    monthlyReview.fields['计划日期'] = today;
    const hrNotifications = [];
    lifecycle.messages.notifyPositionHr = async (input) => { hrNotifications.push(input); return { status: '已发送' }; };
    const reminder = await lifecycle.checkProbationReviewReminders('招聘流程自动化');
    assert.equal(reminder.notified, 1);
    assert.equal(hrNotifications.length, 1);
    assert.match(hrNotifications[0].markdown, /述职评级（S\/A\/B）、新人成长等级和述职评价/);
    const reviewLink = memory.records.get('recruitment_public_links').find((row) => row.fields['对象ID'] === monthlyReview.fields['试用期记录ID']);
    const reviewToken = new URL(reviewLink.fields['访问路径']).searchParams.get('onboarding_review_token');
    const publicReview = await lifecycle.publicProbationReviewDetail(reviewToken);
    assert.equal(publicReview.nodeType, '入职一月评价');
    await assert.rejects(() => lifecycle.submitPublicProbationReview(reviewToken, { performanceRating: 'C', growthLevel: '稳定成长', appraisal: '已适应岗位' }), /只能选择S、A或B/);
    const monthlyCompleted = await lifecycle.submitPublicProbationReview(reviewToken, { performanceRating: 'A', growthLevel: '快速成长', appraisal: '已能独立承担核心任务，协作和复盘能力进步明显。', operator: '王HR' });
    assert.equal(monthlyCompleted.performanceRating, 'A');
    assert.equal(monthlyReview.fields['述职评级'], 'A');
    assert.equal(monthlyReview.fields['新人成长等级'], '快速成长');
    assert.match(monthlyReview.fields['述职评价'], /独立承担核心任务/);
    assert.equal(memory.records.get('recruitment_tasks').find((row) => row.fields['对象ID'] === monthlyReview.fields['试用期记录ID']).fields['待办状态'], '已完成');
    assert.equal(reviewLink.fields['链接状态'], '已完成');
    assert.equal((await lifecycle.checkProbationReviewReminders('招聘流程自动化')).notified, 0, 'completed one-month review must not notify twice');

    const finalReview = probationRows.find((row) => row.fields['节点类型'] === '转正评估');
    const completed = await lifecycle.completeProbation(onboarding.onboardingId, finalReview.fields['试用期记录ID'], { score: 92, managerReview: '目标完成良好，协作和执行符合职级要求', employeeFeedback: '已适应团队和业务节奏', recommendation: '转正', operator: '陈经理' });
    assert.equal(completed.recommendation, '转正');
    assert.equal(memory.records.get('recruitment_onboarding_cases')[0].fields['转正状态'], '已转正');

    const stages = memory.records.get('recruitment_stage_events').map((row) => row.fields['新阶段']);
    assert.deepEqual(stages, ['待入职', '待入职', '已入职']);
    const actions = memory.records.get('recruitment_audit_logs').map((row) => row.fields['操作类型']);
    for (const action of ['新建Offer模板', '创建Offer', '生成Offer文件', '候选人答复Offer', '创建背调', '确认背调结论']) assert.ok(actions.includes(action), `missing audit ${action}`);
    const lifecycleEvents = memory.records.get('recruitment_employee_lifecycle_events');
    assert.equal(lifecycleEvents.length, 3);
    assert.equal(lifecycleEvents.at(-1).fields['事件类型'], '完成转正评估');
  } finally {
    storage.upload = originalUpload;
    if (originalPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = originalPublicUrl;
    if (originalOfferFontPath === undefined) delete process.env.OFFER_PDF_FONT_PATH;
    else process.env.OFFER_PDF_FONT_PATH = originalOfferFontPath;
    memory.restore();
  }
});

test('Offer email uses the shared safe HTML card and hides the raw token', async () => {
  const memory = installMemory(), originalSendMail = tianjiWeixinMessage.sendMail, originalPublicUrl = process.env.APP_PUBLIC_URL;
  const mails = [];
  try {
    process.env.APP_PUBLIC_URL = 'https://offer.example.test';
    tianjiWeixinMessage.sendMail = async input => { mails.push(input); return { messageId: 'offer_mail' }; };
    const create = teable.createRecord;
    await create('recruitment_candidates', { 候选人ID: 'tal_offer_mail', 姓名: '<img src=x onerror=alert(1)>周敏', 邮箱: 'offer-candidate@example.test' });
    await create('recruitment_offers', {
      OfferID: 'offer_mail', 候选人ID: 'tal_offer_mail', 审批状态: '已通过', Offer编号: 'FP-20261010-000001', 岗位名称: '高级产品经理', 部门: '产品部',
      工作地点: '杭州', 入职日期: '2026-10-20', Offer文件地址: 'https://files.example.test/offer.pdf', 创建时间: new Date().toISOString(),
    });
    const database = { requireTableId: name => name };
    const result = await new OffersService(database, new MessagesService(database)).sendEmail('offer_mail', { recipient: 'offer-candidate@example.test', note: '<script>alert(1)</script>请于三个工作日内确认。', operator: '王HR' });
    assert.equal(result.status, '已发送');
    assert.equal(mails.length, 1);
    assert.equal(mails[0].contentType, 'html');
    assert.equal(mails[0].toEmails[0], 'offer-candidate@example.test');
    assert.match(mails[0].content, /FANGPIAN · OFFER/);
    assert.match(mails[0].content, /录用通知书/);
    assert.match(mails[0].content, /应聘岗位/);
    assert.match(mails[0].content, /高级产品经理/);
    assert.match(mails[0].content, /查看并确认Offer/);
    assert.doesNotMatch(mails[0].content, /查看Offer PDF/);
    assert.ok(!mails[0].content.includes('<script>'));
    const offerRow = memory.records.get('recruitment_offers')[0];
    const token = new URL(mails[0].content.match(/href="([^"]+offer_token=[^"]+)"/)[1]).searchParams.get('offer_token');
    assert.ok(!JSON.stringify(offerRow.fields).includes(token));
  } finally {
    tianjiWeixinMessage.sendMail = originalSendMail;
    if (originalPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = originalPublicUrl;
    memory.restore();
  }
});

test('confirmed offboarding records failures and retries interviewer-specific question-bank feedback', async () => {
  const memory = installMemory(), originalLlm = llm.chat;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const create = teable.createRecord;
    await create('recruitment_positions', { 职位ID: 'pos_wrong', 职位名称: '错误岗位', 发布状态: '招聘中' });
    await create('recruitment_positions', { 职位ID: 'pos_exit', 职位名称: '商务开发', 发布状态: '招聘中' });
    await create('recruitment_candidates', { 候选人ID: 'tal_exit', 姓名: '离职员工', 候选人状态: '已入职', 创建时间: '2026-01-01T00:00:00.000Z', 更新时间: '2026-01-01T00:00:00.000Z' });
    await create('recruitment_applications', { 应聘记录ID: 'app_exit', 候选人ID: 'tal_exit', 职位ID: 'pos_exit', 当前阶段: '已入职', 当前状态: '进行中', 创建时间: '2026-01-01T00:00:00.000Z', 更新时间: '2026-01-01T00:00:00.000Z' });
    await create('recruitment_onboarding_cases', { 入职单ID: 'onboarding_exit', 候选人ID: 'tal_exit', 应聘记录ID: 'app_exit', 职位ID: 'pos_exit', 岗位: '商务开发', 入职状态: '已入职', 实际到岗日期: '2026-01-05', 创建时间: '2026-01-01T00:00:00.000Z', 更新时间: '2026-01-05T00:00:00.000Z' });
    await create('recruitment_interviews', {
      面试ID: 'interview_exit', 候选人ID: 'tal_exit', 应聘记录ID: 'app_exit', 职位ID: 'pos_exit', 面试状态: '已完成', 开始时间: '2025-12-20T02:00:00.000Z',
      面试官用户IDJSON: JSON.stringify(['interviewer_a', 'interviewer_b']),
      面试官姓名JSON: JSON.stringify(['陈经理', '赵总监']),
      面试题快照JSON: JSON.stringify([
        { questionId: 'q_delivery', question: '请说明你如何管理业务目标和交付节奏。' },
        { questionId: 'q_pressure', question: '请说明高压阶段你如何安排工作。' },
      ]),
    });
    await create('recruitment_interview_feedback', { 评价ID: 'feedback_a', 面试ID: 'interview_exit', 面试官用户ID: 'interviewer_a', 面试官: '陈经理', 题目回答JSON: JSON.stringify({ q_delivery: { answer: '候选人说明了季度目标拆解方法' } }), 评价状态: '已提交' });
    await create('recruitment_interview_feedback', { 评价ID: 'feedback_b', 面试ID: 'interview_exit', 面试官用户ID: 'interviewer_b', 面试官: '赵总监', 题目回答JSON: JSON.stringify({ q_pressure: { answer: '候选人只描述了短期冲刺安排' } }), 评价状态: '已提交' });

    const lifecycle = new EmployeeLifecycleService({ requireTableId: (name) => name }, { syncDemandMetrics: async () => ({}) }, new MessagesService({ requireTableId: (name) => name }));
    const offboarding = await lifecycle.createOffboarding({ onboardingId: 'onboarding_exit', plannedDate: today, type: '主动离职', reasonCategory: '工作强度', reason: '长期频繁加班，工作节奏不可持续', returnToPool: false, operator: '王HR' });

    llm.chat = async () => { throw new Error('模拟大模型暂时不可用'); };
    const completed = await lifecycle.completeOffboarding(offboarding.offboardingId, { actualDate: today, handover: '已完成', assets: '已完成', accounts: '已完成', operator: '王HR' });
    assert.equal(completed.questionBankStatus, '处理中');
    let failedJob = jobs.get(completed.questionBankJobId);
    for (let attempt = 0; attempt < 100 && failedJob?.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      failedJob = jobs.get(completed.questionBankJobId);
    }
    assert.equal(failedJob?.status, 'failed');
    const offboardingRow = memory.records.get('recruitment_offboarding_cases')[0];
    assert.equal(offboardingRow.fields['题库反哺状态'], '失败');
    assert.match(offboardingRow.fields['题库反哺错误'], /模拟大模型暂时不可用/);

    const prompts = [];
    llm.chat = async (messages) => {
      const prompt = messages.map((message) => message.content).join('\n');
      prompts.push(prompt);
      if (prompt.includes('面试官：interviewer_a')) return JSON.stringify([{ question: '请说明你能长期接受的工作强度边界，以及如何提前预警不可持续的加班。', why: '复盘工作强度离职风险', observation: '边界、预警和沟通机制' }]);
      return JSON.stringify([{ question: '当业务冲刺持续超过预期时，你会如何与负责人协商目标和资源。', why: '复盘持续冲刺风险', observation: '目标取舍和资源协商证据' }]);
    };
    const retried = await lifecycle.retryQuestionBank(offboarding.offboardingId);
    let retryJob = jobs.get(retried.jobId);
    for (let attempt = 0; attempt < 100 && retryJob?.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      retryJob = jobs.get(retried.jobId);
    }
    assert.equal(retryJob?.status, 'done');
    assert.equal(offboardingRow.fields['题库反哺状态'], '已完成');
    assert.equal(offboardingRow.fields['题库反哺数量'], 3);
    const feedbackQuestions = memory.records.get('recruitment_question_bank').filter((row) => row.fields['题目来源'] === '离职原因反哺');
    assert.equal(feedbackQuestions.length, 3);
    assert.deepEqual(feedbackQuestions.map((row) => row.fields['题目状态']), ['草稿', '草稿', '草稿']);
    assert.deepEqual(feedbackQuestions.map((row) => row.fields['适用岗位']), ['商务开发', '商务开发', '商务开发']);
    assert.deepEqual(new Set(feedbackQuestions.map((row) => row.fields['适用面试官用户ID'])), new Set(['', 'interviewer_a', 'interviewer_b']));
    assert.ok(prompts.some((prompt) => prompt.includes('面试官：interviewer_a') && prompt.includes('业务目标和交付节奏')));
    assert.ok(prompts.some((prompt) => prompt.includes('面试官：interviewer_b') && prompt.includes('高压阶段')));
  } finally {
    llm.chat = originalLlm;
    memory.restore();
  }
});
