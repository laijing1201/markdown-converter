/**
 * 真实网站 Smoke Test（P4C 第七节）—— 手动登录后对真实 ChatGPT / DeepSeek 执行。
 *
 * 用法（不要硬编码账号密码；用你自己的浏览器 Profile 登录）：
 *
 *   1. 关闭所有 Chrome / Edge 窗口；
 *   2. node scripts/smoke-extension.mjs --browser=edge
 *      （脚本会用你的真实 Profile + 加载 dist-extension 启动浏览器）
 *   3. 在打开的浏览器里手动登录 ChatGPT / DeepSeek，进入任意对话；
 *   4. 回到终端按回车，脚本对当前页面执行检查并输出 PASS / WARN / FAIL。
 *
 * 检查项：页面识别 / 对话标题 / 用户与 AI 消息 / 最新回答提取 /
 * 多选模式进入 / 导出 Word / 导出 PDF。
 *
 * 可选参数：
 *   --browser=chrome|edge   指定浏览器（默认 chrome，137+ 品牌 Chrome 需用 --chrome-path 指向
 *                           Chrome for Testing 或改用 Edge）
 *   --chrome-path=<exe>     浏览器可执行文件路径
 *   --url=<host>            目标站点（chatgpt.com 或 chat.deepseek.com，默认 chatgpt.com）
 */

import puppeteer from 'puppeteer-core'
import { existsSync, readdirSync, statSync, mkdirSync, rmSync } from 'fs'
import { join, resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_EXT = join(ROOT, 'dist-extension')
const OUT = join(ROOT, 'tests/ext/out/smoke')
mkdirSync(OUT, { recursive: true })

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  }),
)
const BROWSER = argv.browser === 'edge' ? 'edge' : 'chrome'
const TARGET = argv.url || 'chatgpt.com'

function findBrowser() {
  if (argv['chrome-path']) return argv['chrome-path']
  if (BROWSER === 'edge') {
    for (const p of [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]) if (existsSync(p)) return p
    return null
  }
  // Chrome 137+ 品牌 Chrome 不再支持 --load-extension：优先 Chrome for Testing
  const CFT_DIR = join(ROOT, 'tests/ext/browsers')
  if (existsSync(CFT_DIR)) {
    const stack = [CFT_DIR]
    while (stack.length) {
      const dir = stack.pop()
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (name === 'chrome.exe' && statSync(full).isFile()) return full
        if (statSync(full).isDirectory()) stack.push(full)
      }
    }
  }
  return null
}

const executablePath = findBrowser()
if (!executablePath) {
  console.error(`未找到 ${BROWSER}。可用 --chrome-path=<exe> 指定，或先：`)
  console.error('  npx @puppeteer/browsers install chrome@stable --path tests/ext/browsers')
  process.exit(1)
}
if (!existsSync(join(DIST_EXT, 'manifest.json'))) {
  console.error('缺少 dist-extension/ —— 请先 npm run build:extension')
  process.exit(1)
}

// 真实用户 Profile（保持登录态）。Chrome 品牌浏览器 137+ 不支持 load-extension，
// 此时降级为临时 Profile + Chrome for Testing。
const USER_PROFILE =
  BROWSER === 'edge'
    ? join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/User Data')
    : join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data')

console.log(`\n=== MarkDoc 扩展 Smoke Test（${BROWSER} → ${TARGET}）===`)
console.log(`Profile: ${USER_PROFILE}`)
console.log('提示：运行前请关闭所有该浏览器的窗口（Profile 不能被占用）。')

const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  userDataDir: USER_PROFILE,
  defaultViewport: null,
  args: [
    `--disable-extensions-except=${DIST_EXT}`,
    `--load-extension=${DIST_EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
})

const page = await browser.newPage()
await page.goto(`https://${TARGET}/`, { waitUntil: 'domcontentloaded' })

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((r) => rl.question(q, r))
await ask('\n请在浏览器中登录并打开一个有内容的对话页面，然后回车执行检查…')

// ── 检查 ─────────────────────────────────────────────────────────────────────

let pass = 0
let warn = 0
let fail = 0
const verdict = (level, label, detail = '') => {
  const icon = level === 'PASS' ? '✓' : level === 'WARN' ? '⚠' : '✗'
  console.log(`  [${level}] ${icon} ${label}${detail ? ` —— ${detail}` : ''}`)
  if (level === 'PASS') pass++
  else if (level === 'WARN') warn++
  else fail++
}

/** content script 隔离世界 → e2e 桥（需 URL 带 ?markdoc-e2e=1 时启用） */
async function e2eCall(page, action, ...args) {
  return page.evaluate((action, args) => {
    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9)
      const timeout = setTimeout(() => resolve({ error: 'timeout' }), 30_000)
      const onMsg = (e) => {
        if (e.source !== window) return
        const d = e.data
        if (!d || d.source !== 'markdoc-ext-e2e' || d.id !== id) return
        clearTimeout(timeout)
        window.removeEventListener('message', onMsg)
        resolve(d.result)
      }
      window.addEventListener('message', onMsg)
      window.postMessage({ source: 'markdoc-e2e', id, action, args }, window.location.origin)
    })
  }, action, args)
}

