/**
 * AI 内容修复（aiWordFix）单元测试：公式断层 / 图表断层 / 结构污染 /
 * 围栏与公式保护、不误伤正常内容。
 *
 * 运行：npx tsx scripts/test-ai-word-fix.ts
 */
import {
  fixAiWordContent,
  analyzeAiWordProblems,
  formulaReadiness,
} from '../src/core/aiWordFix'

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

// ─── 公式断层：定界符转换 ────────────────────────────────────────────────────
console.log('公式断层：定界符转换')
{
  const { fixed } = fixAiWordContent('行内公式 \\(E = mc^2\\) 测试。')
  check('\\(…\\) → $…$', fixed.includes('行内公式 $E = mc^2$ 测试。'), fixed)

  const { fixed: f2 } = fixAiWordContent('\\[x = \\frac{1}{2}\\]')
  check('\\[…\\] → $$…$$', f2.includes('$$x = \\frac{1}{2}$$'), f2)

  // 多行 \\[ \\]
  const { fixed: f3 } = fixAiWordContent('\\[\n\\sum_{i=1}^n i\n\\]')
  check('多行 \\[…\\] → $$…$$', f3.includes('$$') && f3.includes('\\sum_{i=1}^n i'), f3)
}

// ─── 公式断层：Word 线性公式 ────────────────────────────────────────────────
console.log('公式断层：Word 线性公式')
{
  const { fixed } = fixAiWordContent('∑_(i=1)^n▒x_i^2')
  check('∑_(i=1)^n▒x_i^2 → $$\\sum…$$', fixed.includes('$$\\sum_{i=1}^n x_i^2$$'), fixed)

  const { fixed: f2 } = fixAiWordContent('(a+b)^(2) = a^2 + 2ab')
  check('^(2) → ^{2}', f2.includes('^{2}'), f2)

  // 含中文的线性公式：转换但不强包（避免吞正文）
  const { fixed: f3 } = fixAiWordContent('总面积▒πr^2')
  check('含中文时转换但不包 $$', !f3.includes('$$') && f3.includes('\\pi r^2'), f3)

  // 中文句内嵌公式：片段级包裹 $…$（最常见场景）
  const { fixed: f5 } = fixAiWordContent('傅里叶变换的公式是∑_(−∞)^∞▒f(t)，欧拉公式 e^(iθ) = cosθ + isinθ。')
  check('句内公式局部包裹 $…$', f5.includes('是$\\sum_{−\\infty}^\\infty f(t)$，'), f5)
  check('欧拉公式片段同样包裹', f5.includes('$e^{i\\theta} = cos\\theta + isin\\theta$。'), f5)
  check('中文正文原样保留', f5.includes('傅里叶变换的公式是') && f5.includes('，欧拉公式'), f5)

  // 正常中文里的 × 不误伤
  const { fixed: f4, fixes } = fixAiWordContent('把 3 × 4 的结果写下来')
  check('普通中文含 × 不触发', fixes.length === 0 && f4.includes('3 × 4'), f4)
}

// ─── 公式断层：裸环境包裹 ───────────────────────────────────────────────────
console.log('公式断层：裸公式环境')
{
  const src = '分段函数：\n\\begin{cases}\nx^2, & x \\ge 0 \\\\\n-x, & x < 0\n\\end{cases}\n结束'
  const { fixed } = fixAiWordContent(src)
  const lines = fixed.split('\n')
  const beginIdx = lines.findIndex((l) => l.includes('\\begin{cases}'))
  check('环境前插入 $$', lines[beginIdx - 1] === '$$', fixed)
  const endIdx = lines.findIndex((l) => l.includes('\\end{cases}'))
  check('环境后插入 $$', lines[endIdx + 1] === '$$', fixed)
}

