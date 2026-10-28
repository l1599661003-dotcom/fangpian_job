import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { invalidateReadTables } from '../dist/platform/read-cache.js';
import { llm } from '../dist/platform/llm.js';
import { storage } from '../dist/platform/storage.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { TalentsService } from '../dist/modules/talents/talents.service.js';
import { MessagesService } from '../dist/modules/messages/messages.service.js';
import { ResumesService } from '../dist/modules/resumes/resumes.service.js';
import { ResumeWordService } from '../dist/modules/resumes/resume-word.service.js';
import { DailyResumePushTaskRunner } from '../dist/tasks/daily-wecom-resume-push.task.js';

function installMemoryTeable() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const definitions = new Map(RECRUITMENT_TABLES.map((table) => [table.name, table]));
  const originals = {}, methods = ['countRecords', 'listFields', 'listRecords', 'listRecordsPage', 'listAllRecords', 'listByField', 'listByAnyField', 'getRecord', 'createRecord', 'updateRecord', 'deleteRecord'];
  for (const method of methods) originals[method] = teable[method];
  let sequence = 0;
  teable.countRecords = async tableId => (records.get(tableId) || []).length;
  teable.listFields = async (tableId) => (definitions.get(tableId)?.fields || []).map((field, index) => ({ id: `${tableId}_field_${index}`, ...field }));
  teable.listRecords = async (tableId, options = 1000) => { const take = typeof options === 'number' ? options : options?.take || 1000; const skip = typeof options === 'number' ? 0 : options?.skip || 0; return [...(records.get(tableId) || [])].slice(skip, skip + take); };
  teable.listRecordsPage = async (tableId, options = {}) => { const take = options?.take || 1000, skip = options?.skip || 0, rows = [...(records.get(tableId) || [])]; return { records: rows.slice(skip, skip + take), total: rows.length, totalIsExact: true }; };
  teable.listAllRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.listByField = async (tableId, field, value, take = 200) => (records.get(tableId) || []).filter((row) => String(row.fields[field] ?? '') === String(value ?? '')).slice(0, take);
  teable.listByAnyField = async (tableId, field, values, take = 1000) => { const wanted = new Set(values.map((value) => String(value ?? ''))); return (records.get(tableId) || []).filter((row) => wanted.has(String(row.fields[field] ?? ''))).slice(0, take); };
  teable.getRecord = async (tableId, recordId) => {
    const row = (records.get(tableId) || []).find((item) => item.id === recordId);
    if (!row) throw new Error(`record not found: ${tableId}/${recordId}`);
    return row;
  };
  teable.createRecord = async (tableId, fields) => { const row = { id: `${tableId}_record_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() }; records.get(tableId).push(row); invalidateReadTables(tableId); return row; };
  teable.updateRecord = async (tableId, recordId, fields) => { const row = records.get(tableId).find((item) => item.id === recordId); if (!row) throw new Error(`record not found: ${tableId}/${recordId}`); row.fields = { ...row.fields, ...fields }; invalidateReadTables(tableId); return row; };
  teable.deleteRecord = async (tableId, recordId) => { const rows = records.get(tableId), index = rows.findIndex((item) => item.id === recordId); if (index >= 0) rows.splice(index, 1); invalidateReadTables(tableId); };
  return { records, restore: () => Object.assign(teable, originals) };
}

test('resume ingestion preserves the supplied referral source on the resume record', async (context) => {
  const memory = installMemoryTeable();
  context.after(() => memory.restore());
  const talents = new TalentsService({ requireTableId: (name) => name }, {}, {});
  talents.enqueueAiAnalysis = () => {};
  const resumeRecord = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_source_referral', 来源类型: '简历上传' });

  await talents.ingestResume({
    id: resumeRecord.id, name: '来源校验候选人', phone: '13900139000', skillsCertificates: '数据分析', sourceType: '内推', sourceFileName: '来源校验候选人.pdf',
  });

  assert.equal(memory.records.get('resume_extraction_records')[0].fields['来源类型'], '内推');
  assert.equal(memory.records.get('recruitment_candidates')[0].fields['来源类型'], '内推');
});

test('resume imports can suppress automatic business-group pushes for single and batch ingestion', async (context) => {
  const memory = installMemoryTeable();
  context.after(() => memory.restore());
  const talents = new TalentsService({ requireTableId: (name) => name }, {}, {});
  talents.enqueueAiAnalysis = () => {};
  const resumeRecord = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_suppress_push', 来源类型: '简历上传' });

  await talents.ingestResume({
    id: resumeRecord.id, name: '不推送候选人', phone: '13900139001', skillsCertificates: '数据分析', sourceType: '简历上传',
    sourceFileName: '不推送候选人.pdf', suppressGroupPush: true,
  });

  assert.equal(memory.records.get('recruitment_candidates')[0].fields['不推送企微群'], '是');
  assert.equal(memory.records.get('resume_batch_imports').length, 0);
  const resumes = new ResumesService({ validate: () => undefined }, {}, talents, { requireTableId: (name) => name });
  const batchFiles = [{ originalname: '不推送候选人.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from('resume') }];
  const batch = await resumes.createBatch(batchFiles, { name: '不推送批次', operator: '王HR', suppressGroupPush: true });
  assert.equal(batch.record.fields['不推送企微群'], '是');
  assert.ok(memory.records.get('resume_batch_import_items').every((row) => row.fields['不推送企微群'] === '是'));
});

test('large resume upload chunks share one batch and parse persisted sources in the background', async (context) => {
  const memory = installMemoryTeable();
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; memory.restore(); });
  const database = { requireTableId: (name) => name };
  const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
  const texts = {
    '分片一.pdf': '姓名：分片一候选人\n电话：13900139111\n邮箱：batch-one@example.com\n求职意向：内容运营\n工作经历：负责短视频内容策划与数据复盘。',
    '分片二.pdf': '姓名：分片二候选人\n电话：13900139112\n邮箱：batch-two@example.com\n求职意向：内容运营\n工作经历：负责短视频数据复盘与增长策划。',
  };
  const makeFile = (name) => ({ originalname: name, mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(texts[name]) });
  const files = {
    validate: () => undefined,
    saveOriginal: async (file) => ({ cdnUrl: `https://cdn.example.test/resumes/${encodeURIComponent(file.originalname)}` }),
    extractAvatar: async () => '',
    extractText: async (file) => texts[file.originalname] || '',
  };
  global.fetch = async (url) => {
    const fileName = decodeURIComponent(String(url).split('/').pop() || '');
    const match = [makeFile('分片一.pdf'), makeFile('分片二.pdf')].find((file) => file.originalname === fileName);
    if (!match) return originalFetch(url);
    return new Response(match.buffer, { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  const service = new ResumesService(files, new ResumeWordService(), talents, database);
  const firstChunk = [makeFile('分片一.pdf')], secondChunk = [makeFile('分片二.pdf')];

  const batch = await service.createBatch(firstChunk, { name: '500份分片批次', operator: '王HR', operatorUserId: 'hr_large', expectedTotal: 2 });
  const appended = await service.createBatch(secondChunk, { batchId: batch.batchId, operator: '王HR', operatorUserId: 'hr_large', expectedTotal: 2 });
  await service.prepareBatchSources(batch.batchId, batch.items, firstChunk);
  await service.prepareBatchSources(appended.batchId, appended.items, secondChunk);
  const result = await service.processBatch(batch.batchId, [], () => {});

  assert.equal(appended.batchId, batch.batchId);
  assert.equal(batch.record.fields['文件总数'], 2);
  assert.deepEqual(result.items.map((item) => item.sequence), [1, 2]);
  assert.equal(result.status, '已完成');
  assert.equal(result.succeeded, 2);
  assert.ok(result.items.every((item) => item.sourceUrl.startsWith('https://cdn.example.test/resumes/')));
  assert.equal(memory.records.get('recruitment_candidates').length, 2);
});

test('resume ingestion starts AI analysis automatically and uploader-selected position takes priority', async (context) => {
  const memory = installMemoryTeable();
  context.after(() => memory.restore());
  const database = { requireTableId: (name) => name };
  const talents = new TalentsService(database, {}, {});
  let queued = 0;
  talents.enqueueAiAnalysis = () => { queued += 1; };
  const resumeRecord = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_confirm_analysis', 来源类型: '简历上传' });

  await talents.ingestResume({
    id: resumeRecord.id, name: '岗位确认候选人', phone: '13900139002', skillsCertificates: '财务分析',
    sourceType: '简历上传', sourceFileName: '岗位确认候选人.pdf',
  });
  assert.equal(queued, 1);
  const candidate = memory.records.get('recruitment_candidates')[0];
  assert.equal(candidate.fields['候选人状态'], 'AI分析中');

  await teable.createRecord('recruitment_positions', { 职位ID: 'position_uploader_selected', 职位名称: '财务BP', 部门: '财务', 任职要求: '具备财务分析经验' });
  await teable.createRecord('recruitment_positions', { 职位ID: 'position_ai_selected', 职位名称: '总账会计', 部门: '财务', 任职要求: '具备总账会计经验' });
  const resumes = new ResumesService({}, {}, talents, database);
  const result = await resumes.startAnalysis(
    { items: [{ candidateId: candidate.fields['候选人ID'], resumeId: resumeRecord.id, positionId: 'position_uploader_selected' }] },
    { operator: '王HR', operatorUserId: 'hr_1' },
  );
  assert.equal(result.total, 1);
  assert.equal(result.selectedCount, 1);
  assert.equal(memory.records.get('recruitment_applications')[0].fields['职位ID'], 'position_uploader_selected');
  assert.equal(memory.records.get('recruitment_stage_events').at(-1).fields['操作'], '上传人选择岗位');

  const analysis = {
    summary: '具备财务分析和预算经验。', strengths: ['财务分析'], risks: [], skills: ['预算管理'],
    recommendedRoles: ['总账会计'], scores: { business: 88, management: 76, logic: 84, communication: 80, overall: 84 },
    evidence: { business: '预算分析', management: '跨部门协作', logic: '结构化分析', communication: '业务沟通' }, confidence: '高',
  };
  const matches = await talents.saveMatches(candidate.fields['候选人ID'], 'assessment_confirm_analysis', {
    jobIntention: '', skillsCertificates: '财务分析', workExperience: '负责预算和财务分析', yearsOfExperience: '5年',
  }, analysis, 'position_uploader_selected');
  assert.equal(matches[0].positionId, 'position_uploader_selected');
  assert.equal(matches[0].positionName, '财务BP');
  assert.match(memory.records.get('recruitment_job_matches')[0].fields['推荐理由'], /上传人选择该岗位/);

  const lowScoreAnalysis = { ...analysis, recommendedRoles: ['总账会计'], scores: { ...analysis.scores, business: 20, management: 20, overall: 30 } };
  const lowScoreMatches = await talents.saveMatches(candidate.fields['候选人ID'], 'assessment_low_score_primary', {
    jobIntention: '总账会计', skillsCertificates: '总账核算', workExperience: '负责总账和凭证审核', yearsOfExperience: '1年',
  }, lowScoreAnalysis, 'position_uploader_selected');
  assert.equal(lowScoreMatches[0].positionId, 'position_uploader_selected');
  assert.equal(lowScoreMatches[0].positionName, '财务BP');
  const profile = await talents.detail(candidate.fields['候选人ID']);
  assert.equal(profile.matches[0].positionId, 'position_uploader_selected');
  assert.equal(profile.bestMatchRole, '财务BP');
});

test('AI backfill retries the latest zero-score resume even when an older analysis exists', async (context) => {
  const memory = installMemoryTeable();
  context.after(() => memory.restore());
  const talents = new TalentsService({ requireTableId: (name) => name }, {}, {});
  const analyzed = [];
  talents.analyzeSingleCandidate = async (candidateId, resumeId) => { analyzed.push(`${candidateId}:${resumeId}`) };

  await teable.createRecord('recruitment_candidates', {
    候选人ID: 'candidate_new_resume', 姓名: '新简历候选人', 最新简历记录ID: 'resume_new',
    候选人状态: 'AI分析中', 合并状态: '独立档案', 创建时间: '2026-10-16T01:00:00.000Z',
  });
  await teable.createRecord('recruitment_candidates', {
    候选人ID: 'candidate_done', 姓名: '已完成候选人', 最新简历记录ID: 'resume_done',
    候选人状态: '待业务群评审', 合并状态: '独立档案', 创建时间: '2026-10-15T01:00:00.000Z',
  });
  await teable.createRecord('recruitment_ai_assessments', { 候选人ID: 'candidate_new_resume', 简历记录ID: 'resume_old', 版本号: 1, 综合建议分: 70 });
  await teable.createRecord('recruitment_ai_assessments', { 候选人ID: 'candidate_done', 简历记录ID: 'resume_done', 版本号: 1, 综合建议分: 88 });
  await teable.createRecord('recruitment_applications', { 候选人ID: 'candidate_new_resume', 简历记录ID: 'resume_new', 当前状态: '进行中', AI匹配分: 0, 更新时间: '2026-10-16T01:00:00.000Z' });
  await teable.createRecord('recruitment_applications', { 候选人ID: 'candidate_done', 简历记录ID: 'resume_done', 当前状态: '进行中', AI匹配分: 88, 更新时间: '2026-10-15T01:00:00.000Z' });
  await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_new', 候选人ID: 'candidate_new_resume', 更新时间: '2026-10-16T01:00:00.000Z' });

  const result = await talents.batchAutoAnalyze(250);
  assert.equal(result.total, 1);
  assert.deepEqual(analyzed, ['candidate_new_resume:resume_new']);
});

test('automatic review and the daily batch push respect the suppress flag', async (context) => {
  const memory = installMemoryTeable();
  context.after(() => memory.restore());
  await teable.createRecord('recruitment_candidates', {
    候选人ID: 'candidate_suppress_push', 姓名: '不推送候选人', 不推送企微群: '是', 最新简历记录ID: 'resume_suppress_push', 候选人状态: '待业务群评审',
  });
  await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_suppress_push', 候选人ID: 'candidate_suppress_push', 应聘记录ID: 'application_suppress_push' });
  await teable.createRecord('recruitment_applications', { 应聘记录ID: 'application_suppress_push', 候选人ID: 'candidate_suppress_push', 简历记录ID: 'resume_suppress_push', 当前阶段: '待业务群评审', 当前状态: '进行中' });
  await teable.createRecord('recruitment_ai_assessments', { 分析记录ID: 'assessment_suppress_push', 候选人ID: 'candidate_suppress_push', 简历记录ID: 'resume_suppress_push', 版本号: 1, 综合建议分: 88 });
  const talents = new TalentsService({ requireTableId: (name) => name }, {}, {});
  talents.notifyFlow = async () => { throw new Error('suppressed candidate must not be pushed'); };

  assert.equal((await talents.pushAutomaticReview('candidate_suppress_push')).status, '已跳过');
  assert.equal(memory.records.get('recruitment_talent_review_shares').length, 0);

  await teable.createRecord('resume_batch_import_items', {
    候选人ID: 'candidate_suppress_push', 处理状态: '已完成', 完成时间: new Date().toISOString(), 不推送企微群: '是',
  });
  const logs = [];
  const runner = new DailyResumePushTaskRunner({ requireTableId: (name) => name }, { pushAutomaticReview: async () => { throw new Error('daily task must skip suppressed item'); } }, { notifyFlowEvent: async () => { throw new Error('daily summary must be skipped'); } });
  await runner.run((message) => logs.push(message));
  assert.ok(logs.some((message) => message.includes('跳过推送')));
});

test('manual match correction stores the reason and preserves AI history', async (context) => {
  const memory = installMemoryTeable();
  context.after(() => memory.restore());
  const talents = new TalentsService({ requireTableId: name => name }, {}, {});
  await teable.createRecord('recruitment_candidates', {
    候选人ID: 'candidate_manual_match', 姓名: '人工匹配候选人', 最新简历记录ID: 'resume_manual_match',
  });
  await teable.createRecord('recruitment_ai_assessments', {
    分析记录ID: 'assessment_manual_match', 候选人ID: 'candidate_manual_match', 版本号: 1, 综合建议分: 86,
  });
  await teable.createRecord('recruitment_positions', { 职位ID: 'pos_ai', 职位名称: '产品经理', 部门ID: 'dept_product' });
  await teable.createRecord('recruitment_positions', { 职位ID: 'pos_manual', 职位名称: '财务BP', 部门ID: 'dept_finance', JD版本: 3 });
  await teable.createRecord('recruitment_job_matches', {
    匹配记录ID: 'match_ai', 候选人ID: 'candidate_manual_match', 职位ID: 'pos_ai', 职位名称: '产品经理',
    分析记录ID: 'assessment_manual_match', 匹配总分: 86, 匹配状态: '当前', 推荐理由: 'AI推荐',
  });

  await assert.rejects(
    () => talents.correctMatch('candidate_manual_match', { positionId: 'pos_manual', reason: '', operator: '王HR' }),
    /必须填写原因/,
  );
  const result = await talents.correctMatch('candidate_manual_match', {
    positionId: 'pos_manual', reason: '候选人近三年集中在财务共享中心与全盘账务，原始简历更支持财务BP岗位', operator: '王HR', operatorUserId: 'hr_1',
  });
  assert.equal(result.positionName, '财务BP');
  assert.equal(result.previousPositionName, '产品经理');
  assert.equal(result.talent.matches[0].positionName, '财务BP');
  assert.equal(result.talent.matches[0].manualCorrection.reason, '候选人近三年集中在财务共享中心与全盘账务，原始简历更支持财务BP岗位');
  assert.equal(result.talent.matches[0].manualCorrection.operator, '王HR');
  const matchRows = memory.records.get('recruitment_job_matches');
  assert.equal(matchRows.find((row) => row.fields['匹配记录ID'] === 'match_ai').fields['匹配状态'], '历史');
  const manualRow = matchRows.find((row) => row.fields['匹配记录ID'] === result.matchId);
  assert.equal(manualRow.fields['修正前岗位'], '产品经理');
  assert.equal(manualRow.fields['人工修正原因'], result.reason);
  assert.equal(manualRow.fields['人工修正人'], '王HR');
  assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '人工修改适配岗位');
});

test('review claims are one-time per resume and notify the selected HR', async (context) => {
  const memory = installMemoryTeable();
  context.after(() => memory.restore());
  const notifications = [];
  let notificationStatus = '已发送';
  const talents = new TalentsService({ requireTableId: name => name }, {}, {
    notifyPositionHr: async input => { notifications.push(input); return { status: notificationStatus, reason: notificationStatus === '发送失败' ? '岗位未绑定招聘HR' : '', force: input.force, markdown: input.markdown }; },
  });
  const share = await teable.createRecord('recruitment_talent_review_shares', { 分享批次ID: 'share', 候选人ID: 'candidate', 应聘记录ID: 'application', 人才快照JSON: '{"name":"测试人才","gender":"男","avatarUrl":"avatar"}' });
  const candidate = await teable.createRecord('recruitment_candidates', { 候选人ID: 'candidate', 姓名: '测试人才' });
  const application = await teable.createRecord('recruitment_applications', { 应聘记录ID: 'application', 候选人ID: 'candidate', 当前阶段: '待业务群评审', 当前状态: '进行中' });
  await teable.createRecord('recruitment_positions', { 职位ID: 'other-position', 职位名称: '其他部门岗位', 部门ID: 'other', 部门: '其他部门', 发布状态: '招聘中' });
  talents.findReviewShare = async () => share;
  talents.findCandidateRow = async () => candidate;
  talents.createCommunicationLink = async () => 'https://example.test/communication?token=test';
  const viewer = { userId: 'reviewer', name: '评审人', departmentIds: [], departments: [] };
  const detail = await talents.publicReviewDetail('token', viewer);
  assert.equal(detail.positions[0].id, 'other-position');
  const input = { decision: '适合', positionId: 'other-position' };
  const first = await talents.submitPublicReview('token', input, viewer);
  assert.equal(first.notification.status, '已发送');
  assert.equal(application.fields['当前阶段'], '意向沟通');
  const manualPush = await talents.pushFlowWecom('candidate', { step: 'communication', operator: '当前用户', operatorUserId: 'operator_1' });
  assert.equal(manualPush.result.status, '已发送');
  assert.equal(manualPush.result.force, true);
  assert.match(manualPush.result.markdown, /待意向沟通/);
  await assert.rejects(() => talents.submitPublicReview('token', input, viewer), /已完成评审/);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].positionId, 'other-position');
  assert.equal(application.fields['当前阶段'], '意向沟通');
  assert.equal(memory.records.get('recruitment_tasks').length, 1);
  assert.equal(memory.records.get('recruitment_talent_review_responses').length, 1);
  const detailAfterReview = await talents.publicReviewDetail('token', viewer);
  assert.equal(detailAfterReview.reviewed, true);
  assert.equal(detailAfterReview.responseCount, 1);
  assert.equal(detailAfterReview.review.reviewer, '评审人');
});

