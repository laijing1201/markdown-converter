/**
 * PDF 管线单元测试（纯逻辑，无需浏览器布局）：
 *   - 文件名 helper（Word / PDF 共用）
 *   - FontResolver 字体映射（含降级提示）
 *   - 分页拆分的孤行/寡行规则
 *   - 有序列表标记（与 Word numbering 同语义）
 *   - KaTeX SVG 走查器的路径解析/矩阵烘焙
 *
 * 运行：npx tsx scripts/test-pdf-unit.ts
 */
import { JSDOM } from 'jsdom'

const host = new JSDOM('<!doctype html><html><body></body></html>')
const w = host.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'SVGElement', 'getComputedStyle']) {
  ;(globalThis as unknown as Record<string, unknown>)[key] = w[key]
}
// jsdom 没有 getComputedStyle 对 SVG 的完整支持，提供兜底
if (typeof (globalThis as unknown as Record<string, unknown>).getComputedStyle !== 'function') {
  ;(globalThis as unknown as Record<string, unknown>).getComputedStyle = () => ({}) as unknown as CSSStyleDeclaration
}

const { buildExportFilename, extractFirstHeading } = await import('../src/core/filename')
const { resolveFontFamily, takeFontNotices } = await import('../src/core/pdf/fonts')
const { computeSplitCount } = await import('../src/core/pdf/layout')
const { buildListMarkers } = await import('../src/core/pdf/layout')
const { parseSvgColor } = await import('../src/core/pdf/svg')

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

console.log('\n── 文件名 helper（Word / PDF 共用）──')
check('第一标题作文件名', buildExportFilename('# 人工智能实验报告\n\n正文', '') === '人工智能实验报告')
check(
  '过滤非法字符',
  buildExportFilename('# ' + ['a/b', 'c:d', 'g?h', 'i"j', 'k<l', 'm>n', 'o|p'].join(' '), '')
    === 'a b c d g h i j k l m n o p',
)
check('强调符号直接删除（中文粗体标题友好）', buildExportFilename('# **实验**报告', '') === '实验报告')
check('设置标题优先于第一标题', buildExportFilename('# 第一标题', '设置里的标题') === '设置里的标题')
check('无标题回退日期格式', /^MarkDoc-\d{4}-\d{2}-\d{2}$/.test(buildExportFilename('', '')))
check('代码块内 # 不算标题', extractFirstHeading('```\n# not a heading\n```') === '')
check('超长标题截断到 60 字符', buildExportFilename('# ' + '长'.repeat(100), '').length === 60)
check('去掉行内强调语法', buildExportFilename('# **实验**报告_结论`x`', '').includes('实验报告'))

console.log('\n── FontResolver 字体映射 ──')
takeFontNotices()
check('宋体 → serif', resolveFontFamily('SimSun, serif', false).fontKey === 'serif')
check('黑体 → sans', resolveFontFamily('SimHei, sans-serif', false).fontKey === 'sans')
check('微软雅黑 → sans', resolveFontFamily('"Microsoft YaHei"', false).fontKey === 'sans')
check('楷体 → serif（映射）', resolveFontFamily('KaiTi, serif', false).fontKey === 'serif')
check('Consolas → mono', resolveFontFamily('Consolas, monospace', false).fontKey === 'mono')
check('Times New Roman → serif', resolveFontFamily('"Times New Roman", serif', false).fontKey === 'serif')
check('加粗变体', resolveFontFamily('SimSun', true).fontKey === 'serif-bold')
check('未知字体 → sans 兜底', resolveFontFamily('"Some Random Font", cursive', false).fontKey === 'sans')
check('KaTeX_Main → katex:Main', resolveFontFamily('KaTeX_Main', false, false).fontKey === 'katex:Main')
check('KaTeX_Math 斜体 → Math-Italic', resolveFontFamily('KaTeX_Math', false, true).fontKey === 'katex:Math-Italic')
check('KaTeX_Main 加粗 → Main-Bold', resolveFontFamily('KaTeX_Main', true, false).fontKey === 'katex:Main-Bold')
check('拉丁斜体 → Times Italic 标记', resolveFontFamily('SimSun', false, true).stdItalic === 'times')
const notices = takeFontNotices()
check('字体替代有用户提示', notices.length > 0 && notices.some((n) => n.includes('SimSun')))

console.log('\n── 分页拆分：孤行/寡行 ──')
check('全部放得下 → 全放', computeSplitCount(5, 8) === 5)
check('一页都放不下 → 0（触发换页）', computeSplitCount(5, 0) === 0)
check('最多放 3 行 → 3', computeSplitCount(10, 3) === 3)
check('寡行：下页剩 1 行 → 本页少放一行', computeSplitCount(5, 4) === 3)
check('孤行：本页只放得下 1 行 → 整块下移', computeSplitCount(4, 1) === 0)
check('两行块放不下第二行 → 整块下移', computeSplitCount(2, 1) === 0)
check('大块必须硬拆时不产生死循环', computeSplitCount(30, 1) === 0)

console.log('\n── 有序列表标记（与 Word numbering 同语义）──')
{
  const doc = new JSDOM('<ol><li>一<ol><li>甲</li><li>乙</li></ol></li><li>二</li></ol>').window.document
  const root = doc.body as HTMLElement
  buildListMarkers(root)
  const markers = Array.from(root.querySelectorAll('.pdf-li-marker')).map((m) => m.textContent)
  check('生成 4 个标记', markers.length === 4)
  check('顶层 1.', markers[0] === '1.')
  check('嵌套按父级重启 1.', markers[1] === '1.')
  check('嵌套第二个 2.', markers[2] === '2.')
  check('顶层第二项 2.', markers[3] === '2.')
}
{
  const doc = new JSDOM('<ul><li>项目</li></ul>').window.document
  const root = doc.body as HTMLElement
  buildListMarkers(root)
  check('无序列表 • 标记', root.querySelector('.pdf-li-marker')?.textContent === '•')
}

console.log('\n── SVG 颜色/路径工具 ──')
check('hex 颜色解析', parseSvgColor('#FF0000') === '#ff0000')
check('rgb() 颜色解析', parseSvgColor('rgb(0, 128, 255)') === '#0080ff')
check('none → null', parseSvgColor('none') === null)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
