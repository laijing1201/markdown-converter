/**
 * Markdown 管线单元测试：分页符 / 图题表题 / 任务列表 / XSS 清洗 /
 * 高频 Markdown 元素覆盖。在 jsdom 环境下运行（DOMPurify 需要窗口）。
 *
 * 运行：npx tsx scripts/test-markdown.ts
 */
import { JSDOM } from 'jsdom'

// ── 先建立 jsdom 全局，再动态 import 依赖 window 的模块 ──────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>')
const w = dom.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'HTMLInputElement']) {
  ;(globalThis as unknown as Record<string, unknown>)[key] = w[key]
}

const { markdownToSafeHtml, countPagebreaks, extractFormulas } = await import('../src/core/markdown')

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

// ── 分页符 ───────────────────────────────────────────────────────────────────
console.log('分页符')
{
  const md = '第一页内容\n\n<!-- pagebreak -->\n\n第二页内容'
  const html = markdownToSafeHtml(md)
  check('生成 .pagebreak div', html.includes('<div class="pagebreak"></div>'), html)
  check('占位符不残留', !html.includes('%%PAGEBREAK%%'))
  check('无 pagebreak 时不生成', !markdownToSafeHtml('普通内容').includes('pagebreak'))
  check('countPagebreaks = 1', countPagebreaks(md) === 1)
  check('大小写不敏感', countPagebreaks('<!-- PageBreak -->') === 1)
  check('两处分页符统计正确', countPagebreaks('a\n\n<!-- pagebreak -->\n\nb\n\n<!-- pagebreak -->\n\nc') === 2)
  // 行内注释不是分页符：不影响普通段落
  const inline = markdownToSafeHtml('这是一段 <!-- pagebreak --> 行内注释')
  check('行内注释不触发分页', !inline.includes('class="pagebreak"'), inline)
}

// ── 图题 / 表题 ──────────────────────────────────────────────────────────────
console.log('图题表题')
{
  const html = markdownToSafeHtml('![系统结构](https://example.com/a.png)\n\n*图：系统总体结构*\n\n正文\n\n*表：模型对比*')
  check('图题 data-kind=fig', html.includes('data-kind="fig"'), html)
  check('表题 data-kind=tbl', html.includes('data-kind="tbl"'), html)
  check('caption 文本保留', html.includes('系统总体结构') && html.includes('模型对比'))
  check('caption 是独立 div 段落', html.includes('<div class="block-caption"'))
  // 普通斜体行不受影响
  const plain = markdownToSafeHtml('这是 *普通强调* 文本')
  check('普通斜体不变成 caption', !plain.includes('block-caption'))
  // 带编号的 caption：用户编号被剥离（自动编号接管）
  const numbered = markdownToSafeHtml('*图 1：某结构*')
  check('用户手写编号被剥离', numbered.includes('某结构') && !numbered.includes('图 1'), numbered)
  // 英文 caption
  const en = markdownToSafeHtml('*Table: results*')
  check('英文表题 data-kind=tbl', en.includes('data-kind="tbl"'))
  // caption 中的 HTML 被转义
  const xss = markdownToSafeHtml('*图：<img src=x onerror=alert(1)>*')
  check('caption 内 HTML 被转义', !xss.includes('<img src=x'), xss)
}

// ── 任务列表 ─────────────────────────────────────────────────────────────────
console.log('任务列表')
{
  const html = markdownToSafeHtml('- [x] 已完成\n- [ ] 待办')
  check('ul 获得 task-list 类', html.includes('<ul class="task-list"'), html)
  check('li 获得 task-list-item 类', html.includes('<li class="task-list-item"'))
  check('checkbox input 保留', html.includes('type="checkbox"'))
  check('勾选状态保留', html.includes('checked'))
}

// ── XSS 清洗 ─────────────────────────────────────────────────────────────────
console.log('XSS 清洗')
{
  const html = markdownToSafeHtml(
    [
      '<script>alert(1)</script>',
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">点我</a>',
      '<div onclick="alert(1)">点我</div>',
      '<iframe src="https://evil.example"></iframe>',
      '[link](javascript:alert(1))',
    ].join('\n\n'),
  )
  check('script 标签被移除', !html.toLowerCase().includes('<script'))
  check('onerror 属性被移除', !html.includes('onerror'))
  check('onclick 属性被移除', !html.includes('onclick'))
  check('javascript: href 被移除', !html.toLowerCase().includes('javascript:'))
  check('iframe 被移除', !html.toLowerCase().includes('<iframe'))
  const bodyText = html.replace(/<[^>]*>/g, '')
  check('纯文本内容不丢失（script 除外）', bodyText.includes('点我'))
}

// ── 合法元素不被破坏 ─────────────────────────────────────────────────────────
console.log('KaTeX/Mermaid/表格等合法元素')
{
  const html = markdownToSafeHtml(
    '公式 $E = mc^2$ 与\n\n$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |',
  )
  check('行内公式 data-formula 保留', html.includes('data-formula'))
  check('math-block 保留', html.includes('math-block'))
  check('mermaid 代码块保留', html.includes('language-mermaid'))
  check('表格保留', html.includes('<table'))
}

