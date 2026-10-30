import { test, expect } from '/usr/lib/node_modules/playwright/test.mjs';
import { candidateEmailCard } from '../dist/platform/candidate-email.js';

const baseUrl = 'http://127.0.0.1:4178/';
const person = { candidateName: '林悦', role: '产品经理', department: '产品部' };
const fixtures = [
  { name: 'invitation', query: 'interview_token=mobile', heading: '面试已安排', data: { ...person, startAt: '2026-10-15T02:00:00Z', confirmationStatus: '已确认', interviewers: ['陈经理'], candidateProfile: {} } },
  { name: 'evaluation', query: 'evaluation_token=mobile', heading: '面试评价', data: { ...person, startAt: '2026-10-15T02:00:00Z', questionSnapshot: [{ questionId: 'question1', question: '介绍你负责的项目', dimension: '专业能力' }] } },
  { name: 'offer', query: 'offer_token=mobile', heading: '录用通知书', data: { ...person, salary: { base: 10000, performance: 2000, allowance: 500 }, probationMonths: 3, startDate: '2026-10-20', fileUrl: '/offer.pdf', offerNumber: 'OFFER-2026', location: '杭州' } },
  { name: 'onboarding', query: 'onboarding_arrival_token=mobile', heading: '确认到岗状态', data: { ...person, plannedStartDate: '2026-10-20' } },
  { name: 'monthly-review', query: 'onboarding_review_token=mobile', heading: '入职一月评价', data: { ...person, nodeType: '入职一月评价', plannedDate: '2026-10-25' } },
  { name: 'probation-review', query: 'onboarding_review_token=mobile', heading: '试用期评价', data: { ...person, nodeType: '试用期评价', plannedDate: '2026-10-25' } },
  { name: 'assessment', query: 'assessment_token=mobile', heading: '产品能力测评', data: { ...person, expiresAt: '2026-12-31', template: { name: '产品能力测评', durationMinutes: 30 }, questions: [{ id: 'question1', order: 1, type: 'text', title: '项目经历', category: '经历', required: true, score: 100 }, { id: 'question2', order: 2, type: 'single', title: '协作方式', category: '协作', required: true, score: 10, options: ['主动沟通', '独立推进'] }] } },
  { name: 'referral', query: 'referral_token=mobile', heading: '方片新媒体', data: { positions: [{ id: 'pos_one', name: '产品经理', department: '产品部', requirements: '有产品规划经验' }, { id: 'pos_two', name: '运营负责人', department: '运营部', responsibilities: '负责用户运营' }], referrer: { name: '李HR', bound: true } } },
  { name: 'tracking', query: 'referral_tracking=mobile', heading: '林悦 · 产品经理', data: { ...person, progress: '面试安排中', status: '待确认', validity: '有效', privacy: '仅展示当前推荐的招聘进度' } },
];

async function mockFixture(page, fixture) {
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.data) }));
  await page.goto(`${baseUrl}?${fixture.query}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: fixture.heading, exact: true })).toBeVisible();
}

async function expectContained(page) {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    outside: [...document.querySelectorAll('body *')].filter(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.width && (bounds.right > innerWidth + 1 || bounds.left < -1) && !node.closest('.rf-mobile-section-links, .top-nav, .availability, .date-tabs');
    }).slice(0, 8).map(node => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width })),
  }));
  expect(layout.overflow, JSON.stringify(layout.outside)).toBeLessThanOrEqual(1);
}

for (const width of [320, 390, 1280]) {
  test(`journey inventory renders all external forms at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const fixture of fixtures) {
      await page.unrouteAll();
      await mockFixture(page, fixture);
      await expectContained(page);
      if (width <= 760) {
        const input = page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):visible, textarea:visible, select:visible').first();
        if (await input.count()) expect(await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
      } else await expect(page.locator('.rf-mobile-form-map:visible')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`${fixture.name}.png`) });
    }
    expect(errors).toEqual([]);
  });
}

