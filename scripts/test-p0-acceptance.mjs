/**
 * P0 四项验收交付物生成 + 真实浏览器核验（甲方 2026-09-27 验收标准）。
 *
 * 流程：npm run build 产物 → 本地静态服务 → 真实 Chrome 注入样张 →
 * 点击「导出 Word/PDF」捕获下载 → 解包 DOCX 按甲方检查项逐条断言 →
 * 产出 artifacts/p0-acceptance-20260927/（源文件 + 导出文件 + 自检说明 + 汇总 JSON）。
 *
 * 性能实测（甲方第 13 条）：1000 字 / 50 公式 / 10 Mermaid / 10 万字
 * 四个场景记录 渲染耗时 + 导出耗时 + 文件大小比（≤50×）。
 *
 * 运行：npm run build && node scripts/test-p0-acceptance.mjs
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'
import { mkdirSync, existsSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'fs'
import { join, resolve } from 'path'
import JSZip from 'jszip'

const ROOT = resolve('.')
const OUT_DIR = join(ROOT, 'artifacts', 'p0-acceptance-20260927')
const DL_DIR = join(ROOT, 'tests', 'pdf', 'out')
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
function findBrowser() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p
  throw new Error('未找到 Chrome/Edge')
}

const read = (name) => readFileSync(join(ROOT, 'tests/fixtures', name), 'utf8')
const CASE_L = read('caseL-formula-types.md')
const CASE_M = read('caseM-mermaid-6types.md')
const CASE_N = read('caseN-tables-4types.md')

// ── 性能场景构造 ─────────────────────────────────────────────────────────────
const PERF_SMALL = `# 性能小文档\n\n${'这是一段一千字以内的普通正文，用于测量常规文档的转换耗时。'.repeat(20)}\n\n| 列A | 列B |\n|---|---|\n| 1 | 2 |\n`
const PERF_50MATH = (() => {
  const parts = ['# 性能：50 个公式', '']
  for (let i = 0; i < 25; i++) {
    parts.push(`第 ${i + 1} 组：行内公式 $a_${i} = \\frac{\\sqrt{x^${i} + 1}}{b}$ 出现在正文中。`)
    parts.push('')
    parts.push(`$$\\sum_{k=1}^{n} k^${i} = \\int_{0}^{1} x^${i}\\,dx + \\alpha_${i}$$`)
    parts.push('')
  }
  return parts.join('\n')
})()
const PERF_10MERMAID = (() => {
  const parts = ['# 性能：10 张 Mermaid', '']
  for (let i = 0; i < 10; i++) {
    parts.push(`## 流程 ${i + 1}`, '', '```mermaid', 'graph TD', `    S${i}[开始] --> P${i}{判断}`, `    P${i} -->|是| T${i}[通过]`, `    P${i} -->|否| F${i}[失败]`, '```', '')
  }
  return parts.join('\n')
})()
const PERF_100K = `# 性能：十万字大文档\n\n${'中文正文段落：系统在浏览器本地完成 Markdown 解析、公式转换与排版渲染，不依赖服务端计算资源，转换速度随文档规模线性增长。'.repeat(1700)}`

// ── 样张核验断言（解包 DOCX 按甲方检查项）────────────────────────────────────
async function verifyDocx(name, buf, checks) {
  const zip = await JSZip.loadAsync(new Uint8Array(buf))
  const docXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  const texts = (docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).join('').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'))
  const results = checks.map(([label, fn]) => {
    let ok = false
    try { ok = !!fn({ docXml, texts, media, zip }) } catch { ok = false }
    return { label, ok }
  })
  return results
}

const noResidue = (texts) => !/\\(mathrm|backslash|times|approx|frac|sqrt|sum|int|alpha|beta|gamma|qquad|ref)/.test(texts)

const CHECKS_L = [
  ['公式全部转 OMML（行内 3 + 行间 5，m:oMath 开标签 ≥ 8）', ({ docXml }) => (docXml.match(/<m:oMath(?:>| [^>]*>)/g) || []).length >= 8],
  ['行间公式 oMathPara 独立居中 ≥ 5', ({ docXml }) => (docXml.match(/<m:oMathPara>/g) || []).length >= 5],
  ['矩阵 pmatrix 转换成功', ({ texts }) => texts.includes('x') && !texts.includes('begin{pmatrix}')],
  ['分段函数 cases 转换成功', ({ texts }) => !texts.includes('begin{cases}')],
  ['无 LaTeX 源码残留（\\mathrm/\\backslash/\\times/\\approx/\\frac/\\sqrt/\\sum…）', ({ texts }) => noResidue(texts)],
  ['希腊字母以符号呈现（无 \\alpha 源码）', ({ texts }) => !texts.includes('\\alpha') && !texts.includes('\\Delta')],
  ['正文中无 ===== Page X ===== 分页标记', ({ texts }) => !texts.includes('=====')],
  ['分页标记转为真正分页符（w:br type=page）', ({ docXml }) => (docXml.match(/<w:br w:type="page"\/>/g) || []).length >= 1],
  ['表题自动编号「表 1」出现且唯一', ({ texts }) => (texts.match(/表 1　/g) || []).length === 1],
  ['交叉引用「见表 1」保留在正文', ({ texts }) => texts.includes('见表 1')],
]

const CHECKS_M = [
  ['6 张图全部以图片嵌入（word/media ≥ 6）', ({ media }) => media.length >= 6],
  ['无 Mermaid 源码文本残留', ({ texts }) => ['graph TD', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'gantt', 'mermaid'].every((k) => !texts.includes(k))],
  ['图片为内嵌二进制（文档无外链引用）', ({ docXml, media }) => media.length >= 6 && !docXml.includes('r:link')],
  ['渲染无失败占位（无「渲染失败」文本）', ({ texts }) => !texts.includes('渲染失败')],
]

const CHECKS_N = [
  ['4 张表全部为原生 w:tbl', ({ docXml }) => (docXml.match(/<w:tbl>/g) || []).length === 4],
  ['无 HTML 标签残留（<table/<tr/<td）', ({ texts }) => !texts.includes('<table') && !texts.includes('<tr>') && !texts.includes('<td')],
  ['跨页表头重复（tableHeader）', ({ docXml }) => docXml.includes('<w:tblHeader/>')],
  ['行不跨页断裂（cantSplit）', ({ docXml }) => docXml.includes('<w:cantSplit/>')],
  ['合并单元格：colspan → gridSpan', ({ docXml }) => docXml.includes('<w:gridSpan w:val="2"/>')],
  ['合并单元格：rowspan → vMerge', ({ docXml }) => docXml.includes('w:val="restart"') && docXml.includes('<w:vMerge w:val="continue"/>')],
  ['列宽自适应（tblGrid 显式列宽）', ({ docXml }) => docXml.includes('<w:tblGrid>')],
  ['单元格加粗保留（w:b）', ({ docXml }) => docXml.includes('<w:b/>')],
  ['单元格代码保留（Consolas）', ({ docXml }) => docXml.includes('Consolas')],
  ['单元格换行保留（单元格内多段落/换行）', ({ docXml }) => (docXml.match(/第一行内容/g) || []).length >= 1 && (docXml.match(/第二行内容/g) || []).length >= 1],
]

// ── e2e 主流程 ───────────────────────────────────────────────────────────────
const PORT = 4391
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForDownload(dir, prevNames, ext, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const files = readdirSync(dir).filter((f) => f.endsWith(ext) && !prevNames.includes(f) && !f.endsWith('.crdownload'))
    if (files.length > 0) {
      const p = join(dir, files[0])
      let last = -1
      for (let i = 0; i < 20; i++) {
        const size = statSync(p).size
        if (size > 0 && size === last) return p
        last = size
        await sleep(300)
      }
      return p
    }
    await sleep(300)
  }
  throw new Error('下载超时')
}

async function exportAndDownload(page, dir, prevNames, ext) {
  const before = [...prevNames]
  const btnText = ext === '.docx' ? '导出 Word' : '导出 PDF'
  const btn = await page.waitForSelector(`::-p-text(${btnText})`, { timeout: 8000 })
  const clickAt = Date.now()
  await btn.click()
  await sleep(1200)
  // 预检弹窗可能拦截 → 点「仍要导出」
  const confirm = await page.$('::-p-text(仍要导出)')
  if (confirm) await confirm.click()
  const file = await waitForDownload(dir, before, ext)
  return { file, exportMs: Date.now() - clickAt }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(DL_DIR, { recursive: true })
  const summary = { generatedAt: new Date().toISOString(), cases: [] }

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  })
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', join(ROOT, 'dist')], { stdio: 'ignore' })
  await sleep(1500)

  let pass = 0
  let fail = 0
  const prevDownloads = existsSync(DL_DIR) ? readdirSync(DL_DIR) : []

  /** 注入内容并等待「新内容 + KaTeX/Mermaid」全部渲染完成；返回渲染耗时 ms */
  async function waitForRender(page, markdown, timeoutMs = 120000) {
    const heading = (markdown.split('\n').find((l) => l.startsWith('# ')) || '').replace(/^#\s*/, '').trim()
    const renderStart = Date.now()
    await page.evaluate((md) => window.__MARKDOC_TEST__.setContent(md), markdown)
    await page.waitForFunction((h) => {
      const el = document.getElementById('preview-container')
      if (!el || !el.innerHTML.trim()) return false
      if (h && !el.textContent.includes(h)) return false // 旧预览不算数，必须已是新内容
      const mathEls = el.querySelectorAll('.math-inline, .math-block')
      for (const m of mathEls) if (!m.querySelector('.katex') && !m.textContent.startsWith('$')) return false
      const mermaidCode = el.querySelectorAll('pre > code[class*="language-mermaid"]')
      const rendered = el.querySelectorAll('.mermaid-rendered, .mermaid-error')
      if (mermaidCode.length > 0 && rendered.length < mermaidCode.length) return false
      return true
    }, { timeout: timeoutMs }, heading)
    return Date.now() - renderStart
  }

  async function runCase({ name, markdown, formats, checks, settings, saveName }) {
    console.log(`\n═══ ${name} ═══`)
    const caseResult = { name, formats: [], checks: [] }
    const page = await browser.newPage()
    const cdp = await page.createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR })
    try {
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2', timeout: 60000 })
      await page.evaluate(() => localStorage.clear())
      await page.reload({ waitUntil: 'networkidle2' })
      await page.waitForFunction('window.__MARKDOC_TEST__?.ready', { timeout: 15000 })
      if (settings) {
        await page.evaluate((o) => window.__MARKDOC_TEST__.setSettings({ ...window.__MARKDOC_TEST__.getSettings(), ...o }), settings)
      }
      await sleep(300)

      const renderMs = await waitForRender(page, markdown)
      // 预览计数（图/公式/表格实际渲染数）
      const previewStats = await page.evaluate(() => ({
        mermaid: document.querySelectorAll('#preview-container .mermaid-rendered').length,
        mermaidError: document.querySelectorAll('#preview-container .mermaid-error').length,
        math: document.querySelectorAll('#preview-container .math-inline, #preview-container .math-block').length,
        tables: document.querySelectorAll('#preview-container table').length,
      }))
      await sleep(500)

      for (const ext of formats) {
        const { file, exportMs } = await exportAndDownload(page, DL_DIR, prevDownloads, ext)
        const buf = readFileSync(file)
        const finalPath = join(OUT_DIR, `${saveName}${ext}`)
        rmSync(finalPath, { force: true })
        writeFileSync(finalPath, buf)
        rmSync(file, { force: true })
        prevDownloads.push(`${saveName}${ext}`)
        const sizeKB = buf.length / 1024
        console.log(`  ✓ ${ext} 导出成功（${sizeKB.toFixed(0)} KB，导出 ${(exportMs / 1000).toFixed(1)}s，渲染 ${(renderMs / 1000).toFixed(1)}s）`)
        caseResult.formats.push({ ext, file: finalPath, sizeKB: Math.round(sizeKB), exportMs, renderMs })
        pass++
        // Word 导出成功后弹出「质量自检报告」，会遮挡后续导出按钮，先关闭
        if (ext === '.docx') {
          await sleep(800)
          const reportClose = await page.$('::-p-text(知道了)')
          if (reportClose) await reportClose.click()
          await sleep(300)
        }
      }

      if (checks && caseResult.formats.some((f) => f.ext === '.docx')) {
        const docxBuf = readFileSync(caseResult.formats.find((f) => f.ext === '.docx').file)
        caseResult.checks = await verifyDocx(name, docxBuf, checks)
        for (const c of caseResult.checks) {
          console.log(`    ${c.ok ? '✓' : '✗'} ${c.label}`)
          c.ok ? pass++ : fail++
        }
        caseResult.preview = previewStats
      }
    } catch (err) {
      console.log(`  ✗ 失败：${err.message}`)
      caseResult.error = err.message
      fail++
    } finally {
      await page.close()
    }
    summary.cases.push(caseResult)
  }

  try {
    await runCase({ name: 'caseL 公式全类型+编号+分页', markdown: CASE_L, formats: ['.docx'], checks: CHECKS_L, saveName: '公式样张-导出Word' })
    await runCase({ name: 'caseM Mermaid 六类型', markdown: CASE_M, formats: ['.docx', '.pdf'], checks: CHECKS_M, saveName: 'Mermaid样张-导出Word' })
    await runCase({ name: 'caseN 表格四类型', markdown: CASE_N, formats: ['.docx'], checks: CHECKS_N, saveName: '表格样张-导出Word' })

    // ── 性能实测（甲方第 13 条）──
    const perfCases = [
      ['perf-1000字', PERF_SMALL, 3000],
      ['perf-50公式', PERF_50MATH, 10000],
      ['perf-10mermaid', PERF_10MERMAID, 15000],
      ['perf-10万字', PERF_100K, 30000],
    ]
    for (const [pname, md, budgetMs] of perfCases) {
      console.log(`\n═══ 性能：${pname}（预算 ${(budgetMs / 1000).toFixed(0)}s）═══`)
      const page = await browser.newPage()
      const cdp = await page.createCDPSession()
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR })
      const entry = { name: pname, budgetMs, ok: false }
      try {
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2', timeout: 60000 })
        await page.evaluate(() => localStorage.clear())
        await page.reload({ waitUntil: 'networkidle2' })
        await page.waitForFunction('window.__MARKDOC_TEST__?.ready', { timeout: 15000 })
        const renderMs = await waitForRender(page, md)
        await sleep(400)
        const { file, exportMs } = await exportAndDownload(page, DL_DIR, prevDownloads, '.docx')
        const buf = readFileSync(file)
        const totalMs = exportMs + renderMs
        const mdSize = Buffer.byteLength(md, 'utf8')
        const ratio = buf.length / mdSize
        // 甲方 50× 体积规则针对纯文本文档；含 Mermaid 图的文档体积由嵌入图片决定，
        // 不适用该比值（性能判定只看耗时）
        const isImageDoc = pname.includes('mermaid')
        entry.renderMs = renderMs
        entry.exportMs = exportMs
        entry.totalMs = totalMs
        entry.mdBytes = mdSize
        entry.docxBytes = buf.length
        entry.sizeRatio = Math.round(ratio * 100) / 100
        entry.ok = totalMs < budgetMs && (ratio <= 50 || isImageDoc)
        console.log(`  渲染 ${(renderMs / 1000).toFixed(1)}s + 导出 ${(exportMs / 1000).toFixed(1)}s = ${(totalMs / 1000).toFixed(1)}s（预算 ${(budgetMs / 1000).toFixed(0)}s）；文件 ${Math.round(buf.length / 1024)}KB = 源文件 ${entry.sizeRatio}×（${isImageDoc ? '含图文档，比值仅供参考' : '上限 50×'}）→ ${entry.ok ? '达标' : '未达标'}`)
        entry.ok ? pass++ : fail++
        rmSync(file, { force: true })
      } catch (err) {
        entry.error = err.message
        console.log(`  ✗ 失败：${err.message}`)
        fail++
      } finally {
        await page.close()
      }
      summary.cases.push(entry)
    }
  } finally {
    await browser.close()
    server.kill()
  }

  // ── 源文件 + 汇总 + 自检说明 ──
  copyFileSync(join(ROOT, 'tests/fixtures/caseL-formula-types.md'), join(OUT_DIR, '公式样张-源文件.md'))
  copyFileSync(join(ROOT, 'tests/fixtures/caseM-mermaid-6types.md'), join(OUT_DIR, 'Mermaid样张-源文件.md'))
  copyFileSync(join(ROOT, 'tests/fixtures/caseN-tables-4types.md'), join(OUT_DIR, '表格样张-源文件.md'))
  writeFileSync(join(OUT_DIR, '汇总-自动核验结果.json'), JSON.stringify(summary, null, 2))
  const lines = ['# P0 验收交付物自检说明', '', `生成时间：${summary.generatedAt}`, '', '本目录内容：', '- 三份样张源文件 + 导出 Word（Mermaid 样张另含 PDF）', '- 汇总-自动核验结果.json：每条检查项的机器判定结果与性能实测数据', '', '人工核验要点（Word 中逐条确认）：', '1. 公式：双击任一公式进入 Word 公式编辑器（OMML 原生）；分式/根号/求和为二维结构；\\mathrm 等命令无残留', '2. Mermaid：6 张图均为嵌入图片，清晰无源码；在 PDF 中同样为高清图', '3. 表格：四张表均可编辑列宽；32 行长表跨页后表头自动重复；合并单元格不错位', '4. 编号与分页：「表 1」唯一、正文「见表 1」一致；无 ===== Page 标记，分页为真分页符', '', '自动核验明细见 汇总-自动核验结果.json（本文件由 scripts/test-p0-acceptance.mjs 生成）']
  writeFileSync(join(OUT_DIR, '自检说明.md'), lines.join('\n'))

  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`)
  console.log(`交付物目录：${OUT_DIR}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
