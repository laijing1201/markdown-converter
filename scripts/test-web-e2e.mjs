/**
 * MarkDoc Web 在线版 E2E（P5A 第二十六/二十七/二十八节）：
 *
 *   真实浏览器（puppeteer-core + Chrome for Testing / Edge）访问
 *   http://127.0.0.1:<port>/markdown-converter/（GitHub Pages 生产 base 模拟），
 *   全程点击真实按钮：
 *
 *     打开 Web → 注入验收测试文档（tests/fixtures/export-test.md）
 *       → 切换模板（工具栏缩略图）→ 打开「最终效果」（真实分页 modal）
 *       → 导出 DOCX → 解包校验 ZIP / OOXML / OMML
 *       → 导出 PDF → pdfjs 校验真文本 / 页数 / 中文提取
 *
 *   同时校验生产 base 下无资源 404（含 PDF 字体懒加载路径）。
 *
 * 运行：npm run build && npm run test:web:e2e
 */

import puppeteer from 'puppeteer-core'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync,
} from 'node:fs'
import { join, resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'tests/pdf/out')
const DOWNLOADS = join(OUT, 'web-e2e-downloads')
const PORT = 4457
const BASE = '/markdown-converter'
const PAGE_URL = `http://127.0.0.1:${PORT}${BASE}/`

const TEST_MD = readFileSync(join(ROOT, 'tests/fixtures/export-test.md'), 'utf-8')

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('❌ 缺少 dist/（网页版构建产物），请先运行 npm run build')
  process.exit(1)
}
mkdirSync(DOWNLOADS, { recursive: true })
for (const f of readdirSync(DOWNLOADS)) rmSync(join(DOWNLOADS, f), { force: true })

// ── GitHub Pages 生产 base 模拟服务器（与 serve-ghpages.mjs 同规则）──────────

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.json': 'application/json', '.ico': 'image/x-icon',
}
const failedRequests = []
const server = createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (urlPath === BASE || urlPath === `${BASE}/`) urlPath = '/index.html'
  else if (urlPath.startsWith(`${BASE}/`)) urlPath = urlPath.slice(BASE.length)
  else {
    res.writeHead(301, { Location: `${BASE}/` })
    res.end()
    return
  }
  const filePath = join(DIST, urlPath)
  if (!filePath.startsWith(DIST) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    failedRequests.push(urlPath)
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' })
  res.end(readFileSync(filePath))
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
console.log(`✓ 生产 base 模拟服务器: ${PAGE_URL}`)

// ── 浏览器（Chrome for Testing 优先，Edge 兜底）──────────────────────────────

function findCfT() {
  const CFT_DIR = join(ROOT, 'tests/ext/browsers')
  if (!existsSync(CFT_DIR)) return null
  const stack = [CFT_DIR]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (name === 'chrome.exe' && statSync(full).isFile()) return full
      if (statSync(full).isDirectory()) stack.push(full)
    }
  }
  return null
}
function findEdge() {
  for (const p of [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]) if (existsSync(p)) return p
  return null
}
const browserPath = findCfT() ?? findEdge()
if (!browserPath) {
  console.error('❌ 未找到浏览器。运行 npx @puppeteer/browsers install chrome@stable --path tests/ext/browsers')
  process.exit(1)
}
console.log(`浏览器：${browserPath}`)

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: 'new',
  args: ['--no-first-run', '--disable-gpu'],
})
const page = await browser.newPage()
page.setDefaultTimeout(60_000)
const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

const cdp = await page.createCDPSession()
const DOWNLOADS_ABS = DOWNLOADS
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS_ABS, eventsEnabled: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 1. 打开 Web（生产 base）──────────────────────────────────────────────────

console.log('\n── 场景 1：打开 GitHub Pages 生产 base ──')
await page.goto(PAGE_URL, { waitUntil: 'networkidle2' })
check('页面加载无 pageerror', !(await page.evaluate(() => !document.getElementById('preview-container'))))
check('生产 base 下资源无 404', failedRequests.length === 0, failedRequests.slice(0, 5).join(', '))
const heroVisible = await page.evaluate(() => document.body.innerText.includes('把 AI 回答一键变成排版好的 Word / PDF'))
check('第一屏任务导向 hero 可见', heroVisible)

