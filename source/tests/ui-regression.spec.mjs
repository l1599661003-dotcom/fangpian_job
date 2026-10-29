import { test, expect } from '/usr/lib/node_modules/playwright/test.mjs';

const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:4178/';

async function openInterviewerPicker(page) {
  const details = page.locator('#rf-interviewer-picker details');
  if (!(await details.getAttribute('open'))) await page.locator('.rf-interviewer-trigger').click();
}

test('legacy prototype pages use the searchable select component', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}方片招聘网站原型.html`, { waitUntil: 'networkidle' });
  const typeCombobox = page.locator('[data-combobox-for="filter-type"]');
  await expect(typeCombobox.locator('input')).toBeVisible();
  await typeCombobox.locator('input').fill('校招');
  await expect(typeCombobox.locator('.rf-combobox-option')).toHaveCount(1);
  await typeCombobox.locator('.rf-combobox-option').click();
  await expect(page.locator('#filter-type')).toHaveValue('校招');

  await page.goto(`${baseUrl}会议室预订原型.html`, { waitUntil: 'networkidle' });
  const locationCombobox = page.locator('[data-combobox-for="locationFilter"]');
  await expect(locationCombobox.locator('input')).toBeVisible();
  await locationCombobox.locator('input').fill('F3');
  await expect(locationCombobox.locator('.rf-combobox-option')).toHaveCount(1);
  await locationCombobox.locator('.rf-combobox-option').click();
  await expect(page.locator('#locationFilter')).toHaveValue('F3');
});

test('searchable select lists every option on focus without clearing the chosen value', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}方片招聘网站原型.html`, { waitUntil: 'networkidle' });
  const typeCombobox = page.locator('[data-combobox-for="filter-type"]');
  const totalOptions = await page.locator('#filter-type option').count();
  await typeCombobox.locator('input').fill('校招');
  await typeCombobox.locator('.rf-combobox-option').click();
  await expect(page.locator('#filter-type')).toHaveValue('校招');
  await typeCombobox.locator('input').click();
  await expect(typeCombobox.locator('input')).toHaveValue('校招');
  await expect(typeCombobox.locator('.rf-combobox-option')).toHaveCount(totalOptions);
  await expect(typeCombobox.locator('.rf-combobox-option.is-active')).toContainText('校招');
});

test('native selects and interviewer picker use searchable input selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  await page.route('**/api/interviews/interviewers', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ interviewers: [
    { id: 'product_manager', name: '产品面试官', department: '产品部', roles: ['产品经理'], wecomUserId: 'product_manager' },
    { id: 'operation_manager', name: '运营面试官', department: '运营部', roles: ['运营经理'], wecomUserId: 'operation_manager' },
    { id: 'finance_manager', name: '财务面试官', department: '财务部', roles: ['财务经理'], wecomUserId: 'finance_manager' },
  ] }) }));
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });

  const roundCombobox = page.locator('[data-combobox-for="rf-interview-round"]');
  await expect(roundCombobox.locator('input')).toBeVisible();
  await roundCombobox.locator('input').fill('二面');
  await expect(roundCombobox.locator('.rf-combobox-option')).toHaveCount(1);
  await roundCombobox.locator('.rf-combobox-option').click();
  await expect(page.locator('#rf-interview-round')).toHaveValue('二面');

  await openInterviewerPicker(page);
  await page.locator('#rf-show-all-interviewers').click();
  await page.locator('#rf-interviewer-search').fill('运营');
  await expect(page.locator('[data-rf-interviewer-option]:visible')).toHaveCount(1);
  await page.locator('[data-rf-interviewer-option]:visible input').check();
  await expect(page.locator('#rf-interviewer-summary')).toContainText('运营面试官');
});

test('talent revisit paints the cached page before revalidation and refresh bypasses the cache', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  let reads = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const urls = [];
  await page.route('**/api/talents?**', async route => {
    const current = ++reads;
    urls.push(new URL(route.request().url()));
    if (current === 2) await pending;
    await route.fulfill({ json: { talents: [{ id: 'cache_candidate', name: current === 1 ? '缓存候选人' : '更新候选人', skills: [], tags: [], matches: [] }], total: 1, page: 1, pageSize: 25, totalPages: 1 } });
  });
  try {
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('resume-archive'));
    await expect(page.locator('[data-rf-talent="cache_candidate"]')).toContainText('缓存候选人');
    await page.evaluate(() => window.setPage('offers'));
    await page.evaluate(() => window.setPage('resume-archive'));
    await expect.poll(() => reads).toBe(2);
    await expect(page.locator('[data-rf-talent="cache_candidate"]')).toContainText('缓存候选人');
    await expect(page.locator('.rf-archive-loading')).toHaveCount(0);
    release();
    await expect(page.locator('[data-rf-talent="cache_candidate"]')).toContainText('更新候选人');
    await page.getByRole('button', { name: '刷新人才列表', exact: true }).click();
    await expect.poll(() => urls.some(url => url.searchParams.get('refresh') === '1')).toBe(true);
    await expect(page.locator('[data-rf-talent="cache_candidate"]')).toContainText('更新候选人');
  } finally { release(); }
});

test('unchanged talent revalidation preserves the rendered cards', async ({ page }) => {
  await installApiMocks(page);
  let reads = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/talents?**', async route => {
    if (++reads === 2) await pending;
    await route.fulfill({ json: { talents: [{ id: 'stable_candidate', name: '稳定候选人', skills: [], tags: [], matches: [] }], total: 1, page: 1, pageSize: 25, totalPages: 1 } });
  });
  try {
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('resume-archive'));
    await expect(page.locator('[data-rf-talent="stable_candidate"]')).toBeVisible();
    await page.evaluate(() => window.setPage('offers'));
    await page.evaluate(() => window.setPage('resume-archive'));
    await expect.poll(() => reads).toBe(2);
    await page.locator('[data-rf-talent="stable_candidate"]').evaluate(node => node.dataset.cachePreserved = 'true');
    release();
    await expect(page.locator('#rf-search-submit')).toBeEnabled();
    await expect(page.locator('[data-rf-talent="stable_candidate"]')).toHaveAttribute('data-cache-preserved', 'true');
  } finally { release(); }
});

test('Wecom review dialog refreshes responses submitted outside the app', async ({ page }) => {
  await installApiMocks(page);
  let detailReads = 0;
  await page.route('**/api/talents/talent_a', async route => {
    detailReads += 1;
    return route.fulfill({ json: {
      id: 'talent_a',
      candidateId: 'talent_a',
      name: '林悦',
      status: '待业务群评审',
      owner: '王HR',
      skills: ['产品规划'],
      tags: [],
      matches: [],
      timeline: [],
      communications: [],
      reviews: [],
      assessmentResults: [],
      latestResumeId: 'resume_a',
      analysis: { id: 'ai_1', summary: '具备产品规划经验。', scores: { overall: 88 }, recommendedRoles: ['产品经理'] },
      wecomReviews: detailReads === 1 ? [] : [{
        status: '已认领',
        claimedDepartment: '财务',
        responseCount: 1,
        responses: [{
          decision: '适合',
          reviewer: '张杰',
          department: '财务',
          position: '总账会计',
          comment: '履历与岗位要求匹配。',
          submittedAt: '2026-09-29 06:07',
          processing: '已入库',
        }],
      }],
    } });
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  const talentDetail = page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') });
  await expect(talentDetail).toBeVisible();
  expect(detailReads).toBe(1);
  const reviewStep = talentDetail.locator('#rf-detail-evaluation article').filter({ hasText: '业务群评审' }).first();
  await reviewStep.getByRole('button').click({ force: true });
  await expect(page.getByRole('heading', { name: '推送企微评审' })).toBeVisible();
  await expect(page.locator('.rf-wecom-response-list')).toContainText('张杰');
  await expect(page.locator('.rf-wecom-response-list')).toContainText('适合');
  expect(detailReads).toBe(2);
});

test('talent archive can rename the talent from more actions', async ({ page }) => {
  await installApiMocks(page);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let renamed = false;
  let patchBody;
  await page.route('**/api/talents/talent_a', async route => {
    return route.fulfill({ json: {
      id: 'talent_a', candidateId: 'talent_a', status: '约面', owner: '王HR',
      skills: ['产品规划'], tags: [], matches: [], timeline: [], communications: [], reviews: [], assessmentResults: [],
      latestResumeId: 'resume_a', name: renamed ? '林小悦' : '林悦',
      sourceFileUrl: 'https://cdn.example.test/linyue.png',
      analysis: { id: 'ai_1', summary: '具备产品规划经验。', scores: { overall: 88 }, recommendedRoles: ['产品经理'] },
    } });
  });
  await page.route('**/api/talents/talent_a/name', async route => {
    patchBody = route.request().postDataJSON();
    renamed = true;
    return route.fulfill({ json: { candidateId: 'talent_a', name: '林小悦', updatedAt: '2026-10-15T00:00:00.000Z', talent: { id: 'talent_a', candidateId: 'talent_a', name: '林小悦', status: '约面', skills: [], tags: [], matches: [], timeline: [] } } });
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '修改人才名称', exact: true }).click();
  await expect(page.getByRole('heading', { name: '修改人才名称' })).toBeVisible();
  await page.locator('#rf-talent-name').fill('林小悦');
  await page.locator('#rf-talent-name').press('Enter');

  await expect(page.locator('.rf-notification.success')).toContainText('人才名称已更新：林小悦');
  await expect(page.locator('#rf-talent-dialog .rf-full-detail-dialog')).toBeVisible();
  expect(patchBody).toEqual({ name: '林小悦' });
  expect(pageErrors).toEqual([]);
});

test('talent cached cards are removed on forbidden revalidation without loading legacy resumes', async ({ page }) => {
  await installApiMocks(page);
  let reads = 0, legacyReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/api/resumes')) legacyReads++; });
  await page.route('**/api/talents?**', async route => {
    if (++reads > 1) return route.fulfill({ status: 403, json: { message: '人才查看权限已被撤销' } });
    return route.fulfill({ json: { talents: [{ id: 'cache_secret', name: '不应保留的候选人', skills: [], tags: [], matches: [] }], total: 1, page: 1, pageSize: 25, totalPages: 1 } });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('[data-rf-talent="cache_secret"]')).toBeVisible();
  await page.evaluate(() => window.setPage('offers'));
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('#resumeflow-archive-root')).toContainText('人才查看权限已被撤销');
  await expect(page.locator('[data-rf-talent="cache_secret"]')).toHaveCount(0);
  expect(legacyReads).toBe(0);
});

test('Offer history loads without candidate summaries or template requests until template management opens', async ({ page }) => {
  await installApiMocks(page);
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  const requests = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.evaluate(() => window.setPage('offers'));
  await expect(page.locator('#offer-management-root')).toContainText('Offer历史记录');
  expect(requests.some(path => path.endsWith('/api/talents'))).toBe(false);
  expect(requests.some(path => path.endsWith('/api/offers/templates'))).toBe(false);
  expect(requests.some(path => path.endsWith('/api/recruitment/position-options'))).toBe(false);
  await page.locator('#page-offers [data-action="offer-template-manager"]').click();
  await expect(page.locator('#offer-management-root')).toContainText('模板基本信息');
  expect(requests.some(path => path.endsWith('/api/offers/templates'))).toBe(true);
});

test('talent archive can create an Offer for a position without an existing application', async ({ page }) => {
  await installApiMocks(page);
  let offerPayload;
  await page.route('**/api/recruitment/position-options', route => route.fulfill({ json: { positions: [
    { id: 'pos_pm', name: '产品经理', department: '产品部', location: '杭州', status: '已发布', recruitmentStatus: '招聘中' },
    { id: 'pos_any', name: '运营专员', department: '运营部', location: '山东省烟台市', status: '已发布', recruitmentStatus: '招聘中' },
  ] } }));
  await page.route('**/api/offers', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { offers: [] } });
    offerPayload = route.request().postDataJSON();
    return route.fulfill({ json: {
      offerId: 'offer_any_position', offerNumber: 'FP-ANY-001', fileName: 'offer-any.pdf',
      fileUrl: 'https://cdn.example.test/offer-any.pdf', status: '待发送', templateType: '社招',
    } });
  });

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  await expect(page.locator('#rf-talent-dialog')).toContainText('林悦');
  await page.locator('[data-action="open-offer"]').click();
  await expect(page.locator('#rf-talent-offer-form')).toBeVisible();
  await page.locator('#rf-offer-honorific').selectOption('女士');
  await page.locator('#rf-offer-role').selectOption('pos_any');
  await page.locator('#rf-offer-base').fill('5000');
  await page.locator('#rf-offer-reporting-to').fill('张总');
  await page.getByRole('button', { name: '生成并预览' }).click();

  await expect(page.locator('.rf-offer-preview-summary')).toContainText('运营专员');
  await expect(page.locator('.rf-offer-preview-summary')).toContainText('林悦');
  expect(offerPayload).toMatchObject({ candidateId: 'talent_a', positionId: 'pos_any', role: '运营专员', department: '运营部', baseSalary: 5000, reportingTo: '张总', candidateHonorific: '女士' });
  await expect(page.locator('#rf-talent-offer-form')).toHaveCount(0);
});

test('talent archive Offer with email unchecked skips the preview and waits for manual sending in Offer management', async ({ page }) => {
  await installApiMocks(page);
  let offerPayload;
  let mailAttempts = 0;
  const savedOffer = { id: 'offer_unsent', offerId: 'offer_unsent', candidateId: 'talent_a', candidateName: '林悦', candidateEmail: 'linyue@example.com', role: '运营专员', department: '运营部', location: '山东省烟台市', offerNumber: 'FP-UNSENT-001', fileName: 'offer-unsent.pdf', fileUrl: 'https://cdn.example.test/offer-unsent.pdf', status: '待发送', sendStatus: '未发送', templateType: '社招' };
  await page.route('**/api/recruitment/position-options', route => route.fulfill({ json: { positions: [
    { id: 'pos_any', name: '运营专员', department: '运营部', location: '山东省烟台市', status: '已发布', recruitmentStatus: '招聘中' },
  ] } }));
  await page.route('**/api/offers', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { offers: offerPayload ? [savedOffer] : [] } });
    offerPayload = route.request().postDataJSON();
    return route.fulfill({ json: savedOffer });
  });
  await page.route('**/api/offers/offer_unsent/send-email', async route => {
    mailAttempts++;
    return route.fulfill({ json: { recipient: 'linyue@example.com' } });
  });

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  await page.locator('[data-action="open-offer"]').click();
  await expect(page.locator('#rf-talent-offer-form')).toBeVisible();
  await page.locator('#rf-offer-honorific').selectOption('女士');
  await page.locator('#rf-offer-role').selectOption('pos_any');
  await page.locator('#rf-offer-base').fill('5000');
  await page.locator('#rf-offer-reporting-to').fill('张总');
  await page.locator('#rf-talent-offer-form [data-offer-email-option]').uncheck();
  await expect(page.getByRole('button', { name: '生成 Offer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '生成 Offer', exact: true }).click();

  await expect(page.locator('#offer-management-root')).toContainText('林悦');
  await expect(page.locator('#rf-talent-offer-form')).toHaveCount(0);
  await expect(page.locator('.rf-offer-preview-send')).toHaveCount(0);
  expect(offerPayload).toMatchObject({ candidateId: 'talent_a', positionId: 'pos_any', baseSalary: 5000, reportingTo: '张总', candidateHonorific: '女士' });
  expect(mailAttempts).toBe(0);
  await page.getByRole('button', { name: '发送给候选人', exact: true }).click();
  await expect(page.locator('#rf-talent-dialog')).toContainText('发送录用通知书');
  expect(mailAttempts).toBe(0);
});

test('Offer adjustment reopens every editable field and regenerates the PDF before preview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  let patchPayload;
  await page.route('**/api/recruitment/position-options', route => route.fulfill({ json: { positions: [
    { id: 'pos_any', name: '商务提报', department: '商务部', location: '山东省烟台市', status: '已发布', recruitmentStatus: '招聘中' },
    { id: 'pos_ops', name: '运营专员', department: '运营部', location: '山东省烟台市', status: '已发布', recruitmentStatus: '招聘中' },
  ] } }));
  await page.route('**/api/offers', route => route.fulfill({ json: { offers: [{
    id: 'offer_adjust', candidateId: 'talent_a', candidateName: '林悦', candidateEmail: 'lin@example.test',
    positionId: 'pos_any', templateId: 'offer_tpl_social', templateType: '社招', role: '商务提报', department: '商务部',
    location: '山东省烟台市', startDate: '2026-11-02', reportingTo: '张总', validFrom: '2026-10-20', validTo: '2026-11-02',
    candidateHonorific: '女士', probationMonths: '3个月，试用期薪资100%', baseSalary: 9000, dailySalary: 0,
    performanceSalary: 1500, performanceIncluded: true, commission: 0, commissionIncluded: false,
    status: '待发送', approvalStatus: '已通过', version: 1, fileUrl: 'https://cdn.example.test/offer-old.pdf',
    sendStatus: '待人工发送', response: '', updatedAt: '2026-10-22T00:00:00.000Z',
  }] } }));
  await page.route('**/api/offers/offer_adjust', route => {
    patchPayload = route.request().postDataJSON();
    return route.fulfill({ json: {
      offerId: 'offer_adjust', offerNumber: 'FP-ADJ-001', fileName: 'offer-new.pdf',
      fileUrl: 'https://cdn.example.test/offer-new.pdf', status: '待发送', templateType: '社招', version: 2,
    } });
  });

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('offers'));
  await page.getByRole('button', { name: '调整薪资', exact: true }).click();
  await expect(page.locator('#offer-management-root h2')).toHaveText('修改 Offer');
  await expect(page.locator('#rf-offer-candidate')).toBeDisabled();
  await expect(page.locator('#rf-offer-candidate')).toHaveValue('talent_a');
  await expect(page.locator('#rf-offer-honorific')).toHaveValue('女士');
  await expect(page.locator('#rf-offer-role')).toHaveValue('pos_any');
  await expect(page.locator('#rf-offer-department')).toHaveValue('商务部');
  await expect(page.locator('#rf-offer-department')).toHaveAttribute('readonly', '');
  await expect(page.locator('#rf-offer-location')).toHaveValue('山东省烟台市');
  await expect(page.locator('#rf-offer-start')).toHaveValue('2026-11-02');
  await expect(page.locator('#rf-offer-reporting-to')).toHaveValue('张总');
  await expect(page.locator('#rf-offer-valid-from')).toHaveValue('2026-10-20');
  await expect(page.locator('#rf-offer-valid-to')).toHaveValue('2026-11-02');
  await expect(page.locator('#rf-offer-base')).toHaveValue('9000');
  await expect(page.locator('#rf-offer-performance-included')).toBeChecked();
  await expect(page.locator('#rf-offer-performance')).toHaveValue('1500');
  await expect(page.locator('#rf-offer-probation')).toHaveValue('3个月，试用期薪资100%');
  await expect(page.locator('#offer-management-root')).not.toContainText('谈薪结果');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.locator('#rf-offer-base').fill('9800');
  await page.locator('#rf-offer-reporting-to').fill('李总');
  await page.locator('#rf-offer-role').selectOption('pos_ops');
  await expect(page.locator('#rf-offer-department')).toHaveValue('运营部');
  await page.getByRole('button', { name: '重新生成 PDF 并预览', exact: true }).click();

  await expect(page.locator('.rf-offer-preview-summary')).toContainText('运营专员');
  await expect(page.locator('.rf-offer-preview-summary')).toContainText('林悦');
  expect(patchPayload).toMatchObject({
    candidateId: 'talent_a', positionId: 'pos_ops', role: '运营专员', department: '运营部', location: '山东省烟台市',
    baseSalary: 9800, performanceSalary: 1500, reportingTo: '李总', candidateHonorific: '女士', templateId: 'offer_tpl_social',
    validFrom: '2026-10-20', validTo: '2026-11-02', probationMonths: '3个月，试用期薪资100%',
  });
});

test('Offer history and template buttons work after talent loading falls back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await page.route('**/api/talents?**', route => route.fulfill({ status: 503, json: { message: '人才暂不可用' } }));
  await page.route('**/api/offers', route => route.fulfill({ json: { offers: [{ id: 'offer_retry', candidateName: '测试候选人', sendStatus: '草稿' }] } }));
  let generated = 0;
  await page.route('**/api/offers/offer_retry/generate-file', route => {
    generated++;
    return route.fulfill({ json: {} });
  });
  let savedTemplate;
  await page.route('**/api/offers/templates', route => {
    if (route.request().method() === 'POST') {
      savedTemplate = { ...route.request().postDataJSON(), id: 'new_template' };
      return route.fulfill({ json: { id: savedTemplate.id } });
    }
    return route.fulfill({ json: { templates: savedTemplate ? [savedTemplate] : [{ id: 'original_template', name: '原模板', type: '社招', fields: [] }] } });
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('#resumeflow-archive-root')).toContainText('统一人才接口暂时无法读取');
  await page.evaluate(() => window.setPage('offers'));
  await expect(page.locator('#offer-management-root')).toContainText('测试候选人');
  await page.getByRole('button', { name: '重新生成PDF', exact: true }).click();
  await expect.poll(() => generated).toBe(1);
  await page.locator('#page-offers [data-action="offer-template-manager"]').click();
  await expect(page.locator('#offer-management-root')).toContainText('模板基本信息');
  await page.locator('[data-template-create]').first().click();
  await expect(page.locator('[data-rf-save-offer-template]')).toHaveText('创建模板');
  await page.locator('#rf-template-name').fill('测试新模板');
  await page.locator('[data-rf-save-offer-template]').click();
  await expect(page.locator('[data-rf-save-offer-template]')).toHaveText('保存模板');
  await expect(page.locator('#rf-template-name')).toHaveValue('测试新模板');
  expect(savedTemplate.name).toBe('测试新模板');
  await page.locator('[data-offer-template-back]:visible').first().click();
  await expect(page.locator('#offer-management-root')).toContainText('测试候选人');
});

test('Offer templates open independently of pending history and are not overwritten by it', async ({ page }) => {
  await installApiMocks(page);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/offers', async route => {
    await pending;
    await route.fulfill({ json: { offers: [] } });
  });
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('offers'));
    await expect(page.locator('#offer-management-root')).toContainText('正在读取 Offer 记录');
    await page.locator('#page-offers [data-action="offer-template-manager"]').click();
    await expect(page.locator('#offer-management-root')).toContainText('模板基本信息');
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/offers'));
    release();
    await response;
    await page.locator('#rf-template-name').fill('保留编辑内容');
    await expect(page.locator('#rf-template-name')).toHaveValue('保留编辑内容');
  } finally { release(); }
});

test('Offer history and templates show retryable errors in the Offer page', async ({ page }) => {
  await installApiMocks(page);
  let historyReads = 0, templateReads = 0;
  await page.route('**/api/offers', route => ++historyReads === 1
    ? route.fulfill({ status: 503, json: { message: 'Offer暂不可用' } })
    : route.fulfill({ json: { offers: [] } }));
  await page.route('**/api/offers/templates', route => ++templateReads === 1
    ? route.fulfill({ status: 503, json: { message: '模板暂不可用' } })
    : route.fulfill({ json: { templates: [] } }));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('offers'));
  await expect(page.locator('#offer-management-root')).toContainText('Offer管理读取失败');
  await page.locator('[data-rf-offer-retry]').click();
  await expect(page.locator('#offer-management-root')).toContainText('Offer历史记录');
  await page.locator('#page-offers [data-action="offer-template-manager"]').click();
  await expect(page.locator('#offer-management-root')).toContainText('Offer模板读取失败');
  await page.locator('[data-template-retry]').click();
  await expect(page.locator('[data-rf-save-offer-template]')).toHaveText('创建模板');
  await page.locator('[data-offer-template-back]:visible').first().click();
  await expect(page.locator('#offer-management-root')).toContainText('Offer历史记录');
});

test('developer documentation remains visible while API configuration is still pending', async ({ page }) => {
  await installApiMocks(page);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/resumes/api-config', async route => {
    await pending;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '配置服务暂不可用' }) });
  });
  try {
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('resume-api'));
    await expect(page.locator('#resumeflow-api-root')).toContainText('X-API-Key');
    await expect(page.locator('#resumeflow-api-root .rf-api-loading')).toHaveCount(0);
    release();
    await expect(page.locator('#rf-api-config-retry')).toBeVisible();
  } finally { release(); }
});

const administration = {
  roles: [
    { code: 'legacy_role', name: '历史角色', level: 'L1', dataScope: 'self', pages: ['referrals'], actions: [], sensitiveFields: {}, status: '停用' },
    { code: 'system_admin', name: '总经办HR', level: 'L4', dataScope: 'all', pages: ['*'], actions: ['*'], sensitiveFields: { contacts: 'full' }, status: '启用' },
    { code: 'recruiter', name: '招聘专员', level: 'L2', dataScope: 'assigned_departments', pages: ['candidates'], actions: ['edit_candidate'], sensitiveFields: { contacts: 'masked' }, status: '启用' },
  ],
  users: [{ id: 'admin_1', name: '系统管理员', businessUnit: '第一事业部', departmentIds: ['dept_a'], status: '启用' }],
  organizations: [{ id: 'bu_1', type: '事业部', name: '第一事业部', status: '启用' }, { id: 'dept_a', type: '部门', name: '产品部', parentId: 'bu_1', status: '启用' }],
  bindings: [{ id: 'binding_admin', userId: 'admin_1', userName: '系统管理员', roleCode: 'system_admin', businessUnit: '第一事业部', departmentIds: ['dept_a'], status: '启用' }],
  sensitiveRequests: [{ id: 'unlock_1', applicantUserId: 'hrbp_1', applicant: '业务HRBP', candidateId: 'talent_a', fields: ['contacts', 'resume'], reason: 'Offer沟通前核对候选人联系方式', status: '待审批', createdAt: '2026-08-28T10:00:00.000Z' }],
};

