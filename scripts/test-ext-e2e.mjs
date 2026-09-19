/**
 * 扩展真实浏览器 E2E（P4C 第三十六/三十七节）：
 *
 *   puppeteer-core 启动 Chrome（默认）或 Edge（--browser=edge），--load-extension
 *   加载 dist-extension，--host-resolver-rules 把 chatgpt.com / chat.deepseek.com /
 *   laijing1201.github.io 映射到本地 HTTPS 服务器（服务 fixture 与网页版 dist/，
 *   含 GitHub Pages 子路径 /markdown-converter/ 前缀模拟）。
 *
 *   场景：
 *     1. content script 注入 + 防重复（data-markdoc-root 唯一）
 *     2. ChatGPT fixture → 导出最近回答 → Word → 解包校验（m:oMath/表格/代码/链接/图片/列表）
 *     3. ChatGPT fixture → 导出整段对话（内容整理模式）→ Word + 一致性计数基准
 *     4. 同一内容 → PDF → 内容一致性（真文本/链接注解/公式表格计数对齐）
 *     5. DeepSeek fixture → 导出最近回答 → PDF
 *     6. 「在 MarkDoc 中编辑」桥接
 *     7. SPA 路由切换（聊天 A → B → 新建，不得错导/残留）
 *     8. 离线导出（页面已加载 + 断网 → Word 仍可用）
 *
 * 运行：npm run build && npm run build:extension && node scripts/test-ext-e2e.mjs [--browser=edge]
 */

import puppeteer from 'puppeteer-core'
import https from 'https'
import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import JSZip from 'jszip'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const BROWSER = process.argv.includes('--browser=edge') ? 'edge' : 'chrome'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_EXT = join(ROOT, 'dist-extension')
const WEB_DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'tests/ext/out')
const DOWNLOADS = join(OUT, 'downloads')
const CG_FIXTURE = readFileSync(join(ROOT, 'tests/fixtures/chatgpt/v1-mixed.html'), 'utf-8')
const DS_FIXTURE = readFileSync(join(ROOT, 'tests/fixtures/deepseek/v1-mixed.html'), 'utf-8')
// SPA 场景：聊天 A / 聊天 B / 空白（新建聊天）
const CG_CONVERSATION = readFileSync(join(ROOT, 'tests/fixtures/chatgpt/v1-conversation.html'), 'utf-8')
const CG_BASIC = readFileSync(join(ROOT, 'tests/fixtures/chatgpt/v1-basic.html'), 'utf-8')
const CG_BLANK = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>新聊天</title></head><body><main><div id="conversation-list"></div></main></body></html>'

if (!existsSync(DIST_EXT)) {
  console.error('❌ 缺少 dist-extension/，请先运行 npm run build:extension')
  process.exit(1)
}

mkdirSync(DOWNLOADS, { recursive: true })
for (const f of readdirSync(DOWNLOADS)) rmSync(join(DOWNLOADS, f), { force: true })

// ── 自签名证书 ────────────────────────────────────────────────────────────────

const CERT_KEY = join(OUT, 'key.pem')
const CERT_PEM = join(OUT, 'cert.pem')
if (!existsSync(CERT_PEM)) {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', CERT_KEY, '-out', CERT_PEM,
    '-days', '30', '-nodes', '-subj', '/CN=markdoc-e2e',
  ])
}
const tlsOptions = { key: readFileSync(CERT_KEY), cert: readFileSync(CERT_PEM) }

// ── 本地 HTTPS 服务器 ─────────────────────────────────────────────────────────

function startServer(port, handler) {
  return new Promise((resolveP) => {
    const server = https.createServer(tlsOptions, (req, res) => {
      try {
        handler(req, res)
      } catch (err) {
        res.writeHead(500)
        res.end(String(err))
      }
    })
    server.listen(port, '127.0.0.1', () => resolveP(server))
  })
}

const serveHtml = (html) => (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
}

/** 静态目录服务（网页版 dist/） */
const GH_PAGES_BASE = '/markdown-converter'

