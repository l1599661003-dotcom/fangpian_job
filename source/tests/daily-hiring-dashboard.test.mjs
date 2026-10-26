import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildHiringDashboardData, buildHiringDashboardImageMessage, buildHiringDashboardSvg, renderHiringDashboardPng, resolveHiringDashboardFont } from '../dist/tasks/daily-hiring-dashboard.task.js';

const row = (id, fields) => ({ id, fields });

test('daily hiring dashboard explicitly loads CJK fonts and rejects missing fonts', () => {
  const preview = resolveHiringDashboardFont(path => path.includes('/arp/source-han-sans/'));
  assert.equal(preview.defaultFontFamily, 'Source Han Sans CN');
  assert.equal(preview.loadSystemFonts, false);
  assert.equal(preview.fontFiles.length, 2);
  const production = resolveHiringDashboardFont(path => path.includes('/opentype/noto/'));
  assert.equal(production.defaultFontFamily, 'Noto Sans CJK SC');
  assert.equal(production.sansSerifFamily, 'Noto Sans CJK SC');
  assert.equal(production.loadSystemFonts, false);
  assert.equal(production.fontFiles.length, 2);
  assert.throws(() => resolveHiringDashboardFont(() => false), /缺少中文字体.*停止生成和发送/);
  assert.throws(() => resolveHiringDashboardFont(path => path.endsWith('Regular.otf')), /缺少中文字体/);
});

test('daily hiring dashboard only counts published demands and Tianji create-time arrivals', () => {
  const data = buildHiringDashboardData({
    month: '2026-09',
    generatedDate: '2026-09-23',
    positions: [
      row('position_sales', { 职位ID: 'pos_sales', 职位名称: '商务开发', 部门: '商务部', 发布状态: '招聘中', 招聘状态: '招聘中' }),
      row('position_product', { 职位ID: 'pos_product', 职位名称: '产品经理', 部门: '产品部', 发布状态: '待发布', 招聘状态: '待启动' }),
    ],
    demands: [
      row('demand_sales', { 需求月份: '2026-09', 职位ID: 'pos_sales', 职位名称: '商务开发', 部门: '商务部', 需求数量: 3, 需求状态: '已确认', 审批状态: '已通过', 优先级: '紧急' }),
      row('demand_product', { 需求月份: '2026-09', 职位ID: 'pos_product', 职位名称: '产品经理', 部门: '产品部', 需求数量: 2, 需求状态: '已确认', 审批状态: '已通过', 优先级: '重要' }),
    ],
    candidates: [
      row('candidate_a', { 候选人ID: 'talent_a', 姓名: '候选人甲', 天玑入职日期: '2026-09-22' }),
      row('candidate_b', { 候选人ID: 'talent_b', 姓名: '候选人乙', 天玑入职日期: '2026-08-31' }),
      row('candidate_c', { 候选人ID: 'talent_c', 姓名: '候选人丙', 天玑入职日期: '2026-09-15' }),
    ],
    applications: [
      row('application_a', { 候选人ID: 'talent_a', 职位ID: 'pos_sales', 当前阶段: '已入职', 更新时间: '2026-09-22T10:00:00.000Z' }),
      row('application_b', { 候选人ID: 'talent_b', 职位ID: 'pos_sales', 当前阶段: '已入职', 更新时间: '2026-08-31T10:00:00.000Z' }),
      row('application_c', { 候选人ID: 'talent_c', 职位ID: 'pos_product', 当前阶段: '已入职', 更新时间: '2026-09-15T10:00:00.000Z' }),
    ],
  });

  assert.equal(data.summary.demand, 3);
  assert.equal(data.summary.arrived, 2);
  assert.equal(data.summary.remaining, 1);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].role, '商务开发');
  assert.deepEqual(data.rows[0].completedNames, ['候选人甲', '候选人乙']);
});