test('journey form navigation preserves writing and locates missing fields without submitting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let writes = 0;
  const fixture = fixtures.find(item => item.name === 'monthly-review');
  await mockFixture(page, fixture);
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'POST') writes++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.data) });
  });
  const map = page.getByRole('navigation', { name: '填写导航' });
  await expect(map).toContainText('必填项 0 / 3');
  await map.getByRole('button', { name: '定位待填项' }).click();
  await expect(page.locator('[data-combobox-for="performanceRating"] input')).toBeFocused();
  await page.locator('[name="performanceRating"]').selectOption('A');
  await page.locator('[name="growthLevel"]').fill('稳定成长');
  await page.locator('[name="appraisal"]').fill('完成项目，协作良好。');
  await expect(map).toContainText('必填项 3 / 3');
  await expect(map.getByRole('button', { name: '定位待填项' })).toBeHidden();
  expect(writes).toBe(0);
  const shouldWarn = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(shouldWarn).toBe(true);
  await page.getByRole('button', { name: '提交入职评价' }).click();
  await expect(page.getByText('入职评价已提交')).toBeVisible();
  expect(writes).toBe(1);
});

test('journey Offer response prevents repeat taps and preserves explanation on failure', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockFixture(page, fixtures.find(item => item.name === 'offer'));
  let attempts = 0;
  let submitted;
  await page.route('**/api/public/offers/mobile/respond', async route => {
    attempts++;
    submitted = route.request().postDataJSON();
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ status: attempts === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { message: '暂时无法提交' } : { response: '接受', targetStage: '待入职' }) });
  });
  await expect(page.getByText('Offer编号')).toHaveCount(0);
  await expect(page.getByText('月度薪资')).toHaveCount(0);
  await expect(page.getByText('答复说明')).toHaveCount(0);
  await page.getByRole('button', { name: '接受Offer', exact: true }).click();
  await expect(page.getByRole('button', { name: '拒绝Offer' })).toBeDisabled();
  await expect(page.locator('#rf-public-offer-message')).toContainText('请重试');
  expect(attempts).toBe(1);
  await page.getByRole('button', { name: '接受Offer', exact: true }).click();
  await expect(page.getByText('已提交：接受')).toBeVisible();
  expect(submitted).toEqual({ response: 'accept', note: '' });
  expect(attempts).toBe(2);
});

test('journey referral selects the tapped position without sending a resume', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFixture(page, fixtures.find(item => item.name === 'referral'));
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST') writes++; });
  await page.locator('.rf-ref-position-card').nth(1).getByRole('button', { name: '投递这个岗位' }).click();
  await expect(page.locator('[name="intendedPositionId"]')).toHaveValue('pos_two');
  await expect(page.locator('[name="candidateName"]')).toBeFocused();
  expect(writes).toBe(0);
  await expectContained(page);
});

