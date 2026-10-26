import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { TalentsService } from '../dist/modules/talents/talents.service.js';
import { TALENT_DIRECTORY_FIELDS } from '../dist/modules/talents/talent-directory-fields.js';
import { TALENT_DIRECTORY_FILTER_FIELDS } from '../dist/modules/talents/talent-directory-fields.js';
import { invalidateReadTables } from '../dist/platform/read-cache.js';

test('default talent count uses aggregation minus hidden rows, while filtered counts remain exact', async () => {
  const originals = { countRecords: teable.countRecords, listAllRecords: teable.listAllRecords };
  const filters = [];
  let aggregateCalls = 0;
  teable.countRecords = async () => { aggregateCalls++; return 1000; };
  teable.listAllRecords = async (table, options) => {
    filters.push(options.filterByTql);
    assert.deepEqual(options.fields, ['候选人ID', '合并状态', '候选人状态']);
    return [{ id: 'deleted', fields: { 候选人状态: '已删除' } }, { id: 'merged', fields: { 合并状态: '已合并' } }, { id: 'valid', fields: {} }];
  };
  try {
    const service = new TalentsService({ requireTableId: name => name }, {}, {});
    assert.equal(await service.directoryTotal(), 998);
    assert.equal(filters[0], '{合并状态} = "已合并" OR {候选人状态} = "已删除"');
    assert.equal(await service.directoryTotal('{姓名} LIKE "%测试%"'), 1);
    assert.equal(aggregateCalls, 1);
    assert.equal(filters[1], '{姓名} LIKE "%测试%"');
    teable.countRecords = async () => { throw new Error('aggregate unavailable'); };
    assert.equal(await service.directoryTotal(), 1);
    assert.equal(filters.at(-1), undefined);
  } finally { Object.assign(teable, originals); }
});

test('automatic avatar backfill never reads full resumes or biography fields', async () => {
  const original = teable.listAllRecords;
  const calls = [];
  teable.listAllRecords = async (table, options) => {
    calls.push({ table, options });
    assert.ok(options.fields?.length);
    assert.ok(!options.fields.includes('OCR原文'));
    assert.ok(!options.fields.includes('工作经历'));
    return [];
  };
  try {
    const result = await new TalentsService({ requireTableId: name => name }, {}, {}).backfillStoredAvatars();
    assert.equal(result.total, 0);
    assert.equal(calls.length, 2);
  } finally { teable.listAllRecords = original; }
});

test('1000-person directory reads 25 related candidates and skinny count fields without fetching resumes', async () => {
  const originals = Object.fromEntries(['countRecords', 'listRecordsPage', 'listAllRecords', 'listByAnyField'].map(method => [method, teable[method]]));
  const calls = [];
  const records = Array.from({ length: 1000 }, (_, index) => ({ id: `record_${index}`, fields: {
    候选人ID: `candidate_${index}`, 姓名: `候选人${index}`, 候选人状态: '待业务群评审',
    工作经历: '已有工作经历', 当前简历文件名: '原简历.pdf', 当前简历地址: 'https://files.example.test/resume.pdf',
    创建时间: new Date(Date.UTC(2026, 8, 29, 0, 0, 1000 - index)).toISOString(),
  } }));
  teable.countRecords = async () => records.length;
  teable.listRecordsPage = async (table, options) => {
    calls.push({ method: 'page', table, options });
    return { records: records.slice(options.skip, options.skip + options.take), totalIsExact: false };
  };
  teable.listAllRecords = async (table, options) => {
    calls.push({ method: 'all', table, options });
    assert.ok(options.fields?.length, `${table} must request summary fields`);
    if (table === 'recruitment_candidates') {
      assert.deepEqual(options.fields, ['候选人ID', '合并状态', '候选人状态']);
      return records;
    }
    assert.notEqual(table, 'resume_extraction_records');
    return [];
  };
  teable.listByAnyField = async (table, field, ids, take, fields) => {
    calls.push({ method: 'related', table, ids, fields });
    assert.notEqual(table, 'resume_extraction_records');
    assert.equal(ids.length, 25);
    assert.ok(fields?.length);
    return [];
  };
  try {
    const service = new TalentsService({ requireTableId: name => name }, {}, {});
    const first = await service.list({});
    assert.equal(first.total, 1000);
    assert.equal(first.talents.length, 25);
    assert.equal(first.totalPages, 40);
    assert.equal(first.talents[0].sourceFileUrl, 'https://files.example.test/resume.pdf');
    const coldCalls = calls.length;
    const warm = await service.list({});
    assert.equal(warm.total, 1000);
    assert.equal(calls.length, coldCalls, 'warm directory should not read Teable again');
    const second = await service.list({ page: '2' });
    assert.equal(second.talents[0].id, 'candidate_25');
    assert.equal(calls.filter(call => call.method === 'all' && call.table === 'recruitment_candidates').length, 1);
    records.pop();
    invalidateReadTables('recruitment_candidates');
    assert.equal((await service.list({})).total, 999);
    const beforeRefresh = calls.length;
    await service.list({ refresh: '1' });
    assert.ok(calls.length > beforeRefresh, 'explicit refresh must bypass the warm cache');
    const pageRead = calls.find(call => call.method === 'page');
    assert.deepEqual(pageRead.options.fields, TALENT_DIRECTORY_FIELDS.recruitment_candidates);
  } finally { Object.assign(teable, originals); }
});