async function installApiMocks(page, overrides = {}) {
  let birthCorrected = false, wordConverted = false, versionActivated = false, batchRetried = false, aiRerun = false, aiCorrected = false, jobRematched = false, resumeDeleted = false, aiRerunPolls = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', identitySource: 'studio', userId: 'admin_1', userName: '系统管理员', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }], sensitiveFields: [{ roleCode: 'system_admin', contacts: 'full' }], account: { id: 'admin_1', name: '系统管理员', mobile: '13800138000', businessUnit: '第一事业部', departments: ['产品部'], status: '启用' } }) });
    if (path.endsWith('/api/health/system')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ service: 'fangpian-talent-management', version: '1.0.0', environment: 'test', runtime: { node: 'v20.19.0', platform: 'linux', architecture: 'x64', uptimeSeconds: 300, startedAt: '2026-08-28T10:00:00.000Z', productionEntry: 'dist/main.js', productionEntryPresent: true, staticClientPresent: true }, build: { packageManager: 'pnpm@9.15.9' }, dependencies: [{ name: '@nestjs/core', version: '^10.4.0' }], configuration: { platformUrl: true, appToken: true, teableBinding: true, accessControlMode: 'strict', trustedIdentityHeaders: { userId: 'x-studio-user-id', userName: 'x-studio-user-name' } }, database: { status: 'ready', ready: true, expectedTables: 87, initializedTables: 87 }, checkedAt: '2026-08-28T10:05:00.000Z' }) });
    if (path.endsWith('/api/talents/ai-monitoring')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rangeDays: 30, generatedAt: '2026-08-28T15:00:00.000Z', pricingConfigured: false, costBasis: '按字符数÷4估算Token；未配置模型单价，成本暂记0元', summary: { total: 3, success: 2, fallback: 1, failed: 1, successRate: 66.7, averageDurationMs: 1320, p95DurationMs: 1880, inputTokens: 6300, outputTokens: 920, estimatedCost: 0 }, alerts: [{ level: '高', type: '失败率', message: '近30天AI非成功率33.3%，建议检查平台LLM配置和错误明细。' }, { level: '中', type: '规则降级', message: '1次分析使用规则降级，结果需要优先人工复核。' }], errors: [{ message: '模拟平台LLM暂时不可用', count: 1 }], daily: [], slowRuns: [], recent: [{ id: 'ai_3', candidateId: 'talent_a', version: 'talent-v3', type: '人工重跑', status: '规则降级', durationMs: 1880, inputTokens: 2100, outputTokens: 0, estimatedCost: 0, error: '模拟平台LLM暂时不可用', model: 'platform-llm', completedAt: '2026-08-28T14:50:00.000Z' }, { id: 'ai_2', candidateId: 'talent_a', version: 'talent-v2', type: '人工重跑', status: '成功', durationMs: 1200, inputTokens: 2100, outputTokens: 460, estimatedCost: 0, error: '', model: 'platform-llm', completedAt: '2026-08-28T14:00:00.000Z' }] }) });
    if (path.endsWith('/api/access/administration')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overrides.administration || administration) });
    if (path.endsWith('/api/recruitment')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ demands: [{ id: 'demand_pm', name: '产品经理招聘需求', role: '产品经理', department: '产品部', headcount: 2, type: '新增需求', createdAt: '2026-08-20T10:00:00.000Z' }], positions: [{ id: 'pos_pm', demandId: 'demand_pm', name: '产品经理', owner: '王HR', department: '产品部', headcount: 2, applicantCount: 1, status: '招聘中', category: '社招', requirements: '负责SaaS产品规划和商业化增长', city: '杭州', collectionTaskCount: 1, jdVersion: 2, rematchStatus: jobRematched ? '已完成' : '待重匹配', pendingRematchCount: jobRematched ? 0 : 1, latestJdChangeReason: '新增商业化增长要求' }], collectionTasks: [], channels: [], channelBindings: [] }) });
    if (path.endsWith('/api/recruitment/position-options')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positions: [{ id: 'pos_pm', name: '产品经理', departmentId: 'dept_a', department: '产品部', location: '杭州', status: '已发布', recruitmentStatus: '招聘中' }] }) });
    if (path.endsWith('/api/recruitment/referral-poster-order')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ month: '2026-09', positionIds: ['pos_pm'] }) });
    if (path.endsWith('/api/offers/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [{ id: 'offer_tpl_social', name: '社招标准 Offer', type: '社招', description: '适用于正式员工录用', status: '启用', version: 1, fields: [] }] }) });
    if (path.endsWith('/api/referrals/positions')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positions: [{ id: 'pos_pm', name: '产品经理', department: '产品部', status: '招聘中', responsibilities: '负责SaaS产品规划和商业化增长', requirements: '三年以上产品经验', salaryText: '15K-20K' }] }) });
    if (path.endsWith('/api/referrals/campaigns')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ campaigns: [{ id: 'campaign_1', name: '产品岗内推', department: '产品部', role: '产品经理', status: '启用', expiresAt: '2026-09-30T23:59:59.999Z', publicUrl: 'https://example.test/referral', qrCode: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }] }) });
    if (path.endsWith('/api/referrals/reward-rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rules: [] }) });
    if (path.endsWith('/api/referrals/analytics')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, valid: 0, duplicate: 0, rewardPending: 0, rewardPaid: 0, byCampaign: [] }) });
    if (path.endsWith('/api/referrals')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ referrals: overrides.referrals || [] }) });
    if (path.endsWith('/api/talents/job-rematch/impact')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positionId: 'pos_pm', positionName: '产品经理', jdVersion: 2, rematchStatus: '待重匹配', pendingCount: 1, changeReason: '新增商业化增长要求', items: [{ candidateId: 'talent_a', name: '林悦', currentScore: 82, matchedJdVersion: 1, currentMatchId: 'match_old' }] }) });
    if (path.endsWith('/api/talents/job-rematch/run')) { jobRematched = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positionId: 'pos_pm', positionName: '产品经理', jdVersion: 2, batchId: 'rematch_1', total: 1, succeeded: 1, failed: 0, results: [{ candidateId: 'talent_a', status: '成功', previousScore: 82, score: 90, delta: 8, matchId: 'match_new' }] }) }); }
    if (path.endsWith('/api/resumes/resume_a') && route.request().method() === 'DELETE') { resumeDeleted = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true, candidateId: 'talent_a', candidateStatus: '已从人才库隐藏' }) }); }
    if (path.endsWith('/api/talents')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ talents: resumeDeleted ? [] : [{ id: 'talent_a', name: '林悦', age: 29, phone: '138****8001', email: 'li***@example.com', status: '约面', owner: '王HR', source: '招聘平台', bestMatchRole: '产品经理', bestMatchScore: 88, skills: ['产品规划'], latestResumeId: 'resume_a', sourceFileUrl: 'https://cdn.example.test/linyue.png', matches: [{ positionName: '产品经理', score: 88 }]}], total: resumeDeleted ? 0 : 1, page: 1, pageSize: 25, totalPages: 1, jobMap: resumeDeleted ? [] : [{ role: '产品经理', count: 1, highScore: 1, average: 88 }], overview: { total: resumeDeleted ? 0 : 1 } }) });
    if (path.endsWith('/api/talents/talent_a/birth-year')) { birthCorrected = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'talent_a', name: '林悦', birthYear: 1997, age: 29, birthYearSource: '人工修正', birthYearReviewStatus: '人工已确认', birthYearConflict: { hasConflict: false, years: [1997], signals: [] }, birthYearCorrection: { reason: '候选人确认出生年份为1997年' }, phone: '138****8001', email: 'li***@example.com', wechat: 'li***', status: '约面', owner: '王HR', source: '招聘平台', bestMatchRole: '产品经理', bestMatchScore: 88, skills: ['产品规划'], tags: [], matches: [], timeline: [], communications: [], reviews: [], assessmentResults: [] }) }); }
    if (path.endsWith('/api/resumes/resume_a/convert-to-word')) { wordConverted = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'resume_a', name: '林悦', sourceFileName: '林悦简历.png', editableWordFileName: '林悦-图片简历可编辑版-v1.docx', editableWordUrl: 'https://cdn.example.test/linyue.docx', wordConversionStatus: '已完成', wordConversionVersion: 1 }) }); }
    if (path.endsWith('/api/resumes/resume_a/review')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resume: { id: 'resume_a', name: '林悦', reviewStatus: '已修正' }, changes: [{ field: '求职意向', before: '产品经理', after: '高级产品经理' }], reviewStatus: '已修正', reviewedAt: '2026-08-28T13:30:00.000Z' }) });
    if (path.endsWith('/api/resumes/candidates/resume_a/versions')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidateId: 'talent_a', total: 2, currentVersionId: versionActivated ? 'ver_1' : 'ver_2', versions: [{ id: 'ver_2', candidateId: 'talent_a', resumeId: 'resume_a', version: 2, isCurrent: !versionActivated, fileName: '林悦简历-更新版.png', fileUrl: 'https://cdn.example.test/linyue-v2.png', fileType: 'image/png', fileSize: 4096, parseStatus: '已完成', reviewStatus: '已修正', note: '候选人新增简历附件', createdAt: '2026-08-28T12:00:00.000Z' }, { id: 'ver_1', candidateId: 'talent_a', resumeId: 'resume_old', version: 1, isCurrent: versionActivated, fileName: '林悦简历.pdf', fileUrl: 'https://cdn.example.test/linyue-v1.pdf', fileType: 'application/pdf', fileSize: 3072, parseStatus: '已完成', reviewStatus: '已确认', note: '首次入库简历', createdAt: '2026-08-20T12:00:00.000Z' }] }) });
    if (path.endsWith('/api/resumes/versions/ver_1/activate')) { versionActivated = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changed: true, candidateId: 'talent_a', total: 2, currentVersionId: 'ver_1', versions: [{ id: 'ver_2', version: 2, isCurrent: false, fileName: '林悦简历-更新版.png', fileUrl: 'https://cdn.example.test/linyue-v2.png', fileType: 'image/png', fileSize: 4096, reviewStatus: '已修正', note: '候选人新增简历附件', createdAt: '2026-08-28T12:00:00.000Z' }, { id: 'ver_1', version: 1, isCurrent: true, fileName: '林悦简历.pdf', fileUrl: 'https://cdn.example.test/linyue-v1.pdf', fileType: 'application/pdf', fileSize: 3072, reviewStatus: '已确认', note: '首次入库简历', createdAt: '2026-08-20T12:00:00.000Z' }] }) }); }
    if (path.endsWith('/api/talents/talent_a/assessment-versions/compare')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidateId: 'talent_a', from: { id: 'ai_1', version: 1, versionName: 'talent-v1', scores: { business: 82, management: 70, logic: 80, communication: 78, overall: 78 } }, to: { id: aiRerun ? 'ai_3' : 'ai_2', version: aiRerun ? 3 : 2, versionName: aiRerun ? 'talent-v3' : 'talent-v2', scores: { business: 90, management: 84, logic: 88, communication: 82, overall: aiRerun ? 89 : 87 } }, scoreDelta: { business: 8, management: 14, logic: 8, communication: 4, overall: aiRerun ? 11 : 9 }, skills: { added: ['增长策略'], removed: ['需求分析'] }, recommendedRoles: { added: ['高级产品经理'], removed: ['产品经理'] }, strengths: { added: ['复杂项目推进'], removed: [] }, risks: { added: ['商业化经验待确认'], removed: ['管理跨度待确认'] }, summaryChanged: true, confidenceChanged: false }) });
    if (path.endsWith('/api/talents/talent_a/assessment-versions')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidateId: 'talent_a', total: aiRerun ? 3 : 2, currentAssessmentId: aiRerun ? 'ai_3' : 'ai_2', versions: [...(aiRerun ? [{ id: 'ai_3', version: 3, versionName: 'talent-v3', parentId: 'ai_2', type: '人工重跑', reason: '补充了最新项目成果，重新核对岗位匹配', promptVersion: 'talent-analysis-prompt-v2', modelVersion: 'platform-llm', runStatus: '成功', durationMs: 1260, summary: '最新项目补充后，高级产品岗位匹配进一步提升。', strengths: ['复杂项目推进'], risks: ['商业化经验待确认'], skills: ['产品规划', '增长策略'], recommendedRoles: ['高级产品经理'], scores: { business: 91, management: 86, logic: 89, communication: 84, overall: 89 }, confidence: '高', reviewStatus: '待人工确认', createdAt: '2026-08-28T14:00:00.000Z' }] : []), { id: 'ai_2', version: 2, versionName: 'talent-v2', parentId: 'ai_1', type: '人工重跑', reason: '负责人复核项目经历', promptVersion: 'talent-analysis-prompt-v2', modelVersion: 'platform-llm', runStatus: '成功', durationMs: 1380, summary: '具备成熟的SaaS产品和团队管理经验。', strengths: ['复杂项目推进'], risks: ['商业化经验待确认'], skills: ['产品规划', '增长策略'], recommendedRoles: ['高级产品经理'], scores: { business: 90, management: 84, logic: 88, communication: 82, overall: 87 }, confidence: '高', reviewStatus: '待人工确认', createdAt: '2026-08-28T13:00:00.000Z' }, { id: 'ai_1', version: 1, versionName: 'talent-v1', parentId: '', type: '首次分析', reason: '简历首次入库自动分析', promptVersion: 'talent-analysis-prompt-v2', modelVersion: 'platform-llm', runStatus: '成功', durationMs: 1100, summary: '具备产品经理基础能力。', strengths: ['需求分析'], risks: ['管理跨度待确认'], skills: ['产品规划', '需求分析'], recommendedRoles: ['产品经理'], scores: { business: 82, management: 70, logic: 80, communication: 78, overall: 78 }, confidence: '高', reviewStatus: '人工已确认', createdAt: '2026-08-20T10:00:00.000Z' }] }) });
    if (path.endsWith('/api/talents/talent_a/assessment-rerun')) { aiRerun = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job_ai_3', status: 'running', message: '已启动异步AI分析任务，请保持当前页面等待结果' }) }); }
    if (path.endsWith('/api/jobs/job_ai_3')) { aiRerunPolls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiRerunPolls >= 2 ? { status: 'done', progress: 'AI分析完成，正在刷新人才详情...', data: { candidateId: 'talent_a', assessmentId: 'ai_3', version: 3, runStatus: '成功', error: '', talent: { id: 'talent_a', name: '林悦', phone: '138****8001', email: 'li***@example.com', status: '约面', owner: '王HR', source: '招聘平台', bestMatchRole: '高级产品经理', bestMatchScore: 91, skills: ['产品规划', '增长策略'], tags: [], matches: [], timeline: [], communications: [], reviews: [], assessmentResults: [], latestResumeId: 'resume_a', sourceFileName: '林悦简历.png', sourceFileUrl: 'https://cdn.example.test/linyue.png' } } } : { status: 'running', progress: '正在生成AI人才画像与岗位匹配...' }) }); }
    if (path.endsWith('/api/talents/talent_a/assessment-correction')) { aiCorrected = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidateId: 'talent_a', assessmentId: aiRerun ? 'ai_3' : 'ai_2', changedFields: ['summary', 'skills', 'recommendedRoles', 'scores'], talent: { id: 'talent_a', name: '林悦', birthYear: 1997, age: 29, birthYearSource: '人工修正', birthYearReviewStatus: '人工已确认', birthYearConflict: { hasConflict: false, years: [1997], signals: [] }, phone: '138****8001', email: 'li***@example.com', wechat: 'li***', status: '约面', owner: '王HR', source: '招聘平台', bestMatchRole: '高级产品经理', bestMatchScore: 91, skills: ['产品规划', '商业化策略'], tags: [{ name: '商业化策略', category: '技能标签', source: '人工修正', confidence: 100, reviewStatus: '人工已修正', status: '当前' }], matches: [], timeline: [], communications: [], reviews: [], assessmentResults: [], latestResumeId: 'resume_a', sourceFileName: '林悦简历.png', sourceFileUrl: 'https://cdn.example.test/linyue.png', analysis: { id: aiRerun ? 'ai_3' : 'ai_2', version: aiRerun ? 3 : 2, versionName: aiRerun ? 'talent-v3' : 'talent-v2', summary: '人工核对后确认具备商业化和团队管理能力。', strengths: ['复杂项目推进'], risks: ['定价细节待复核'], skills: ['产品规划', '商业化策略'], recommendedRoles: ['高级产品经理'], scores: { business: 92, management: 90, logic: 89, communication: 85, overall: 90 }, evidence: { business: '项目结果', management: '团队管理', logic: '数据分析', communication: '跨团队协作' }, confidence: '高', reviewStatus: '人工已修正', corrected: true, correction: { reason: '已核对项目证明和团队规模', operator: '当前用户', correctedAt: '2026-08-28T14:10:00.000Z' } } } }) }); }
    if (path.endsWith('/api/resumes/batch-upload')) return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ batchId: 'batch_1', jobId: 'job_batch_1', status: 'running', total: 2 }) });
    if (path.endsWith('/api/resumes/batches')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ batches: [{ id: 'batch_1', name: '产品岗位批量导入', status: '部分失败', total: 2, succeeded: 1, failed: 1, creator: '李HR', createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:05:00.000Z' }] }) });
    if (path.endsWith('/api/resumes/batches/batch_1/retry')) { batchRetried = true; return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ batchId: 'batch_1', jobId: 'job_retry_1', status: 'running' }) }); }
    if (path.endsWith('/api/resumes/analysis/start')) return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ total: 2, selectedCount: 1, queue: { pending: 2, running: false } }) });
    if (path.endsWith('/api/resumes/batches/batch_1')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'batch_1', name: '产品岗位批量导入', status: batchRetried ? '已完成' : '部分失败', total: 2, pending: 0, running: 0, succeeded: batchRetried ? 2 : 1, failed: batchRetried ? 0 : 1, retryable: batchRetried ? 0 : 1, needsReupload: 0, items: [{ id: 'item_1', sequence: 1, fileName: '候选人A.pdf', fileType: 'application/pdf', fileSize: 1024, status: '已完成', attempts: 1, resumeId: 'resume_a', candidateId: 'talent_a', error: '' }, { id: 'item_2', sequence: 2, fileName: '候选人B.png', fileType: 'image/png', fileSize: 2048, sourceUrl: 'https://cdn.example.test/candidate-b.png', status: batchRetried ? '已完成' : '失败', attempts: batchRetried ? 2 : 1, resumeId: batchRetried ? 'resume_b' : '', candidateId: batchRetried ? 'talent_b' : '', error: batchRetried ? '' : 'OCR暂时失败' }] }) });
    const customTalentId = decodeURIComponent(path.split('/').pop() || '');
    if (route.request().method() === 'GET' && overrides.talentDetails?.[customTalentId]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overrides.talentDetails[customTalentId]) });
    if (path.endsWith('/api/talents/talent_a')) { if (route.request().method() === 'PATCH') birthCorrected = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'talent_a', name: '林悦', birthYear: 1997, age: 29, birthYearSource: birthCorrected ? '人工修正' : '简历年龄换算', birthYearReviewStatus: birthCorrected ? '人工已确认' : '待人工复核', birthYearConflict: birthCorrected ? { hasConflict: false, years: [1997], signals: [] } : { hasConflict: true, years: [1996, 1997], signals: [{ year: 1997, source: '人才主档出生年份' }, { year: 1996, source: '人才主档年龄换算' }] }, birthYearCorrection: {}, phone: '138****8001', email: 'li***@example.com', wechat: 'li***', status: '约面', owner: '王HR', source: '招聘平台', bestMatchRole: '产品经理', bestMatchScore: 88, skills: aiCorrected ? ['产品规划', '商业化策略'] : ['产品规划'], tags: [], matches: [], timeline: [], communications: [], reviews: [], assessmentResults: [], latestResumeId: 'resume_a', sourceFileName: '林悦简历.png', sourceFileUrl: 'https://cdn.example.test/linyue.png', editableWordFileName: wordConverted ? '林悦-图片简历可编辑版-v1.docx' : '', editableWordUrl: wordConverted ? 'https://cdn.example.test/linyue.docx' : '', wordConversionStatus: wordConverted ? '已完成' : '', wordConversionVersion: wordConverted ? 1 : 0, analysis: { id: aiRerun ? 'ai_3' : 'ai_2', version: aiRerun ? 3 : 2, versionName: aiRerun ? 'talent-v3' : 'talent-v2', summary: aiCorrected ? '人工核对后确认具备商业化和团队管理能力。' : '具备成熟的SaaS产品和团队管理经验。', strengths: ['复杂项目推进'], risks: ['商业化经验待确认'], skills: aiCorrected ? ['产品规划', '商业化策略'] : ['产品规划', '增长策略'], recommendedRoles: ['高级产品经理'], scores: aiCorrected ? { business: 92, management: 90, logic: 89, communication: 85, overall: 90 } : { business: 90, management: 84, logic: 88, communication: 82, overall: 87 }, evidence: { business: '项目结果', management: '团队管理', logic: '数据分析', communication: '跨团队协作' }, confidence: '高', reviewStatus: aiCorrected ? '人工已修正' : '待人工确认', corrected: aiCorrected }, access: { contactPolicy: 'masked', maskedFields: ['phone', 'email', 'wechat'] } }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('department filtering resolves stale IDs only to an active unique department', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const accessData = {
    ...administration,
    users: [
      ...administration.users,
      { id: 'legacy_department_user', name: '历史ID员工', departmentIds: ['legacy_dept_a'], departments: ['产品部'], status: '启用' },
      { id: 'ambiguous_department_user', name: '重名部门员工', departmentIds: ['legacy_duplicate_dept'], departments: ['重复部门'], status: '启用' },
      { id: 'inactive_department_user', name: '停用部门员工', departmentIds: ['legacy_inactive_dept'], departments: ['已停用部门'], status: '启用' },
    ],
    organizations: [
      ...administration.organizations,
      { id: 'dept_duplicate_a', type: '部门', name: '重复部门', parentId: 'bu_1', status: '启用' },
      { id: 'dept_duplicate_b', type: '部门', name: '重复部门', parentId: 'bu_1', status: '启用' },
      { id: 'dept_inactive', type: '部门', name: '已停用部门', parentId: 'bu_1', status: '停用' },
    ],
  };
  await installApiMocks(page, { administration: accessData });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('settings'));
  await page.locator('[data-access-admin]').first().click();
  await expect(page.getByRole('heading', { name: '组织与权限' })).toBeVisible();

  const departmentFilter = page.locator('[data-access-department-filter]');
  await departmentFilter.selectOption('dept_a');
  await expect(page.locator('[data-access-user-row="legacy_department_user"]')).toBeVisible();
  await departmentFilter.selectOption('dept_duplicate_a');
  await expect(page.locator('[data-access-user-row="ambiguous_department_user"]')).toBeHidden();
  await expect(departmentFilter.locator('option[value="dept_inactive"]')).toHaveCount(0);
});

test('referral records open candidate resumes in the existing talent detail workflow', async ({ page }) => {
  const talentDetailRequests = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/api/talents/referral_candidate')) talentDetailRequests.push(path);
  });
  await installApiMocks(page, {
    referrals: [{
      id: 'referral_row', candidateId: 'referral_candidate', candidateName: '内推候选人', role: '产品经理',
      referrer: '李思奇', department: '产品部', validity: '待确认', status: '待负责人确认', progress: '负责人审查',
      recommendedAt: '2026-09-29T09:00:00.000Z',
    }],
    talentDetails: {
      referral_candidate: {
        id: 'referral_candidate', candidateId: 'referral_candidate', name: '内推候选人', status: '待负责人审查',
        latestResumeId: 'resume_referral', educationBackground: '本科', workExperience: '候选人工作经历测试',
        skills: ['产品规划'], tags: [], matches: [], timeline: [], communications: [], reviews: [], assessmentResults: [],
        analysis: { summary: '通过现有人才详情接口读取简历。', confidence: '中', reviewStatus: '待人工确认' },
      },
    },
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('referral'));
  const summaryRecord = page.locator('#referral-qr-summary [data-ref-record-candidate="referral_candidate"]');
  await expect(summaryRecord).toBeVisible();
  await expect(page.getByRole('button', { name: '查看内推候选人的简历' })).toHaveCount(0);
  await summaryRecord.click();
  let talentDialog = page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') });
  await expect(talentDialog.locator('#rf-detail-resume')).toContainText('候选人工作经历测试');
  expect(talentDetailRequests).toHaveLength(1);
  await page.locator('#rf-talent-dialog:visible .rf-dialog-close').first().click();

  await page.getByRole('button', { name: '内推记录与奖励' }).click();
  const workbenchRecord = page.locator('.rf-ref-list [data-ref-record-candidate="referral_candidate"]');
  await expect(workbenchRecord).toBeVisible();
  await expect(workbenchRecord.getByRole('button', { name: '查看内推候选人的简历' })).toHaveCount(0);
  await workbenchRecord.locator('strong').first().click();
  talentDialog = page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') });
  await expect(talentDialog.locator('#rf-detail-resume')).toContainText('候选人工作经历测试');
  expect(talentDetailRequests).toHaveLength(2);
  await expect(page.locator('#rf-talent-dialog a[href*="resume_referral"]')).toHaveCount(0);
});

test('referral Vue overview filters and paginates records', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await installApiMocks(page, {
    referrals: Array.from({ length: 10 }, (_, index) => ({
      id: `referral_${index + 1}`,
      candidateId: `candidate_${index + 1}`,
      candidateName: `内推候选人${index + 1}`,
      role: index % 2 ? '运营专员' : '产品经理',
      referrer: index % 2 ? '王运营' : '李产品',
      referrerMobile: `1380013800${index}`,
      department: index % 2 ? '运营部' : '产品部',
      validity: index === 0 ? '有效' : '待确认',
      status: '待负责人确认',
      progress: '负责人审查',
      recommendedAt: `2026-10-${String(index + 10).padStart(2, '0')}T09:00:00.000Z`,
    })),
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => typeof window.setPage === 'function')).toBe(true);
  await page.evaluate(() => window.setPage('referral'));
  await expect(page.getByRole('heading', { name: '内推动态一屏掌握' })).toBeVisible();
  await expect(page.locator('.rf-ref-table tbody tr')).toHaveCount(8);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.rf-ref-table tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByLabel('搜索内推记录').fill('产品经理');
  await expect(page.locator('.rf-ref-table tbody tr')).toHaveCount(5);
  await expect(page.locator('.rf-ref-table tbody tr').first()).toContainText('内推候选人1');
  await page.getByRole('button', { name: '有效', exact: true }).click();
  await expect(page.locator('.rf-ref-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.rf-ref-table tbody tr')).toContainText('内推候选人1');
});

async function openTalentMore(page) {
  const dialog = page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') }).first();
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.locator('[data-rf-talent="talent_a"]').click({ force: true });
    await expect(dialog).toBeVisible();
  }
  const menu = dialog.locator('[data-rf-more-menu]');
  await dialog.locator('[data-rf-more-toggle]').click();
  await page.waitForTimeout(50);
  if (await menu.isHidden().catch(() => true)) await dialog.locator('[data-rf-more-toggle]').click();
  await expect(menu).toBeVisible();
}

async function installRecruitmentFlowMocks(page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/api/talents/talent_a')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: 'talent_a', candidateId: 'talent_a', name: '林悦', gender: '女', age: 29, phone: '13800138001', email: 'linyue@example.com',
      status: '约面', owner: '王HR', source: '招聘平台', bestMatchRole: '产品经理', jobIntention: '产品经理', bestMatchScore: 88,
      yearsOfExperience: '6年', educationBackground: '浙江大学 本科', workExperience: '负责SaaS产品规划和商业化增长。',
      skills: ['产品规划'], tags: [], timeline: [], communications: [], reviews: [], assessmentResults: [], latestResumeId: 'resume_a',
      sourceFileName: '林悦简历.pdf', sourceFileUrl: 'https://cdn.example.test/linyue.pdf',
      matches: [{ positionId: 'pos_pm', positionName: '产品经理', score: 88 }],
      analysis: { id: 'ai_1', confidence: '高', summary: '具备成熟的产品规划经验。', scores: { overall: 88 } },
      wecomReviews: [],
      flowEvidence: {
        communications: 1,
        interviews: 1,
        interview: { id: 'interview_1', status: '已预约', startedAt: '2026-09-25T08:00:00.000Z', confirmationStatus: '已确认' },
        interviewQuestionStatus: '已发布',
        interviewFeedback: 0,
        onboarding: { status: '待入职', actualDate: '' },
        onboardingReview: { id: 'probation_month_1', status: '待处理', plannedDate: '2026-10-25', actualDate: '', performanceRating: '', growthLevel: '' },
        followup: { status: '待回访', plannedDate: '2026-10-25' },
      },
      access: { contactPolicy: 'full', maskedFields: [] },
    }) });
    if (path.endsWith('/api/talents') && url.searchParams.get('pageSize') === '100') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ talents: [{ id: 'talent_a', name: '林悦', phone: '13800138001', email: 'linyue@example.com', bestMatchRole: '产品经理', jobIntention: '产品经理' }] }) });
    if (path.endsWith('/api/talents/communication-templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) });
    if (path.endsWith('/api/talents/talent_a/communications')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ communications: [], defaultHr: { id: 'hr_1', name: '王HR', positionName: '产品经理' } }) });
    if (path.endsWith('/api/recruitment/form-options')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ employees: [{ id: 'hr_1', name: '王HR', department: '人力资源部' }] }) });
    if (path.endsWith('/api/interviews/interviewers')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ interviewers: [{ id: 'manager_1', name: '陈经理', department: '产品部', roles: ['产品经理'], wecomUserId: 'manager_1' }] }) });
    if (path.endsWith('/api/interviews/rooms')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rooms: [{ id: 'room_1', name: '烟台一号会议室', location: '三楼', capacity: 8, reservable: true, status: '空闲' }] }) });
    if (path.endsWith('/api/interviews/rooms/availability')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: '企微实时', selectionId: 'selection_mock', rooms: [{ id: 'room_1', name: '烟台一号会议室', location: '三楼', capacity: 8, reservable: true, status: '空闲' }] }) });
    if (path.endsWith('/api/interviews/candidates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ id: 'talent_a', name: '林悦', bestMatchRole: '产品经理', jobIntention: '产品经理' }] }) });
    if (path.endsWith('/api/interview-evaluations/interviews/interview_1/questions')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidateName: '林悦', role: '产品经理', round: '一面', status: '已发布', questions: [{ question: '请介绍一次复杂产品项目的推进过程。', dimension: '专业能力', source: '岗位题库', why: '验证复杂项目经验', observation: '目标、过程和结果是否完整' }] }) });
    if (path.endsWith('/api/interview-evaluations/interviews/interview_1/feedback-extract')) return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
      source: 'ai',
      extraction: {
        recommendation: '通过',
        otherRoles: '运营经理',
        strengths: '逻辑清晰，项目数据完整',
        risks: '管理跨度需要继续确认',
        comment: '候选人完整说明了项目目标、个人贡献和量化结果，建议通过一面。',
      },
    }) });
    if (path.endsWith('/api/interview-evaluations/workbench')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 1, pendingFeedback: 1, templates: [], items: [{ id: 'interview_1', candidateId: 'talent_a', candidateName: '林悦', role: '产品经理', round: '一面', startAt: '2026-09-25T08:00:00.000Z', feedbackCount: 0, interviewerIds: ['manager_1'], evaluationStatus: '待评价' }] }) });
    if (path.endsWith('/api/employee-lifecycle/analytics')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ completedFollowups: 0 }) });
    if (path.endsWith('/api/employee-lifecycle')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboardings: [], overview: { pending: 1, active: 0, probation: 0, offboarding: 0, followups: 1 } }) });
    return route.fallback();
  });
}

async function selectInterviewSchedule(page, mode = '线上面试') {
  await page.locator('#rf-interview-mode').selectOption(mode);
  await page.locator('#rf-interview-time').dispatchEvent('pointerdown');
  await page.locator('#rf-interview-duration').selectOption('60');
  await page.locator('[data-rf-refresh-room-availability]').click();
  await expect(page.locator('#rf-interview-room')).toContainText('烟台一号会议室');
  await page.locator('#rf-interview-room').selectOption('room_1');
}

async function openFlowChildAndReturn(page, stepName, expectedText) {
  const detail = page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') });
  await expect(detail).toBeVisible();
  const step = detail.locator('#rf-detail-evaluation article').filter({ hasText: stepName }).first();
  const primaryAction = step.locator('button:not([data-rf-flow-wecom])');
  await expect(primaryAction).toBeEnabled();
  await primaryAction.click();
  const child = page.locator('#rf-talent-dialog:visible');
  await expect(child.getByText(expectedText, { exact: false }).first()).toBeVisible();
  await expect(page.locator('.rf-dialog-backdrop')).toHaveCount(2);
  const layout = await child.locator(':scope > .rf-dialog').evaluate((node) => ({
    overflow: node.scrollWidth - node.offsetWidth,
    verticalOverflow: getComputedStyle(node).overflowY,
    verticallyClipped: node.scrollHeight - node.clientHeight > 1 && getComputedStyle(node).overflowY === 'hidden',
    offenders: [...node.querySelectorAll('*')].filter((element) => element.scrollWidth - element.clientWidth > 1).slice(0, 8).map((element) => ({ className: element.className, tagName: element.tagName, overflow: element.scrollWidth - element.clientWidth })),
  }));
  expect(layout.overflow, JSON.stringify(layout.offenders)).toBeLessThanOrEqual(1);
  expect(layout.verticallyClipped, `dialog overflow-y=${layout.verticalOverflow}`).toBe(false);
  if (stepName === '面试题') {
    await child.locator('.qb-card summary').click();
    await expect(child.locator('.qb-evidence')).toContainText('目标、过程和结果');
    await page.screenshot({ path: `/tmp/interview-question-cards-${page.viewportSize().width}.png`, fullPage: true });
  }
  await child.getByRole('button', { name: '关闭对话框' }).click();
  await expect(page.locator('#rf-talent-dialog:visible .rf-full-detail-dialog')).toBeVisible();
  await expect(page.locator('.rf-dialog-backdrop')).toHaveCount(1);
  await expect(page.locator('#rf-talent-dialog')).not.toContainText('正在读取候选人、面试官和会议室');
}