test('journey referral accepts a dragged file and submits it through the same endpoint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFixture(page, fixtures.find(item => item.name === 'referral'));
  let submittedPayload = '';
  await page.locator('[data-public-ref-drop]').evaluate(node => {
    const file = new File([new TextEncoder().encode('拖拽上传的测试简历')], 'dragged-resume.txt', { type: 'text/plain' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    node.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('[data-public-ref-drop] strong')).toHaveText('dragged-resume.txt');
  expect(await page.locator('[name="file"]').evaluate(input => input.files[0]?.name)).toBe('dragged-resume.txt');
  await page.locator('[name="candidateName"]').fill('林悦');
  await page.locator('[name="candidatePhone"]').fill('13800138000');
  await page.locator('[name="consent"]').check();
  await page.route('**/api/public/referrals/mobile/submit', route => {
    submittedPayload = Buffer.from(route.request().postData() || '').toString('utf8');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job_drag_referral' }) });
  });
  await page.route('**/api/jobs/job_drag_referral', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', data: { trackingPath: '?referral_tracking=drag_track', status: '待负责人确认', duplicateStatus: '未重复' } }) }));
  await page.getByRole('button', { name: '提交内推简历' }).click();
  await expect(page.getByText('内推简历已提交', { exact: true })).toBeVisible();
  expect(submittedPayload).toContain('dragged-resume.txt');
  await expect(page.getByRole('link', { name: '查看内推进度' })).toHaveAttribute('href', /referral_tracking=drag_track/);
});

for (const width of [320, 390, 768, 1440]) {
  test(`invitation presentation keeps details and preparation readable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockFixture(page, { ...fixtures[0], data: { ...fixtures[0].data, endAt: '2026-10-15T03:00:00Z', note: '请准备作品集。\n期待与你交流。', location: '山东省烟台市莱山区方片新媒体 · 三层会议室' } });
    await expect(page.getByRole('heading', { name: '与你的面试安排' })).toBeVisible();
    await expect(page.locator('.rf-public-interview-card')).toContainText('北京时间');
    await expect(page.locator('.rf-public-interview-card')).toContainText('结束于');
    await expect(page.getByRole('button', { name: '无法参加，取消面试' })).toHaveCount(0);
    await expectContained(page);
    const button = page.getByRole('button', { name: '提交基本信息' });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect(await button.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath('invitation-full.png'), fullPage: true });
  });
}

test('invitation saves the bound candidate information and retains rescheduling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFixture(page, fixtures[0]);
  let submitted;
  await page.route('**/api/public/interviews/mobile/preparation', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/public/interviews/mobile', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...fixtures[0].data, confirmationStatus: '已确认', preparationStatus: '已提交', candidateProfile: submitted?.profile || {} }) }));
  await page.locator('[name="phone"]').fill('13800000000');
  await page.locator('[name="age"]').fill('29');
  await page.locator('[name="yearsOfExperience"]').fill('5年');
  await page.locator('[name="highestEducation"]').selectOption('本科');
  await page.locator('[name="gender"]').selectOption('女');
  await page.getByRole('button', { name: '提交基本信息' }).click();
  await expect(page.getByRole('heading', { name: '面试已安排' })).toBeVisible();
  expect(submitted.confirm).toBe(undefined);
  expect(submitted.profile.phone).toBe('13800000000');
  await expect(page.locator('.rf-public-reschedule')).toBeHidden();
  await page.getByRole('button', { name: '时间不便，申请改期' }).click();
  await expect(page.locator('#rf-public-reschedule-reason')).toBeFocused();
});

for (const width of [320, 768]) {
  test(`invitation email HTML fits ${width}px and keeps its secure CTA`, async ({ page }, testInfo) => {
    const { InterviewsService } = await import('../dist/modules/interviews/interviews.service.js');
    const service = new InterviewsService({}, {}, {});
    const link = `https://example.test/?interview_token=${'secure-token-'.repeat(8)}`;
    const html = service.candidateEmailContent({ fields: { 开始时间: '2026-10-15T02:00:00Z', 面试地点: '山东省烟台市莱山区方片新媒体', 面试轮次: '一面', 备注: '请准备作品集。\n期待与你交流。' } }, { fields: { 姓名: '林悦' } }, link);
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(`<body style="margin:0;padding:0;background:#e9e6dd;">${html}`);
    await expect(page.getByRole('heading', { name: '面试邀请' })).toBeVisible();
    await expect(page.getByRole('link', { name: '查看面试安排' })).toHaveAttribute('href', link);
    await expect(page.getByRole('link', { name: '查看面试安排' })).toBeVisible();
    await expect(page.locator('body')).toContainText('面试邀请');
    await expectContained(page);
    await page.screenshot({ path: testInfo.outputPath('invitation-email.png'), fullPage: true });
  });
}

for (const width of [320, 768]) {
  test(`offer and rejection email HTML fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const offerHtml = candidateEmailCard({
      candidateName: '周敏',
      title: '录用通知书',
      brandSub: 'FANGPIAN · OFFER',
      intro: ['我们很高兴通知你通过面试。请在专属页面查看完整录用通知书，并在有效期内确认答复。'],
      details: [
        { label: '应聘岗位', value: '高级产品经理' },
        { label: '所属部门', value: '产品部' },
        { label: '工作地点', value: '浙江省杭州市西湖区示例园区 88 号 9 层' },
        { label: '计划入职', value: '2026年10月20日' },
        { label: 'Offer编号', value: 'FP-20261010-000001' },
      ],
      note: '请于三个工作日内确认。',
      primaryLink: { label: '查看并确认Offer', href: `https://example.test/?offer_token=${'offer-token-'.repeat(8)}` },
      secondaryLinks: [{ label: '查看Offer PDF', href: 'https://files.example.test/offer.pdf' }],
    });
    await page.setContent(`<body style="margin:0;padding:0;background:#f5f4f1;">${offerHtml}`);
    await expect(page.getByRole('heading', { name: '录用通知书' })).toBeVisible();
    await expect(page.getByRole('link', { name: '查看并确认Offer' })).toBeVisible();
    await expectContained(page);

    const rejectionHtml = candidateEmailCard({
      candidateName: '林悦',
      title: '面试结果通知',
      intro: ['感谢你参加方片新媒体一面面试。经过综合评估，本次面试结果为暂不通过。', '感谢你对方片新媒体的关注，祝你后续求职顺利。'],
      details: [{ label: '面试轮次', value: '一面' }, { label: '面试结果', value: '暂不通过' }],
      note: '当前岗位匹配度不足，感谢你投入时间。',
      noteTitle: '结果说明',
    });
    await page.setContent(`<body style="margin:0;padding:0;background:#f5f4f1;">${rejectionHtml}`);
    await expect(page.getByRole('heading', { name: '面试结果通知' })).toBeVisible();
    await expect(page.getByText('暂不通过', { exact: true })).toBeVisible();
    await expectContained(page);
  });
}

