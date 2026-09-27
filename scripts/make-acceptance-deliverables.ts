/**
 * 甲方对照交付物生成（2026-09-27 导出质量事故整改）：
 *   1. 源 Markdown（tests/fixtures/caseJ-acceptance.md 的副本）
 *   2. 导出 Word（buildDocxBlob 真实导出路径）
 *   3. 导出 PDF（由 test-pdf-e2e.mjs 产出后复制）
 *
 * 运行：npx tsx scripts/make-acceptance-deliverables.ts
 */
import { JSDOM } from 'jsdom'
import { mkdirSync, copyFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const dom = new JSDOM('<!doctype html><html><body><div id="preview-container"></div></body></html>')
const w = dom.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'HTMLImageElement', 'HTMLSpanElement']) {
  ;(globalThis as unknown as Record<string, unknown>)[key] = w[key]
}

const { buildDocxBlob } = await import('../src/core/exporter')
const { markdownToSafeHtml } = await import('../src/core/markdown')
const { DEFAULT_SETTINGS } = await import('../src/core/templates')

const OUT_DIR = join('artifacts', 'acceptance-20260927')
mkdirSync(OUT_DIR, { recursive: true })

const md = readFileSync('tests/fixtures/caseJ-acceptance.md', 'utf8')
copyFileSync('tests/fixtures/caseJ-acceptance.md', join(OUT_DIR, '源文档-审稿报告.md'))
console.log('✓ 源 Markdown 已复制')

const previewHtml = markdownToSafeHtml(md)
;(w.document as Document).getElementById('preview-container')!.innerHTML = previewHtml

const settings = {
  ...DEFAULT_SETTINGS,
  template: 'general',
  headingNumbering: '1.1' as const,
  includeToc: false,
  includePageNumbers: true,
}

const blob = await buildDocxBlob(previewHtml, { settings })
const buf = Buffer.from(await blob.arrayBuffer())
const { mkdirSync: mk, copyFileSync: cp, readFileSync: rd, existsSync: ex, writeFileSync: wr, statSync: st } = await import('fs')
wr(join(OUT_DIR, '导出-审稿报告.docx'), buf)
console.log(`✓ Word 已导出（${(buf.length / 1024).toFixed(1)} KB）`)

const pdfSrc = join('tests', 'pdf', 'out', 'caseJ-acceptance.pdf')
const pdfDst = join(OUT_DIR, '导出-审稿报告.pdf')
if (ex(pdfSrc)) {
  cp(pdfSrc, pdfDst)
  console.log(`✓ PDF 已复制（${(st(pdfSrc).size / 1024).toFixed(1)} KB）`)
} else {
  console.warn('⚠ 未找到 caseJ-acceptance.pdf —— 请先运行 node scripts/test-pdf-e2e.mjs --only=caseJ-acceptance')
}

// ── 内容一致性自检：Word 正文不应出现任何源码残留 ──
const JSZip = (await import('jszip')).default
const zip = await JSZip.loadAsync(new Uint8Array(buf))
const docXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
const texts = (docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).join('')
const issues: string[] = []
if (texts.includes('=====')) issues.push('===== Page 标记残留')
if (texts.includes('**')) issues.push('** 加粗标记残留')
if (texts.includes('mathrm') || texts.includes('\\kappa')) issues.push('LaTeX 命令残留')
if (texts.includes('<table') || texts.includes('<tr>') || texts.includes('<td>')) issues.push('HTML 表格标签残留')
const omathCount = (docXml.match(/<m:oMath/g) || []).length
const tblCount = (docXml.match(/<w:tbl>/g) || []).length
console.log(`自检：oMath 公式 ${omathCount} 个，原生表格 ${tblCount} 张，${issues.length ? '问题：' + issues.join('；') : '无源码残留 ✓'}`)
process.exit(issues.length ? 1 : 0)
