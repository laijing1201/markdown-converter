/**
 * PDF 导出产物验证（配合 test-pdf-e2e.mjs 的输出）：
 *
 *   1. 文件头 / pdfinfo：页数、页面尺寸（A4/Letter、横竖向）
 *   2. pdfjs 文本提取：必须包含关键中英文文本（证明是真文本而非栅格化图片）
 *   3. pdfjs 注解：超链接 / 目录跳转
 *   4. pdftoppm 渲染每页为 PNG：检查空白页/黑块，输出给人工/视觉回归
 *
 * 运行：node scripts/test-pdf-verify.mjs
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'fs'
import { join, resolve, basename } from 'path'
import { execFileSync } from 'child_process'

const ROOT = resolve('.')
const OUT = join(ROOT, 'tests/pdf/out')

const EXPECTATIONS = {
  'caseA-basic.pdf': {
    pages: { min: 1 },
    sizePt: { w: 595.28, h: 841.89 },
    text: ['人工智能发展简报', '研究背景', 'English paragraph mixing', '无序列表第一项', '有序列表一', '已完成任务', '引用块', 'OpenAI 链接', '结束'],
    links: { minUri: 2 },
    containsToc: false,
  },
  'caseB-math-heavy.pdf': {
    pages: { min: 1 },
    sizePt: { w: 595.28, h: 841.89 },
    text: ['数学公式测试', '质能方程', '块级公式', '矩阵', '分段函数', '希腊字母'],
    links: { minUri: 0 },
  },
  'caseC-table-heavy.pdf': {
    pages: { min: 2 },
    sizePt: { w: 595.28, h: 841.89 },
    text: ['30 行表格测试', '以下表格用于验证表格跨页', 'Model-1', 'Model-32', '测试行数据 32'],
    links: { minUri: 0 },
  },
  'caseD-code-mermaid-image.pdf': {
    pages: { min: 1 },
    sizePt: { w: 595.28, h: 841.89 },
    text: ['代码与图表综合测试', 'quicksort', 'veryLongLine', 'Mermaid 流程图', 'greet', '自动换行策略'],
    links: { minUri: 0 },
  },
  'caseE-academic.pdf': {
    pages: { min: 1 },
    sizePt: { w: 595.28, h: 841.89 },
    text: ['基于深度学习的文本分类研究', '摘要', '研究背景', '1.1', '实验结果', '参考文献', '目', '录'],
    links: { minDest: 1 },
    containsToc: true,
  },
  'caseF-landscape-letter.pdf': {
    pages: { min: 1 },
    sizePt: { w: 792, h: 612 }, // Letter 横向 = 11in×8.5in = 792×612pt
    sizePtTolerance: 3,
    text: ['横向 Letter 测试', '第二节', '项目一'],
    links: { minUri: 0 },
  },
  'caseG-pagebreak.pdf': {
    pages: { exact: 3 },
    sizePt: { w: 595.28, h: 841.89 },
    text: ['分页符测试', '第一页的内容', '第二页的内容', '第三页内容'],
    links: { minUri: 0 },
    pageTextChecks: [
      { page: 1, contains: '第一页的内容', notContains: '第二页的内容' },
      { page: 2, contains: '第二页的内容', notContains: '第三页内容' },
      { page: 3, contains: '第三页内容' },
    ],
  },
  'caseH-long-doc.pdf': {
    pages: { min: 5 },
    sizePt: { w: 595.28, h: 841.89 },
    text: ['超长文档压力测试', '中间章节', '结束章节', 'The quick brown fox'],
    links: { minUri: 0 },
  },
}

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
    fail++
  }
}

async function verifyOne(filename, exp) {
  console.log(`\n═══ ${filename} ═══`)
  const path = join(OUT, filename)
  if (!existsSync(path)) {
    check('文件存在', false, path)
    return
  }
  const sizeKB = statSync(path).size / 1024
  check(`文件头 %PDF-`, readFileSync(path).subarray(0, 5).toString('latin1') === '%PDF-')
  check(`体积合理（${sizeKB.toFixed(0)}KB < 8000KB）`, sizeKB < 8000)

  const data = new Uint8Array(readFileSync(path))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise
  const info = await doc.getMetadata()

  // 页数
  if (exp.pages.exact !== undefined) check(`页数 = ${exp.pages.exact}`, doc.numPages === exp.pages.exact, `实际 ${doc.numPages}`)
  else check(`页数 ≥ ${exp.pages.min}`, doc.numPages >= exp.pages.min, `实际 ${doc.numPages}`)

  // 页面尺寸
  const p1 = await doc.getPage(1)
  const [x1, y1, w, h] = p1.view
  const tol = exp.sizePtTolerance ?? 1
  check(
    `页面尺寸 ${exp.sizePt.w}×${exp.sizePt.h} pt`,
    Math.abs(w - exp.sizePt.w) <= tol && Math.abs(h - exp.sizePt.h) <= tol,
    `实际 ${w.toFixed(1)}×${h.toFixed(1)}`,
  )

  // 全文提取
  const pageTexts = []
  let fullText = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const t = tc.items.map((it) => it.str).join('')
    pageTexts.push(t)
    fullText += '\n' + t
  }
  // 空格不敏感匹配（跨行英文单词的空格由阅读器按位置重建，朴素拼接会丢）
  const condensed = fullText.replace(/\s+/g, '')
  for (const key of exp.text) {
    check(`文本「${key.slice(0, 18)}」可提取`, condensed.includes(key.replace(/\s+/g, '')))
  }
  check('非栅格化（文本总量 > 50 字符）', fullText.trim().length > 50, `共 ${fullText.trim().length} 字符`)

  // 分页内容归属
  if (exp.pageTextChecks) {
    for (const pc of exp.pageTextChecks) {
      const t = (pageTexts[pc.page - 1] ?? '').replace(/\s+/g, '')
      if (pc.contains) check(`第 ${pc.page} 页含「${pc.contains.slice(0, 14)}」`, t.includes(pc.contains.replace(/\s+/g, '')))
      if (pc.notContains) check(`第 ${pc.page} 页不含「${pc.notContains.slice(0, 14)}」`, !t.includes(pc.notContains.replace(/\s+/g, '')))
    }
  }

  // 注解
  let uriCount = 0
  let destCount = 0
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const annots = await page.getAnnotations()
    for (const a of annots) {
      if ((a.annotationType === 2 || a.annotationType === 'Link')) {
        if (a.url) uriCount++
        else if (a.dest) destCount++
      }
    }
  }
  check(`URI 链接 ≥ ${exp.links.minUri ?? 0}`, uriCount >= (exp.links.minUri ?? 0), `实际 ${uriCount}`)
  if (exp.links.minDest) check(`内部跳转 ≥ ${exp.links.minDest}`, destCount >= exp.links.minDest, `实际 ${destCount}`)
  if (exp.containsToc) check('有大纲书签', (await doc.getOutline()).length > 0)

  // pdftoppm 渲染 → PNG（供人工检查与视觉回归）
  const pngPrefix = join(OUT, 'render-' + basename(filename, '.pdf'))
  try {
    for (const f of readdirSync(OUT)) {
      if (f.startsWith('render-' + basename(filename, '.pdf'))) rmSync(join(OUT, f), { force: true })
    }
    execFileSync('pdftoppm', ['-png', '-r', '80', path, pngPrefix], { stdio: 'ignore' })
    const pngs = readdirSync(OUT).filter((f) => f.startsWith('render-' + basename(filename, '.pdf')))
    check(`pdftoppm 渲染 ${pngs.length} 页 PNG`, pngs.length === doc.numPages)
    // 简单黑块/空白检测：读 PNG 尺寸 + 亮度均值（用 pdfjs canvas 不方便，交给视觉回归脚本）
  } catch (e) {
    check('pdftoppm 可用', false, e.message.slice(0, 80))
  }

  void info
}

mkdirSync(OUT, { recursive: true })
for (const [filename, exp] of Object.entries(EXPECTATIONS)) {
  await verifyOne(filename, exp)
}

// caseF 页面尺寸校准：Letter 横向 = 11in × 8.5in = 792×612pt
console.log('\n（caseF Letter 横向实际应为 792×612pt，期望值见上方结果）')

writeFileSync(join(OUT, 'verify-results.json'), JSON.stringify({ pass, fail }, null, 2))
console.log(`\nVERIFY RESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
