/**
 * 真实 DOCX 深度验证：通过 buildDocxBlob 捕获导出 Blob，
 * 解包 ZIP 检查 OOXML 结构 —— 分页符 / OMML 公式 / 编号 / TOC 域 /
 * PAGE 页码域 / 页面几何 / 字体 / 图片 / 超链接 / Caption。
 *
 * 运行：npx tsx scripts/test-docx-xml.ts
 */
import { JSDOM } from 'jsdom'
import JSZip from 'jszip'
import { writeFileSync, mkdirSync } from 'fs'

// ── jsdom 全局（exporter 需要浏览器 DOM）────────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="preview-container"></div></body></html>', { url: 'http://localhost/' })
const w = dom.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'HTMLImageElement', 'HTMLSpanElement', 'localStorage']) {
  ;(globalThis as unknown as Record<string, unknown>)[key] = w[key]
}

const { buildDocxBlob } = await import('../src/core/exporter')
const { markdownToSafeHtml } = await import('../src/core/markdown')
const { DEFAULT_SETTINGS } = await import('../src/core/templates')

let pass = 0
let fail = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? ` —— ${detail.slice(0, 200)}` : ''}`)
    fail++
  }
}

// 1×1 红色 PNG
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const TEST_MD = `# 绪论

## 研究背景

正文段落，包含 **加粗**、[示例链接](https://example.com/docs)、~~删除线~~、\`行内代码\` 与公式 $a^2+b^2=c^2$。

<!-- pagebreak -->

# 方法

*表：模型对比*

| 模型 | 参数量 |
|------|--------|
| A | 7B |
| B | 32B |

1. 第一项
   1. 嵌套项
2. 第二项

- [x] 已完成任务
- [ ] 待办任务

> 一级引用文字
>
> > 嵌套引用文字

$$E = mc^2$$

![测试图](data:image/png;base64,${TINY_PNG})

*图：测试图片*

\`\`\`python
def f():
    x = 1
    return x
\`\`\`

- 无序列表项
`

const previewHtml = markdownToSafeHtml(TEST_MD).replace(
  /<img /g,
  '<img style="width:200px;height:100px" ',
)

// 实时预览容器内容与导出快照一致（公式配对需要）
;(w.document as Document).getElementById('preview-container')!.innerHTML = previewHtml

const settings = {
  ...DEFAULT_SETTINGS,
  template: 'general',
  headingNumbering: '1.1.1' as const,
  includeToc: true,
  includePageNumbers: true,
  marginPreset: 'narrow' as const,
  bodyFontZh: 'SimSun',
  bodyFontEn: 'Times New Roman',
  bodySize: 24,
}

console.log('构建 DOCX …')
const blob = await buildDocxBlob(previewHtml, { settings })
const bytes = new Uint8Array(await blob.arrayBuffer())
const zip = await JSZip.loadAsync(bytes)

const documentXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
const numberingXml = (await zip.file('word/numbering.xml')?.async('string')) ?? ''
const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
const settingsXml = (await zip.file('word/settings.xml')?.async('string')) ?? ''
const contentTypes = (await zip.file('[Content_Types].xml')?.async('string')) ?? ''
const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''
const footerFiles = Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n))
let footerXml = ''
for (const f of footerFiles) footerXml += (await zip.file(f)!.async('string')) ?? ''

console.log('\n── 包结构 ──')
check('ZIP PK 头 (0x50 0x4B)', bytes[0] === 0x50 && bytes[1] === 0x4b)
check('word/document.xml 存在', documentXml.length > 0)
check('word/numbering.xml 存在', numberingXml.length > 0)
check('word/styles.xml 存在', stylesXml.length > 0)
check('word/settings.xml 存在', settingsXml.length > 0)
check('word/footer*.xml 存在', footerFiles.length > 0)
check('word/_rels/document.xml.rels 存在', relsXml.length > 0)
check('[Content_Types].xml 存在', contentTypes.length > 0)

console.log('\n── 分页符 ──')
check('存在真正的 Word 分页 <w:br w:type="page"/>', documentXml.includes('<w:br w:type="page"/>'), documentXml.slice(0, 500))

