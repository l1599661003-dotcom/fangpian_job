import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { TalentsService } from '../dist/modules/talents/talents.service.js';

test('talent importer search matches both uploaders and referral referrers', async () => {
  const candidates = [
    { id: 'imported_record', fields: { 候选人ID: 'candidate_imported', 姓名: '导入候选人', 工作经历: '已有经历', 当前简历文件名: 'a.pdf', 当前简历地址: 'https://files.example.test/a.pdf', 创建人: '王导入', 创建时间: '2026-10-19T01:00:00.000Z' } },
    { id: 'referral_record', fields: { 候选人ID: 'candidate_referral', 姓名: '内推候选人', 工作经历: '已有经历', 当前简历文件名: 'b.pdf', 当前简历地址: 'https://files.example.test/b.pdf', 创建人: '系统导入', 来源类型: '内推', 创建时间: '2026-10-19T02:00:00.000Z' } },
    { id: 'other_record', fields: { 候选人ID: 'candidate_other', 姓名: '其他候选人', 工作经历: '已有经历', 当前简历文件名: 'c.pdf', 当前简历地址: 'https://files.example.test/c.pdf', 创建人: '其他人', 创建时间: '2026-10-19T03:00:00.000Z' } },
  ];
  const referralRows = [
    { id: 'referral_record', fields: { 候选人ID: 'candidate_referral', 推荐人用户ID: 'user_referrer', 推荐人: '李内推', 推荐时间: '2026-10-19T02:00:00.000Z', 创建时间: '2026-10-19T02:00:00.000Z' } },
  ];
  const originals = { listAllRecords: teable.listAllRecords, listRecordsPage: teable.listRecordsPage, listByAnyField: teable.listByAnyField };
  const referralFilters = [];
  const candidateFilters = [];
  const filterCandidates = (filter = '') => candidates.filter((row) => {
    if (filter.includes('王导入')) return row.fields.创建人 === '王导入';
    if (filter.includes('candidate_referral')) return row.fields.候选人ID === 'candidate_referral';
    return true;
  });
  teable.listAllRecords = async (table, options = {}) => {
    if (table === 'recruitment_referrals') {
      referralFilters.push(options.filterByTql);
      return options.filterByTql?.includes('李内推') ? referralRows : [];
    }
    if (table === 'recruitment_candidates') {
      if (options.filterByTql) candidateFilters.push(options.filterByTql);
      return filterCandidates(options.filterByTql);
    }
    return [];
  };
  teable.listRecordsPage = async (table, options = {}) => ({ records: filterCandidates(options.filterByTql), totalIsExact: true });
  teable.listByAnyField = async (table, field, ids) => table === 'recruitment_referrals'
    ? referralRows.filter((row) => ids.includes(row.fields.候选人ID))
    : [];
  try {
    const service = new TalentsService({ requireTableId: name => name }, {}, {});
    const byImporter = await service.list({ importer: '王导入', pageSize: '10' });
    assert.equal(byImporter.total, 1);
    assert.equal(byImporter.talents[0].name, '导入候选人');
    assert.equal(byImporter.talents[0].importedBy, '王导入');

    const byReferrer = await service.list({ importer: '李内推', pageSize: '10' });
    assert.equal(byReferrer.total, 1);
    assert.equal(byReferrer.talents[0].name, '内推候选人');
    assert.equal(byReferrer.talents[0].referrer, '李内推');
    assert.ok(referralFilters.some(filter => filter?.includes('{推荐人} LIKE "%李内推%"')));
    assert.ok(candidateFilters.some(filter => filter?.includes('{候选人ID} = "candidate_referral"')));
  } finally {
    Object.assign(teable, originals);
  }
});
