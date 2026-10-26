import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { assertWecomCliSuccess, wecom } from '../dist/platform/mcp.js';
import { tianji } from '../dist/platform/tianji.js';
import { im } from '../dist/platform/im.js';
import { bookTianjiMeetingRoom, queryTianjiFreeMeetingRooms, sendTianjiWeixinUserMessage, tianjiWeixinMessage } from '../dist/platform/tianji-weixin-message.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { MessagesService } from '../dist/modules/messages/messages.service.js';
import { InterviewsService } from '../dist/modules/interviews/interviews.service.js';

function installMemory() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const originals = {}, methods = ['listRecords', 'listAllRecords', 'listByField', 'findOneByField', 'getRecord', 'createRecord', 'updateRecord', 'deleteRecord'];
  for (const method of methods) originals[method] = teable[method];
  let sequence = 0;
  teable.listRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.listAllRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.listByField = async (tableId, fieldName, value, take = 200) => (records.get(tableId) || []).filter((row) => String(row.fields[fieldName] ?? '') === String(value ?? '')).slice(0, take);
  teable.findOneByField = async (tableId, fieldName, value) => (records.get(tableId) || []).find((row) => String(row.fields[fieldName] ?? '') === String(value ?? ''));
  teable.getRecord = async (tableId, recordId) => (records.get(tableId) || []).find((row) => row.id === recordId);
  teable.createRecord = async (tableId, fields) => { const row = { id: `${tableId}_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() }; records.get(tableId).push(row); return row; };
  teable.updateRecord = async (tableId, recordId, fields) => { const row = records.get(tableId).find((item) => item.id === recordId); if (!row) throw new Error(`record missing ${tableId}/${recordId}`); row.fields = { ...row.fields, ...fields }; return row; };
  teable.deleteRecord = async (tableId, recordId) => {
    const rows = records.get(tableId) || [], index = rows.findIndex((item) => item.id === recordId);
    if (index >= 0) rows.splice(index, 1);
  };
  return { records, restore: () => Object.assign(teable, originals) };
}

test('Tianji room query feeds interview scheduling and Tianji owns schedule and mail delivery', async () => {
  const memory = installMemory(), originalFreeMeetingRooms = tianjiWeixinMessage.freeMeetingRooms;
  const originalTianji = {
    bookMeetingRoom: tianjiWeixinMessage.bookMeetingRoom,
    createSchedule: tianjiWeixinMessage.createSchedule,
    cancelSchedule: tianjiWeixinMessage.cancelSchedule,
    sendMail: tianjiWeixinMessage.sendMail,
  };
  const bookings = [], schedules = [], cancellations = [], mails = [], reads = [], roomQueries = [];
  const originalRead = teable.listAllRecords;
  try {
    teable.listAllRecords = async (...args) => { reads.push(args[0]); return originalRead(...args); };
    tianjiWeixinMessage.bookMeetingRoom = async input => { bookings.push(input); return { bookingId: `tianji_booking_${bookings.length}`, scheduleId: `tianji_room_schedule_${bookings.length}`, response: { errcode: 0 } }; };
    tianjiWeixinMessage.createSchedule = async input => { schedules.push(input); return { scheduleId: `tianji_schedule_${schedules.length}`, response: { errcode: 0 } }; };
    tianjiWeixinMessage.cancelSchedule = async scheduleId => { cancellations.push(scheduleId); return { scheduleId, response: { errcode: 0 } }; };
    tianjiWeixinMessage.sendMail = async input => { mails.push(input); return { messageId: `tianji_mail_${mails.length}`, response: { errcode: 0 } }; };
    tianjiWeixinMessage.freeMeetingRooms = async (startTime, endTime) => {
      roomQueries.push({ startTime, endTime });
      return {
        start_time: startTime, end_time: endTime, free_count: 1, busy_count: 1,
        free: [{ meetingroom_id: 'external_direct', name: '天玑查询会议室', capacity: 6, need_approval: 0 }],
        busy: [{ meetingroom_id: 'external_busy', name: '已占用会议室', need_approval: 0, conflicts: [{ start_time: Math.floor(start.getTime() / 1000), end_time: Math.floor(end.getTime() / 1000) }] }],
      };
    };
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_direct', 姓名: '测试候选人', 邮箱: 'test@example.invalid' });
    await teable.createRecord('recruitment_users', { 用户ID: 'hr_1', 姓名: '测试组织者', 企业微信用户ID: 'wecom_hr_1', 用户状态: '启用' });
    const service = new InterviewsService({ requireTableId: name => name }, {}, {
      queueInterviewQuestionGeneration: () => ({ jobId: 'job_questions_direct', status: 'running' }),
    });
    let directoryReads = 0;
    service.listInterviewers = async () => {
      directoryReads += 1;
      return { interviewers: [{ id: 'employee_direct', name: '测试面试官', wecomUserId: 'wecom_direct' }] };
    };
    const start = new Date(Date.now() + 86400000);
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const result = await service.roomAvailability({ source: 'wecom', startAt: start.toISOString(), endAt: end.toISOString() });
    assert.deepEqual(reads, []);
    assert.equal(roomQueries.length, 1);
    assert.equal(roomQueries[0].startTime, Math.floor(start.getTime() / 1000) - 86400);
    assert.equal(roomQueries[0].endTime, Math.floor(end.getTime() / 1000) + 86400);
    assert.equal(result.rooms[0].id, 'external_direct');
    const payload = { candidateId: 'tal_direct', round: '一面', mode: '线下面试', startAt: start.toISOString(), endAt: end.toISOString(), interviewerIds: ['employee_direct'], interviewerWecomIds: ['wecom_direct'], meetingRoomId: 'external_direct', meetingRoomSelectionId: result.selectionId, organizerUserId: 'hr_1', publicUrl: 'https://example.invalid' };
    await assert.rejects(() => service.createAppointment({ ...payload, meetingRoomId: 'external_busy' }), /已占用/);
    const appointment = await service.createAppointment(payload);
    assert.equal(appointment.sync.status, '已同步');
    assert.equal(appointment.email.status, '已发送');
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_direct_no_email', 姓名: '无邮箱候选人' });
    const skippedEmailStart = new Date(Date.now() + 2 * 86400000), skippedEmailEnd = new Date(skippedEmailStart.getTime() + 3600000);
    const skippedEmail = await service.createAppointment({ candidateId: 'tal_direct_no_email', round: '一面', mode: '线下面试', startAt: skippedEmailStart.toISOString(), endAt: skippedEmailEnd.toISOString(), meetingUrl: 'https://meeting.example.test/no-email', interviewerIds: ['employee_direct'], interviewerWecomIds: ['wecom_direct'], sendCandidateEmail: false, publicUrl: 'https://example.invalid' });
    assert.equal(skippedEmail.sync.status, '已同步');
    assert.equal(skippedEmail.email.status, '未发送');
    assert.equal(skippedEmail.email.message, '已按设置跳过候选人邮件');
    assert.equal(directoryReads, 3);
    assert.ok(!reads.includes('recruitment_interviewer_pool'));
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].meetingRoomId, 'external_direct');
    assert.equal(bookings[0].booker, 'wecom_hr_1');
    assert.deepEqual(bookings[0].attendees, ['wecom_direct', 'wecom_hr_1']);
    assert.equal(bookings[0].startTime, Math.floor(start.getTime() / 1000));
    assert.equal(bookings[0].endTime, Math.floor(end.getTime() / 1000));
    assert.equal(schedules.length, 1);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].toEmails[0], 'test@example.invalid');
    assert.equal(mails[0].contentType, 'html');
    assert.ok(roomQueries.length >= 2, 'appointment creation should recheck the selected room through Tianji');
    const storedRoom = memory.records.get('recruitment_meeting_rooms')[0];
    const storedInterview = memory.records.get('recruitment_interviews')[0];
    assert.equal(storedRoom.fields['会议室名称'], '天玑查询会议室');
    assert.equal(storedInterview.fields['会议室ID'], storedRoom.fields['会议室ID']);
    const recoveredAppointment = await service.createAppointment(payload);
    assert.equal(recoveredAppointment.reused, true);
    assert.equal(recoveredAppointment.interviewId, appointment.interviewId);
    assert.equal(memory.records.get('recruitment_meeting_rooms').length, 1);
    await service.retrySync(appointment.interviewId);
    assert.equal(bookings.length, 1, 'a retry must reuse the confirmed room booking instead of booking twice');
    assert.deepEqual(cancellations, []);
    await service.cancelAppointment(appointment.interviewId, { reason: '测试取消' });
    assert.deepEqual(cancellations, ['tianji_room_schedule_1']);
    await assert.rejects(() => service.createAppointment({ ...payload, interviewerWecomIds: ['forged'] }), /企微 ID 与所选员工不一致/);
    await assert.rejects(() => service.createAppointment({ ...payload, meetingRoomId: 'forged_room' }), /重新查询会议室/);
    await assert.rejects(() => service.createAppointment({ ...payload, endAt: new Date(end.getTime() + 30 * 60000).toISOString() }), /重新查询会议室/);
    service.roomSelections.get(result.selectionId).expiresAt = 0;
    await assert.rejects(() => service.createAppointment(payload), /重新查询会议室/);
    assert.equal(schedules.length, 1);
  } finally {
    tianjiWeixinMessage.freeMeetingRooms = originalFreeMeetingRooms;
    Object.assign(tianjiWeixinMessage, originalTianji);
    memory.restore();
  }
});

test('online interviews keep the exact selected time instead of half-hour rounding', async () => {
  const memory = installMemory();
  const originalSchedule = tianjiWeixinMessage.createSchedule;
  const originalBooking = tianjiWeixinMessage.bookMeetingRoom, originalCreateMeeting = tianjiWeixinMessage.createMeeting, originalCancelMeeting = tianjiWeixinMessage.cancelMeeting;
  const schedules = [], bookings = [], meetings = [];
  try {
    tianjiWeixinMessage.createMeeting = async input => { meetings.push(input); return { meetingId: 'meeting_exact', meetingLink: 'https://work.weixin.qq.com/webapp/tm/exact', response: { errcode: 0 } }; };
    tianjiWeixinMessage.createSchedule = async input => { schedules.push(input); return { scheduleId: 'schedule_exact', response: { errcode: 0 } }; };
    tianjiWeixinMessage.bookMeetingRoom = async input => { bookings.push(input); return { bookingId: 'booking_exact', scheduleId: 'schedule_exact', response: { errcode: 0 } }; };
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_exact_time', 姓名: '精确时间候选人' });
    await teable.createRecord('recruitment_users', { 用户ID: 'hr_exact', 姓名: '测试组织者', 企业微信用户ID: 'wecom_hr_exact', 用户状态: '启用' });
    const service = new InterviewsService({ requireTableId: name => name }, {}, { queueInterviewQuestionGeneration: () => ({ status: 'running' }) });
    service.listInterviewers = async () => ({ interviewers: [{ id: 'employee_exact', name: '测试面试官', wecomUserId: 'wecom_exact' }] });
    const start = new Date(Date.now() + 86400000);
    start.setMinutes(40, 0, 0);
    const end = new Date(start.getTime() + 20 * 60000);
    const appointment = await service.createAppointment({
      candidateId: 'tal_exact_time', round: '一面', mode: '线上面试',
      startAt: start.toISOString(), endAt: end.toISOString(),
      interviewerIds: ['employee_exact'], interviewerWecomIds: ['wecom_exact'],
      sendCandidateEmail: false, publicUrl: 'https://example.invalid',
    });
    assert.equal(appointment.sync.status, '已同步');
    assert.equal(memory.records.get('recruitment_interviews')[0].fields['开始时间'], start.toISOString());
    assert.equal(memory.records.get('recruitment_interviews')[0].fields['结束时间'], end.toISOString());
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].startTime, Math.floor(start.getTime() / 1000));
    assert.equal(schedules[0].endTime, Math.floor(end.getTime() / 1000));
    assert.equal(bookings.length, 0);
    assert.equal(meetings.length, 1);
    assert.equal(meetings[0].startTime, Math.floor(start.getTime() / 1000));
    assert.equal(meetings[0].endTime, Math.floor(end.getTime() / 1000));
    assert.deepEqual(meetings[0].invitees, ['wecom_exact']);
    assert.equal(memory.records.get('recruitment_interviews')[0].fields['会议地址'], 'https://work.weixin.qq.com/webapp/tm/exact');
    assert.equal(JSON.parse(memory.records.get('recruitment_interviews')[0].fields['外部会议信息JSON']).meetingId, 'meeting_exact');
  } finally {
    tianjiWeixinMessage.createSchedule = originalSchedule;
    tianjiWeixinMessage.bookMeetingRoom = originalBooking;
    tianjiWeixinMessage.createMeeting = originalCreateMeeting;
    tianjiWeixinMessage.cancelMeeting = originalCancelMeeting;
    memory.restore();
  }
});

test('interviewer selection accepts the shared WeCom and Tianji direct-message ID', async () => {
  const memory = installMemory();
  try {
    await teable.createRecord('recruitment_users', { 用户ID: 'user_tianji', 姓名: '天玑面试官', 天玑微信ID: 'tianji_user', 企业微信用户ID: 'tianji_user', 用户状态: '启用' });
    await teable.createRecord('recruitment_user_roles', { 用户角色ID: 'role_tianji', 用户ID: 'user_tianji', 用户姓名: '天玑面试官', 角色编码: 'interviewer', 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z' });
    const service = new InterviewsService({ requireTableId: name => name }, {}, {});
    const result = await service.listInterviewers();
    assert.equal(result.interviewers.length, 1);
    assert.equal(result.interviewers[0].wecomUserId, 'tianji_user');
  } finally {
    memory.restore();
  }
});

test('Tianji room search includes free and occupied rooms and checks actual interval overlap', async () => {
  const originalFreeMeetingRooms = tianjiWeixinMessage.freeMeetingRooms;
  const service = new InterviewsService({ requireTableId: () => { throw new Error('room search must not access Teable'); } }, {}, {});
  const start = new Date(Date.now() + 86400000);
  start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  const query = { source: 'wecom', roomKeyword: 'F', startAt: start.toISOString(), endAt: end.toISOString() };
  const calls = [];
  try {
    tianjiWeixinMessage.freeMeetingRooms = async (startTime, endTime) => {
      calls.push({ startTime, endTime });
      const startSeconds = Math.floor(start.getTime() / 1000), endSeconds = Math.floor(end.getTime() / 1000);
      return {
        start_time: startTime, end_time: endTime, free_count: 3, busy_count: 2,
        free: [
          { meetingroom_id: 'free', name: 'F空闲会议室', need_approval: 0 },
          { meetingroom_id: 'free_but_conflicted', name: 'F错误标为空闲', need_approval: 0, conflicts: [{ start_time: startSeconds + 600, end_time: startSeconds + 1200 }] },
          { meetingroom_id: 'approval_required', name: 'F需要审批会议室', need_approval: 1 },
        ],
        busy: [
          { meetingroom_id: 'busy_overlap', name: 'F当前占用', need_approval: 0, conflicts: [{ start_time: startSeconds + 600, end_time: startSeconds + 1200 }] },
          { meetingroom_id: 'busy_outside', name: 'F其他时段占用', need_approval: 0, conflicts: [{ start_time: endSeconds + 600, end_time: endSeconds + 1200 }] },
          { meetingroom_id: 'busy_unknown', name: 'F状态未知', need_approval: 0, conflicts: [] },
        ],
      };
    };
    const result = await service.roomAvailability(query);
    assert.equal(calls.length, 1);
    const roundedStart = Math.floor(start.getTime() / 1800000) * 1800000;
    const roundedEnd = Math.ceil(end.getTime() / 1800000) * 1800000;
    assert.equal(calls[0].startTime, Math.floor(roundedStart / 1000) - 86400);
    assert.equal(calls[0].endTime, Math.floor(roundedEnd / 1000) + 86400);
    assert.deepEqual(result.rooms.map(room => room.id), ['free', 'free_but_conflicted', 'approval_required', 'busy_overlap', 'busy_outside', 'busy_unknown']);
    assert.equal(result.rooms.find(room => room.id === 'free').reservable, true);
    assert.equal(result.rooms.find(room => room.id === 'free_but_conflicted').reservable, false);
    assert.equal(result.rooms.find(room => room.id === 'approval_required').status, '需审批');
    assert.equal(result.rooms.find(room => room.id === 'approval_required').reservable, false);
    assert.equal(result.rooms.find(room => room.id === 'busy_overlap').reservable, false);
    assert.equal(result.rooms.find(room => room.id === 'busy_outside').reservable, true);
    assert.equal(result.rooms.find(room => room.id === 'busy_unknown').reservable, false);
    assert.match(result.message, /名称匹配“F”/);
    assert.equal(service.roomSelections.get(result.selectionId).rooms.length, 6);
  } finally { tianjiWeixinMessage.freeMeetingRooms = originalFreeMeetingRooms; }
});

test('Tianji room lookup surfaces API errors and preserves an empty result without local substitutes', async () => {
  const memory = installMemory(), originalFreeMeetingRooms = tianjiWeixinMessage.freeMeetingRooms;
  try {
    const service = new InterviewsService({ requireTableId: name => name }, {}, {});
    const start = new Date(Date.now() + 86400000), end = new Date(start.getTime() + 3600000);
    const query = { source: 'wecom', startAt: start.toISOString(), endAt: end.toISOString() };
    tianjiWeixinMessage.freeMeetingRooms = async () => { throw new Error('天玑查询暂不可用'); };
    await assert.rejects(() => service.roomAvailability(query), /天玑查询暂不可用/);
    tianjiWeixinMessage.freeMeetingRooms = async () => ({ start_time: 0, end_time: 0, free_count: 0, busy_count: 0, free: [], busy: [] });
    assert.deepEqual((await service.roomAvailability(query)).rooms, []);
  } finally { tianjiWeixinMessage.freeMeetingRooms = originalFreeMeetingRooms; memory.restore(); }
});

test('expired room authorization is distinguished from empty rooms and general connector failures', async () => {
  const memory = installMemory(), originalFreeMeetingRooms = tianjiWeixinMessage.freeMeetingRooms;
  try {
    const service = new InterviewsService({ requireTableId: name => name }, {}, {});
    const start = new Date(Date.now() + 86400000), end = new Date(start.getTime() + 3600000);
    const query = { startAt: start.toISOString(), endAt: end.toISOString() };
    tianjiWeixinMessage.freeMeetingRooms = async () => { throw new Error('天玑企微会议室授权已过期 (850003): authorization expired'); };
    await assert.rejects(() => service.roomAvailability({ ...query, source: 'wecom' }), /企微认证已过期.*高子云/);
    await assert.rejects(() => service.roomAvailability(query), /企微认证已过期/);
    tianjiWeixinMessage.freeMeetingRooms = async () => { throw new Error('网络超时'); };
    await assert.rejects(() => service.roomAvailability({ ...query, source: 'wecom' }), /网络超时/);
    tianjiWeixinMessage.freeMeetingRooms = async () => ({ start_time: 0, end_time: 0, free_count: 0, busy_count: 0, free: [], busy: [] });
    assert.deepEqual((await service.roomAvailability({ ...query, source: 'wecom' })).rooms, []);
  } finally { tianjiWeixinMessage.freeMeetingRooms = originalFreeMeetingRooms; memory.restore(); }
});

test('authorization help notifies only Gao through Tianji, deduplicates and retries actual failures', async () => {
  const memory = installMemory(), originalSend = tianjiWeixinMessage.send;
  try {
    const database = { requireTableId: name => name };
    await teable.createRecord('recruitment_users', { 用户ID: 'gao', 姓名: '高子云', 用户状态: '启用', 天玑微信ID: 'verified_gao_wechat' });
    await teable.createRecord('recruitment_users', { 用户ID: 'other', 姓名: '其他人', 用户状态: '启用', 天玑微信ID: 'other_wechat' });
    const messages = new MessagesService(database);
    const service = new InterviewsService(database, messages, {});
    let attempts = 0;
    tianjiWeixinMessage.send = async input => {
      attempts++;
      assert.equal(input.wechatId, 'verified_gao_wechat');
      assert.match(input.message, /企微验证或重新授权/);
      if (attempts === 1) throw new Error('天玑暂时不可用');
      return { message_id: 'tianji_notice_1' };
    };
    await assert.rejects(() => service.notifyWecomAuthorizationExpired('招聘人员', 'hr_1'), /天玑暂时不可用/);
    const results = await Promise.all([service.notifyWecomAuthorizationExpired('招聘人员', 'hr_1'), service.notifyWecomAuthorizationExpired('招聘人员2', 'hr_2')]);
    assert.equal(attempts, 2);
    assert.ok(results.every(result => result.status === '已发送'));
    const restartedService = new InterviewsService(database, messages, {});
    assert.equal((await restartedService.notifyWecomAuthorizationExpired('招聘人员', 'hr_1')).status, '已跳过');
    assert.equal(attempts, 2);
    assert.equal(memory.records.get('recruitment_message_send_events').filter(row => row.fields['事件类型'] === '发送成功').length, 1);
    memory.records.get('recruitment_users').push({ id: 'duplicate', fields: { 用户ID: 'gao_duplicate', 姓名: '高子云', 用户状态: '启用', 天玑微信ID: 'wrong_person' } });
    await assert.rejects(() => new InterviewsService(database, messages, {}).notifyWecomAuthorizationExpired('招聘人员', 'hr_1'), /唯一启用/);
    assert.equal(attempts, 2);
  } finally { tianjiWeixinMessage.send = originalSend; memory.restore(); }
});

test('WeCom messages, Tianji personal messages, owner notifications and meeting rooms keep confirmation, masking, retry and failure boundaries', async () => {
  const memory = installMemory(), originalFetch = global.fetch, originalWecom = wecom.cli, originalTianjiCall = tianji.call, originalTianjiSearchEmployees = tianji.searchEmployees, originalTianjiSend = tianjiWeixinMessage.send, originalTianjiRooms = tianjiWeixinMessage.freeMeetingRooms, originalNotifyOwner = im.notifyOwner;
  const groupKeyNames = ['WECOM_TALENT_GROUP_WEBHOOK_KEY', 'WECOM_TALENT_REVIEW_WEBHOOK_KEY'];
  const previousGroupKeys = Object.fromEntries(groupKeyNames.map(key => [key, process.env[key]]));
  const originalTianjiSchedule = { bookMeetingRoom: tianjiWeixinMessage.bookMeetingRoom, createSchedule: tianjiWeixinMessage.createSchedule, cancelSchedule: tianjiWeixinMessage.cancelSchedule, createMeeting: tianjiWeixinMessage.createMeeting, cancelMeeting: tianjiWeixinMessage.cancelMeeting, sendMail: tianjiWeixinMessage.sendMail };
  const scheduleStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  scheduleStart.setMinutes(0, 0, 0);
  const scheduleEnd = new Date(scheduleStart.getTime() + 60 * 60 * 1000);
  const longRangeEnd = new Date(scheduleStart.getTime() + 48 * 60 * 60 * 1000);
  const calls = [], groupWebhookPayloads = [], tianjiCalls = [], ownerCalls = [], tianjiBookings = [], tianjiScheduleCalls = [], tianjiCancellationCalls = [], tianjiMailCalls = [];
  let failNextMessage = true, failConnection = false, expiredConnection = false, failCalendarCreate = false, failRoomBooking = false, wecomRoomRejected = false, externalRoomBusy = false;
  let failNextGroupWebhook = true;
  try {
    process.env.WECOM_TALENT_GROUP_WEBHOOK_KEY = 'test-group-key';
    process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY = 'test-review-key';
    global.fetch = async (url, options) => {
      if (!String(url).includes('qyapi.weixin.qq.com/cgi-bin/webhook/send')) return originalFetch(url, options);
      groupWebhookPayloads.push(JSON.parse(options.body));
      const result = failNextGroupWebhook ? { errcode: 45009, errmsg: '企微临时限流' } : { errcode: 0, errmsg: 'ok', msgid: 'wecom_message_1' };
      failNextGroupWebhook = false;
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    tianji.call = async () => {
      if (failConnection) throw new Error('天玑企微接口连接失败');
      if (expiredConnection) throw new Error('天玑企微授权已过期（850003）');
      return { code: 200, data: { list: [] } };
    };
    tianji.searchEmployees = async () => [{ wechat_id: 'manager_a', employee_name: '陈经理', departments: [{ department_name: '产品部' }], positions: [{ position_name: '产品负责人' }] }];
    wecom.cli = async (argv) => {
      calls.push(argv);
      if (argv[0] === 'contact') {
        if (argv.includes('陈经理')) return { users: [{ userid: 'manager_a', name: '陈经理', departments: ['产品部'], position: '产品负责人' }] };
        if (failConnection) throw new Error('企业微信未绑定');
        if (expiredConnection) return { text: JSON.stringify({ errcode: 850003, errmsg: 'authorization expired', help_message: '请创建者重新授权企业微信通讯录。' }) };
        return { text: JSON.stringify({ errcode: 0, errmsg: 'ok', results_json: '[]' }) };
      }
      if (argv[0] === 'message') { if (failNextMessage) { failNextMessage = false; throw new Error('企微临时限流'); } return { message_id: 'wecom_message_1' }; }
      throw new Error(`unexpected wecom call ${argv.join(' ')}`);
    };
    tianjiWeixinMessage.send = async (input) => { tianjiCalls.push(input); return { message_id: 'tianji_message_1' }; };
    tianjiWeixinMessage.bookMeetingRoom = async input => { tianjiBookings.push(input); if (failRoomBooking) throw new Error(wecomRoomRejected ? '企微会议室预定失败 (100)：预定会议室失败：meetingroom not available, hint: [1]' : '天玑会议室预订失败：测试失败'); return { bookingId: `tianji_booking_${tianjiBookings.length}`, scheduleId: `tianji_booking_schedule_${tianjiBookings.length}`, response: { errcode: 0 } }; };
    tianjiWeixinMessage.createSchedule = async input => {
      tianjiScheduleCalls.push(input);
      if (failCalendarCreate) throw new Error('企微日程创建失败：天玑接口暂不可用');
      return { scheduleId: `tianji_create_${tianjiScheduleCalls.length}`, response: { errcode: 0 } };
    };
    tianjiWeixinMessage.cancelSchedule = async scheduleId => { tianjiCancellationCalls.push(scheduleId); return { scheduleId, response: { errcode: 0 } }; };
    tianjiWeixinMessage.createMeeting = async () => ({ meetingId: 'meeting_ops', meetingLink: 'https://work.weixin.qq.com/webapp/tm/ops', response: { errcode: 0 } });
    tianjiWeixinMessage.cancelMeeting = async meetingId => ({ meetingId, response: { errcode: 0 } });
    tianjiWeixinMessage.sendMail = async input => { tianjiMailCalls.push(input); return { messageId: `tianji_mail_${tianjiMailCalls.length}`, response: { errcode: 0 } }; };
    tianjiWeixinMessage.freeMeetingRooms = async (startTime, endTime) => {
      if (failConnection) throw new Error('天玑会议室接口连接失败');
      const roomA = { meetingroom_id: 'room_external_a', name: '杭州A301', capacity: 6, city: '杭州', building: '杭州总部', floor: '3F', need_approval: 0 };
      const roomB = { meetingroom_id: 'room_external_b', name: '杭州B302', capacity: 8, city: '杭州', building: '杭州总部', floor: '3F', need_approval: 0 };
      const conflicts = externalRoomBusy ? [{ start_time: Math.floor(scheduleStart.getTime() / 1000), end_time: Math.floor(scheduleEnd.getTime() / 1000), booker: '其他预约' }] : [];
      return {
        start_time: startTime, end_time: endTime,
        free_count: externalRoomBusy ? 1 : 2, busy_count: externalRoomBusy ? 1 : 0,
        free: externalRoomBusy ? [roomB] : [roomA, roomB],
        busy: externalRoomBusy ? [{ ...roomA, conflicts }] : [],
      };
    };
    im.notifyOwner = async (text, options) => { ownerCalls.push({ text, options }); return { message_id: 'owner_message_1', conversation_id: 'owner_conversation_1' }; };
    const create = teable.createRecord;
    await create('recruitment_candidates', { 候选人ID: 'tal_integration_a', 姓名: '林悦', 电话: '13800138001', 邮箱: 'linyue@example.com', 微信: 'linyue_pm', 候选人状态: '意向沟通', 合并状态: '独立档案', 创建时间: '2026-08-20T00:00:00.000Z', 更新时间: '2026-08-20T00:00:00.000Z' });
    await create('recruitment_candidates', { 候选人ID: 'tal_integration_b', 姓名: '陈晨', 电话: '13900139002', 邮箱: 'chenchen@example.com', 候选人状态: '意向沟通', 合并状态: '独立档案', 创建时间: '2026-08-20T00:00:00.000Z', 更新时间: '2026-08-20T00:00:00.000Z' });
    await create('recruitment_applications', { 应聘记录ID: 'app_integration_a', 候选人ID: 'tal_integration_a', 职位ID: 'pos_product', 当前阶段: '意向沟通', 当前状态: '进行中', 更新时间: '2026-08-25T00:00:00.000Z' });
    await create('recruitment_applications', { 应聘记录ID: 'app_integration_b', 候选人ID: 'tal_integration_b', 职位ID: 'pos_ops', 当前阶段: '意向沟通', 当前状态: '进行中', 更新时间: '2026-08-25T00:00:00.000Z' });
    await create('recruitment_positions', { 职位ID: 'pos_product', 职位名称: '产品经理', 招聘HR用户ID: 'hr_product', 招聘HR: '王HR', 发布状态: '招聘中' });
    await create('recruitment_users', { 用户ID: 'hr_product', 姓名: '王HR', 企业微信用户ID: 'wecom_hr_product', 用户状态: '启用' });
    const database = { requireTableId: (name) => name };

    const messages = new MessagesService(database);
    const connected = await messages.connection();
    assert.equal(connected.status, '已连接');
    expiredConnection = true;
    const expired = await messages.connection();
    assert.equal(expired.status, '连接失败');
    assert.match(expired.message, /850003/);
    assert.match(expired.action, /检查天玑企微接口配置/);
    expiredConnection = false;
    const preview = await messages.preview({ category: '优质简历', channel: '企业微信群', recipientType: '招聘群', recipientAddress: 'group_recruitment', candidateId: 'tal_integration_a', content: '候选人林悦 手机号：13800138001 邮箱linyue@example.com 微信号：linyue_pm\n基本月薪：26000元\n背调：前雇主评价良好\n内部评价：建议优先推进', operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(preview.sendStatus, '草稿');
    for (const field of ['手机号', '邮箱', '微信号', '薪酬信息', '背调信息', '内部评价']) assert.ok(preview.maskedFields.includes(field), `missing masked field ${field}`);
    assert.doesNotMatch(preview.content, /13800138001|linyue@example\.com|linyue_pm|26000/);
    await assert.rejects(() => messages.send(preview.messageId, { confirmed: false, operator: '王HR' }), /必须明确确认/);
    await assert.rejects(() => messages.send(preview.messageId, { confirmed: true, operator: '王HR', operatorUserId: 'hr_1' }), /消息发送失败/);
    const messageRow = memory.records.get('recruitment_messages').find((row) => row.fields['消息ID'] === preview.messageId);
    assert.equal(messageRow.fields['发送状态'], '发送失败');
    assert.match(messageRow.fields['错误信息'], /临时限流/);
    const retried = await messages.retry(preview.messageId, { operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(retried.status, '已发送');
    assert.equal(retried.externalId, 'wecom_message_1');
    assert.equal(messageRow.fields['重试次数'], 1);
    await assert.rejects(() => messages.send(preview.messageId, { confirmed: true }), /已经发送/);
    const sentPayload = groupWebhookPayloads[1];
    assert.equal(sentPayload.msgtype, 'markdown');
    assert.equal('target_type' in sentPayload, false);
    assert.equal('target_id' in sentPayload, false);
    assert.doesNotMatch(sentPayload.markdown.content, /13800138001|26000/);
    const directPreview = await messages.preview({ category: '岗位介绍', channel: '企业微信单聊', recipientType: '员工', recipientAddress: 'manager_a', content: '陈经理你好，请查看产品经理岗位信息。', operator: '王HR', operatorUserId: 'hr_1' });
    const directSent = await messages.send(directPreview.messageId, { confirmed: true, operator: '王HR', operatorUserId: 'hr_1' });
    assert.equal(directSent.status, '已发送');
    assert.deepEqual(tianjiCalls[0], { wechatId: 'manager_a', message: '陈经理你好，请查看产品经理岗位信息。', msgType: 'markdown' });
    assert.deepEqual(memory.records.get('recruitment_message_send_events').map((row) => row.fields['事件类型']), ['创建预览', '发送失败', '发送成功', '创建预览', '发送成功']);
    const routed = await messages.notifyPositionHr({ category: '意向沟通完成', candidateId: 'tal_integration_a', applicationId: 'app_integration_a', objectId: 'app_integration_a', markdown: '## 【待约面】林悦\n[打开约面工作台 →](https://resume.example.test/#interviews)' });
    assert.equal(routed.status, '已发送');
    assert.equal(routed.recruiterUserId, 'hr_product');
    assert.deepEqual(tianjiCalls[1], { wechatId: 'wecom_hr_product', message: '## 【待约面】林悦\n[打开约面工作台 →](https://resume.example.test/#interviews)', msgType: 'markdown' });
    const duplicateRoute = await messages.notifyPositionHr({ category: '意向沟通完成', candidateId: 'tal_integration_a', applicationId: 'app_integration_a', objectId: 'app_integration_a', markdown: '重复内容不应再次发送' });
    assert.equal(duplicateRoute.status, '已跳过');
    assert.equal(tianjiCalls.length, 2);

    const owner = await messages.notifyOwner({ title: '招聘SLA告警', text: '产品经理需求已逾期，请及时处理。', operator: '系统' });
    assert.equal(owner.status, '已发送');
    assert.equal(ownerCalls.length, 1);
    assert.equal(ownerCalls[0].options.title, '人才管理系统·招聘SLA告警');
    failConnection = true;
    const disconnected = await messages.connection();
    assert.equal(disconnected.status, '连接失败');
    assert.match(disconnected.action, /检查天玑企微接口配置/);
    failConnection = false;

    const interviews = new InterviewsService(database, messages, {
      queueInterviewQuestionGeneration: () => ({ jobId: 'job_questions_integration', status: 'running' }),
    });
    await create('recruitment_users', { 用户ID: 'manager_a', 姓名: '陈经理', 企业微信用户ID: 'manager_a', 部门JSON: JSON.stringify(['产品部']), 用户状态: '启用' });
    await create('recruitment_users', { 用户ID: 'manager_b', 姓名: '赵经理', 企业微信用户ID: 'manager_b', 部门JSON: JSON.stringify(['运营部']), 用户状态: '启用' });
    await create('recruitment_users', { 用户ID: 'hr_1', 姓名: '测试组织者', 企业微信用户ID: 'wecom_hr_1', 用户状态: '启用' });
    await create('recruitment_user_roles', { 用户角色ID: 'role_manager_a', 用户ID: 'manager_a', 用户姓名: '陈经理', 角色编码: 'interviewer', 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z' });
    await create('recruitment_user_roles', { 用户角色ID: 'role_manager_b', 用户ID: 'manager_b', 用户姓名: '赵经理', 角色编码: 'interviewer', 绑定状态: '启用', 生效时间: '2026-01-01T00:00:00.000Z' });
    const foundWecomUsers = await interviews.searchWecomUsers('陈经理');
    assert.equal(foundWecomUsers.total, 1);
    assert.equal(foundWecomUsers.users[0].userId, 'manager_a');
    await assert.rejects(() => interviews.roomAvailability({ startAt: scheduleStart.toISOString(), endAt: longRangeEnd.toISOString() }), /单场面试时段最长 8 小时/);
    const liveRoomsBeforeSync = await interviews.roomAvailability({ startAt: scheduleStart.toISOString(), endAt: scheduleEnd.toISOString() });
    assert.equal(liveRoomsBeforeSync.rooms.length, 2);
    assert.equal(liveRoomsBeforeSync.rooms[0].id, 'room_external_a');
    assert.equal(liveRoomsBeforeSync.rooms[0].syncStatus, '企微实时（未同步）');
    const resources = await interviews.syncWecomResources();
    assert.equal(resources.status, '已连接');
    assert.equal(resources.syncedCount, 2);
    assert.equal(resources.rooms[0].externalResourceId, 'room_external_a');
    const schedulingCandidates = await interviews.listSchedulingCandidates();
    const schedulingCandidate = schedulingCandidates.candidates.find((item) => item.name === '林悦');
    assert.ok(schedulingCandidate);
    assert.equal('phone' in schedulingCandidate, false);
    const interviewerA = await interviews.createInterviewer({ userId: 'manager_a', name: '陈经理', department: '产品部', roles: ['产品经理'], rounds: ['一面'], maxPerDay: 4 });
    const interviewerB = await interviews.createInterviewer({ userId: 'manager_b', name: '赵经理', department: '运营部', roles: ['运营经理'], rounds: ['一面'], maxPerDay: 4 });
    await interviews.addAvailability({ interviewerId: interviewerA.interviewerId, startAt: new Date(scheduleStart.getTime() - 60 * 60 * 1000).toISOString(), endAt: new Date(scheduleEnd.getTime() + 4 * 60 * 60 * 1000).toISOString(), source: '人工维护' });
    await interviews.addAvailability({ interviewerId: interviewerB.interviewerId, startAt: new Date(scheduleStart.getTime() - 60 * 60 * 1000).toISOString(), endAt: new Date(scheduleStart.getTime() + 52 * 60 * 60 * 1000).toISOString(), source: '人工维护' });
    const room = await interviews.createRoom({ name: '杭州A301', location: '杭州总部', floor: '3F', capacity: 6, equipment: ['电视', '白板'], externalResourceId: 'room_external_a' });
    const exactRoom = await interviews.createRoom({ name: '杭州B302', location: '杭州总部', floor: '3F', capacity: 8, equipment: ['电视'], externalResourceId: 'room_external_b' });
    const freeRooms = await interviews.roomAvailability({ startAt: scheduleStart.toISOString(), endAt: scheduleEnd.toISOString() });
    assert.equal(freeRooms.source, '企微实时');
    assert.equal(freeRooms.rooms[0].status, '空闲');
    assert.equal(freeRooms.rooms[0].reservable, true);
    assert.equal(freeRooms.rooms.find((item) => item.id === exactRoom.roomId)?.status, '空闲');
    assert.equal(freeRooms.rooms.find((item) => item.id === exactRoom.roomId)?.reservable, true);
    assert.equal(freeRooms.rooms.length, 2);
    externalRoomBusy = true;
    const occupiedRooms = await interviews.roomAvailability({ startAt: scheduleStart.toISOString(), endAt: scheduleEnd.toISOString(), roomIds: [room.roomId] });
    assert.equal(occupiedRooms.rooms[0].status, '已占用');
    assert.equal(occupiedRooms.rooms[0].reservable, false);
    externalRoomBusy = false;
    const appointment = await interviews.createAppointment({ candidateId: 'tal_integration_a', applicationId: 'app_integration_a', positionId: 'pos_product', round: '一面', mode: '线下面试', startAt: scheduleStart.toISOString(), endAt: scheduleEnd.toISOString(), location: '杭州总部', meetingRoomId: room.roomId, interviewerIds: [interviewerA.interviewerId], organizerUserId: 'hr_1', note: '产品岗位一面', operator: '王HR', publicUrl: 'https://resume.example.test' });
    assert.equal(appointment.sync.status, '已同步');
    assert.equal(appointment.sync.externalId, 'tianji_booking_schedule_1');
    assert.equal(tianjiBookings[0].meetingRoomId, 'room_external_a');
    assert.equal(tianjiBookings[0].booker, 'wecom_hr_1');
    assert.deepEqual(tianjiBookings[0].attendees, ['manager_a', 'wecom_hr_1']);
    assert.equal(tianjiMailCalls[0].toEmails[0], 'linyue@example.com');
    assert.equal(tianjiMailCalls[0].contentType, 'html');
    assert.equal(appointment.invitation.sendStatus, '将随预约自动发送');
    await assert.rejects(() => interviews.createAppointment({ candidateId: 'tal_integration_b', applicationId: 'app_integration_b', round: '一面', mode: '线下面试', startAt: new Date(scheduleStart.getTime() + 30 * 60 * 1000).toISOString(), endAt: new Date(scheduleEnd.getTime() + 30 * 60 * 1000).toISOString(), meetingRoomId: room.roomId, interviewerIds: [interviewerB.interviewerId], operator: '王HR' }), /会议室.*占用/);
    const updated = await interviews.updateAppointment(appointment.interviewId, { startAt: new Date(scheduleStart.getTime() + 30 * 60 * 1000).toISOString(), endAt: new Date(scheduleEnd.getTime() + 30 * 60 * 1000).toISOString(), interviewerIds: [interviewerA.interviewerId], meetingRoomId: room.roomId, operator: '王HR' });
    assert.equal(updated.sync.status, '已同步');
    assert.equal(updated.sync.externalId, 'tianji_booking_schedule_2');
    assert.equal(tianjiBookings.length, 2);
    assert.deepEqual(tianjiCancellationCalls, ['tianji_booking_schedule_1']);
    const cancelled = await interviews.cancelAppointment(appointment.interviewId, { reason: '候选人已接受其他时间安排', operator: '王HR' });
    assert.equal(cancelled.sync.status, '已同步');
    assert.equal(cancelled.sync.externalId, 'tianji_booking_schedule_2');
    assert.deepEqual(tianjiCancellationCalls, ['tianji_booking_schedule_1', 'tianji_booking_schedule_2']);

    failRoomBooking = true;
    const failedRoomStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const failedRoomEnd = new Date(failedRoomStart.getTime() + 60 * 60 * 1000);
    await assert.rejects(() => interviews.createAppointment({ candidateId: 'tal_integration_b', applicationId: 'app_integration_b', positionId: 'pos_ops', round: '一面', mode: '线下面试', startAt: failedRoomStart.toISOString(), endAt: failedRoomEnd.toISOString(), meetingRoomId: room.roomId, interviewerIds: [interviewerB.interviewerId], organizerUserId: 'hr_1', operator: '王HR', publicUrl: 'https://resume.example.test' }), /会议室预订失败/);
    assert.equal(memory.records.get('recruitment_interviews').filter((row) => row.fields['候选人ID'] === 'tal_integration_b').length, 0);
    failRoomBooking = false;

    failRoomBooking = true;
    wecomRoomRejected = true;
    const rejectedRoomStart = new Date(Date.now() + 50 * 60 * 60 * 1000);
    const rejectedRoomEnd = new Date(rejectedRoomStart.getTime() + 60 * 60 * 1000);
    await assert.rejects(() => interviews.createAppointment({ candidateId: 'tal_integration_b', applicationId: 'app_integration_b', positionId: 'pos_ops', round: '一面', mode: '线下面试', startAt: rejectedRoomStart.toISOString(), endAt: rejectedRoomEnd.toISOString(), meetingRoomId: room.roomId, interviewerIds: [interviewerB.interviewerId], organizerUserId: 'hr_1', operator: '王HR', publicUrl: 'https://resume.example.test' }), { message: '该会议室暂时无法预约，系统未生成面试记录，请换一间会议室后重新提交。' });
    assert.equal(memory.records.get('recruitment_interviews').filter((row) => row.fields['候选人ID'] === 'tal_integration_b').length, 0);
    failRoomBooking = false;
    wecomRoomRejected = false;

    failCalendarCreate = true;
    const failedSyncStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const failedSyncEnd = new Date(failedSyncStart.getTime() + 60 * 60 * 1000);
    await assert.rejects(() => interviews.createAppointment({ candidateId: 'tal_integration_b', applicationId: 'app_integration_b', positionId: 'pos_ops', round: '一面', mode: '线上面试', startAt: failedSyncStart.toISOString(), endAt: failedSyncEnd.toISOString(), meetingUrl: 'https://meeting.example.test/ops', interviewerIds: [interviewerB.interviewerId], organizerUserId: 'hr_1', operator: '王HR', publicUrl: 'https://resume.example.test' }), /企微日程创建失败/);
    assert.equal(memory.records.get('recruitment_interviews').filter((row) => row.fields['候选人ID'] === 'tal_integration_b').length, 0);
    failConnection = true;
    const resourceFailure = await interviews.syncWecomResources();
    assert.equal(resourceFailure.status, '连接失败');
    assert.match(resourceFailure.action, /企微会议室实时查询失败/);
    assert.equal(memory.records.get('recruitment_interview_sync_events').length, 3);
  } finally {
    global.fetch = originalFetch;
    for (const key of groupKeyNames) {
      if (previousGroupKeys[key] === undefined) delete process.env[key];
      else process.env[key] = previousGroupKeys[key];
    }
    tianji.call = originalTianjiCall;
    tianji.searchEmployees = originalTianjiSearchEmployees;
    wecom.cli = originalWecom;
    tianjiWeixinMessage.send = originalTianjiSend;
    tianjiWeixinMessage.freeMeetingRooms = originalTianjiRooms;
    Object.assign(tianjiWeixinMessage, originalTianjiSchedule);
    im.notifyOwner = originalNotifyOwner;
    memory.restore();
  }
});

test('automatic group delivery selects the configured group and never counts empty receipts or missing configuration as success', async (context) => {
  const memory=installMemory(), originalFetch=global.fetch;
  const keys=['WECOM_TALENT_GROUP_WEBHOOK_KEY','WECOM_TALENT_REVIEW_WEBHOOK_KEY'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  context.after(()=>{memory.restore();global.fetch=originalFetch;for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
  process.env.WECOM_TALENT_GROUP_WEBHOOK_KEY='mock-talent';
  process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY='mock-review';
  const calls=[];
  let receipt={};
  global.fetch=async(url)=>{calls.push(new URL(url).searchParams.get('key'));return new Response(JSON.stringify(receipt),{status:200,headers:{'content-type':'application/json'}});};
  const service=new MessagesService({requireTableId:name=>name});
  const input={category:'AI自动业务群评审',candidateId:'candidate',objectId:'share',group:'business',markdown:'测试评审'};
  assert.equal((await service.notifyFlowEvent(input)).status,'发送失败');
  assert.equal(memory.records.get('recruitment_message_send_events')[0].fields['新状态'],'发送失败');
  receipt={errcode:0,errmsg:'ok'};
  assert.equal((await service.notifyFlowEvent(input)).status,'已发送');
  assert.equal((await service.notifyFlowEvent(input)).status,'已跳过');
  assert.deepEqual(calls,['mock-review','mock-review']);
  assert.equal((await service.notifyFlowEvent({...input,category:'人才日报',group:'talent'})).status,'已发送');
  assert.equal(calls.at(-1),'mock-talent');
  delete process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY;
  assert.equal((await service.notifyFlowEvent({...input,objectId:'another-share'})).status,'跳过');
  assert.equal(calls.length,3);
});

test('Tianji personal robot sender posts the documented payload and rejects business errors', async () => {
  const originalFetch = global.fetch, previousUrl = process.env.TIANJI_WEIXIN_USER_MESSAGE_URL;
  try {
    process.env.TIANJI_WEIXIN_USER_MESSAGE_URL = 'https://tianji.example.test/api/admin/weixinUserMessage/send';
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ code: 200, data: { message_id: 'tianji_message_2' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const sent = await sendTianjiWeixinUserMessage({ wechatId: 'LISIQI', message: '**加粗**提醒', msgType: 'markdown' });
    assert.equal(sent.message_id, 'tianji_message_2');
    assert.equal(requests[0].url, process.env.TIANJI_WEIXIN_USER_MESSAGE_URL);
    assert.deepEqual(JSON.parse(requests[0].options.body), { wechat_id: 'LISIQI', message: '**加粗**提醒', msg_type: 'markdown' });
    for (const body of ['', '{}', '<html>gateway unavailable</html>']) {
      global.fetch=async()=>new Response(body,{status:200});
      await assert.rejects(()=>sendTianjiWeixinUserMessage({wechatId:'LISIQI',message:'提醒'}),/未返回明确成功回执/);
    }
    global.fetch = async () => new Response(JSON.stringify({ code: 500, msg: '发送失败' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(() => sendTianjiWeixinUserMessage({ wechatId: 'LISIQI', message: '提醒' }), /天玑个人机器人消息发送失败/);
  } finally {
    global.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.TIANJI_WEIXIN_USER_MESSAGE_URL;
    else process.env.TIANJI_WEIXIN_USER_MESSAGE_URL = previousUrl;
  }
});

test('Tianji meeting-room adapter derives the documented endpoint and sends Unix-second ranges', async () => {
  const originalFetch = global.fetch, previousMessageUrl = process.env.TIANJI_WEIXIN_USER_MESSAGE_URL, previousRoomsUrl = process.env.TIANJI_WEIXIN_FREE_MEETING_ROOMS_URL;
  try {
    process.env.TIANJI_WEIXIN_USER_MESSAGE_URL = 'https://tianji.example.test/api/admin/weixinUserMessage/send?tenant=ignored';
    delete process.env.TIANJI_WEIXIN_FREE_MEETING_ROOMS_URL;
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ code: 200, data: { start_time: 1760076000, end_time: 1760083200, free_count: 1, busy_count: 0, free: [{ meetingroom_id: 'room_1', name: '测试会议室', need_approval: 0 }], busy: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const result = await queryTianjiFreeMeetingRooms(1760076000, 1760083200);
    assert.equal(new URL(requests[0].url).pathname, '/api/admin/weixinUserMessage/freeMeetingRooms');
    assert.equal(new URL(requests[0].url).search, '');
    assert.equal(requests[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(requests[0].options.body), { start_time: 1760076000, end_time: 1760083200 });
    assert.equal(result.free[0].meetingroom_id, 'room_1');
    await assert.rejects(() => queryTianjiFreeMeetingRooms(1760083200, 1760076000), /时间范围无效/);
    global.fetch = async () => new Response(JSON.stringify({ code: 400, message: '时间参数错误' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(() => queryTianjiFreeMeetingRooms(1760076000, 1760083200), /企微会议室查询失败 \(400\)/);
  } finally {
    global.fetch = originalFetch;
    if (previousMessageUrl === undefined) delete process.env.TIANJI_WEIXIN_USER_MESSAGE_URL;
    else process.env.TIANJI_WEIXIN_USER_MESSAGE_URL = previousMessageUrl;
    if (previousRoomsUrl === undefined) delete process.env.TIANJI_WEIXIN_FREE_MEETING_ROOMS_URL;
    else process.env.TIANJI_WEIXIN_FREE_MEETING_ROOMS_URL = previousRoomsUrl;
  }
});

test('Tianji room booking sends the documented payload and requires both confirmation IDs', async (context) => {
  const originalFetch = global.fetch, previousBookingUrl = process.env.TIANJI_WEIXIN_BOOK_MEETING_ROOM_URL;
  context.after(() => {
    global.fetch = originalFetch;
    if (previousBookingUrl === undefined) delete process.env.TIANJI_WEIXIN_BOOK_MEETING_ROOM_URL;
    else process.env.TIANJI_WEIXIN_BOOK_MEETING_ROOM_URL = previousBookingUrl;
  });
  process.env.TIANJI_WEIXIN_BOOK_MEETING_ROOM_URL = 'https://tianji.example.test/api/admin/weixinUserMessage/bookMeetingRoom';
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ code: 200, data: { result: { booking_id: 'booking_1', schedule_id: 'schedule_1' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const startTime = Math.floor(Date.now() / 1000) + 3600;
  const result = await bookTianjiMeetingRoom({ meetingRoomId: '12', booker: 'zhangsan', startTime, endTime: startTime + 3600, subject: '林悦一面面试', attendees: ['lisi', 'wangwu'] });
  assert.equal(new URL(requests[0].url).pathname, '/api/admin/weixinUserMessage/bookMeetingRoom');
  assert.deepEqual(JSON.parse(requests[0].options.body), { meetingroom_id: 12, booker: 'zhangsan', start_time: startTime, end_time: startTime + 3600, subject: '林悦一面面试', attendees: ['lisi', 'wangwu'] });
  assert.deepEqual({ bookingId: result.bookingId, scheduleId: result.scheduleId }, { bookingId: 'booking_1', scheduleId: 'schedule_1' });
  await assert.rejects(() => bookTianjiMeetingRoom({ meetingRoomId: '12', booker: 'zhangsan', startTime, endTime: startTime + 1799 }), /至少晚于开始时间 30 分钟/);
  global.fetch = async () => new Response(JSON.stringify({ code: 200, data: { result: { booking_id: 'booking_without_schedule' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(() => bookTianjiMeetingRoom({ meetingRoomId: '12', booker: 'zhangsan', startTime, endTime: startTime + 1800 }), /未同时返回 booking_id 和 schedule_id/);
  global.fetch = async () => new Response('<!DOCTYPE html><html><head><title>系统发生错误</title><style>body { color: red; }</style></head><body><h1>数据库异常</h1><p>meetingroom_id invalid</p></body></html>', { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  await assert.rejects(
    () => bookTianjiMeetingRoom({ meetingRoomId: '12', booker: 'zhangsan', startTime, endTime: startTime + 1800 }),
    error => {
      assert.match(error.message, /HTTP 500/);
      assert.match(error.message, /系统发生错误.*数据库异常.*meetingroom_id invalid/);
      assert.doesNotMatch(error.message, /color: red/);
      return true;
    },
  );
});

test('WeCom CLI text errors are never treated as an empty successful response', () => {
  assert.throws(() => assertWecomCliSuccess({ text: "error: unrecognized subcommand 'meeting-room'" }), /wecom_cli 参数错误/);
  assert.throws(() => assertWecomCliSuccess({ text: 'Usage: wecom-cli calendar schedules list [OPTIONS]' }), /wecom_cli 参数错误/);
  assert.throws(() => assertWecomCliSuccess({ error: { code: 400086, message: '预定的会议室时间不得早于当前时间' } }), /wecom_cli 业务错误/);
  assert.throws(() => assertWecomCliSuccess({ text: '{"errcode":853006,"errmsg":"this tool is not available for your corporation"}\n\n[diagnosis] unavailable' }), /853006/);
  assert.throws(() => assertWecomCliSuccess({ text: '{"error":{"code":853008,"message":"当前会话不是机器人的最近会话"}}' }), /853008/);
  assert.deepEqual(assertWecomCliSuccess({ meeting_rooms: [] }), { meeting_rooms: [] });
});

test('video interview meetings are recreated only when the schedule changes', async () => {
  const memory = installMemory();
  const originalSchedule = { createSchedule: tianjiWeixinMessage.createSchedule, cancelSchedule: tianjiWeixinMessage.cancelSchedule, createMeeting: tianjiWeixinMessage.createMeeting, cancelMeeting: tianjiWeixinMessage.cancelMeeting, sendMail: tianjiWeixinMessage.sendMail };
  const meetings = [], cancelledMeetings = [], mails = [];
  const previousPublicUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'https://interview.example.test';
  try {
    tianjiWeixinMessage.createSchedule = async () => ({ scheduleId: `schedule_${meetings.length}`, response: { errcode: 0 } });
    tianjiWeixinMessage.cancelSchedule = async scheduleId => ({ scheduleId, response: { errcode: 0 } });
    tianjiWeixinMessage.createMeeting = async input => { meetings.push(input); return { meetingId: `meeting_${meetings.length}`, meetingLink: `https://work.weixin.qq.com/webapp/tm/${meetings.length}`, response: { errcode: 0 } }; };
    tianjiWeixinMessage.cancelMeeting = async meetingId => { cancelledMeetings.push(meetingId); return { meetingId, response: { errcode: 0 } }; };
    tianjiWeixinMessage.sendMail = async input => { mails.push(input); return { messageId: `meeting_mail_${mails.length}`, response: { errcode: 0 } }; };
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_meeting_change', 姓名: '会议变更候选人', 邮箱: 'meeting-change@example.invalid' });
    await teable.createRecord('recruitment_users', { 用户ID: 'hr_meeting_change', 姓名: '测试组织者', 企业微信用户ID: 'wecom_hr_meeting_change', 用户状态: '启用' });
    const service = new InterviewsService({ requireTableId: name => name }, {}, { queueInterviewQuestionGeneration: () => ({ status: 'running' }) });
    service.listInterviewers = async () => ({ interviewers: [{ id: 'employee_meeting_change', name: '测试面试官', wecomUserId: 'wecom_meeting_change' }] });
    const start = new Date(Date.now() + 86400000);
    start.setMinutes(40, 0, 0);
    const end = new Date(start.getTime() + 20 * 60000);
    const created = await service.createAppointment({
      candidateId: 'tal_meeting_change', round: '一面', mode: '线上面试',
      startAt: start.toISOString(), endAt: end.toISOString(),
      interviewerIds: ['employee_meeting_change'], interviewerWecomIds: ['wecom_meeting_change'],
      sendCandidateEmail: false, publicUrl: 'https://example.invalid',
    });
    assert.equal(created.sync.status, '已同步');
    assert.equal(meetings.length, 1);
    const record = () => memory.records.get('recruitment_interviews')[0];
    assert.equal(record().fields['会议地址'], 'https://work.weixin.qq.com/webapp/tm/1');
    const publicMeeting = await service.publicDetail(created.token);
    assert.equal(publicMeeting.location, '线上会议');
    assert.equal(publicMeeting.meetingUrl, 'https://work.weixin.qq.com/webapp/tm/1');
    await service.updateAppointment(created.interviewId, { startAt: start.toISOString(), endAt: end.toISOString(), operator: '测试' });
    assert.equal(meetings.length, 1);
    assert.deepEqual(cancelledMeetings, []);
    assert.deepEqual(mails, []);
    const movedStart = new Date(start.getTime() + 60 * 60000), movedEnd = new Date(movedStart.getTime() + 20 * 60000);
    await service.updateAppointment(created.interviewId, { startAt: movedStart.toISOString(), endAt: movedEnd.toISOString(), operator: '测试' });
    assert.equal(meetings.length, 2);
    assert.equal(meetings[1].startTime, Math.floor(movedStart.getTime() / 1000));
    assert.deepEqual(cancelledMeetings, ['meeting_1']);
    assert.equal(record().fields['会议地址'], 'https://work.weixin.qq.com/webapp/tm/2');
    assert.equal(JSON.parse(record().fields['外部会议信息JSON']).meetingId, 'meeting_2');
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0].toEmails, ['meeting-change@example.invalid']);
    assert.match(mails[0].content, /进入会议/);
    assert.match(mails[0].content, /https:\/\/work\.weixin\.qq\.com\/webapp\/tm\/2/);
    const laterStart = new Date(movedStart.getTime() + 60 * 60000), laterEnd = new Date(laterStart.getTime() + 20 * 60000);
    await service.updateAppointment(created.interviewId, { startAt: laterStart.toISOString(), endAt: laterEnd.toISOString(), operator: '测试' }, { resendInvitation: false });
    assert.equal(meetings.length, 3);
    assert.equal(mails.length, 1);
    assert.deepEqual(cancelledMeetings, ['meeting_1', 'meeting_2']);
    await service.cancelAppointment(created.interviewId, { reason: '测试取消', operator: '测试' });
    assert.deepEqual(cancelledMeetings, ['meeting_1', 'meeting_2', 'meeting_3']);
    assert.equal(record().fields['外部会议信息JSON'] || '', '');
  } finally {
    tianjiWeixinMessage.createSchedule = originalSchedule.createSchedule;
    tianjiWeixinMessage.cancelSchedule = originalSchedule.cancelSchedule;
    tianjiWeixinMessage.createMeeting = originalSchedule.createMeeting;
    tianjiWeixinMessage.cancelMeeting = originalSchedule.cancelMeeting;
    tianjiWeixinMessage.sendMail = originalSchedule.sendMail;
    if (previousPublicUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = previousPublicUrl;
    memory.restore();
  }
});