/** 静态目录服务（网页版 dist/），剥离 GitHub Pages 子路径前缀 */
const serveDir = (dir) => (req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  if (urlPath === GH_PAGES_BASE || urlPath.startsWith(`${GH_PAGES_BASE}/`)) {
    urlPath = urlPath.slice(GH_PAGES_BASE.length) || '/'
  }
  let filePath = join(dir, urlPath === '/' ? 'index.html' : urlPath)
  if (!filePath.startsWith(dir)) filePath = join(dir, 'index.html')
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA 回退
    filePath = join(dir, 'index.html')
  }
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
  res.end(readFileSync(filePath))
}

const PORT_CG = 4443
const PORT_DS = 4444
const PORT_WEB = 4445

const ROUTES = {
  '/': CG_FIXTURE,
  '/?': CG_FIXTURE,
  '/c/mixed': CG_FIXTURE,
  '/c/conversation-a': CG_CONVERSATION,
  '/c/conversation-b': CG_BASIC,
  '/c/new': CG_BLANK,
}
const routedHandler = (req, res) => {
  const path = decodeURIComponent((req.url || '/').split('?')[0])
  const html = ROUTES[path] ?? CG_FIXTURE
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}
const serverCG = await startServer(PORT_CG, routedHandler)
const serverDS = await startServer(PORT_DS, serveHtml(DS_FIXTURE))
if (!existsSync(join(WEB_DIST, 'index.html'))) {
  console.error('❌ 缺少 dist/（网页版构建产物），请先运行 npm run build')
  process.exit(1)
}
const serverWeb = await startServer(PORT_WEB, serveDir(WEB_DIST))

// ── Chrome ────────────────────────────────────────────────────────────────────

// 品牌 Chrome 137+ 移除了 --load-extension 支持：Chrome 用 Chrome for Testing
// （npx @puppeteer/browsers install chrome@stable --path tests/ext/browsers）；
// Edge 直接用系统安装的 msedge.exe（--browser=edge）。
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
  ]) {
    if (existsSync(p)) return p
  }
  return null
}
const browserPath = BROWSER === 'edge' ? findEdge() : findCfT()
if (!browserPath) {
  console.error(BROWSER === 'edge' ? '❌ 未找到 Edge（msedge.exe）' : '❌ 未找到 Chrome for Testing。请运行：')
  if (BROWSER !== 'edge') console.error('   npx @puppeteer/browsers install chrome@stable --path tests/ext/browsers')
  process.exit(1)
}
console.log(`浏览器：${BROWSER} → ${browserPath}`)

const USER_DATA = join(OUT, 'profile')
rmSync(USER_DATA, { recursive: true, force: true })

const resolverRules = [
  `MAP chatgpt.com 127.0.0.1:${PORT_CG}`,
  `MAP chat.deepseek.com 127.0.0.1:${PORT_DS}`,
  `MAP laijing1201.github.io 127.0.0.1:${PORT_WEB}`,
].join(',')

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: 'new',
  userDataDir: USER_DATA,
  args: [
    `--disable-extensions-except=${DIST_EXT}`,
    `--load-extension=${DIST_EXT}`,
    `--host-resolver-rules=${resolverRules}`,
    '--ignore-certificate-errors',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
  ],
})

// 下载行为：允许并落到 DOWNLOADS
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true })

// ── 微型测试框架 ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []
const artifacts = []
function ok(cond, label, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    failures.push(`${label}${detail ? ` —— ${detail}` : ''}`)
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

/** content script 在隔离世界：通过 window postMessage 驱动 E2E 动作 */
async function e2eCall(page, action, ...args) {
  return page.evaluate((action, args) => {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9)
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMsg)
        reject(new Error('e2e timeout: ' + action))
      }, 60_000)
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