// 1. 页面识别（popup 状态通道）
let state = null
try {
  state = await e2eCall(page, 'state')
} catch { /* content script 未注入 */ }
if (!state || state.error) {
  // e2e 桥需要 markdoc-e2e 参数：带参重载
  await page.goto(`${page.url()}${page.url().includes('?') ? '&' : '?'}markdoc-e2e=1`, { waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 3000))
  state = await e2eCall(page, 'state').catch(() => null)
}
verdict(state && state.supported ? 'PASS' : 'FAIL', '页面识别（content script 注入）', JSON.stringify(state ?? {}).slice(0, 120))
if (state && state.title) verdict('PASS', '对话标题', state.title)
else verdict('WARN', '对话标题未识别（可能页面无侧栏标题）')

// 2. 健康检查
const health = await e2eCall(page, 'health').catch(() => null)
if (health && !health.error) {
  const msgs = (health.userMessages ?? 0) + (health.assistantMessages ?? 0)
  verdict(msgs > 0 ? 'PASS' : 'FAIL', `消息识别（用户 ${health.userMessages} / AI ${health.assistantMessages}）`)
  verdict('INFO' in {} ? 'PASS' : health.extractionConfidence === 'high' ? 'PASS' : msgs > 0 ? 'WARN' : 'FAIL',
    `提取置信度：${health.extractionConfidence}${health.warnings?.length ? ` · 警告：${health.warnings.join(',')}` : ''}`)
  verdict('PASS', `要素：公式 ${health.mathDetected} · 表格 ${health.tablesDetected} · 代码 ${health.codeBlocksDetected} · 图片 ${health.imagesDetected}`)
} else {
  verdict('WARN', '健康检查不可用（旧版本扩展或 e2e 桥未启用）')
}

// 3. 导出 Word / PDF（真实下载到 tests/ext/out/smoke/downloads）
const DOWNLOADS = join(OUT, 'downloads')
rmSync(DOWNLOADS, { recursive: true, force: true })
mkdirSync(DOWNLOADS, { recursive: true })
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true })

async function waitDownload(ext, timeoutMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const files = readdirSync(DOWNLOADS).filter((f) => f.endsWith(ext) && !f.endsWith('.crdownload'))
    if (files.length > 0) {
      const file = join(DOWNLOADS, files[0])
      let size = statSync(file).size
      await new Promise((r) => setTimeout(r, 700))
      while (statSync(file).size !== size) {
        size = statSync(file).size
        await new Promise((r) => setTimeout(r, 700))
      }
      return file
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

// 导出经 popup 通道（真实用户路径）：chrome.tabs.sendMessage —— 由 background/快捷键同一通道
// smoke 里直接用 e2e 桥的 exportLast（与按钮同一条导出管线）
for (const [label, ext, target] of [['导出 Word', '.docx', 'docx'], ['导出 PDF', '.pdf', 'pdf']]) {
  const dlPromise = waitDownload(ext)
  const res = await e2eCall(page, 'exportLast', target).catch((e) => ({ error: String(e) }))
  const file = await dlPromise
  if (res && res.ok && file) verdict('PASS', label, basename(file))
  else if (res && res.ok === false) verdict('FAIL', label, '扩展返回失败（页面可能无 AI 回答）')
  else verdict('FAIL', label, JSON.stringify(res ?? {}).slice(0, 120))
}

// 4. 多选模式进入
const sel = await e2eCall(page, 'openSelection').catch((e) => ({ error: String(e) }))
verdict(sel && !sel.error ? 'PASS' : 'FAIL', '进入多选模式', JSON.stringify(sel ?? {}).slice(0, 120))

console.log(`\nSMOKE RESULT: ${pass} PASS, ${warn} WARN, ${fail} FAIL`)
await ask('检查完成，回车退出浏览器…')
rl.close()
await browser.close()
process.exit(fail > 0 ? 1 : 0)