// ── 高频 Markdown 覆盖 ───────────────────────────────────────────────────────
console.log('高频 Markdown 元素')
{
  const html = markdownToSafeHtml(
    [
      '> 一级引用',
      '> > 嵌套引用',
      '',
      '~~删除线~~',
      '',
      '---',
      '',
      '[外链](https://example.com)',
      '',
      '转义 \\*不是斜体\\*',
      '',
      '软换行',
      '下一行',
      '',
      '硬换行  ',
      '下一行',
      '',
      '1. 有序',
      '   1. 嵌套有序',
      '2. 第二项',
      '',
      '- 无序',
      '  - 嵌套无序',
    ].join('\n'),
  )
  check('嵌套 blockquote', (html.match(/<blockquote>/g) || []).length >= 2)
  check('删除线 <del>', html.includes('<del>'))
  check('水平线 <hr>', html.includes('<hr'))
  check('链接', html.includes('href="https://example.com"'))
  check('转义星号不产生斜体', !/<em>不是斜体<\/em>/.test(html))
  check('硬换行 <br>', html.includes('<br'))
  check('有序列表', html.includes('<ol>'))
  check('嵌套有序列表', (html.match(/<ol>/g) || []).length >= 2)
  check('无序列表嵌套', (html.match(/<ul>/g) || []).length >= 2)

  // 代码块保持缩进（高亮 span 包裹 token，取纯文本校验）
  const code = markdownToSafeHtml('```python\ndef f():\n    x = 1\n    if x:\n        return x\n```')
  const codeText = new w.DOMParser().parseFromString(code, 'text/html').documentElement.textContent
  check('代码块缩进保留', codeText.includes('    x = 1') && codeText.includes('        return x'), codeText)
  check('代码块语言标记', code.includes('language-python'))

  // 公式提取
  const formulas = extractFormulas('行内 $a+b$ 与块级\n\n$$\\frac{1}{2}$$')
  check('公式提取数量 = 2', formulas.length === 2, `got ${formulas.length}`)
  // 货币金额（价格 $5 与 $10 之间）不误判为公式
  const currency = extractFormulas('价格为 $5 与 $10 之间')
  check('货币文本不误判为公式', currency.length === 0, `got ${currency.length}`)
}

// ── 智能排版不破坏合法 Markdown（回归保护）───────────────────────────────────
console.log('智能排版安全规则')
{
  const { smartFormatText } = await import('../src/core/formatter')

  // 合法表格必须原样保留
  const tableSrc = '# 标题\n\n| 列A | 列B | 列C |\n|---|---|---|\n| a1 | b1 | c1 |\n\n正文。'
  const tableOut = smartFormatText(tableSrc)
  check('表格行不被缝合', tableOut.includes('| 列A | 列B | 列C |'), tableOut)
  check('表格分隔行保留', tableOut.includes('|---|---|---|'))
  check('表格单元格文字不变', tableOut.includes('列A') && !tableOut.includes('列 A'))

  // 合法有序列表不被变成标题/加粗
  const listSrc = '1. 第一项\n2. 第二项\n\n正文。'
  const listOut = smartFormatText(listSrc)
  check('有序列表行保留', listOut.includes('1. 第一项') && listOut.includes('2. 第二项'), listOut)
  check('有序列表不被转成标题', !listOut.includes('#'))

  // 代码围栏内保持原样
  const codeSrc = '```python\ndef f():\n    return 1\n\n    x = 2\n```\n\n正文段落'
  const codeOut = smartFormatText(codeSrc)
  check('代码行不被缝合', codeOut.includes('    return 1\n\n    x = 2'), codeOut)

  // 纯文本序号仍可推断（功能保留）
  const plainSrc = '第一章 绪论\n\n1.第一点\n2.第二点\n'
  const plainOut = smartFormatText(plainSrc)
  check('纯文本章名转标题', plainOut.includes('## 第一章 绪论'), plainOut)

  // 分页符/图题语法不被破坏
  const extSrc = '第一页\n\n<!-- pagebreak -->\n\n![图](https://example.com/a.png)\n\n*图：结构*\n'
  const extOut = smartFormatText(extSrc)
  check('分页符注释保留', extOut.includes('<!-- pagebreak -->'), extOut)
  check('图题行保留', extOut.includes('图：结构'))
}

// ── CJK 邻接加粗（**标签：**后紧跟汉字）──────────────────────────────────────
console.log('CJK 邻接加粗')
{
  // CommonMark flanking 规则：闭合 ** 前是标点、后紧跟汉字时不解析 → 字面 ** 泄漏
  const html = markdownToSafeHtml('- **位置：**引言贡献第（3）项')
  check('闭合**紧跟汉字解析为 strong', html.includes('<strong>位置：</strong>'), html)
  check('无字面 ** 残留', !html.includes('**'), html)
  check('零宽空格不残留在输出', !html.includes('\u200B'), html)

  const quoted = markdownToSafeHtml('**可能造成的影响：**“优于 CAPU”')
  check('后跟引号正常加粗（原有行为不回退）', quoted.includes('<strong>可能造成的影响：</strong>'), quoted)

  const en = markdownToSafeHtml('plain **english bold** text')
  check('英文粗体不受影响', en.includes('<strong>english bold</strong>'), en)

  const openFix = markdownToSafeHtml('中文**“引用内容”**说明')
  check('CJK 后接标点的开**解析', openFix.includes('<strong>“引用内容”</strong>'), openFix)

  const inCode = markdownToSafeHtml('使用 `**位置：**不要误解析` 的行内代码')
  check('行内代码内 ** 保持字面', inCode.includes('<code>**位置：**不要误解析</code>'), inCode)

  // `_` 受 CommonMark 词内规则限制（__x__后紧跟汉字不解析，规范行为），只验证常规场景
  const em = markdownToSafeHtml('- __标签：__ 内容')
  check('下划线粗体常规场景正常', em.includes('<strong>标签：</strong>'), em)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