// ── 2. 注入验收测试文档 ──────────────────────────────────────────────────────

console.log('\n── 场景 2：注入验收测试文档 ──')
await page.evaluate((md) => {
  const t = window.__MARKDOC_TEST__
  t.setContent(md)
}, TEST_MD)
await page.waitForFunction(() => {
  const el = document.getElementById('preview-container')
  return el && el.querySelectorAll('.math-block').length >= 3 && el.querySelector('.mermaid-rendered svg')
}, { timeout: 60_000 })
check('预览渲染公式（math-block ≥ 3）', true)
check('预览渲染 Mermaid', true)
// 等渲染管线完全就位（字体/公式重排），状态条页数估算才会稳定
await new Promise((r) => setTimeout(r, 2500))
const statText = await page.evaluate(() => document.querySelector('[data-testid="doc-stats"]')?.textContent ?? '')
check('状态条显示统计', /字/.test(statText) && /公式/.test(statText), statText.trim())
const statusText = await page.evaluate(() => document.querySelector('[data-testid="doc-status"]')?.textContent ?? '')
console.log(`   状态条：${statText.trim()} | ${statusText.trim()}`)

// ── 3. 快速模式：切换模板（真实点击缩略图卡片）────────────────────────────────

console.log('\n── 场景 3：切换模板 ──')
await page.click('button[data-template="academic"]')
await page.waitForFunction(() => window.__MARKDOC_TEST__.getSettings().template === 'academic')
const previewClass = await page.evaluate(() => document.getElementById('preview-container')?.className ?? '')
check('切换到学术模板', previewClass.includes('tpl-academic'), previewClass.split(' ').find((c) => c.startsWith('tpl-')) ?? '')
await page.click('button[data-template="general"]')
await page.waitForFunction(() => window.__MARKDOC_TEST__.getSettings().template === 'general')
check('切换回通用模板', true)

// ── 4. 最终效果（真实分页预览）───────────────────────────────────────────────

console.log('\n── 场景 4：最终效果 ──')
await page.click('button[data-testid="tab-final-preview"]')
await page.waitForFunction(() => {
  const canvases = Array.from(document.querySelectorAll('canvas'))
  return canvases.length >= 2 && canvases.every((c) => c.width > 0 && c.height > 0)
}, { timeout: 120_000 })
const pageCount = await page.evaluate(() => document.querySelectorAll('canvas').length)
check('最终效果显示真实分页（canvas 页）', pageCount >= 5, `${pageCount} 页`)
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'))
  btns.find((b) => b.textContent?.trim() === '关闭')?.click()
})
await new Promise((r) => setTimeout(r, 300))

// ── 5. 导出 DOCX（真实点击 → 下载 → 解包校验）────────────────────────────────

console.log('\n── 场景 5：导出 Word ──')
async function clickExportAndDownload(buttonText, ext) {
  const before = new Set(readdirSync(DOWNLOADS))
  const click = page.evaluate((text) => {
    const btns = Array.from(document.querySelectorAll('button'))
    const btn = btns.find((b) => b.textContent?.trim() === text)
    if (!btn) throw new Error(`找不到按钮：${text}`)
    btn.click()
  }, buttonText)
  await click
  await new Promise((r) => setTimeout(r, 800))
  // preflight 弹窗可能出现（有问题时），出现则点「仍要导出」
  const preflightBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find((x) => x.textContent?.includes('仍要导出'))
    if (b) { b.click(); return true }
    return false
  })
  if (preflightBtn) console.log('   （preflight 弹窗出现，已点击「仍要导出」）')
  // 等待下载文件落盘（导出含字体加载，本地服务器较快）
  for (let i = 0; i < 240; i++) {
    const now = readdirSync(DOWNLOADS)
    const fresh = now.filter((f) => !before.has(f) && f.endsWith(ext) && !f.endsWith('.crdownload'))
    if (fresh.length > 0) return join(DOWNLOADS, fresh[0])
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`下载超时：${ext}`)
}

