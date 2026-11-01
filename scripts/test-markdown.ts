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

// ── 智能排版增强能力（2026-11 扩容：缝合/剔噪/结构/表格/URL）──────────────────
console.log('智能排版增强能力')
{
  const { smartFormatText } = await import('../src/core/formatter')

  // 断行缝合：中文直连（不插空格）、英文补空格
  const cjkJoin = smartFormatText('这是一段没有标点的\n中文续行内容')
  check('中文断行直连不插空格', cjkJoin.includes('这是一段没有标点的中文续行内容'), cjkJoin)
  const enJoin = smartFormatText('This is the first\npart of the sentence')
  check('英文断行补空格', enJoin.includes('This is the first part of the sentence'), enJoin)
  // PDF 断词连字符还原；过短前缀（e- / mail）保留连字符
  const hyphen = smartFormatText('This is a commu-\nnication tool')
  check('PDF断词连字符还原', hyphen.includes('communication tool'), hyphen)
  const eMail = smartFormatText('Send it via e-\nmail please')
  check('过短前缀保留连字符', eMail.includes('e-mail please'), eMail)
  const soft = smartFormatText('communi\u00ADcation is key')
  check('软连字符清理', soft.includes('communication is key'), soft)

  // 页眉页脚剔除扩容：中文页码变体 + 重复页眉
  const pages = smartFormatText('正文甲。\n第 3 页\n正文乙。\n共 12 页\n正文丙。\nPage 4/10\n正文丁。')
  check('中文页码剔除', !pages.includes('第 3 页') && pages.includes('正文甲。'), pages)
  check('共 N 页剔除', !pages.includes('共 12 页'), pages)
  check('Page 4/10 剔除', !pages.includes('Page 4/10'), pages)
  const longDoc = Array.from({ length: 12 }, (_, i) =>
    Array.from({ length: 10 }, (_, k) => `第${i + 1}页第${k + 1}段：论证内容各不相同足够多样。`).join('\n') + '\nRepeated Running Header',
  ).join('\n')
  const headerOut = smartFormatText(longDoc)
  check('重复页眉剔除', !headerOut.includes('Repeated Running Header'), headerOut.slice(0, 200))
  check('重复页眉不误删正文', headerOut.includes('第 1 页第 1 段：论证内容各不相同足够多样。'), headerOut.slice(0, 200))
  // 高重复率正文绝不当页眉整篇删光（数据安全阀：去重行 <10 时跳过剔除）
  const repetitive = Array.from({ length: 100 }, () => ['要点甲内容', '要点乙内容', '要点丙内容'].join('\n')).join('\n')
  const repOut = smartFormatText(repetitive)
  check('高重复率正文不整篇删除', repOut.includes('要点甲内容') && repOut.includes('要点丙内容'), `len=${repOut.length}`)
  check('非空输入绝不输出空', repOut.trim().length > 0)
  // 全部行都被判为噪音时回落原文（绝不返回空文档）
  const onlyNoise = smartFormatText('1\n2\n3')
  check('纯页码输入回落原文', onlyNoise === '1\n2\n3', onlyNoise)

  // 列表符号统一与任务清单
  const bullets = smartFormatText('– 第一项\n– 第二项\n• 第三项')
  check('en-dash 项目符号统一', bullets.includes('- 第一项') && bullets.includes('- 第二项') && bullets.includes('- 第三项'), bullets)
  const tasks = smartFormatText('□ 待办事项\n☑ 已完成事项\n✗ 未通过项')
  check('任务清单推断', tasks.includes('- [ ] 待办事项') && tasks.includes('- [x] 已完成事项') && tasks.includes('- [ ] 未通过项'), tasks)
  const notTask = smartFormatText('[x](https://example.com) 是链接')
  check('链接不误判任务清单', !notTask.includes('- [x]'), notTask)

  // 标题推断扩容：罗马数字 / 章节关键词 / 全大写 / Setext / 无空格序号
  const roman = smartFormatText('I. Introduction\n\n正文内容很长很长。')
  check('罗马数字标题', roman.includes('### I. Introduction'), roman)
  const kw = smartFormatText('摘  要\n\n本文研究了智能排版。\n\nAbstract\n\nThis paper studies typesetting.\n\n参考文献\n\n[1] Zhang, et al. 2024.')
  check('中文关键词标题（字间空白折叠）', kw.includes('## 摘要'), kw)
  check('英文关键词标题', kw.includes('## Abstract'), kw)
  check('参考文献标题', kw.includes('## 参考文献'), kw)
  const caps = smartFormatText('CONCLUSION AND FUTURE WORK\n\n正文很长。')
  check('全大写英文标题', caps.includes('### CONCLUSION AND FUTURE WORK'), caps)
  const setext = smartFormatText('主标题文字\n=====\n\n正文开始。')
  check('Setext 标题转换', setext.includes('# 主标题文字'), setext)
  const noSpaceNum = smartFormatText('1.第一点说明\n2.第二点说明')
  check('无空格序号转标题', noSpaceNum.includes('## 1.第一点说明') && noSpaceNum.includes('## 2.第二点说明'), noSpaceNum)
  const decimal = smartFormatText('圆周率是3.14不是3.15')
  check('小数不误判为序号', !decimal.includes('#'), decimal)

  // 分隔线变体
  const hr = smartFormatText('上文。\n\n——————\n\n下文。')
  check('长破折号分隔线转 hr', hr.includes('上文。\n\n---\n\n下文。'), hr)

  // ASCII 框线表格还原
  const ascii = smartFormatText('+-------+-------+\n| 名称 | 数值 |\n+-------+-------+\n| 甲 | 1 |\n| 乙 | 2 |\n+-------+-------+')
  check('ASCII 表格转 Markdown 表格', ascii.includes('| 名称 | 数值 |') && ascii.includes('|---|---|') && ascii.includes('| 乙 | 2 |'), ascii)
  check('ASCII 边框不再残留', !ascii.includes('+--'), ascii)

  // 原生表格缺分隔线自动补齐
  const missingSep = smartFormatText('| 列A | 列B |\n| a1 | b1 |\n| a2 | b2 |')
  check('缺分隔线自动补齐', missingSep.split('\n').filter(l => l.startsWith('|---')).length === 1, missingSep)

  // 中英文排版规范化
  const punct = smartFormatText('首先,我们看数据;然后分析:结果如何?很好!')
  check('半角标点转全角', punct.includes('首先，我们看数据；然后分析：结果如何？很好！'), punct)
  const pangu = smartFormatText('使用Python和GPT-4完成智能排版,实测效率提升5倍。')
  check('盘古之白', pangu.includes('使用 Python 和 GPT-4 完成智能排版，实测效率提升 5 倍。'), pangu)
  const fullwidth = smartFormatText('第１章共１２３页')
  check('全角字母数字转半角', fullwidth.includes('第 1 章共 123 页'), fullwidth)
  const protect = smartFormatText('使用`中文var`变量,以及 [链接](https://x.com/a) 即可')
  check('行内代码内容不受影响', protect.includes('`中文var`'), protect)
  check('链接目标不受影响', protect.includes('](https://x.com/a)'), protect)

  // 代码块探测扩容：console / shell
  const js = smartFormatText('console.log("a")\nconsole.log("b")\n\n正文说明。')
  check('console 代码块识别', js.includes('```js\nconsole.log("a")\nconsole.log("b")\n```'), js)
  const sh = smartFormatText('$ npm install foo\n$ npm run build\n\n安装完成。')
  check('shell 代码块识别', sh.includes('```bash\n$ npm install foo\n$ npm run build\n```'), sh)

  // 裸链接美化与上下文保护
  const url = smartFormatText('详见 https://example.com/a。')
  check('裸链接自动包裹且剥离尾标点', url.includes('[https://example.com/a](https://example.com/a)。'), url)
  const href = smartFormatText('<a href="https://x.com/a">链接</a>')
  check('HTML 属性内 URL 不包裹', href === '<a href="https://x.com/a">链接</a>', href)
  const refdef = smartFormatText('[1]: https://example.com/paper')
  check('引用定义行原样保留', refdef === '[1]: https://example.com/paper', refdef)

  // 空行折叠（围栏外）
  const blanks = smartFormatText('段落一\n\n\n\n\n段落二')
  check('连续空行折叠', blanks === '段落一\n\n段落二', blanks)
  const fenceBlanks = smartFormatText('```text\na\n\n\n\nb\n```\n\n\n\n段落二')
  check('围栏内空行不折叠', fenceBlanks.includes('a\n\n\n\nb') && !fenceBlanks.includes('\n\n\n\n段落'), fenceBlanks)
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

  // 回归：闭合 ** 后紧跟英文/数字（AI 审稿报告高频写法，曾字面泄漏）
  const latin = markdownToSafeHtml('- **具体表现：**CAPU、ENGD 是明确声明过的本地变体')
  check('闭合**紧跟英文解析为 strong', latin.includes('<strong>具体表现：</strong>CAPU'), latin)
  const latin2 = markdownToSafeHtml('**位置：**PDF第1页；主稿第66行。')
  check('闭合**紧跟数字文件名解析', latin2.includes('<strong>位置：</strong>PDF第1页'), latin2)
  const digit = markdownToSafeHtml('**问题1、2：**先解决参考有效性')
  check('闭合**紧跟中文数字编号解析', digit.includes('<strong>问题1、2：</strong>'), digit)

  // 纯英文 CommonMark 行为保持：**bold.**紧跟字母 仍按规范字面输出
  const enStrict = markdownToSafeHtml('**bold.**followed')
  check('纯英文词内 ** 保持 CommonMark 字面', enStrict.includes('**bold.**followed'), enStrict)

  // 单字符 * 的同类失配（CJK 斜体）
  const italic = markdownToSafeHtml('这是一个*注意：*斜体标签写法')
  check('闭合*紧跟汉字解析为 em', italic.includes('<em>注意：</em>'), italic)
}

