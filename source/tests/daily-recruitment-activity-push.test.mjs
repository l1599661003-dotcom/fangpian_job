import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyRecruitmentActivityMarkdown,
  buildDailyRecruitmentActivityMarkdownMessages,
  DailyRecruitmentActivityPushTaskRunner,
} from '../dist/tasks/daily-recruitment-activity-push.task.js';

test('daily recruitment activity push markdown includes metrics and source summary', () => {
  const markdown = buildDailyRecruitmentActivityMarkdown({
    date: '2026-10-15',
    summary: { resumes: 3, interviews: 3, offers: 1, arrived: 1 },
    uploaders: [{ name: '张晓霞', count: 2, department: '商务' }, { name: '内推', count: 1, department: '商务' }],
    departmentUploads: [{ department: '商务', count: 3, uploaders: [{ name: '张晓霞', count: 2 }, { name: '内推', count: 1 }] }],
    resumeUploads: [
      { candidateName: '候选人甲', department: '商务', uploader: '张晓霞', sourceUrl: 'https://cdn.example.test/a.pdf' },
      { candidateName: '候选人乙', department: '商务', uploader: '张晓霞', sourceUrl: 'https://cdn.example.test/b.pdf' },
      { candidateName: '候选人丙', department: '商务', uploader: '内推', source: '内推', sourceUrl: 'https://cdn.example.test/c.pdf' },
    ],
  });

  assert.match(markdown, /每日招聘动态/);
  assert.match(markdown, /简历入库：3/);
  assert.match(markdown, /面试场次：3/);
  assert.match(markdown, /已发 Offer：1/);
  assert.match(markdown, /入职数：1/);
  assert.match(markdown, /上传：张晓霞 2 份/);
  assert.match(markdown, /内推：1份/);
  assert.doesNotMatch(markdown, /部门入库明细/);
  assert.doesNotMatch(markdown, /简历明细/);
  assert.doesNotMatch(markdown, /候选人/);
  assert.doesNotMatch(markdown, /查看原始简历/);
});

test('daily recruitment activity push markdown handles empty resume uploads', () => {
  const markdown = buildDailyRecruitmentActivityMarkdown({
    date: '2026-10-15',
    summary: { resumes: 0, interviews: 0, offers: 0, arrived: 0 },
    uploaders: [],
    resumeUploads: [],
  });

  assert.match(markdown, /上传：暂无上传记录/);
  assert.match(markdown, /内推：0份/);
  assert.doesNotMatch(markdown, /候选人/);
});

test('daily recruitment activity push splits long content for WeCom', () => {
  const uploaderCount = 60;
  const uploaders = Array.from({ length: uploaderCount }, (_, index) => ({
    name: `业务事业部上传人${String(index + 1).padStart(2, '0')}${'一'.repeat(24)}`,
    count: 1,
  }));
  const input = {
    date: '2026-10-17',
    summary: { resumes: uploaderCount, interviews: 8, offers: 3, arrived: 2 },
    uploaders,
  };

  const messages = buildDailyRecruitmentActivityMarkdownMessages(input);
  const combined = messages.join('\n');

  assert.ok(messages.length > 1);
  for (const message of messages) {
    assert.ok(Buffer.byteLength(message, 'utf8') <= 3500);
  }
  assert.doesNotMatch(combined, /候选人/);
  assert.doesNotMatch(combined, /查看原始简历/);
});

test('daily recruitment activity push sends every markdown chunk', async () => {
  const uploaderCount = 60;
  const uploaders = Array.from({ length: uploaderCount }, (_, index) => ({
    name: `业务事业部上传人${String(index + 1).padStart(2, '0')}${'二'.repeat(24)}`,
    count: 1,
  }));
  const activity = {
    date: '2026-10-17',
    summary: { resumes: uploaderCount, interviews: 8, offers: 3, arrived: 2 },
    uploaders,
  };
  const originalFetch = globalThis.fetch;
  const originalWebhookKey = process.env.WECOM_DAILY_RECRUITMENT_WEBHOOK_KEY;
  const calls = [];
  process.env.WECOM_DAILY_RECRUITMENT_WEBHOOK_KEY = 'test-key';
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
  };

  try {
    const runner = new DailyRecruitmentActivityPushTaskRunner({
      monthlyHiring: async () => ({ hiringActivity: activity }),
    });
    await runner.run(() => {});
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWebhookKey === undefined) delete process.env.WECOM_DAILY_RECRUITMENT_WEBHOOK_KEY;
    else process.env.WECOM_DAILY_RECRUITMENT_WEBHOOK_KEY = originalWebhookKey;
  }

  assert.ok(calls.length > 1);
  for (const call of calls) {
    assert.equal(call.msgtype, 'markdown');
    assert.ok(Buffer.byteLength(call.markdown.content, 'utf8') <= 3500);
  }
  const combined = calls.map(call => call.markdown.content).join('\n');
  assert.doesNotMatch(combined, /候选人/);
  assert.doesNotMatch(combined, /查看原始简历/);
});
