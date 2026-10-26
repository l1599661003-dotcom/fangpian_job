import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyHiringActivity } from '../dist/modules/recruitment/daily-hiring-activity.js';
import { RecruitmentService } from '../dist/modules/recruitment/recruitment.service.js';
import { teable } from '../dist/platform/teable.js';

const row = (id, fields) => ({ id, fields });
const date = '2026-10-14';
const from = Date.parse(`${date}T00:00:00+08:00`);
const to = from + 24 * 60 * 60 * 1000;

test('daily hiring activity uses Beijing day boundaries and attributes resume uploads', () => {
  const result = buildDailyHiringActivity({
    date, from, to, allAccess: true, allowedCandidateIds: new Set(), allowedPositionIds: new Set(),
    candidates: [row('candidate_a', { 候选人ID: 'candidate_a', 姓名: '候选人甲', 创建人: '历史导入人' })],
    users: [row('user_zhang', { 用户ID: 'user_zhang', 姓名: '张晓霞', 部门IDJSON: '["dept_child"]', 用户状态: '启用' })],
    organizations: [
      row('business_unit', { 组织单元ID: 'business_unit', 组织类型: '事业部', 组织名称: '方片' }),
      row('dept_parent', { 组织单元ID: 'dept_parent', 组织类型: '部门', 组织名称: '商务', 上级组织单元ID: 'business_unit' }),
      row('dept_child', { 组织单元ID: 'dept_child', 组织类型: '部门', 组织名称: '商务一组', 上级组织单元ID: 'dept_parent' }),
    ],
    resumeVersions: [
      row('version_today', { 候选人ID: 'candidate_a', 简历记录ID: 'resume_a', 文件名: '候选人甲.pdf', 文件地址: 'https://cdn.example.test/candidate-a.pdf', 创建人用户ID: 'user_zhang', 创建人: '张晓霞', 创建时间: '2026-10-13T16:00:00.000Z', 解析状态: '已完成' }),
      row('version_duplicate', { 候选人ID: 'candidate_a', 简历记录ID: 'resume_a', 文件名: '重复.pdf', 创建人: '李思奇', 创建时间: '2026-10-14T10:00:00.000Z', 解析状态: '已完成' }),
      row('version_before', { 候选人ID: 'candidate_a', 简历记录ID: 'resume_before', 创建人: '张晓霞', 创建时间: '2026-10-13T15:59:59.999Z', 解析状态: '已完成' }),
      row('version_after', { 候选人ID: 'candidate_a', 简历记录ID: 'resume_after', 创建人: '张晓霞', 创建时间: '2026-10-14T16:00:00.000Z', 解析状态: '已完成' }),
    ],
    interviews: [], offers: [], onboardings: [],
  });

  assert.deepEqual(result.summary, { resumes: 1, interviews: 0, offers: 0, arrived: 0 });
  assert.equal(result.resumeUploads[0].candidateName, '候选人甲');
  assert.equal(result.resumeUploads[0].sourceUrl, 'https://cdn.example.test/candidate-a.pdf');
  assert.equal(result.resumeUploads[0].uploader, '张晓霞');
  assert.equal(result.resumeUploads[0].department, '商务');
  assert.deepEqual(result.uploaders, [{ name: '张晓霞', count: 1, department: '商务' }]);
  assert.deepEqual(result.departmentUploads, [{ department: '商务', count: 1, uploaders: [{ name: '张晓霞', count: 1 }] }]);
});

test('daily hiring activity counts interview sessions, sent offers, and actual arrivals by event date', () => {
  const result = buildDailyHiringActivity({
    date, from, to, allAccess: true, allowedCandidateIds: new Set(), allowedPositionIds: new Set(),
    candidates: [], resumeVersions: [],
    interviews: [
      row('interview_one', { 面试ID: 'interview_one', 候选人ID: 'candidate_a', 开始时间: '2026-10-13T16:00:00.000Z', 面试状态: '已确认' }),
      row('interview_two', { 面试ID: 'interview_two', 候选人ID: 'candidate_a', 开始时间: '2026-10-14T08:00:00.000Z', 面试状态: '已确认' }),
      row('interview_cancelled', { 面试ID: 'interview_cancelled', 候选人ID: 'candidate_b', 开始时间: '2026-10-14T09:00:00.000Z', 面试状态: '已取消' }),
    ],
    offers: [
      row('offer_sent', { OfferID: 'offer_sent', 候选人ID: 'candidate_a', 发送时间: '2026-10-14T03:00:00.000Z', 发送状态: '已发送' }),
      row('offer_replied', { OfferID: 'offer_replied', 候选人ID: 'candidate_b', 发送时间: '2026-10-14T04:00:00.000Z', 发送状态: '候选人已答复' }),
      row('offer_draft', { OfferID: 'offer_draft', 候选人ID: 'candidate_c', 发送时间: '2026-10-14T04:00:00.000Z', 发送状态: '待人工发送' }),
    ],
    onboardings: [
      row('onboarding_one', { 候选人ID: 'candidate_a', 实际到岗日期: date }),
      row('onboarding_duplicate', { 候选人ID: 'candidate_a', 实际到岗日期: date }),
      row('onboarding_other_day', { 候选人ID: 'candidate_b', 实际到岗日期: '2026-10-13' }),
    ],
  });

  assert.deepEqual(result.summary, { resumes: 0, interviews: 2, offers: 2, arrived: 1 });
});