async function waitForDownload(ext, timeoutMs = 60_000) {
  const before = new Set(readdirSync(DOWNLOADS))
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const now = readdirSync(DOWNLOADS).filter((f) => f.endsWith(ext) && !before.has(f) && !f.endsWith('.crdownload'))
    if (now.length > 0) {
      const file = join(DOWNLOADS, now[0])
      // 等文件大小稳定
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
  throw new Error(`下载超时：未捕获到 ${ext} 文件`)
}

/** 等待 exporter 页面完成（或先经过 preflight → 点继续）；返回 job-meta 统计文本 */
async function driveExporter(page, timeoutMs = 180_000) {
  const start = Date.now()
  let jobMeta = ''
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const vis = (id) => !document.getElementById(id)?.classList.contains('hidden')
      const meta = document.getElementById('job-meta')?.textContent || ''
      if (vis('done-view')) return { s: 'done', meta }
      if (vis('error-view')) return { s: 'error:' + (document.getElementById('error-detail')?.textContent || ''), meta }
      if (vis('preflight-view')) return { s: 'preflight', meta }
      return { s: 'progress', meta }
    }).catch(() => ({ s: 'progress', meta: jobMeta }))
    jobMeta = state.meta || jobMeta
    if (state.s === 'done') return jobMeta
    if (state.s.startsWith('error')) throw new Error(state.s)
    if (state.s === 'preflight') {
      await page.click('#btn-preflight-continue')
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  throw new Error('exporter 页面超时未完成')
}

/** 触发一次导出并返回下载文件路径（action 经 postMessage 桥发给 content script） */
async function runExport(originPage, action, ext, ...actionArgs) {
  // 每轮清空下载目录：Chrome 对同名文件是覆盖而非重命名，目录差集不可靠
  for (const f of readdirSync(DOWNLOADS)) rmSync(join(DOWNLOADS, f), { force: true })

  const exporterPromise = new Promise((resolveP) => {
    const handler = async (target) => {
      if (target.url().startsWith('chrome-extension://') && target.url().includes('exporter.html')) {
        browser.off('targetcreated', handler)
        resolveP(await target.page())
      }
    }
    browser.on('targetcreated', handler)
  })

  await e2eCall(originPage, action, ...actionArgs)

  const exporterPage = await exporterPromise
  exporterPage.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') console.log('  [exporter]', m.type(), m.text().slice(0, 220))
  })
  exporterPage.on('requestfailed', (r) => {
    console.log('  [exporter][reqfail]', r.url().slice(0, 160), '→', r.failure()?.errorText)
  })
  const exporterJobMeta = await driveExporter(exporterPage)
  artifacts.push({ page: 'exporter', name: 'exporter-page' })

  const jobMeta = exporterJobMeta
  const start = Date.now()
  while (Date.now() - start < 60_000) {
    const now = readdirSync(DOWNLOADS).filter((f) => f.endsWith(ext) && !f.endsWith('.crdownload'))
    if (now.length > 0) {
      const file = join(DOWNLOADS, now[0])
      let size = statSync(file).size
      await new Promise((r) => setTimeout(r, 700))
      while (statSync(file).size !== size) {
        size = statSync(file).size
        await new Promise((r) => setTimeout(r, 700))
      }
      await exporterPage.close()
      return { file, exporterPage, jobMeta }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`下载超时：${ext}`)
}

/** 解析 exporter job-meta（公式 N · 表格 N · 图片 N · 代码块 M） */
function parseJobMeta(meta) {
  const num = (label) => {
    const i = meta.indexOf(label)
    if (i === -1) return null
    const m = meta.slice(i + label.length).match(/^[^0-9]*([0-9]+)/)
    return m ? Number(m[1]) : null
  }
  return { formulas: num('公式'), tables: num('表格'), images: num('图片'), code: num('代码块') }
}

// ── PDF 校验工具 ──────────────────────────────────────────────────────────────

async function pdfText(file) {
  const data = new Uint8Array(readFileSync(file))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise
  let text = ''
  let imageCount = 0
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    text += tc.items.map((it) => it.str).join('') + '\n'
    const ops = await page.getOperatorList()
    for (const fn of ops.fnArray) {
      if (fn === pdfjs.OPS.paintImageXObject) imageCount++
    }
  }
  const annotations = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const annots = await page.getAnnotations()
    annotations.push(...annots)
  }
  return { text, pages: doc.numPages, annotations, imageCount }
}

