import test from 'node:test';
import assert from 'node:assert/strict';

process.env.STUDIO_PLATFORM_URL = 'https://platform.example.test';
const { teable } = await import('../dist/platform/teable.js');

test('row count uses the verified aggregate tool and rejects invalid totals', async () => {
  const original = global.fetch;
  const calls = [];
  try {
    for (const payload of [{ row_count: 1176 }, { content: [{ type: 'text', text: '{"row_count":0}' }] }, { text: '{"row_count":5}' }]) {
      global.fetch = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ data: payload }));
      };
      assert.ok(Number.isInteger(await teable.countRecords('candidate-table')));
    }
    assert.deepEqual(calls[0].body, { tool: 'teable_get_table_row_count', args: { table_id: 'candidate-table' } });
    assert.equal(calls[0].url, 'https://platform.example.test/mcp/call');
    for (const payload of [{}, { row_count: -1 }, { row_count: '1176' }, { isError: true }, { text: '{"row_count":0,"error":"denied"}' }]) {
      global.fetch = async () => new Response(JSON.stringify({ data: payload }));
      await assert.rejects(teable.countRecords('candidate-table'));
    }
  } finally { global.fetch = original; }
});

test('projected reads use the registered MCP contract and preserve filters and sorting', async () => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ data: { content: [{ type: 'text', text: JSON.stringify({ records: [{ id: 'record', fields: { 候选人ID: 'candidate' } }] }) }] } }));
  };
  try {
    const result = await teable.listRecordsPage('table', { take: 25, skip: 25, fields: ['候选人ID'], filterByTql: '{姓名} = "测试"', orderBy: [{ field: '创建时间', order: 'desc' }] });
    assert.equal(calls[0].url, 'https://platform.example.test/mcp/call');
    assert.deepEqual(calls[0].body, { tool: 'teable_list_records', args: { table_id: 'table', take: 25, skip: 25, fields: ['候选人ID'], filter: '{姓名} = "测试"', sort: '[{"field":"创建时间","order":"desc"}]' } });
    assert.equal(result.records[0].fields['候选人ID'], 'candidate');
    assert.equal(result.totalIsExact, false);
  } finally { global.fetch = original; }
});

test('projected reads automatically split large field sets and merge the result', async () => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    const { args } = JSON.parse(options.body);
    calls.push(args);
    const records = [{ id: 'record', fields: Object.fromEntries(args.fields.map(field => [field, field])) }];
    return new Response(JSON.stringify({ data: { records } }));
  };
  try {
    const fields = Array.from({ length: 45 }, (_, index) => `field_${index}`);
    const result = await teable.listRecordsPage('table', { take: 25, skip: 0, fields });
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.fields.length <= 21));
    assert.equal(result.records.length, 1);
    assert.deepEqual(Object.keys(result.records[0].fields).sort(), fields.sort());
  } finally { global.fetch = original; }
});

test('projection survives capped pagination and the end-of-page probe', async () => {
  const original = global.fetch;
  const rows = Array.from({ length: 125 }, (_, index) => ({ id: `record_${index}`, fields: { 候选人ID: `candidate_${index}` } }));
  const calls = [];
  global.fetch = async (url, options) => {
    const { args } = JSON.parse(options.body);
    calls.push(args);
    const records = rows.slice(args.skip, args.skip + Math.min(100, args.take));
    return new Response(JSON.stringify({ data: { text: JSON.stringify({ records }) } }));
  };
  try {
    const result = await teable.listAllRecords('table', { fields: ['候选人ID'], filterByTql: '{来源类型} = "上传"' });
    assert.equal(result.length, 125);
    assert.equal(new Set(result.map(row => row.id)).size, 125);
    assert.ok(calls.every(args => args.fields.join(',') === '候选人ID' && args.filter === '{来源类型} = "上传"'));
  } finally { global.fetch = original; }
});

test('projection failures are never treated as empty data', async () => {
  const original = global.fetch;
  try {
    for (const payload of [{ isError: true, content: [{ type: 'text', text: 'permission denied' }] }, { text: '{"error":"invalid filter"}' }, { records: null }]) {
      global.fetch = async () => new Response(JSON.stringify({ data: payload }));
      await assert.rejects(() => teable.listRecords('table', { fields: ['候选人ID'] }));
    }
  } finally { global.fetch = original; }
});

test('1000 rows behind a 100-row proxy cap require at most 12 requests', async () => {
  const original = global.fetch;
  const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `row_${index}`, fields: {} }));
  let calls = 0;
  global.fetch = async (url, options) => {
    const { args } = JSON.parse(options.body);
    calls++;
    return new Response(JSON.stringify({ data: { records: rows.slice(args.skip, args.skip + Math.min(100, args.take)) } }));
  };
  try {
    const result = await teable.listAllRecords('table', { fields: ['候选人ID'] });
    assert.equal(result.length, 1000);
    assert.equal(new Set(result.map(record => record.id)).size, 1000);
    assert.ok(calls <= 12, `unexpected request count: ${calls}`);
  } finally { global.fetch = original; }
});

test('batched relation lookup escapes values, deduplicates IDs and never caps returned records', async () => {
  const original = teable.listAllRecords;
  const calls = [];
  teable.listAllRecords = async (table, options) => {
    calls.push(options);
    return Array.from({ length: 1200 }, (_, index) => ({ id: `row_${index}`, fields: {} }));
  };
  try {
    const ids = ['quote"value', ...Array.from({ length: 60 }, (_, index) => `candidate_${index}`)];
    const result = await teable.listAllByAnyField('table', '候选人ID', [...ids, ...ids, ''], ['姓名']);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].filterByTql.includes('quote\\"value'));
    assert.deepEqual(calls[0].fields, ['姓名']);
    assert.equal(result.length, 1200);
    assert.deepEqual(await teable.listAllByAnyField('table', '候选人ID', []), []);
    assert.equal(calls.length, 2);
  } finally { teable.listAllRecords = original; }
});