test('mobile question bank previews deduplicated imports and keeps personal and position scopes separate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  let submitted;
  const queries = [];
  await page.route('**/api/assessments/bank?*', route => {
    queries.push(new URL(route.request().url()).searchParams.get('scope'));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positions: [{ id: 'pos_pm', name: '产品经理', department: '技术部' }], questions: [{ id: 'base_1', title: '请介绍一次项目复盘，说明目标、证据和改进。', category: '专业能力', position: '产品经理', status: '已发布', source: '基础题库导入', referenceAnswer: '关注本人职责、数据和复盘结论' }] }) });
  });
  await page.route('**/api/assessments/bank/import', route => { submitted = route.request().postDataJSON(); return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'bank_import' }) }); });
  await page.route('**/api/jobs/bank_import', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', data: { created: 2, skipped: 0, failed: 0, errors: [] } }) }));
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.locator('[data-mobile-menu]').first().click();
  await page.locator('[data-mobile-page="question-bank"]').click();
  await expect(page.locator('#question-bank-root h1')).toContainText('下一次好问题');
  await expect(page.locator('#question-bank-root')).toHaveAttribute('data-v-app', '');
  await page.locator('#qb-search').fill('项目复盘');
  await expect(page.locator('#qb-cards .qb-card')).toHaveCount(1);
  await page.locator('#qb-search').fill('');
  await page.locator('#question-bank-root summary').click();
  await expect(page.locator('#question-bank-root .qb-evidence')).toContainText('本人职责');
  await page.screenshot({ path: '/tmp/question-bank-mobile.png', fullPage: true });
  const layout = await page.locator('#question-bank-root').evaluate(node => ({ scroll: node.scrollWidth, width: node.clientWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
  await page.locator('[data-qb-scope="personal"]').click();
  await expect.poll(() => queries.at(-1)).toBe('personal');
  await page.locator('[data-qb-import]').click();
  await page.locator('#qb-import-position').selectOption('pos_pm');
  await page.locator('#qb-import-text').fill('请说明如何验证需求\n请举例说明项目复盘\n请说明如何验证需求');
  await page.locator('#qb-preview').click();
  await expect(page.locator('#qb-import-preview .qb-card')).toHaveCount(2);
  await expect(page.locator('#qb-import-message')).toContainText('文件内重复 1 道');
  await page.locator('#qb-confirm').click();
  await expect(page.locator('#qb-import-message')).toContainText('已导入 2 道');
  expect(submitted.scope).toBe('personal');
  expect(submitted.positionId).toBe('pos_pm');
  expect(submitted.questions).toHaveLength(2);
  await expect(page.locator('#qb-confirm')).toBeDisabled();
  await page.locator('#qb-file').setInputFiles({ name: 'questions.csv', mimeType: 'text/csv', buffer: Buffer.from('\ufeff题目,维度,参考答案,说明\n请描述项目验收标准,专业能力,可核验的指标,结合实际案例\n') });
  await expect(page.locator('#qb-import-message')).toContainText('已读取文件');
  await expect(page.locator('#qb-import-text')).toHaveValue('请描述项目验收标准');
  await page.locator('#qb-preview').click();
  await expect(page.locator('#qb-import-preview .qb-card')).toHaveCount(1);
  await expect(page.locator('#qb-import-preview')).toContainText('请描述项目验收标准');
  await page.locator('#qb-import-preview summary').click();
  await expect(page.locator('#qb-import-preview')).toContainText('可核验的指标');
  await page.locator('#qb-confirm').scrollIntoViewIfNeeded();
  await expect(page.locator('#qb-confirm')).toBeInViewport();
  await page.screenshot({ path: '/tmp/question-bank-import-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.nav-item[data-page="question-bank"]').click();
  await expect(page.locator('#page-question-bank')).toBeVisible();
  await expect(page.locator('#question-bank-root h1')).toBeVisible();
  await page.screenshot({ path: '/tmp/question-bank-desktop.png', fullPage: true });
});

test('developer center opens through the actual navigation without duplicate config requests', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installApiMocks(page);
  let configRequests = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/resumes/api-config', async route => {
    configRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiKey: 'mock-developer-key', validity: '测试密钥' }) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.locator('.nav-item[data-page="resume-api"]').click();
  await expect(page.locator('#page-resume-api')).toBeVisible();
  await expect(page.locator('#resumeflow-api-root')).toHaveAttribute('data-v-app', '');
  await expect(page.locator('#rf-api-key')).toHaveText('mock-developer-key');
  expect(configRequests).toBe(1);
  await page.locator('[data-code-tab="python"]').click();
  await expect(page.locator('#rf-code')).toContainText('import requests');
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.setPage('overview'));
  await page.locator('[data-mobile-menu]').first().click();
  await page.locator('[data-mobile-page="resume-api"]').click();
  await expect(page.locator('#page-resume-api')).toBeVisible();
  await expect(page.locator('#rf-api-key')).toHaveText('mock-developer-key');
  expect(configRequests).toBe(2);
});

test('developer center keeps docs accessible on config failure and retries without rotating keys', async ({ page }) => {
  await installApiMocks(page);
  let attempts = 0, rotations = 0;
  await page.route('**/api/resumes/api-config', route => {
    attempts += 1;
    return route.fulfill({ status: attempts === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { message: '配置暂时不可用' } : { apiKey: 'mock-retry-key' }) });
  });
  await page.route('**/api/resumes/api-config/rotate', route => { rotations += 1; return route.abort(); });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html#resume-api`, { waitUntil: 'networkidle' });
  await expect(page.locator('#page-resume-api')).toBeVisible();
  await expect(page.locator('#resumeflow-api-root')).toContainText('配置暂时不可用');
  await expect(page.locator('#rf-code')).toBeVisible();
  expect(attempts).toBe(1);
  await page.locator('#rf-api-config-retry').click();
  await expect(page.locator('#rf-api-key')).toHaveText('mock-retry-key');
  expect(attempts).toBe(2);
  expect(rotations).toBe(0);
});

test('developer center deep link does not fetch config for an unauthorized account', async ({ page }) => {
  await installApiMocks(page);
  let configRequests = 0;
  await page.route('**/api/access/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, authorized: true, accessState: 'active', userId: 'restricted_user', userName: '测试员工', roleCodes: ['recruiter'], pages: ['home'], actions: [], dataScopes: [], sensitiveFields: [], account: { id: 'restricted_user', name: '测试员工', status: '启用' } }) }));
  await page.route('**/api/resumes/api-config', route => { configRequests += 1; return route.abort(); });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html#resume-api`, { waitUntil: 'networkidle' });
  await expect(page.locator('.nav-item[data-page="resume-api"]')).toBeHidden();
  await expect(page.locator('#page-resume-api')).toBeHidden();
  expect(configRequests).toBe(0);
});

test('points ranking renders the Vue island and refreshes on demand', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installApiMocks(page);
  let rankingRequests = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/points/ranking', route => {
    rankingRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      summary: { participants: 2, totalPoints: rankingRequests === 1 ? 18 : 20, interviews: 2, offers: 1, onboardings: 1 },
      rules: [
        { category: '中高层岗位', interview: 3, offer: 6, onboard: 9 },
        { category: '普通岗位', interview: 1, offer: 2, onboard: 3 },
      ],
      ranking: [
        {
          userId: 'referrer_1', name: '推荐人甲', department: '内容部', rank: 1,
          points: rankingRequests === 1 ? 18 : 20, corePoints: 9, normalPoints: 9,
          interviews: 2, offers: 1, onboardings: 1,
          details: [{ referralId: 'referral_1', milestone: 'interview', candidateName: '候选人甲', positionName: 'AI产品经理', points: 3, occurredAt: '2026-10-20T10:00:00' }],
        },
        { userId: 'referrer_2', name: '推荐人乙', department: '商务部', rank: 2, points: 6, corePoints: 0, normalPoints: 6, interviews: 1, offers: 1, onboardings: 1, details: [] },
      ],
    }) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.locator('.nav-item[data-page="points"]').click();
  await expect(page.locator('#points-root')).toHaveAttribute('data-v-app', '');
  await expect(page.locator('.points-hero h2')).toHaveText('内推积分榜');
  await expect(page.locator('.points-rank-card')).toHaveCount(2);
  await expect(page.locator('.points-rank-card').first()).toContainText('推荐人甲');
  await page.locator('.points-detail summary').first().click();
  await expect(page.locator('.points-detail')).toContainText('候选人甲 · AI产品经理');
  await expect(page.locator('.points-detail')).toContainText('面试 · 2026-10-20 10:00');
  await page.locator('[data-points-refresh]').click();
  await expect(page.locator('.points-rank-card').first()).toContainText('20');
  expect(rankingRequests).toBe(2);
  expect(errors).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.points-hero h2')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test('current user stays at the top right on desktop and tablet without changing mobile navigation', async ({ page }) => {
  await installApiMocks(page);
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  const userCard = page.locator('.current-user-card');
  for (const width of [1440, 1120, 1024, 820, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(userCard).toBeVisible();
    const brand = await page.locator('.topbar-left').boundingBox();
    const user = await userCard.boundingBox();
    expect(Math.abs((brand.y + brand.height / 2) - (user.y + user.height / 2))).toBeLessThan(3);
    expect(user.x).toBeGreaterThanOrEqual(brand.x + brand.width);
    expect(user.x + user.width).toBeLessThanOrEqual(width);
    expect(width - user.x - user.width).toBeLessThan(40);
    await expect(page.locator('[data-auth-logout]').filter({ visible: true }).first()).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#talent-app .topbar')).toBeHidden();
  await expect(page.locator('.rf-appbar')).toBeVisible();
});

test('talent archive keeps the selected fallback summary while loading full detail', async ({ page }) => {
  let detailRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/access/me')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        authenticated: true, authorized: true, accessState: 'active', identitySource: 'test',
        userId: 'admin_1', userName: '系统管理员', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'],
        dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }],
        sensitiveFields: [{ roleCode: 'system_admin', contacts: 'full' }],
      }) });
    }
    if (path.endsWith('/api/talents') && route.request().method() === 'GET') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '统一人才接口暂时不可用' }) });
    }
    if (path.endsWith('/api/resumes') && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        resumes: [{
          id: 'resume_a', candidateId: 'talent_a', name: '林悦', age: 29, gender: '女', phone: '13800138000',
          email: 'linyue@example.com', address: '杭州', jobIntention: '产品经理', yearsOfExperience: '6年',
          skillsCertificates: '产品规划、数据分析', educationBackground: '杭州大学 本科',
          workExperience: '负责SaaS产品规划和团队协作。', selfEvaluation: '擅长跨团队推进。',
          sourceFileName: '林悦-历史简历.pdf', sourceFileUrl: 'https://cdn.example.test/linyue.pdf',
          rawText: '姓名：林悦', createdTime: '2026-09-01T00:00:00.000Z',
        }],
      }) });
    }
    if (path.endsWith('/api/talents/talent_a')) {
      detailRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: 'talent_a', name: '林悦', age: 29, gender: '女', phone: '13800138000',
        email: 'linyue@example.com', address: '杭州', jobIntention: '高级产品经理', yearsOfExperience: '6年',
        educationBackground: '浙江大学 本科', workExperience: '完整详情中的SaaS产品规划和商业化增长经历。',
        selfEvaluation: '完整详情中的跨团队项目推进证据。', sourceFileName: '林悦-完整简历.pdf',
        sourceFileUrl: 'https://cdn.example.test/linyue-full.pdf', latestResumeId: 'resume_a',
        status: '约面', source: '招聘平台', owner: '王HR', matches: [], tags: [], timeline: [],
        communications: [], reviews: [], assessmentResults: [],
      }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('[data-rf-talent="talent_a"]')).toBeVisible();
  await page.locator('[data-rf-talent="talent_a"]').click();
  await expect(page.locator('#rf-talent-dialog .rf-talent-profile-top h2').first()).toHaveText('林悦');
  await expect.poll(() => detailRequests).toBe(1);
  await expect(page.locator('#rf-talent-dialog .rf-resume-detail-panel')).toContainText('浙江大学');
  await expect(page.locator('#rf-talent-dialog .rf-profile-job-intent')).toContainText('高级产品经理');
});

test('talent list replaces pending AI tags with tags loaded from detail', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, authorized: true, accessState: 'active', identitySource: 'test', userId: 'admin_1', userName: '系统管理员', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }], sensitiveFields: [{ roleCode: 'system_admin', contacts: 'full' }] }) });
    if (path.endsWith('/api/talents') && route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ talents: [{ id: 'talent_tagged', name: '标签测试候选人', status: '负责人审查', source: '简历解析', skills: [], tags: [], matches: [], analysis: { id: 'ai_1', strengths: [] } }], total: 1, page: 1, pageSize: 100, totalPages: 1 }) });
    if (path.endsWith('/api/talents/talent_tagged')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'talent_tagged', name: '标签测试候选人', status: '负责人审查', source: '简历解析', skills: ['商业化策略'], tags: [{ name: '商业化策略', category: '技能标签', status: '当前' }], matches: [], timeline: [], communications: [], reviews: [], assessmentResults: [], analysis: { id: 'ai_1', strengths: [] } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  const card = page.locator('[data-rf-talent="talent_tagged"]');
  await expect(card).toContainText('AI标签待生成');
  await card.click();
  await expect(page.locator('#rf-talent-dialog .rf-profile-tag-pill')).toContainText('商业化策略');
  await page.locator('#rf-talent-dialog .rf-dialog-close').click();
  await expect(page.locator('[data-rf-talent="talent_tagged"]')).toContainText('商业化策略');
  await expect(page.locator('[data-rf-talent="talent_tagged"]')).not.toContainText('AI标签待生成');
});

test('talent list keeps card columns aligned and stacks cleanly on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await installApiMocks(page);
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  const card = page.locator('.rf-talent-cards .rf-talent-candidate').first();
  await expect(card).toBeVisible();
  const titleLayout = await page.locator('.rf-talent-page-head').evaluate((node) => {
    const heading = node.querySelector('h1').getBoundingClientRect();
    const description = node.querySelector('p').getBoundingClientRect();
    return { headingX: heading.x, headingBottom: heading.bottom, descriptionTop: description.top };
  });
  expect(titleLayout.descriptionTop).toBeGreaterThanOrEqual(titleLayout.headingBottom);
  await page.evaluate(() => window.setPage('jobs'));
  const jobsHeadingX = await page.locator('#page-jobs .page-head h1').evaluate((node) => node.getBoundingClientRect().x);
  expect(Math.abs(titleLayout.headingX - jobsHeadingX)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.setPage('resume-archive'));

  const desktop = await card.evaluate((node) => {
    const rect = (selector) => {
      const value = node.querySelector(selector).getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, right: value.right };
    };
    return {
      card: { width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth },
      avatar: rect('.rf-candidate-avatar'),
      main: rect('.rf-talent-card-main'),
      resume: rect('.rf-talent-card-resume'),
      side: rect('.rf-talent-card-side'),
    };
  });
  expect(desktop.card.scrollWidth - desktop.card.width).toBeLessThanOrEqual(1);
  expect(Math.abs(desktop.avatar.y - desktop.main.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(desktop.main.y - desktop.resume.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(desktop.main.y - desktop.side.y)).toBeLessThanOrEqual(2);
  expect(desktop.resume.x).toBeGreaterThan(desktop.main.x + 180);
  expect(desktop.side.x).toBeGreaterThan(desktop.resume.x + 180);

  await page.setViewportSize({ width: 900, height: 900 });
  const tablet = await card.evaluate((node) => {
    const mainRect = node.querySelector('.rf-talent-card-main').getBoundingClientRect();
    const resumeRect = node.querySelector('.rf-talent-card-resume').getBoundingClientRect();
    const sideRect = node.querySelector('.rf-talent-card-side').getBoundingClientRect();
    return {
      overflow: node.scrollWidth - node.clientWidth,
      main: { x: mainRect.x, y: mainRect.y },
      resume: { x: resumeRect.x, y: resumeRect.y, right: resumeRect.right },
      side: { x: sideRect.x, y: sideRect.y, right: sideRect.right },
    };
  });
  expect(tablet.overflow).toBeLessThanOrEqual(1);
  expect(Math.abs(tablet.main.y - tablet.side.y)).toBeLessThanOrEqual(2);
  expect(tablet.resume.y).toBeGreaterThan(tablet.main.y + 40);
  expect(tablet.resume.x).toBeLessThanOrEqual(tablet.main.x + 1);
  expect(Math.abs(tablet.resume.right - tablet.side.right)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await card.evaluate((node) => {
    const cardRect = node.getBoundingClientRect();
    const resumeRect = node.querySelector('.rf-talent-card-resume').getBoundingClientRect();
    const sideRect = node.querySelector('.rf-talent-card-side').getBoundingClientRect();
    const list = node.closest('.rf-talent-cards');
    const pagerRect = document.querySelector('.rf-talent-pager').getBoundingClientRect();
    const filterbar = document.querySelector('.rf-talent-filterbar');
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      card: { x: cardRect.x, width: cardRect.width, bottom: cardRect.bottom, scrollWidth: node.scrollWidth },
      resume: { x: resumeRect.x, width: resumeRect.width },
      side: { x: sideRect.x, width: sideRect.width },
      filterOverflow: filterbar.scrollWidth - filterbar.clientWidth,
      listOverflowY: getComputedStyle(list).overflowY,
      pagerTop: pagerRect.top,
    };
  });
  expect(mobile.pageOverflow).toBeLessThanOrEqual(1);
  expect(mobile.filterOverflow).toBeLessThanOrEqual(1);
  expect(mobile.card.scrollWidth - mobile.card.width).toBeLessThanOrEqual(1);
  expect(mobile.resume.width).toBeGreaterThan(mobile.card.width - 40);
  expect(mobile.side.width).toBeGreaterThan(mobile.card.width - 40);
  expect(Math.abs(mobile.resume.x - mobile.side.x)).toBeLessThanOrEqual(1);
  expect(mobile.listOverflowY).toBe('visible');
  expect(mobile.pagerTop).toBeGreaterThanOrEqual(mobile.card.bottom);
});

test('1000-person talent directory loads 25 rows per page without opening details or attachments', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pageRequests = [];
  let detailRequests = 0, attachmentRequests = 0;
  await installApiMocks(page);
  page.on('request', request => {
    const url = new URL(request.url());
    if (/\/api\/talents\/candidate_/.test(url.pathname)) detailRequests++;
    if (url.hostname === 'files.example.test') attachmentRequests++;
  });
  await page.route('**/api/talents?**', route => {
    const url = new URL(route.request().url());
    const currentPage = Number(url.searchParams.get('page'));
    const pageSize = Number(url.searchParams.get('pageSize'));
    pageRequests.push({ page: currentPage, pageSize });
    const talents = Array.from({ length: pageSize }, (_, index) => {
      const candidateIndex = (currentPage - 1) * pageSize + index;
      return { id: `candidate_${candidateIndex}`, name: `测试人才${candidateIndex}`, status: '待业务群评审', skills: [], matches: [], tags: [], sourceFileUrl: 'https://files.example.test/resume.pdf' };
    });
    return route.fulfill({ json: { talents, total: 1000, page: currentPage, pageSize, totalPages: 40 } });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('[data-rf-talent^="candidate_"]')).toHaveCount(25);
  await expect(page.locator('[data-rf-talent="candidate_0"]')).toBeVisible();
  await page.locator('[data-rf-talent-page="2"]').click();
  await expect(page.locator('[data-rf-talent="candidate_25"]')).toBeVisible();
  await expect(page.locator('[data-rf-talent^="candidate_"]')).toHaveCount(25);
  expect(pageRequests.every(request => request.pageSize === 25)).toBe(true);
  expect(pageRequests.some(request => request.page === 2)).toBe(true);
  expect(detailRequests).toBe(0);
  expect(attachmentRequests).toBe(0);
});

test('talent filters wait for an explicit query before requesting data', async ({ page }) => {
  const selectCombobox = async (id, text) => {
    const combobox = page.locator(`[data-combobox-for="${id}"]`);
    await combobox.locator('input').fill(text);
    await combobox.locator('.rf-combobox-option', { hasText: text }).first().click();
  };
  let talentRequests = 0;
  let latestTalentUrl = '';
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/api/talents')) {
      talentRequests += 1;
      latestTalentUrl = url.toString();
    }
  });
  await installApiMocks(page);
  await page.route('**/api/talents?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === '高级产品经理') await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fallback();
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('#rf-search-submit')).toBeVisible();
  await expect(page.locator('[data-combobox-for="rf-status-filter"] input')).toBeVisible();
  await expect(page.locator('[data-combobox-for="rf-status-filter"] .rf-combobox-clear')).toHaveCount(0);
  await expect(page.locator('[data-combobox-for="rf-status-filter"] .rf-combobox-toggle')).toHaveCount(0);
  expect(new URL(latestTalentUrl).searchParams.get('pageSize')).toBe('25');
  await expect(page.locator('#rf-talent-advanced-row')).toBeHidden();
  const initialRequests = talentRequests;

  await page.locator('#rf-search').fill('高级产品经理');
  await selectCombobox('rf-status-filter', '在职');
  await page.locator('#rf-advanced-filter').click();
  await expect(page.locator('#rf-talent-advanced-row')).toBeVisible();
  await selectCombobox('rf-age-filter', '26-30岁');
  await page.locator('#rf-importer-filter').fill('张三');
  await page.waitForTimeout(400);
  expect(talentRequests).toBe(initialRequests);

  const firstQueryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/talents') && url.searchParams.get('q') === '高级产品经理';
  });
  await page.locator('#rf-importer-filter').press('Enter');
  await expect(page.locator('#rf-search-submit')).toBeDisabled();
  await expect(page.locator('#rf-search-submit')).toContainText('查询中');
  await expect(page.locator('#rf-talent-search-feedback')).toBeVisible();
  await expect(page.locator('.rf-talent-cards')).toHaveClass(/is-searching/);
  await firstQueryResponse;
  await expect.poll(() => talentRequests).toBe(initialRequests + 1);
  await expect(page.locator('#rf-search-submit')).toBeEnabled();
  await expect(page.locator('#rf-search-submit')).toHaveText('查询');
  await expect(page.locator('#rf-talent-search-feedback')).toBeHidden();
  expect(new URL(latestTalentUrl).searchParams.get('q')).toBe('高级产品经理');
  expect(new URL(latestTalentUrl).searchParams.get('status')).toBe('在职');
  expect(new URL(latestTalentUrl).searchParams.get('age')).toBe('26-30岁');
  expect(new URL(latestTalentUrl).searchParams.get('importer')).toBe('张三');

  await page.locator('#rf-search').fill('产品规划');
  const secondQueryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/talents') && url.searchParams.get('q') === '产品规划';
  });
  await page.locator('#rf-search').press('Enter');
  await secondQueryResponse;
  await expect.poll(() => talentRequests).toBe(initialRequests + 2);
  expect(new URL(latestTalentUrl).searchParams.get('q')).toBe('产品规划');
});

for (const viewport of [{ name: 'desktop', width: 1440, height: 960 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name} recruitment flow dialogs open and close back to resume detail`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installApiMocks(page);
    await installRecruitmentFlowMocks(page);
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('resume-archive'));
    await page.locator('[data-rf-talent="talent_a"]').click();
    await expect(page.locator('#rf-talent-dialog .rf-full-detail-dialog')).toBeVisible();
    const flowNames = await page.locator('#rf-detail-evaluation article strong').allTextContents();
    expect(flowNames.indexOf('入职')).toBeLessThan(flowNames.indexOf('入职评价'));
    expect(flowNames.indexOf('入职评价')).toBeLessThan(flowNames.indexOf('离职'));

    await openFlowChildAndReturn(page, 'AI分析', '正在生成人才画像与岗位匹配');
    await openFlowChildAndReturn(page, '业务群评审', '推送企微评审');
    await openFlowChildAndReturn(page, '意向沟通', '记录与 林悦 的沟通');
    await openFlowChildAndReturn(page, '约面', '为林悦安排面试');
    await openFlowChildAndReturn(page, '面试题', '林悦 · 面试题');
    await openFlowChildAndReturn(page, '面试评价', '林悦 · 面试评价');
    await openFlowChildAndReturn(page, '发Offer', '为 林悦 创建 Offer');
    await openFlowChildAndReturn(page, '入职', '确认入职');
    await openFlowChildAndReturn(page, '入职评价', '入职、试用期、离职与回访');
    await openFlowChildAndReturn(page, '离职', '入职、试用期、离职与回访');
    await openFlowChildAndReturn(page, '回访', '入职、试用期、离职与回访');

    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);
  });
}

for (const viewport of [{width:320,height:568},{width:390,height:844},{width:1280,height:800}]) {
  test(`shared operation feedback stays readable and dismissible at ${viewport.width}px`, async ({page},testInfo)=>{
    await page.setViewportSize(viewport);
    await installApiMocks(page);
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.clock.install();
    await page.evaluate(()=>window.alert('保存失败，请检查填写内容后重试；已填写的信息不会被这条提示清空。'));
    const error=page.locator('.rf-notification.error');
    await expect(error).toBeVisible();
    expect(await error.locator('p').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    const close=error.getByRole('button',{name:'关闭提示'});
    expect((await close.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.clock.fastForward(9000);
    await expect(error).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:testInfo.outputPath('operation-feedback.png')});
    await close.click();
    await expect(error).toHaveCount(0);
    await page.evaluate(()=>window.alert('保存成功'));
    const success=page.locator('.rf-notification.success');
    await success.getByRole('button',{name:'关闭提示'}).focus();
    await page.clock.fastForward(9000);
    await expect(success).toBeVisible();
    await page.mouse.move(0,viewport.height-1);
    await success.getByRole('button',{name:'关闭提示'}).evaluate(node=>node.blur());
    await page.clock.fastForward(9000);
    await expect(success).toHaveCount(0);
  });

  test(`communication form keeps input and retry behavior at ${viewport.width}px`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);
    await installApiMocks(page);
    await installRecruitmentFlowMocks(page);
    let attempts=0, payload;
    await page.route('**/api/talents/communications/transcript-extract',async(route)=>{
      attempts++;
      payload=route.request().postDataJSON();
      await new Promise(resolve=>setTimeout(resolve,250));
      return route.fulfill({status:attempts===1?503:200,contentType:'application/json',body:JSON.stringify(attempts===1?{message:'模拟解析服务暂不可用'}:{extraction:{channel:'电话'}})});
    });
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.evaluate(()=>window.setPage('resume-archive'));
    await page.locator('[data-rf-talent="talent_a"]').click();
    await page.locator('#rf-detail-evaluation article').filter({hasText:'意向沟通'}).first().locator('button:not([data-rf-flow-wecom])').click();
    const dialog=page.locator('#rf-talent-dialog');
    await expect(dialog.getByRole('heading',{name:'记录与 林悦 的沟通'})).toBeVisible();
    if (viewport.width <= 760) {
      const surface = await dialog.locator(':scope > .rf-dialog').boundingBox();
      expect(surface.x).toBe(0);
      expect(surface.y).toBe(0);
      expect(surface.width).toBe(viewport.width);
      expect(surface.height).toBe(viewport.height);
      const close = await dialog.getByRole('button', { name: '关闭对话框' }).boundingBox();
      expect(close.x).toBeGreaterThan(viewport.width / 2);
    }
    const field=page.locator('#rf-comm-transcript-text');
    const original='候选人电话沟通记录，需要人工核对后保存。';
    await field.fill(original);
    await expect(page.getByRole('group', { name: '口述提纲', exact: true })).toHaveCount(0);
    expect(attempts).toBe(0);
    await page.locator('#rf-comm-notes').fill('人工备注必须保留');
    const extract=page.locator('[data-rf-comm-transcript-extract]');
    await extract.click();
    await expect(extract).toBeDisabled();
    await expect(page.locator('#rf-comm-transcript-status')).toContainText('模拟解析服务暂不可用');
    expect(await page.locator('#rf-comm-transcript-status').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(13);
    await expect(extract).toBeEnabled();
    await expect(field).toHaveValue(original);
    await expect(page.locator('#rf-comm-notes')).toHaveValue('人工备注必须保留');
    await extract.click();
    await expect(page.locator('#rf-comm-transcript-status')).toContainText('解析完成');
    await expect(page.locator('#rf-comm-channel')).toHaveValue('电话');
    expect(payload).toEqual({transcript:original, background:true});
    expect(attempts).toBe(2);
    const control=page.locator('#rf-comm-channel');
    expect(await control.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(viewport.width<=760?16:14);
    const save=page.locator('[data-rf-save-communication]');
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await expect(page.locator('#rf-comm-message')).toHaveAttribute('aria-live','polite');
    expect(await dialog.locator(':scope > .rf-dialog').evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:testInfo.outputPath('communication-actions.png')});
    await dialog.getByRole('button',{name:'关闭对话框'}).click();
    await expect(page.locator('#rf-talent-dialog .rf-full-detail-dialog')).toBeVisible();
  });
}

for(const width of [390,1280]){
  test(`manual group review shows actual send status and retries at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await installApiMocks(page);
    await installRecruitmentFlowMocks(page);
    let attempts=0;
    const errors=[],payloads=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/talents/talent_a/wecom-review-share',async(route)=>{
      attempts++;
      payloads.push(route.request().postDataJSON());
      await new Promise(resolve=>setTimeout(resolve,250));
      return route.fulfill({status:attempts===2?503:201,contentType:'application/json',body:JSON.stringify(attempts===1?{sent:false,status:'评审中',message:'已复用现有评审链接，本次未发送企微群消息'}:attempts===2?{message:'企微群推送失败：模拟机器人暂不可用'}:{sent:true,status:'评审中',reviewUrl:'https://review.example.test/talent-review?token=mock'})});
    });
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.evaluate(()=>window.setPage('resume-archive'));
    await page.locator('[data-rf-talent="talent_a"]').click();
    await page.locator('#rf-detail-evaluation article').filter({hasText:'业务群评审'}).first().getByRole('button').click();
    const button=page.locator('[data-rf-wecom-submit]');
    await page.locator('#rf-wecom-webhook-key').fill('mock-review-key');
    await button.click();
    await expect(button).toBeDisabled();
    await expect(page.locator('#rf-wecom-message')).toContainText('本次未发送');
    await expect(page.locator('.rf-wecom-send-success')).toHaveCount(0);
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator('#rf-wecom-message')).toContainText('模拟机器人暂不可用');
    await expect(button).toBeEnabled();
    await expect(page.locator('#rf-wecom-webhook-key')).toHaveValue('mock-review-key');
    await button.click();
    await expect(page.locator('.rf-wecom-send-success')).toContainText('企微评审已推送');
    expect(attempts).toBe(3);
    expect(payloads.every(payload=>payload.forceSend===true&&payload.sendMode==='group'&&payload.webhookKey==='mock-review-key')).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('manual review can send the group and one individual together', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  await page.route('**/api/recruitment/form-options', async route => {
    return route.fulfill({ json: { employees: [
      { id: 'manager_1', name: '陈经理', department: '产品部' },
      { id: 'hr_1', name: '王HR', department: '人力资源部', tianjiWechatId: 'hr_wechat_1' },
    ] } });
  });
  let payload;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/talents/talent_a/wecom-review-share', async route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { sent: true, status: '评审中', reviewUrl: 'https://review.example.test/talent-review?token=direct' } });
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  await page.locator('#rf-detail-evaluation article').filter({ hasText: '业务群评审' }).first().getByRole('button').click();
  await expect(page.locator('#rf-wecom-group-enabled')).toBeChecked();
  await expect(page.locator('#rf-wecom-direct-enabled')).not.toBeChecked();
  await expect(page.locator('#rf-wecom-webhook-field')).toBeVisible();
  await expect(page.locator('#rf-wecom-recipient')).toBeHidden();
  await page.locator('#rf-wecom-direct-enabled').check();
  await expect(page.locator('#rf-wecom-webhook-field')).toBeVisible();
  await expect(page.locator('#rf-wecom-recipient')).toBeVisible();
  expect(await page.locator('#rf-wecom-recipient option[value="manager_1"]').getAttribute('disabled')).toBe('');
  await page.locator('#rf-wecom-recipient').selectOption('hr_1');
  await page.locator('[data-rf-wecom-submit]').click();
  await expect(page.locator('.rf-wecom-send-success')).toContainText('企微评审已群发并单独提醒');
  await expect(page.locator('.rf-wecom-send-success')).toContainText('王HR');
  expect(payload).toEqual({ expiresInDays: 30, operator: '当前用户', forceSend: true, sendMode: 'both', webhookKey: '', directUserIds: ['hr_1'] });
  expect(errors).toEqual([]);
});