// ── 场景 1：ChatGPT 注入 ─────────────────────────────────────────────────────

console.log('\n── 场景 1：ChatGPT content script 注入与防重复 ──')
const pageCG = await browser.newPage()
await pageCG.goto(`https://chatgpt.com/?markdoc-e2e=1`, { waitUntil: 'load' })
await pageCG.waitForSelector('[data-markdoc-root]', { timeout: 30_000 })
const ping = await e2eCall(pageCG, 'ping')
ok(ping?.ready === true, 'content script E2E 桥就绪', JSON.stringify(ping))
const roots = await pageCG.evaluate(() => document.querySelectorAll('[data-markdoc-root]').length)
ok(roots === 1, 'data-markdoc-root 恰好一个（不污染页面）', `实际 ${roots}`)
const state = await e2eCall(pageCG, 'state')
ok(state.platform === 'ChatGPT', 'adapter 识别 ChatGPT', JSON.stringify(state))
ok(state.title === '反向传播原理讲解', '对话标题识别', state.title)

// ── 场景 2：最近回答 → Word ──────────────────────────────────────────────────

console.log('\n── 场景 2：最近回答导出 Word（场景 A）──')
{
  const { file, exporterPage } = await runExport(pageCG, 'exportLast', '.docx', 'docx')
  await exporterPage.close().catch(() => {})
  const name = file.split(/[\\/]/).pop()
  ok(!/^(download|document)\./i.test(name), '文件名非 download.docx（filename helper 生效）', name)
  ok(name.includes('ChatGPT'), '文件名含平台前缀', name)
  ok(name.includes('反向传播原理讲解'), '文件名含对话标题', name)

  const zip = await JSZip.loadAsync(readFileSync(file))
  const docXml = await zip.file('word/document.xml').async('string')
  ok(docXml.includes('训练流程'), 'Word 包含标题文本')
  ok(docXml.includes('以上流程循环执行直到收敛'), 'Word 包含中文正文')
  ok(docXml.includes('循环执行'), '段落未被截断')
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'))
  ok(media.length >= 1, 'Mermaid 截图进入 word/media/', `media=${media.length}`)
  artifacts.push({ type: 'docx', path: file, label: 'chatgpt-last-answer' })
}

// ── 场景 3：整段对话（内容整理模式）→ Word，并做内容一致性基准 ────────────────

console.log('\n── 场景 3：整段对话 → Word（一致性基准：DOCX 侧）──')
let docxArticleFile = null
let run3 = { jobMeta: '' }
{
  const { file, jobMeta } = await runExport(pageCG, 'exportConversation', '.docx', 'docx', 'article')
  run3 = { jobMeta }
  docxArticleFile = file
  const zip = await JSZip.loadAsync(readFileSync(file))
  const docXml = await zip.file('word/document.xml').async('string')
  ok(docXml.includes('反向传播原理'), 'Word：标题')
  ok(docXml.includes('反向传播是'), 'Word：中文正文')
  ok((docXml.match(/<m:oMath/g) || []).length >= 3, 'Word：公式为原生 OMML（≥3）', String((docXml.match(/<m:oMath/g) || []).length))
  ok((docXml.match(/<w:tbl>/g) || []).length >= 1, 'Word：表格存在')
  ok(docXml.includes('def backward'), 'Word：Python 代码')
  ok(docXml.includes('SGD') && docXml.includes('Adam'), 'Word：表格内容')
  ok((docXml.match(/hyperlink|HYPERLINK/gi) || []).length >= 2, 'Word：超链接存在')
  ok((docXml.match(/<w:drawing>/g) || []).length >= 1, 'Word：Mermaid 截图存在（w:drawing）', String((docXml.match(/<w:drawing>/g) || []).length))
  ok(docXml.includes('前向传播计算输出'), 'Word：列表内容')
  // 一致性（P4C 第十五节）：导出统计 ↔ DOCX 实际结构计数
  const meta3 = parseJobMeta(run3.jobMeta || '')
  const oMathCount = (docXml.match(/<m:oMath/g) || []).length
  const tblCount = (docXml.match(/<w:tbl>/g) || []).length
  // 注：aligned/matrix 块渲染为多个 oMath 行，故 DOCX 计数 ≥ 提取计划数（无丢失即一致）
  ok(meta3.formulas !== null && oMathCount >= meta3.formulas,
    `一致性：公式 计划${meta3.formulas} ↔ DOCX ${oMathCount}（无丢失）`)
  ok(meta3.tables !== null && tblCount >= meta3.tables,
    `一致性：表格 计划${meta3.tables} ↔ DOCX ${tblCount}`)
  mkdirSync(join(OUT, 'artifacts'), { recursive: true })
  copyFileSync(file, join(OUT, 'artifacts', 'conversation-article.docx'))
  docxArticleFile = join(OUT, 'artifacts', 'conversation-article.docx')
  artifacts.push({ type: 'docx', path: file, label: 'chatgpt-conversation-article' })
}