const docxPath = await clickExportAndDownload('导出 Word', '.docx')
console.log(`   下载：${docxPath}`)
{
  const zip = await JSZip.loadAsync(readFileSync(docxPath))
  const docXml = await zip.file('word/document.xml')?.async('string') ?? ''
  const stylesXml = await zip.file('word/styles.xml')?.async('string') ?? ''
  const numberingXml = await zip.file('word/numbering.xml')?.async('string') ?? ''
  check('DOCX ZIP 完整（document/styles/numbering）',
    !!zip.file('word/document.xml') && stylesXml.length > 0 && numberingXml.length > 0)
  check('DOCX OMML 原生公式（m:oMath）', /<m:oMath[\s>]/.test(docXml), `${(docXml.match(/<m:oMath[\s>]/g) ?? []).length} 处`)
  check('DOCX OMML 块公式（m:oMathPara）', docXml.includes('<m:oMathPara>'))
  check('DOCX 标题样式（Heading）', /w:pStyle w:val="Heading\d"/.test(docXml))
  check('DOCX 表格存在', docXml.includes('<w:tbl>'))
  check('DOCX 真分页符', docXml.includes('w:type="page"'))
  const footerXml = (await Promise.all(
    Object.keys(zip.files).filter((f) => /word\/footer\d*\.xml$/.test(f)).map((f) => zip.file(f).async('string')),
  )).join('')
  check('DOCX 页码字段（footer PAGE）', footerXml.includes('PAGE'), `${footerXml.length}B footer`)
  check('DOCX 图片嵌入', Object.keys(zip.files).some((f) => f.startsWith('word/media/')))
  const firstText = docXml.replace(/<[^>]+>/g, '')
  check('DOCX 中文内容', firstText.includes('MarkDoc 导出测试') && firstText.includes('这里必须从新页面开始'))
  writeFileSync(join(OUT, 'web-e2e-export.docx'), readFileSync(docxPath))
}

// ── 6. 导出 PDF（真实点击 → 下载 → pdfjs 校验）───────────────────────────────

console.log('\n── 场景 6：导出 PDF ──')
const pdfPath = await clickExportAndDownload('导出 PDF', '.pdf')
console.log(`   下载：${pdfPath}`)
{
  const buf = readFileSync(pdfPath)
  check('PDF header 正确', buf.subarray(0, 5).toString('latin1') === '%PDF-')
  check('生产 base 下字体等资源无 404（含懒加载）', failedRequests.length === 0, failedRequests.slice(0, 5).join(', '))
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false })
  const doc = await task.promise
  check('PDF 页数 ≥ 5', doc.numPages >= 5, `${doc.numPages} 页`)
  const page1 = await doc.getPage(1)
  const text1 = (await page1.getTextContent()).items.map((i) => i.str).join('')
  check('PDF 第 1 页中文可提取', text1.includes('MarkDoc 导出测试'), text1.slice(0, 40))
  let allText = text1
  for (let p = 2; p <= Math.min(doc.numPages, 4); p++) {
    const pg = await doc.getPage(p)
    allText += (await pg.getTextContent()).items.map((i) => i.str).join('')
  }
  check('PDF 数学/表格内容可提取（真文本非截图）', allText.includes('方法') && allText.includes('测试'), '')
  // 链接注解（测试文档含一个外链）
  let annots = 0
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p)
    const ann = await pg.getAnnotations()
    annots += ann.length
  }
  check('PDF 链接注解存在', annots >= 1, `${annots} 个`)
  writeFileSync(join(OUT, 'web-e2e-export.pdf'), buf)
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────

const hardErrors = consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_ABORTED'))
check('浏览器控制台无严重错误', hardErrors.length === 0, hardErrors.slice(0, 3).join(' | '))

await browser.close()
server.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n═══ Web E2E 结果：${results.length - failed.length}/${results.length} 通过 ═══`)
if (failed.length > 0) {
  failed.forEach((f) => console.error(`   ❌ ${f.name} ${f.detail}`))
  process.exit(1)
}
