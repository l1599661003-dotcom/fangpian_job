import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../source-app/task-schedule.js', import.meta.url), 'utf8'), context);
const { parse, compile } = context.taskSchedule;

test('visual schedules preserve daily weekly monthly and aligned interval cron semantics', () => {
  for (const cron of ['15 18 * * *', '0 9 * * 1,3,5', '30 20 31 * *', '*/15 * * * *', '0 */4 * * *']) assert.equal(compile(parse(cron)).cron, cron);
  assert.equal(compile(parse('0 15 18 * * *')).cron, '15 18 * * *');
  assert.equal(compile(parse('0 9 * * 7')).cron, '0 9 * * 0');
  assert.equal(compile(parse('0 9 * * 1,2,3,4,5')).schedule, '每周一、二、三、四、五 09:00');
});

test('complex schedules are never silently simplified and missing values block saving', () => {
  for (const cron of ['0 9 * * 1-5', '*/7 * * * *', '15 */3 * * *', '20 0 9 * * 1', '0 9 1 2 *']) {
    assert.equal(parse(cron).mode, 'advanced');
    assert.equal(compile(parse(cron)).cron, cron);
  }
  assert.throws(() => compile({ ...parse('0 9 * * 1'), days: [] }), /至少/);
  assert.throws(() => compile({ ...parse('0 9 * * *'), time: '' }), /时间/);
  assert.throws(() => compile({ mode: 'monthly', time: '09:00', date: 32 }), /日期/);
  assert.throws(() => compile({ mode: 'interval', unit: 'hour', every: 5 }), /间隔/);
});
