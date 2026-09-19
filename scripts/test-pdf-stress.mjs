/**
 * PDF 导出压力测试（任务 P4A-三十）：
 *   ≥50,000 字符 · 100 个数学公式 · 20 个表格 · 20 张图片 · 10 个代码块
 *   多级标题 · 目录 · 分页符
 *
 * 记录：生成耗时（阶段化）、PDF 大小、页数。重点发现明显性能问题。
 *
 * 运行：node scripts/test-pdf-stress.mjs
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'
import { mkdirSync, existsSync, readdirSync, statSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const ROOT = resolve('.')
const PORT = 4398

function findBrowser() {
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ]) {
    if (existsSync(p)) return p
  }
  throw new Error('no browser')
}

// ── 构造压力文档 ─────────────────────────────────────────────────────────────

const FORMULAS = [
  '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
  '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
  '\\frac{d}{dx}\\left( e^x \\right) = e^x',
  '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
  '\\begin{cases} x^2, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}',
  'E = mc^2',
  '\\alpha^2 + \\beta^2 = \\gamma^2',
  '\\prod_{i=1}^{n} a_i',
  '\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}',
]

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function buildStressDoc() {
  const parts = []
  parts.push('# MarkDoc PDF 压力测试文档\n')
  parts.push('这是一份用于性能压测的综合文档，包含超大文本量、公式、表格、图片和代码。The quick brown fox jumps over the lazy dog. 0123456789.\n')

  // 多级标题 + 大量正文（目标 ≥ 50000 字符）
  let chars = 0
  for (let s = 1; s <= 8; s++) {
    parts.push(`## 第 ${s} 章 压力测试章节\n`)
    parts.push('$$' + FORMULAS[s % FORMULAS.length] + '$$\n')
    for (let sec = 1; sec <= 4; sec++) {
      parts.push(`### ${s}.${sec} 小节标题，用于验证多级标题与目录层级\n`)
      // 每小节 ~1500 字符正文
      const para = '中文正文段落，中英文混排 mixed content with numbers ' + (s * 100 + sec) + '，验证两端对齐与分页稳定性。The quick brown fox jumps over the lazy dog. '.repeat(8)
      for (let p2 = 0; p2 < 8; p2++) {
        parts.push(para + '\n')
        chars += para.length
      }
      // 10 个代码块分散
      if (sec <= 2) {
        parts.push('```python\ndef stress_' + s + sec + '(arr):\n    return sorted(arr, key=lambda x: -x)\n\n' + '    # 深度嵌套测试\n'.repeat(3) + '```\n')
        parts.push('```javascript\nfunction stress' + s + sec + '(x) { return x * ' + (s + sec) + '; }\n```\n')
      }
    }
    // 20 个表格（每章 2-3 个，每个 ~8 行）
    for (let t = 0; t < 3; t++) {
      parts.push('\n| 列A | 列B | 列C | 列D |\n|-----|-----|-----|-----|\n')
      for (let r = 1; r <= 8; r++) {
        parts.push(`| ${s}-${t}-${r} | 数据 ${r} | ${(r * 7) % 100}% | 备注 ${s}${t}${r} |\n`)
      }
      parts.push('\n')
    }
    // 20 张图片（小 SVG data URI）
    for (let im = 0; im < 2; im++) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="240" height="60" fill="#3366cc"/><text x="120" y="38" font-size="20" fill="white" text-anchor="middle">图 ${s}-${im}</text></svg>`
      parts.push(`![压测图](data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')})\n`)
    }
    // 100 个公式（每章 ~12 个行内公式）
    const inline = FORMULAS.map((f) => `$${f}$`).join(' 与 ')
    parts.push(inline + '\n')
    parts.push('<!-- pagebreak -->\n')
  }
  parts.push('## 结束章节\n\n压力测试结束。\n')
  return { md: parts.join('\n'), approxChars: chars }
}

async function main() {
  mkdirSync('tests/pdf/out', { recursive: true })
  const { md, approxChars } = buildStressDoc()
  console.log(`文档规模：约 ${md.length} 字符（正文 ${approxChars}），公式 ≈ 100+，表格 24，图片 16，代码块 32，分页符 8`)

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', join(ROOT, 'dist')], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 1200))

  const OUT = join(ROOT, 'tests/pdf/out')
  try {
    const page = await browser.newPage()
    const cdp = await page.createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT })
    page.on('console', async (m) => {
      const t = m.type()
      if (t === 'error' || t === 'warn') console.log('  [page]', (await Promise.all(m.args().map(async (a) => {
        try { return await a.jsonValue().then((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))) } catch { return a.toString() }
      }))).join(' ').slice(0, 200))
    })
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForFunction('window.__MARKDOC_TEST__?.ready', { timeout: 15000 })

    const t0 = Date.now()
    await page.evaluate((md) => window.__MARKDOC_TEST__.setContent(md), md)
    // 等待预览渲染完成（公式 + mermaid 无，等 katex）
    await page.waitForFunction(() => {
      const el = document.getElementById('preview-container')
      if (!el) return false
      const mathEls = el.querySelectorAll('.math-inline, .math-block')
      for (const m of mathEls) if (!m.querySelector('.katex') && !m.textContent.startsWith('$')) return false
      return mathEls.length > 0
    }, { timeout: 120000 })
    const tPrepared = Date.now()
    console.log(`内容渲染（预览就绪）：${((tPrepared - t0) / 1000).toFixed(1)}s`)

    const before = readdirSync(OUT)
    const btn = await page.waitForSelector('::-p-text(导出 PDF)')
    await btn.click()
    await new Promise((r) => setTimeout(r, 1500))
    const confirm = await page.$('::-p-text(仍要导出PDF)')
    if (confirm) {
      console.log('（预检弹窗 → 仍要导出）')
      await confirm.click()
    }
    // 等待下载
    let file = null
    const start = Date.now()
    while (Date.now() - start < 300000) {
      const files = readdirSync(OUT).filter((f) => f.endsWith('.pdf') && !before.includes(f))
      if (files.length) {
        const p = join(OUT, files[0])
        let last = -1
        for (let i = 0; i < 25; i++) {
          const size = statSync(p).size
          if (size > 0 && size === last) { file = p; break }
          last = size
          await new Promise((r) => setTimeout(r, 400))
        }
        if (file) break
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!file) throw new Error('下载超时')
    const tExport = Date.now()

    const finalPath = join(OUT, 'caseI-stress.pdf')
    rmSync(finalPath, { force: true })
    const raw = readFileSync(file)
    writeFileSync(finalPath, raw)
    rmSync(file, { force: true })

    const sizeKB = statSync(finalPath).size / 1024
    console.log(`\n═══ 压力测试结果 ═══`)
    console.log(`导出总耗时（含预览渲染）: ${((tExport - t0) / 1000).toFixed(1)}s`)
    console.log(`PDF 大小: ${sizeKB.toFixed(0)} KB`)
    const data = new Uint8Array(raw)
    const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise
    console.log(`页数: ${doc.numPages}`)
    const p1 = await doc.getPage(1)
    const tc = await p1.getTextContent()
    const text1 = tc.items.map((i) => i.str).join('')
    console.log(`首页含标题: ${text1.includes('压力测试文档') ? '✓' : '✗'}`)
    // 全文提取抽样
    let ok = 0
    for (const key of ['压力测试章节', 'def stress_1', 'The quick brown fox']) {
      let found = false
      for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
        const pp = await doc.getPage(i)
        const t = (await pp.getTextContent()).items.map((x) => x.str).join('')
        if (t.includes(key)) { found = true; break }
      }
      if (found) ok++
      else console.log(`  ✗ 未找到「${key}」`)
    }
    console.log(`文本抽查: ${ok}/3`)
    console.log(`\n判定: 页数=${doc.numPages} 大小=${sizeKB.toFixed(0)}KB 耗时=${((tExport - t0) / 1000).toFixed(1)}s → ${doc.numPages > 20 && sizeKB < 20000 ? '通过（无明显性能问题）' : '关注'}`)
  } finally {
    server.kill()
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
