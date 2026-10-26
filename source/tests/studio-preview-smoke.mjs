import { chromium } from '/usr/lib/node_modules/playwright/index.mjs'

const baseUrl = process.env.STUDIO_PREVIEW_URL
if (!baseUrl) throw new Error('缺少 STUDIO_PREVIEW_URL')

const pages = [
  'overview',
  'demand',
  'jobs',
  'resume-parse',
  'resume-archive',
  'talent',
  'interviews',
  'referral',
  'analytics',
  'resume-api',
  'settings',
]

const browser = await chromium.launch({ headless: true })
const results = []

try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 960 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    const pageErrors = []
    const consoleErrors = []
    const failedRequests = []

    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.pathname.includes('/api/') && response.status() >= 400) {
        failedRequests.push({ status: response.status(), method: response.request().method(), path: url.pathname })
      }
    })

    const response = await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 })
    if (!response?.ok()) throw new Error(`${viewport.name} 首页返回 ${response?.status() || '无响应'}`)

    for (const target of pages) {
      await page.evaluate((name) => window.setPage(name), target)
      await page.waitForTimeout(350)
    }

    await page.locator('[data-system-status]').first().evaluate((button) => button.click())
    await page.getByRole('heading', { name: '系统版本与运行状态' }).waitFor({ state: 'visible' })
    const statusText = await page.locator('.rf-dialog').innerText()
    if (!statusText.includes('86/86') || !statusText.includes('dist/main.js')) {
      throw new Error(`${viewport.name} 系统状态页缺少数据库或生产入口信息`)
    }
    await page.keyboard.press('Escape')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    results.push({
      viewport: viewport.name,
      pageErrors,
      consoleErrors,
      failedRequests,
      horizontalOverflow: overflow,
      visitedPages: pages.length,
    })
    await context.close()
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify(results, null, 2))
const failed = results.some((item) => item.pageErrors.length || item.consoleErrors.length || item.failedRequests.length || item.horizontalOverflow > 1)
if (failed) process.exitCode = 1