test('journey invitation offers reschedule but no candidate cancel action', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockFixture(page, fixtures.find(item => item.name === 'invitation'));
  await expect(page.getByRole('button', { name: '时间不便，申请改期' })).toBeVisible();
  await expect(page.getByRole('button', { name: '无法参加，取消面试' })).toHaveCount(0);
});

test('journey writer expansion and section navigation retain evaluation text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFixture(page, fixtures.find(item => item.name === 'evaluation'));
  const field = page.locator('textarea[name="transcript"]');
  await field.fill('候选人讲述了自己的项目成果和沟通方式。');
  await page.getByRole('button', { name: '展开输入区' }).click();
  expect((await field.boundingBox()).height).toBeGreaterThan(400);
  await page.getByRole('button', { name: '收起输入区' }).click();
  await page.getByRole('navigation', { name: '填写导航' }).getByRole('button', { name: '面试结论', exact: true }).click();
  await expect(page.locator('[data-combobox-for="recommendation"] input')).toBeFocused();
  await expect(field).toHaveValue('候选人讲述了自己的项目成果和沟通方式。');
});

test('journey review gives inline validation and keeps the selected position for retry', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const data = { viewer: { name: '陈经理', departments: ['产品部'] }, candidate: { name: '林悦', skills: [], matches: [], analysis: {} }, positions: [{ id: 'pos_one', name: '产品经理', department: '产品部' }] };
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.goto(`${baseUrl}talent-review.html?token=mobile`);
  await page.getByRole('button', { name: '查看后填写评审' }).click();
  await page.getByRole('button', { name: '提交评审意见' }).click();
  await expect(page.locator('#review-feedback')).toContainText('请选择准备面试的岗位');
  await expect(page.locator('#position')).toBeFocused();
  await page.locator('#position').fill('产品经理 · 产品部');
  await page.locator('[data-review-position="pos_one"]').click();
  let attempts = 0;
  await page.route('**/api/public/talent-reviews/mobile/respond', async route => {
    attempts++;
    await route.fulfill({ status: attempts === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { message: '网络暂不可用' } : { processing: '已认领并进入约面' }) });
  });
  await page.getByRole('button', { name: '提交评审意见' }).click();
  await expect(page.locator('#review-feedback')).toContainText('已保留你的选择');
  await expect(page.locator('#position')).toHaveValue('产品经理 · 产品部');
  await page.getByRole('button', { name: '提交评审意见' }).click();
  await expect(page.getByRole('heading', { name: '意见已提交' })).toBeInViewport();
  await expectContained(page);
});