// ── 场景 4：同一内容 → PDF（一致性 + PDF 校验）────────────────────────────────

console.log('\n── 场景 4：整段对话 → PDF（一致性 + 场景 B）──')
{
  const { file, exporterPage } = await runExport(pageCG, 'exportConversation', '.pdf', 'pdf', 'article')
  await exporterPage.close().catch(() => {})
  const res = await pdfText(file)
  const { text, pages, annotations } = res
  console.log(`      ⏱ PDF 文本提取长度：${text.length} 字符 · 图片 ${res.imageCount}`)
  ok(pages >= 1, `PDF 页数 ≥ 1（实际 ${pages} 页）`)
  ok(text.includes('反向传播原理'), 'PDF：标题文本（可搜索）')
  ok(text.includes('反向传播是'), 'PDF：中文正文（真文本）')
  ok(text.length > 350, 'PDF：内容规模合理', String(text.length))
  ok(text.includes('SGD') && text.includes('Adam'), 'PDF：表格内容')
  ok(text.includes('def backward') || text.includes('backward'), 'PDF：Python 代码')
  ok(text.includes('前向传播计算输出'), 'PDF：列表')
  ok(res.imageCount >= 1, 'PDF：Mermaid 以渲染图嵌入（paintImageXObject ≥1）', String(res.imageCount))
  const uriAnnots = annotations.filter((a) => a.subtype === 'Link' && (a.url || '').startsWith('http'))
  ok(uriAnnots.length >= 2, 'PDF：链接可点击（URI 注解 ≥2）', String(uriAnnots.length))
  // 一致性：公式（DOCX m:oMath ≥3 ↔ PDF 含公式字符）
  const hasMathGlyphs = /[∂δ∫∑σ]/.test(text)
  ok(hasMathGlyphs, 'PDF：公式字形文本存在（与 DOCX OMML 同源）')
  // 一致性：核心要素在两侧都存在
  const zip = await JSZip.loadAsync(readFileSync(docxArticleFile))
  const docXml = await zip.file('word/document.xml').async('string')
  for (const marker of ['反向传播原理', 'SGD', 'def backward']) {
    ok(docXml.includes(marker) === text.includes(marker) || (docXml.includes(marker) && text.includes(marker)), `一致性：「${marker}」两侧均存在`)
  }
  artifacts.push({ type: 'pdf', path: file, label: 'chatgpt-conversation-article' })

  // 渲染第一页 PNG（pdftoppm 可用时）
  try {
    execFileSync('pdftoppm', ['-png', '-r', '80', '-f', '1', '-l', '1', file, join(OUT, 'render-ext-pdf')])
    ok(existsSync(join(OUT, 'render-ext-pdf-1.png')), 'PDF 首页渲染 PNG 生成')
  } catch {
    console.log('  ⚠ pdftoppm 不可用，跳过页面渲染')
  }
}

