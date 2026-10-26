import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { teable } from '../dist/platform/teable.js';
import { SYSTEM_ROLE_TEMPLATES } from '../dist/modules/database/database.schema.js';
import { PointsService } from '../dist/modules/points/points.service.js';
import { PointsController } from '../dist/modules/points/points.controller.js';

function stubRankingData(tables) {
  const original = teable.listAllRecords;
  teable.listAllRecords = async (tableId) => [...(tables[tableId] || [])];
  return async () => { teable.listAllRecords = original; };
}

function referral(row) {
  return { id: row.id, fields: row };
}

test('referral points accumulate interview, sent offer, and onboarding milestones by position level', async () => {
  const restore = stubRankingData({
    recruitment_positions: [
      referral({ 职位ID: 'position_core', 职位名称: '内容负责人', 部门: '内容部', 负责人用户ID: 'owner_core', 负责人: '负责人甲', 招聘HR用户ID: 'hr_core', 招聘HR: '招聘甲', 岗位层级: '中高层岗位' }),
      referral({ 职位ID: 'position_normal', 职位名称: '内容运营', 部门: '内容部', 负责人用户ID: 'owner_normal', 负责人: '负责人乙', 招聘HR用户ID: 'hr_normal', 招聘HR: '招聘乙', 岗位层级: '普通岗位' }),
    ],
    recruitment_referrals: [
      referral({ 内推记录ID: 'referral_core', 候选人ID: 'candidate_core', 应聘记录ID: 'application_core', 职位ID: 'position_core', 推荐人用户ID: 'referrer_core', 推荐人: '推荐人甲', 推荐人部门: '品牌部', 候选人姓名快照: '候选人甲', 有效性结论: '有效', 推荐时间: '2026-10-01T01:00:00.000Z' }),
      referral({ 内推记录ID: 'referral_normal', 候选人ID: 'candidate_normal', 应聘记录ID: 'application_normal', 职位ID: 'position_normal', 推荐人用户ID: 'referrer_normal', 推荐人: '推荐人乙', 推荐人部门: '增长部', 候选人姓名快照: '候选人乙', 有效性结论: '有效', 推荐时间: '2026-10-02T01:00:00.000Z' }),
    ],
    recruitment_applications: [
      referral({ 应聘记录ID: 'application_core', 候选人ID: 'candidate_core', 职位ID: 'position_core', 更新时间: '2026-10-01T02:00:00.000Z' }),
      referral({ 应聘记录ID: 'application_normal', 候选人ID: 'candidate_normal', 职位ID: 'position_normal', 更新时间: '2026-10-02T02:00:00.000Z' }),
    ],
    recruitment_interviews: [
      referral({ 应聘记录ID: 'application_core', 候选人ID: 'candidate_core', 职位ID: 'position_core', 面试状态: '已预约', 开始时间: '2026-10-05T02:00:00.000Z' }),
      referral({ 应聘记录ID: 'application_normal', 候选人ID: 'candidate_normal', 职位ID: 'position_normal', 面试状态: '已预约', 开始时间: '2026-10-06T02:00:00.000Z' }),
    ],
    recruitment_offers: [
      referral({ 应聘记录ID: 'application_core', 候选人ID: 'candidate_core', 职位ID: 'position_core', 发送状态: '已发送', 发送时间: '2026-10-07T02:00:00.000Z' }),
      referral({ 应聘记录ID: 'application_normal', 候选人ID: 'candidate_normal', 职位ID: 'position_normal', 发送状态: '已发送', 发送时间: '2026-10-08T02:00:00.000Z' }),
    ],
    recruitment_onboarding_cases: [
      referral({ 应聘记录ID: 'application_core', 候选人ID: 'candidate_core', 职位ID: 'position_core', 实际到岗日期: '2026-10-10' }),
      referral({ 应聘记录ID: 'application_normal', 候选人ID: 'candidate_normal', 职位ID: 'position_normal', 实际到岗日期: '2026-10-11' }),
    ],
  });
  try {
    const ranking = await new PointsService({ requireTableId: name => name }).ranking();
    assert.deepEqual(ranking.rules, [
      { category: '中高层岗位', interview: 3, offer: 6, onboard: 9 },
      { category: '普通岗位', interview: 1, offer: 2, onboard: 3 },
    ]);
    assert.deepEqual(ranking.ranking.map(row => [row.name, row.points]), [['推荐人甲', 18], ['推荐人乙', 6]]);
    assert.deepEqual(ranking.summary, { participants: 2, totalPoints: 24, interviews: 2, offers: 2, onboardings: 2 });
  } finally {
    await restore();
  }
});