test('talent flow actions support manual WeCom push with clear feedback', async ({ page }) => {
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  let payload;
  await page.route('**/api/talents/talent_a/flow-wecom', async route => {
    payload = route.request().postDataJSON();
    await new Promise(resolve => setTimeout(resolve, 150));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ step: 'interview_question', result: { status: '已发送' } }) });
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  const questionStep = page.locator('#rf-detail-evaluation article').filter({ hasText: '面试题' }).first();
  const pushButton = questionStep.getByRole('button', { name: '推送企微' });
  await expect(pushButton).toBeVisible();
  await expect(pushButton).toBeEnabled();
  const response = page.waitForResponse(item => new URL(item.url()).pathname.endsWith('/api/talents/talent_a/flow-wecom'));
  await pushButton.click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.rf-notification.success')).toContainText('企微推送已完成：已发送');
  await expect(pushButton).toBeEnabled();
  await expect(pushButton).toHaveText('推送企微');
  expect(payload).toMatchObject({ step: 'interview_question', operator: '系统管理员', operatorUserId: 'admin_1' });
});

test('mobile one-month onboarding review submits the required appraisal fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let submitted;
  await page.route('**/api/employee-lifecycle/reviews/public**', async (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: '已完成', performanceRating: submitted.performanceRating, growthLevel: submitted.growthLevel }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviewId: 'probation_month_1', candidateName: '林悦', role: '产品经理', department: '产品部', nodeType: '入职一月评价', plannedDate: '2026-10-25', status: '待处理' }) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?onboarding_review_token=review_token`, { waitUntil: 'networkidle' });
  await page.selectOption('select[name="performanceRating"]', 'A');
  await page.fill('input[name="growthLevel"]', '快速成长');
  await page.fill('textarea[name="appraisal"]', '已能独立承担核心任务，建议继续加强跨部门协作。');
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '提交入职评价' }).click();
  await expect(page.getByText('入职评价已提交')).toBeVisible();
  expect(submitted).toMatchObject({ performanceRating: 'A', growthLevel: '快速成长', appraisal: '已能独立承担核心任务，建议继续加强跨部门协作。' });
});

test('mobile HR Offer handoff locks the interview candidate and position and waits for HR input', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  let offerWrites=0, patchWrites=0, mailAttempts=0, offerPayload, patchPayload, interviewContextReads=0;
  await page.route('**/api/offers/interview-context',async(route)=>{
    interviewContextReads++;
    expect(route.request().postDataJSON()).toEqual({interviewId:'interview_1',candidateId:'talent_a',applicationId:'application_1',positionId:'pos_interview'});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      interviewId:'interview_1',applicationId:'application_1',
      candidate:{id:'talent_a',name:'林悦',gender:'女',phone:'13600136000',email:'linyue@example.com'},
      position:{id:'pos_interview',name:'运营负责人',department:'运营部',location:'烟台'},
    })});
  });
  await page.route('**/api/offers',async(route)=>{
    if(route.request().method()==='POST'){
      offerWrites++;
      offerPayload=route.request().postDataJSON();
      return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({offerId:'offer_saved',fileUrl:'https://files.example.test/offer_saved.pdf',fileName:'林悦-录用通知书.pdf',offerNumber:'FP-20261014-ABC123',templateType:'社招'})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({offers:[]})});
  });
  await page.route(/\/api\/offers\/offer_saved$/,async(route)=>{
    if(route.request().method()!=='PATCH') return route.fallback();
    patchWrites++;
    patchPayload=route.request().postDataJSON();
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({offerId:'offer_saved',fileUrl:'https://files.example.test/offer_saved_v2.pdf',fileName:'林悦-录用通知书-v2.pdf',offerNumber:'FP-20261014-ABC123',version:2,templateType:'社招'})});
  });
  await page.route('**/api/offers/offer_saved/send-email',async(route)=>{
    mailAttempts++;
    return route.fulfill({status:mailAttempts===1?503:201,contentType:'application/json',body:JSON.stringify(mailAttempts===1?{message:'邮件服务暂时不可用'}:{recipient:'linyue@example.com'})});
  });
  await page.route('**/api/recruitment/position-options',async(route)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({positions:[
    {id:'pos_pm',name:'产品经理',department:'产品部',status:'已发布'},
  ]})}));
  await page.goto(`${baseUrl}?flow_action=offer&candidate_id=talent_a&interview_id=interview_1&position_id=pos_interview&application_id=application_1`);
  await expect(page.locator('#rf-offer-create-form')).toBeVisible();
  expect(interviewContextReads).toBe(1);
  await expect(page.locator('#rf-offer-candidate')).toHaveValue('talent_a');
  await expect(page.locator('#rf-offer-candidate')).toBeDisabled();
  await expect(page.locator('#rf-offer-role')).toHaveValue('pos_interview');
  await expect(page.locator('#rf-offer-role')).toBeDisabled();
  await expect(page.locator('#rf-offer-honorific')).toHaveValue('女士');
  await expect(page.locator('#rf-offer-create-form')).toHaveAttribute('data-application-id','application_1');
  await expect(page.locator('#rf-offer-base')).toHaveValue('');
  await expect(page.locator('#rf-offer-performance')).toBeDisabled();
  await expect(page.locator('#rf-offer-commission')).toBeDisabled();
  await expect(page.locator('#rf-offer-probation')).toHaveValue('3个月，试用期薪资100%');
  expect(offerWrites).toBe(0);
  await page.locator('#rf-offer-create-form button[type="submit"]').scrollIntoViewIfNeeded();
  await expect(page.locator('#rf-offer-create-form button[type="submit"]')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:testInfo.outputPath('hr-offer-mobile.png')});
  await page.locator('#rf-offer-base').fill('12000');
  await page.locator('#rf-offer-reporting-to').fill('张总');
  await page.locator('#rf-offer-performance-included').check();
  await page.locator('#rf-offer-performance').fill('1500');
  await page.locator('#rf-offer-commission-included').check();
  await page.locator('#rf-offer-commission').fill('800');
  await page.locator('#rf-offer-create-form button[type="submit"]').click();
  await expect(page.locator('#rf-offer-preview-send-form')).toBeVisible();
  await expect(page.locator('.rf-offer-preview-document iframe')).toHaveAttribute('src','https://files.example.test/offer_saved.pdf');
  await expect(page.locator('.rf-offer-preview-summary')).toContainText('底薪 12000 元/月 + 1500元 + 800元');
  expect(mailAttempts).toBe(0);
  expect(offerWrites).toBe(1);
  await page.screenshot({path:testInfo.outputPath('hr-offer-preview-mobile.png')});
  await page.locator('[data-offer-preview-edit]').click();
  await expect(page.locator('#rf-offer-create-form')).toBeVisible();
  await expect(page.locator('#rf-offer-base')).toHaveValue('12000');
  await expect(page.locator('#rf-offer-commission-included')).toBeChecked();
  await expect(page.locator('#rf-offer-create-form button[type="submit"]')).toContainText('重新生成 PDF 并预览');
  await page.locator('#rf-offer-base').fill('13000');
  await page.locator('#rf-offer-create-form button[type="submit"]').click();
  await expect(page.locator('.rf-offer-preview-document iframe')).toHaveAttribute('src','https://files.example.test/offer_saved_v2.pdf');
  await expect(page.locator('.rf-offer-preview-summary')).toContainText('底薪 13000 元/月 + 1500元 + 800元');
  expect(offerWrites).toBe(1);
  expect(patchWrites).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  expect(offerPayload).toMatchObject({candidateId:'talent_a',interviewId:'interview_1',positionId:'pos_interview',applicationId:'application_1',baseSalary:12000,performanceSalary:'1500',commission:'800',candidateHonorific:'女士'});
  expect(offerPayload.salaryStructure).toEqual({底薪:12000,绩效:'1500',其他:'800'});
  expect(patchPayload).toMatchObject({candidateId:'talent_a',positionId:'pos_interview',baseSalary:13000,performanceSalary:'1500',commission:'800'});
  await page.locator('#rf-offer-preview-ack').check();
  await page.getByRole('button',{name:'确认并发送 Offer',exact:true}).click();
  await expect(page.locator('#rf-offer-preview-message')).toContainText('邮件服务暂时不可用');
  expect(offerWrites).toBe(1);
  expect(patchWrites).toBe(1);
  await page.getByRole('button',{name:'重试发送 Offer',exact:true}).click();
  await expect(page.locator('#rf-offer-create-form')).toHaveCount(0);
  expect(offerWrites).toBe(1);
  expect(patchWrites).toBe(1);
  expect(mailAttempts).toBe(2);
});

test('interview schedule uses the company month boundary across Gregorian months', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  let requestedRange;
  await page.route(/\/api\/interviews\/appointments\?.*$/, async route => {
    const params = new URL(route.request().url()).searchParams;
    requestedRange = { from: params.get('from'), to: params.get('to') };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      appointments: [{ id: 'company_month_interview', candidateName: '公司月份面试', round: '一面', startAt: '2026-09-28T02:00:00.000Z', endAt: '2026-09-28T03:00:00.000Z', status: '已确认', interviewers: [] }],
      total: 1,
    }) });
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('interviews'));
  await page.locator('#interview-month-filter').fill('2026-10');
  await page.locator('#interview-month-filter').dispatchEvent('change');
  await expect.poll(() => requestedRange).toEqual({ from: '2026-09-26T16:00:00.000Z', to: '2026-10-24T16:00:00.000Z' });
  await expect(page.locator('.schedule-calendar-head')).toContainText('2026年10月');
  await expect(page.locator('.schedule-calendar-head')).toContainText('9/27–10/24');
  await expect(page.locator('.interview-mobile-agenda')).toContainText('公司月份面试');
});

test('mobile scheduling submits the direct room result and selected WeCom interviewer without local room loading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  const fixedNow = new Date();
  await page.clock.setFixedTime(fixedNow);
  const defaultSlot = new Date(Math.ceil((fixedNow.getTime() + 1) / (15 * 60 * 1000)) * 15 * 60 * 1000 + 8 * 60 * 60 * 1000).toISOString();
  let localReads = 0, roomQueries = 0, submitted;
  await page.route('**/api/interviews/rooms', route => {
    localReads += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '不应读取本地会议室' }) });
  });
  await page.route('**/api/interviews/rooms/availability?*', route => {
    roomQueries += 1;
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('source')).toBe('wecom');
    expect(params.has('roomKeyword')).toBe(false);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: '企微实时', selectionId: 'selection_direct', rooms: [{ id: 'external_direct', name: '企微直返会议室', reservable: true, status: '空闲' }] }) });
  });
  await page.route(/\/api\/interviews\/appointments(?:\?.*)?$/, route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ appointments: [] }) });
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '测试拦截，不创建日程' }) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
  await expect(page.locator('#rf-interview-date')).toHaveValue(defaultSlot.slice(0, 10));
  await expect(page.locator('#rf-interview-mode')).toHaveValue('');
  await expect(page.locator('#rf-interview-time')).toHaveValue('');
  await expect(page.locator('#rf-interview-duration')).toHaveValue('');
  await expect(page.locator('select#rf-interview-time')).toBeVisible();
  await expect(page.locator('.rf-room-availability-panel')).toBeVisible();
  await page.locator('#rf-interview-time').dispatchEvent('pointerdown');
  await expect(page.locator('#rf-interview-time')).toHaveValue(defaultSlot.slice(11, 16));
  const startOptions = await page.locator('#rf-interview-time option').evaluateAll(options => options.filter(option => option.value).map(option => option.value));
  expect(startOptions).toHaveLength(96);
  expect(startOptions.every(value => Number(value.slice(3)) % 15 === 0)).toBe(true);
  await expect(page.locator('#rf-interview-duration option')).toContainText(['30 分钟', '1 小时', '1.5 小时', '8 小时']);
  await page.locator('#rf-interview-mode').selectOption('线上面试');
  await page.locator('#rf-interview-duration').selectOption('60');
  await page.locator('[data-rf-refresh-room-availability]').click();
  await expect(page.locator('#rf-interview-room')).toContainText('企微直返会议室');
  await page.locator('#rf-interview-room').selectOption('external_direct');
  await openInterviewerPicker(page);
  await page.locator('.rf-interviewer-picker input[value="manager_1"]').check();
  await page.locator('[data-rf-create-interview]').click();
  await expect.poll(() => submitted?.meetingRoomId).toBe('external_direct');
  expect(submitted.meetingRoomSelectionId).toBe('selection_direct');
  expect(submitted.interviewerWecomIds).toEqual(['manager_1']);
  expect(roomQueries).toBe(1);
  expect(localReads).toBe(0);
  await expect(page.locator('#rf-create-interview-message')).toContainText('测试拦截');
  await page.locator('#rf-interview-time').selectOption('23:30');
  await expect(page.locator('#rf-interview-time-preview')).toContainText('23:30');
  await expect(page.locator('#rf-interview-time-preview')).toContainText('00:30');
  await expect(page.locator('#rf-interview-room')).toHaveValue('');
  await expect.poll(() => roomQueries).toBeGreaterThan(1);
  await page.locator('#rf-interview-room').selectOption('external_direct');
  await page.locator('#rf-interview-time').selectOption('11:00');
  await expect(page.locator('#rf-interview-room')).toHaveValue('');
});

test('interview room can be explicitly set to no room after a WeCom query', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  const fixedNow = new Date();
  await page.clock.setFixedTime(fixedNow);
  const defaultSlot = new Date(Math.ceil((fixedNow.getTime() + 1) / (15 * 60 * 1000)) * 15 * 60 * 1000 + 8 * 60 * 60 * 1000).toISOString();
  let submitted;
  await page.route('**/api/interviews/rooms/availability?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: '企微实时', selectionId: 'selection_optional', rooms: [{ id: 'external_optional', name: '企微可选会议室', reservable: true, status: '空闲' }] }) }));
  await page.route(/\/api\/interviews\/appointments(?:\?.*)?$/, route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ appointments: [] }) });
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '测试拦截，不创建日程' }) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
  await expect(page.locator('#rf-interview-date')).toHaveValue(defaultSlot.slice(0, 10));
  await page.locator('#rf-interview-time').dispatchEvent('pointerdown');
  await expect(page.locator('#rf-interview-time')).toHaveValue(defaultSlot.slice(11, 16));
  await page.locator('#rf-interview-mode').selectOption('线上面试');
  await page.locator('#rf-interview-duration').selectOption('60');
  await expect(page.locator('#rf-interview-location')).toHaveCount(0);
  await page.locator('[data-rf-refresh-room-availability]').click();
  await expect(page.locator('#rf-interview-room')).toContainText('企微可选会议室');
  await page.locator('#rf-interview-room').selectOption('external_optional');
  await page.locator('#rf-interview-room').selectOption({ label: '不选择会议室' });
  await expect(page.locator('#rf-interview-room')).toHaveValue('__no_room__');
  const interviewerCombobox = page.locator('[data-combobox-for="rf-interviewer-select"]');
  await interviewerCombobox.locator('input').fill('陈经理');
  await interviewerCombobox.locator('.rf-combobox-option', { hasText: '陈经理' }).click();
  await page.locator('[data-rf-create-interview]').click();
  await expect.poll(() => submitted?.meetingRoomId).toBe('');
  expect(submitted).not.toHaveProperty('meetingRoomSelectionId');
  expect(submitted.location).toBe('山东省烟台市莱山区方片新媒体');
  await expect(page.locator('#rf-create-interview-message')).toContainText('测试拦截');
});

test('selected interviewers stay selected when the summary or field title is tapped', async ({ page }) => {
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
  const interviewerCombobox = page.locator('[data-combobox-for="rf-interviewer-select"]');
  await interviewerCombobox.locator('input').fill('陈经理');
  await interviewerCombobox.locator('.rf-combobox-option', { hasText: '陈经理' }).click();
  await expect(page.locator('#rf-interviewer-selected')).toContainText('已选面试官：陈经理（1 人）');
  await page.locator('#rf-interviewer-selected').click();
  await page.locator('.rf-interviewer-field > span').first().click();
  await expect(page.locator('#rf-interviewer-selected')).toContainText('已选面试官：陈经理（1 人）');
  await expect(interviewerCombobox.locator('.rf-combobox-chip-label')).toHaveText('陈经理');
  await expect.poll(() => page.locator('#rf-interviewer-select').evaluate((select) => select.selectedOptions.length)).toBe(1);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 390, height: 380 }]) {
  test(`room authorization help preserves the mobile form and confirms Tianji notification at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await installApiMocks(page);
    await installRecruitmentFlowMocks(page);
    let failure = 'expired', notifications = 0;
    await page.route('**/api/interviews/rooms/availability?*', route => {
      if (failure === 'expired') return route.fulfill({ json: { jobId: 'room_expired' } });
      if (failure === 'network') return route.fulfill({ status: 503, json: { message: '网络超时，请重试' } });
      return route.fulfill({ json: { source: '企微实时', selectionId: 'selection_recovered', rooms: [{ id: 'room_recovered', name: '恢复后的会议室', reservable: true, status: '空闲' }] } });
    });
    await page.route('**/api/jobs/room_expired', route => route.fulfill({ json: { status: 'failed', error: 'wecom_cli 业务错误 (850003): authorization expired' } }));
    await page.route('**/api/interviews/wecom/authorization-notice', async route => {
      notifications++;
      if (notifications === 1) return route.fulfill({ status: 503, json: { message: '天玑暂不可用' } });
      return route.fulfill({ json: { jobId: 'notice_sent' } });
    });
    await page.route('**/api/jobs/notice_sent', route => route.fulfill({ json: { status: 'done', data: { status: '已发送', message: '已通过天玑通知高子云，请等待她完成企微验证。' } } }));
    await page.goto(`${baseUrl}?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
    await openInterviewerPicker(page);
    await page.locator('.rf-interviewer-picker input[value="manager_1"]').check();
    await page.locator('#rf-interview-note').fill('恢复认证后继续预约，不要清空');
    await page.locator('#rf-interview-mode').selectOption('线上面试');
    await page.locator('#rf-interview-time').dispatchEvent('pointerdown');
    await page.locator('#rf-interview-duration').selectOption('60');
    await page.locator('[data-rf-refresh-room-availability]').click();
    await expect(page.locator('#rf-room-availability-note')).toContainText('企微认证已过期');
    const contact = page.locator('[data-rf-contact-wecom-admin]');
    await expect(contact).toBeVisible();
    expect(notifications).toBe(0);
    await contact.click();
    await expect(page.locator('[data-rf-auth-notice-status]')).toContainText('通知未成功');
    await expect(contact).toBeEnabled();
    await contact.click();
    await expect(contact).toHaveText('已通知高子云');
    await expect(contact).toBeDisabled();
    await expect(page.locator('[data-rf-auth-notice-status]')).toContainText('已通过天玑通知高子云');
    expect(notifications).toBe(2);
    await expect(page.locator('#rf-interview-note')).toHaveValue('恢复认证后继续预约，不要清空');
    await expect(page.locator('.rf-interviewer-picker input[value="manager_1"]')).toBeChecked();
    await page.locator('#rf-room-auth-help').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await expect(contact).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-rf-create-interview]')).toBeInViewport({ ratio: 1 });
    expect(await page.locator('#rf-talent-dialog > .rf-dialog').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('room-authorization-help.png') });
    failure = 'network';
    await page.locator('[data-rf-refresh-room-availability]').click();
    await expect(page.locator('#rf-room-availability-note')).toContainText('网络超时');
    await expect(contact).toHaveCount(0);
    failure = '';
    await page.locator('[data-rf-refresh-room-availability]').click();
    await expect(page.locator('#rf-interview-room')).toContainText('恢复后的会议室');
    await expect(page.locator('.rf-interviewer-picker input[value="manager_1"]')).toBeChecked();
  });
}

test('room query coalesces rapid time edits and ignores an obsolete result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  const pending = [];
  await page.route('**/api/interviews/rooms/availability?*', async route => {
    pending.push(route);
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
  const tomorrow = await page.evaluate(() => new Date(Date.now() + 8 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  await page.locator('#rf-interview-date').fill(tomorrow);
  await page.locator('#rf-interview-mode').selectOption('线上面试');
  await page.locator('#rf-interview-time').dispatchEvent('pointerdown');
  await page.locator('#rf-interview-time').selectOption('10:00');
  await page.locator('#rf-interview-duration').selectOption('60');
  await page.locator('[data-rf-refresh-room-availability]').click();
  await expect.poll(() => pending.length).toBe(1);
  await page.evaluate(() => {
    const start = document.getElementById('rf-interview-time');
    const duration = document.getElementById('rf-interview-duration');
    for (const startTime of ['10:00', '10:30', '11:00']) {
      start.value = startTime;
      duration.value = '60';
      start.dispatchEvent(new Event('change', { bubbles: true }));
      duration.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await expect.poll(() => pending.length).toBe(2);
  await pending[1].fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: '企微实时', rooms: [{ id: 'new_room', name: '新时段会议室', reservable: true, status: '空闲' }] }) });
  await expect(page.locator('#rf-interview-room')).toContainText('新时段会议室');
  await pending[0].fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: '企微实时', rooms: [{ id: 'old_room', name: '旧时段会议室', reservable: true, status: '空闲' }] }) });
  await expect(page.locator('#rf-interview-room')).not.toContainText('旧时段会议室');
  await expect(page.locator('[data-rf-refresh-room-availability]')).toBeEnabled();
});

test('background invitation resumes polling after a network failure without another submission', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  let submissions = 0, polls = 0;
  await page.route(/\/api\/interviews\/appointments(?:\?.*)?$/, route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ appointments: [] }) });
    submissions += 1;
    expect(new URL(route.request().url()).searchParams.get('background')).toBe('true');
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ jobId: 'creation_test', status: 'running' }) });
  });
  await page.route('**/api/jobs/creation_test', route => {
    polls += 1;
    if (polls === 1) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'running', progress: '正在创建企业微信日程' }) });
    if (polls === 2) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '连接暂时中断' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', data: { interviewId: 'interview_test', sync: { status: '已同步' }, email: { status: '已发送' } } }) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
  await selectInterviewSchedule(page);
  await openInterviewerPicker(page);
  await page.locator('.rf-interviewer-picker input[value="manager_1"]').check();
  await page.locator('[data-rf-create-interview]').click();
  await expect(page.locator('#rf-create-interview-message')).toContainText('正在创建企业微信日程');
  await expect(page.locator('.rf-invitation-result, [data-rf-create-interview]').first()).toContainText('面试邀请已发送');
  await expect(page.getByRole('heading', { name: '面试邀请已发送', exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test('failed background invitation resubmits as a new request instead of replaying the failed job', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  const requestIds = [];
  await page.route(/\/api\/interviews\/appointments(?:\?.*)?$/, route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ appointments: [] }) });
    requestIds.push(new URL(route.request().url()).searchParams.get('requestId'));
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ jobId: `creation_failed_${requestIds.length}`, status: 'running' }) });
  });
  await page.route(/\/api\/jobs\/creation_failed_\d+$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'failed', error: '该会议室暂时无法预约，系统未生成面试记录，请换一间会议室后重新提交。' }) }));
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
  await selectInterviewSchedule(page);
  await openInterviewerPicker(page);
  await page.locator('.rf-interviewer-picker input[value="manager_1"]').check();
  await page.locator('[data-rf-create-interview]').click();
  await expect(page.locator('#rf-create-interview-message')).toContainText('该会议室暂时无法预约');
  await expect(page.locator('#rf-create-interview-message')).not.toContainText('勿重复创建');
  await expect(page.locator('[data-rf-create-interview]')).toHaveText('确认并发送邀请');
  await page.locator('[data-rf-create-interview]').click();
  await expect.poll(() => requestIds.length).toBe(2);
  expect(requestIds[1]).not.toBe(requestIds[0]);
  await expect(page.locator('#rf-create-interview-message')).toContainText('该会议室暂时无法预约');
});

test('mobile directed interview binds the candidate without a candidate picker', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  let candidateListRequests = 0;
  let submitted;
  await page.route('**/api/interviews/candidates', (route) => {
    candidateListRequests++;
    return route.fulfill({ status: 500, body: 'Candidate list must not be needed' });
  });
  await page.route(/\/api\/interviews\/appointments(?:\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '测试拦截，不发送邀请' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ appointments: [] }) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: '本次面试候选人', exact: true })).toHaveValue('林悦');
  await expect(page.getByRole('textbox', { name: '本次面试候选人', exact: true })).toHaveAttribute('readonly', '');
  await expect(page.locator('select#rf-interview-candidate')).toHaveCount(0);
  await expect(page.locator('#rf-interview-candidate')).toHaveValue('talent_a');
  expect(candidateListRequests).toBe(0);
  await selectInterviewSchedule(page);
  await openInterviewerPicker(page);
  await page.locator('.rf-interviewer-picker input[value="manager_1"]').check();
  await page.locator('[data-rf-create-interview]').click();
  await expect.poll(() => submitted?.candidateId).toBe('talent_a');
  await expect(page.locator('#rf-create-interview-message')).toHaveText('测试拦截，不发送邀请');
  await expect(page.locator('#rf-notification-region')).toContainText('测试拦截，不发送邀请');
  await expect(page.locator('[data-rf-create-interview]')).toBeEnabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

for (const scenario of [
  { width: 320, height: 568, email: '已发送', title: '面试邀请已发送' },
  { width: 390, height: 844, email: '发送失败', title: '面试处理未完成' },
]) {
  test(`mobile interview result stays visible at ${scenario.width}px with ${scenario.email}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await installApiMocks(page);
    await installRecruitmentFlowMocks(page);
    let submissions = 0;
    await page.route(/\/api\/interviews\/appointments(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'POST') {
        submissions++;
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ interviewId: 'interview_test', sync: { status: '已同步' }, email: { status: scenario.email, message: scenario.email === '发送失败' ? '邮件服务暂不可用' : '' } }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ appointments: [] }) });
    });
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
    const submit = page.locator('[data-rf-create-interview]');
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 1 });
    const controlSize = await page.locator('#rf-interview-mode').evaluate((node) => ({ height: node.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(node).fontSize) }));
    expect(controlSize.height).toBeGreaterThanOrEqual(48);
    expect(controlSize.fontSize).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: testInfo.outputPath('schedule-initial.png') });
    await submit.click();
    await expect(page.locator('#rf-create-interview-message')).toContainText('请选择面试方式');
    expect(submissions).toBe(0);
    await selectInterviewSchedule(page);
    await openInterviewerPicker(page);
    await page.locator('.rf-interviewer-picker input[value="manager_1"]').check();
    await expect(page.locator('.rf-room-availability-panel')).toBeVisible();
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 1 });
    const buttonBounds = await submit.boundingBox();
    expect(buttonBounds.height).toBeGreaterThanOrEqual(44);
    expect(await submit.evaluate((node) => { const bounds = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)); })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('schedule-mobile.png') });
    await submit.click();
    await expect(page.getByRole('heading', { name: scenario.title, exact: true })).toBeVisible();
    await expect(page.locator('.rf-invitation-summary')).toContainText('林悦');
    await expect(page.locator('.rf-invitation-receipt')).toContainText(scenario.email);
    expect(submissions).toBe(1);
    await page.locator('#rf-notification-region [data-rf-notify-close]').evaluateAll((buttons) => buttons.forEach((button) => button.click()));
    await page.screenshot({ path: testInfo.outputPath('result-mobile.png') });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await page.locator('[data-rf-open-interview-page]').click();
    await expect(page.locator('#rf-talent-dialog')).toHaveCount(0);
    await expect(page.locator('#page-interviews')).toHaveClass(/active/);
  });
}