test('daily hiring activity groups referral resumes without exposing referrers', () => {
  const result = buildDailyHiringActivity({
    date, from, to, allAccess: true, allowedCandidateIds: new Set(), allowedPositionIds: new Set(),
    candidates: [
      row('candidate_upload', { 候选人ID: 'candidate_upload', 姓名: '上传候选人' }),
      row('candidate_referral', { 候选人ID: 'candidate_referral', 姓名: '内推候选人' }),
    ],
    users: [row('user_referrer', { 用户ID: 'user_referrer', 姓名: '顾承均', 部门IDJSON: '["dept_business"]', 用户状态: '启用' })],
    organizations: [row('dept_business', { 组织单元ID: 'dept_business', 组织类型: '部门', 组织名称: '商务' })],
    resumeVersions: [
      row('version_upload', { 候选人ID: 'candidate_upload', 简历记录ID: 'resume_upload', 文件名: '上传候选人.pdf', 创建人用户ID: 'user_upload', 创建人: '张晓霞', 创建时间: '2026-10-14T01:00:00.000Z', 解析状态: '已完成', 来源类型: '简历上传' }),
      row('version_referral', { 候选人ID: 'candidate_referral', 简历记录ID: 'resume_referral', 文件名: '内推候选人.pdf', 创建人用户ID: 'user_referrer', 创建人: '顾承均', 创建时间: '2026-10-14T02:00:00.000Z', 解析状态: '已完成', 来源类型: '内推' }),
    ],
    interviews: [], offers: [], onboardings: [],
  });

  assert.equal(result.summary.resumes, 2);
  assert.deepEqual(result.resumeUploads.find(row => row.source === '内推'), {
    candidateId: 'candidate_referral',
    candidateName: '内推候选人',
    fileName: '内推候选人.pdf',
    sourceUrl: '',
    uploader: '内推',
    uploaderUserId: '',
    department: '商务',
    uploadedAt: '2026-10-14T02:00:00.000Z',
    source: '内推',
  });
  assert.ok(result.uploaders.some(row => row.name === '内推' && row.count === 1));
  assert.ok(!result.uploaders.some(row => row.name === '顾承均'));
  assert.ok(!JSON.stringify(result).includes('顾承均'));
});

test('department-scoped daily activity excludes other departments and unassigned resumes', () => {
  const result = buildDailyHiringActivity({
    date, from, to, allAccess: false,
    allowedCandidateIds: new Set(['candidate_a']), allowedPositionIds: new Set(['position_a']),
    candidates: [row('candidate_a', { 候选人ID: 'candidate_a', 姓名: '部门内候选人' })],
    resumeVersions: [
      row('resume_a', { 候选人ID: 'candidate_a', 简历记录ID: 'resume_a', 文件名: 'a.pdf', 创建人: '部门同事', 创建时间: '2026-10-14T00:00:00.000Z', 解析状态: '已完成' }),
      row('resume_b', { 候选人ID: 'candidate_b', 简历记录ID: 'resume_b', 文件名: 'b.pdf', 创建人: '其他部门', 创建时间: '2026-10-14T00:00:00.000Z', 解析状态: '已完成' }),
    ],
    interviews: [
      row('interview_a', { 面试ID: 'interview_a', 候选人ID: 'candidate_a', 职位ID: 'position_a', 开始时间: '2026-10-14T01:00:00.000Z', 面试状态: '已确认' }),
      row('interview_b', { 面试ID: 'interview_b', 候选人ID: 'candidate_b', 职位ID: 'position_b', 开始时间: '2026-10-14T01:00:00.000Z', 面试状态: '已确认' }),
    ],
    offers: [], onboardings: [],
  });

  assert.deepEqual(result.summary, { resumes: 1, interviews: 1, offers: 0, arrived: 0 });
  assert.equal(result.resumeUploads[0].uploader, '部门同事');
});

