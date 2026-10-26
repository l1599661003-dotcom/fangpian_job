import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadCache, invalidateReadTables } from '../dist/platform/read-cache.js';

process.env.STUDIO_PLATFORM_URL = 'https://cache-test.example.test';
const { teable } = await import('../dist/platform/teable.js');

test('read cache coalesces pending requests, starts TTL after completion and isolates consumer mutations', async () => {
  let time = 0, reads = 0, release;
  const cache = new ReadCache(3, () => time);
  const loader = () => { reads++; return new Promise(resolve => { release = resolve; }); };
  const first = cache.get('page', 100, ['talents'], loader);
  await Promise.resolve();
  time = 1000;
  const concurrent = cache.get('page', 100, ['talents'], loader);
  assert.equal(reads, 1);
  release({ items: [{ name: 'original' }] });
  const [left, right] = await Promise.all([first, concurrent]);
  left.items[0].name = 'changed';
  assert.equal(right.items[0].name, 'original');
  time = 1099;
  assert.equal((await cache.get('page', 100, ['talents'], loader)).items[0].name, 'original');
  time = 1101;
  assert.equal(await cache.get('page', 100, ['talents'], async () => 'new'), 'new');
});

test('failed loaders can be retried and an obsolete failure cannot delete a newer entry', async () => {
  const cache = new ReadCache();
  let rejectOld;
  const old = cache.get('page', 1000, ['failures'], () => new Promise((resolve, reject) => { rejectOld = reject; }));
  const rejected = assert.rejects(old, /old failure/);
  await Promise.resolve();
  invalidateReadTables('failures');
  assert.equal(await cache.get('page', 1000, ['failures'], async () => 'fresh'), 'fresh');
  rejectOld(new Error('old failure'));
  await rejected;
  assert.equal(await cache.get('page', 1000, ['failures'], async () => 'unexpected'), 'fresh');
  await assert.rejects(cache.get('error', 1000, [], async () => { throw new Error('retry'); }), /retry/);
  assert.equal(await cache.get('error', 1000, [], async () => 'recovered'), 'recovered');
});

test('a write during a read cannot repopulate the cache with the old result', async () => {
  const cache = new ReadCache();
  let release;
  const loading = cache.get('page', 1000, ['race'], () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  invalidateReadTables('race');
  release('old');
  assert.equal(await loading, 'old');
  assert.equal(await cache.get('page', 1000, ['race'], async () => 'new'), 'new');
  invalidateReadTables('unrelated-audit-log');
  assert.equal(await cache.get('page', 1000, ['race'], async () => 'unexpected'), 'new');
});

test('read cache bounds entries and isolates query keys', async () => {
  const cache = new ReadCache(2);
  await cache.get('alice:first', 1000, [], async () => 'alice');
  await cache.get('bob:first', 1000, [], async () => 'bob');
  assert.equal(await cache.get('alice:first', 1000, [], async () => 'unexpected'), 'alice');
  await cache.get('alice:second', 1000, [], async () => 'second');
  assert.equal(await cache.get('bob:first', 1000, [], async () => 'reloaded'), 'reloaded');
  cache.clear();
  assert.equal(await cache.get('bob:first', 1000, [], async () => 'cleared'), 'cleared');
});

test('Teable create, bulk create, update, delete and schema writes invalidate dependent read caches', async () => {
  const original = global.fetch;
  const cache = new ReadCache();
  let value = 0;
  const read = () => cache.get('page', 60000, ['mutation-table'], async () => value);
  global.fetch = async () => new Response(JSON.stringify({ records: [{ id: 'record', fields: {} }] }));
  try {
    const writes = [
      () => teable.createRecord('mutation-table', {}),
      () => teable.createRecords('mutation-table', [{}]),
      () => teable.updateRecord('mutation-table', 'record', {}),
      () => teable.deleteRecord('mutation-table', 'record'),
      () => teable.updateField('mutation-table', 'field', { name: 'renamed' }),
    ];
    for (const write of writes) {
      assert.equal(await read(), value);
      value++;
      await write();
      assert.equal(await read(), value);
    }
    global.fetch = async () => new Response('uncertain write', { status: 502 });
    value++;
    await assert.rejects(teable.updateRecord('mutation-table', 'record', {}), /502/);
    assert.equal(await read(), value);
  } finally { global.fetch = original; }
});

test('a read started while a write is pending is invalidated again when the write completes', async () => {
  const original = global.fetch;
  const cache = new ReadCache();
  let finish;
  global.fetch = () => new Promise(resolve => { finish = resolve; });
  try {
    const writing = teable.updateRecord('pending-write', 'record', {});
    assert.equal(await cache.get('page', 60000, ['pending-write'], async () => 'before commit'), 'before commit');
    finish(new Response('{}'));
    await writing;
    assert.equal(await cache.get('page', 60000, ['pending-write'], async () => 'after commit'), 'after commit');
  } finally { global.fetch = original; }
});