test('mobile interview scheduling can skip the candidate email while keeping the WeCom schedule', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let submitted;
  await page.route(/\/api\/interviews\/appointments(?:\?.*)?$/, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { appointments: [] } });
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { interviewId: 'interview_test', sync: { status: '已同步' }, email: { status: '未发送', message: '已按设置跳过候选人邮件' } } });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=schedule&candidate_id=talent_a`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '为林悦安排面试' })).toBeVisible();
  const emailOption = page.locator('#rf-send-candidate-email');
  await expect(emailOption).toBeChecked();
  await emailOption.uncheck();
  await selectInterviewSchedule(page);
  await openInterviewerPicker(page);
  await page.locator('.rf-interviewer-picker input[value="manager_1"]').check();
  await page.locator('[data-rf-create-interview]').click();
  await expect(page.getByRole('heading', { name: '企微日程已创建，邮件已跳过', exact: true })).toBeVisible();
  expect(submitted).toMatchObject({ candidateId: 'talent_a', sendCandidateEmail: false });
  expect(pageErrors).toEqual([]);
});

test('mobile public interview records survive reload and meeting summaries become reviewed feedback', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let draft = null;
  let submitted;
  const evaluation49 = '候选人评价内容'.repeat(7);
  const evaluation50 = `${evaluation49}合`;
  await page.route('**/api/interview-evaluations/public**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/draft')) {
      draft = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: '已保存' }) });
    }
    if (path.endsWith('/extract')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ extraction: { recommendation: '通过', strengths: '项目证据清晰', risks: '管理经验待确认', comment: '候选人说明了量化成果，建议推进。' } }) });
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ overall: 80 }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidateName: '林悦', role: '产品经理', round: '一面', interviewerName: '陈经理', startAt: '2026-10-01T02:00:00Z', draft, questionSnapshot: [{ questionId: 'question_a', question: '请介绍你的项目成果', source: '岗位题库' }] }) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?evaluation_token=test_evaluation`, { waitUntil: 'networkidle' });
  await page.locator('textarea[name="transcript"]').fill('会议总结：候选人介绍了项目量化成果，建议通过一面。');
  await expect(page.locator('.rf-transcript-guide')).toHaveCount(0);
  await expect(page.locator('.rf-public-interview-record textarea')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '会议总结转评价' })).toBeVisible();
  expect(submitted).toBeUndefined();
  await page.locator('textarea[name="transcript"]').dispatchEvent('input');
  await expect(page.locator('[data-public-record-status]')).toContainText('草稿已保存');
  draft = { ...draft, interviewerEvaluation: evaluation49 };
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('textarea[name="transcript"]')).toHaveValue('会议总结：候选人介绍了项目量化成果，建议通过一面。');
  await expect(page.locator('[name="interviewerEvaluation"]')).toHaveValue(evaluation49);
  await expect(page.locator('[data-interviewer-evaluation-count]')).toContainText('49/50');
  await expect(page.locator('[data-question-answer]')).toHaveCount(0);
  await expect(page.locator('[name="professional"]')).toHaveCount(0);
  await page.locator('[data-public-record-extract]').click();
  await expect(page.locator('[data-public-record-status]')).toContainText('已生成AI面试总结');
  await expect(page.locator('[name="aiSummary"]')).toHaveValue('候选人说明了量化成果，建议推进。');
  await page.locator('[name="recommendation"]').selectOption('通过');
  await page.locator('[name="candidateRating"]').selectOption('a');
  await page.locator('[name="interviewerEvaluation"]').fill(evaluation49);
  await expect(page.locator('[data-interviewer-evaluation-count]')).toContainText('49/50');
  await page.screenshot({ path: testInfo.outputPath('public-evaluation-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('#rf-public-evaluation-message')).toContainText('至少填写50字');
  expect(submitted).toBeUndefined();
  await page.locator('[name="interviewerEvaluation"]').fill(evaluation50);
  await expect(page.locator('[data-interviewer-evaluation-count]')).toContainText('已达标');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.rf-public-success')).toContainText('面试评价已提交');
  await expect(page.locator('.rf-public-success')).toContainText('候选人评级：a');
  expect(submitted.evidence.transcript).toContain('会议总结');
  expect(submitted).toMatchObject({ candidateRating: 'a', aiSummary: '候选人说明了量化成果，建议推进。', interviewerEvaluation: evaluation50 });
  expect(submitted.comment).toBe(evaluation50);
  expect(submitted.scores).toEqual({});
  expect(submitted.questionAnswers).toEqual({});
});

test('mobile interview feedback extracts spoken notes into the evaluation form', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  let submittedFeedback;
  await page.route('**/api/interview-evaluations/interviews/interview_1/feedback', route => {
    if (route.request().method() === 'POST') {
      submittedFeedback = route.request().postDataJSON();
      return route.fulfill({ json: { feedbackId: 'feedback_new', submitted: 1, expected: 1, handoff: { status: '无需处理' } } });
    }
    return route.fulfill({ json: { feedback: [], history: [{ id: 'feedback_history_1', round: '一面', interviewStartAt: '2026-09-20T06:00:00.000Z', interviewer: '陈经理', candidateRating: 'a', recommendation: '通过', finalDecision: '通过', aiSummary: 'AI总结：项目结果清晰。', interviewerEvaluation: '面试官评价：建议推进。', notes: '会议总结原文记录。', submittedAt: '2026-09-20T07:00:00.000Z' }] } });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  const detail = page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') });
  const evaluationStep = detail.locator('#rf-detail-evaluation article').filter({ hasText: '面试评价' }).first();
  await evaluationStep.getByRole('button', { name: '填写评价' }).click();
  await expect(page.getByRole('heading', { name: '林悦 · 面试评价' })).toBeVisible();
  const feedbackHistory = page.locator('.rf-interview-feedback-history');
  await expect(feedbackHistory).toContainText('陈经理');
  await feedbackHistory.locator('summary').click();
  await expect(feedbackHistory).toContainText('会议总结原文记录。');
  await expect(page.locator('#rf-feedback-recommendation')).toHaveValue('');
  await page.locator('#rf-feedback-transcript').fill('候选人逻辑清晰，项目数据完整，但管理跨度还需要确认，建议通过一面，运营经理也可以考虑。');
  await expect(page.locator('#rf-feedback-transcript')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.rf-transcript-guide')).toHaveCount(0);
  await expect(page.locator('#rf-feedback-transcript').locator('..').locator('textarea')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '会议总结转评价' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('interview-evaluation-mobile.png') });
  await page.locator('[data-rf-feedback-extract]').click();
  await expect(page.locator('#rf-feedback-recommendation')).toHaveValue('通过');
  await expect(page.locator('#rf-feedback-other-roles')).toHaveCount(0);
  await expect(page.locator('#rf-feedback-strengths')).toHaveCount(0);
  await expect(page.locator('#rf-feedback-risks')).toHaveCount(0);
  await expect(page.locator('#rf-feedback-ai-summary')).toHaveValue('候选人完整说明了项目目标、个人贡献和量化结果，建议通过一面。');
  await expect(page.locator('#rf-feedback-interviewer-evaluation')).toHaveValue('');
  await expect(page.locator('#rf-feedback-candidate-rating option')).toHaveText(['请选择评级', 'S', 'a', 'b', 'c', 'z']);
  await expect(page.locator('#rf-feedback-transcript-status')).toContainText('面试官评价仍由你填写');
  const evaluation49 = '候选人评价内容'.repeat(7);
  const evaluation50 = `${evaluation49}合`;
  await page.locator('#rf-feedback-candidate-rating').selectOption('a');
  await page.locator('#rf-feedback-interviewer-evaluation').fill(evaluation49);
  await expect(page.locator('#rf-feedback-interviewer-count')).toContainText('49/50');
  const layout = await page.locator('#rf-talent-dialog:visible > .rf-dialog').evaluate((node) => ({
    dialogOverflow: node.scrollWidth - node.clientWidth,
    formOverflow: node.querySelector('.rf-feedback-dialog-form').scrollWidth - node.querySelector('.rf-feedback-dialog-form').clientWidth,
  }));
  expect(layout.dialogOverflow).toBeLessThanOrEqual(1);
  expect(layout.formOverflow).toBeLessThanOrEqual(1);
  await page.locator('[data-rf-submit-feedback]').click();
  await expect(page.locator('#rf-feedback-message')).toContainText('至少填写50字');
  expect(submittedFeedback).toBeUndefined();
  await page.locator('#rf-feedback-interviewer-evaluation').fill(evaluation50);
  await page.locator('[data-rf-submit-feedback]').click();
  await expect(page.locator('.rf-feedback-result')).toContainText('面试评价已提交');
  expect(submittedFeedback.interviewerEvaluation).toBe(evaluation50);
});

test('talent interview feedback opens after the list API falls back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  await page.route('**/api/talents**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/talents')) return route.fulfill({ status: 500, json: { message: '统一人才接口暂时不可用' } });
    return route.fallback();
  });
  await page.route('**/api/resumes', route => route.fulfill({ json: { resumes: [{ id: 'resume_a', candidateId: 'talent_a', name: '林悦', jobIntention: '产品经理', skillsCertificates: '产品规划', workExperience: '负责SaaS产品规划。', createdTime: '2026-09-01T00:00:00.000Z' }] } }));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.setPage === 'function');
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('#resumeflow-archive-root')).toContainText('统一人才接口暂时无法读取');
  await page.locator('[data-rf-talent="talent_a"]').click();
  const detail = page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') });
  await expect(detail).toBeVisible();
  const evaluationStep = detail.locator('#rf-detail-evaluation article').filter({ hasText: '面试评价' }).first();
  const feedbackButton = evaluationStep.getByRole('button', { name: '填写评价' });
  await expect(feedbackButton).toHaveAttribute('data-rf-candidate-id', 'talent_a');
  await expect(feedbackButton).toHaveAttribute('data-rf-interview-id', 'interview_1');
  await feedbackButton.click();
  await expect(page.getByRole('heading', { name: '林悦 · 面试评价' })).toBeVisible();
});

for (const entry of ['phone', 'interview', 'recovery']) {
  test(`interview scheduling recovers candidate context through ${entry}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installApiMocks(page);
    let resolved;
    await page.route('**/api/interviews/scheduling-candidate', async route => {
      resolved = route.request().postDataJSON();
      await route.fulfill({ json: { candidate: { id: 'talent_a', name: '林悦', bestMatchRole: '产品经理' } } });
    });
    const suffix = entry === 'phone' ? '&candidate_phone=13800138000' : entry === 'interview' ? '&interview_id=interview_a' : '';
    await page.goto(`${baseUrl}?flow_action=schedule${suffix}`, { waitUntil: 'networkidle' });
    if (entry === 'recovery') {
      await expect(page.getByRole('heading', { name: '匹配本次面试候选人' })).toBeVisible();
      await page.locator('#rf-interview-recovery-form [name="phone"]').fill('13800138000');
      await page.getByRole('button', { name: '匹配并继续安排' }).click();
    }
    await expect(page.getByRole('heading', { name: '为林悦安排面试' })).toBeVisible();
    await expect(page.locator('#rf-interview-candidate')).toHaveValue('talent_a');
    await expect(page.locator('[aria-label="本次面试候选人"]')).toHaveAttribute('readonly', '');
    expect(resolved).toMatchObject(entry === 'interview' ? { interviewId: 'interview_a' } : { phone: '13800138000' });
    expect(page.url()).not.toContain('13800138000');
  });
}

for (const width of [390, 1440]) {
  test(`communication HR defaults to position owner and searchable history preserves attribution at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await installApiMocks(page);
    await installRecruitmentFlowMocks(page);
    let saved;
    await page.route('**/api/recruitment/form-options', route => route.fulfill({ json: { employees: [
      { id: 'hr_other', name: '陈HR', department: '签约' }, { id: 'hr_1', name: '王HR', department: '自孵' },
    ] } }));
    await page.route('**/api/talents/talent_a/communications', async route => {
      if (route.request().method() === 'POST') {
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { candidateId: 'talent_a' } });
      }
      return route.fulfill({ json: { defaultHr: { id: 'hr_1', name: '王HR' }, communications: [
        { id: 'comm_old', result: '推进面试', channel: '微信', operator: '历史HR', summary: '之前的沟通摘要', workContent: '完整职责记录\n第二行内容', notes: '历史备注', occurredAt: '2026-09-20 10:00' },
        { id: 'comm_unknown', result: '推进面试', operator: '当前用户', summary: '没有明确人员的旧记录' },
      ] } });
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('resume-archive'));
    await page.locator('[data-rf-talent="talent_a"]').click();
    await page.locator('#rf-detail-evaluation article').filter({ hasText: '意向沟通' }).first().locator('button:not([data-rf-flow-wecom])').click();
    await expect(page.locator('#rf-comm-hr')).toHaveValue('hr_1');
    await page.locator('#rf-comm-notes').fill('查看历史不丢失草稿');
    const hrComboboxInput = page.locator('[data-combobox-for="rf-comm-hr"] input');
    await hrComboboxInput.fill('不存在的HR');
    await expect(page.locator('[data-combobox-for="rf-comm-hr"] .rf-combobox-empty')).toContainText('没有匹配项');
    await expect(page.locator('#rf-comm-hr')).toHaveValue('hr_1');
    await hrComboboxInput.fill('签约');
    await page.locator('[data-combobox-for="rf-comm-hr"] .rf-combobox-option').click();
    await expect(page.locator('#rf-comm-hr')).toHaveValue('hr_other');
    const history = page.locator('.rf-comm-history').first();
    await history.locator('summary').click();
    await expect(history.locator('dl')).toContainText('完整职责记录\n第二行内容');
    await expect(history.locator('dl > div').filter({ hasText: '通过HR（本次沟通）' })).toContainText('历史HR');
    const unknown = page.locator('.rf-comm-history').nth(1);
    await unknown.locator('summary').click();
    await expect(unknown.locator('dl > div').filter({ hasText: '通过HR（本次沟通）' })).toContainText('未记录明确人员');
    await expect(page.locator('#rf-comm-notes')).toHaveValue('查看历史不丢失草稿');
    await history.locator('summary').evaluate(node => node.scrollIntoView({ block: 'start' }));
    if (width < 1024) {
      await expect(history.locator('dl > div').filter({ hasText: '通过HR（本次沟通）' })).toBeInViewport({ ratio: 1 });
      expect(await page.locator('.rf-communication-layout > aside').evaluate(node => getComputedStyle(node).maxHeight)).toBe('none');
    }
    await page.screenshot({ path: testInfo.outputPath('communication-history.png') });
    expect(await page.locator('#rf-talent-dialog > .rf-dialog').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    for (const field of ['channel', 'answer-status', 'interest', 'job-status', 'leave-reason', 'result']) await page.locator(`#rf-comm-${field}`).selectOption({ index: 1 });
    await page.locator('[data-rf-save-communication]').click();
    await expect(page.getByRole('dialog', { name: '已提交', exact: true })).toBeVisible();
    expect(saved).toMatchObject({ operator: '陈HR', operatorUserId: 'hr_other', notes: '查看历史不丢失草稿' });
  });
}

test('communication without a bound HR requires explicit selection instead of choosing the first employee', async ({ page }) => {
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  await page.route('**/api/talents/talent_a/communications', route => route.fulfill({ json: { communications: [], defaultHr: {} } }));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  await page.locator('#rf-detail-evaluation article').filter({ hasText: '意向沟通' }).first().locator('button:not([data-rf-flow-wecom])').click();
  await expect(page.locator('#rf-comm-hr')).toHaveValue('');
  await page.locator('[data-rf-save-communication]').click();
  await expect(page.locator('#rf-comm-message')).toContainText('请选择本次沟通HR');
});

for (const width of [390, 1440]) {
  test(`reopening a resume refreshes completed communication flow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installApiMocks(page);
    let completed = false, detailReads = 0;
    await page.route('**/api/talents/talent_a', route => {
      detailReads++;
      return route.fulfill({ json: { id: 'talent_a', name: '林悦', status: '意向沟通', skills: [], tags: [], matches: [], timeline: [], reviews: [], assessmentResults: [], communications: [{ id: 'old_record', applicationId: 'old_application' }], flowEvidence: { communications: completed ? 1 : 0 } } });
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('resume-archive'));
    await page.locator('[data-rf-talent="talent_a"]').click();
    const communication = page.locator('#rf-detail-evaluation article').filter({ hasText: '意向沟通' });
    await expect(communication).not.toHaveClass(/done/);
    await page.locator('#rf-talent-dialog > .rf-dialog > .rf-dialog-close').click();
    const readsBefore = detailReads;
    completed = true;
    await page.locator('[data-rf-talent="talent_a"]').click();
    await expect(communication).toHaveClass('done');
    await expect(communication).toHaveAttribute('aria-label', /已完成.*1 条沟通记录/);
    await expect(communication.locator('button:not([data-rf-flow-wecom])')).toHaveText('查看沟通');
    expect(detailReads).toBeGreaterThan(readsBefore);
    const color = await communication.evaluate(node => getComputedStyle(node).backgroundColor.match(/\d+/g).map(Number));
    expect(color[1]).toBeGreaterThan(color[0]);
  });
}

test('communication only shows completion after a successful save and preserves failed input', async ({ page }) => {
  await installApiMocks(page);
  await installRecruitmentFlowMocks(page);
  let attempts = 0;
  await page.route('**/api/talents/talent_a/communications', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts++;
    await route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { message: '临时保存失败' } : { status: '已提交' } });
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  await page.locator('#rf-detail-evaluation article').filter({ hasText: '意向沟通' }).first().locator('button:not([data-rf-flow-wecom])').click();
  for (const field of ['channel', 'answer-status', 'interest', 'job-status', 'leave-reason', 'result']) await page.locator(`#rf-comm-${field}`).selectOption({ index: 1 });
  await page.locator('#rf-comm-notes').fill('失败时保留这份记录');
  await page.locator('[data-rf-save-communication]').click();
  await expect(page.locator('#rf-comm-message')).toContainText('临时保存失败');
  await expect(page.locator('#rf-communication-complete')).toHaveCount(0);
  await expect(page.locator('#rf-comm-notes')).toHaveValue('失败时保留这份记录');
  await page.locator('[data-rf-save-communication]').click();
  await expect(page.getByRole('dialog', { name: '已提交', exact: true })).toContainText('请留意系统消息');
  expect(attempts).toBe(2);
  await page.getByRole('button', { name: '直接约面', exact: true }).click();
  await expect(page.getByRole('heading', { name: '为林悦安排面试' })).toBeVisible();
  await expect(page.locator('#rf-interview-candidate')).toHaveValue('talent_a');
  await expect(page.locator('#rf-interview-recovery-form')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('candidate_id')).toBe('talent_a');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '为林悦安排面试' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('candidate_id')).toBe('talent_a');
  expect(attempts).toBe(2);
});

test('public communication goes straight to the bound interview after employee login without resubmission', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  let loggedIn = false, submissions = 0, invitations = 0;
  await page.route('**/api/access/me', route => loggedIn ? route.fallback() : route.fulfill({ json: { authenticated: false, authorized: false, accessState: 'identity_unavailable' } }));
  await page.route('**/api/access/login', async route => { loggedIn = true; await route.fulfill({ json: { authenticated: true } }); });
  await page.route('**/api/interviews/appointments**', async route => {
    if (route.request().method() === 'POST') invitations++;
    await route.fallback();
  });
  await page.route('**/api/public/interviews/communication?token=direct-schedule', async route => {
    if (route.request().method() === 'POST') submissions++;
    await route.fulfill({ json: { status: '已提交', candidateId: 'talent_a', candidateName: '林悦', role: '产品经理' } });
  });
  await page.route('**/communication?token=direct-schedule', async route => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    const response = await route.fetch({ url: baseUrl });
    await route.fulfill({ response });
  });
  await page.goto(`${baseUrl}communication?token=direct-schedule`, { waitUntil: 'networkidle' });
  for (const [name, value] of Object.entries({ channel: '电话', answerStatus: '已接通', interestLevel: '高', jobStatus: '已离职', result: '推进面试' })) await page.locator(`[name="${name}"]`).selectOption(value);
  await page.getByRole('button', { name: '提交意向沟通', exact: true }).click();
  await page.getByRole('button', { name: '直接约面', exact: true }).click();
  await expect(page.locator('#auth-login-form')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('candidate_id')).toBe('talent_a');
  await page.locator('#auth-login-form [name="name"]').fill('测试HR');
  await page.locator('#auth-login-form [name="mobile"]').fill('13800138000');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: '为林悦安排面试' })).toBeVisible();
  await expect(page.locator('#rf-interview-candidate')).toHaveValue('talent_a');
  await expect(page.locator('#rf-interview-recovery-form')).toHaveCount(0);
  expect(submissions).toBe(1);
  expect(invitations).toBe(0);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 390, height: 380 }]) {
  test(`public communication uses the whole page at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    let submitted;
    await page.route('**/api/**', async route => {
      if (route.request().method() === 'POST') submitted = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidateId: 'talent_a', candidateName: '林悦', role: '产品经理', expiresAt: '2026-10-01T12:00:00Z' }) });
    });
    await page.route('**/communication?token=scroll-test', async route => {
      if (!route.request().isNavigationRequest()) return route.fallback();
      const response = await route.fetch({ url: baseUrl });
      await route.fulfill({ response });
    });
    await page.goto(`${baseUrl}communication?token=scroll-test`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: '意向沟通记录' })).toBeVisible();
    const transcript = page.locator('#rf-public-communication-transcript');
    await transcript.fill('候选人愿意参加面试，其他信息待确认。');
    await expect(page.getByRole('group', { name: '口述提纲', exact: true })).toHaveCount(0);
    expect(submitted).toBeUndefined();
    if (viewport.height >= 568) {
      await expect(transcript).toBeInViewport({ ratio: 1 });
    }
    await transcript.scrollIntoViewIfNeeded();
    await expect(transcript).toBeInViewport({ ratio: 1 });
    expect(await transcript.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(120);
    expect(await page.locator('.rf-public-communication-scroll').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('communication-writing.png') });
    for (const [name, value] of Object.entries({ channel: '电话', answerStatus: '已接通', interestLevel: '高', jobStatus: '已离职', result: '推进面试' })) {
      await page.locator(`[name="${name}"]`).selectOption(value);
    }
    await page.locator('[name="notes"]').fill('已核对，等待约面');
    const submit = page.getByRole('button', { name: '提交意向沟通', exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 1 });
    expect(await page.locator('.rf-public-communication-hero').evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await submit.click();
    await expect(page.locator('#rf-public-communication-message')).toContainText('已提交');
    const completion = page.getByRole('dialog', { name: '已提交', exact: true });
    await expect(completion).toBeVisible();
    await expect(completion).toContainText('请留意系统消息');
    await expect(completion.getByRole('button', { name: '直接约面', exact: true })).toBeInViewport({ ratio: 1 });
    expect((await completion.boundingBox()).width).toBeLessThanOrEqual(viewport.width - 32);
    await expect(completion.getByRole('button', { name: '知道了' })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('communication-completion-shortcut.png') });
    await completion.getByRole('button', { name: '知道了' }).click();
    await expect(completion).toHaveCount(0);
    await expect(page.getByRole('button', { name: '提交意向沟通', exact: true })).toHaveCount(0);
    expect(submitted).toMatchObject({ candidateId: 'talent_a', notes: '候选人愿意参加面试，其他信息待确认。', result: '推进面试' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('communication-submitted.png') });
  });
}

test('public long forms keep a usable document scrollbar on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith('/api/public/assessments/scroll-test')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidateName: '林悦',
        expiresAt: '2026-09-30T18:00:00.000Z',
        template: { name: '产品经理岗位测评', durationMinutes: 45, instructions: '请结合真实经历完整填写。' },
        questions: Array.from({ length: 10 }, (_, index) => ({
          id: `question_${index + 1}`,
          order: index + 1,
          title: `第 ${index + 1} 题：请说明一段与岗位相关的真实经历`,
          category: '岗位能力',
          score: 10,
          required: true,
          type: 'text',
          description: '请说明背景、行动和结果。',
        })),
      }),
    });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?assessment_token=scroll-test`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '产品经理岗位测评' })).toBeVisible();

  const layout = await page.evaluate(() => ({
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);
  expect(['auto', 'scroll']).toContain(layout.bodyOverflowY);
  expect(['auto', 'scroll']).toContain(layout.htmlOverflowY);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('deleting a resume from talent detail closes the dialog and refreshes the list', async ({ page }) => {
  await installApiMocks(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await page.locator('[data-rf-talent="talent_a"]').click();
  await expect(page.locator('#rf-talent-dialog .rf-full-detail-dialog')).toBeVisible();
  await page.locator('#rf-talent-dialog [data-rf-more-toggle]').click();
  await page.locator('#rf-talent-dialog [data-rf-delete-talent-resume]').click();

  await expect(page.locator('#rf-talent-dialog')).toHaveCount(0);
  await expect(page.locator('[data-rf-talent="talent_a"]')).toHaveCount(0);
  await expect(page.locator('#rf-notification-region')).toContainText('简历已删除，该人才已从人才库隐藏。');
});

test('employee name and mobile login remembers the device and enters the authorized workspace', async ({ page }) => {
  let loggedIn = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/access/login')) {
      const body = route.request().postDataJSON();
      if (body.name !== '高子云' || body.mobile !== '15762703457') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: '姓名或手机号不正确，或者账号尚未由管理员启用' }) });
      loggedIn = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ authenticated: true, message: '登录成功' }) });
    }
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(loggedIn
      ? { authenticated: true, authorized: true, accessState: 'active', identitySource: 'session', userId: 'admin_1', userName: '高子云', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }], sensitiveFields: [{ roleCode: 'system_admin', contacts: 'full' }], account: { id: 'admin_1', name: '高子云', mobile: '15762703457', status: '启用' } }
      : { authenticated: false, authorized: false, accessState: 'identity_unavailable', identitySource: 'unavailable', roleCodes: [], pages: [], actions: [] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '员工登录' })).toBeVisible();
  await expect(page.locator('#talent-app')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('input[name="name"]').fill('高子云');
  await page.locator('input[name="mobile"]').fill('15762703457');
  await page.getByRole('button', { name: '登录并进入系统' }).click();
  await expect(page.locator('#talent-app')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('button', { name: '退出' })).toBeVisible();
});

test('transient identity refresh failures preserve the employee session', async ({ page }) => {
  await installApiMocks(page);
  let identityReads = 0;
  await page.route('**/api/access/me', async route => {
    identityReads += 1;
    if (identityReads === 1) return route.fallback();
    if (identityReads === 2) return route.fulfill({ status: 503, json: { message: '身份服务暂时不可用' } });
    return route.abort('failed');
  });
  await page.route('**/api/talents?**', route => route.fulfill({ status: 403, json: { message: '人才查看权限已被撤销' } }));

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveClass(/auth-ready/);
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('#resumeflow-archive-root')).toContainText('人才查看权限已被撤销');
  await expect(page.locator('body')).toHaveClass(/auth-ready/);
  expect(identityReads).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => identityReads).toBe(2);
  await expect(page.locator('body')).toHaveClass(/auth-ready/);
  await expect(page.getByRole('button', { name: '退出', exact: true })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => identityReads).toBe(3);
  await expect(page.locator('body')).toHaveClass(/auth-ready/);
  expect(await page.evaluate(() => window.recruitmentCurrentUser?.id)).toBe('admin_1');
});

test('a definitive unauthenticated response still signs out', async ({ page }) => {
  await installApiMocks(page);
  let identityReads = 0;
  await page.route('**/api/access/me', async route => {
    identityReads += 1;
    if (identityReads === 1) return route.fallback();
    return route.fulfill({ json: { authenticated: false, authorized: false, accessState: 'identity_unavailable' } });
  });
  await page.route('**/api/talents?**', route => route.fulfill({ status: 401, json: { message: '登录状态已失效' } }));

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveClass(/auth-ready/);
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('body')).toHaveClass(/auth-blocked/);
  await expect(page.getByRole('heading', { name: '员工登录' })).toBeVisible();
});

