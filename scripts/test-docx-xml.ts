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
const dom = new JSDOM('<!doctype html><html><body><div id="preview-container"></div></body></html>')
const w = dom.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'HTMLImageElement', 'HTMLSpanElement']) {
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

// 保存样张供人工核验
mkdirSync('scripts/tmp', { recursive: true })
writeFileSync('scripts/tmp/p3-test.docx', bytes)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
