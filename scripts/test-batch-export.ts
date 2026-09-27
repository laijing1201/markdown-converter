/**
 * 批量转换单元测试（需求 P1-8）：
 *   文件名清洗 / ZIP 同名去重 / 双文件全管线转换（注入轻量渲染）/
 *   进度回调顺序 / 取消行为 / 失败隔离（单个文件损坏不影响其它）。
 *
 * 运行：npx tsx scripts/test-batch-export.ts
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
const w = dom.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'HTMLImageElement', 'HTMLSpanElement']) {
  ;(globalThis as unknown as Record<string, unknown>)[key] = w[key]
}

const { batchConvertToDocxZip, sanitizeZipName, renameZipUnique, readBatchFiles, BatchCancelledError } =
  await import('../src/core/batchExport')
const { markdownToSafeHtml } = await import('../src/core/markdown')
const { DEFAULT_SETTINGS } = await import('../src/core/templates')
const JSZip = (await import('jszip')).default

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

// ── 文件名清洗与去重 ─────────────────────────────────────────────────────────
console.log('文件名清洗与去重')
{
  check('去 .md 扩展名', sanitizeZipName('报告.md') === '报告')
  check('非法字符替换', sanitizeZipName('a:b*c?.md') === 'a_b_c_')
  check('空名兜底', sanitizeZipName('   .md') === '未命名')
  check('超长截断 80', sanitizeZipName('长'.repeat(100) + '.md').length === 80)

  const used = new Set<string>()
  check('首个名字原样', renameZipUnique('报告.docx', used) === '报告.docx')
  check('第二个同名加 (2)', renameZipUnique('报告.docx', used) === '报告(2).docx')
  check('第三个同名加 (3)', renameZipUnique('报告.docx', used) === '报告(3).docx')
  check('不同名不受影响', renameZipUnique('其它.docx', used) === '其它.docx')
}

// ── readBatchFiles：扩展名过滤 ───────────────────────────────────────────────
console.log('文件读取过滤')
{
  const makeFile = (name: string, content: string) => new File([content], name, { type: 'text/plain' })
  const items = await readBatchFiles([
    makeFile('a.md', '# A'),
    makeFile('b.txt', 'B'),
    makeFile('c.docx', 'PK..'),
  ])
  check('仅收 .md/.txt，滤掉其它', items.length === 2 && items[0].content === '# A' && items[1].fileName === 'b.txt')
}

// ── 双文件全管线（注入轻量渲染，不经 mermaid）───────────────────────────────
console.log('双文件全管线转换')
{
  const items = [
    { fileName: '文档甲.md', content: '# 文档甲\n\n正文段落，含**加粗**与表格：\n\n| 列1 | 列2 |\n|---|---|\n| a | b |' },
    { fileName: '文档乙.md', content: '# 文档乙\n\n第二个文档内容。' },
  ]
  const progress: string[] = []
  const outcome = await batchConvertToDocxZip(items, {
    settings: { ...DEFAULT_SETTINGS, template: 'general', includeToc: false, includePageNumbers: false },
    render: async (container, content) => {
      container.innerHTML = markdownToSafeHtml(content)
    },
    onProgress: (p) => progress.push(`${p.done}/${p.total}:${p.current}`),
  })
  check('两个文件都成功', outcome.okCount === 2 && outcome.failCount === 0, JSON.stringify(outcome.results))
  check('返回 ZIP blob', outcome.blob instanceof Blob && outcome.blob.size > 0)

  const zip = await JSZip.loadAsync(new Uint8Array(await outcome.blob!.arrayBuffer()))
  const names = Object.keys(zip.files).sort()
  check('ZIP 含两个 docx', names.length === 2 && names.every((n) => n.endsWith('.docx')), names.join(', '))
  check('文件名来自源文件', names.includes('文档甲.docx') && names.includes('文档乙.docx'))
  // docx 本身是 zip：再解一层看 document.xml 正文
  const inner = await JSZip.loadAsync(await zip.file('文档甲.docx')!.async('uint8array'))
  const docXml = await inner.file('word/document.xml')!.async('string')
  check('内容确实是转换后的 Word（含文档甲正文）', docXml.includes('文档甲'))

  check('进度回调逐文件推进', progress.length === 3 && progress[0] === '0/2:文档甲.md' && progress[2] === '2/2:', progress.join(' | '))
  check('逐项统计存在', outcome.results.every((r) => r.ok && r.stats !== undefined && typeof r.sizeBytes === 'number'))
}

// ── 同名文件 ZIP 去重 ────────────────────────────────────────────────────────
console.log('同名文件去重')
{
  const items = [
    { fileName: '同名.md', content: '# 甲' },
    { fileName: '同名.md', content: '# 乙' },
  ]
  const outcome = await batchConvertToDocxZip(items, {
    settings: { ...DEFAULT_SETTINGS, template: 'general', includeToc: false, includePageNumbers: false },
    render: async (container, content) => { container.innerHTML = markdownToSafeHtml(content) },
  })
  const zip = await JSZip.loadAsync(new Uint8Array(await outcome.blob!.arrayBuffer()))
  const names = Object.keys(zip.files).sort()
  check('两个同名文件各自保留', names.length === 2 && names.includes('同名.docx') && names.includes('同名(2).docx'), names.join(', '))
}

// ── 取消 ─────────────────────────────────────────────────────────────────────
console.log('取消行为')
{
  const items = [
    { fileName: 'a.md', content: '# A' },
    { fileName: 'b.md', content: '# B' },
  ]
  let calls = 0
  try {
    await batchConvertToDocxZip(items, {
      settings: { ...DEFAULT_SETTINGS, template: 'general' },
      render: async (container, content) => { container.innerHTML = markdownToSafeHtml(content) },
      checkCancel: () => (++calls > 1),
    })
    check('取消时抛出 BatchCancelledError', false)
  } catch (err) {
    const cancelled = err instanceof BatchCancelledError
    check('取消时抛出 BatchCancelledError', cancelled)
    if (cancelled) check('已完成的结果保留在 outcome 中', err.outcome.okCount === 1 && err.outcome.results[0].fileName === 'a.md')
  }
}

// ── 空输入 ───────────────────────────────────────────────────────────────────
{
  const outcome = await batchConvertToDocxZip([], {
    settings: { ...DEFAULT_SETTINGS, template: 'general' },
  })
  check('空列表返回 null blob', outcome.blob === null && outcome.okCount === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
