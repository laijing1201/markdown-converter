import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

// 使用本地 Vite 和模拟 API，不访问任何线上账号。
process.env.MARKDOC_TARGET = 'web'
process.env.VITE_SUPABASE_URL = 'https://account.test'
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
if (!executablePath) throw new Error('请通过 CHROME_PATH 指定测试浏览器')
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await puppeteer.launch({ executablePath, headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setRequestInterception(true)
  let mustChangePassword = true
  let changed = false
  page.on('request', async request => {
    if (!request.url().startsWith('https://account.test/')) return request.continue()
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return request.respond({ status: 200, headers })
    const { action, params } = JSON.parse(request.postData())
    let status = 200, body = {}
    if (action === 'login') {
      if (!params.totp) { status = 401; body = { error: '需要两步验证', needTotp: true } }
      else body = { token: 'test-token', role: 'super', permissions: [], mustChangePassword }
    } else if (action === 'me') body = { adminId: 'test-admin', role: 'super', permissions: [], mustChangePassword }
    else if (action === 'password.change') {
      assert.equal(params.password, 'NewPassword12345')
      changed = true; mustChangePassword = false; body = { ok: true }
    }
    await request.respond({ status, headers, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const url = `http://127.0.0.1:${server.httpServer.address().port}/admin.html`
  await page.goto(url)
  const clickText = text => page.evaluate(label => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label)
    if (!button) throw new Error(`Missing button ${label}`)
    button.click()
  }, text)
  await page.waitForSelector('input[placeholder="管理员邮箱"]')
  await page.type('input[placeholder="管理员邮箱"]', 'admin@example.test')
  await page.type('input[placeholder="密码"]', 'InitialPassword123')
  await clickText('登录')
  await page.waitForSelector('input[placeholder="2FA 验证码（TOTP）"]')
  await page.type('input[placeholder="2FA 验证码（TOTP）"]', '123456')
  await clickText('登录')
  await page.waitForSelector('input[placeholder="新密码"]')
  assert.equal(await page.$('aside'), null)
  await page.type('input[placeholder="新密码"]', 'NewPassword12345')
  await page.type('input[placeholder="再次输入新密码"]', 'different')
  await clickText('保存并重新登录')
  await page.waitForFunction(() => document.body.innerText.includes('两次输入的密码不一致'))
  assert.equal(changed, false)
  await page.focus('input[placeholder="再次输入新密码"]')
  await page.keyboard.down('Control')
  await page.keyboard.press('A')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.type('input[placeholder="再次输入新密码"]', 'NewPassword12345')
  await clickText('保存并重新登录')
  await page.waitForSelector('input[placeholder="管理员邮箱"]')
  assert.equal(changed, true)
  assert.equal(await page.evaluate(() => sessionStorage.getItem('markdoc.admin.token')), null)
  assert.deepEqual(errors, [])
  console.log('✓ 实际浏览器：2FA 输入、初始改密页、确认不一致拦截、改密成功退出')
} finally {
  await browser?.close()
  await server.close()
}