test('manual review pushes send an existing link and never treat skipped or invalid receipts as delivered', async (context) => {
  const memory=installMemoryTeable(), originalFetch=global.fetch;
  const previousUrl=process.env.APP_PUBLIC_URL, previousKey=process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;
  context.after(()=>{
    memory.restore();global.fetch=originalFetch;
    if(previousUrl===undefined)delete process.env.APP_PUBLIC_URL;else process.env.APP_PUBLIC_URL=previousUrl;
    if(previousKey===undefined)delete process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;else process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY=previousKey;
  });
  process.env.APP_PUBLIC_URL='https://review.example.test';
  process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY='mock-review-key';
  const talents=new TalentsService({requireTableId:name=>name},{},{});
  talents.detail=async()=>({name:'测试候选人',analysis:{id:'analysis_1',scores:{overall:83}},applications:[{应聘记录ID:'application_1'}],matches:[],skills:[],tags:[]});
  const calls=[];
  let receipt={errcode:0,errmsg:'ok'};
  global.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return new Response(JSON.stringify(receipt),{status:200,headers:{'content-type':'application/json'}});};
  const pending=await talents.shareForWecomReview('candidate_1',{sendMessage:false,operator:'AI评分自动推送'});
  assert.equal(pending.sent,false);
  assert.equal(pending.needsNotification,true);
  const skipped=await talents.shareForWecomReview('candidate_1',{operator:'当前用户'});
  assert.equal(skipped.sent,false);
  assert.equal(calls.length,0);
  const sent=await talents.shareForWecomReview('candidate_1',{operator:'当前用户',forceSend:true});
  assert.equal(sent.sent,true);
  assert.equal(sent.shareId,pending.shareId);
  assert.equal(sent.reviewUrl,pending.reviewUrl);
  assert.ok(sent.sentAt);
  assert.equal(calls.length,1);
  assert.ok(calls[0].body.markdown.content.includes(pending.reviewUrl));
  const automatic=await talents.shareForWecomReview('candidate_1',{operator:'AI评分自动推送',forceSend:true});
  assert.equal(automatic.sent,false);
  assert.equal(calls.length,1);
  receipt={errcode:93000,errmsg:'invalid webhook'};
  await assert.rejects(()=>talents.shareForWecomReview('candidate_1',{forceSend:true}),/invalid webhook/);
  assert.equal(memory.records.get('recruitment_talent_review_shares')[0].fields['分享状态'],'发送失败');
  receipt={};
  await assert.rejects(()=>talents.shareForWecomReview('candidate_1',{forceSend:true}),/未收到企微成功回执/);
  receipt={errcode:0,errmsg:'ok'};
  const retried=await talents.shareForWecomReview('candidate_1',{forceSend:true});
  assert.equal(retried.sent,true);
  assert.equal(retried.reviewUrl,pending.reviewUrl);
  assert.equal(memory.records.get('recruitment_talent_review_shares').length,1);
  assert.equal(memory.records.get('recruitment_talent_review_shares')[0].fields['发送错误'],'');
  receipt={};
  await assert.rejects(()=>talents.shareForWecomReview('candidate_2',{forceSend:true}),/未收到企微成功回执/);
  const recovered=await talents.shareForWecomReview('candidate_2',{sendMessage:false,operator:'AI评分自动推送'});
  assert.equal(recovered.needsNotification,true);
  assert.equal(recovered.sent,false);
  receipt={errcode:0,errmsg:'ok'};
  assert.equal((await talents.shareForWecomReview('candidate_3',{forceSend:true})).sent,true);
});

