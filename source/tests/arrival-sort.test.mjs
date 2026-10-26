import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('overview arrival sorting uses selected date, places blanks last and retains default ties', async () => {
  const source = await readFile(new URL('../source-app/vue/overview.js', import.meta.url), 'utf8');
  const start = source.indexOf('function compareArrival(');
  const end = source.indexOf('const OverviewPage = {', start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function text(value)'), source.indexOf('function fallbackEscape(')) + source.slice(start, end), context);
  const rows = [{ id: 'none' }, { id: 'first', expectedArrivalDate: '2026-10-01', latestArrivalDate: '2026-10-20' }, { id: 'second', expectedArrivalDate: '2026-10-05', latestArrivalDate: '2026-10-10' }];
  const sorted = field => [...rows].sort((left, right) => context.compareArrival(left, right, field)).map(row => row.id);
  assert.deepEqual(sorted('expectedArrivalDate'), ['first', 'second', 'none']);
  assert.deepEqual(sorted('latestArrivalDate'), ['second', 'first', 'none']);
  assert.deepEqual(sorted('priority'), ['none', 'first', 'second']);
  assert.match(source, /data-overview-export-xlsx[\s\S]*onClick=\{exportHiring\}/);
});