test('phone interviews also get a WeCom meeting link in the candidate email and public page', async () => {
  const memory = installMemory();
  const originalSchedule = { createSchedule: tianjiWeixinMessage.createSchedule, cancelSchedule: tianjiWeixinMessage.cancelSchedule, createMeeting: tianjiWeixinMessage.createMeeting, cancelMeeting: tianjiWeixinMessage.cancelMeeting, sendMail: tianjiWeixinMessage.sendMail };
  const meetings = [], mails = [];
  const previousPublicUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'https://interview.example.test';
  try {
    tianjiWeixinMessage.createSchedule = async () => ({ scheduleId: 'schedule_phone_meeting', response: { errcode: 0 } });
    tianjiWeixinMessage.cancelSchedule = async scheduleId => ({ scheduleId, response: { errcode: 0 } });
    tianjiWeixinMessage.createMeeting = async input => { meetings.push(input); return { meetingId: 'meeting_phone', meetingLink: 'https://work.weixin.qq.com/webapp/tm/phone', response: { errcode: 0 } }; };
    tianjiWeixinMessage.cancelMeeting = async meetingId => ({ meetingId, response: { errcode: 0 } });
    tianjiWeixinMessage.sendMail = async input => { mails.push(input); return { messageId: `phone_meeting_mail_${mails.length}`, response: { errcode: 0 } }; };
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_phone_meeting', 姓名: '电话面试候选人', 邮箱: 'phone-meeting@example.invalid' });
    await teable.createRecord('recruitment_users', { 用户ID: 'hr_phone_meeting', 姓名: '测试组织者', 企业微信用户ID: 'wecom_hr_phone_meeting', 用户状态: '启用' });
    const service = new InterviewsService({ requireTableId: name => name }, {}, { queueInterviewQuestionGeneration: () => ({ status: 'running' }) });
    service.listInterviewers = async () => ({ interviewers: [{ id: 'employee_phone_meeting', name: '测试面试官', wecomUserId: 'wecom_phone_meeting' }] });
    const start = new Date(Date.now() + 86400000);
    start.setMinutes(40, 0, 0);
    const end = new Date(start.getTime() + 20 * 60000);
    const created = await service.createAppointment({
      candidateId: 'tal_phone_meeting', round: '一面', mode: '线上面试',
      startAt: start.toISOString(), endAt: end.toISOString(),
      interviewerIds: ['employee_phone_meeting'], interviewerWecomIds: ['wecom_phone_meeting'],
      publicUrl: 'https://example.invalid',
    });
    assert.equal(created.sync.status, '已同步');
    assert.equal(meetings.length, 1);
    assert.equal(memory.records.get('recruitment_interviews')[0].fields['会议地址'], 'https://work.weixin.qq.com/webapp/tm/phone');
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0].toEmails, ['phone-meeting@example.invalid']);
    assert.match(mails[0].content, /进入会议/);
    assert.match(mails[0].content, /https:\/\/work\.weixin\.qq\.com\/webapp\/tm\/phone/);
    const publicPhone = await service.publicDetail(created.token);
    assert.equal(publicPhone.location, '线上会议');
    assert.equal(publicPhone.meetingUrl, 'https://work.weixin.qq.com/webapp/tm/phone');
  } finally {
    tianjiWeixinMessage.createSchedule = originalSchedule.createSchedule;
    tianjiWeixinMessage.cancelSchedule = originalSchedule.cancelSchedule;
    tianjiWeixinMessage.createMeeting = originalSchedule.createMeeting;
    tianjiWeixinMessage.cancelMeeting = originalSchedule.cancelMeeting;
    tianjiWeixinMessage.sendMail = originalSchedule.sendMail;
    if (previousPublicUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = previousPublicUrl;
    memory.restore();
  }
});