console.log('\n── 公式（OMML）──')
check('m:oMath 原生公式存在', documentXml.includes('<m:oMath'))
check('数学命名空间已声明', documentXml.includes('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'))
check('公式结构 m:sSup（上标）', documentXml.includes('m:sSup'))

console.log('\n── 标题编号 ──')
// 注：docx 序列化 numbering 时不含 reference 名称字符串，用编号文本与 numPr 断言
check('编号文本 %1.%2.%3（1.1.1 三级）', numberingXml.includes('%1.%2.%3'))
check('编号后缀为空格（1 标题）', numberingXml.includes('<w:suff w:val="space"/>'), numberingXml.slice(0, 800))
check('标题段落挂 numPr', /Heading1"[\s\S]{0,600}?<w:numPr>/.test(documentXml))
check('有序列表编号 %1. 存在', numberingXml.includes('w:val="%1."'))
check('有序列表支持 5 级（%5.）', numberingXml.includes('w:val="%5."'))

console.log('\n── 目录 / 页码 ──')
check('TOC 域存在', documentXml.includes('TOC'))
check('updateFields 开启', /<w:updateFields/.test(settingsXml))
check('页码 PAGE 域存在', footerXml.includes('PAGE'))
check('footer 已注册 Content_Type', contentTypes.includes('footer'))

console.log('\n── 页面几何 ──')
check('窄页边距 top=720', documentXml.includes('w:top="720"'))
check('窄页边距 left=720', documentXml.includes('w:left="720"'))
check('A4 纵向尺寸', documentXml.includes('w:w="11906"') && documentXml.includes('w:h="16838"'))

console.log('\n── 字体与样式 ──')
check('西文 Times New Roman', stylesXml.includes('w:ascii="Times New Roman"'))
check('中文 eastAsia="SimSun"', stylesXml.includes('w:eastAsia="SimSun"'))
check('Caption 样式存在', stylesXml.includes('w:styleId="Caption"'))

console.log('\n── Caption / 任务列表 / 引用 ──')
check('图题「图 1」自动编号', documentXml.includes('图 1'))
check('表题「表 1」自动编号', documentXml.includes('表 1'))
check('Caption 独立段落', /<w:pStyle w:val="Caption"\/>/.test(documentXml))
check('任务列表 ☑/☐', documentXml.includes('☑') && documentXml.includes('☐'))
check('嵌套引用文字保留', documentXml.includes('一级引用文字') && documentXml.includes('嵌套引用文字'))

console.log('\n── 图片 / 链接 / 代码 ──')
const mediaFiles = Object.keys(zip.files).filter((n) => n.startsWith('word/media/'))
check('图片嵌入 word/media/', mediaFiles.length >= 1, mediaFiles.join(','))
check('图片 relationship', relsXml.includes('image'))
check('超链接 relationship（External）', relsXml.includes('TargetMode="External"') && relsXml.includes('https://example.com'))
check('代码缩进保留（xml:space=preserve）', documentXml.includes('xml:space="preserve"') && documentXml.includes('    x = 1'), documentXml.match(/def f[\s\S]{0,300}/)?.[0])

// ── 第二份文档：Letter + 横向 ──
console.log('\n── Letter 横向文档 ──')
{
  const landscapeSettings = {
    ...DEFAULT_SETTINGS,
    paper: 'letter' as const,
    orientation: 'landscape' as const,
    headingNumbering: 'off' as const,
    includeToc: false,
    includePageNumbers: false,
    marginPreset: 'wide' as const,
  }
  const blob2 = await buildDocxBlob(previewHtml, { settings: landscapeSettings })
  const zip2 = await JSZip.loadAsync(new Uint8Array(await blob2.arrayBuffer()))
  const doc2 = (await zip2.file('word/document.xml')?.async('string')) ?? ''
  check('orient="landscape"', doc2.includes('w:orient="landscape"'))
  check('Letter 横向宽高 (15840×12240)', doc2.includes('w:w="15840"') && doc2.includes('w:h="12240"'), doc2.match(/<w:pgSz[^>]*\/>/)?.[0])
  check('宽页边距 left=2160', doc2.includes('w:left="2160"'))
  check('无目录（TOC 域关闭）', !doc2.includes('TOC'))
  check('无标题编号 numPr（headingNumbering=off）', !/Heading1"[\s\S]{0,600}?<w:numPr>/.test(doc2))
  check('无 footer（页码关闭）', !Object.keys(zip2.files).some((n) => /^word\/footer\d*\.xml$/.test(n)))
}

// ── 第三份文档：AI 审稿报告式内容回归 ──
// 覆盖三类线上问题：**标签：**后紧跟英文的字面泄漏、列表/表格内公式丢 OMML、
// 列表段落重复 <w:pStyle>（docx 库自动加 + 显式 style 叠加）。
console.log('\n── 审稿报告式内容（列表/表格公式 + pStyle）──')
{
  const reviewMd = [
    '# 审查报告',
    '',
    '- **具体表现：**CAPU、ENGD 是明确声明过的本地变体，公式 $r_i = a^2+b^2$ 为辅助记号。',
    '- **位置：**PDF第1页；主稿第66行。',
    '',
    '| 表头A | 表头B |',
    '|---|---|',
    '| 公式 $a^2+b^2=c^2$ 单元 | 文本 |',
  ].join('\n')
  const reviewHtml = markdownToSafeHtml(reviewMd)
  const blob3 = await buildDocxBlob(reviewHtml, { settings: { ...DEFAULT_SETTINGS, headingNumbering: 'off' } })
  const zip3 = await JSZip.loadAsync(new Uint8Array(await blob3.arrayBuffer()))
  const doc3 = (await zip3.file('word/document.xml')?.async('string')) ?? ''
  check('无字面 ** 泄漏', !doc3.includes('**'), doc3.match(/<w:t[^>]*>[^<]*\*\*[^<]*<\/w:t>/)?.[0])
  check('列表段落公式转为 OMML', (doc3.match(/<m:oMath/g) || []).length >= 2, `oMath=${(doc3.match(/<m:oMath/g) || []).length}`)
  check('无 KaTeX 内部文本泄漏（annotation/下标碎片）', !doc3.includes('b^2=c^2') && !/\u200B/.test(doc3))
  check('列表段落无重复 pStyle', !/<w:pStyle w:val="ListParagraph"\/><w:pStyle w:val="ListParagraph"\/>/.test(doc3))
  check('列表段落仍有 ListParagraph 样式（间距规则生效）', doc3.includes('<w:pStyle w:val="ListParagraph"/>'))
}

// ── 第四份文档：甲方验收回归（2026-09-27 导出质量事故）────────────────────────
// 覆盖甲方四类 P0：\(\)/\[\] 公式转 OMML、HTML 表格转原生表格、
// ===== Page X ===== 不入正文、表题编号唯一；以及转义加粗/转义星号残留。
console.log('\n── 甲方验收回归（\(\) 公式 / Page 标记 / HTML 表格）──')
{
  const B = String.fromCharCode(92)
  const capLines = Array.from({ length: 30 }, (_, i) => `*表：第${i + 1}张验证表*`).join('\n\n')
  const acceptanceMd = [
    '# 验收报告',
    '',
    `论文规定 ${B}(\\mathrm{u}(-1,t) = \\mathrm{u}(1,t) = 0\\mathrm{u}(-1,t) = \\mathrm{u}(1,t) = 0\\mathrm{u} (- 1,t) = 0${B})，且 ${B}(\\kappa = 10${B})。`,
    '',
    `${B}[ u_{\\rm ref}(1,0.1) \\approx 0.17257 ${B}]`,
    '',
    '===== Page 1 =====',
    '',
    '- **具体表现：**CAPU、ENGD 是本地变体，公式 $a^2+b^2=c^2$ 为记号。',
    '- 转义加粗：' + B + '*' + B + '*问题类型：' + B + '*' + B + '*数据质量。',
    '',
    '<table><tr><td>HTML表格A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>',
    '',
    '<p>前文 &lt;table&gt;&lt;tr&gt;&lt;td&gt;段内表格&lt;/td&gt;&lt;td&gt;Y&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</p>',
    '',
    capLines,
  ].join('\n')

  const acceptanceHtml = markdownToSafeHtml(acceptanceMd)
  const blobA = await buildDocxBlob(acceptanceHtml, { settings: { ...DEFAULT_SETTINGS, headingNumbering: 'off', includeToc: false } })
  const zipA = await JSZip.loadAsync(new Uint8Array(await blobA.arrayBuffer()))
  const docA = (await zipA.file('word/document.xml')?.async('string')) ?? ''
  const textsA = (docA.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).join('')

  check('\\(\\) 污染公式转 OMML（可编辑原生公式）', docA.includes('<m:oMath'), `oMath=${(docA.match(/<m:oMath/g) || []).length}`)
  check('\\[\\] 行间公式转 OMML', (docA.match(/<m:oMathPara/g) || []).length >= 1, `oMathPara=${(docA.match(/<m:oMathPara/g) || []).length}`)
  check('正文无 \\( \\) 残留', !textsA.includes('(' + B) && !textsA.includes(B + ')'), '')
  check('正文无 \\mathrm 残留', !textsA.includes('mathrm'), '')
  check('正文无 ===== Page 标记', !textsA.includes('====='), '')
  check('Page 标记转为真正分页符', (docA.match(/<w:br w:type="page"\/>/g) || []).length >= 1, (docA.match(/<w:br w:type="page"/g) || []).length)
  check('正文无字面 ** 泄漏', !textsA.includes('**'), '')
  check('HTML 表格转为原生 w:tbl（2 张）', (docA.match(/<w:tbl>/g) || []).length === 2, `w:tbl=${(docA.match(/<w:tbl>/g) || []).length}`)
  check('正文无 <table>/<tr>/<td> 标签文本', !textsA.includes('<table') && !textsA.includes('<tr>') && !textsA.includes('<td>'), '')
  check('表格单元格内容完整', textsA.includes('HTML表格A') && textsA.includes('段内表格'), '')

  // 导出日志与质量统计（整改要求 8：失败/格式异常可追溯）
  const { getLastDocxExportStats } = await import('../src/core/exporter')
  const stats = getLastDocxExportStats()
  check('导出质量统计已采集（公式/表格）', !!stats && stats.mathTotal >= 4 && stats.mathOmml >= 4 && stats.tables === 2, JSON.stringify(stats))
  const { recordExportEvent, readExportLog, exportLogSummary } = await import('../src/core/exportLog')
  ;(w.localStorage as Storage).clear()
  recordExportEvent({ ts: 'T1', format: 'docx', outcome: 'ok', durationMs: 120, mathTotal: 4, mathOmml: 4, tables: 2 })
  recordExportEvent({ ts: 'T2', format: 'pdf', outcome: 'fail', durationMs: 30, error: 'PdfExportError: mock' })
  const log = readExportLog()
  check('导出事件持久化（成功+失败）', log.length === 2 && log[0].outcome === 'ok' && log[1].outcome === 'fail', JSON.stringify(log))
  const summary = exportLogSummary()
  check('诊断摘要包含失败事件', summary.some((l) => l.includes('失败') && l.includes('PdfExportError')), summary.join('\n'))

  // 合并单元格：colspan → gridSpan，rowspan → vMerge restart/continue
  const mergeHtml = markdownToSafeHtml(
    '<table><tr><th colspan="2">跨列表头</th></tr><tr><td>A1</td><td>B1</td></tr><tr><td rowspan="2">跨行</td><td>B2</td></tr><tr><td>B3</td></tr></table>',
  )
  const blobM = await buildDocxBlob(mergeHtml, { settings: { ...DEFAULT_SETTINGS, headingNumbering: 'off' } })
  const zipM = await JSZip.loadAsync(new Uint8Array(await blobM.arrayBuffer()))
  const docM = (await zipM.file('word/document.xml')?.async('string')) ?? ''
  check('colspan 转为 gridSpan', docM.includes('<w:gridSpan w:val="2"/>'), '')
  check('rowspan 转为 vMerge restart', docM.includes('w:val="restart"'), '')
  check('rowspan 延续格 vMerge continue', docM.includes('<w:vMerge w:val="continue"/>'), '')
  check('表格行设置 cantSplit（行内不跨页断裂）', docM.includes('<w:cantSplit/>'), '')

  // 表题自动编号唯一且连续（表 1..表 30）
  const capNums = (textsA.match(/表 (\d+)　/g) || []).map(s => parseInt(s.slice(2)))
  const uniqueSorted = [...new Set(capNums)].sort((a, b) => a - b)
  check('表题编号唯一且连续 1..30', uniqueSorted.length === 30 && uniqueSorted[0] === 1 && uniqueSorted[29] === 30, JSON.stringify(uniqueSorted))
}

// 保存样张供人工核验
mkdirSync('scripts/tmp', { recursive: true })
writeFileSync('scripts/tmp/p3-test.docx', bytes)

// ── 含 < > & 的公式必须转 OMML（mathml2omml 不转义 <m:t> 文本的回归）──
{
  const { latexToOmml } = await import('../src/core/omml')
  const cases: Array<[string, string, boolean]> = [
    ['不等式 x < 0', 'x < 0', false],
    ['大于号 y > 1', 'y > 1', false],
    ['区间集合', '{x \\in \\mathbb{R} \\mid x < 3}', true],
    ['且含 &', 'A \\cap B = \\{x \\mid x < 3 \\wedge y > 2\\}', true],
    ['分段函数 cases', '\\begin{cases} x^2, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}', true],
    ['求和含分式', '\\sum_{i=1}^{n} \\frac{1}{i^2} = \\frac{\\pi^2}{6}', true],
    ['矩阵 pmatrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', true],
  ]
  for (const [label, latex, block] of cases) {
    check(`OMML 转义回归：${label}`, latexToOmml(latex, block) !== null, latex)
  }
  const docIsh = await buildDocxBlob(
    '<p>不等式 <span class="math-inline" data-formula="x%20%3C%200"></span> 成立。</p>',
    { settings: { ...DEFAULT_SETTINGS, headingNumbering: 'off' } },
  )
  const zipI = await JSZip.loadAsync(new Uint8Array(await docIsh.arrayBuffer()))
  const docI = (await zipI.file('word/document.xml')?.async('string')) ?? ''
  check('含 < 的公式在 docx 中为 OMML 而非图片/文本', docI.includes('<m:oMath') && !docI.includes('x&lt;0</w:t>') && !docI.includes('<w:drawing>'))
}

// ── Mermaid 截图失败兜底 + 公式降级统计（需求：渲染失败保留原始代码、逐条列出失败公式）──
{
  const { getLastDocxExportStats } = await import('../src/core/exporter')
  // 无实时预览容器（离屏/无头导出）：.mermaid-rendered 无法截图，
  // 必须还原为源码块，绝不把 SVG 内容或空段带进正文
  const mermaidHtml = '<div class="mermaid-rendered" data-mermaid-source="graph TD; A-->B">SVG_GARBAGE</div>'
  const blobN = await buildDocxBlob(mermaidHtml, { settings: { ...DEFAULT_SETTINGS, headingNumbering: 'off' } })
  const zipN = await JSZip.loadAsync(new Uint8Array(await blobN.arrayBuffer()))
  const docN = (await zipN.file('word/document.xml')?.async('string')) ?? ''
  const textsN = (docN.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).join('').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  check('Mermaid 无实时容器时还原为源码', textsN.includes('graph TD; A-->B'), textsN.slice(0, 120))
  check('SVG 内容绝不进入正文', !docN.includes('SVG_GARBAGE'))
  check('源码以代码块呈现（shading 段落）', docN.includes('F6F8FA'))

  // OMML 转换失败的公式：进入 degradedFormulas 逐条记录（自检报告数据源）
  const badMathHtml = '<p>坏公式 <span class="math-inline" data-formula="%5Cnotacommand"></span> 结束。</p>'
  const blobB = await buildDocxBlob(badMathHtml, { settings: { ...DEFAULT_SETTINGS, headingNumbering: 'off' } })
  const statsB = getLastDocxExportStats()
  check('失败公式进入 degradedFormulas', statsB !== null && statsB.degradedFormulas.length === 1 && statsB.degradedFormulas[0] === '\\notacommand', JSON.stringify(statsB))
  check('失败公式计数 mathDegraded = 1', statsB !== null && statsB.mathDegraded === 1 && statsB.mathOmml === 0)
  const zipB = await JSZip.loadAsync(new Uint8Array(await blobB.arrayBuffer()))
  const docB = (await zipB.file('word/document.xml')?.async('string')) ?? ''
  check('失败公式以 $…$ 文本保留（可读可改）', docB.includes('$\\notacommand$'), '')
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