test('journey referral upload disables repeat submission and retains the file for retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFixture(page, fixtures.find(item => item.name === 'referral'));
  await page.locator('[name="candidateName"]').fill('林悦');
  await page.locator('[name="candidatePhone"]').fill('13800138000');
  await page.locator('[name="file"]').setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('测试简历') });
  await page.locator('[name="consent"]').check();
  let attempts = 0;
  await page.route('**/api/public/referrals/mobile/submit', async route => {
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ status: attempts === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { message: '上传失败' } : { jobId: 'job_test' }) });
  });
  await page.route('**/api/jobs/job_test', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', data: { trackingPath: '?referral_tracking=track_test', status: '待评审', duplicateStatus: '未重复' } }) }));
  const submit = page.getByRole('button', { name: '提交内推简历' });
  await submit.click();
  await expect(page.locator('[data-public-ref-submit]')).toBeDisabled();
  await expect(page.locator('#rf-public-ref-message')).toContainText('所选文件仍保留');
  expect(await page.locator('[name="file"]').evaluate(node => node.files[0].name)).toBe('resume.txt');
  expect(attempts).toBe(1);
  await submit.click();
  await expect(page.getByText('内推简历已提交', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看内推进度' })).toHaveAttribute('href', /referral_tracking=track_test/);
  expect(attempts).toBe(2);
});

test('journey assessment locates unanswered questions and preserves automatic saving', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFixture(page, fixtures.find(item => item.name === 'assessment'));
  let saved;
  await page.route('**/api/public/assessments/mobile/answers', async route => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ completion: 100 }) });
  });
  await page.route('**/api/public/assessments/mobile/submit', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ durationSeconds: 60 }) }));
  const map = page.getByRole('navigation', { name: '填写导航' });
  await expect(map).toContainText('必答题 0 / 2');
  await map.getByRole('button', { name: '定位待填项' }).click();
  const answer = page.locator('[data-question-id="question1"] textarea');
  await expect(answer).toBeFocused();
  await answer.fill('独立推进并交付产品项目。');
  await page.getByLabel('主动沟通', { exact: true }).check();
  await expect(map).toContainText('必答题 2 / 2');
  await expect(page.locator('#rf-public-save-status')).toContainText('已自动保存');
  expect(saved.answers[0]).toEqual({ questionId: 'question1', value: '独立推进并交付产品项目。' });
  await page.getByRole('button', { name: '正式提交测评' }).click();
  await expect(page.getByText('测评已正式提交')).toBeVisible();
});

test('journey arrival confirmation submits the existing payload', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockFixture(page, fixtures.find(item => item.name === 'onboarding'));
  let submitted;
  await page.route('**/api/employee-lifecycle/onboarding/arrival/public**', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.locator('[name="arrived"]').selectOption('yes');
  await page.locator('[name="note"]').fill('已经办理入职。');
  await page.getByRole('button', { name: '提交到岗确认' }).click();
  await expect(page.getByText('到岗状态已提交')).toBeVisible();
  expect(submitted).toMatchObject({ arrived: true, actualDate: '2026-10-20', probationMonths: 3, note: '已经办理入职。' });
});

for (const width of [320, 390]) {
  test(`journey legacy career and room pages remain navigable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${baseUrl}${encodeURIComponent('方片招聘网站原型.html')}`);
    await page.locator('.top-nav').getByRole('link', { name: '热招岗位' }).click();
    await page.locator('#job-search').fill('产品');
    await expect(page.locator('#job-grid')).toContainText('校招产品培训生');
    await expectContained(page);
    await page.screenshot({ path: testInfo.outputPath('careers.png') });
    await page.goto(`${baseUrl}${encodeURIComponent('会议室预订原型.html')}`);
    await page.locator('#openBook').click();
    await expect(page.locator('#bookingForm')).toBeVisible();
    await page.locator('#subject').fill('测试预订草稿');
    await expect(page.locator('#subject')).toHaveValue('测试预订草稿');
    await expectContained(page);
    await page.screenshot({ path: testInfo.outputPath('room-booking.png') });
    await page.locator('#cancelBook').click();
    await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  });
}