test('overview hiring delivery sorts priorities, keeps completed roles last and fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const hiringQueries = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', identitySource: 'studio', userId: 'admin_1', userName: '系统管理员',
      roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }],
      sensitiveFields: [{ roleCode: 'system_admin', contacts: 'full' }], account: { id: 'admin_1', name: '系统管理员', mobile: '13800138000', departments: ['产品部'], status: '启用' },
    }) });
    if (path.endsWith('/api/recruitment/monthly-hiring')) {
      const period = url.searchParams.get('period') || 'day', month = url.searchParams.get('month') || '2026-10';
      hiringQueries.push({ period, month });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      month, period, summary: { demand: 13, resumes: 20, interviews: 8, offers: 4, actualOffers: 3, arrived: 3 },
      hiringActivity: {
        date: period === 'day' ? '2026-10-14' : period === 'week' ? '2026-10-12 至 2026-10-18' : '2026-09-27 至 2026-10-24',
        summary: { resumes: 12, interviews: 3, offers: 1, arrived: 1 },
        uploaders: [{ name: '张晓霞', count: 2, department: '商务' }],
        departmentUploads: [{ department: '商务', count: 2, uploaders: [{ name: '张晓霞', count: 2 }] }],
        resumeUploads: Array.from({ length: 12 }, (_, index) => ({
          candidateName: `今日候选人${index + 1}`, department: '商务', uploader: '张晓霞',
          fileName: `今日候选人${index + 1}.pdf`, sourceUrl: `https://cdn.example.test/today-${index + 1}.pdf`, uploadedAt: `2026-10-14 10:${String(index).padStart(2, '0')}:00`,
        })),
        interviewDetails: [
          { candidateName: '面试候选人', department: '技术部', position: '前端工程师', round: '一面', method: '现场', startsAt: '2026-10-14 10:00:00', interviewers: '顾承均', location: '5F会议室', status: '已确认' },
          { candidateName: '复试候选人', department: '技术部', position: '后端工程师', round: '二面', method: '线上', startsAt: '2026-10-14 15:00:00', interviewers: '李思奇', location: '腾讯会议', status: '已确认' },
        ],
        offerDetails: [{ candidateName: 'Offer候选人', department: '技术部', position: '前端工程师', offerNo: 'FP-20261014-01', sentAt: '2026-10-14 11:00:00', status: '已发送' }],
        arrivalDetails: [{ candidateName: '到岗候选人', department: '技术部', position: '前端工程师', arrivalDate: '2026-10-14', status: '已到岗' }],
      },
      departments: [
        { department: '产品部', role: '紧急已完成', demand: 1, completed: 1, priority: '紧急', status: '已确认', completedAll: true, remaining: 0, completionRate: 100, completedNames: ['林悦'] },
        { department: '运营部', role: '一般未到岗', demand: 2, completed: 0, priority: '一般', status: '已确认', completedAll: false, remaining: 2, completionRate: 0, completedNames: [] },
        { department: '技术部', role: '紧急已到岗一人', demand: 3, completed: 1, priority: '紧急', status: '已确认', completedAll: false, remaining: 2, completionRate: 33, completedNames: ['周明'] },
        { department: '商务部', role: '重要未到岗', demand: 3, completed: 0, priority: '重要', status: '已确认', completedAll: false, remaining: 3, completionRate: 0, completedNames: [] },
        { department: '技术部', role: '紧急未到岗', recruiter: '张杰', backupRecruiter: '张晓霞', demand: 4, completed: 0, priority: '紧急', status: '已确认', completedAll: false, remaining: 4, completionRate: 0, completedNames: [] },
      ],
    }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await expect(page.locator('#overview-analysis')).toHaveAttribute('data-v-app', '');
  expect(hiringQueries.filter(query => query.period === 'day')).toHaveLength(1);
  await expect(page.locator('#overview-daily-title')).toHaveText('招聘数据总览');
  await expect(page.locator('#overview-activity-title')).toHaveText('核心指标');
  const activityExport = page.waitForEvent('download');
  await page.locator('[data-action="export-month"]').click();
  expect((await activityExport).suggestedFilename()).toContain('招聘进度-日');
  await expect(page.locator('[data-overview-period="day"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.overview-daily-metric')).toHaveCount(4);
  await expect(page.locator('.overview-daily-uploader-summary:not(.overview-daily-department-summary)')).toContainText('张晓霞');
  await expect(page.locator('.overview-daily-department-summary')).toContainText('商务');
  await expect(page.locator('.overview-daily-resume-details')).toHaveCount(0);
  await expect(page.locator('.overview-hiring-summary')).toContainText('本月实际 Offer');
  await expect(page.locator('.overview-hiring-summary')).toContainText('3');
  await expect(page.locator('.overview-hiring-numbers span').filter({ hasText: '实际 Offer' })).toHaveCount(5);
  await expect(page.locator('.overview-hiring-progress small').first()).toContainText('尚未发 Offer');
  await page.locator('[data-overview-metric="resumes"]').click();
  await expect(page.locator('.overview-metric-dialog h2')).toHaveText('简历入库明细');
  await expect(page.locator('.overview-metric-list .overview-metric-detail')).toHaveCount(10);
  await expect(page.locator('.overview-metric-list .overview-metric-detail').first()).toContainText('今日候选人1');
  await page.locator('[data-overview-metric-page="2"]').click();
  await expect(page.locator('.overview-metric-list .overview-metric-detail')).toHaveCount(2);
  await expect(page.locator('.overview-metric-pager')).toContainText('第 11-12 条 · 第 2/2 页');
  await expect(page.locator('.overview-metric-dialog')).toBeVisible();
  const dialogLayout = await page.locator('.overview-metric-dialog').evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(dialogLayout.scrollWidth).toBeLessThanOrEqual(dialogLayout.clientWidth + 1);
  await page.locator('.rf-dialog-close').click();
  for (const metric of ['interviews', 'offers', 'arrived']) {
    await page.locator(`[data-overview-metric="${metric}"]`).click();
    await expect(page.locator('.overview-metric-list .overview-metric-detail').first()).toBeVisible();
    await page.locator('.rf-dialog-close').click();
  }
  const mobileColumns = await page.locator('.overview-daily-metrics').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  expect(mobileColumns).toBe(2);
  await expect(page.locator('#overview-analysis .overview-hiring-row')).toHaveCount(5);
  await expect(page.locator('#overview-analysis .overview-hiring-identity strong')).toHaveText(['紧急未到岗', '紧急已到岗一人', '重要未到岗', '一般未到岗', '紧急已完成']);
  await expect(page.locator('#overview-analysis .overview-hiring-row').nth(0)).toHaveClass(/priority-urgent/);
  await expect(page.locator('#overview-analysis .overview-hiring-row').nth(2)).toHaveClass(/priority-important/);
  await expect(page.locator('#overview-analysis .overview-hiring-row').nth(3)).toHaveClass(/priority-normal/);
  await expect(page.locator('#overview-analysis .overview-hiring-row').nth(3).locator('.overview-priority-badge')).toHaveText('储备');
  await expect(page.locator('#overview-analysis .overview-hiring-recruiter').first()).toHaveText('招聘HR：张杰 · 备用HR：张晓霞');
  await expect(page.locator('#overview-analysis .overview-hiring-recruiter').nth(1)).toHaveText('招聘HR：待分配');
  await expect(page.locator('#overview-analysis .overview-hiring-row').last()).toHaveClass(/is-completed/);
  await expect(page.locator('#overview-analysis .overview-completed-divider')).toHaveCount(1);
  const layout = await page.locator('#overview-analysis').evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopColumns = await page.locator('.overview-daily-metrics').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  expect(desktopColumns).toBe(4);
  await page.locator('[data-overview-period="week"]').click();
  await expect(page.locator('[data-overview-period="week"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.overview-daily-uploader-summary:not(.overview-daily-department-summary)')).toContainText('本周来源');
  await page.locator('[data-overview-period="month"]').click();
  await expect(page.locator('#overview-month-filter')).toBeVisible();
  const monthPickerLayout = await page.locator('.overview-month-picker').evaluate(node => ({
    inputBorder: getComputedStyle(node.querySelector('input')).borderTopWidth,
    inputShadow: getComputedStyle(node.querySelector('input')).boxShadow,
    wrapperBorder: getComputedStyle(node).borderTopWidth,
  }));
  expect(monthPickerLayout).toEqual({ inputBorder: '0px', inputShadow: 'none', wrapperBorder: '1px' });
  await page.locator('#overview-month-filter').fill('2026-09');
  await page.locator('#overview-month-filter').dispatchEvent('change');
  await expect(page.locator('#overview-month-filter')).toHaveValue('2026-09');
  await page.evaluate(() => window.setPage('settings'));
  await page.evaluate(() => window.setPage('overview'));
  await expect(page.locator('[data-overview-period="month"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#overview-month-filter')).toHaveValue('2026-09');
  expect(hiringQueries.some(query => query.period === 'week')).toBe(true);
  expect(hiringQueries.some(query => query.period === 'month' && query.month === '2026-09')).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#overview-month-filter')).toBeVisible();
  const monthlyMobileLayout = await page.locator('#overview-analysis').evaluate(node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(monthlyMobileLayout.scrollWidth).toBeLessThanOrEqual(monthlyMobileLayout.clientWidth + 1);
});

for (const scenario of [{ visibility: 'mine', width: 390, total: 1 }, { visibility: 'mine', width: 320, total: 0 }, { visibility: 'all', width: 1440, total: 2 }]) {
  test(`interview calendar explains ${scenario.visibility} scope at ${scenario.width}px with ${scenario.total} records`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    await installApiMocks(page);
    await page.route('**/api/interviews/appointments?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      visibility: scenario.visibility,
      total: scenario.total,
      appointments: [
        { id: 'mine', candidateName: '本人面试候选人', startAt: '2026-10-15T02:00:00Z', endAt: '2026-10-15T03:00:00Z', status: '已确认', interviewers: [] },
        { id: 'other', candidateName: '其他面试候选人', startAt: '2026-10-16T02:00:00Z', endAt: '2026-10-16T03:00:00Z', status: '已完成', interviewers: [] },
      ].slice(0, scenario.total),
    }) }));
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('interviews'));
    await page.locator('#interview-month-filter').fill('2026-10');
    await expect(page.locator('#page-interviews .page-head p')).toContainText(scenario.visibility === 'mine' ? '仅展示你参与或组织的面试' : '管理员视图');
    if (scenario.visibility === 'mine') await expect(page.locator('#interview-schedule-root')).not.toContainText('其他面试候选人');
    else await expect(page.locator('#interview-schedule-root')).toContainText('其他面试候选人');
    if (scenario.total) await expect(page.locator('#interview-schedule-root')).toContainText('本人面试候选人');
    else await expect(page.locator('#interview-schedule-root [data-interview-schedule-id]')).toHaveCount(0);
  });
}

for (const width of [320, 390]) {
test(`mobile interview calendar opens schedule details and cancels in place at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  let cancelled = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', userId: 'admin_1', userName: '系统管理员', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'],
      dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }], sensitiveFields: [{ roleCode: 'system_admin', contacts: 'full' }],
      account: { id: 'admin_1', name: '系统管理员', mobile: '13800138000', departments: ['人才部'], status: '启用' },
    }) });
    if (path.endsWith('/api/interviews/appointments/interview_mobile/cancel')) {
      const body = request.postDataJSON();
      expect(body.reason).toBe('候选人申请改期');
      cancelled = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ interviewId: 'interview_mobile', status: '已取消', sync: { status: '已同步' } }) });
    }
    if (path.endsWith('/api/interviews/appointments')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      total: 1,
      appointments: [{ id: 'interview_mobile', candidateName: '林悦', round: '一面', mode: '线下面试', startAt: '2026-09-25T02:00:00.000Z', endAt: '2026-09-25T03:00:00.000Z', timezone: 'Asia/Shanghai', location: '烟台总部', room: { name: '海棠会议室' }, interviewers: [{ name: '陈经理' }], status: cancelled ? '已取消' : '已确认', confirmationStatus: cancelled ? '已取消' : '已确认', note: '请提前十分钟到场' }],
    }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('interviews'));
  await page.locator('#interview-month-filter').fill('2026-09');
  await page.locator('#interview-month-filter').dispatchEvent('change');
  const event = page.locator('[data-interview-agenda-id="interview_mobile"]');
  await expect(event).toBeVisible();
  await expect(event).toContainText('海棠会议室');
  await expect(page.locator('.interview-mobile-summary')).toBeVisible();
  await page.getByRole('button', { name: '查看下个月面试' }).click();
  await expect(page.locator('#interview-month-filter')).toHaveValue('2026-10');
  await page.getByRole('button', { name: '查看上个月面试' }).click();
  await expect(page.locator('#interview-month-filter')).toHaveValue('2026-09');
  await event.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('interview-agenda-mobile.png') });
  await event.click();
  const detailDialog = page.locator('#rf-talent-dialog:visible');
  await expect(detailDialog.getByRole('heading', { name: '林悦 · 一面' })).toBeVisible();
  await expect(detailDialog.getByText('陈经理', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消面试' }).click();
  await page.locator('#rf-schedule-cancel-reason').fill('候选人申请改期');
  await page.getByRole('button', { name: '确认取消面试' }).click();
  await expect(page.locator('#rf-talent-dialog')).toHaveCount(0);
  await expect(page.locator('[data-interview-agenda-id="interview_mobile"]')).toHaveClass(/cancelled/);
  await expect(page.getByText('面试已取消，日历排期已更新。')).toBeVisible();
  const layout = await page.locator('#page-interviews').evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
});

}

test('scheduled tasks keep the saved cron and manual execution works for authorized users', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let savedCron = '', ran = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', userId: 'admin_1', userName: '系统管理员', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'],
      dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }], sensitiveFields: [{ roleCode: 'system_admin', contacts: 'full' }],
      account: { id: 'admin_1', name: '系统管理员', mobile: '13800138000', departments: ['人才部'], status: '启用' },
    }) });
    if (path.endsWith('/api/studio-tasks/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [{ key: 'daily-demand', name: '招聘需求录入提醒', description: '提醒业务部门录入招聘需求', defaultCron: '0 18 * * *', defaultSchedule: '每天 18:00', available: true }] }) });
    if (path.endsWith('/api/studio-tasks/招聘需求录入提醒/config')) {
      savedCron = request.postDataJSON().cron || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: '招聘需求录入提醒', updated: true }) });
    }
    if (path.endsWith('/api/studio-tasks/招聘需求录入提醒/run-now')) {
      ran = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ jobId: 'job_task_manual', status: 'running' }) });
    }
    if (path.endsWith('/api/jobs/job_task_manual')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'job_task_manual', status: 'done', progress: '解析完成', data: { task: '招聘需求录入提醒', trigger: 'manual', status: 'success', durationMs: 350, artifacts: [] } }) });
    if (path.endsWith('/api/studio-tasks')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      tasks: [{ name: '招聘需求录入提醒', description: '提醒业务部门录入招聘需求', cron: '15 18 * * *', schedule: '每天 18:15', enabled: true, lastStatus: 'success', lastRunAt: '2026-09-24T10:15:00.000Z', runCount: 2 }],
      recentRuns: [{ task: '招聘需求录入提醒', trigger: 'manual', status: 'success', startedAt: '2026-09-24T10:15:00.000Z', durationMs: 350, artifacts: '[]' }],
    }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('scheduled-tasks'));
  await expect(page.getByText('每天 18:15')).toBeVisible();
  await page.getByRole('button', { name: '编辑' }).click();
  await expect(page.locator('[data-schedule-time]')).toHaveValue('18:15');
  await page.locator('[data-schedule-time]').fill('18:30');
  await page.getByRole('button', { name: '保存' }).click();
  expect(savedCron).toBe('30 18 * * *');
  await page.getByRole('button', { name: '手动执行' }).click();
  expect(ran).toBe(true);
});

test('new task template uses the visual schedule editor and saves once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  let submitted, writes = 0;
  await page.route('**/api/studio-tasks**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/templates')) return route.fulfill({ json: { templates: [{ name: '模板任务', key: 'test', available: true, defaultCron: '0 9 * * *', timezone: 'Asia/Shanghai' }] } });
    if (path.endsWith('/config')) { writes++; submitted = route.request().postDataJSON(); return route.fulfill({ json: { updated: true } }); }
    return route.fulfill({ json: { tasks: [], recentRuns: [] } });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('scheduled-tasks'));
  await page.locator('#rf-task-create-btn').click();
  await page.getByRole('button', { name: '设置执行时间' }).click();
  await expect(page.locator('[data-schedule-time]')).toHaveValue('09:00');
  await page.locator('[data-schedule-time]').fill('08:45');
  await page.locator('#rf-task-edit-save').click();
  await expect(page.locator('#rf-task-edit-save')).toHaveCount(0);
  expect(submitted).toEqual({ cron: '45 8 * * *', schedule: '每天 08:45', enabled: true });
  expect(writes).toBe(1);
});

for (const width of [320, 390, 1440]) {
  test(`visual task schedules save weekly monthly intervals and preserve retry input at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installApiMocks(page);
    const task = { name: '自动测试任务', cron: '15 18 * * *', schedule: '每天 18:15', enabled: true, timezone: 'Asia/Shanghai' };
    let writes = 0, failNext = true;
    await page.route('**/api/studio-tasks**', async route => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path.endsWith('/templates')) return route.fulfill({ json: { templates: [{ name: task.name, key: 'test', available: true, defaultCron: '0 9 * * *', timezone: 'Asia/Shanghai' }] } });
      if (path.endsWith('/config')) {
        writes++;
        if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { message: '暂时无法保存' } }); }
        Object.assign(task, route.request().postDataJSON());
        return route.fulfill({ json: { updated: true } });
      }
      return route.fulfill({ json: { tasks: [task], recentRuns: [] } });
    });
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('scheduled-tasks'));
    await page.locator('[data-task-edit]').click();
    await page.locator('[data-schedule-mode="weekly"]').click();
    await page.locator('[data-schedule-day="1"]').click();
    await page.locator('#rf-task-edit-save').click();
    await expect(page.locator('#rf-task-edit-error')).toContainText('至少选择一个');
    expect(writes).toBe(0);
    for (const day of [1, 3, 5]) await page.locator(`[data-schedule-day="${day}"]`).click();
    await page.locator('[data-schedule-time]').fill('20:30');
    await expect(page.locator('[data-schedule-summary]')).toHaveText('每周一、三、五 20:30');
    await page.locator('#rf-task-edit-save').click();
    await expect(page.locator('#rf-task-edit-error')).toContainText('设置已保留');
    await expect(page.locator('[data-schedule-time]')).toHaveValue('20:30');
    const dialog = page.locator('#rf-talent-dialog > .rf-dialog');
    expect(await dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `/tmp/task-schedule-weekly-${width}.png`, fullPage: true });
    await page.locator('#rf-task-edit-save').click();
    await expect(page.locator('#rf-task-edit-save')).toHaveCount(0);
    expect(task.cron).toBe('30 20 * * 1,3,5');
    await page.locator('[data-task-edit]').click();
    await expect(page.locator('[data-schedule-day="3"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-schedule-mode="monthly"]').click();
    await page.locator('[data-schedule-date]').selectOption('31');
    await expect(page.locator('.ts-hint')).toContainText('月份会跳过');
    await page.locator('#rf-task-edit-enabled').uncheck();
    await page.locator('#rf-task-edit-save').click();
    await expect(page.locator('#rf-task-edit-save')).toHaveCount(0);
    expect(task.cron).toBe('30 20 31 * *');
    expect(task.enabled).toBe(false);
    await page.locator('[data-task-edit]').click();
    await page.locator('[data-schedule-mode="interval"]').click();
    await page.locator('[data-schedule-unit]').selectOption('minute');
    await page.locator('[data-schedule-every]').selectOption('15');
    await page.locator('#rf-task-edit-save').click();
    await expect(page.locator('#rf-task-edit-save')).toHaveCount(0);
    expect(task.cron).toBe('*/15 * * * *');
    await page.locator('[data-task-edit]').click();
    await page.locator('[data-schedule-mode="advanced"]').click();
    await page.locator('#rf-task-edit-cron').fill('0 9 * * 1-5');
    await page.locator('#rf-task-edit-save').click();
    await expect(page.locator('#rf-task-edit-save')).toHaveCount(0);
    await page.locator('[data-task-edit]').click();
    await expect(page.locator('#rf-task-edit-cron')).toHaveValue('0 9 * * 1-5');
  });
}

for (const width of [390, 1600]) {
test(`jobs workspace keeps its page after edits and supports priority colors with batch actions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const recruitmentRequests = [];
  page.on('request', request => {
    if (request.url().includes('/api/recruitment')) recruitmentRequests.push(new URL(request.url()));
  });
  const positions = [
    { id: 'pos_urgent', name: '商务开发', department: '商务部', owner: '陈经理', recruiterUserId: 'hr_1', recruiter: '王HR', salaryText: '10K-15K', status: '招聘中', approvalStatus: '已通过' },
    { id: 'pos_important', name: '项目经理', department: '项目部', owner: '李经理', recruiterUserId: 'hr_1', recruiter: '王HR', salaryText: '12K-18K', status: '招聘中', approvalStatus: '待审批' },
    { id: 'pos_normal', name: '运营专员', department: '运营部', owner: '赵经理', recruiterUserId: 'hr_1', recruiter: '王HR', salaryText: '8K-12K', status: '招聘中', approvalStatus: '待审批' },
  ];
  const demands = [
    { id: 'demand_urgent', month: '2026-09', positionId: 'pos_urgent', positionName: '商务开发', headcount: 3, demandType: '新增需求', priority: '紧急', status: '待审批', approvalStatus: '待审批', note: '业务扩张' },
    { id: 'demand_important', month: '2026-09', positionId: 'pos_important', positionName: '项目经理', headcount: 2, demandType: '新增需求', priority: '重要', status: '待审批', approvalStatus: '待审批', note: '项目扩张' },
    { id: 'demand_normal', month: '2026-09', positionId: 'pos_normal', positionName: '运营专员', headcount: 1, demandType: '储备需求', priority: '一般', status: '待审批', approvalStatus: '待审批', note: '人才储备' },
  ];
  let demandSaved = false, savedDemandBody = null, positionSaved = false, paused = false, batchPaused = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request(), method = request.method(), path = new URL(request.url()).pathname;
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', userId: 'admin_1', userName: '系统管理员', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'],
      dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }], sensitiveFields: [{ roleCode: 'system_admin', contacts: 'full' }],
      account: { id: 'admin_1', name: '系统管理员', mobile: '13800138000', departments: ['人力资源部'], status: '启用' },
    }) });
    if (path.endsWith('/api/recruitment/form-options')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ departments: [{ id: 'dept_sales', name: '商务部' }, { id: 'dept_project', name: '项目部' }, { id: 'dept_ops', name: '运营部' }], employees: [{ id: 'manager_1', name: '陈经理', department: '商务部' }, { id: 'hr_1', name: '王HR', department: '人力资源部', tianjiWechatId: 'HR_1' }] }) });
    if (path.endsWith('/api/recruitment/monthly-demands') && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ demands }) });
    if (path.endsWith('/api/recruitment/monthly-demands') && method === 'POST') {
      demandSaved = true;
      const body = request.postDataJSON(), demand = demands.find((item) => item.positionId === body.positionId);
      savedDemandBody = body;
      Object.assign(demand, body, { status: '待审批', approvalStatus: '待审批' });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...demand, positionName: positions.find((item) => item.id === body.positionId)?.name, approvalNotification: { status: '发送中' }, positionAutoPublished: false }) });
    }
    if (path.endsWith('/api/recruitment/monthly-demands/transcript-extract') && method === 'POST') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
      source: 'ai', availablePositions: 3, extraction: { month: '2026-09', positionId: 'pos_urgent', positionName: '商务开发', headcount: 4, demandType: '新增需求', priority: '紧急', expectedArrivalDate: '2026-09-30', note: '新业务线启动，需要补充4名商务开发。', matchedPosition: true },
    }) });
    if (path.endsWith('/api/recruitment/positions/pos_urgent') && method === 'PATCH') {
      positionSaved = true;
      Object.assign(positions[0], request.postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(positions[0]) });
    }
    if (path.endsWith('/api/recruitment/positions/pos_urgent/offline') && method === 'POST') {
      paused = true; positions[0].status = '已下线';
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(positions[0]) });
    }
    if (path.endsWith('/api/recruitment/positions/batch-offline') && method === 'POST') {
      batchPaused = true;
      const ids = request.postDataJSON().ids || [];
      positions.filter((item) => ids.includes(item.id)).forEach((item) => { item.status = '已下线'; });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ offline: ids.length, skipped: 0, failed: 0, errors: [] }) });
    }
    if (path.endsWith('/api/recruitment/positions/batch-publish') && method === 'POST') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ published: 0, skipped: 0, failed: 0, errors: [] }) });
    if (path.endsWith('/api/recruitment') && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positions, demands: [], collectionTasks: [], channels: [], channelBindings: [] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('jobs'));
  await page.locator('#job-month-filter').fill('2026-09');
  await page.locator('#job-month-filter').dispatchEvent('change');
  await expect(page.locator('#page-jobs')).toHaveClass(/active/);
  await expect(page.locator('.rf-job-card')).toHaveCount(3);
  expect(recruitmentRequests.some(url => url.pathname.endsWith('/form-options'))).toBe(false);
  expect(recruitmentRequests.filter(url => url.pathname.endsWith('/api/recruitment')).every(url => url.searchParams.get('view') === 'positions')).toBe(true);
  expect(await page.locator('.rf-job-card-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(width === 390 ? 1 : 3);
  await expect(page.locator('[data-rf-job-card="pos_urgent"]')).toHaveClass(/priority-urgent/);
  await expect(page.locator('[data-rf-job-card="pos_important"]')).toHaveClass(/priority-important/);
  await expect(page.locator('[data-rf-job-card="pos_normal"]')).toHaveClass(/priority-normal/);
  await expect(page.locator('[data-rf-job-card="pos_normal"]')).toContainText('储备');

  await page.locator('[data-rf-job-card="pos_urgent"] [data-rf-demand-edit]').click();
  await expect(page.locator('#rf-demand-priority option')).toHaveText(['紧急', '重要', '储备']);
  await page.locator('#rf-demand-transcript-text').fill('本月商务开发要4个人，紧急，月底前到岗，因为新业务线启动。');
  await page.locator('[data-rf-demand-transcript-extract]').click();
  await expect(page.locator('#rf-demand-headcount')).toHaveValue('4');
  await expect(page.locator('#rf-demand-arrival')).toHaveValue('2026-09-30');
  await expect(page.locator('#rf-demand-note')).toHaveValue('新业务线启动，需要补充4名商务开发。');
  await page.locator('#rf-demand-requirement').fill('重点承接短视频商务开发，优先有MCN客户资源');
  await page.locator('#rf-save-demand').click();
  await expect.poll(() => demandSaved).toBe(true);
  expect(savedDemandBody.demandRequirement).toBe('重点承接短视频商务开发，优先有MCN客户资源');
  await expect(page.locator('#page-jobs')).toHaveClass(/active/);
  await expect(page.locator('#page-overview')).not.toHaveClass(/active/);
  await expect(page.locator('.rf-demand-summary')).toContainText('商务部 · 2026-09 招聘计划');
  await expect(page.locator('.rf-demand-summary-list')).toContainText('商务开发');
  await page.locator('[data-rf-demand-summary-close]').click();

  await page.locator('[data-rf-job-card="pos_urgent"] [data-rf-job-edit]').click();
  await page.locator('#rf-job-name').fill('高级商务开发');
  expect(recruitmentRequests.some(url => url.pathname.endsWith('/form-options'))).toBe(true);
  await page.locator('#rf-save-job').click();
  await expect.poll(() => positionSaved).toBe(true);
  await expect(page.locator('#page-jobs')).toHaveClass(/active/);

  await page.locator('[data-rf-job-card="pos_urgent"] [data-rf-job-offline]').click();
  await expect.poll(() => paused).toBe(true);
  await expect(page.locator('#page-jobs')).toHaveClass(/active/);

  await page.locator('[data-rf-job-select="pos_important"]').check();
  await page.locator('[data-rf-job-select="pos_normal"]').check();
  await page.locator('[data-rf-job-batch="offline"]').click();
  await page.locator('#rf-job-batch-reason').fill('本月岗位编制调整');
  await page.locator('[data-rf-job-batch-confirm]').click();
  await expect.poll(() => batchPaused).toBe(true);
  await expect(page.locator('#page-jobs')).toHaveClass(/active/);
});
}

for (const width of [390, 1440]) {
  test(`referrer-only account cannot open other menus or deep links at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = [];
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      const data = path.endsWith('/api/access/me') ? {
        authenticated: true, authorized: true, accessState: 'active', userId: 'employee', userName: '普通员工',
        pages: ['referrals'], actions: ['manage_referrals', 'create_referral_campaign'], roleCodes: ['referrer'], dataScopes: [{ type: 'self' }],
        account: { id: 'employee', name: '普通员工', mobile: '13800138000', status: '启用' },
      } : { referrals: [], campaigns: [], positions: [], rules: [], byCampaign: [], total: 0 };
      await route.fulfill({ json: data });
    });
    await page.goto(`${baseUrl}?flow_action=schedule&candidate_id=private-candidate#resume-api`, { waitUntil: 'networkidle' });
    await expect(page.locator('#page-referral')).toHaveClass(/active/);
    await expect(page.locator('#rf-talent-dialog')).toHaveCount(0);
    const denied = ['overview', 'jobs', 'applicants', 'resume-parse', 'resume-detail', 'resume-archive', 'resume-api', 'interviews', 'question-bank', 'offers', 'scheduled-tasks', 'analytics', 'settings'];
    for (const destination of denied) expect(await page.evaluate(destination => window.setPage(destination), destination)).toBe(false);
    await page.evaluate(() => window.resumeFlowOpenImporter());
    await expect(page.locator('#rf-talent-dialog')).toHaveCount(0);
    if (width < 760) {
      await expect(page.locator('.rf-app-tabs [data-mobile-page="referral"]')).toBeVisible();
      await expect(page.locator('.rf-app-tabs [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('[data-mobile-back]')).toBeHidden();
      await page.locator('.rf-app-tabs [data-mobile-menu]').click();
      await expect(page.locator('.rf-app-menu [data-mobile-admin]')).toBeHidden();
      await expect(page.locator('.rf-app-menu [data-mobile-page]')).toHaveCount(1);
    } else {
      await expect(page.locator('.nav-item[data-page="referral"]')).toBeVisible();
      await expect(page.locator('.nav-item:visible, .nav-child:visible')).toHaveCount(1);
    }
    expect(calls.filter(path => !path.includes('/api/access/') && !path.includes('/api/referrals'))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}

for (const entry of ['flow_action=questions&interview_id=interview-test', 'interview_questions=interview-test', 'flow_action=questions&amp;interview_id=interview-test', 'interview_questions=interview-test&evaluation_token=stale']) {
test(`interviewer can read pushed questions on mobile and reload without evaluation: ${entry}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const evaluationRequests = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/workbench') || path.endsWith('/public')) evaluationRequests.push(path);
    const data = path.endsWith('/api/access/me') ? {
      authenticated: true, authorized: true, accessState: 'active', userId: 'interviewer', userName: '面试官',
      pages: ['interviews'], actions: ['submit_interview_feedback'], roleCodes: ['interviewer'], dataScopes: [],
      account: { id: 'interviewer', name: '面试官', mobile: '13800138000', status: '启用' },
    } : path.endsWith('/questions') ? { candidateName: '题单测试', role: '产品经理', round: '一面', status: '已生成待推送', questions: [
      { question: '请介绍一次你负责的项目成果。' },
      { question: '请说明一次跨团队协作的处理方式。' },
    ] } : { appointments: [], rooms: [], interviewers: [] };
    await route.fulfill({ json: data });
  });
  await page.goto(`${baseUrl}?${entry}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '题单测试 · 面试题' })).toBeVisible();
  await expect(page.locator('[data-rf-refresh-questions]')).toBeVisible();
  await expect(page.locator('[data-rf-print-interview-questions]')).toBeVisible();
  await expect(page.locator('.qb-card-number').first()).toHaveText('01');
  await expect(page.locator('.qb-card-number').nth(1)).toHaveText('02');
  await expect(page).toHaveURL(/interview_questions=interview-test/);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '题单测试 · 面试题' })).toBeVisible();
  await expect(page.locator('#rf-public-evaluation-form')).toHaveCount(0);
  expect(evaluationRequests).toEqual([]);
  await page.evaluate(() => {
    window.__interviewQuestionPrinted = 0;
    window.print = () => { window.__interviewQuestionPrinted += 1; };
  });
  await page.locator('[data-rf-print-interview-questions]').click();
  expect(await page.evaluate(() => window.__interviewQuestionPrinted)).toBe(1);
  expect(await page.evaluate(() => document.getElementById('rf-talent-dialog')?.classList.contains('rf-printing'))).toBe(true);
});
}

