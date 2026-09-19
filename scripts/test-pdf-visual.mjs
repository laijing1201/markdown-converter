/**
 * PDF 视觉回归 —— 关键 PDF 渲染成 PNG 后与 baseline 逐像素对比。
 *
 *   node scripts/test-pdf-visual.mjs            # 对比（baseline 缺失时自动生成）
 *   node scripts/test-pdf-visual.mjs --update   # 重新生成 baseline
 *
 * 阈值：每页允许 0.8% 像素差异（渲染器/字体 hinting 的细微抖动），
 * 超过即失败，防止"修了公式、表格却坏了"这类回归。
 */
import pngjs from 'pngjs'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join, resolve, basename } from 'path'
import { execFileSync } from 'child_process'

const ROOT = resolve('.')
const OUT = join(ROOT, 'tests/pdf/out')
const BASELINE = join(ROOT, 'tests/pdf/baseline')
const THRESHOLD_RATIO = 0.008
const PIXEL_DIFF = 24 // 单像素 RGB 距离阈值

const TARGETS = [
  'caseA-basic.pdf',
  'caseB-math-heavy.pdf',
  'caseC-table-heavy.pdf',
  'caseD-code-mermaid-image.pdf',
  'caseE-academic.pdf',
]

const args = process.argv.slice(2)
const update = args.includes('--update')

function renderPages(pdfPath, prefix) {
  for (const f of readdirSync(OUT)) {
    if (f.startsWith(prefix)) rmSync(join(OUT, f), { force: true })
  }
  execFileSync('pdftoppm', ['-png', '-r', '80', pdfPath, join(OUT, prefix)], { stdio: 'ignore' })
  return readdirSync(OUT).filter((f) => f.startsWith(prefix) && f.endsWith('.png')).sort()
}

function comparePng(aBuf, bBuf) {
  const a = pngjs.PNG.sync.read(aBuf)
  const b = pngjs.PNG.sync.read(bBuf)
  if (a.width !== b.width || a.height !== b.height) {
    return { diffRatio: 1, detail: `尺寸不同 ${a.width}x${a.height} vs ${b.width}x${b.height}` }
  }
  let diff = 0
  const n = a.width * a.height
  for (let i = 0; i < n; i++) {
    const off = i * 4
    const dr = Math.abs(a.data[off] - b.data[off])
    const dg = Math.abs(a.data[off + 1] - b.data[off + 1])
    const db = Math.abs(a.data[off + 2] - b.data[off + 2])
    if (dr + dg + db > PIXEL_DIFF) diff++
  }
  return { diffRatio: diff / n, detail: `${diff}/${n} 像素` }
}

let pass = 0
let fail = 0
mkdirSync(BASELINE, { recursive: true })

for (const pdf of TARGETS) {
  const pdfPath = join(OUT, pdf)
  if (!existsSync(pdfPath)) {
    console.log(`✗ ${pdf}: 不存在（先跑 test-pdf-e2e.mjs）`)
    fail++
    continue
  }
  const stem = basename(pdf, '.pdf')
  const pages = renderPages(pdfPath, 'visual-' + stem)
  for (const png of pages) {
    const pageIdx = png.match(/-(\d+)\.png$/)?.[1] ?? '?'
    const current = readFileSync(join(OUT, png))
    const baselinePath = join(BASELINE, `${stem}-p${pageIdx}.png`)
    if (!existsSync(baselinePath)) {
      writeFileSync(baselinePath, current)
      console.log(`✓ ${pdf} p${pageIdx}: 生成新 baseline`)
      pass++
      continue
    }
    if (update) {
      writeFileSync(baselinePath, current)
      console.log(`✓ ${pdf} p${pageIdx}: baseline 已更新`)
      pass++
      continue
    }
    const { diffRatio, detail } = comparePng(readFileSync(baselinePath), current)
    if (diffRatio <= THRESHOLD_RATIO) {
      console.log(`✓ ${pdf} p${pageIdx}: 与 baseline 一致（差异 ${(diffRatio * 100).toFixed(2)}%）`)
      pass++
    } else {
      console.log(`✗ ${pdf} p${pageIdx}: 与 baseline 差异 ${(diffRatio * 100).toFixed(2)}% 超阈值 —— ${detail}`)
      // 保存失败图便于排查
      writeFileSync(join(OUT, `diff-${stem}-p${pageIdx}.png`), current)
      fail++
    }
  }
}

console.log(`\nVISUAL RESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
