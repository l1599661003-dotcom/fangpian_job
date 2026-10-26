# 企微消息 / 会议 / 日程 / 邮件 接口文档

给内部系统接入用。调用方不需要企业微信的 corpsecret，统一打天玑这组接口，由天玑用已授权的自建应用去调企微。

## 通用约定

- 请求方式全部是 `POST`
- `Content-Type: application/json`
- 路径前缀：`/admin/weixinUserMessage/`（部署域名按环境替换，下面示例用 `{host}`）
- 免登录，不传天玑 token。接口只应在内网或网关白名单后暴露，不要直接对公网开放
- 人员一律用企业微信 userid，对应员工表 `fp_employee.wechat_id`
- 时间一律是 unix 时间戳，单位秒
- 未在本文档列出的字段会被丢弃

成功：

```json
{
  "code": 200,
  "msg": "",
  "time": 1760000000,
  "data": {}
}
```

失败（参数校验失败，或企微返回错误）：

```json
{
  "code": 100,
  "msg": "创建会议失败：xxx",
  "time": 1760000000,
  "data": null
}
```

企微拒绝时，`msg` 带企微原文，`data` 是企微原始返回（含 `errcode`、`errmsg`）。接入方判断成功只看外层 `code === 200`。

常见企微错误：

| errcode | 含义 | 处理 |
|---|---|---|
| 48002 | 应用没有该能力的接口权限 | 找管理员把应用加进对应「可调用接口的应用」 |
| 60020 | 服务器 IP 不在可信 IP | 把天玑出口 IP 加进应用可信 IP |
| 60111 | userid 不存在 | 核对 `fp_employee.wechat_id` |
| 40058 | 参数不合法 | 核对本文档的取值范围 |

会议、日程、邮件、会议室是四套授权，缺哪一套只有对应接口失败，不影响发消息。

## 接口一览

| 接口 | 路径 |
|---|---|
| 发应用消息 | `/admin/weixinUserMessage/send` |
| 创建会议 | `/admin/weixinUserMessage/createMeeting` |
| 取消会议 | `/admin/weixinUserMessage/cancelMeeting` |
| 查询会议室 | `/admin/weixinUserMessage/meetingRooms` |
| 创建日程 | `/admin/weixinUserMessage/createSchedule` |
| 取消日程 | `/admin/weixinUserMessage/cancelSchedule` |
| 发送普通邮件 | `/admin/weixinUserMessage/sendMail` |

---

## 1. 发应用消息

给指定员工发一条企微应用消息。

`POST /admin/weixinUserMessage/send`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| wechat_id | string | 是 | 员工企微 userid |
| message | string | 是 | 消息内容 |
| msg_type | string | 否 | `text`（默认）或 `markdown` |

请求：

```json
{
  "wechat_id": "zhangsan",
  "message": "请于 15:00 前确认本周排期",
  "msg_type": "text"
}
```

成功 `data`：

```json
{
  "wechat_id": "zhangsan",
  "msg_type": "text",
  "result": {
    "errcode": 0,
    "errmsg": "ok",
    "msgid": "xxxx"
  }
}
```

---

## 2. 创建会议

创建一场预约会议。管理员和参会人都必须在应用可见范围内。普通企业参会人最多 100 人。

`POST /admin/weixinUserMessage/createMeeting`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| admin_userid | string | 是 | 会议管理员 userid |
| title | string | 是 | 会议标题，最多 20 个汉字 |
| meeting_start | int | 是 | 开始时间，unix 秒，必须大于当前时间 |
| meeting_duration | int | 是 | 时长，单位秒，300～86399 |
| invitees | string[] | 否 | 参会人 userid |
| description | string | 否 | 会议描述 |
| location | string | 否 | 会议地点 |

请求：

```json
{
  "admin_userid": "zhangsan",
  "title": "需求评审",
  "meeting_start": 1760000000,
  "meeting_duration": 3600,
  "invitees": ["lisi", "wangwu"],
  "description": "评审 2.0 需求",
  "location": "广州媒体港"
}
```

成功时从 `data.result` 取回这些字段，取消会议要用 `meetingid`：

| 字段 | 说明 |
|---|---|
| meetingid | 会议 ID |
| meeting_code | 会议号 |
| meeting_link | 入会链接 |
| excess_users | 无有效会议账号的 userid，仅专业版企业可能返回 |

```json
{
  "result": {
    "errcode": 0,
    "errmsg": "ok",
    "meetingid": "hyxxxxxxxx",
    "meeting_code": "123456789",
    "meeting_link": "https://meeting.tencent.com/dm/xxxx"
  }
}
```