test('incomplete question links explain the problem instead of opening evaluation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installApiMocks(page);
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(`${baseUrl}?flow_action=questions`, { waitUntil: 'networkidle' });
  await expect(page.getByText('面试题链接不完整', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '面试评价与招聘决策' })).toHaveCount(0);
  expect(requests.some(url => url.includes('/api/interview-evaluations/workbench'))).toBe(false);
});

test('mobile question deep link survives employee login and opens only the bound question list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let loggedIn = false;
  const access = { authenticated: true, authorized: true, accessState: 'active', userId: 'interviewer', userName: '面试官', pages: ['interviews'], actions: ['submit_interview_feedback'], roleCodes: ['interviewer'], account: { id: 'interviewer', name: '面试官', mobile: '13800138000', status: '启用' } };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/access/login')) { loggedIn = true; return route.fulfill({ json: access }); }
    if (path.endsWith('/api/access/me')) return route.fulfill({ json: loggedIn ? access : { authenticated: false, accessState: 'login_required' } });
    if (path.endsWith('/interviews/interview-test/questions')) return route.fulfill({ json: { candidateName: '手机登录题单', role: '产品经理', status: '已发布', questions: [{ question: '介绍你的项目经历', dimension: '专业能力' }] } });
    return route.fulfill({ json: { appointments: [], rooms: [], interviewers: [] } });
  });
  await page.goto(`${baseUrl}?interview_questions=interview-test`, { waitUntil: 'networkidle' });
  await page.locator('#auth-login-form [name="name"]').fill('面试官');
  await page.locator('#auth-login-form [name="mobile"]').fill('13800138000');
  await page.getByRole('button', { name: '登录并进入系统' }).click();
  await expect(page.getByRole('heading', { name: '手机登录题单 · 面试题' })).toBeVisible();
  await expect(page.getByText('介绍你的项目经历', { exact: true })).toBeVisible();
  await expect(page.locator('#rf-public-evaluation-form')).toHaveCount(0);
});

test('permission refresh revokes open menus and logout clears navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  let restricted = false;
  await page.route('**/api/access/me', route => route.fulfill({ json: {
    authenticated: true, authorized: true, accessState: 'active', userId: 'employee', userName: '员工',
    pages: restricted ? ['referrals'] : ['*'], actions: restricted ? ['manage_referrals'] : ['*'], roleCodes: restricted ? ['referrer'] : ['system_admin'], dataScopes: [],
    account: { id: 'employee', name: '员工', mobile: '13800138000', status: '启用' },
  } }));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('#page-resume-archive')).toHaveClass(/active/);
  await page.locator('.rf-app-tabs [data-mobile-menu]').click();
  restricted = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#page-referral')).toHaveClass(/active/);
  await expect(page.locator('.rf-app-menu')).not.toHaveAttribute('open', '');
  await expect(page.locator('.rf-app-tabs [data-mobile-page="resume-archive"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.setPage('resume-archive'))).toBe(false);
  await page.locator('.rf-app-tabs [data-mobile-menu]').click();
  await page.locator('[data-mobile-logout]').click();
  await expect(page.locator('body')).toHaveClass(/auth-blocked/);
  expect(await page.evaluate(() => window.setPage('referral'))).toBe(false);
  await expect(page.locator('.page.active')).toHaveCount(0);
  await expect(page.locator('.rf-app-tabs [data-mobile-page]')).toHaveCount(0);
});

test('role permissions hide unauthorized menus, pages and action buttons', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', userId: 'recruiter_1', userName: '招聘专员',
      roleCodes: ['recruiter'], pages: ['candidates'], actions: ['edit_candidate'], dataScopes: [],
      sensitiveFields: [{ roleCode: 'recruiter', contacts: 'hidden', salary: 'hidden', resume: 'hidden' }],
      account: { id: 'recruiter_1', name: '招聘专员', mobile: '13800138000', departments: ['招聘部'], status: '启用' },
    }) });
    if (path.endsWith('/api/talents')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      talents: [{ id: 'talent_a', candidateId: 'talent_a', name: '权限测试候选人', phone: '', email: '', status: '约面', owner: '招聘专员', source: '招聘平台', bestMatchRole: '产品经理', bestMatchScore: 88, skills: [], tags: [], matches: [], sourceFileUrl: '', rawText: '', access: { contactPolicy: 'hidden', salaryPolicy: 'hidden', resumePolicy: 'hidden' } }],
      total: 1, page: 1, pageSize: 100, totalPages: 1, jobMap: [], overview: {},
    }) });
    if (path.endsWith('/api/talents/talent_a')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: 'talent_a', candidateId: 'talent_a', name: '权限测试候选人', phone: '', email: '', wechat: '', status: '约面', owner: '招聘专员', source: '招聘平台',
      bestMatchRole: '产品经理', bestMatchScore: 88, skills: [], tags: [], matches: [], timeline: [], communications: [], reviews: [], assessmentResults: [],
      latestResumeId: 'resume_a', sourceFileName: '测试简历.pdf', sourceFileUrl: '', rawText: '', editableWordUrl: '',
      analysis: { id: 'analysis_a', summary: '测试摘要', scores: { overall: 88 }, skills: [], strengths: [], risks: [], recommendedRoles: [] },
      wecomReviews: [{ status: '已认领', claimedDepartment: '产品部', responseCount: 1 }],
      access: { contactPolicy: 'hidden', salaryPolicy: 'hidden', resumePolicy: 'hidden', maskedFields: ['phone', 'email', 'wechat', 'rawText', 'sourceFileUrl'] },
    }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await expect(page.locator('.nav-item[data-page="resume-archive"]')).toBeVisible();
  await expect(page.locator('.nav-item[data-page="jobs"]')).toBeHidden();
  await expect(page.locator('.nav-item[data-page="interviews"]')).toBeHidden();
  await expect(page.locator('[data-access-admin]').first()).toBeHidden();
  expect(await page.evaluate(() => window.setPage('offers'))).toBe(false);
  await expect(page.locator('#page-offers')).not.toHaveClass(/active/);
  await page.locator('[data-rf-talent="talent_a"]').click();
  await expect(page.locator('#rf-talent-dialog .rf-full-detail-dialog')).toBeVisible();
  const scheduleButtons = page.locator('#rf-talent-dialog [data-rf-schedule-interview]');
  await expect(scheduleButtons).toHaveCount(1);
  expect(await scheduleButtons.evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).display === 'none'))).toBe(true);
  await page.locator('#rf-talent-dialog [data-rf-more-toggle]').click();
  await expect(page.locator('#rf-talent-dialog [data-rf-delete-talent-resume]')).toBeVisible();
  await expect(page.locator('#rf-talent-dialog [data-rf-correct-ai]')).toBeHidden();
  await expect(page.locator('#rf-talent-dialog [data-rf-open-background]')).toBeHidden();
});

test('recruitment approval deep link opens after login and records the decision', async ({ page }) => {
  let approved = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', userId: 'approver_user', userName: '招聘审批人',
      roleCodes: ['manager'], pages: ['home', 'positions'], actions: ['manage_positions', 'create_demand'], dataScopes: [], sensitiveFields: [],
      account: { id: 'approver_user', name: '招聘审批人', mobile: '13800138000', departments: ['管理部'], status: '启用' },
    }) });
    if (path.endsWith('/api/recruitment/approvals/position/position_a/decision') && route.request().method() === 'POST') {
      approved = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ type: 'position', id: 'position_a', title: '产品经理', approvalStatus: '已通过', opinion: '同意招聘' }) });
    }
    if (path.endsWith('/api/recruitment/approvals/position/position_a')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      type: 'position', id: 'position_a', title: '产品经理', department: '产品部', owner: '王HR', headcount: 2, salaryText: '15K-20K',
      responsibilities: '负责产品规划和交付', requirements: '三年以上产品经验', approvalStatus: approved ? '已通过' : '待审批', applicant: '王HR', submittedAt: '2026-09-23T08:00:00.000Z', opinion: approved ? '同意招聘' : '',
    }) });
    if (path.endsWith('/api/recruitment/monthly-demands')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ demands: [] }) });
    if (path.endsWith('/api/recruitment/form-options')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ departments: [], employees: [] }) });
    if (path.endsWith('/api/recruitment')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positions: [], overview: {}, collectionTasks: [], channels: [], channelBindings: [] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=recruitment_approval&approval_type=position&approval_id=position_a`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '新增岗位审批' })).toBeVisible();
  await expect(page.getByText('产品经理', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '同意' }).click();
  await expect.poll(() => approved).toBe(true);
  await expect(page.getByText('审批已完成')).toBeVisible();
  await expect(page.getByRole('heading', { name: '已通过' })).toBeVisible();
});

test('daily demand reminder opens department hiring progress and supports adding and pausing with retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const position = { id: 'pos_sales', name: '商务开发', department: '商务部', owner: '商务负责人', recruiter: '招聘甲', status: '招聘中', recruitmentStatus: '招聘中', headcount: 2, applicantCount: 8, acceptedCount: 2, arrived: 1 };
  const secondPosition = { id: 'pos_assistant', name: '商务助理', department: '商务部', status: '待发布', headcount: 1 };
  let savedDemand, pauseAttempts = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', userId: 'business_1', userName: '商务负责人',
      roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], dataScopes: [{ roleCode: 'system_admin', type: 'all', businessUnitId: '', departmentIds: [] }], sensitiveFields: [],
      account: { id: 'business_1', name: '商务负责人', mobile: '13800138000', departments: ['商务部'], status: '启用' },
    }) });
    if (path.endsWith('/api/recruitment/department-demands/pos_sales/pause')) {
      pauseAttempts++;
      if (pauseAttempts === 1) return route.fulfill({ status: 503, json: { message: '稍后重试' } });
      expect(route.request().postDataJSON().reason).toBe('本阶段编制已满足');
      position.status = '已下线'; position.recruitmentStatus = '暂停招聘';
      return route.fulfill({ json: { status: '已下线' } });
    }
    if (path.endsWith('/api/recruitment/department-demands')) {
      if (route.request().method() === 'POST') {
        savedDemand = { ...route.request().postDataJSON(), positionName: '商务助理', approvalStatus: '待审批', approvalNotification: { status: '发送中' } };
        return route.fulfill({ json: savedDemand });
      }
      return route.fulfill({ json: { month: '2026-09', departments: [{ id: 'dept_sales', name: '商务部' }], positions: [position, secondPosition], demands: savedDemand ? [savedDemand] : [] } });
    }
    if (path.endsWith('/api/recruitment/monthly-demands')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ demands: [] }) });
    if (path.endsWith('/api/recruitment/form-options')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ departments: [{ id: 'dept_sales', name: '商务部' }], employees: [] }) });
    if (path.endsWith('/api/recruitment')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positions: [{ id: 'pos_sales', name: '商务开发', department: '商务部', owner: '商务负责人', status: '招聘中', headcount: 2 }], overview: {}, collectionTasks: [], channels: [], channelBindings: [] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=demand&demand_month=2026-09`, { waitUntil: 'networkidle' });
  await expect(page.locator('#page-jobs')).toHaveClass(/active/);
  await expect(page.getByRole('heading', { name: '部门招聘工作台' })).toBeVisible();
  await expect(page.locator('.dd-card')).toHaveCount(1);
  await expect(page.locator('.dd-card')).toContainText('招聘甲');
  await expect(page.locator('.dd-card')).toContainText('8 人');
  await page.screenshot({ path: '/tmp/department-demand-mobile.png', fullPage: true });
  await page.locator('[data-dept-new]').click();
  await expect(page.locator('#rf-demand-position')).toHaveValue('');
  await expect(page.locator('#rf-demand-position option')).toHaveCount(3);
  await expect(page.locator('#rf-demand-month')).toHaveValue('2026-09');
  await expect(page.locator('#rf-demand-transcript-text')).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI解析并填充' })).toBeVisible();
  const layout = await page.locator('#rf-talent-dialog .rf-dialog').evaluate((dialog) => ({
    left: dialog.getBoundingClientRect().left,
    right: dialog.getBoundingClientRect().right,
    viewport: document.documentElement.clientWidth,
    scrollWidth: dialog.scrollWidth,
    clientWidth: dialog.clientWidth,
  }));
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  await page.locator('#rf-demand-position').selectOption('pos_assistant');
  await page.locator('#rf-demand-headcount').fill('3');
  await page.locator('#rf-demand-note').fill('补充业务支持人员');
  await page.locator('#rf-save-demand').click();
  await expect(page.getByRole('heading', { name: '部门招聘工作台' })).toBeVisible();
  expect(savedDemand.headcount).toBe(3);
  expect(savedDemand.positionId).toBe('pos_assistant');
  await page.locator('[data-dept-filter="all"]').click();
  await expect(page.locator('.dd-card')).toHaveCount(2);
  await expect(page.locator('.dd-card').filter({ hasText: '商务助理' })).toContainText('3 人');
  await page.locator('[data-dept-pause]').click();
  await expect(page.locator('#rf-talent-dialog')).toContainText('岗位级暂停');
  await page.locator('[data-dept-confirm-pause]').click();
  await expect(page.locator('#dd-pause-message')).toContainText('请填写暂停原因');
  expect(pauseAttempts).toBe(0);
  await page.locator('#dd-pause-reason').fill('本阶段编制已满足');
  await page.locator('[data-dept-confirm-pause]').click();
  await expect(page.locator('#dd-pause-message')).toContainText('原因已保留');
  await expect(page.locator('#dd-pause-reason')).toHaveValue('本阶段编制已满足');
  await page.locator('[data-dept-confirm-pause]').click();
  await expect(page.getByRole('heading', { name: '部门招聘工作台' })).toBeVisible();
  await page.locator('[data-dept-filter="paused"]').click();
  await expect(page.locator('.dd-card')).toHaveCount(1);
  await expect(page.locator('.dd-card')).toContainText('已暂停');
});

for (const width of [320, 1440]) {
  test(`department reminder never falls back to a random job when department lookup fails at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installApiMocks(page);
    let ready = false;
    await page.route('**/api/recruitment/department-demands?*', route => ready
      ? route.fulfill({ json: { month: '2026-09', departments: [{ id: 'dept_a', name: '商务部' }], positions: [], demands: [] } })
      : route.fulfill({ status: 403, json: { message: '当前账号尚未绑定部门，请联系管理员配置后重试' } }));
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html?flow_action=demand&demand_month=2026-09`, { waitUntil: 'networkidle' });
    await expect(page.locator('#rf-talent-dialog')).toContainText('尚未绑定部门');
    await expect(page.locator('#rf-demand-position')).toHaveCount(0);
    ready = true;
    await page.locator('[data-dept-retry]').click();
    await expect(page.locator('.dd-workbench')).toContainText('暂无符合条件的岗位');
    expect(await page.locator('#rf-talent-dialog > .rf-dialog').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-dept-month]')).toHaveValue('2026-09');
  });
}

test('first active login requires name and mobile before entering the system', async ({ page }) => {
  let completed = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/access/profile')) {
      completed = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ userId: 'employee_active', name: '高子云', mobile: '13800138000', status: '启用' }) });
    }
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, authorized: completed, accessState: completed ? 'active' : 'profile_incomplete', identitySource: 'studio', userId: 'employee_active', userName: '高子云', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], account: { id: 'employee_active', name: '高子云', mobile: completed ? '13800138000' : '', status: '启用' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '完成首次登录资料' })).toBeVisible();
  await expect(page.locator('#talent-app')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('input[name="mobile"]').fill('13800138000');
  await page.getByRole('button', { name: '保存并进入系统' }).click();
  await expect(page.locator('#talent-app')).toHaveAttribute('aria-hidden', 'false');
});

test('referral poster selects up to five jobs in demand order without changing its QR campaign', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  const positions = Array.from({ length: 6 }, (_, index) => ({
    id: `poster_position_${index + 1}`,
    name: `内推岗位${index + 1}`,
    department: '产品部',
    status: '招聘中',
    responsibilities: `岗位${index + 1}工作职责`,
    salaryText: '15K-20K',
  }));
  await page.route('**/api/referrals/positions', route => route.fulfill({ json: { positions } }));
  await page.route('**/api/recruitment/referral-poster-order', route => route.fulfill({ json: { month: '2026-10', positionIds: positions.map(position => position.id) } }));
  await page.route('**/api/referrals/campaigns', route => route.request().method() === 'POST'
    ? route.fulfill({ json: { qrCode: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', publicUrl: 'https://example.test/referral' } })
    : route.fulfill({ json: { campaigns: [{ referrerName: '系统管理员', status: '启用', publicUrl: 'https://example.test/referral', qrCode: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }] } }));
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('referral'));
  await page.getByRole('button', { name: '管理招聘海报' }).click();
  await expect(page.getByRole('heading', { name: '选择海报展示岗位' })).toBeVisible();
  await expect(page.locator('[data-ref-poster-count]')).toHaveText('已选 5/5');
  for (const position of positions.slice(0, 5)) await expect(page.locator(`[data-ref-poster-position="${position.id}"]`)).toBeChecked();
  await expect(page.locator(`[data-ref-poster-position="${positions[5].id}"]`)).toBeDisabled();
  await page.locator(`[data-ref-poster-position="${positions[1].id}"]`).uncheck();
  await expect(page.locator(`[data-ref-poster-position="${positions[5].id}"]`)).toBeEnabled();
  await page.locator(`[data-ref-poster-position="${positions[5].id}"]`).check();
  await expect(page.locator('[data-ref-poster-count]')).toHaveText('已选 5/5');
  await page.getByRole('button', { name: '生成海报（5）' }).click();
  await expect(page.getByRole('heading', { name: '我的招聘海报' })).toBeVisible();
  await expect(page.getByText('复制链接')).toBeVisible();
  await expect(page.locator('.rf-xhs-poster-job')).toHaveText([
    '内推岗位1岗位1工作职责',
    '内推岗位3岗位3工作职责',
    '内推岗位4岗位4工作职责',
    '内推岗位5岗位5工作职责',
    '内推岗位6岗位6工作职责',
  ]);
  await expect(page.locator('.rf-xhs-poster-qr-float img')).toHaveAttribute('src', /data:image\/gif/);
  await expect.poll(() => page.locator('.rf-xhs-poster-qr-float img').evaluate(image => getComputedStyle(image).filter)).toBe('grayscale(1) contrast(2)');
});

test('referral direct upload reuses the employee campaign and selected position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await page.route('**/api/referrals/campaigns', route => route.fulfill({ json: { campaigns: [{
    id: 'campaign_direct',
    referrerUserId: 'admin_1',
    referrerName: '系统管理员',
    status: '启用',
    publicUrl: 'https://example.test/referral?referral_token=secure_direct_token',
    qrCode: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  }] } }));
  let submittedPayload = '';
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('referral'));
  await page.getByRole('button', { name: '直接上传内推' }).click();
  await expect(page.getByRole('heading', { name: '直接上传内推简历' })).toBeVisible();
  await expect(page.locator('[name="intendedPositionId"]')).toHaveValue('pos_pm');
  await page.locator('[name="candidateName"]').fill('林悦');
  await page.locator('[name="candidatePhone"]').fill('13800138000');
  await page.locator('#rf-referral-direct-file').setInputFiles({ name: 'direct-referral.txt', mimeType: 'text/plain', buffer: Buffer.from('直接上传测试简历') });
  await expect(page.locator('[data-referral-upload-file]')).toHaveText('direct-referral.txt');
  await page.locator('[name="consent"]').check();
  await page.route('**/api/public/referrals/secure_direct_token/submit', route => {
    submittedPayload = Buffer.from(route.request().postData() || '').toString('utf8');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job_direct_referral' }) });
  });
  await page.route('**/api/jobs/job_direct_referral', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', data: { trackingPath: '?referral_tracking=direct_track', status: '待负责人确认', duplicateStatus: '未重复' } }) }));
  await page.getByRole('button', { name: '提交内推简历', exact: true }).click();
  await expect(page.getByText('内推简历已提交', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看内推进度' })).toHaveAttribute('href', /referral_tracking=direct_track/);
  expect(submittedPayload).toContain('direct-referral.txt');
  expect(submittedPayload).toContain('pos_pm');
});

test('personal referral actions do not require referral administration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await page.route('**/api/access/me', route => route.fulfill({ json: {
    authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', identitySource: 'session',
    userId: 'employee_referrer', userName: '普通员工', roleCodes: ['referrer'], pages: ['referrals'],
    actions: ['view_referrals', 'create_referral_campaign', 'submit_referral'],
    dataScopes: [{ roleCode: 'referrer', type: 'self', businessUnitId: '', departmentIds: [] }],
    account: { id: 'employee_referrer', name: '普通员工', mobile: '13800138000', departments: ['产品部'], status: '启用' },
  } }));
  await page.route('**/api/referrals/campaigns', route => route.fulfill({ json: { campaigns: [{
    id: 'campaign_personal', referrerUserId: 'employee_referrer', referrerName: '普通员工', status: '启用',
    publicUrl: 'https://example.test/referral?referral_token=personal_referral_token',
  }] } }));
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('referral'));
  await expect(page.getByRole('button', { name: '内推记录与奖励' })).toBeVisible();
  await expect(page.getByRole('button', { name: '管理招聘海报' })).toBeVisible();
  await page.getByRole('button', { name: '直接上传内推' }).click();
  await expect(page.getByRole('heading', { name: '直接上传内推简历' })).toBeVisible();
});

test('analytics and interviews use one navigation level and referral QR actions stay interactive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await installApiMocks(page);
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });

  await expect(page.locator('#analytics-sub')).toHaveCount(0);
  await expect(page.locator('#interviews-sub')).toHaveCount(0);
  await page.evaluate(() => window.setPage('analytics'));
  await expect(page.locator('#page-analytics')).toHaveClass(/active/);
  await expect(page.locator('[data-analytics-tab]')).toHaveCount(7);

  await page.evaluate(() => window.setPage('referral'));
  await page.getByRole('button', { name: '内推记录与奖励' }).click();
  await expect(page.getByRole('heading', { name: '推荐记录与奖励' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '管理招聘海报' }).click();
  await expect(page.getByRole('heading', { name: '选择海报展示岗位' })).toBeVisible();
  await page.keyboard.press('Escape');

  for (const name of ['overview', 'demand', 'jobs', 'resume-parse', 'resume-archive', 'resume-api', 'interviews', 'referral', 'analytics']) {
    await page.evaluate((target) => window.setPage(target), name);
    const layout = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.overflowX).toBeLessThanOrEqual(1);
  }

  await page.evaluate(() => window.setPage('jobs'));
  const jobsWrap = page.locator('#jobs-table-wrap');
  await expect(jobsWrap.locator('.rf-job-card')).toBeVisible();
  expect(await jobsWrap.evaluate((node) => node.scrollHeight > node.clientHeight || getComputedStyle(node).overflowY !== 'visible')).toBe(true);
  await page.evaluate(() => window.setPage('resume-archive'));
  await expect(page.locator('#page-resume-archive')).toHaveClass(/active/);
  await expect(page.locator('.nav-item[data-page="applicants"]')).toHaveCount(0);
});

test('analytics Vue island supports filtering, drilldown pagination, and export', async ({ page }) => {
  await installApiMocks(page);
  const analyticsRequests = [];
  const dashboard = {
    generatedAt: '2026-10-21T08:00:00.000Z',
    scope: { candidates: 35 },
    overview: { headcount: 12, openHc: 5, arrived: 7, applications: 39, offerAcceptanceRate: 66.7, averageTimeToHireDays: 21 },
    hc: { summary: { fulfillmentRate: 58.3 }, rows: [{ name: '10月产品经理需求', role: '产品经理', department: '产品部', owner: '王HR', status: '招聘中', headcount: 3, arrived: 1, remaining: 2, fulfillmentRate: 33.3 }] },
    funnel: { overallConversion: 17.9, stages: [{ name: '简历入库', count: 39, conversionFromPrevious: 100, conversionFromStart: 100 }, { name: '面试', count: 10, conversionFromPrevious: 25.6, conversionFromStart: 25.6 }] },
    channels: { rows: [{ channel: '内推', resumes: 10, valid: 8, validRate: 80, arrived: 2, hireRate: 20 }] },
    processing: { overallAverageHours: 18, owners: [{ owner: '王HR', handledTransitions: 24, averageHours: 18, overdueTasks: 1 }] },
  };
  await page.route('**/api/analytics/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    analyticsRequests.push(`${request.method()} ${url.pathname}?${url.searchParams.toString()}`);
    if (url.pathname.endsWith('/api/analytics/dashboard')) return route.fulfill({ json: dashboard });
    if (url.pathname.endsWith('/api/analytics/definitions')) return route.fulfill({ json: { definitions: [{ name: '实际到岗', grain: '候选人', formula: '实际到岗人数 / 招聘HC', note: '以入职日期为准' }] } });
    if (url.pathname.endsWith('/api/analytics/drilldown')) {
      const page = Number(url.searchParams.get('page') || 1);
      return route.fulfill({ json: {
        total: 25,
        page,
        pageSize: 20,
        definition: { formula: '按筛选范围内的原始记录统计' },
        rows: page === 1
          ? [{ 候选人: '林悦', 岗位: '产品经理', 部门: '产品部', 状态: '已到岗' }]
          : [{ 候选人: '赵敏', 岗位: '产品经理', 部门: '产品部', 状态: '已到岗' }],
      } });
    }
    if (url.pathname.endsWith('/api/analytics/export')) {
      return route.fulfill({
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="recruitment-hc.csv"' },
        contentType: 'text/csv',
        body: 'metric,value\nHC,12',
      });
    }
    return route.fulfill({ status: 404, json: { message: '未知分析接口' } });
  });

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('analytics'));
  await expect(page.locator('#analytics-root .rf-analytics-kpis')).toContainText('实际到岗');
  await expect(page.locator('#analytics-root .rf-analytics-kpis')).toContainText('7');
  await expect(page.locator('#analytics-root .rf-definition-list')).toContainText('实际到岗人数 / 招聘HC');

  await page.locator('#analytics-root input[name="department"]').fill('产品部');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect.poll(() => analyticsRequests.filter(item => item.includes('/api/analytics/dashboard?')).length).toBe(2);
  expect(analyticsRequests.find(item => item.includes('department=%E4%BA%A7%E5%93%81%E9%83%A8'))).toBeTruthy();

  await page.locator('[data-analytics-tab="achievement"]').click();
  await expect(page.locator('#analytics-root .rf-analytics-card')).toContainText('10月产品经理需求');
  await page.locator('#analytics-root .rf-analytics-card').filter({ hasText: '招聘需求与 HC' }).getByRole('button', { name: '查看明细' }).click();
  await expect(page.locator('#analytics-root .rf-drilldown-table')).toContainText('林悦');
  await expect(page.locator('#analytics-root .rf-analytics-pager')).toContainText('共 25 条 · 第 1 页');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('#analytics-root .rf-drilldown-table')).toContainText('赵敏');
  expect(analyticsRequests.some(item => item.includes('page=2'))).toBe(true);

  await page.getByRole('button', { name: '导出 CSV' }).click();
  await expect(page.locator('#analytics-root .rf-dialog-message')).toContainText('报表已生成并开始下载。');
  expect(analyticsRequests.some(item => item.includes('/api/analytics/export?') && item.includes('metric=hc'))).toBe(true);
  expect(pageErrors).toEqual([]);
});