test('manual review direct mode sends through WeCom private messages', async (context) => {
  const memory = installMemoryTeable(), originalFetch = global.fetch;
  const previousUrl = process.env.APP_PUBLIC_URL, previousKey = process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;
  context.after(() => {
    memory.restore();
    global.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = previousUrl;
    if (previousKey === undefined) delete process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY; else process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY = previousKey;
  });
  process.env.APP_PUBLIC_URL = 'https://review.example.test';
  delete process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;
  const talents = new TalentsService({ requireTableId: name => name }, {}, {});
  talents.detail = async () => ({ name: '私信候选人', analysis: { id: 'analysis_direct' }, applications: [{ 应聘记录ID: 'application_direct' }], matches: [], skills: [], tags: [] });
  const directCalls = [];
  let directResult = { status: '已发送', sent: 1, skipped: 0, failed: 0, reason: '', results: [{ userId: 'hr_1', name: '王HR', messageId: 'message_direct_1', status: '已发送' }] };
  talents.messages.notifyDirectUsers = async input => {
    directCalls.push(input);
    return directResult;
  };
  global.fetch = async () => { throw new Error('direct review must not call the group webhook'); };

  const pending = await talents.shareForWecomReview('candidate_direct', { sendMessage: false, operator: 'AI评分自动推送' });
  const sent = await talents.shareForWecomReview('candidate_direct', { operator: '当前用户', forceSend: true, sendMode: 'direct', directUserIds: ['hr_1'] });
  assert.equal(sent.sent, true);
  assert.equal(sent.shareId, pending.shareId);
  assert.equal(sent.reviewUrl, pending.reviewUrl);
  assert.equal(directCalls.length, 1);
  assert.equal(directCalls[0].category, '优质简历');
  assert.equal(directCalls[0].objectType, '人才评审');
  assert.equal(directCalls[0].objectId, pending.shareId);
  assert.deepEqual(directCalls[0].userIds, ['hr_1']);
  assert.equal(directCalls[0].force, true);
  assert.ok(directCalls[0].markdown.includes(pending.reviewUrl));
  const share = memory.records.get('recruitment_talent_review_shares')[0];
  assert.equal(share.fields['分享状态'], '评审中');
  assert.equal(share.fields['企微消息ID'], 'message_direct_1');

  directResult = { status: '发送失败', sent: 0, skipped: 0, failed: 1, reason: '接收人未配置企微成员ID', results: [] };
  await assert.rejects(() => talents.shareForWecomReview('candidate_direct', { operator: '当前用户', forceSend: true, sendMode: 'direct', directUserIds: ['hr_1'] }), /企微私信发送失败：接收人未配置企微成员ID/);
  assert.equal(memory.records.get('recruitment_talent_review_shares')[0].fields['分享状态'], '发送失败');
});