test('Tianji meeting wrapper posts createMeeting and cancelMeeting payloads and rejects an admin outside invitees', async () => {
  const originalFetch = global.fetch, previousUrl = process.env.TIANJI_WEIXIN_USER_MESSAGE_URL;
  try {
    process.env.TIANJI_WEIXIN_USER_MESSAGE_URL = 'https://tianji.example.test/api/admin/weixinUserMessage/send';
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      const data = requests.length === 1
        ? { meetingid: 'hyMeeting1', meeting_link: 'https://meeting.tencent.com/dm/exact', meeting_code: '821490598', result: { errcode: 0, errmsg: 'ok', meetingid: 'hyMeeting1', meeting_code: '821490598' } }
        : { result: { errcode: 0, errmsg: 'ok' } };
      return new Response(JSON.stringify({ code: 200, msg: '', data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const meeting = await tianjiWeixinMessage.createMeeting({ adminUserId: 'LISIQI', title: '面试｜张三｜一面', startTime: 1792893600, endTime: 1792895400, invitees: ['LISIQI', 'WANGWU'] });
    assert.equal(meeting.meetingId, 'hyMeeting1');
    assert.equal(meeting.meetingLink, 'https://meeting.tencent.com/dm/exact');
    assert.equal(requests[0].url, 'https://tianji.example.test/api/admin/weixinUserMessage/createMeeting');
    assert.deepEqual(requests[0].body, { admin_userid: 'LISIQI', title: '面试｜张三｜一面', meeting_start: 1792893600, meeting_duration: 1800, invitees: ['LISIQI', 'WANGWU'] });
    await tianjiWeixinMessage.cancelMeeting('hyMeeting1');
    assert.equal(requests[1].url, 'https://tianji.example.test/api/admin/weixinUserMessage/cancelMeeting');
    assert.deepEqual(requests[1].body, { meetingid: 'hyMeeting1' });
    await assert.rejects(() => tianjiWeixinMessage.createMeeting({ adminUserId: 'LISIQI', title: '面试', startTime: 1792893600, endTime: 1792895400, invitees: ['WANGWU'] }), /必须同时是参会人/);
    assert.equal(requests.length, 2);
  } finally {
    global.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.TIANJI_WEIXIN_USER_MESSAGE_URL;
    else process.env.TIANJI_WEIXIN_USER_MESSAGE_URL = previousUrl;
  }
});
