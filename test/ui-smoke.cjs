const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const { dirname, resolve } = require('node:path')

const baseURL = process.env.DSH_UI_URL || 'http://127.0.0.1:3099'
const screenshotPath = process.env.DSH_UI_SCREENSHOT ? resolve(process.env.DSH_UI_SCREENSHOT) : ''

async function completeOnboarding(page) {
  const continueButton = page.getByRole('button', { name: /^(Continue|继续)$/ }).last()
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click()
  }
  const laterButton = page.getByRole('button', { name: /Configure later|Later|稍后配置/i }).last()
  await laterButton.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  if (await laterButton.isVisible().catch(() => false)) {
    await laterButton.click()
    await page.locator('[role=presentation]').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  }
}

async function openUsage(page) {
  const labeled = page.getByText(/Usage & Cost|用量统计/, { exact: true }).first()
  const footer = page.locator('.dui-side').first()
  if (!await labeled.isVisible().catch(() => false) && !await footer.isVisible().catch(() => false)) {
    const sidebarToggle = page.getByRole('button', { name: /Open sidebar|打开侧边栏/ }).first()
    if (await sidebarToggle.isVisible().catch(() => false)) await sidebarToggle.click()
  }
  const entry = await labeled.isVisible().catch(() => false) ? labeled : footer
  await entry.waitFor({ state: 'visible', timeout: 30_000 })
  await entry.click()
  await page.getByText(/Usage changes|使用变化/).first().waitFor({ state: 'visible', timeout: 30_000 })
}

async function runViewport(browser, viewport, capture = false) {
  const context = await browser.newContext({ viewport, colorScheme: 'light', acceptDownloads: true })
  const page = await context.newPage()
  const failures = []
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  page.on('pageerror', error => failures.push(`page: ${error.message}`))

  const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  assert(response && response.status() === 200, `expected HTTP 200 from ${baseURL}`)
  await page.waitForFunction(() => document.body && !document.body.innerText.includes('Loading plugins'), null, { timeout: 30_000 })
  await completeOnboarding(page)
  await openUsage(page)
  await page.getByText(/Model prices & FX|模型价格与汇率/).first().waitFor({ state: 'visible' })
  const more = page.locator('summary').filter({ hasText: /More|更多/ }).last()
  if (await more.isVisible().catch(() => false)) await more.click()
  await page.getByText(/Export CSV|导出 CSV/).first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('input[type=url][readonly]').count() > 0, true, 'OpenRouter URL must be read-only')

  if (capture && screenshotPath) {
    await mkdir(dirname(screenshotPath), { recursive: true })
    await page.screenshot({ path: screenshotPath, fullPage: true })
  }
  assert.deepEqual(failures, [], failures.join('\n'))
  await context.close()
}

async function verifyLocaleAndTheme(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(() => document.body && !document.body.innerText.includes('Loading plugins'), null, { timeout: 30_000 })
  await completeOnboarding(page)
  await page.getByText(/Settings|设置/, { exact: true }).first().click()

  const languageTrigger = page.locator('button').filter({ hasText: /^(English|中文)$/ }).first()
  const originalLanguage = (await languageTrigger.innerText()).trim()
  const alternateLanguage = originalLanguage === 'English' ? '中文' : 'English'
  await languageTrigger.click()
  await page.getByRole('menuitem', { name: alternateLanguage, exact: true }).click()
  await page.getByText(originalLanguage === 'English' ? '设置' : 'Settings', { exact: true }).first().waitFor()
  const restoreLanguage = page.locator('button').filter({ hasText: new RegExp(`^${alternateLanguage}$`) }).first()
  await restoreLanguage.click()
  await page.getByRole('menuitem', { name: originalLanguage, exact: true }).click()
  await page.getByText(originalLanguage === 'English' ? 'Settings' : '设置', { exact: true }).first().waitFor()

  const themeNames = ['Light', 'Dark', 'System', '浅色', '深色', '跟随系统']
  const themeButtons = page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^(${themeNames.join('|')})$`) })
  let originalTheme = null
  let alternateTheme = null
  for (const button of await themeButtons.all()) {
    if (await button.getAttribute('aria-pressed') === 'true') originalTheme = button
    else alternateTheme ||= button
  }
  assert(originalTheme, 'expected a selected appearance theme')
  assert(alternateTheme, 'expected an alternate appearance theme')
  const originalThemeText = (await originalTheme.innerText()).trim()
  await alternateTheme.click()
  assert.equal(await alternateTheme.getAttribute('aria-pressed'), 'true')
  await page.getByText(originalThemeText, { exact: true }).last().click()
  await context.close()
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    await verifyLocaleAndTheme(browser)
    await runViewport(browser, { width: 1440, height: 1000 }, true)
    await runViewport(browser, { width: 390, height: 844 })
  } finally {
    await browser.close()
  }
  console.log(`Portable UI smoke passed at ${baseURL} (desktop and narrow viewport).`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