test('manual review both mode sends group and direct messages together', async (context) => {
  const memory = installMemoryTeable(), originalFetch = global.fetch;
  const previousUrl = process.env.APP_PUBLIC_URL, previousKey = process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;
  context.after(() => {
    memory.restore();
    global.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = previousUrl;
    if (previousKey === undefined) delete process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY; else process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY = previousKey;
  });
  process.env.APP_PUBLIC_URL = 'https://review.example.test';
  process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY = 'mock-review-key';
  const talents = new TalentsService({ requireTableId: name => name }, {}, {});
  talents.detail = async () => ({ name: '双通道候选人', analysis: { id: 'analysis_both' }, applications: [{ 应聘记录ID: 'application_both' }], matches: [], skills: [], tags: [] });
  const directCalls = [], groupCalls = [];
  talents.messages.notifyDirectUsers = async input => {
    directCalls.push(input);
    return { status: '已发送', sent: 1, skipped: 0, failed: 0, reason: '', results: [{ userId: 'hr_1', name: '王HR', messageId: 'message_direct_both', status: '已发送' }] };
  };
  global.fetch = async (url, options) => {
    groupCalls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', msgid: 'message_group_both' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const pending = await talents.shareForWecomReview('candidate_both', { sendMessage: false, operator: 'AI评分自动推送' });
  const sent = await talents.shareForWecomReview('candidate_both', { operator: '当前用户', forceSend: true, sendMode: 'both', directUserIds: ['hr_1'] });
  assert.equal(sent.sent, true);
  assert.equal(sent.partial, false);
  assert.equal(directCalls.length, 1);
  assert.equal(groupCalls.length, 1);
  assert.deepEqual(directCalls[0].userIds, ['hr_1']);
  assert.ok(directCalls[0].markdown.includes(pending.reviewUrl));
  assert.ok(groupCalls[0].body.markdown.content.includes(pending.reviewUrl));
  const share = memory.records.get('recruitment_talent_review_shares')[0];
  assert.equal(share.fields['分享状态'], '评审中');
  assert.equal(share.fields['企微消息ID'], 'message_direct_both,message_group_both');
  assert.equal(share.fields['发送错误'], '');

  talents.messages.notifyDirectUsers = async () => { throw new Error('私信服务异常'); };
  const partial = await talents.shareForWecomReview('candidate_both', { operator: '当前用户', forceSend: true, sendMode: 'both', directUserIds: ['hr_1'] });
  assert.equal(partial.sent, true);
  assert.equal(partial.partial, true);
  assert.ok(partial.message.includes('已推送企微群'));
  assert.equal(memory.records.get('recruitment_talent_review_shares')[0].fields['发送错误'], '企微私信发送失败：私信服务异常');
});

test('automatic review respects the 60-point boundary, records failure, retries and does not resend delivered links', async (context) => {
  const memory=installMemoryTeable(), originalFetch=global.fetch;
  const previousUrl=process.env.APP_PUBLIC_URL, previousKey=process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;
  context.after(()=>{memory.restore();global.fetch=originalFetch;if(previousUrl===undefined)delete process.env.APP_PUBLIC_URL;else process.env.APP_PUBLIC_URL=previousUrl;if(previousKey===undefined)delete process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;else process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY=previousKey;});
  process.env.APP_PUBLIC_URL='https://review.example.test';
  process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY='mock-review';
  const database={requireTableId:name=>name};
  const talents=new TalentsService(database,{},new MessagesService(database));
  let score=59,stage='待业务群评审',receipt={errcode:0,errmsg:'ok'},calls=0;
  talents.detail=async()=>({name:'测试候选人',analysis:{id:'analysis_1',scores:{overall:score}},applications:[{应聘记录ID:'application_1',当前阶段:stage,当前状态:'进行中'}],matches:[],skills:[],tags:[]});
  global.fetch=async(url)=>{calls++;assert.equal(new URL(url).searchParams.get('key'),'mock-review');return new Response(JSON.stringify(receipt),{status:200,headers:{'content-type':'application/json'}});};
  assert.equal((await talents.pushAutomaticReview('candidate')).status,'无需发送');
  assert.equal(calls,0);
  score=60;
  receipt={errcode:93000,errmsg:'temporary failure'};
  await assert.rejects(()=>talents.pushAutomaticReview('candidate'),/自动评审群推送失败/);
  assert.equal(memory.records.get('recruitment_talent_review_shares')[0].fields['分享状态'],'发送失败');
  receipt={errcode:0,errmsg:'ok'};
  assert.equal((await talents.pushAutomaticReview('candidate')).status,'已发送');
  assert.equal((await talents.pushAutomaticReview('candidate')).status,'已跳过');
  assert.equal(calls,2);
  await talents.shareForWecomReview('manual_candidate',{forceSend:true});
  assert.equal((await talents.pushAutomaticReview('manual_candidate')).status,'已跳过');
  assert.equal(calls,3);
  const concurrent=await Promise.all([talents.pushAutomaticReview('concurrent_candidate'),talents.pushAutomaticReview('concurrent_candidate')]);
  assert.equal(concurrent.filter(result=>result.status==='已发送').length,1);
  assert.equal(calls,4);
  stage='意向沟通';
  assert.equal((await talents.pushAutomaticReview('later_stage')).status,'无需发送');
  assert.equal(calls,4);
});

test('automatic referral review push labels the source and separates selected role from AI recommendations', async (context) => {
  const memory = installMemoryTeable();
  const previousPublicUrl = process.env.APP_PUBLIC_URL;
  context.after(() => {
    memory.restore();
    if (previousPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousPublicUrl;
  });
  process.env.APP_PUBLIC_URL = 'https://review.example.test';

  await teable.createRecord('recruitment_candidates', {
    候选人ID: 'candidate_referral_message', 姓名: '周敏', 来源类型: '内推', 最新简历记录ID: 'resume_referral_message', 候选人状态: '待业务群评审',
  });
  await teable.createRecord('resume_extraction_records', {
    解析记录ID: 'resume_referral_message', 候选人ID: 'candidate_referral_message', 应聘记录ID: 'application_referral_message', 来源类型: '内推',
    姓名: '周敏', 源文件名: '周敏.pdf', 求职意向: '人力资源',
  });
  await teable.createRecord('recruitment_applications', {
    应聘记录ID: 'application_referral_message', 候选人ID: 'candidate_referral_message', 简历记录ID: 'resume_referral_message',
    职位ID: 'position_referral', 来源类型: '内推', 当前阶段: '待业务群评审', 当前状态: '进行中', 创建时间: '2026-09-30T08:00:00.000Z',
  });
  await teable.createRecord('recruitment_positions', { 职位ID: 'position_referral', 职位名称: '财务专员', 部门: '财务', 发布状态: '招聘中' });
  await teable.createRecord('recruitment_positions', { 职位ID: 'position_ai', 职位名称: '运营经理', 部门: '运营中台', 发布状态: '招聘中' });
  await teable.createRecord('recruitment_ai_assessments', {
    分析记录ID: 'assessment_referral_message', 候选人ID: 'candidate_referral_message', 简历记录ID: 'resume_referral_message', 版本号: 1,
    人才摘要: '具备运营管理经验。', 优势JSON: '[]', 风险与待确认JSON: '[]', 技能JSON: '[]', 推荐岗位JSON: '["运营经理"]',
    业务能力分: 88, 管理能力分: 86, 逻辑能力分: 84, 沟通协作分: 82, 综合建议分: 86, 置信度: '高', 创建时间: '2026-09-30T08:01:00.000Z',
  });
  await teable.createRecord('recruitment_job_matches', {
    匹配记录ID: 'match_referral_message', 候选人ID: 'candidate_referral_message', 分析记录ID: 'assessment_referral_message',
    职位ID: 'position_ai', 职位名称: '运营经理', 匹配总分: 92, 匹配状态: '当前',
  });

  const talents = new TalentsService({ requireTableId: (name) => name }, {}, {});
  let pushedMarkdown = '';
  talents.notifyFlow = async (_category, _candidateId, group, markdown) => {
    assert.equal(group, 'business');
    pushedMarkdown = markdown;
    return { status: '已发送' };
  };

  const result = await talents.pushAutomaticReview('candidate_referral_message');
  assert.equal(result.status, '已发送');
  assert.match(pushedMarkdown, /【内推简历 · 待评审】周敏/);
  assert.match(pushedMarkdown, /简历来源.*员工内推/);
  assert.match(pushedMarkdown, /候选人选择岗位.*财务专员/);
  assert.match(pushedMarkdown, /AI推荐岗位.*运营经理（92分）/);
  assert.match(pushedMarkdown, /AI综合评分.*86 分/);

  const share = memory.records.get('recruitment_talent_review_shares')[0];
  const snapshot = JSON.parse(share.fields['人才快照JSON']);
  assert.equal(snapshot.sourceType, '内推');
  assert.equal(snapshot.selectedPositionName, '财务专员');
  assert.equal(share.fields['推荐职位名称'], '运营经理');
});

test('daily resume task uses service delivery results, deduplicates batch candidates and reports partial failure', async (context) => {
  const memory=installMemoryTeable();
  context.after(()=>memory.restore());
  const timestamp=new Date().toISOString();
  for(const candidateId of ['sent','skipped','failed','sent'])await teable.createRecord('resume_batch_import_items',{候选人ID:candidateId,处理状态:'已完成',完成时间:timestamp});
  const attempted=[],logs=[];
  const runner=new DailyResumePushTaskRunner({requireTableId:name=>name},{pushAutomaticReview:async(candidateId)=>{
    attempted.push(candidateId);
    if(candidateId==='failed')throw new Error('temporary delivery failure');
    return{status:candidateId==='sent'?'已发送':'已跳过'};
  }},{notifyFlowEvent:async(input)=>{assert.equal(input.group,'business');return{status:'已发送'};}});
  await assert.rejects(()=>runner.run(message=>logs.push(message)),/temporary delivery failure/);
  assert.deepEqual(attempted,['sent','skipped','failed']);
  assert.match(logs.at(-1),/实际发送 1 份.*跳过 1 份.*异常 1 项/);
});

test('talent directory returns active tags even when page relations exceed 1000 rows', async () => {
  const memory = installMemoryTeable();
  try {
    const database = { requireTableId: (name) => name };
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
    const candidates = memory.records.get('recruitment_candidates');
    const tags = memory.records.get('recruitment_candidate_tags');
    for (let candidateIndex = 0; candidateIndex < 49; candidateIndex += 1) {
      const candidateId = `talent_${candidateIndex}`;
      candidates.push({ id: `candidate_record_${candidateIndex}`, fields: { 候选人ID: candidateId, 姓名: `候选人${candidateIndex}`, 候选人状态: '负责人审查', 创建时间: `2026-09-01T00:${String(candidateIndex).padStart(2, '0')}:00.000Z` } });
      for (let tagIndex = 0; tagIndex < 21; tagIndex += 1) {
        tags.push({ id: `tag_${candidateIndex}_${tagIndex}`, fields: { 候选人ID: candidateId, 标签名称: `标签${tagIndex}`, 标签分类: '技能标签', 标签状态: '当前' } });
      }
    }
    candidates.push({ id: 'candidate_record_target', fields: { 候选人ID: 'talent_target', 姓名: '目标候选人', 候选人状态: '负责人审查', 创建时间: '2026-09-01T01:00:00.000Z' } });
    tags.push({ id: 'tag_target', fields: { 候选人ID: 'talent_target', 标签名称: '商业化策略', 标签分类: '技能标签', 标签状态: '当前' } });

    const detail = await talents.detail('talent_target');
    const directory = await talents.list({ page: '1', pageSize: '100' });
    const summary = directory.talents.find((item) => item.id === 'talent_target');

    assert.equal(detail.tags[0].name, '商业化策略');
    assert.equal(summary.tags[0].name, '商业化策略');
    assert.ok(summary.skills.includes('商业化策略'));
  } finally {
    memory.restore();
  }
});

test('deleting the last resume removes its version and hides the candidate', async () => {
  const memory = installMemoryTeable();
  const originalGetRecord = teable.getRecord;
  try {
    teable.getRecord = async (tableId, recordId) => {
      const row = memory.records.get(tableId).find((item) => item.id === recordId);
      if (!row) throw new Error(`record not found: ${tableId}/${recordId}`);
      return row;
    };
    const service = new ResumesService({}, new ResumeWordService(), {}, { requireTableId: (name) => name });
    const resume = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_delete_a', 候选人ID: 'talent_delete_a', 姓名: '删除测试', 源文件名: '删除测试.pdf' });
    await teable.createRecord('recruitment_resume_versions', { 简历版本ID: 'version_delete_a', 候选人ID: 'talent_delete_a', 简历记录ID: 'resume_delete_a', 版本号: 1, 是否当前版本: '是' });
    const candidate = await teable.createRecord('recruitment_candidates', { 候选人ID: 'talent_delete_a', 姓名: '删除测试', 最新简历记录ID: 'resume_delete_a', 当前简历文件名: '删除测试.pdf', 候选人状态: '负责人审查', 人才池: '公司人才库' });

    const result = await service.delete(resume.id);

    assert.equal(result.deleted, true);
    assert.equal(result.candidateStatus, '已从人才库隐藏');
    assert.equal(memory.records.get('resume_extraction_records').length, 0);
    assert.equal(memory.records.get('recruitment_resume_versions').length, 0);
    assert.equal(candidate.fields['候选人状态'], '已删除');
    assert.equal(candidate.fields['人才池'], '已删除');
    assert.equal(candidate.fields['最新简历记录ID'], '');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '删除简历');
  } finally {
    teable.getRecord = originalGetRecord;
    memory.restore();
  }
});

test('resume name validation rejects section headings and recovers the real person name', () => {
  const database = { requireTableId: (name) => name };
  const service = new ResumesService({}, new ResumeWordService(), {}, database);
  const empty = { name: '', age: null, phone: '', email: '', wechat: '', address: '', selfEvaluation: '', skillsCertificates: '', educationBackground: '', workExperience: '', jobIntention: '', yearsOfExperience: '', currentCompany: '', currentRole: '' };
  const mojibakeFileName = Buffer.from('【技术CTO（团队负责人）_烟台 15-20K】王金杰 10年以上.pdf', 'utf8').toString('latin1');
  const fromFileName = service.normalize({ ...empty, name: '个人优势' }, '个人优势\n负责技术团队管理与系统架构。', mojibakeFileName);
  assert.equal(fromFileName.name, '王金杰');
  const fromContext = service.normalize({ ...empty, name: '工作经历' }, '原玉娇\n高级测试经理\n女 | 36岁 | 15624902391\n工作经历\n负责质量效能体系建设。', '技术负责人-候选人.pdf');
  assert.equal(fromContext.name, '原玉娇');
  const traditionalName = service.normalize(
    { ...empty, name: '張静静.' },
    '張静静.\n女 | 22岁\n电话: 15629991523\n邮箱: 202333506@qq.com',
    '【内容运营（IP打造_账号代运营方向）_烟台 5-6K】張静静. 28年应届生.pdf',
  );
  assert.equal(traditionalName.name, '張静静');
  const unknown = service.normalize({ ...empty, name: '教育经历' }, '教育经历\n北京理工大学 硕士\n专业技能\n自动化测试', '匿名简历.pdf');
  assert.equal(unknown.name, '');
});

test('resume name cleanup rejects job labels and only restores explicit full names', () => {
  const database = { requireTableId: (name) => name };
  const service = new ResumesService({}, new ResumeWordService(), {}, database);
  const empty = { name: '', gender: '', age: null, phone: '', email: '', wechat: '', address: '', selfEvaluation: '', skillsCertificates: '', educationBackground: '', workExperience: '', jobIntention: '', yearsOfExperience: '', currentCompany: '', currentRole: '' };
  const cases = [
    ['简版.pdf', '', '简版', ''],
    ['更新版.pdf', '', '更新版', ''],
    ['全部行业.pdf', '', '全部行业', ''],
    ['行政.pdf', '', '行政', ''],
    ['简版_牟文静.pdf', '', '简版', '牟文静'],
    ['商务提报_闫嘉芯.pdf', 'Zg', '商务提报', '闫嘉芯'],
    ['中高层行政经理赵晨晨.PDF', 'Photoshop\\nPowerPoint', '高层行政', '赵晨晨'],
    ['【商单提报_烟台 4-8K】隋佳玉 1年.pdf', 'Zg', '单提报', '隋佳玉'],
    ['【签约经纪人_烟台 10-15K】代冠杰 3年.pdf', 'Zg', '纪人', '代冠杰'],
    ['孙悦涵+hrbp.pdf', '生日：2001.06.02\\n电话：19818796216\\n教育背景', '相关学习', '孙悦涵'],
    ['王永奥简历.pdf', 'Zg', '王永奥简', '王永奥'],
    ['石玉琦的简历.pdf', 'Zg', '石玉琦的', '石玉琦'],
    ['姜梦梦-编导.pdf', 'Zg', '姜梦梦女', '姜梦梦'],
    ['商务提报 经纪人续晴晴 25年应届生.pdf', 'Zg', '纪人续晴', '续晴晴'],
    ['大运推荐 张黎通(2)(1).pdf', '张黎通 小红书运营 / 社群运营实习生\n2002.12｜汉族｜山东\n15022747907｜1355171543@qq.com', '全职', '张黎通'],
    ['【项目执行PM_烟台 6-8K】矫林志 10年以上.pdf', 'Zg', '项目执行', '矫林志'],
    ['【签约经纪人_烟台 10-15K】张先生 3年.pdf', 'Zg', '纪人', '张先生'],
    ['孙-商务提报.pdf', '小孙\\n女 25岁 13153546291', '商务提报', ''],
    ['商务提报-王女士 6年.pdf', 'Zg', '商务提报', '王女士'],
  ];
  for (const [fileName, rawText, existingName, expected] of cases) {
    assert.equal(service.normalize({ ...empty, name: existingName }, rawText, fileName).name, expected, fileName);
  }
  assert.equal(service.normalize({ ...empty, name: '利用' }, '1、利用电话和网络与客户沟通。', '匿名简历.pdf').name, '');
  assert.equal(service.normalize({ ...empty, name: '应届' }, '26年应届生', '匿名简历.pdf').name, '');
  assert.equal(service.normalize({ ...empty, name: '和建议' }, '负责决策和建议。', '匿名简历.pdf').name, '');
});

test('history LLM recovery cannot write a name without text or filename evidence', async () => {
  const originalChat = llm.chat;
  try {
    llm.chat = async (messages) => JSON.stringify({
      name: '李佩纳',
      gender: messages[0].content.includes('性别：女') ? '女' : '',
    });
    const service = new ResumesService({}, new ResumeWordService(), {}, { requireTableId: (name) => name });
    const rejected = await service.recoverIdentityWithLlm('工作经历：负责财务管理和客户沟通。', '商务提报-匿名简历.pdf');
    assert.deepEqual(rejected, { name: '', gender: '' });

    const accepted = await service.recoverIdentityWithLlm('姓名：李佩纳\n性别：女\n工作经历：负责财务管理。', '匿名简历.pdf');
    assert.deepEqual(accepted, { name: '李佩纳', gender: '女' });
  } finally {
    llm.chat = originalChat;
  }
});

test('talent detail follows latest resume and linked application IDs when candidate IDs are stale', async () => {
  const memory = installMemoryTeable();
  const originals = { listByField: teable.listByField, listByAnyField: teable.listByAnyField, getRecord: teable.getRecord };
  const rowsFor = (tableId) => memory.records.get(tableId) || [];
  try {
    teable.listByField = async (tableId, field, value, take = 200) => rowsFor(tableId).filter((row) => String(row.fields[field] ?? '') === String(value ?? '')).slice(0, take);
    teable.listByAnyField = async (tableId, field, values, take = 1000) => {
      const wanted = new Set(values.map((value) => String(value ?? '')));
      return rowsFor(tableId).filter((row) => wanted.has(String(row.fields[field] ?? ''))).slice(0, take);
    };
    teable.getRecord = async (tableId, recordId) => {
      const row = rowsFor(tableId).find((item) => item.id === recordId);
      if (!row) throw new Error(`record not found: ${tableId}/${recordId}`);
      return row;
    };
    const database = { requireTableId: (name) => name };
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
    const resume = await teable.createRecord('resume_extraction_records', {
      解析记录ID: 'resume_business_id', 候选人ID: 'old_candidate_id', 应聘记录ID: 'application_business_id',
      姓名: '李佩纳', 源文件名: '李佩纳简历.pdf', 源文件地址: 'https://cdn.example.test/li.pdf',
      OCR原文: '姓名：李佩纳\\n工作经历：负责财务管理。', 教育背景: '山东财经大学 本科', 工作经历: '负责财务管理。',
      求职意向: '财务经理', 人工复核状态: '待复核',
    });
    await teable.createRecord('recruitment_applications', {
      应聘记录ID: 'application_business_id', 候选人ID: 'old_candidate_id', 简历记录ID: 'resume_business_id',
      当前阶段: '负责人审查', 当前状态: '进行中', 创建时间: '2026-09-01T00:00:00.000Z', 更新时间: '2026-09-01T00:00:00.000Z',
    });
    await teable.createRecord('recruitment_stage_events', {
      事件ID: 'event_business_id', 应聘记录ID: 'application_business_id', 候选人ID: 'old_candidate_id',
      新阶段: '负责人审查', 操作: '简历解析入库', 操作人: '系统', 发生时间: '2026-09-01T00:00:00.000Z',
    });
    const candidate = await teable.createRecord('recruitment_candidates', {
      候选人ID: 'tal_detail', 姓名: '李佩纳', 最新简历记录ID: resume.id, 候选人状态: '负责人审查',
      创建时间: '2026-09-01T00:00:00.000Z', 更新时间: '2026-09-01T00:00:00.000Z',
    });

    const detail = await talents.detail('tal_detail');
    assert.equal(detail.sourceFileName, '李佩纳简历.pdf');
    assert.equal(detail.educationBackground, '山东财经大学 本科');
    assert.equal(detail.applications.length, 1);
    assert.equal(detail.timeline.length, 1);
    assert.equal(detail.timeline[0].id, 'event_business_id');
    await teable.createRecord('resume_extraction_records', {
      候选人ID: 'tal_detail', 解析记录ID: 'old_empty_resume', 更新时间: '2020-01-01',
    });
    resume.fields['应聘记录ID'] = '';
    candidate.fields['最新简历记录ID'] = 'resume_business_id';
    teable.getRecord = async () => undefined;
    const recovered = await talents.detail('tal_detail');
    assert.equal(recovered.sourceFileName, '李佩纳简历.pdf');
    assert.equal(recovered.sourceFileUrl, 'https://cdn.example.test/li.pdf');
    assert.ok(recovered.rawText.length > 0);
    assert.equal(recovered.applications.length, 1);
    assert.equal(recovered.timeline[0].id, 'event_business_id');
  } finally {
    Object.assign(teable, originals);
    memory.restore();
  }
});

test('communication flow evidence includes unbound legacy records only within their application period', async () => {
  const memory = installMemoryTeable();
  try {
    const database = { requireTableId: name => name };
    const talents = new TalentsService(database, {}, {});
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'comm_candidate', 姓名: '沟通测试' });
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'comm_old', 候选人ID: 'comm_candidate', 创建时间: '2026-09-01T00:00:00.000Z', 更新时间: '2026-09-01T00:00:00.000Z' });
    await teable.createRecord('recruitment_communications', { 沟通记录ID: 'legacy_old', 候选人ID: 'comm_candidate', 发生时间: '2026-09-10T00:00:00.000Z', 沟通结果: '推进面试' });
    const single = await talents.detail('comm_candidate');
    assert.equal(single.flowEvidence.communications, 1);
    assert.equal(single.communications[0].id, 'legacy_old');
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'comm_new', 候选人ID: 'comm_candidate', 创建时间: '2026-09-20T00:00:00.000Z', 更新时间: '2026-09-20T00:00:00.000Z' });
    await teable.createRecord('recruitment_communications', { 沟通记录ID: 'bound_old', 候选人ID: 'comm_candidate', 应聘记录ID: 'comm_old', 发生时间: '2026-09-22T00:00:00.000Z' });
    assert.equal((await talents.detail('comm_candidate')).flowEvidence.communications, 0);
    await teable.createRecord('recruitment_communications', { 沟通记录ID: 'legacy_current', 候选人ID: 'comm_candidate', 发生时间: '2026-09-21T00:00:00.000Z', 沟通结果: '推进面试' });
    const current = await talents.detail('comm_candidate');
    assert.equal(current.flowEvidence.communications, 1);
    assert.deepEqual(current.communications.map(item => item.id), ['legacy_current']);
    assert.equal(memory.records.get('recruitment_communications').find(row => row.fields['沟通记录ID'] === 'legacy_current').fields['应聘记录ID'], undefined);
    const undated = await teable.createRecord('recruitment_communications', { 沟通记录ID: 'undated', 候选人ID: 'comm_candidate' });
    undated.createdTime = '';
    assert.equal((await talents.detail('comm_candidate')).flowEvidence.communications, 1);
  } finally { memory.restore(); }
});