test('monthly hiring endpoint returns today activity and queries only the company-day resume range', async context => {
  const originalListAllRecords = teable.listAllRecords;
  context.after(() => { teable.listAllRecords = originalListAllRecords; });
  const calls = [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((value, part) => part.type === 'literal' ? value : { ...value, [part.type]: part.value }, {})
  const todayKey = `${today.year}-${today.month}-${today.day}`;
  const records = new Map([
    ['recruitment_monthly_demands', []], ['recruitment_positions', []], ['recruitment_applications', []],
    ['recruitment_interviews', [{ id: 'interview_row', fields: { 面试ID: 'interview_today', 候选人ID: 'candidate_today', 开始时间: `${todayKey}T01:00:00+08:00`, 面试状态: '已确认' } }]],
    ['recruitment_offers', [{ id: 'offer_row', fields: { OfferID: 'offer_today', 候选人ID: 'candidate_today', 发送时间: `${todayKey}T02:00:00+08:00`, 发送状态: '已发送' } }]],
    ['recruitment_candidates', [{ id: 'candidate_row', fields: { 候选人ID: 'candidate_today', 候选人状态: '在库', 姓名: '今日候选人', 创建人: '张晓霞' } }]],
    ['resume_extraction_records', []],
    ['recruitment_resume_versions', [{ id: 'version_row', fields: { 候选人ID: 'candidate_today', 简历记录ID: 'resume_today', 文件名: '今日候选人.pdf', 来源类型: '简历上传', 解析状态: '已完成', 创建人: '张晓霞', 创建时间: `${todayKey}T03:00:00+08:00` } }]],
    ['recruitment_onboarding_cases', [{ id: 'onboarding_row', fields: { 候选人ID: 'candidate_today', 实际到岗日期: todayKey } }]],
  ]);
  teable.listAllRecords = async (tableId, options = {}) => { calls.push({ tableId, options }); return records.get(tableId) || []; };

  const service = new RecruitmentService({ requireTableId: name => name });
  const admin = { userId: 'admin', roleCodes: ['system_admin'], dataScopes: [{ type: 'all', departmentIds: [] }] };
  const result = await service.monthlyHiring('', admin);

  assert.deepEqual(result.dailyHiring.summary, { resumes: 1, interviews: 1, offers: 1, arrived: 1 });
  assert.equal(result.dailyHiring.resumeUploads[0].uploader, '张晓霞');
  const versionQuery = calls.find(call => call.tableId === 'recruitment_resume_versions');
  const utcDatePrefixes = [...new Set([
    new Date(Date.parse(`${todayKey}T00:00:00+08:00`)).toISOString().slice(0, 10),
    new Date(Date.parse(`${todayKey}T23:59:59.999+08:00`)).toISOString().slice(0, 10),
  ])];
  for (const prefix of utcDatePrefixes) assert.match(versionQuery.options.filterByTql, new RegExp(`\\{创建时间\\} LIKE "${prefix}[%]"`));
  assert.doesNotMatch(versionQuery.options.filterByTql, />=|</);
  const onboardingQuery = calls.find(call => call.tableId === 'recruitment_onboarding_cases');
  assert.equal(onboardingQuery.options.filterByTql, `{实际到岗日期} = "${todayKey}"`);
});

test('weekly hiring activity includes Monday through Sunday and excludes the next Monday', async context => {
  const originalListAllRecords = teable.listAllRecords;
  context.after(() => { teable.listAllRecords = originalListAllRecords; });
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((value, part) => part.type === 'literal' ? value : { ...value, [part.type]: part.value }, {});
  const todayKey = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const todayUtc = Date.parse(`${todayKey}T00:00:00Z`);
  const weekday = new Date(todayUtc).getUTCDay();
  const monday = new Date(todayUtc - ((weekday + 6) % 7) * 86400000);
  const mondayKey = monday.toISOString().slice(0, 10);
  const sundayKey = new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const nextMondayKey = new Date(monday.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const records = new Map([
    ['recruitment_monthly_demands', []], ['recruitment_positions', []], ['recruitment_applications', []],
    ['recruitment_interviews', [
      row('interview_in_week', { 面试ID: 'interview_in_week', 候选人ID: 'candidate_week', 开始时间: `${sundayKey}T23:30:00+08:00`, 面试状态: '已确认' }),
      row('interview_next_week', { 面试ID: 'interview_next_week', 候选人ID: 'candidate_next', 开始时间: `${nextMondayKey}T00:00:00+08:00`, 面试状态: '已确认' }),
    ]],
    ['recruitment_offers', [{ id: 'offer_in_week', fields: { OfferID: 'offer_in_week', 候选人ID: 'candidate_week', 发送时间: `${mondayKey}T09:00:00+08:00`, 发送状态: '已发送' } }]],
    ['recruitment_candidates', []], ['resume_extraction_records', []],
    ['recruitment_resume_versions', [
      row('resume_monday', { 候选人ID: 'candidate_week', 简历记录ID: 'resume_monday', 文件名: '周一.pdf', 创建人: '张晓霞', 创建时间: `${mondayKey}T00:30:00+08:00`, 解析状态: '已完成' }),
      row('resume_sunday', { 候选人ID: 'candidate_week', 简历记录ID: 'resume_sunday', 文件名: '周日.pdf', 创建人: '李思奇', 创建时间: `${sundayKey}T23:30:00+08:00`, 解析状态: '已完成' }),
      row('resume_next_week', { 候选人ID: 'candidate_next', 简历记录ID: 'resume_next_week', 文件名: '下周.pdf', 创建人: '其他员工', 创建时间: `${nextMondayKey}T00:00:00+08:00`, 解析状态: '已完成' }),
    ]],
    ['recruitment_onboarding_cases', [
      row('onboarding_sunday', { 候选人ID: 'candidate_week', 实际到岗日期: sundayKey }),
      row('onboarding_next_week', { 候选人ID: 'candidate_next', 实际到岗日期: nextMondayKey }),
    ]],
  ]);
  teable.listAllRecords = async tableId => records.get(tableId) || [];

  const service = new RecruitmentService({ requireTableId: name => name });
  const admin = { userId: 'admin', roleCodes: ['system_admin'], dataScopes: [{ type: 'all', departmentIds: [] }] };
  const result = await service.monthlyHiring('', admin, 'week');

  assert.equal(result.period, 'week');
  assert.equal(result.hiringActivity.date, `${mondayKey} 至 ${sundayKey}`);
  assert.deepEqual(result.hiringActivity.summary, { resumes: 2, interviews: 1, offers: 1, arrived: 1 });
  assert.deepEqual(result.hiringActivity.uploaders.map(item => item.name).sort(), ['张晓霞', '李思奇'].sort());
});

test('monthly hiring activity follows the selected company-calendar month', async context => {
  const originalListAllRecords = teable.listAllRecords;
  context.after(() => { teable.listAllRecords = originalListAllRecords; });
  const rangeStart = Date.parse('2026-08-23T00:00:00+08:00');
  const rangeEnd = Date.parse('2026-09-27T00:00:00+08:00');
  const records = new Map([
    ['recruitment_monthly_demands', []], ['recruitment_positions', []], ['recruitment_applications', []],
    ['recruitment_interviews', [
      row('interview_in_company_month', { 面试ID: 'interview_in_company_month', 候选人ID: 'candidate_month', 开始时间: new Date(rangeStart + 60_000).toISOString(), 面试状态: '已确认' }),
      row('interview_after_company_month', { 面试ID: 'interview_after_company_month', 候选人ID: 'candidate_next', 开始时间: new Date(rangeEnd).toISOString(), 面试状态: '已确认' }),
    ]],
    ['recruitment_offers', [{ id: 'offer_in_company_month', fields: { OfferID: 'offer_in_company_month', 候选人ID: 'candidate_month', 发送时间: new Date(rangeStart + 120_000).toISOString(), 发送状态: '已发送' } }]],
    ['recruitment_candidates', []], ['resume_extraction_records', []],
    ['recruitment_resume_versions', [
      row('resume_in_company_month', { 候选人ID: 'candidate_month', 简历记录ID: 'resume_in_company_month', 文件名: '公司月内.pdf', 创建人: '张晓霞', 创建时间: new Date(rangeStart + 180_000).toISOString(), 解析状态: '已完成' }),
      row('resume_after_company_month', { 候选人ID: 'candidate_next', 简历记录ID: 'resume_after_company_month', 文件名: '公司月外.pdf', 创建人: '李思奇', 创建时间: new Date(rangeEnd).toISOString(), 解析状态: '已完成' }),
    ]],
    ['recruitment_onboarding_cases', [
      row('onboarding_in_company_month', { 候选人ID: 'candidate_month', 实际到岗日期: '2026-08-23' }),
      row('onboarding_after_company_month', { 候选人ID: 'candidate_next', 实际到岗日期: '2026-09-27' }),
    ]],
  ]);
  teable.listAllRecords = async tableId => records.get(tableId) || [];

  const service = new RecruitmentService({ requireTableId: name => name });
  const admin = { userId: 'admin', roleCodes: ['system_admin'], dataScopes: [{ type: 'all', departmentIds: [] }] };
  const result = await service.monthlyHiring('2026-09', admin, 'month');

  assert.equal(result.month, '2026-09');
  assert.equal(result.period, 'month');
  assert.equal(result.hiringActivity.date, '2026-08-23 至 2026-09-26');
  assert.deepEqual(result.hiringActivity.summary, { resumes: 1, interviews: 1, offers: 1, arrived: 1 });
});