test('daily hiring dashboard counts arrivals by company month across Gregorian month boundaries', () => {
  const data = buildHiringDashboardData({
    month: '2026-10',
    generatedDate: '2026-09-29',
    positions: [row('position_sales', { 职位ID: 'pos_sales', 职位名称: '商务开发', 部门: '商务部', 发布状态: '招聘中', 招聘状态: '招聘中' })],
    demands: [row('demand_sales', { 需求月份: '2026-10', 职位ID: 'pos_sales', 职位名称: '商务开发', 部门: '商务部', 需求数量: 4, 需求状态: '已确认', 审批状态: '已通过' })],
    candidates: [
      row('candidate_before', { 候选人ID: 'talent_before', 姓名: '边界前', 天玑入职日期: '2026-09-26' }),
      row('candidate_start', { 候选人ID: 'talent_start', 姓名: '区间开始', 天玑入职日期: '2026-09-27' }),
      row('candidate_end', { 候选人ID: 'talent_end', 姓名: '区间结束', 天玑入职日期: '2026-10-24' }),
      row('candidate_after', { 候选人ID: 'talent_after', 姓名: '边界后', 天玑入职日期: '2026-10-25' }),
    ],
    applications: ['talent_before', 'talent_start', 'talent_end', 'talent_after'].map((candidateId, index) => row(`application_${index}`, { 候选人ID: candidateId, 职位ID: 'pos_sales', 当前阶段: '已入职' })),
  });

  assert.equal(data.summary.arrived, 2);
  assert.deepEqual(data.rows[0].completedNames, ['区间开始', '区间结束']);
});

test('daily hiring dashboard reads position HR bindings and normalizes legacy reserve priorities', () => {
  const data = buildHiringDashboardData({ month: '2026-09', generatedDate: '2026-09-28',
    positions: ['一般', '低', '储备'].map((priority, index) => row(`position_${index}`, { 职位ID: `pos_${index}`, 职位名称: '储备岗位', 部门: '技术', 发布状态: '招聘中', ...(index ? {} : { 招聘HR: '张杰', 备用招聘HR: '张晓霞' }) })),
    demands: ['一般', '低', '储备'].map((priority, index) => row(`demand_${index}`, { 职位ID: `pos_${index}`, 需求月份: '2026-09', 需求数量: 2, 优先级: priority })), candidates: [], applications: [],
  });
  assert.deepEqual(data.rows.map(item => item.priority), ['储备', '储备', '储备']);
  assert.equal(data.rows[0].recruiter, '张杰');
  assert.equal(data.rows[0].backupRecruiter, '张晓霞');
  const svg = buildHiringDashboardSvg(data);
  assert.match(svg, /招聘HR：张杰 · 备用HR：张晓霞/);
  assert.match(svg, /招聘HR：待分配/);
  assert.doesNotMatch(svg, />一般</);
  assert.match(buildHiringDashboardSvg({ ...data, rows: [{ ...data.rows[0], recruiter: '<HR&>' }] }), /&lt;HR&amp;&gt;/);
});

test('daily hiring dashboard renders a valid PNG card', () => {
  const data = {
    month: '2026-09',
    generatedDate: '2026-09-23',
    summary: { demand: 8, arrived: 3, remaining: 5, completedPositions: 1 },
    rows: [{ positionId: 'pos_sales', department: '商务部', role: '商务开发', priority: '紧急', demand: 8, completed: 3, remaining: 5, completionRate: 38, completedAll: false, completedNames: ['候选人甲', '候选人乙'] }],
  };
  const svg = buildHiringDashboardSvg(data);
  assert.match(svg, /部门岗位达成日报/);
  assert.match(svg, /2026-09 · 8\/23–9\/26/);
  assert.match(svg, /create_time/);
  const png = renderHiringDashboardPng(data);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 10_000);
  assert.ok(png.length < 2 * 1024 * 1024);
  const message = buildHiringDashboardImageMessage(png);
  assert.equal(message.msgtype, 'image');
  assert.equal(message.image.base64, png.toString('base64'));
  assert.equal(message.image.md5, createHash('md5').update(png).digest('hex'));
  const differentChinese = renderHiringDashboardPng({ ...data, rows: [{ ...data.rows[0], department: '产品部' }] });
  assert.notDeepEqual(png, differentChinese, 'Different Chinese labels must render different glyphs, not identical missing-font boxes');
});

test('daily hiring dashboard renders every demand row in a long image', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    positionId: `pos_${index + 1}`,
    department: `部门${index + 1}`,
    role: `岗位${index + 1}`,
    priority: index === 0 ? '紧急' : '重要',
    demand: index + 1,
    completed: 0,
    remaining: index + 1,
    completionRate: 0,
    completedAll: false,
    completedNames: [],
  }));
  const data = {
    month: '2026-09',
    generatedDate: '2026-09-23',
    summary: { demand: 28, arrived: 0, remaining: 28, completedPositions: 0 },
    rows,
  };
  const svg = buildHiringDashboardSvg(data);
  assert.match(svg, /height="882"/);
  assert.match(svg, /共 7 个招聘中岗位/);
  assert.match(svg, /岗位7/);
  const png = renderHiringDashboardPng(data);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length < 2 * 1024 * 1024);
});