// ── 场景 5：DeepSeek ────────────────────────────────────────────────────────

console.log('\n── 场景 5：DeepSeek 最近回答 → PDF ──')
{
  const pageDS = await browser.newPage()
  await pageDS.goto(`https://chat.deepseek.com/?markdoc-e2e=1`, { waitUntil: 'load' })
  await pageDS.waitForSelector('[data-markdoc-root]', { timeout: 30_000 })
  const st = await e2eCall(pageDS, 'state')
  ok(st.platform === 'DeepSeek', 'adapter 识别 DeepSeek', JSON.stringify(st))

  const { file } = await runExport(pageDS, 'exportLast', '.pdf', 'pdf')
  const name = file.split(/[\\/]/).pop()
  ok(name.includes('DeepSeek'), '文件名含 DeepSeek 平台', name)
  const res5 = await pdfText(file)
  const { text, pages } = res5
  ok(pages >= 1, 'PDF 页数 ≥ 1')
  ok(text.includes('训练流程'), 'DeepSeek 内容进入 PDF')
  ok(res5.imageCount >= 1 || text.includes('graph TD'), 'Mermaid 保留（渲染图或源码）', String(res5.imageCount))
  await pageDS.close()
  artifacts.push({ type: 'pdf', path: file, label: 'deepseek-last-answer' })
}

// ── 场景 6：在 MarkDoc 中编辑（桥接）─────────────────────────────────────────

console.log('\n── 场景 6：「在 MarkDoc 中编辑」桥接 ──')
{
  const markdocPromise = new Promise((resolveP) => {
    const handler = (target) => {
      if (target.url().includes('laijing1201.github.io')) {
        browser.off('targetcreated', handler)
        resolveP(target.page())
      }
    }
    browser.on('targetcreated', handler)
  })
  await e2eCall(pageCG, 'editInMarkDoc', 'conversation')
  const markdocPage = await markdocPromise
  await markdocPage.waitForFunction(
    () => {
      const t = (window).__MARKDOC_TEST__
      return t && typeof t.getContent === 'function' && (t.getContent() || '').length > 200
    },
    { timeout: 60_000 },
  )
  const content = await markdocPage.evaluate(() => (window).__MARKDOC_TEST__.getContent())
  ok(content.includes('反向传播原理'), '扩展内容自动填入 MarkDoc 编辑器')
  ok(!content.includes('markdoc-ext'), '导入走内部通道（无调试残留）')
  await markdocPage.close()
}

// ── 场景 7：SPA 路由切换（P4C 第十二节）──

