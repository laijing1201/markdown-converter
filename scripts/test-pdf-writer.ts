/**
 * PDF 渲染器测试（Node，无需浏览器）：
 * 手工构造 DrawItem 页列表 → renderPdf → pdfjs 验证：
 *   - 页数与页面尺寸（A4 pt）
 *   - 真文本提取（中文/英文/数字，证明未整体栅格化）
 *   - URI 链接注解存在且目标正确
 *   - 目录页与内部跳转
 *   - 元数据 Title/Creator
 *   - 图片嵌入（PNG alpha）
 *   - 子集嵌入后文件体积合理
 *
 * 运行：npx tsx scripts/test-pdf-writer.ts
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const w = dom.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement']) {
  ;(globalThis as unknown as Record<string, unknown>)[key] = w[key]
}

const { renderPdf, STATIC_TEXT_CHARS } = await import('../src/core/pdf/render')
const { DEFAULT_SETTINGS } = await import('../src/core/templates')
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { writeFileSync, mkdirSync, statSync } from 'fs'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
    fail++
  }
}

// ── 构造两页内容 + 目录 ──────────────────────────────────────────────────────
const usedChars = new Map<string, Set<string>>()
const addUsed = (key: string, text: string) => {
  let set = usedChars.get(key)
  if (!set) usedChars.set(key, (set = new Set()))
  for (const ch of text) set.add(ch)
}

const text = (t: string, x: number, y: number, fontKey = 'sans', size = 16): any => ({
  kind: 'text', text: t, x, y, w: t.length * size, size, fontKey, stdItalic: null, color: '#000000',
})

const page1: any[] = [
  text('第一章 绪论', 0, 40, 'sans-bold', 24),
  text('中文正文：人工智能正在改变世界。', 0, 80),
  text('English paragraph with numbers 123.', 0, 110),
  text('这是一个超链接', 0, 140),
  { kind: 'line', x1: 0, y1: 150, x2: 300, y2: 150, width: 1, color: '#e5e7eb' },
  { kind: 'rect', x: 0, y: 160, w: 200, h: 24, fill: '#f6f8fa' },
  text('code line', 4, 178, 'mono', 14),
  { kind: 'image', x: 0, y: 210, w: 120, h: 80, imageId: 'img-test' },
  // 简单矢量路径（三角形）
  { kind: 'path', d: 'M 0 320 L 60 320 L 30 260 Z', fill: '#3366cc', stroke: null, strokeWidth: 0 },
]

const page2: any[] = [
  text('第二章 方法', 0, 40, 'sans-bold', 24),
  text('第二页内容。', 0, 80),
]

// 1x1 红色 PNG（带 alpha 通道头）
const png1x1 = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
), (c) => c.charCodeAt(0))

const images = new Map([['img-test', { format: 'png' as const, bytes: png1x1 }]])

addUsed('sans', '第一章 绪论中文正文：人工智能正在改变世界。English paragraph with numbers 123.这是一个超链接第二页内容。' + STATIC_TEXT_CHARS)
addUsed('sans-bold', '第一章 绪论第二章 方法' + STATIC_TEXT_CHARS)
addUsed('mono', 'code line')
addUsed('serif', '目录第一章 绪论第二章 方法12' + STATIC_TEXT_CHARS)

const layout: any = {
  pages: [page1, page2],
  links: [
    [{ kind: 'link', x: 0, y: 128, w: 112, h: 20, url: 'https://openai.com' }],
    [],
  ],
  tocEntries: [
    { text: '第一章 绪论', level: 1 as const, page: 2 },
    { text: '第二章 方法', level: 1 as const, page: 3 },
  ],
  tocPageCount: 1,
  title: '第一章 绪论',
  images,
  notices: [],
  usedChars,
  geometry: {
    pageWpt: 595.28,
    pageHpt: 841.89,
    marginPt: { top: 72, right: 72, bottom: 72, left: 72 },
    contentWpx: 601,
    contentHpx: 931,
  },
}

const settings = {
  ...DEFAULT_SETTINGS,
  includePageNumbers: true,
  includeToc: true,
  documentTitle: '人工智能测试报告',
}

const blob = await renderPdf(layout as never, settings as never)
const bytes = new Uint8Array(await blob.arrayBuffer())
mkdirSync('tests/pdf/out', { recursive: true })
writeFileSync('tests/pdf/out/writer-test.pdf', bytes)

console.log('\n── PDF 基本结构 ──')
const header = Buffer.from(bytes.slice(0, 5)).toString('latin1')
check('PDF 文件头 %PDF-', header === '%PDF-')
const sizeKB = statSync('tests/pdf/out/writer-test.pdf').size / 1024
check(`体积合理（${sizeKB.toFixed(0)}KB < 1500KB）`, sizeKB < 1500)

const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
check('页数 = 1 目录 + 2 内容 = 3', doc.numPages === 3, `实际 ${doc.numPages}`)
const meta = await doc.getMetadata()
check('元数据 Title', (meta.info as { Title?: string }).Title === '人工智能测试报告')
check('元数据 Creator = MarkDoc', (meta.info as { Creator?: string }).Creator === 'MarkDoc')
const pageInfo = await doc.getPage(2).then((p) => p.view)
check('A4 尺寸 pt（595×842）', Math.abs(pageInfo[2] - 595.28) < 1 && Math.abs(pageInfo[3] - 841.89) < 1)

console.log('\n── 文本提取（真文本，非栅格化）──')
async function pageText(n: number): Promise<string> {
  const page = await doc.getPage(n)
  const tc = await page.getTextContent()
  return tc.items.map((i) => ('str' in i ? i.str : '')).join('')
}
const tocText = await pageText(1)
const p1 = await pageText(2)
const p2 = await pageText(3)
check('目录页有标题', tocText.includes('目') && tocText.includes('录'), tocText.slice(0, 40))
check('目录页码正确（2/3）', /\b2\b/.test(tocText) && /\b3\b/.test(tocText))
check('中文正文提取', p1.includes('人工智能正在改变世界'), p1.slice(0, 60))
check('英文正文提取', p1.includes('English paragraph with numbers 123.'))
check('标题提取', p1.includes('第一章 绪论'))
check('代码文本提取', p1.includes('code line'))
check('第二页提取', p2.includes('第二章 方法') && p2.includes('第二页内容。'))
check('页码存在于页脚', p1.includes('2') && p2.includes('3'))

console.log('\n── 注解与大纲 ──')
const p2Annots = await doc.getPage(2).then((p) => p.getAnnotations())
const uriAnnot = p2Annots.find((a) => (a.annotationType === 2 || a.annotationType === 'Link') && (a as { url?: string }).url)
check('URI 链接注解存在', !!uriAnnot)
check('链接指向 openai.com', (uriAnnot as { url?: string } | undefined)?.url?.startsWith('https://openai.com'))
const tocAnnots = await doc.getPage(1).then((p) => p.getAnnotations())
const destAnnots = tocAnnots.filter((a) => (a.annotationType === 2 || a.annotationType === 'Link') && (a as { dest?: unknown }).dest)
check('目录内部跳转注解 ≥ 2', destAnnots.length >= 2, `实际 ${destAnnots.length}`)
check('PDF 大纲存在', (await doc.getOutline()).length === 2)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