// ─── 图表断层：Mermaid 围栏重建 ─────────────────────────────────────────────
console.log('图表断层：Mermaid 围栏重建')
{
  const src = '流程如下：\ngraph TD\nA[开始] --> B{判断条件}\nB --> C[结束]\n\n以上就是流程。'
  const { fixed } = fixAiWordContent(src)
  check('重建 ```mermaid 围栏', fixed.includes('```mermaid\ngraph TD'), fixed)
  check('围栏正确闭合', (fixed.match(/```/g) || []).length === 2, fixed)

  // 已有围栏的不动
  const { fixed: f2 } = fixAiWordContent('```mermaid\ngraph TD\nA --> B\n```')
  check('已围栏的图表不重复处理', (f2.match(/```/g) || []).length === 2, f2)

  // 单行箭头文本不误伤（需要 ≥2 行图表特征）
  const { fixed: f3, fixes } = fixAiWordContent('转换规则：A --> B 表示推进')
  check('单行箭头说明不误伤', fixes.filter((f) => f.category === 'chart').length === 0 && !f3.includes('```mermaid'), f3)
}

// ─── 结构污染清理 ───────────────────────────────────────────────────────────
console.log('结构污染清理')
{
  const src = '标题\u200B文本\u00A0连接\uFF21\uFF22\uFF23１２３'
  const { fixed } = fixAiWordContent(src)
  check('零宽字符被清理', !fixed.includes('\u200B'), fixed)
  check('NBSP 转空格', !fixed.includes('\u00A0') && fixed.includes('文本 连接'), fixed)
  check('全角字母数字转半角', fixed.includes('ABC123'), fixed)

  // 全角标点是合法中文排版，不动
  const { fixed: f2 } = fixAiWordContent('注意：这是测试！对吧？')
  check('全角标点不受影响', f2.includes('！') && f2.includes('？'), f2)
}

// ─── 保护规则：围栏与公式内不动 ─────────────────────────────────────────────
console.log('保护规则')
{
  const src = '```\n\\(不转换\\) \u200B\n```'
  const { fixed } = fixAiWordContent(src)
  check('代码围栏内完全不动', fixed.includes('\\(不转换\\)') && fixed.includes('\u200B'), fixed)

  const { fixed: f2 } = fixAiWordContent('公式 $a_(1)$ 与 \\(b\\) 混合')
  check('已有 $…$ 内不改', f2.includes('$a_(1)$'), f2)
  check('混合行只转定界符部分', f2.includes('$b$'), f2)

  // $$ 块内的 Word 线性特征不动（已是公式）
  const src3 = '$$\n∑_(i=1)^n▒x_i\n$$'
  const { fixed: f3 } = fixAiWordContent(src3)
  check('$$ 块内不做线性转换', f3.includes('▒'), f3)
}

// ─── 诊断与修复一致性 + 公式就绪度 ─────────────────────────────────────────
console.log('诊断一致性与公式就绪度')
{
  const src = '∑_(i=1)^n▒x_i'
  const diag = analyzeAiWordProblems(src)
  check('诊断报告与修复一致', diag.some((f) => f.category === 'math' && f.label.includes('Word 线性公式')), JSON.stringify(diag))

  const before = formulaReadiness('∑_(i=1)^n▒x_i')
  check('修复前疑似行 = 1', before.suspiciousLines === 1, JSON.stringify(before))
  const after = formulaReadiness(fixAiWordContent('∑_(i=1)^n▒x_i').fixed)
  check('修复后疑似行 = 0', after.suspiciousLines === 0, JSON.stringify(after))
  check('修复后可识别公式 = 1', after.convertible === 1, JSON.stringify(after))
}

// ─── 干净内容零修复 ────────────────────────────────────────────────────────
console.log('干净内容零修复')
{
  const clean = '# 标题\n\n正常段落，含「中文引号」与 m² 单位。\n\n$$E = mc^2$$\n'
  const { fixed, fixes } = fixAiWordContent(clean)
  check('干净内容不变', fixed === clean, JSON.stringify(fixes))
  check('无修复报告', fixes.length === 0, JSON.stringify(fixes))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
