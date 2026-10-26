import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemandReminderMarkdown, selectDepartmentLeaderRecipients } from '../dist/tasks/daily-demand-reminder.task.js';

test('daily demand reminder stays concise and links to department demand entry', () => {
  const markdown = buildDemandReminderMarkdown({
    month: '2026-10',
    link: 'https://recruitment.example.test/?flow_action=demand&demand_month=2026-10',
  });
  assert.match(markdown, /招聘需求录入提醒/);
  assert.match(markdown, /2026-10 公司月份（2026-09-27 至 2026-10-24）/);
  assert.match(markdown, /本部门在招岗位及招聘进展/);
  assert.match(markdown, /新增、调整需求或暂停招聘/);
  assert.match(markdown, /flow_action=demand&demand_month=2026-10/);
  assert.doesNotMatch(markdown, /已录入|待审批|商务开发|运营专员/);
  assert.equal(markdown.split('\n').length, 3);
});

test('daily demand reminder targets only active department leaders with active users', () => {
  const now = Date.parse('2026-09-30T00:00:00.000Z');
  const record = (fields) => ({ id: fields['用户ID'] || fields['用户角色ID'] || fields['角色编码'], fields });
  const recipients = selectDepartmentLeaderRecipients({
    now,
    roles: [record({ '角色编码': 'department_leader', '角色状态': '启用' })],
    users: [
      record({ '用户ID': 'leader-1', '姓名': '部门负责人甲', '用户状态': '启用', '天玑人事状态': '在职', '天玑微信ID': 'tianji-1' }),
      record({ '用户ID': 'leader-2', '姓名': '部门负责人乙', '用户状态': '启用', '企业微信用户ID': 'wecom-2' }),
      record({ '用户ID': 'inactive', '姓名': '已停用员工', '用户状态': '停用', '天玑微信ID': 'inactive-id' }),
      record({ '用户ID': 'left', '姓名': '已离职员工', '用户状态': '启用', '天玑人事状态': '离职', '天玑微信ID': 'left-id' }),
    ],
    bindings: [
      record({ '用户ID': 'leader-1', '用户角色ID': 'binding-1', '角色编码': 'department_leader', '绑定状态': '启用' }),
      record({ '用户ID': 'leader-1', '用户角色ID': 'binding-2', '角色编码': 'department_leader', '绑定状态': '启用' }),
      record({ '用户ID': 'leader-2', '用户角色ID': 'binding-3', '角色编码': 'department_leader', '绑定状态': '启用' }),
      record({ '用户ID': 'inactive', '用户角色ID': 'binding-4', '角色编码': 'department_leader', '绑定状态': '启用' }),
      record({ '用户ID': 'left', '用户角色ID': 'binding-5', '角色编码': 'department_leader', '绑定状态': '启用' }),
      record({ '用户ID': 'leader-1', '用户角色ID': 'binding-6', '角色编码': 'hrbp', '绑定状态': '启用' }),
      record({ '用户ID': 'leader-1', '用户角色ID': 'binding-7', '角色编码': 'department_leader', '绑定状态': '启用', '失效时间': '2026-09-29T23:59:59.000Z' }),
      record({ '用户ID': 'leader-1', '用户角色ID': 'binding-8', '角色编码': 'department_leader', '绑定状态': '启用', '生效时间': '2026-10-01T00:00:00.000Z' }),
    ],
  });

  assert.deepEqual(recipients, [
    { userId: 'leader-1', name: '部门负责人甲', wechatId: 'tianji-1' },
    { userId: 'leader-2', name: '部门负责人乙', wechatId: 'wecom-2' },
  ]);
});

test('daily demand reminder sends to nobody when the department leader role is disabled', () => {
  const recipients = selectDepartmentLeaderRecipients({
    roles: [{ id: 'role', fields: { '角色编码': 'department_leader', '角色状态': '停用' } }],
    users: [{ id: 'user', fields: { '用户ID': 'leader', '姓名': '部门负责人', '用户状态': '启用', '天玑微信ID': 'tianji-id' } }],
    bindings: [{ id: 'binding', fields: { '用户ID': 'leader', '角色编码': 'department_leader', '绑定状态': '启用' } }],
  });

  assert.deepEqual(recipients, []);
});
