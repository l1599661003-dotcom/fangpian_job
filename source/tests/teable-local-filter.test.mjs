import test from 'node:test';
import assert from 'node:assert/strict';

process.env.STUDIO_PLATFORM_URL = 'https://platform.example.test';
const { filterLocalRecords } = await import('../dist/platform/teable.js');

const rows = [
  { id: 'row_imported', fields: { 创建人: '高子云', 姓名: '宋玉博', 候选人状态: '待处理' } },
  { id: 'row_other', fields: { 创建人: '张晓霞', 姓名: '高明明', 候选人状态: '待处理' } },
  { id: 'row_blank', fields: { 姓名: '李四' } },
];

test('local TQL evaluator supports contains-style LIKE without eating the leading percent', () => {
  // 回归：此前 "%高子云%" 的前导 % 被捕获进值里，startsWith('%高子云') 永远为假，
  // 人才档案的导入人/内推人/姓名筛选因此全部返回 0 条。
  assert.deepEqual(filterLocalRecords(rows, '{创建人} LIKE "%高子云%"').map(row => row.id), ['row_imported']);
});

test('local TQL evaluator keeps prefix, suffix, equality and AND/OR semantics', () => {
  assert.deepEqual(filterLocalRecords(rows, '{姓名} LIKE "宋%"').map(row => row.id), ['row_imported']);
  assert.deepEqual(filterLocalRecords(rows, '{姓名} LIKE "%玉博"').map(row => row.id), ['row_imported']);
  assert.deepEqual(filterLocalRecords(rows, '{姓名} = "李四"').map(row => row.id), ['row_blank']);
  assert.deepEqual(filterLocalRecords(rows, '{姓名} LIKE "%高%" AND {创建人} LIKE "%晓霞%"').map(row => row.id), ['row_other']);
  assert.deepEqual(filterLocalRecords(rows, '{推荐人} LIKE "%李内推%" OR {创建人} LIKE "%高子云%"').map(row => row.id), ['row_imported']);
  assert.deepEqual(filterLocalRecords(rows, '{创建人} LIKE "%王五%"'), []);
});

test('local TQL evaluator passes through expressions it cannot parse', () => {
  assert.deepEqual(filterLocalRecords(rows, ''), rows);
  assert.deepEqual(filterLocalRecords(rows, '自由文本条件'), rows);
});