只能取消本应用创建、且仍处于预约状态的会议。

---

## 3. 取消会议

`POST /admin/weixinUserMessage/cancelMeeting`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| meetingid | string | 是 | 创建会议返回的 meetingid |
| sub_meetingid | string | 否 | 周期性子会议 ID。不传则取消整系列周期会议 |

```json
{
  "meetingid": "hyxxxxxxxx"
}
```

成功 `data.result` 为 `{ "errcode": 0, "errmsg": "ok" }`。

---

## 4. 查询会议室

四个过滤条件都可以不传，不传返回全部会议室。

`POST /admin/weixinUserMessage/meetingRooms`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| city | string | 否 | 城市 |
| building | string | 否 | 楼宇。传了就必须同时传 city |
| floor | string | 否 | 楼层。传了就必须同时传 city 和 building |
| equipment | int[] | 否 | 设备：1 电视、2 电话、3 投影、4 白板、5 视频 |

查全部：

```json
{}
```

按位置过滤：

```json
{
  "city": "深圳",
  "building": "腾讯大厦",
  "floor": "18F",
  "equipment": [1, 5]
}
```

`data.result.meetingroom_list` 每一项：

| 字段 | 说明 |
|---|---|
| meetingroom_id | 会议室 ID |
| name | 名称 |
| capacity | 容纳人数 |
| city / building / floor | 城市、楼宇、楼层 |
| equipment | 设备 id 列表，含义同上 |
| need_approval | 0 无需审批，1 需要审批 |

本接口只返回会议室资料，不返回某个时间段是否空闲，也不负责预定。

---

## 5. 创建日程

写到本应用的日历上。不传 `cal_id` 时进入该应用的默认日历。参与人必须在应用可见范围内。

`POST /admin/weixinUserMessage/createSchedule`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| start_time | int | 是 | 开始时间，unix 秒 |
| end_time | int | 是 | 结束时间，unix 秒，必须大于开始时间 |
| summary | string | 否 | 标题，0～128 字。不填企微显示「新建事件」 |
| description | string | 否 | 描述，不超过 1000 字 |
| location | string | 否 | 地点，不超过 128 字 |
| attendees | string[] | 否 | 参与人 userid，最多 1000 |
| admins | string[] | 否 | 管理员 userid，最多 3 人，且必须包含在 attendees 里 |
| cal_id | string | 否 | 指定日历。不传用应用默认日历 |
| is_whole_day | int | 否 | 1 全天，默认 0 |

```json
{
  "summary": "需求评审",
  "description": "2.0 版本需求初步评审",
  "location": "10 楼 1005",
  "start_time": 1760000000,
  "end_time": 1760003600,
  "attendees": ["lisi", "wangwu"],
  "admins": ["lisi"]
}
```

成功后保存 `data.result.schedule_id`，取消日程要用它。

---

## 6. 取消日程

只能取消本应用创建的日程。

`POST /admin/weixinUserMessage/cancelSchedule`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| schedule_id | string | 是 | 创建日程返回的 schedule_id |
| op_mode | int | 否 | 重复日程的操作范围。普通日程不传 |
| op_start_time | int | 否 | 重复日程本次操作的开始时间，unix 秒 |

```json
{
  "schedule_id": "17c7d2bd9f20d652840f72f59e796AAA"
}
```

---

## 7. 发送普通邮件

以应用身份发一封普通邮件。收件人 userid 必须在应用可见范围内。本次不支持附件。

`POST /admin/weixinUserMessage/sendMail`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| subject | string | 是 | 标题 |
| content | string | 是 | 正文 |
| content_type | string | 否 | `html`（默认）或 `text` |
| to_userids | string[] | 二选一 | 收件人 userid。和 to_emails 至少传一个 |
| to_emails | string[] | 二选一 | 收件人邮箱 |
| cc_userids / cc_emails | string[] | 否 | 抄送 |
| bcc_userids / bcc_emails | string[] | 否 | 密送 |

```json
{
  "subject": "本周排期确认",
  "content": "<p>请于今日 18:00 前确认。</p>",
  "content_type": "html",
  "to_userids": ["zhangsan"],
  "cc_emails": ["ops@example.com"]
}
```

成功 `data.result` 为 `{ "errcode": 0, "errmsg": "ok" }`。

---

## 调用示例

```bash
curl -X POST "{host}/admin/weixinUserMessage/createMeeting" \
  -H "Content-Type: application/json" \
  -d "{\"admin_userid\":\"zhangsan\",\"title\":\"需求评审\",\"meeting_start\":1760000000,\"meeting_duration\":3600,\"invitees\":[\"lisi\"]}"
```