test('a new application does not reuse claimed review shares or completed flow records from an older application', async () => {
  const memory = installMemoryTeable();
  const previousPublicUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'https://resume.example.test';
  try {
    const database = { requireTableId: (name) => name };
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
    await teable.createRecord('recruitment_candidates', {
      候选人ID: 'tal_reapply', 姓名: '顾承昀', 最新简历记录ID: 'resume_new', 候选人状态: 'AI分析中',
      创建时间: '2026-09-22T10:00:00.000Z', 更新时间: '2026-09-24T04:00:00.000Z',
    });
    await teable.createRecord('resume_extraction_records', {
      解析记录ID: 'resume_new', 候选人ID: 'tal_reapply', 应聘记录ID: 'app_new', 姓名: '顾承昀',
      源文件名: '顾承昀-AI产品负责人.pdf', OCR原文: '顾承昀\nAI产品负责人', 创建时间: '2026-09-24T04:00:00.000Z', 更新时间: '2026-09-24T04:00:00.000Z',
    });
    await teable.createRecord('recruitment_applications', {
      应聘记录ID: 'app_old', 候选人ID: 'tal_reapply', 简历记录ID: 'resume_old', 当前阶段: '约面', 当前状态: '进行中',
      创建时间: '2026-09-22T10:00:00.000Z', 更新时间: '2026-09-23T10:00:00.000Z',
    });
    await teable.createRecord('recruitment_applications', {
      应聘记录ID: 'app_new', 候选人ID: 'tal_reapply', 简历记录ID: 'resume_new', 当前阶段: 'AI分析中', 当前状态: '进行中',
      投递时间: '2026-09-24T04:00:00.000Z', 创建时间: '2026-09-24T04:00:00.000Z', 更新时间: '2026-09-24T04:01:00.000Z',
    });
    await teable.createRecord('recruitment_ai_assessments', {
      分析记录ID: 'ai_new', 候选人ID: 'tal_reapply', 简历记录ID: 'resume_new', 版本号: 2, 人才摘要: '具备成熟的AI产品战略和商业化能力。',
      优势JSON: '["AI产品战略"]', 风险与待确认JSON: '[]', 技能JSON: '["大模型产品"]', 推荐岗位JSON: '["AI产品负责人"]',
      业务能力分: 90, 管理能力分: 88, 逻辑能力分: 86, 沟通协作分: 84, 综合建议分: 87, 置信度: '高', 创建时间: '2026-09-24T04:01:00.000Z',
    });
    await teable.createRecord('recruitment_job_matches', {
      匹配记录ID: 'match_new', 候选人ID: 'tal_reapply', 分析记录ID: 'ai_new', 职位ID: 'pos_ai', 职位名称: 'AI产品负责人', 匹配总分: 87, 匹配状态: '当前',
    });
    await teable.createRecord('recruitment_talent_review_shares', {
      分享批次ID: 'share_old', 候选人ID: 'tal_reapply', 应聘记录ID: 'app_old', 分析记录ID: 'ai_old', 分享状态: '已认领',
      认领部门: '产品部', 反馈数: 1, 评审链接: 'https://resume.example.test/talent-review?token=old',
      创建时间: '2026-09-22T11:00:00.000Z', 更新时间: '2026-09-23T11:00:00.000Z', 过期时间: '2026-10-01T00:00:00.000Z',
    });
    await teable.createRecord('recruitment_communications', { 沟通记录ID: 'communication_old', 候选人ID: 'tal_reapply', 应聘记录ID: 'app_old', 沟通结果: '愿意约面', 发生时间: '2026-09-23T08:00:00.000Z' });
    await teable.createRecord('recruitment_interviews', { 面试ID: 'interview_old', 候选人ID: 'tal_reapply', 应聘记录ID: 'app_old', 面试状态: '已预约', 开始时间: '2026-09-25T08:00:00.000Z' });
    await teable.createRecord('recruitment_offers', { OfferID: 'offer_old', 候选人ID: 'tal_reapply', 应聘记录ID: 'app_old', Offer状态: '已发送', 更新时间: '2026-09-23T09:00:00.000Z' });

    const beforeShare = await talents.detail('tal_reapply');
    assert.equal(beforeShare.status, 'AI分析中');
    assert.equal(beforeShare.latestApplicationTime, '2026-09-24T04:00:00.000Z');
    assert.equal(beforeShare.applications[0]['应聘记录ID'], 'app_new');
    assert.equal(beforeShare.flowEvidence.communications, 0);
    assert.equal(beforeShare.flowEvidence.interviews, 0);
    assert.equal(beforeShare.flowEvidence.offer, null);
    assert.equal(beforeShare.wecomReviews.length, 0);

    const share = await talents.shareForWecomReview('tal_reapply', { applicationId: 'app_new', assessmentId: 'ai_new', sendMessage: false, operator: 'AI评分自动推送' });
    assert.equal(share.needsNotification, true);
    assert.match(share.markdown, /## 【待评审】顾承昀/);
    assert.match(share.markdown, /推荐岗位/);
    assert.match(share.markdown, /候选人速览/);
    const newShare = memory.records.get('recruitment_talent_review_shares').find((row) => row.fields['分享批次ID'] === share.shareId);
    assert.equal(newShare.fields['应聘记录ID'], 'app_new');
    assert.equal(newShare.fields['分析记录ID'], 'ai_new');
    assert.equal(newShare.fields['分享状态'], '评审中');

    const afterShare = await talents.detail('tal_reapply');
    assert.equal(afterShare.wecomReviews.length, 1);
    assert.equal(afterShare.wecomReviews[0].id, share.shareId);
    assert.equal(afterShare.wecomReviews[0].claimedDepartment, '');
  } finally {
    if (previousPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousPublicUrl;
    memory.restore();
  }
});

test('AI queue completes the exact pending task by candidate and resume instead of leaving it for the next restart', async () => {
  const memory = installMemoryTeable();
  try {
    const database = { requireTableId: (name) => name };
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
    talents.analyzeSingleCandidate = async () => undefined;
    talents.enqueueAiAnalysis('tal_queue', 'resume_queue', '简历入库自动触发', '入库自动分析');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const task = memory.records.get('recruitment_tasks')[0];
      if (task?.fields['待办状态'] === '已完成') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const task = memory.records.get('recruitment_tasks')[0];
    assert.equal(task.fields['待办状态'], '已完成');
    assert.ok(task.fields['完成时间']);
    assert.equal(talents.getAiQueueStatus().running, false);
    assert.equal(talents.getAiQueueStatus().pending, 0);
  } finally {
    memory.restore();
  }
});

test('recovered AI work does not resend business review after the application already entered review', async () => {
  const memory = installMemoryTeable();
  try {
    const database = { requireTableId: (name) => name };
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
    await teable.createRecord('recruitment_candidates', {
      候选人ID: 'tal_recovered', 姓名: '顾承昀', 最新简历记录ID: 'resume_recovered', 候选人状态: '待业务群评审',
    });
    await teable.createRecord('resume_extraction_records', {
      解析记录ID: 'resume_recovered', 候选人ID: 'tal_recovered', 姓名: '顾承昀', OCR原文: '顾承昀\nAI产品负责人',
    });
    await teable.createRecord('recruitment_applications', {
      应聘记录ID: 'app_recovered', 候选人ID: 'tal_recovered', 简历记录ID: 'resume_recovered',
      当前阶段: '待业务群评审', 当前状态: '进行中', 创建时间: '2026-09-24T04:00:00.000Z', 更新时间: '2026-09-24T04:01:00.000Z',
    });
    talents.analyzeRun = async () => ({
      analysis: {
        summary: '具备AI产品能力。', strengths: ['产品规划'], risks: [], skills: ['AI产品'], recommendedRoles: ['AI产品负责人'],
        scores: { business: 85, management: 82, logic: 84, communication: 80, overall: 83 },
        evidence: { business: '产品规划', management: '团队协作', logic: '结构化分析', communication: '跨团队沟通' }, confidence: '高',
      },
      status: '成功', model: 'test-model', error: '', inputTokens: 10, outputTokens: 10, durationMs: 1,
    });
    talents.saveAssessment = async () => 'ai_recovered';
    talents.saveTags = async () => undefined;
    talents.saveMatches = async () => [{ score: 83 }];
    let shareCount = 0;
    let notificationCount = 0;
    talents.shareForWecomReview = async () => { shareCount += 1; return { needsNotification: true, shareId: 'share_recovered', reviewUrl: 'https://resume.example.test/talent-review?token=test' }; };
    talents.notifyFlow = async () => { notificationCount += 1; return { status: '已发送' }; };

    await talents.analyzeSingleCandidate('tal_recovered', 'resume_recovered', '启动恢复', { type: '入库自动分析' });

    assert.equal(shareCount, 0);
    assert.equal(notificationCount, 0);
    assert.equal(memory.records.get('recruitment_applications')[0].fields['当前阶段'], '待业务群评审');
  } finally {
    memory.restore();
  }
});

test('contactless resumes use normalized name as the strong duplicate key', () => {
  const database = { requireTableId: (name) => name };
  const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
  const existing = [{ id: 'candidate_record_1', fields: { 候选人ID: 'tal_zhangjingjing', 姓名: '张静静', 电话: '13800138000', 邮箱: '', 微信: '', 合并状态: '独立档案', 教育经历: '浙江大学 本科', 工作经历: '负责内容运营' } }];
  const resume = {
    id: 'resume_contactless', name: '張静静.', age: null, phone: '', email: '', wechat: '', address: '', selfEvaluation: '',
    skillsCertificates: '', educationBackground: '浙江大学 本科', workExperience: '负责内容运营', jobIntention: '', yearsOfExperience: '',
    sourceFileName: '張静静.pdf', sourceFileUrl: '', rawText: '張静静\n工作经历',
  };
  assert.equal(talents.findStrongCandidate(existing, resume)?.fields['候选人ID'], 'tal_zhangjingjing');
  assert.equal(talents.findStrongCandidate(existing, { ...resume, name: '未识别姓名' }), undefined);
});

test('batch detail paginates beyond the first 1000 Teable records', async () => {
  const originalListRecords = teable.listRecords;
  const oldBatches = Array.from({ length: 1000 }, (_, index) => ({ id: `old_batch_${index}`, fields: { 批次ID: `old_batch_${index}`, 文件总数: 1 } }));
  const oldItems = Array.from({ length: 1000 }, (_, index) => ({ id: `old_item_${index}`, fields: { 批次ID: `old_batch_${index}`, 序号: 1, 处理状态: '已完成' } }));
  const targetBatch = { id: 'target_batch_record', fields: { 批次ID: 'batch_after_1000', 批次名称: '超过1000条后的批次', 文件总数: 1, 批次状态: '已完成' } };
  const targetItem = { id: 'target_item_record', fields: { 批次项ID: 'target_item', 批次ID: 'batch_after_1000', 序号: 1, 文件名: '新批次简历.pdf', 文件大小: 1024, 原文件地址: 'https://cdn.example.test/new.pdf', 处理状态: '已完成', 候选人ID: 'tal_new' } };
  try {
    teable.listRecords = async (tableId, options = 1000) => {
      const rows = tableId === 'resume_batch_imports' ? [...oldBatches, targetBatch] : tableId === 'resume_batch_import_items' ? [...oldItems, targetItem] : [];
      const opts = typeof options === 'number' ? { take: options, skip: 0 } : options;
      return rows.slice(Number(opts.skip || 0), Number(opts.skip || 0) + Number(opts.take || 1000));
    };
    const service = new ResumesService({}, new ResumeWordService(), {}, { requireTableId: (name) => name });
    const detail = await service.batchDetail('batch_after_1000');
    assert.equal(detail.total, 1);
    assert.equal(detail.succeeded, 1);
    assert.equal(detail.status, '已完成');
    assert.equal(detail.items[0].candidateId, 'tal_new');
  } finally {
    teable.listRecords = originalListRecords;
  }
});

test('resume file processing stores the source, extracts data and creates a complete talent profile', async () => {
  const memory = installMemoryTeable(), originalChat = llm.chat, originalUpload = storage.upload, originalFetch = global.fetch;
  const originalPublicUrl = process.env.APP_PUBLIC_URL, originalWebhookKey = process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;
  const rawText = `姓名：周敏\n年龄：29\n电话：13800138000\n邮箱：zhoumin@example.com\n现居住地：杭州\n求职意向：产品经理\n工作年限：6年\n专业技能：用户研究、数据分析、产品规划\n工作经历：负责SaaS产品规划，带领5人团队，推动转化率提升25%。\n教育经历：浙江大学 本科`;
  let activeRawText = rawText, failBatchFileOnce = true, analysisRevision = 1, wecomPayload = null;
  try {
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_pm', 需求ID: 'dem_pm', 职位名称: '产品经理', 部门ID: 'dept_product', 部门: '产品部', 岗位JD: '负责SaaS产品规划、用户研究与数据分析', 工作职责: '产品规划和跨团队协作', 任职要求: '5年以上经验', 标签JSON: '["产品规划","数据分析"]', 发布状态: '招聘中' });
    await teable.createRecord('recruitment_organization_units', { 组织单元ID: 'dept_product', 组织类型: '部门', 组织名称: '产品部', 组织状态: '启用' });
    llm.chat = async (messages) => {
      const prompt = messages[0].content;
      if (prompt.includes('简历结构化抽取器')) return JSON.stringify({ name: '周敏', age: 29, phone: '13800138000', email: 'zhoumin@example.com', wechat: '', address: '杭州', selfEvaluation: '', skillsCertificates: '用户研究、数据分析、产品规划', educationBackground: '浙江大学 本科', workExperience: '负责SaaS产品规划，带领5人团队，推动转化率提升25%。', jobIntention: '产品经理', yearsOfExperience: '6年', currentCompany: '', currentRole: '' });
      if (analysisRevision === 3) throw new Error('模拟平台LLM暂时不可用');
      if (analysisRevision === 2) return JSON.stringify({ summary: '复核后确认具备SaaS增长与产品团队管理能力。', strengths: ['推动转化率提升25%', '能把用户研究转化为增长方案'], risks: ['需要确认商业化定价经验'], skills: ['数据分析', '产品规划', '增长策略'], recommendedRoles: ['高级产品经理', '增长产品经理'], scores: { business: 91, management: 84, logic: 88, communication: 82, overall: 87 }, evidence: { business: '推动转化率提升25%', management: '带领5人团队', logic: '基于用户研究和数据分析制定方案', communication: '跨团队推动产品落地' }, confidence: '高' });
      return JSON.stringify({ summary: '具备6年SaaS产品经验和5人团队管理经历。', strengths: ['推动转化率提升25%'], risks: ['需要面试确认复杂项目边界'], skills: ['用户研究', '数据分析', '产品规划'], recommendedRoles: ['产品经理'], scores: { business: 86, management: 78, logic: 84, communication: 80, overall: 83 }, evidence: { business: '推动转化率提升25%', management: '带领5人团队', logic: '负责产品规划和数据分析', communication: '跨团队推动产品落地' }, confidence: '高' });
    };
    const files = { validate: () => {}, saveOriginal: async (file) => ({ cdnUrl: `https://cdn.example.test/resumes/${encodeURIComponent(file.originalname)}` }), extractAvatar: async (inputFile) => inputFile.originalname === '周敏-产品经理.pdf' ? 'https://cdn.example.test/avatars/zhoumin.jpg' : '', extractText: async (inputFile, _url, progress) => { progress('正在读取PDF文字'); if (inputFile.originalname.includes('批量卡住')) return new Promise(() => {}); if (inputFile.originalname.includes('批量失败') && failBatchFileOnce) { failBatchFileOnce = false; throw new Error('模拟OCR暂时失败'); } if (inputFile.originalname.includes('批量成功')) return `${rawText}\n批量标记：成功文件`; if (inputFile.originalname.includes('批量失败')) return `${rawText}\n批量标记：重试成功文件`; return activeRawText; } };
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://cdn.example.test/resumes/')) return new Response(Buffer.from(rawText), { status: 200, headers: { 'content-type': 'application/pdf' } });
      if (String(url).startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send')) {
        wecomPayload = JSON.parse(options.body);
        return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return originalFetch(url, options);
    };
    process.env.APP_PUBLIC_URL = 'https://resume.example.test';
    process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY = 'test-webhook-key';
    const database = { requireTableId: (name) => name };
    const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
    const wordUploads = [];
    storage.upload = async (filename, contentType, bytes) => { wordUploads.push({ filename, contentType, bytes }); return { cdnUrl: `https://cdn.example.test/${encodeURIComponent(filename)}`, objectKey: filename, uploadUrl: '', method: 'PUT', contentType, expiresIn: 600 }; };
    const service = new ResumesService(files, new ResumeWordService(), talents, database);
    const progress = [];
    const file = { originalname: '周敏-产品经理.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) };
    const result = await service.processFile(file, (message) => progress.push(message), '简历上传', { operator: '王HR', operatorUserId: 'hr_1' });

    assert.equal(result.name, '周敏');
    assert.equal(result.phone, '13800138000');
    assert.equal(result.sourceFileUrl, `https://cdn.example.test/resumes/${encodeURIComponent('周敏-产品经理.pdf')}`);
    assert.equal(result.avatarUrl, 'https://cdn.example.test/avatars/zhoumin.jpg');
    assert.equal(result.duplicate, false);
    assert.deepEqual(result.matches, []);
    assert.equal(result.analysis, null);
    assert.ok(progress.includes('正在保存原始简历文件'));
    assert.ok(progress.includes('正在写入人才档案数据库'));
    assert.ok(progress.includes('简历基础信息已入库'));
    assert.ok(!progress.includes('正在生成人才画像与岗位匹配'));

    assert.equal(memory.records.get('resume_extraction_records').length, 1);
    assert.equal(memory.records.get('recruitment_candidates').length, 1);
    assert.equal(memory.records.get('recruitment_applications').length, 1);
    assert.equal(memory.records.get('recruitment_ai_assessments').length, 0);
    assert.equal(memory.records.get('recruitment_candidate_tags').length, 0);
    assert.equal(memory.records.get('recruitment_job_matches').length, 0);
    assert.equal(memory.records.get('recruitment_stage_events').length, 1);
    const resumeRow = memory.records.get('resume_extraction_records')[0];
    assert.equal(resumeRow.fields['头像地址'], 'https://cdn.example.test/avatars/zhoumin.jpg');
    assert.equal(resumeRow.fields['头像提取状态'], '已提取');
    assert.equal(resumeRow.fields['解析状态'], '已完成');
    assert.equal(resumeRow.fields['候选人ID'], result.candidateId);
    assert.equal(resumeRow.fields['应聘记录ID'], result.applicationId);
    const candidate = memory.records.get('recruitment_candidates')[0];
    assert.equal(candidate.fields['出生年份'], 2026 - 29);
    assert.equal(candidate.fields['候选人状态'], 'AI分析中');
    assert.equal(candidate.fields['创建人用户ID'], 'hr_1');
    assert.equal(candidate.fields['创建人'], '王HR');
    assert.equal(memory.records.get('recruitment_resume_versions')[0].fields['创建人用户ID'], 'hr_1');
    assert.equal(memory.records.get('recruitment_resume_versions')[0].fields['创建人'], '王HR');
    assert.equal(result.resumeVersion.version, 1);
    assert.equal(result.resumeVersion.isCurrent, true);
    const initialVersions = await talents.analysisVersions(result.candidateId);
    assert.equal(initialVersions.total, 0);
    await assert.rejects(() => talents.rerunAnalysis(result.candidateId, { reason: '', operator: '王HR' }), /必须填写原因/);
    const firstRun = await talents.rerunAnalysis(result.candidateId, { reason: '简历基础信息复核完成，生成人才画像与岗位匹配', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(firstRun.version, 1);
    assert.equal(firstRun.runStatus, '成功');
    assert.equal(firstRun.comparison, null);
    const firstRunProfile = await talents.detail(result.candidateId);
    assert.equal(firstRunProfile.analysis.scores.overall, 83);
    assert.equal(firstRunProfile.matches[0].positionName, '产品经理');
    assert.ok(firstRunProfile.matches[0].score >= 60);
    analysisRevision = 2;
    const rerun = await talents.rerunAnalysis(result.candidateId, { reason: '负责人补充核对项目产出后重新评估', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(rerun.version, 2);
    assert.equal(rerun.runStatus, '成功');
    assert.equal(rerun.comparison.scoreDelta.overall, 4);
    assert.deepEqual(rerun.comparison.skills.added, ['增长策略']);
    assert.deepEqual(rerun.comparison.skills.removed, ['用户研究']);
    assert.deepEqual(rerun.comparison.recommendedRoles.added, ['高级产品经理', '增长产品经理']);
    assert.deepEqual(rerun.comparison.recommendedRoles.removed, ['产品经理']);
    const share = await talents.shareForWecomReview(result.candidateId, { expiresInDays: 7, operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(share.status, '评审中');
    assert.match(share.reviewUrl, /^https:\/\/resume\.example\.test\/talent-review\?token=/);
    assert.equal(wecomPayload.msgtype, 'markdown');
    assert.match(wecomPayload.markdown.content, /## 【待评审】周敏/);
    assert.match(wecomPayload.markdown.content, /\*\*推荐岗位\*\*/);
    assert.match(wecomPayload.markdown.content, /\*\*候选人速览\*\*/);
    assert.match(wecomPayload.markdown.content, /进入简历评审 →/);
    assert.doesNotMatch(wecomPayload.markdown.content, /13800138000/);
    const reviewToken = new URL(share.reviewUrl).searchParams.get('token');
    assert.equal(JSON.parse(memory.records.get('recruitment_talent_review_shares')[0].fields['人才快照JSON']).sourceFileUrl, result.sourceFileUrl);
    await teable.updateRecord('recruitment_candidates', candidate.id, { 工作经历: '清洗后的最新工作经历' });
    const publicReview = await talents.publicReviewDetail(reviewToken);
    const departmentScopedReview = await talents.publicReviewDetail(reviewToken, { userId: 'manager_1', name: '陈经理', departmentIds: ['dept_product'], departments: ['产品部'] });
    assert.ok(departmentScopedReview.positions.some((item) => item.id === 'pos_pm'), '按部门ID应返回岗位');
    const adminScopedReview = await talents.publicReviewDetail(reviewToken, { userId: 'admin_1', name: '李思奇', departmentIds: [], departments: ['总经办'], canViewAllPositions: true });
    assert.ok(adminScopedReview.positions.some((item) => item.id === 'pos_pm'), '全量数据范围的管理员应返回全部岗位');
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_legacy_pm', 职位名称: '历史产品经理', 部门: '产品部', 发布状态: '待发布' });
    const legacyScopedReview = await talents.publicReviewDetail(reviewToken, { userId: 'manager_1', name: '陈经理', departmentIds: ['dept_product'], departments: ['产品部'] });
    assert.ok(legacyScopedReview.positions.some((item) => item.id === 'pos_legacy_pm'), '历史岗位缺少部门ID时应按部门名称返回');
    assert.equal(publicReview.candidate.name, '周敏');
    assert.equal(publicReview.candidate.workExperience, '清洗后的最新工作经历');
    assert.equal(publicReview.candidate.sourceFileUrl, result.sourceFileUrl);
    assert.equal(JSON.parse(memory.records.get('recruitment_talent_review_shares')[0].fields['人才快照JSON']).workExperience, '清洗后的最新工作经历');
    assert.equal(publicReview.candidate.phone, '138****8000');
    assert.equal(publicReview.candidate.avatarUrl, 'https://cdn.example.test/avatars/zhoumin.jpg');
    assert.equal(publicReview.departments[0].name, '产品部');
    const response = await talents.submitPublicReview(reviewToken, { decision: '适合', reviewer: '陈经理', reviewerUserId: 'manager_1', positionId: 'pos_pm' });
    assert.equal(response.processing, '已认领并进入意向沟通');
    assert.equal(candidate.fields['候选人状态'], '意向沟通');
    assert.equal(memory.records.get('recruitment_applications')[0].fields['当前阶段'], '意向沟通');
    assert.equal(memory.records.get('recruitment_talent_review_responses')[0].fields['部门'], '产品部');
    assert.equal(memory.records.get('recruitment_tasks').at(-1).fields['待办类型'], '意向沟通');
    const analysisVersions = await talents.analysisVersions(result.candidateId);
    assert.equal(analysisVersions.total, 2);
    assert.equal(analysisVersions.versions[0].version, 2);
    assert.equal(analysisVersions.versions[0].parentId, analysisVersions.versions[1].id);
    assert.equal(analysisVersions.versions[0].reason, '负责人补充核对项目产出后重新评估');
    assert.equal(analysisVersions.versions[1].summary, '具备6年SaaS产品经验和5人团队管理经历。', '旧版本必须保留');
    const compared = await talents.compareAnalysisVersions(result.candidateId, '1', '2');
    assert.equal(compared.summaryChanged, true);
    assert.equal(compared.scoreDelta.management, 6);
    const rerunProfile = await talents.detail(result.candidateId);
    assert.equal(rerunProfile.analysis.version, 2);
    assert.equal(rerunProfile.analysis.summary, '复核后确认具备SaaS增长与产品团队管理能力。');
    assert.equal(rerunProfile.analysis.reviewStatus, '待人工确认');
    assert.ok(rerunProfile.matches.every((item) => memory.records.get('recruitment_job_matches').find((row) => row.fields['匹配记录ID'] === item.id)?.fields['分析记录ID'] === rerun.assessmentId));
    const historicalUserResearchTag = memory.records.get('recruitment_candidate_tags').find((row) => row.fields['标签名称'] === '用户研究');
    assert.equal(historicalUserResearchTag.fields['标签状态'], '历史');
    assert.ok(!rerunProfile.skills.includes('用户研究'));
    assert.equal(memory.records.get('recruitment_applications')[0].fields['AI评分版本'], 'talent-v2');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '重新运行AI人才分析');
    await assert.rejects(() => talents.correctAnalysis(result.candidateId, { reason: '', scores: { management: 90 }, operator: '王HR' }), /必须填写原因/);
    await assert.rejects(() => talents.correctAnalysis(result.candidateId, { reason: '错误分数测试', scores: { overall: 101 }, operator: '王HR' }), /0到100之间/);
    const correctedAnalysis = await talents.correctAnalysis(result.candidateId, { reason: '负责人已核对项目证明，确认直接管理8人并补充商业化策略能力', summary: '人工核对后确认具备SaaS增长、商业化与8人团队管理能力。', skills: ['数据分析', '产品规划', '商业化策略'], recommendedRoles: ['高级产品经理'], strengths: ['推动转化率提升25%', '直接管理8人产品团队'], risks: ['定价模型细节需在面试中复核'], scores: { business: 92, management: 90, logic: 88, communication: 84, overall: 89 }, operator: '王HR', operatorUserId: 'hr_1' });
    assert.deepEqual(correctedAnalysis.changedFields.sort(), ['recommendedRoles', 'risks', 'scores', 'skills', 'strengths', 'summary'].sort());
    const correctedProfile = await talents.detail(result.candidateId);
    assert.equal(correctedProfile.analysis.corrected, true);
    assert.equal(correctedProfile.analysis.scores.management, 90);
    assert.equal(correctedProfile.analysis.scores.overall, 89);
    assert.deepEqual(correctedProfile.analysis.skills, ['数据分析', '产品规划', '商业化策略']);
    assert.equal(correctedProfile.analysis.aiOriginal.scores.management, 84, 'AI原始分必须保留');
    assert.equal(correctedProfile.analysis.correction.operator, '王HR');
    assert.equal(correctedProfile.analysis.reviewStatus, '人工已修正');
    const correctedVersion = (await talents.analysisVersions(result.candidateId)).versions[0];
    assert.equal(correctedVersion.corrected, true);
    assert.equal(correctedVersion.scores.overall, 89);
    assert.equal(correctedVersion.aiOriginal.scores.overall, 87);
    const manualTag = memory.records.get('recruitment_candidate_tags').find((row) => row.fields['标签名称'] === '商业化策略');
    assert.equal(manualTag.fields['标签来源'], '人工修正');
    assert.equal(manualTag.fields['人工确认状态'], '人工已修正');
    const removedGrowthTag = memory.records.get('recruitment_candidate_tags').find((row) => row.fields['标签名称'] === '增长策略');
    assert.equal(removedGrowthTag.fields['标签状态'], '人工移除');
    assert.ok(!correctedProfile.skills.includes('增长策略'));
    assert.equal(memory.records.get('recruitment_applications')[0].fields['AI匹配分'], 89);
    assert.equal(memory.records.get('recruitment_applications')[0].fields['人工复核结果'], '人工已修正');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '人工修正AI标签和评分');
    const positionRow = memory.records.get('recruitment_positions')[0];
    positionRow.fields['岗位JD'] = '负责SaaS商业化增长、复杂产品规划、用户研究与数据分析';
    positionRow.fields['任职要求'] = '6年以上经验，具备商业化策略和团队管理能力';
    positionRow.fields['JD版本'] = 2;
    positionRow.fields['重匹配状态'] = '待重匹配';
    positionRow.fields['待重匹配人数'] = 1;
    positionRow.fields['最近JD变更原因'] = '新增商业化增长与团队管理要求';
    const rematchImpact = await talents.positionRematchImpact('pos_pm');
    assert.equal(rematchImpact.jdVersion, 2);
    assert.equal(rematchImpact.pendingCount, 1);
    assert.equal(rematchImpact.items[0].candidateId, result.candidateId);
    await assert.rejects(() => talents.rematchPosition('pos_pm', { reason: '', operator: '王HR' }), /必须填写原因/);
    const rematched = await talents.rematchPosition('pos_pm', { reason: '岗位JD新增商业化增长与团队管理要求', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(rematched.succeeded, 1);
    assert.equal(rematched.failed, 0);
    assert.equal(rematched.results[0].candidateId, result.candidateId);
    const positionMatches = memory.records.get('recruitment_job_matches').filter((row) => row.fields['候选人ID'] === result.candidateId && row.fields['职位ID'] === 'pos_pm');
    const currentPositionMatch = positionMatches.find((row) => row.fields['匹配状态'] === '当前');
    assert.equal(currentPositionMatch.fields['岗位JD版本'], 2);
    assert.equal(currentPositionMatch.fields['重匹配原因'], '岗位JD新增商业化增长与团队管理要求');
    assert.ok(currentPositionMatch.fields['父匹配记录ID']);
    assert.ok(positionMatches.some((row) => row.fields['匹配状态'] === '历史'));
    const rematchedProfile = await talents.detail(result.candidateId);
    assert.equal(rematchedProfile.matches.length, 1, '人才详情只展示当前岗位匹配');
    assert.equal(positionRow.fields['重匹配状态'], '已完成');
    assert.equal(positionRow.fields['待重匹配人数'], 0);
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '岗位JD变化后重新匹配');
    analysisRevision = 3;
    const degradedRun = await talents.rerunAnalysis(result.candidateId, { reason: '监控规则降级和失败原因', operator: '王HR' });
    assert.equal(degradedRun.runStatus, '规则降级');
    assert.match(degradedRun.error, /模拟平台LLM暂时不可用/);
    const monitoring = await talents.aiMonitoring(30);
    assert.equal(monitoring.summary.total, 3);
    assert.equal(monitoring.summary.success, 2);
    assert.equal(monitoring.summary.fallback, 1);
    assert.ok(monitoring.summary.inputTokens > 0);
    assert.equal(monitoring.summary.estimatedCost, 0);
    assert.equal(monitoring.pricingConfigured, false);
    assert.match(monitoring.costBasis, /未配置模型单价/);
    assert.ok(monitoring.alerts.some((item) => item.type === '规则降级'));
    assert.ok(monitoring.errors.some((item) => item.message.includes('模拟平台LLM暂时不可用')));
    assert.equal(monitoring.recent[0].status, '规则降级');
    assert.ok(memory.records.get('recruitment_ai_assessments').every((row) => Number.isFinite(Number(row.fields['输入估算Token']))));
    analysisRevision = 2;
    activeRawText = `${rawText}\n项目经历：2026年新增企业招聘产品升级项目。`;
    const secondFile = { originalname: '周敏-产品经理-更新版.pdf', mimetype: 'application/pdf', size: 3072, buffer: Buffer.from(activeRawText) };
    const secondResult = await service.processFile(secondFile, () => {});
    assert.equal(secondResult.candidateId, result.candidateId);
    assert.equal(secondResult.duplicate, true);
    assert.equal(secondResult.resumeVersion.version, 2);
    let versions = await service.listVersions(result.candidateId);
    assert.equal(versions.total, 2);
    assert.equal(versions.versions[0].version, 2);
    assert.equal(versions.versions[0].isCurrent, true);
    const duplicateUpload = await service.processFile(secondFile, () => {});
    assert.equal(duplicateUpload.resumeVersion.version, 2);
    versions = await service.listVersions(result.candidateId);
    assert.equal(versions.total, 2, 'same resume fingerprint must not create another attachment version');
    const switched = await service.activateVersion(versions.versions.find((item) => item.version === 1).id, { reason: '岗位负责人要求恢复查看首版简历', operator: '王HR' });
    assert.equal(switched.changed, true);
    assert.equal(switched.versions.find((item) => item.version === 1).isCurrent, true);
    assert.equal(candidate.fields['最新简历记录ID'], result.id);
    await assert.rejects(() => service.activateVersion(versions.versions[0].id, { reason: '', operator: '王HR' }), /切换简历版本的原因/);
    candidate.fields['年龄'] = 30;
    const conflicted = await talents.detail(result.candidateId);
    assert.equal(conflicted.birthYearConflict.hasConflict, true);
    assert.deepEqual(conflicted.birthYearConflict.years.sort(), [1996, 1997]);
    const corrected = await talents.updateBirthYear(result.candidateId, { birthYear: 1997, reason: '候选人确认出生年份，原年龄字段为旧年份数据', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(corrected.birthYear, 1997);
    assert.equal(corrected.age, 29);
    assert.equal(corrected.confirmStatus, '人工已确认');
    const correctedProfile2 = await talents.detail(result.candidateId);
    assert.equal(correctedProfile2.birthYearSource, '人工修正');
    assert.equal(correctedProfile2.birthYearReviewStatus, '人工已确认');
    assert.equal(correctedProfile2.birthYearConflict.hasConflict, false);
    assert.equal(candidate.fields['出生年份修正人'], '王HR');
    assert.match(candidate.fields['出生年份冲突JSON'], /1996/);
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '修正出生年份');
    await assert.rejects(() => talents.updateBirthYear(result.candidateId, { birthYear: 2015, reason: '错误年份', operator: '王HR' }), /出生年份应在/);
    const imageRow = await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_image_a', 候选人ID: result.candidateId, 姓名: '赵可', 年龄: 27, 电话: '13900139000', 邮箱: 'zhaoke@example.com', 地址: '杭州', 求职意向: '运营经理', 工作年限: '5年', 教育背景: '杭州师范大学 本科', 工作经历: '负责内容运营和团队协作。', 技能证书: '内容运营、数据分析', 自我评价: '执行力强。', 人工复核状态: '待复核', 源文件名: '赵可-运营经理.png', 源文件地址: 'https://cdn.example.test/resumes/zhaoke.png', OCR原文: '姓名：赵可\n年龄：27\n求职意向：运营经理\n工作经历：负责内容运营和团队协作。', 简历指纹: 'image-fingerprint' });
    const converted = await service.convertImageToWord(imageRow.id, { operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(converted.wordConversionStatus, '已完成');
    assert.equal(converted.wordConversionVersion, 1);
    assert.match(converted.editableWordFileName, /可编辑版-v1\.docx$/);
    assert.match(converted.editableWordUrl, /^https:\/\/cdn\.example\.test\//);
    assert.equal(wordUploads.length, 1);
    assert.equal(wordUploads[0].contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(wordUploads[0].bytes.subarray(0, 2).toString(), 'PK');
    assert.ok(wordUploads[0].bytes.length > 3000);
    const zipIndex = wordUploads[0].bytes.toString('latin1');
    assert.match(zipIndex, /\[Content_Types\]\.xml/);
    assert.match(zipIndex, /word\/document\.xml/);
    const cached = await service.convertImageToWord(imageRow.id, { operator: '王HR' });
    assert.equal(cached.wordConversionVersion, 1);
    assert.equal(wordUploads.length, 1);
    const regenerated = await service.convertImageToWord(imageRow.id, { force: true, operator: '王HR' });
    assert.equal(regenerated.wordConversionVersion, 2);
    assert.equal(wordUploads.length, 2);
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '图片简历转可编辑Word');
    await assert.rejects(() => service.convertImageToWord(memory.records.get('resume_extraction_records')[0].id, { operator: '王HR' }), /只有图片简历/);
    const reviewed = await service.review(imageRow.id, { fields: { name: '赵可', age: 28, phone: '13900139001', email: 'zhaoke.hr@example.com', jobIntention: '高级运营经理', workExperience: '负责内容运营、数据分析和5人团队协作。', skillsCertificates: '内容运营、数据分析、团队管理' }, reason: '已对照图片原件逐项核对并修正', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(reviewed.reviewStatus, '已修正');
    assert.ok(reviewed.changes.some((item) => item.field === '电话' && item.after === '13900139001'));
    assert.equal(reviewed.resume.phone, '13900139001');
    assert.equal(reviewed.resume.jobIntention, '高级运营经理');
    assert.match(reviewed.resume.correctionSummary, /逐项核对/);
    assert.equal(candidate.fields['电话'], '13900139001');
    assert.equal(candidate.fields['期望职位'], '高级运营经理');
    assert.match(candidate.fields['技能JSON'], /团队管理/);
    assert.equal(candidate.fields['出生年份'], 1997, 'manual birth year must not be replaced by reviewed resume age');
    assert.equal(memory.records.get('recruitment_audit_logs').at(-1).fields['操作类型'], '人工修正简历字段');
    const confirmed = await service.review(imageRow.id, { fields: { name: '赵可', age: 28, phone: '13900139001', email: 'zhaoke.hr@example.com', jobIntention: '高级运营经理', workExperience: '负责内容运营、数据分析和5人团队协作。', skillsCertificates: '内容运营、数据分析、团队管理' }, reason: '二次对照原件确认无误', operator: '李HR' });
    assert.equal(confirmed.reviewStatus, '已确认');
    assert.equal(confirmed.changes.length, 0);
    await assert.rejects(() => service.review(imageRow.id, { fields: { email: 'invalid-email' }, reason: '格式测试', operator: '王HR' }), /邮箱格式不正确/);
    const batchFiles = [
      { originalname: '批量成功-周敏.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) },
      { originalname: '批量失败后重试-周敏.pdf', mimetype: 'application/pdf', size: 2050, buffer: Buffer.from(rawText) },
    ];
    const batch = await service.createBatch(batchFiles, { name: '产品岗位批量导入', operator: '李批量', operatorUserId: 'hr_batch' });
    const firstBatchResult = await service.processBatch(batch.batchId, batchFiles, () => {});
    assert.equal(firstBatchResult.status, '部分失败');
    assert.equal(firstBatchResult.succeeded, 1);
    assert.equal(firstBatchResult.failed, 1);
    assert.equal(candidate.fields['创建人'], '王HR', '重复人才不能覆盖首次导入人');
    assert.ok(memory.records.get('recruitment_resume_versions').some((row) => row.fields['创建人'] === '李批量' && row.fields['创建人用户ID'] === 'hr_batch'));
    assert.ok(firstBatchResult.items.every((item) => item.sourceUrl.startsWith('https://cdn.example.test/resumes/')), '批量解析前必须先持久化每一份原始文件');
    assert.equal(firstBatchResult.items.find((item) => item.status === '失败').attempts, 1);
    assert.match(firstBatchResult.items.find((item) => item.status === '失败').error, /模拟OCR暂时失败/);
    const retriedBatch = await service.retryBatch(batch.batchId, () => {});
    assert.equal(retriedBatch.status, '已完成');
    assert.equal(retriedBatch.succeeded, 2);
    assert.equal(retriedBatch.failed, 0);
    assert.equal(retriedBatch.items.find((item) => item.fileName.includes('批量失败')).attempts, 2);
    const recentBatches = await service.listBatches(10);
    assert.equal(recentBatches.find((item) => item.id === batch.batchId)?.creator, '李批量');
    assert.ok(recentBatches.find((item) => item.id === batch.batchId)?.failed === 0);
    service.batchItemTimeoutMs = 35;
    const stalledBatchFiles = [
      { originalname: '批量卡住-周敏.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) },
      { originalname: '批量成功-超时后继续.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) },
    ];
    const stalledBatch = await service.createBatch(stalledBatchFiles, { name: '超时继续处理验证', operator: '王HR' });
    const batchProgress = [];
    const continuedBatch = await service.processBatch(stalledBatch.batchId, stalledBatchFiles, (message) => batchProgress.push(message));
    assert.equal(continuedBatch.status, '部分失败');
    assert.equal(continuedBatch.succeeded, 1);
    assert.equal(continuedBatch.failed, 1);
    assert.match(continuedBatch.items.find((item) => item.fileName.includes('批量卡住')).error, /单份简历处理超时/);
    assert.ok(batchProgress.some((message) => message.includes('批量成功-超时后继续')), '卡住文件不能阻断后续文件开始处理');
    const interruptedBatch = await service.createBatch([
      { originalname: '任务中断-正在处理.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) },
      { originalname: '任务中断-尚未开始.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) },
    ], { name: '旧批次中断恢复验证', operator: '王HR' });
    const interruptedRows = memory.records.get('resume_batch_import_items').filter((row) => row.fields['批次ID'] === interruptedBatch.batchId);
    interruptedRows[0].fields = { ...interruptedRows[0].fields, 处理状态: '处理中', 开始时间: '2000-01-01T00:00:00.000Z' };
    const interruptedBatchRow = memory.records.get('resume_batch_imports').find((row) => row.id === interruptedBatch.recordId);
    interruptedBatchRow.fields = { ...interruptedBatchRow.fields, 批次状态: '处理中', 处理中数: 1, 待处理数: 1 };
    const recoveredBatch = await service.batchDetail(interruptedBatch.batchId);
    assert.equal(recoveredBatch.status, '全部失败');
    assert.equal(recoveredBatch.pending, 0);
    assert.equal(recoveredBatch.running, 0);
    assert.match(recoveredBatch.items.find((item) => item.fileName.includes('正在处理')).error, /超时或后台任务已中断/);
    assert.match(recoveredBatch.items.find((item) => item.fileName.includes('尚未开始')).error, /请重新上传/);
    assert.equal(recoveredBatch.retryable, 0);
    assert.equal(recoveredBatch.needsReupload, 2);
    const resumableBatch = await service.createBatch([
      { originalname: '中断后可续传-周敏.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) },
      { originalname: '中断后可重试-周敏.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) },
    ], { name: '已持久化中断恢复验证', operator: '王HR' });
    const resumableRows = memory.records.get('resume_batch_import_items').filter((row) => row.fields['批次ID'] === resumableBatch.batchId);
    resumableRows[0].fields = { ...resumableRows[0].fields, 处理状态: '处理中', 开始时间: '2000-01-01T00:00:00.000Z', 原文件地址: 'https://cdn.example.test/resumes/resumable-1.pdf' };
    resumableRows[1].fields = { ...resumableRows[1].fields, 原文件地址: 'https://cdn.example.test/resumes/resumable-2.pdf' };
    const resumableBatchRow = memory.records.get('resume_batch_imports').find((row) => row.id === resumableBatch.recordId);
    resumableBatchRow.fields = { ...resumableBatchRow.fields, 批次状态: '处理中', 处理中数: 1, 待处理数: 1 };
    const recoveredResumableBatch = await service.batchDetail(resumableBatch.batchId);
    assert.match(recoveredResumableBatch.items.find((item) => item.fileName.includes('中断后可重试')).error, /原文件已保留.*重试失败文件/);
    assert.equal(recoveredResumableBatch.retryable, 2);
    assert.equal(recoveredResumableBatch.needsReupload, 0);
    const batchMojibakeName = Buffer.from('【内容运营】张静静.pdf', 'utf8').toString('latin1');
    const filenameBatch = await service.createBatch([{ originalname: batchMojibakeName, mimetype: 'application/pdf', size: 2048, buffer: Buffer.from(rawText) }], { name: '中文文件名编码验证', operator: '王HR' });
    assert.equal(memory.records.get('resume_batch_import_items').find((row) => row.fields['批次ID'] === filenameBatch.batchId).fields['文件名'], '【内容运营】张静静.pdf');
    const legacyFilenameRow = memory.records.get('resume_batch_import_items').find((row) => row.fields['批次ID'] === resumableBatch.batchId && String(row.fields['文件名']).includes('中断后可续传'));
    legacyFilenameRow.fields = { ...legacyFilenameRow.fields, 文件名: batchMojibakeName };
    const decodedLegacyDetail = await service.batchDetail(resumableBatch.batchId);
    assert.equal(decodedLegacyDetail.items.find((item) => item.id === legacyFilenameRow.fields['批次项ID']).fileName, '【内容运营】张静静.pdf');
    const csv = await service.exportBatch(batch.batchId);
    assert.equal(csv.subarray(0, 3).toString('hex'), 'efbbbf');
    assert.match(csv.toString('utf8'), /产品|批量成功-周敏\.pdf|批量失败后重试-周敏\.pdf|已完成/);
    await assert.rejects(() => service.createBatch([], { operator: '王HR' }), /请选择需要批量上传/);
    await assert.rejects(() => service.createBatch(Array.from({ length: 501 }, (_, index) => ({ originalname: `超限-${index}.pdf`, mimetype: 'application/pdf', size: 1, buffer: Buffer.from('x') })), { operator: '王HR' }), /最多上传500份/);
  } finally { llm.chat = originalChat; storage.upload = originalUpload; global.fetch = originalFetch; if (originalPublicUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = originalPublicUrl; if (originalWebhookKey === undefined) delete process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY; else process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY = originalWebhookKey; memory.restore(); }
});

test('AI role analysis includes the complete compact job catalog and ranks recommended finance roles first', async (context) => {
  const memory = installMemoryTeable();
  const originalChat = llm.chat;
  context.after(() => { llm.chat = originalChat; memory.restore(); });
  const database = { requireTableId: name => name };
  const talents = new TalentsService(database, { syncDemandMetrics: async () => ({}) }, new MessagesService(database));
  const longGenericDescription = '负责短视频内容运营、账号增长、选题策划和数据复盘；要求具备内容策划及视频剪辑经验。'.repeat(12);
  const positions = Array.from({ length: 88 }, (_, index) => ({
    职位ID: `position_generic_${index}`,
    职位名称: `通用岗位${String(index + 1).padStart(2, '0')}`,
    部门: '内容部',
    岗位JD: longGenericDescription,
    工作职责: longGenericDescription,
    任职要求: longGenericDescription,
  }));
  positions.push(
    { 职位ID: 'position_finance_director', 职位名称: '财务总监', 部门: '财务部', 岗位JD: '负责财务体系管理', 工作职责: '统筹财务团队和风险控制', 任职要求: '具备财务管理经验' },
    { 职位ID: 'position_finance_bp', 职位名称: '财务BP', 部门: '财务部', 岗位JD: '负责预算、成本分析及业务财务支持', 工作职责: '推动业务与财务协同', 任职要求: '具备财务分析和预算经验' },
    { 职位ID: 'position_accountant', 职位名称: '总账会计', 部门: '财务部', 岗位JD: '负责账务处理与财务报表', 工作职责: '负责月结、年结及账务核算', 任职要求: '具备总账会计经验' },
  );
  for (const position of positions) await teable.createRecord('recruitment_positions', position);

  let prompt = '';
  llm.chat = async messages => {
    prompt = messages[0].content;
    return JSON.stringify({
      summary: '具备财务核算和预算分析经验，财务BP适配度较高。',
      strengths: ['财务核算', '预算分析'], risks: [], skills: ['财务分析', '预算管理'],
      recommendedRoles: ['财务BP', '总账会计'],
      scores: { business: 88, management: 75, logic: 86, communication: 80, overall: 85 },
      evidence: { business: '负责财务核算和预算分析', management: '', logic: '', communication: '' }, confidence: '高',
    });
  };

  const resume = {
    id: 'resume_finance_test', name: '财务候选人', age: null, phone: '', email: '', wechat: '', address: '',
    selfEvaluation: '', skillsCertificates: '财务分析、预算管理', educationBackground: '会计专业',
    workExperience: '负责月度关账、费用核算、年度预算和业务财务分析。', jobIntention: '', yearsOfExperience: '5年',
    sourceFileName: '财务候选人.pdf', sourceFileUrl: '', rawText: '负责月度关账、费用核算、年度预算和业务财务分析。',
  };
  const run = await talents.analyzeRun(resume);
  const catalog = prompt.split('真实岗位目录（每个岗位均列出部门和名称）：\n')[1]?.split('\n\n姓名：')[0];
  assert.ok(catalog, '提示词应包含岗位目录');
  assert.equal(catalog.trim().split('\n').length, positions.length, '目录不能按字符截断末尾岗位');
  assert.ok(catalog.includes('财务部 / 财务BP'));
  assert.ok(catalog.includes('财务部 / 总账会计'));
  assert.ok(catalog.length < 12000, '精简后的目录应控制提示词体积');
  assert.ok(run.analysis.recommendedRoles.includes('财务BP'));

  const matches = await talents.saveMatches('candidate_finance_test', 'assessment_finance_test', resume, run.analysis);
  assert.equal(matches[0].positionName, '财务BP', 'AI推荐的财务岗位应进入匹配结果首位');
});