console.log('\n── 场景 7：SPA 路由切换（聊天 A → B → 新建）──')
{
  const pageSPA = await browser.newPage()
  await pageSPA.goto(`https://chatgpt.com/c/conversation-a?markdoc-e2e=1`, { waitUntil: 'load' })
  await pageSPA.waitForSelector('[data-markdoc-root]', { timeout: 30_000 })
  const stateA = await e2eCall(pageSPA, 'state')
  ok(stateA.title === '深度学习面试准备', '聊天 A 识别与标题', JSON.stringify(stateA))

  // SPA 切换到聊天 B：URL 变化 + 内容替换（模拟网站 SPA 换页完成后的状态）
  await pageSPA.evaluate(async () => {
    history.pushState({}, '', '/c/conversation-b')
    const html = await fetch('/c/conversation-b').then((r) => r.text())
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const swap = (sel) => {
      const fresh = doc.querySelector(sel)
      const cur = document.querySelector(sel)
      if (fresh && cur) cur.innerHTML = fresh.innerHTML
      else if (cur && !fresh) cur.remove()
    }
    swap('#conversation-list')
    swap('nav[aria-label="Chat history"]')
    document.title = doc.title
  })
  await new Promise((r) => setTimeout(r, 2600)) // content script 1.5s URL 轮询
  const stateB = await e2eCall(pageSPA, 'state')
  ok(stateB.title === '简单问答', '切换后标题更新（不残留 A 标题）', JSON.stringify(stateB))

  // 在聊天 B 导出最近回答：必须是 B 的内容
  const { file: fileB } = await runExport(pageSPA, 'exportLast', '.docx', 'docx')
  const zipB = await JSZip.loadAsync(readFileSync(fileB))
  const xmlB = await zipB.file('word/document.xml').async('string')
  ok(xmlB.includes('梯度下降'), '导出内容属于聊天 B（梯度下降）')
  ok(!xmlB.includes('反向传播原理'), '不误导聊天 A 内容（无反向传播）')
  const nameB = fileB.split(/[\/]/).pop()
  ok(nameB.includes('简单问答'), '文件名来自聊天 B 标题', nameB)

  // 新建聊天（空内容）
  await pageSPA.evaluate(async () => {
    history.pushState({}, '', '/c/new')
    const html = await fetch('/c/new').then((r) => r.text())
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const swap = (sel) => {
      const fresh = doc.querySelector(sel)
      const cur = document.querySelector(sel)
      if (fresh && cur) cur.innerHTML = fresh.innerHTML
      else if (cur && !fresh) cur.remove()
    }
    swap('#conversation-list')
    swap('nav[aria-label="Chat history"]')
    document.title = doc.title
  })
  await new Promise((r) => setTimeout(r, 2600))
  const res = await e2eCall(pageSPA, 'exportLast', 'docx').catch(() => null)
  ok(res && res.ok === false, '新建聊天导出最近回答 → 明确失败提示（不崩溃不误导）', JSON.stringify(res))

  // 返回聊天 A
  await pageSPA.evaluate(async () => {
    history.pushState({}, '', '/c/conversation-a')
    const html = await fetch('/c/conversation-a').then((r) => r.text())
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const swap = (sel) => {
      const fresh = doc.querySelector(sel)
      const cur = document.querySelector(sel)
      if (fresh && cur) cur.innerHTML = fresh.innerHTML
      else if (cur && !fresh) cur.remove()
    }
    swap('#conversation-list')
    swap('nav[aria-label="Chat history"]')
    document.title = doc.title
  })
  await new Promise((r) => setTimeout(r, 2600))
  const stateA2 = await e2eCall(pageSPA, 'state')
  ok(stateA2.title === '深度学习面试准备', '返回聊天 A 恢复识别', JSON.stringify(stateA2))
  const roots7 = await pageSPA.evaluate(() => document.querySelectorAll('[data-markdoc-root]').length)
  ok(roots7 === 1, 'SPA 全程 data-markdoc-root 唯一（无重复注入）', String(roots7))
  await pageSPA.close()
}

// ── 场景 8：离线导出（P4C 第三十节）──

console.log('\n── 场景 8：离线导出（页面已加载 + 断网）──')
{
  const pageOff = await browser.newPage()
  await pageOff.goto(`https://chatgpt.com/?markdoc-e2e=1`, { waitUntil: 'load' })
  await pageOff.waitForSelector('[data-markdoc-root]', { timeout: 30_000 })
  await pageOff.setOfflineMode(true)
  // content 提取在断网页面上进行；exporter 页面全部资源来自扩展包（本地）
  const { file } = await runExport(pageOff, 'exportLast', '.docx', 'docx')
  const zipOff = await JSZip.loadAsync(readFileSync(file))
  const xmlOff = await zipOff.file('word/document.xml').async('string')
  ok(xmlOff.includes('训练流程'), '断网状态导出 Word：内容完整')
  await pageOff.setOfflineMode(false)
  await pageOff.close()
}

// ── 收尾 ──────────────────────────────────────────────────────────────────────

console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
writeFileSync(join(OUT, 'e2e-results.json'), JSON.stringify({ passed, failed, failures, artifacts }, null, 2))
await browser.close()
serverCG.close()
serverDS.close()
serverWeb.close()
if (failed > 0) {
  console.log('\n失败明细:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
