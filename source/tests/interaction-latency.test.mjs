import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { wecom } from '../dist/platform/mcp.js';
import { tianjiWeixinMessage } from '../dist/platform/tianji-weixin-message.js';
import { jobs } from '../dist/platform/jobs.js';
import { TalentsService } from '../dist/modules/talents/talents.service.js';
import { InterviewsService } from '../dist/modules/interviews/interviews.service.js';
import { InterviewsController } from '../dist/modules/interviews/interviews.controller.js';

const database = { requireTableId: name => name };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('text timestamps use paginated reads and local overlap checks without unsupported Teable comparisons', async () => {
  const original = teable.listRecords;
  const start = new Date('2026-10-01T02:00:00Z'), end = new Date('2026-10-01T03:00:00Z');
  const row = (id, begins, ends) => ({ id, fields: { 面试ID: id, 开始时间: begins, 结束时间: ends } });
  const records = Array.from({ length: 500 }, (_, index) => row('past_' + index, '2026-09-01T02:00:00Z', '2026-09-01T03:00:00Z'));
  records.push(
    row('overlap', '2026-10-01T10:30:00+08:00', '2026-10-01T11:30:00+08:00'),
    row('ends_at_start', '2026-10-01T01:00:00Z', start.toISOString()),
    row('starts_at_end', end.toISOString(), '2026-10-01T04:00:00Z'),
    row('invalid', '', ''),
  );
  const calls = [];
  try {
    teable.listRecords = async (table, options) => {
      assert.equal(table, 'recruitment_interviews');
      if (options.filterByTql) throw new Error("Teable 400: text timestamp fields do not support comparison operators");
      calls.push(options.skip || 0);
      return records.slice(options.skip || 0, (options.skip || 0) + options.take);
    };
    const service = new InterviewsService(database, {}, {});
    assert.deepEqual((await service.interviewsInRange(start, end)).map(item => item.id), ['overlap']);
    assert.deepEqual(calls, [0, 500, 504]);
    records.push(row('new_booking', start.toISOString(), end.toISOString()));
    assert.deepEqual((await service.interviewsInRange(start, end)).map(item => item.id), ['overlap', 'new_booking']);
  } finally {
    teable.listRecords = original;
  }
});

test('talent detail starts related reads before the candidate query completes', async () => {
  const originals = { listByField: teable.listByField, listAllRecords: teable.listAllRecords };
  const candidate = deferred(), started = [];
  try {
    teable.listByField = async name => {
      started.push(name);
      return name === 'recruitment_candidates' ? candidate.promise : [];
    };
    teable.listAllRecords = async name => { started.push(name); return []; };
    const service = new TalentsService(database, {}, {});
    const result = service.loadAll('tal_test');
    assert.ok(started.includes('recruitment_ai_assessments'));
    assert.ok(started.includes('recruitment_talent_review_responses'));
    candidate.resolve([{ id: 'record_test', fields: { 候选人ID: 'tal_test' } }]);
    assert.equal((await result).candidates.length, 1);
  } finally {
    candidate.resolve([]);
    Object.assign(teable, originals);
  }
});

test('background interview creation returns immediately and deduplicates retries', async () => {
  const completion = deferred();
  let calls = 0;
  const controller = new InterviewsController({
    createAppointment: async (input, progress) => {
      calls += 1;
      progress('正在创建企业微信日程');
      return completion.promise;
    },
  });
  const body = { candidateId: 'tal_test', startAt: '2026-10-01T02:00:00Z' };
  const first = controller.create(body, 'true', 'request_background_001');
  const second = controller.create(body, 'true', 'request_background_001');
  assert.equal(first.jobId, second.jobId);
  assert.equal(calls, 1);
  assert.equal(jobs.get(first.jobId).status, 'running');
  assert.equal(jobs.get(first.jobId).progress, '正在创建企业微信日程');
  assert.throws(() => controller.create({ ...body, candidateId: 'tal_test', startAt: 'changed' }, 'true', 'request_background_001'), /不要重复创建/);
  assert.throws(() => controller.create(body, 'true', ''), /提交标识/);
  completion.resolve({ interviewId: 'interview_test' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.get(first.jobId).data.interviewId, 'interview_test');
  assert.equal(jobs.get(first.jobId).status, 'done');
});

test('legacy appointment caller keeps its synchronous result contract', async () => {
  const expected = { interviewId: 'legacy_test' };
  const controller = new InterviewsController({ createAppointment: async () => expected });
  assert.equal(await controller.create({}), expected);
});

test('background room lookup returns a job without waiting for Tianji', async () => {
  const completion = deferred();
  const controller = new InterviewsController({ roomAvailability: () => completion.promise });
  const started = controller.roomAvailability({}, 'true');
  assert.equal(jobs.get(started.jobId).status, 'running');
  completion.resolve({ source: '企微实时', rooms: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.get(started.jobId).data.source, '企微实时');
});

test('selected room verification does not query every unrelated room by name', async () => {
  const originalRecords = teable.listAllRecords, originalCli = wecom.cli, originalFreeMeetingRooms = tianjiWeixinMessage.freeMeetingRooms;
  const calls = [], cliCalls = [];
  try {
    teable.listAllRecords = async name => name === 'recruitment_meeting_rooms'
      ? ['selected', 'unrelated'].map(name => ({ id: name, fields: { 会议室ID: name, 会议室名称: name, 外部资源ID: 'external_' + name } })) : [];
    wecom.cli = async argv => {
      cliCalls.push(argv);
      return { recommendations: [] };
    };
    tianjiWeixinMessage.freeMeetingRooms = async (startTime, endTime) => {
      calls.push({ startTime, endTime });
      return { start_time: startTime, end_time: endTime, free_count: 2, busy_count: 0, free: [
        { meetingroom_id: 'external_selected', name: 'selected', need_approval: 0 },
        { meetingroom_id: 'external_unrelated', name: 'unrelated', need_approval: 0 },
      ], busy: [] };
    };
    const service = new InterviewsService(database, {}, {});
    const start = Date.now() + 86400000;
    const result = await service.roomAvailability({ startAt: new Date(start).toISOString(), endAt: new Date(start + 3600000).toISOString(), roomIds: ['selected'] });
    assert.equal(result.rooms.length, 1);
    assert.equal(result.rooms[0].reservable, true);
    assert.equal(calls.length, 1);
    assert.equal(cliCalls.length, 0);
  } finally {
    teable.listAllRecords = originalRecords;
    wecom.cli = originalCli;
    tianjiWeixinMessage.freeMeetingRooms = originalFreeMeetingRooms;
  }
});