test('referral points deduplicate one candidate for one position and exclude position owners and HR', async () => {
  const restore = stubRankingData({
    recruitment_positions: [
      referral({ 职位ID: 'position_owner', 职位名称: '运营经理', 部门: '运营部', 负责人用户ID: 'referrer_owner', 负责人: '岗位负责人' }),
      referral({ 职位ID: 'position_duplicate', 职位名称: '投放专员', 部门: '投放部', 负责人用户ID: 'owner', 负责人: '负责人' }),
    ],
    recruitment_referrals: [
      referral({ 内推记录ID: 'referral_late', 候选人ID: 'candidate_duplicate', 应聘记录ID: 'application_duplicate', 职位ID: 'position_duplicate', 推荐人用户ID: 'referrer_late', 推荐人: '后推荐人', 推荐时间: '2026-10-02T00:00:00.000Z', 有效性结论: '有效' }),
      referral({ 内推记录ID: 'referral_early', 候选人ID: 'candidate_duplicate', 应聘记录ID: 'application_duplicate', 职位ID: 'position_duplicate', 推荐人用户ID: 'referrer_early', 推荐人: '早推荐人', 推荐时间: '2026-10-01T00:00:00.000Z', 有效性结论: '有效' }),
      referral({ 内推记录ID: 'referral_owner', 候选人ID: 'candidate_owner', 应聘记录ID: 'application_owner', 职位ID: 'position_owner', 推荐人用户ID: 'referrer_owner', 推荐人: '岗位负责人', 推荐时间: '2026-10-01T00:00:00.000Z', 有效性结论: '有效' }),
    ],
    recruitment_interviews: [
      referral({ 应聘记录ID: 'application_duplicate', 候选人ID: 'candidate_duplicate', 职位ID: 'position_duplicate', 面试状态: '已预约' }),
      referral({ 应聘记录ID: 'application_owner', 候选人ID: 'candidate_owner', 职位ID: 'position_owner', 面试状态: '已预约' }),
    ],
  });
  try {
    const ranking = await new PointsService({ requireTableId: name => name }).ranking();
    assert.equal(ranking.ranking.length, 1);
    assert.equal(ranking.ranking[0].name, '早推荐人');
    assert.equal(ranking.ranking[0].points, 1);
  } finally {
    await restore();
  }
});

test('unsent offers do not generate points and cancelled interviews are ignored', async () => {
  const restore = stubRankingData({
    recruitment_positions: [referral({ 职位ID: 'position_normal', 职位名称: '普通岗位', 部门: '运营部' })],
    recruitment_referrals: [referral({ 内推记录ID: 'referral', 候选人ID: 'candidate', 应聘记录ID: 'application', 职位ID: 'position_normal', 推荐人用户ID: 'referrer', 推荐人: '推荐人', 推荐时间: '2026-10-01T00:00:00.000Z' })],
    recruitment_interviews: [referral({ 应聘记录ID: 'application', 候选人ID: 'candidate', 职位ID: 'position_normal', 面试状态: '已取消' })],
    recruitment_offers: [referral({ 应聘记录ID: 'application', 候选人ID: 'candidate', 职位ID: 'position_normal', 发送状态: '待人工发送', 发送时间: '' })],
  });
  try {
    const ranking = await new PointsService({ requireTableId: name => name }).ranking();
    assert.deepEqual(ranking.ranking, []);
    assert.deepEqual(ranking.summary, { participants: 0, totalPoints: 0, interviews: 0, offers: 0, onboardings: 0 });
  } finally {
    await restore();
  }
});

test('points ranking is restricted to recruiting roles and page access', async () => {
  const controller = new PointsController(
    { async ranking() { return { ranking: [] }; } },
    {
      async getRequestAccess(headers) { return headers?.authorized ? { profile: { roleCodes: headers.roleCodes } } : null; },
      assertPage(profile, page) { assert.equal(page, 'points'); },
    },
  );

  await assert.rejects(() => controller.ranking({}), /积分排行必须启用可信登录身份/);
  await assert.rejects(() => controller.ranking({ authorized: true, roleCodes: ['employee'] }), /积分排行仅限招聘专员和HRBP查看/);
  assert.deepEqual((await controller.ranking({ authorized: true, roleCodes: ['recruiter'] })).ranking, []);
  assert.deepEqual((await controller.ranking({ authorized: true, roleCodes: ['hrbp'] })).ranking, []);
  assert.deepEqual((await controller.ranking({ authorized: true, roleCodes: ['system_admin'] })).ranking, []);
});

test('points menu, page, renderer, and role templates are wired together', async () => {
  const [html, renderer, component, shell, mobile, styles, build] = await Promise.all([
    readFile('source-app/方片招聘网站界面.html', 'utf8'),
    readFile('source-app/resumeflow.js', 'utf8'),
    readFile('source-app/vue/points-ranking.js', 'utf8'),
    readFile('source-app/app-shell.js', 'utf8'),
    readFile('source-app/mobile-app.js', 'utf8'),
    readFile('source-app/admin-ui.css', 'utf8'),
    readFile('build.mjs', 'utf8'),
  ]);
  assert.match(html, /data-page="points"/);
  assert.match(html, /id="page-points"/);
  assert.match(html, /vue\/points-ranking\.js/);
  assert.match(renderer, /function loadPointsPage/);
  assert.match(renderer, /if \(page === 'points'\) loadPointsPage\(\)/);
  assert.match(renderer, /window\.mountPointsRankingPage\?\.\(\)/);
  assert.match(renderer, /window\.unmountPointsRankingPage\?\.\(\)/);
  assert.match(component, /const PointsRankingPage/);
  assert.match(component, /api\/points\/ranking/);
  assert.match(component, /data-points-retry/);
  assert.match(component, /data-points-refresh/);
  assert.match(component, /window\.unmountPointsRankingPage/);
  assert.match(build, /points-ranking\.js/);
  assert.match(shell, /points: 'points'/);
  assert.match(mobile, /page: 'points', label: '积分排行', access: 'points'/);
  assert.match(styles, /\.points-layout/);
  assert.match(styles, /\.points-rank-card/);

  const recruiter = SYSTEM_ROLE_TEMPLATES.find(role => role.code === 'recruiter');
  const hrbp = SYSTEM_ROLE_TEMPLATES.find(role => role.code === 'hrbp');
  assert.ok(recruiter.pages.includes('points'));
  assert.ok(hrbp.pages.includes('points'));
  assert.equal(SYSTEM_ROLE_TEMPLATES.filter(role => role.pages.includes('points')).map(role => role.code).sort().join(','), 'hrbp,recruiter');
  assert.ok(SYSTEM_ROLE_TEMPLATES.find(role => role.code === 'system_admin').pages.includes('*'));
});