test('talent detail caches raw data but reapplies each user permissions and invalidates communication writes', async () => {
  let reads = 0, grants = 0;
  const service = new TalentsService({ requireTableId: name => name }, {}, {}, {
    hasPage: profile => profile.allowed,
    protectTalent: (result, profile) => ({ id: result.id, phone: profile.userId === 'admin' ? result.phone : '***' }),
  }, { activeUnlockFields: async () => { grants++; return []; } });
  service.loadAll = async () => { reads++; return { candidates: [{ id: 'record', fields: { 候选人ID: 'candidate' } }] }; };
  service.profile = () => ({ id: 'candidate', phone: 'test-only', _access: {} });
  assert.equal((await service.detail('candidate', { userId: 'admin', allowed: true })).phone, 'test-only');
  assert.equal((await service.detail('candidate', { userId: 'employee', allowed: true })).phone, '***');
  assert.equal(reads, 1);
  assert.equal(grants, 2);
  await assert.rejects(service.detail('candidate', { userId: 'revoked', allowed: false }), /菜单权限/);
  invalidateReadTables('recruitment_communications');
  await service.detail('candidate', { userId: 'admin', allowed: true });
  assert.equal(reads, 2);
});

test('complex directory filters use a light index and hydrate only the current page', async () => {
  const originals = { listAllRecords: teable.listAllRecords, listByAnyField: teable.listByAnyField };
  const allReads = [];
  const relatedReads = [];
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    id: `candidate_record_${index}`,
    fields: {
      候选人ID: `candidate_${index}`, 姓名: `候选人${index}`, 候选人状态: '待业务群评审', 合并状态: '独立档案',
      年龄: 25 + index, 当前城市: '烟台', 工作经历: '结构化工作经历', 当前简历文件名: `resume-${index}.pdf`,
      当前简历地址: `https://files.example.test/resume-${index}.pdf`, 创建时间: `2026-10-01T00:${String(index).padStart(2, '0')}:00.000Z`,
    },
  }));
  const tagRows = candidates.slice(0, 5).map((candidate, index) => ({
    id: `tag_${index}`,
    fields: { 候选人ID: candidate.fields.候选人ID, 标签状态: '当前', 标签分类: '技能标签', 标签名称: '沟通能力' },
  }));
  const relatedRows = (table, fields) => candidates.map((candidate, index) => ({
    id: `${table}_${index}`,
    fields: { 候选人ID: candidate.fields.候选人ID, ...fields },
  }));
  teable.listAllRecords = async (table, options = {}) => {
    allReads.push({ table, options });
    if (table === 'recruitment_candidates') return candidates;
    if (table === 'recruitment_applications') return relatedRows(table, { 职位ID: 'position_1', 当前阶段: '待业务群评审', AI匹配分: 80 });
    if (table === 'recruitment_ai_assessments') return relatedRows(table, { 分析记录ID: `analysis_${table}`, 版本号: 1, 人工确认状态: '待人工确认' });
    if (table === 'recruitment_job_matches') return relatedRows(table, { 匹配状态: '当前', 职位ID: 'position_1', 职位名称: '产品执行PM', 匹配总分: 80 });
    if (table === 'recruitment_positions') return [{ id: 'position_record_1', fields: { 职位ID: 'position_1', 部门ID: 'department_1' } }];
    if (table === 'recruitment_candidate_tags') return tagRows;
    return [];
  };
  teable.listByAnyField = async (table, _field, ids, _take, fields) => {
    relatedReads.push({ table, ids, fields });
    assert.ok(ids.length <= 10, `${table} must only hydrate the current page`);
    if (table === 'recruitment_applications') return candidates.filter((_, index) => ids.includes(`candidate_${index}`)).map((candidate, index) => ({ id: `page_application_${index}`, fields: { 候选人ID: candidate.fields.候选人ID, 职位ID: 'position_1', 当前阶段: '待业务群评审', AI匹配分: 80 } }));
    if (table === 'recruitment_ai_assessments') return candidates.filter((_, index) => ids.includes(`candidate_${index}`)).map((candidate, index) => ({ id: `page_assessment_${index}`, fields: { 候选人ID: candidate.fields.候选人ID, 分析记录ID: `page_analysis_${index}`, 版本号: 1, 人工确认状态: '待人工确认' } }));
    if (table === 'recruitment_job_matches') return candidates.filter((_, index) => ids.includes(`candidate_${index}`)).map((candidate, index) => ({ id: `page_match_${index}`, fields: { 候选人ID: candidate.fields.候选人ID, 匹配状态: '当前', 职位ID: 'position_1', 职位名称: '产品执行PM', 匹配总分: 80 } }));
    if (table === 'recruitment_interviews') return [];
    return [];
  };
  try {
    const service = new TalentsService({ requireTableId: name => name }, {}, {});
    const result = await service.list({ tag: '沟通能力', job: '产品执行PM', minScore: '60', page: '1', pageSize: '10' });
    assert.equal(result.total, 5);
    assert.equal(result.talents.length, 5);
    assert.equal(result.talents[0].tags[0].name, '沟通能力');
    assert.equal(result.talents[0].matches[0].positionName, '产品执行PM');
    const candidateRead = allReads.find(read => read.table === 'recruitment_candidates');
    assert.deepEqual(candidateRead.options.fields, TALENT_DIRECTORY_FIELDS.recruitment_candidates);
    assert.deepEqual(allReads.find(read => read.table === 'recruitment_job_matches').options.fields, TALENT_DIRECTORY_FILTER_FIELDS.recruitment_job_matches);
    assert.equal(allReads.filter(read => read.table === 'recruitment_candidate_tags' && !read.options.filterByTql).length, 0);
    assert.equal(allReads.some(read => read.table === 'resume_extraction_records'), false);
    assert.ok(relatedReads.length >= 3);
  } finally { Object.assign(teable, originals); }
});

test('legacy resume work history fallback requests OCR only when extracted work history is missing', async () => {
  const original = teable.listByAnyField;
  const calls = [];
  teable.listByAnyField = async (table, field, ids, take, fields) => {
    calls.push({ ids, fields });
    if (fields.includes('OCR原文')) return [{ id: 'old_resume', fields: { 候选人ID: 'legacy', OCR原文: '工作经历\n历史经历' } }];
    return [
      { id: 'new_resume', fields: { 候选人ID: 'modern', 工作经历: '结构化经历' } },
      { id: 'old_resume', fields: { 候选人ID: 'legacy' } },
    ];
  };
  try {
    const service = new TalentsService({ requireTableId: name => name }, {}, {});
    const rows = await service.loadDirectoryResumes([{ id: 'modern', fields: {} }, { id: 'legacy', fields: {} }]);
    assert.equal(calls[0].fields.includes('OCR原文'), false);
    assert.deepEqual(calls[1].ids, ['legacy']);
    assert.equal(rows.find(row => row.id === 'new_resume').fields['工作经历'], '结构化经历');
    assert.match(rows.find(row => row.id === 'old_resume').fields['OCR原文'], /历史经历/);
  } finally { teable.listByAnyField = original; }
});