// ── 甲方验收回归（2026-09-27 导出质量事故整改）─────────────────────────────────
console.log('甲方验收回归')
{
  // ① \(\) 与 \[\] 定界符（学术/pandoc 常见写法，此前整段漏成源码）
  const paren = markdownToSafeHtml('约束为 \\(\\kappa = 10\\) 且门控 \\(\\exp(-\\kappa C_i^2)\\)。')
  check('\\(\\) 行内公式被提取', (paren.match(/math-inline/g) || []).length === 2, paren)
  check('\\(\\) 无源码残留', !paren.includes('\\(') && !paren.includes('\\kappa = 10'), paren)
  const bracket = markdownToSafeHtml('如下：\n\n\\[ u_{\\rm ref}(1,0.1) \\approx 0.17257 \\]\n\n完毕。')
  check('\\[\\] 行间公式被提取', bracket.includes('math-block'), bracket)
  check('\\[\\] 无源码残留', !bracket.includes('\\['), bracket)
  // 双反斜杠变体（AI 输出常见）
  const dbl = markdownToSafeHtml('值 \\\\(a+b\\\\) 混排')
  check('\\\\( 双反斜杠变体被提取', dbl.includes('math-inline'), dbl)
  // extractFormulas 统计同步覆盖（preflight/插件共用）
  const formulas = extractFormulas('a $x$ b \\(y\\) c $$z$$ d \\[w\\]')
  check('extractFormulas 覆盖四类定界符', formulas.length === 4, JSON.stringify(formulas))
  check('extractFormulas 行内/行间区分正确', formulas.filter(f => f.isBlock).length === 2)

  // ② KaTeX 三重复制污染修复（甲方实锤样本）
  const r = await import('../src/core/mathSyntax')
  const junk1 = '\\mathrm{u}(-1,t) = \\mathrm{u}(1,t) = 0\\mathrm{u}(-1,t) = \\mathrm{u}(1,t) = 0\\mathrm{u} (- 1,t) = 0'
  check('三重复制→单份 LaTeX（u(-1,t) 样本）', r.repairMangledFormula(junk1) === '\\mathrm{u}(-1,t) = \\mathrm{u}(1,t) = 0', r.repairMangledFormula(junk1))
  const junk2 = '\\kappa = 10\\kappa = 10\\kappa = 10'
  check('三重复制→单份（\\kappa 样本）', r.repairMangledFormula(junk2) === '\\kappa = 10', r.repairMangledFormula(junk2))
  const junk3 = 'κ=10\\kappa=10κ=10'
  check('Unicode+LaTeX 混合三份→LaTeX 份', r.repairMangledFormula(junk3) === '\\kappa=10', r.repairMangledFormula(junk3))
  const junk4 = '1.34399×10−41.34399\\times10^{-4}1.34399×10−4'
  check('数值三重复制→LaTeX 份', r.repairMangledFormula(junk4) === '1.34399\\times10^{-4}', r.repairMangledFormula(junk4))
  check('正常公式零误伤（E=mc^2）', r.repairMangledFormula('E=mc^2') === 'E=mc^2')
  check('正常公式零误伤（含 qquad 双式）', r.repairMangledFormula('u_{\\rm ref}(1,0.1)\\approx0.17,\\qquad u_{\\rm ref}(1,1)\\approx0.03') === 'u_{\\rm ref}(1,0.1)\\approx0.17,\\qquad u_{\\rm ref}(1,1)\\approx0.03')
  // 修复在管线内生效：预览与导出共享同一修复结果
  const pipelineFixed = markdownToSafeHtml('规定 \\(' + junk1 + '\\)，且 \\(\\kappa = 10\\)。')
  const restored = decodeURIComponent((pipelineFixed.match(/data-formula="([^"]*)"/) || [])[1] || '')
  check('管线内公式已修复为单份', restored === '\\mathrm{u}(-1,t) = \\mathrm{u}(1,t) = 0', restored)

  // ③ PDF 分页标记 → 真正分页符（正文不得出现 ===== Page X =====）
  const pm = markdownToSafeHtml('第一页\n\n===== Page 1 =====\n\n第二页\n\n----- Page 2 -----\n\n第三页')
  check('==== Page 标记转为分页符', !pm.includes('=====') && (pm.match(/class="pagebreak"/g) || []).length === 2, pm)
  const pm2 = markdownToSafeHtml('正文 A\n\n================ Page 3 ================\n\n正文 B')
  check('长等号变体也识别', !pm2.includes('====') && pm2.includes('class="pagebreak"'), pm2)
  check('分隔线不受影响（--- 仍是 hr）', markdownToSafeHtml('a\n\n---\n\nb').includes('<hr'))
  check('含 Page 字样的普通句子不受影响', !markdownToSafeHtml('见 Page 12 的说明').includes('pagebreak'))

  // ④ 转义加粗修复（\*\*位置：\*\*PDF第1页）
  const esc = markdownToSafeHtml('\\*\\*问题类型：\\*\\*数据质量；以及\\*\\*位置：\\*\\*PDF第1页。')
  check('\\*\\*转义对还原为 strong', esc.includes('<strong>问题类型：</strong>') && esc.includes('<strong>位置：</strong>PDF第1页'), esc)
  check('单个 \\* 转义不受影响', !markdownToSafeHtml('用 \\* 表示星号').includes('<strong>'))

  // ⑤ HTML 表格（整段 + 混排段落）提升为真表格，标签不得漏出
  const tbl1 = markdownToSafeHtml('<table><tr><td>a</td><td>b</td></tr></table>')
  check('整段 HTML 表格保留为真表格', (tbl1.match(/<table>/g) || []).length === 1 && !tbl1.includes('&lt;table'), tbl1)
  const tbl2 = markdownToSafeHtml('<p>前文说明 &lt;table&gt;&lt;tr&gt;&lt;td&gt;单元格&lt;/td&gt;&lt;td&gt;d&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt; 后文说明</p>')
  check('混排段落表格被抽出', (tbl2.match(/<table>/g) || []).length === 1, tbl2)
  check('混排段落前后文本保留', tbl2.includes('前文说明') && tbl2.includes('后文说明'), tbl2)
  check('标签不再以文本漏出', !tbl2.includes('&lt;table'), tbl2)
  // 表格里的公式占位符仍能还原
  const tblMath = markdownToSafeHtml('<table><tr><td>值 $a^2+b^2$ 单元</td></tr></table>')
  check('表格内公式正常提取', tblMath.includes('math-inline'), tblMath)

  // ⑥ 表题自动编号唯一性：120 个表题连续识别（甲方验收用例 5）
  const capMd = Array.from({ length: 120 }, (_, i) => `*表：第${i + 1}张表说明*`).join('\n\n')
  const capHtml = markdownToSafeHtml(capMd)
  const capCount = (capHtml.match(/data-kind="tbl"/g) || []).length
  check('120 个表题全部识别', capCount === 120, `count=${capCount}`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