for (const viewport of [{ name: 'desktop', width: 1440, height: 960 }, { name: 'mobile', width: 390, height: 844 }, { name: 'small mobile', width: 320, height: 568 }]) {
  test(`${viewport.name} settings access control and talent workspace remain usable`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.text().includes('[debug]')) console.log('[browser]', message.text()); });
    await installApiMocks(page);
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.setPage('settings'));
    await expect(page.locator('#page-settings')).toHaveClass(/active/);
    await page.locator('[data-system-status]').first().click();
    await expect(page.getByRole('heading', { name: '系统版本与运行状态' })).toBeVisible();
    await expect(page.getByText('87/87')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('[data-ai-monitoring]').click();
    await expect(page.getByRole('heading', { name: 'AI分析运行监控' })).toBeVisible();
    await expect(page.getByText('66.7%')).toBeVisible();
    await expect(page.getByText('P95 1880ms')).toBeVisible();
    await expect(page.getByText('模拟平台LLM暂时不可用', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('未配置单价，暂记0元')).toBeVisible();
    const aiMonitorOverflow = await page.locator('.rf-dialog').evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(aiMonitorOverflow).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    if (viewport.width <= 760) {
      await page.getByRole('button', { name: '更多功能', exact: true }).click();
      await expect(page.locator('[data-mobile-admin]')).toBeVisible();
      await page.locator('[data-mobile-admin]').click();
    } else {
      await expect(page.locator('[data-access-admin]').first()).toBeVisible();
      await page.locator('[data-access-admin]').first().click();
    }
    await expect(page.getByRole('heading', { name: '组织与权限' })).toBeVisible();
    await expect(page.locator('[data-access-view="employees"]')).toBeVisible();
    await page.locator('[data-access-user-mobile]').first().click();
    await expect(page.getByRole('heading', { name: '编辑员工资料' })).toBeVisible();
    const departmentSelect = page.locator('#access-user-dept-edit');
    await expect(departmentSelect).toBeVisible();
    await expect(departmentSelect).toBeEnabled();
    await expect(departmentSelect).toHaveValue('dept_a');
    await expect(departmentSelect).toContainText('产品部');
    await page.locator('#rf-talent-dialog > .rf-dialog > .rf-dialog-close').click();
    await expect(page.getByRole('heading', { name: '组织与权限' })).toBeVisible();
    await page.locator('[data-access-user-select]').first().check();
    await expect(page.locator('[data-access-selection-tools]')).toBeVisible();
    await page.locator('[data-access-clear-selection]').click();
    await expect(page.locator('[data-access-selection-tools]')).toBeHidden();
    await page.locator('[data-access-tab="roles"]').click();
    expect(await page.locator('.rf-access-role-grid').first().evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
    const roleCardLayout = await page.locator('.rf-access-role-card').first().evaluate((node) => {
      const style = getComputedStyle(node);
      const expectedWidth = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { expectedWidth, contentWidth: node.querySelector('.rf-access-role-head')?.clientWidth || 0 };
    });
    expect(Math.abs(roleCardLayout.contentWidth - roleCardLayout.expectedWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: '配置权限' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑角色' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '停用角色' }).first()).toBeVisible();
    await expect(page.locator('.rf-access-role-card').first()).toContainText('总经办HR');
    await expect(page.locator('.rf-access-role-card.inactive')).toContainText('历史角色');
    await page.getByRole('button', { name: '新增角色' }).click();
    await expect(page.getByRole('heading', { name: '新增角色' })).toBeVisible();
    await expect(page.locator('#access-role-code')).toBeVisible();
    await expect(page.locator('#access-role-name')).toBeVisible();
    await page.locator('#rf-talent-dialog > .rf-dialog > .rf-dialog-close').click();
    await expect(page.getByRole('heading', { name: '组织与权限' })).toBeVisible();
    await page.locator('[data-access-tab="approvals"]').click();
    await expect(page.getByText('业务HRBP · 人才 talent_a')).toBeVisible();
    const dialogOverflow = await page.locator('.rf-dialog').evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(dialogOverflow).toBeLessThanOrEqual(1);
    await page.locator('[data-access-tab="departments"]').click();
    await expect(page.locator('[data-access-view="departments"] .rf-access-tree')).toBeVisible();
    await expect(page.locator('[data-access-view="departments"] .rf-access-tree-branch > summary').first()).toContainText('第一事业部');
    await page.locator('[data-access-view="departments"] [data-access-open-department]').first().click();
    await expect(page.locator('[data-access-department-filter]')).toHaveValue('dept_a');
    await page.locator('[data-access-tab="departments"]').click();
    await page.getByRole('button', { name: '新增部门' }).click();
    await expect(page.getByRole('heading', { name: '新增部门' })).toBeVisible();
    await expect(page.locator('#access-org-name')).toBeVisible();
    await page.locator('#rf-talent-dialog > .rf-dialog > .rf-dialog-close').click();
    await expect(page.getByRole('heading', { name: '组织与权限' })).toBeVisible();

    await page.locator('#rf-talent-dialog > .rf-dialog > .rf-dialog-close').click();
    await page.evaluate(() => window.setPage('resume-archive'));
    await expect(page.locator('#rf-search')).toBeVisible();
    await expect(page.locator('[data-rf-talent="talent_a"]').getByText('林悦')).toBeVisible();
    await expect(page.getByRole('button', { name: '上传简历' })).toHaveCount(0);
    await expect(page.getByText('岗位人才地图')).toHaveCount(0);
    await page.locator('[data-rf-talent="talent_a"]').click();
    await expect(page.locator('#rf-talent-dialog .rf-resume-detail-panel').getByText('简历详细信息')).toBeVisible();
    const talentDetail = page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') });
    const reviewStep = talentDetail.locator('#rf-detail-evaluation article').filter({ hasText: '业务群评审' }).first();
    await reviewStep.getByRole('button').click({ force: true });
    await expect(page.getByRole('heading', { name: '推送企微评审' })).toBeVisible();
    await expect(page.getByRole('button', { name: '确认推送' })).toBeVisible();
    const currentDialog = page.locator('#rf-talent-dialog > .rf-dialog');
    const wecomDialogOverflow = await currentDialog.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(wecomDialogOverflow).toBeLessThanOrEqual(1);
    const wecomDialogLayout = await currentDialog.evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
      clipped: node.scrollHeight - node.clientHeight > 1 && getComputedStyle(node).overflowY === 'hidden',
    }));
    expect(wecomDialogLayout.height).toBeLessThanOrEqual(wecomDialogLayout.viewportHeight);
    expect(wecomDialogLayout.clipped).toBe(false);
    await currentDialog.getByRole('button', { name: '取消' }).click();
    await expect(page.locator('#rf-talent-dialog:visible').filter({ has: page.locator('.rf-full-detail-dialog') })).toBeVisible();
    await openTalentMore(page);
    await expect(page.getByRole('button', { name: '图片转Word' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '简历版本' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'AI版本' })).toHaveCount(0);
    await page.getByRole('button', { name: '复核简历字段' }).click();
    await expect(page.getByRole('heading', { name: '人工复核简历字段' })).toBeVisible();
    await page.locator('#rf-review-jobIntention').fill('高级产品经理');
    await page.getByRole('button', { name: '保存人工复核' }).click();
    await expect(page.getByText('已修正1个字段并同步人才主档')).toBeVisible();
    await openTalentMore(page);
    await page.getByRole('button', { name: '修正AI标签/评分' }).click();
    await expect(page.getByRole('heading', { name: '人工修正AI标签和评分' })).toBeVisible();
    await page.getByRole('button', { name: '保存人工修正' }).click();
    await expect(page.getByText('请填写修正原因并确认已完成证据核对。')).toBeVisible();
    await page.locator('#rf-ai-correct-summary').fill('人工核对后确认具备商业化和团队管理能力。');
    await page.locator('#rf-ai-score-business').fill('92');
    await page.locator('#rf-ai-score-management').fill('90');
    await page.locator('#rf-ai-score-logic').fill('89');
    await page.locator('#rf-ai-score-communication').fill('85');
    await page.locator('#rf-ai-score-overall').fill('90');
    await page.locator('#rf-ai-correct-skills').fill('产品规划\n商业化策略');
    await page.locator('#rf-ai-correct-roles').fill('高级产品经理');
    await page.locator('#rf-ai-correct-reason').fill('已核对项目证明和团队规模');
    await page.locator('#rf-ai-correct-confirm').check();
    await page.getByRole('button', { name: '保存人工修正' }).click();
    await expect(page.locator('.rf-ai-summary').getByText('人工核对后确认具备商业化和团队管理能力。')).toBeVisible();
    await expect(page.locator('.rf-ai-summary').getByText('人工已修正')).toBeVisible();
    await expect(page.locator('.rf-score-card strong').filter({ hasText: /^90$/ }).first()).toBeVisible();
    await page.locator('#rf-talent-dialog > .rf-dialog > .rf-dialog-close').click();
    await page.evaluate(() => window.setPage('jobs'));
    await expect(page.locator('#page-jobs')).toHaveClass(/active/);
    await expect(page.getByRole('heading', { name: '岗位' })).toBeVisible();
    await expect(page.locator('#jobs-table-wrap .rf-job-card')).toBeVisible();
    await page.evaluate(() => window.setPage('resume-parse'));
    await expect(page.getByRole('heading', { name: '导入简历' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '最近批量任务' })).toBeVisible();
    await expect(page.getByText('李HR · 成功1 · 失败1 · 部分失败')).toBeVisible();
    await page.getByRole('button', { name: '查看明细' }).click();
    await expect(page.getByRole('heading', { name: '批量导入结果' })).toBeVisible();
    await expect(page.getByText('失败明细')).toBeVisible();
    await page.locator('#rf-talent-dialog > .rf-dialog > .rf-dialog-close').click();
    await page.getByRole('button', { name: '导入简历', exact: true }).click();
    await page.locator('#rf-batch-open').click();
    await expect(page.getByRole('heading', { name: '批量上传简历' })).toBeVisible();
    await page.locator('#rf-batch-files').setInputFiles([{ name: '候选人A.pdf', mimeType: 'application/pdf', buffer: Buffer.from('resume-a') }, { name: '候选人B.png', mimeType: 'image/png', buffer: Buffer.from('resume-b') }]);
    await expect(page.locator('#rf-batch-suppress-group-push')).toBeVisible();
    await page.locator('#rf-batch-suppress-group-push').check();
    const batchUploadRequest = page.waitForRequest(request => request.url().includes('/api/resumes/batch-upload'));
    await page.getByRole('button', { name: '开始批量解析' }).click();
    const uploadRequest = await batchUploadRequest;
    expect(uploadRequest.postData() || '').toContain('suppressGroupPush');
    expect(uploadRequest.postData() || '').toContain('true');
    await expect(page.getByRole('heading', { name: '批量导入结果' })).toBeVisible();
    await expect(page.getByText('OCR暂时失败')).toBeVisible();
    await expect(page.locator('.rf-batch-result-list article.failed')).toContainText('候选人B.png');
    await expect(page.locator('.rf-batch-result-list article.failed')).toContainText('2.0 KB · 尝试 1 次 · 原文件已保留');
    await expect(page.getByRole('button', { name: '查看失败明细' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '查看失败明细' }).click();
    await expect(page.getByRole('heading', { name: '批量导入结果' })).toBeVisible();
    await page.getByRole('button', { name: /重试\s*1\s*份已保留文件/ }).click();
    await expect(page.getByText('已成功').locator('..').getByText('2')).toBeVisible();
    await page.getByRole('button', { name: '选择岗位并修正AI分析' }).click();
    await expect(page.getByRole('heading', { name: 'AI已开始，可修正岗位' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '按所选岗位重新分析' })).toBeInViewport();
    const confirmDialogOverflow = await page.locator('.rf-dialog').evaluate(node => node.scrollWidth - node.clientWidth);
    expect(confirmDialogOverflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1440, height: 900 });
    const analysisStartRequest = page.waitForRequest(request => request.url().includes('/api/resumes/analysis/start'));
    await page.getByRole('button', { name: '按所选岗位重新分析' }).click();
    const analysisRequest = await analysisStartRequest;
    expect(analysisRequest.postData() || '').toContain('candidateId');
    expect(analysisRequest.postData() || '').toContain('resumeId');
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

test('unauthenticated talent review uses the system login page and returns to the review link', async ({ page }) => {
  let loggedIn = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/public/talent-reviews/review_token')) {
      if (!loggedIn) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: '请先登录系统，再打开简历评审' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        shareId: 'share_1', status: '评审中', claimed: false, viewer: { userId: 'manager_1', name: '陈经理', departments: ['产品部'] },
        candidate: { name: '林悦', analysis: { summary: '具备产品经验。', scores: { overall: 87 } }, matches: [] }, departments: [], positions: [], responseCount: 0,
      }) });
    }
    if (path.endsWith('/api/access/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(loggedIn
      ? { authenticated: true, authorized: true, accessState: 'active', userId: 'manager_1', userName: '陈经理', roleCodes: ['system_admin'], pages: ['*'], actions: ['*'], account: { id: 'manager_1', name: '陈经理', status: '启用', departments: ['产品部'] } }
      : { authenticated: false, authorized: false, accessState: 'identity_unavailable', roleCodes: [], pages: [], actions: [] }) });
    if (path.endsWith('/api/access/login')) {
      loggedIn = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ authenticated: true, message: '登录成功' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.goto('http://127.0.0.1:4178/talent-review.html?token=review_token');
  await expect(page.getByRole('heading', { name: '员工登录' })).toBeVisible();
  await expect(page.locator('#review-login-form')).toHaveCount(0);
  await page.locator('input[name="name"]').fill('陈经理');
  await page.locator('input[name="mobile"]').fill('15762703457');
  await page.getByRole('button', { name: '登录并进入系统' }).click();
  await expect(page).toHaveURL(/talent-review\.html\?token=review_token/);
  await expect(page.getByRole('heading', { name: '林悦' })).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`review position picker stays visible and submits the selected ID at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const positions = Array.from({ length: 10 }, (_, index) => ({ id: `position_${index}`, name: `招聘岗位 ${index}`, department: '业务部门' }));
    positions.push({ id: 'product_a', name: '高级产品经理', department: '技术中台' }, { id: 'product_b', name: '高级产品经理', department: '运营中台' });
    const data = { viewer: { name: '测试评审人', departments: ['运营中台'] }, candidate: { name: '测试候选人', skills: [], matches: [], analysis: {} }, positions };
    await page.route('**/api/public/talent-reviews/picker', route => route.fulfill({ json: data }));
    let submitted;
    await page.route('**/api/public/talent-reviews/picker/respond', route => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { processing: '已认领并进入约面' } });
    });
    await page.goto(`${baseUrl}talent-review.html?token=picker`);
    const input = page.getByRole('searchbox', { name: '认领岗位', exact: true });
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeInViewport();
    expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(48);
    expect((await input.boundingBox()).width).toBeGreaterThan(150);
    await expect(page.locator('datalist')).toHaveCount(0);
    await expect(page.locator('[data-review-position]')).toHaveCount(8);
    await page.locator('#position-more').click();
    await expect(page.locator('[data-review-position]')).toHaveCount(12);
    await input.fill('运营中台');
    await expect(page.locator('[data-review-position]')).toHaveCount(1);
    await page.locator('[data-review-position="product_b"]').click();
    await expect(page.locator('#position-selected')).toContainText('高级产品经理 · 运营中台');
    await page.locator('#position-clear').click();
    await expect(page.locator('#position-id')).toHaveValue('');
    await input.fill('不存在的岗位');
    await expect(page.locator('.review-position-empty')).toContainText('没有匹配岗位');
    await input.fill('高级产品经理');
    await page.getByRole('button', { name: '提交评审意见' }).click();
    expect(submitted).toBeUndefined();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    if (width < 760) await page.setViewportSize({ width, height: 360 });
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeInViewport();
    await page.locator('[data-review-position="product_b"]').click();
    await expect(page.locator('#position-id')).toHaveValue('product_b');
    await page.getByRole('button', { name: '不适合', exact: true }).click();
    await expect(page.locator('#position-field')).toBeHidden();
    await page.getByRole('button', { name: '适合我的岗位', exact: true }).click();
    await expect(input).toBeVisible();
    await expect(page.locator('#position-id')).toHaveValue('product_b');
    await page.setViewportSize({ width, height: 800 });
    await input.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`position-picker-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: '提交评审意见' }).click();
    await expect(page.getByRole('heading', { name: '意见已提交' })).toBeVisible();
    expect(submitted).toEqual({ decision: '适合', positionId: 'product_b', position: '高级产品经理' });
  });
}

test('review position picker supports keyboard selection and clears stale selection on editing', async ({ page }) => {
  await page.route('**/api/public/talent-reviews/keyboard', route => route.fulfill({ json: { viewer: {}, candidate: {}, positions: [{ id: 'same_a', name: '会计', department: '财务' }, { id: 'same_b', name: '会计', department: '财务' }] } }));
  let submitted;
  await page.route('**/api/public/talent-reviews/keyboard/respond', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: {} });
  });
  await page.goto(`${baseUrl}talent-review.html?token=keyboard`);
  await page.locator('#position').fill('会计');
  await page.locator('#position').press('ArrowDown');
  await expect(page.locator('[data-review-position="same_a"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#position-id')).toHaveValue('same_b');
  await page.locator('#position').fill('新的搜索');
  await expect(page.locator('#position-id')).toHaveValue('');
  await expect(page.locator('#position-selected')).toBeHidden();
  await page.getByRole('button', { name: '其他意见', exact: true }).click();
  await page.getByRole('button', { name: '提交评审意见' }).click();
  await expect(page.getByRole('heading', { name: '意见已提交' })).toBeVisible();
  expect(submitted).toEqual({ decision: '其他', positionId: '', position: '' });
});

test('review with no authorized positions explains the empty state and permits a non-claim response', async ({ page }) => {
  await page.route('**/api/public/talent-reviews/empty', route => route.fulfill({ json: { viewer: {}, candidate: {}, positions: [] } }));
  await page.route('**/api/public/talent-reviews/empty/respond', route => route.fulfill({ json: {} }));
  await page.goto(`${baseUrl}talent-review.html?token=empty`);
  await expect(page.locator('.review-position-empty')).toContainText('当前暂无可认领岗位');
  await page.getByRole('button', { name: '不适合', exact: true }).click();
  await expect(page.locator('#position-field')).toBeHidden();
  await page.getByRole('button', { name: '提交评审意见' }).click();
  await expect(page.getByRole('heading', { name: '意见已提交' })).toBeVisible();
});

test('WeCom talent review page reads like a printable resume and submits a department claim on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/access/me', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, authorized: true, accessState: 'active', userId: 'manager_1', userName: '陈经理', account: { id: 'manager_1', name: '陈经理', status: '启用', departments: ['产品部'] } }) }));
  await page.route('**/api/public/talent-reviews/review_token', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    shareId: 'share_1', status: '评审中', claimed: false, expiresAt: '2026-09-09T00:00:00.000Z', viewer: { userId: 'manager_1', name: '陈经理', departments: ['产品部'] },
    candidate: { name: '林悦', gender: '女', age: 29, yearsOfExperience: '6年', city: '杭州', currentCompany: '示例科技', currentRole: '产品经理', jobIntention: '高级产品经理', phone: '138****8001', email: 'li***@example.com', educationBackground: '浙江大学 本科', workExperience: '负责SaaS产品规划和商业化增长，推动核心转化率提升。', selfEvaluation: '擅长跨团队推进复杂产品项目。', skills: ['产品规划', '数据分析', '增长策略'], avatarUrl: 'https://cdn.example.test/avatars/linyue.jpg', sourceFileName: '林悦简历.pdf', sourceFileUrl: 'https://cdn.example.test/linyue.pdf', analysis: { summary: '具备成熟的SaaS产品和团队协作经验。', scores: { overall: 87 } }, matches: [{ positionId: 'pos_pm', positionName: '高级产品经理', score: 90, reason: '产品规划和增长经验与岗位要求高度重合。' }] },
    departments: [{ id: 'dept_product', name: '产品部' }], positions: [{ id: 'pos_pm', name: '高级产品经理', departmentId: 'dept_product', department: '产品部' }], responseCount: 0,
  }) }));
  await page.route('**/api/public/talent-reviews/review_token/respond', async (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ responseId: 'response_1', decision: '适合', processing: '已认领并进入约面', claimed: true, notification: { status: '已发送' } }) }));
  await page.goto('http://127.0.0.1:4178/talent-review.html?token=review_token');
  await expect(page.getByRole('heading', { name: '林悦' })).toBeVisible();
  await expect(page.getByAltText('林悦头像')).toBeVisible();
  await expect(page.getByRole('link', { name: /查看原始文件/ })).toHaveAttribute('href', 'https://cdn.example.test/linyue.pdf');
  await expect(page.getByText('综合匹配')).toBeVisible();
  await expect(page.getByRole('heading', { name: '是否适合我的岗位？' })).toBeVisible();
  await expect(page.locator('#reviewer')).toHaveCount(0);
  await expect(page.locator('#department')).toHaveCount(0);
  await expect(page.getByText('陈经理')).toBeVisible();
  await page.locator('#position').fill('高级产品经理 · 产品部');
  await page.locator('[data-review-position="pos_pm"]').click();
  await expect(page.locator('#position-id')).toHaveValue('pos_pm');
  await expect(page.locator('#comment')).toHaveCount(0);
  await page.getByRole('button', { name: '提交评审意见' }).click();
  await expect(page.getByRole('heading', { name: '认领已记录' })).toBeVisible();
  await expect(page.getByText('已通知所选岗位的招聘 HR 跟进意向沟通')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('completed talent review link becomes read-only for later viewers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let submitAttempts = 0;
  await page.route('**/api/public/talent-reviews/already_reviewed', route => route.fulfill({ json: {
    shareId: 'share_reviewed', status: '已认领', claimed: true, claimedDepartment: '产品部', claimedPosition: '高级产品经理',
    reviewed: true, responseCount: 1,
    review: { decision: '适合', department: '产品部', position: '高级产品经理', reviewer: '陈经理', submittedAt: '2026-09-29 10:00' },
    viewer: { userId: 'manager_2', name: '后来评审人', departments: ['运营部'] },
    candidate: { name: '林悦', skills: [], matches: [], analysis: {} },
    positions: [{ id: 'pos_pm', name: '高级产品经理', department: '产品部' }],
  } }));
  await page.route('**/api/public/talent-reviews/already_reviewed/respond', async route => {
    submitAttempts++;
    return route.fulfill({ json: {} });
  });
  await page.goto(`${baseUrl}talent-review.html?token=already_reviewed`);
  await expect(page.getByRole('heading', { name: '本次评审已完成' })).toBeVisible();
  await expect(page.locator('.claimed-banner')).toContainText('当前链接仅供查看，不能再提交评审');
  await expect(page.getByText('认领岗位：高级产品经理')).toBeVisible();
  await expect(page.locator('#submit-review')).toHaveCount(0);
  await expect(page.locator('.decision-grid')).toHaveCount(0);
  expect(submitAttempts).toBe(0);
});

for (const width of [320, 390]) {
  test(`mobile app navigation keeps workflows and filters intact at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await installApiMocks(page);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await expect(page.locator('.sidebar')).toBeHidden();
    const tabs = page.getByRole('navigation', { name: '手机主导航' });
    await expect(tabs.getByRole('button')).toHaveCount(5);
    await expect(tabs).toBeInViewport({ ratio: 1 });
    await tabs.getByRole('button', { name: '人才', exact: true }).click();
    await expect(page.locator('#page-resume-archive')).toHaveClass(/active/);
    await expect(page.locator('.rf-talent-filter-panel')).toBeHidden();
    const filter = page.locator('#page-resume-archive .rf-mobile-disclosure > button');
    await filter.click();
    await expect(page.locator('.rf-talent-filter-panel')).toBeVisible();
    await page.locator('#rf-job-filter').selectOption({ index: 1 });
    const selection = await page.locator('#rf-job-filter').inputValue();
    await filter.click();
    await filter.click();
    await expect(page.locator('#rf-job-filter')).toHaveValue(selection);
    await filter.click();
    await page.locator('#rf-search').fill('保留的搜索草稿');
    await expect(tabs).toBeHidden();
    await page.locator('#rf-search').evaluate(node => node.blur());
    await expect(tabs).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('app-talent.png') });
    await tabs.getByRole('button', { name: '更多功能', exact: true }).click();
    const menu = page.getByRole('dialog', { name: '我的工作台', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: /Offer 管理/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('app-menu.png') });
    await menu.getByRole('button', { name: /Offer 管理/ }).click();
    await expect(menu).not.toBeVisible();
    await expect(page.locator('#page-offers')).toHaveClass(/active/);
    await expect(tabs.getByRole('button', { name: '更多功能', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: '返回上一页', exact: true }).click();
    await expect(page.locator('#page-resume-archive')).toHaveClass(/active/);
    await tabs.getByRole('button', { name: '更多功能', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(tabs.getByRole('button', { name: '更多功能', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(tabs).toBeHidden();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.rf-talent-filter-panel')).toBeVisible();
  });
}

test('mobile app menu honors page and action permissions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await page.route('**/api/access/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    authenticated: true, authorized: true, accessState: 'active', enforcement: 'strict', userId: 'recruiter_1', userName: '招聘专员', roleCodes: ['recruiter'], pages: ['candidates'], actions: ['edit_candidate'], dataScopes: [], sensitiveFields: [],
    account: { id: 'recruiter_1', name: '招聘专员', mobile: '13800138000', departments: ['招聘部'], status: '启用' },
  }) }));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const tabs = page.getByRole('navigation', { name: '手机主导航' });
  await expect(tabs.getByRole('button')).toHaveCount(2);
  await expect(tabs.getByRole('button', { name: '人才', exact: true })).toBeVisible();
  await tabs.getByRole('button', { name: '更多功能', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '我的工作台', exact: true });
  await expect(menu.locator('[data-mobile-page]')).toHaveCount(1);
  await expect(menu.locator('[data-mobile-admin]')).toBeHidden();
  expect(await page.evaluate(() => window.setPage('offers'))).toBe(false);
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'mobile-small', width: 320, height: 568 },
]) {
  test(`${viewport.name} core workspaces stay readable without page overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installApiMocks(page);
    await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
    const workspaces = ['overview', 'jobs', 'applicants', 'resume-detail', 'resume-archive', 'talent', 'referral', 'interviews', 'offers', 'scheduled-tasks', 'resume-api', 'points', 'analytics', 'settings'];
    for (const workspace of workspaces) {
      await page.evaluate((pageName) => window.setPage(pageName), workspace);
      const activePage = page.locator(`#page-${workspace}`);
      await expect(activePage).toBeVisible();
      await page.waitForTimeout(80);
      if (viewport.width <= 760) {
        expect(await page.locator('.content').evaluate(node => getComputedStyle(node).backgroundImage)).toBe('none');
        const firstButton = activePage.locator('button:visible').first();
        if (await firstButton.count()) {
          const control = await firstButton.evaluate(node => ({ height: node.getBoundingClientRect().height, font: parseFloat(getComputedStyle(node).fontSize) }));
          expect(Math.round(control.height * 100) / 100, `${workspace} touch target`).toBeGreaterThanOrEqual(44);
          expect(control.font, `${workspace} button label`).toBeGreaterThanOrEqual(14);
        }
        const description = activePage.locator('.page-head p, .rf-workbench-head p').first();
        if (await description.count()) expect(await description.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(13);
      }
      const layout = await activePage.evaluate((node) => {
        const pageRect = node.getBoundingClientRect();
        return {
        pageOverflow: node.scrollWidth - node.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        offenders: [...node.querySelectorAll('*')]
          .filter((element) => element.scrollWidth - element.clientWidth > 1)
          .slice(0, 12)
          .map((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
              tagName: element.tagName,
              id: element.id,
              className: typeof element.className === 'string' ? element.className : '',
              overflow: element.scrollWidth - element.clientWidth,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              rectWidth: Math.round(rect.width * 100) / 100,
              left: Math.round(rect.left * 100) / 100,
              right: Math.round(rect.right * 100) / 100,
              width: style.width,
              minWidth: style.minWidth,
              maxWidth: style.maxWidth,
              margin: style.margin,
              padding: style.padding,
              boxSizing: style.boxSizing,
            };
          }),
        outside: [...node.querySelectorAll('*')]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tagName: element.tagName,
              id: element.id,
              className: typeof element.className === 'string' ? element.className : '',
              left: Math.round(rect.left * 100) / 100,
              right: Math.round(rect.right * 100) / 100,
              width: Math.round(rect.width * 100) / 100,
            };
          })
          .filter((element) => element.width > 1 && (element.right > pageRect.right + 1 || element.left < pageRect.left - 1))
          .slice(0, 12),
        };
      });
      const overflowDetails = JSON.stringify({ offenders: layout.offenders, outside: layout.outside });
      expect(layout.pageOverflow, `${workspace} page overflow: ${overflowDetails}`).toBeLessThanOrEqual(1);
      expect(layout.documentOverflow, `${workspace} document overflow: ${overflowDetails}`).toBeLessThanOrEqual(1);
      if (process.env.RF_CAPTURE_RESPONSIVE === '1') {
        await page.waitForTimeout(220);
        await page.screenshot({ path: `test-results/responsive-${viewport.name}-${workspace}.png` });
      }
    }
    const navHeight = await page.locator(viewport.width <= 760 ? '.rf-app-tabs button:visible' : '.nav-item:visible').first().evaluate((node) => node.getBoundingClientRect().height);
    expect(navHeight).toBeGreaterThanOrEqual(44);
    if (viewport.width <= 760) {
      await expect(page.locator('.sidebar-foot')).toBeHidden();
      await page.evaluate(() => window.setPage('interviews'));
      await expect(page.locator('.interview-mobile-agenda')).toBeVisible();
      await expect(page.locator('.calendar-shell')).toBeHidden();
    }
  });
}

test('large batch upload becomes non-blocking after the first chunk is accepted', async ({ page }) => {
  await installApiMocks(page);
  let uploadRequests = 0;
  let releaseSecondChunk;
  const secondChunkPending = new Promise(resolve => { releaseSecondChunk = resolve; });
  await page.route('**/api/resumes/batch-upload', async route => {
    uploadRequests += 1;
    if (uploadRequests === 2) await secondChunkPending;
    return route.fulfill({ json: { batchId: 'batch_async', jobId: '', status: uploadRequests === 1 ? 'uploading' : 'running', total: 25 } });
  });
  await page.route('**/api/resumes/batches/batch_async', route => route.fulfill({ json: {
    id: 'batch_async', name: '大批量上传', status: '处理中', total: 25, uploaded: 25,
    pending: 25, running: 0, succeeded: 0, failed: 0, retryable: 0, needsReupload: 0, items: [],
  } }));
  await page.goto(`${baseUrl}%E6%96%B9%E7%89%87%E6%8B%9B%E8%81%98%E7%BD%91%E7%AB%99%E7%95%8C%E9%9D%A2.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.setPage('resume-parse'));
  await page.locator('#rf-batch-open').click();
  await page.locator('#rf-batch-files').setInputFiles(Array.from({ length: 25 }, (_, index) => ({
    name: `候选人-${String(index + 1).padStart(2, '0')}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`resume-${index}`),
  })));
  await page.getByRole('button', { name: '开始批量解析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '批次已创建' })).toBeVisible();
  await expect(page.locator('[data-rf-batch-queued-status]')).toContainText('原始文件上传中 20/25');
  await expect.poll(() => uploadRequests).toBe(2);
  await page.getByRole('button', { name: '知道了，先去忙别的' }).click();
  await expect(page.getByRole('heading', { name: '批次已创建' })).toBeHidden();
  releaseSecondChunk();
  await expect(page.locator('.rf-notification').filter({ hasText: '原始文件上传完成，后台解析已开始' })).toBeVisible();
});
