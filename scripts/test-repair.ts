/**
 * 「修复格式」单元测试（repair.ts）：
 *   货币 $ 零误伤 / $$ 块内部保护 / 行内公式补全门槛 /
 *   表格「表头+分隔行+单行表体」修复 / 多行表体以表头为基准 / 合法内容零改动。
 *
 * 运行：npx tsx scripts/test-repair.ts
 */
import { repairAiMarkdown } from '../src/core/repair'

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

function hasFix(result: { fixes: Array<{ message: string }> }, keyword: string): boolean {
  return result.fixes.some((f) => f.message.includes(keyword))
}

// ── 货币 $ 零误伤（此前「请支付 $100」会被改坏成 $100$）──────────────────────
console.log('货币 $ 零误伤')
{
  const money = repairAiMarkdown('请支付 $100 后发货，优惠 $20。')
  check('奇数个货币 $ 不补全', money.fixed.includes('请支付 $100 后发货，优惠 $20。'), money.fixed)
  check('不产生公式修复记录', !hasFix(money, '行内公式'), JSON.stringify(money.fixes))

  const codeMoney = repairAiMarkdown('套餐 `价格 $5` 之外收 $6')
  check('行内代码里的 $ 不参与计数', codeMoney.fixed.includes('套餐 `价格 $5` 之外收 $6'), codeMoney.fixed)

  const evenMoney = repairAiMarkdown('花了 $50，剩 $50')
  check('成对货币 $ 不动', evenMoney.fixes.length === 0, JSON.stringify(evenMoney.fixes))
}

// ── $$ 公式块内部保护（此前块内合法 LaTeX 会被补 $ 损坏）────────────────────
console.log('$$ 公式块内部保护')
{
  const src = ['前文说明。', '', '$$', '\\text{价格 $5 与} x^2', '\\frac{a}{b}', '$$', '', '后文。'].join('\n')
  const r = repairAiMarkdown(src)
  check('块内行原样保留（$5 行）', r.fixed.includes('\\text{价格 $5 与} x^2'), r.fixed)
  check('块内行原样保留（frac 行）', r.fixed.includes('\\frac{a}{b}'), r.fixed)
  check('块已闭合不补 $$', !hasFix(r, '公式块'), JSON.stringify(r.fixes))

  // 单行内成对 $$x^2$$ 后跟奇数货币 $：货币不动
  const mixed = repairAiMarkdown('面积 $$x^2$$ 总价 $50')
  check('单行 $$ 对剔除后货币不动', mixed.fixed.includes('总价 $50'), mixed.fixed)
}

// ── 行内公式补全门槛：带公式特征才补 ────────────────────────────────────────
console.log('行内公式补全')
{
  const formula = repairAiMarkdown('根据 $E=mc^2 可知')
  check('带 ^ 的漏闭合公式补 $', formula.fixed.endsWith('根据 $E=mc^2 可知$'), formula.fixed)
  check('记录公式修复', hasFix(formula, '行内公式'), JSON.stringify(formula.fixes))

  const frac = repairAiMarkdown('结果为 $\\frac{1}{2 应为')
  check('带 \\frac 的漏闭合公式补 $', frac.fixed.endsWith('应为$'), frac.fixed)

  const plain = repairAiMarkdown('这句话有一个独立的$符号但无公式特征')
  check('无公式特征的孤立 $ 不补', plain.fixes.length === 0, JSON.stringify(plain.fixes))
}

// ── 表格修复（此前分隔行切断扫描，最常见形态完全修不到）────────────────────
console.log('表格修复')
{
  // 最常见形态：表头 + 分隔行 + 单行表体（此前 j>i 恒假 → 什么都不修）
  const single = repairAiMarkdown(['| 名称 | 值 |', '|---|---|', '| 甲'].join('\n'))
  check('单行表体补末尾 |', single.fixed.split('\n')[2] === '| 甲 | |', single.fixed)
  check('单行表体补缺失单元格', single.fixed.split('\n')[2].split('|').length - 2 === 2, single.fixed)
  check('记录两类修复', hasFix(single, '末尾') && hasFix(single, '单元格'), JSON.stringify(single.fixes))

  // 多行表体：以表头为基准（此前取第一行表体导致基准错乱）
  const multi = repairAiMarkdown(['| A | B | C |', '|---|---|---|', '| 1 | 2 | 3 |', '| 4 | 5 |'].join('\n'))
  const lines = multi.fixed.split('\n')
  check('完整表体行不被改动', lines[2] === '| 1 | 2 | 3 |', lines[2])
  check('缺格表体行以表头为基准补齐', (lines[3].match(/\|/g) || []).length === 4, lines[3])

  // 无分隔行的行组：保持旧行为（≥2 行才修）
  const bare = repairAiMarkdown(['| a | b', '| c | d'].join('\n'))
  check('无分隔行仍按旧行为补全', bare.fixed.split('\n').every((l) => l.trimEnd().endsWith('|')), bare.fixed)
  check('无分隔行不修单行', repairAiMarkdown('| 孤行 | x').fixes.length === 0, JSON.stringify(repairAiMarkdown('| 孤行 | x').fixes))

  // 已合法表格零误伤
  const valid = repairAiMarkdown(['| 名称 | 值 |', '|---|---|', '| 甲 | 1 |', '| 乙 | 2 |'].join('\n'))
  check('合法表格零改动', valid.fixes.length === 0, JSON.stringify(valid.fixes))

  // 水平线 --- 不被当成表格行
  const hr = repairAiMarkdown(['正文。', '', '---', '', '| a | b |', '|---|---|', '| 1 | 2 |'].join('\n'))
  check('--- 水平线不受表格修复影响', hr.fixed.includes('\n---\n') && hr.fixes.length === 0, JSON.stringify(hr.fixes))
}

// ── 原有能力不回退 ──────────────────────────────────────────────────────────
console.log('原有能力不回退')
{
  const heading = repairAiMarkdown('##标题')
  check('# 后补空格', heading.fixed === '## 标题', heading.fixed)

  const fence = repairAiMarkdown('```python\ndef f():\n    return 1')
  check('未闭合代码块补全', fence.fixed.endsWith('```') && hasFix(fence, '代码块'), fence.fixed)

  const bold = repairAiMarkdown('这是**加粗的文字')
  check('未闭合粗体补全', bold.fixed.endsWith('**') && hasFix(bold, '粗体'), bold.fixed)

  const inlineCode = repairAiMarkdown('这是`行内代码')
  check('未闭合行内代码补全', inlineCode.fixed.endsWith('`') && hasFix(inlineCode, '行内代码'), inlineCode.fixed)

  const blockMath = repairAiMarkdown('前文\n\n$$\nx = 1')
  check('未闭合公式块补全', blockMath.fixed.endsWith('$$') && hasFix(blockMath, '公式块'), blockMath.fixed)

  // 代码围栏内的内容绝对不动
  const fenced = repairAiMarkdown(['```text', '| a | b', '$100', '```'].join('\n'))
  check('围栏内原样保留', fenced.fixed.includes('| a | b') && fenced.fixed.includes('$100') && fenced.fixes.length === 0, fenced.fixed)

  const empty = repairAiMarkdown('')
  check('空文本原样返回', empty.fixed === '' && empty.fixes.length === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
