/**
 * 扩展 UI 稳定性测试（P4C 第十四节 多选模式 + 第二十一节 下载文件名）：
 *
 *   - 多选：选 1 条 / 20 条 / 全选 / 全不选 / 只选用户 / 只选 AI / 反选 /
 *     退出模式清理，选择顺序必须按对话原始（DOM）顺序；
 *   - 文件名：中文 / 英文 / Emoji / 特殊字符 / 超长 / 无标题（buildExportFilename）。
 *
 * 运行：npx tsx scripts/test-ext-ui.ts
 */

import { JSDOM } from 'jsdom'
import { ChatUI } from '../extension/src/content/chatUi'
import { buildExportFilename } from '../src/core/filename'

// ── JSDOM 环境 ────────────────────────────────────────────────────────────────

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://chatgpt.com/',
  pretendToBeVisual: true,
})
dom.window.Element.prototype.getBoundingClientRect = function () {
  return {
    x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 50,
    width: 100, height: 50, toJSON: () => ({}),
  } as DOMRect
}
// ChatUI.isDark 使用 matchMedia / getComputedStyle
;(dom.window as unknown as Record<string, unknown>).matchMedia =
  (query: string) => ({ matches: false, media: query, addListener: () => {}, removeListener: () => {} })
;(globalThis as Record<string, unknown>).window = dom.window
;(globalThis as Record<string, unknown>).document = dom.window.document
;(globalThis as Record<string, unknown>).Element = dom.window.Element
;(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement
;(globalThis as Record<string, unknown>).Node = dom.window.Node
;(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number

// ── 微型测试框架 ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures: string[] = []

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    failures.push(`${label}${detail ? ` —— ${detail}` : ''}`)
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

// ── 多选模式 ─────────────────────────────────────────────────────────────────

console.log('\n── 多选模式稳定性 ──')
{
  const ui = new ChatUI()

  // 30 条消息：偶数位用户、奇数位 AI（DOM 顺序）
  const elements: HTMLElement[] = []
  for (let i = 0; i < 30; i++) {
    const el = document.createElement('div')
    el.textContent = `消息 ${i}`
    document.body.appendChild(el)
    elements.push(el)
  }
  const roleOf = (i: number) => (i % 2 === 0 ? 'user' : 'assistant')

  ui.enterSelectionMode(elements, new Set(), {
    onToggle: () => {},
    onChange: () => {},
  })
  ui.showSelectionBar(
    { count: 0, total: elements.length },
    {
      onSelectAll: () => {}, onSelectNone: () => {}, onSelectUsers: () => {},
      onSelectAssistants: () => {}, onInvert: () => {}, onExportWord: () => {},
      onExportPdf: () => {}, onEditInMarkDoc: () => {}, onExit: () => {},
    },
  )

  // 选择 1 条
  ui.selectMessage(elements[7], true)
  assert(ui.getSelectedInOrder().length === 1 && ui.getSelectedInOrder()[0] === elements[7], '选择 1 条')
  // 累计 20 条
  for (let i = 0; i < 20; i++) ui.selectMessage(elements[i], true)
  assert(ui.getSelectedInOrder().length === 20, '累计选择 20 条', String(ui.getSelectedInOrder().length))
  // 顺序 = DOM 顺序（打乱选择顺序仍按 DOM 排列）
  ui.selectMessage(elements[3], false)
  ui.selectMessage(elements[3], true)
  const selected = ui.getSelectedInOrder()
  assert(selected.every((el, i) => i === 0 || elements.indexOf(selected[i - 1]) < elements.indexOf(el)),
    '选择顺序保持对话原始（DOM）顺序')

  // 全选
  for (const el of elements) ui.selectMessage(el, true)
  assert(ui.getSelectedInOrder().length === 30, '全选 30 条')
  // 全不选
  for (const el of elements) ui.selectMessage(el, false)
  assert(ui.getSelectedInOrder().length === 0, '全不选')
  // 只选用户
  for (const el of elements) ui.selectMessage(el, roleOf(elements.indexOf(el)) === 'user')
  assert(ui.getSelectedInOrder().length === 15 && ui.getSelectedInOrder().every((el) => elements.indexOf(el) % 2 === 0),
    '只选用户（15 条，全部偶数位）')
  // 只选 AI
  for (const el of elements) ui.selectMessage(el, roleOf(elements.indexOf(el)) === 'assistant')
  assert(ui.getSelectedInOrder().length === 15 && ui.getSelectedInOrder().every((el) => elements.indexOf(el) % 2 === 1),
    '只选 AI（15 条，全部奇数位）')
  // 反选
  for (const el of elements) {
    ui.selectMessage(el, !ui.isMessageSelected(el))
  }
  assert(ui.getSelectedInOrder().length === 15 && ui.getSelectedInOrder().every((el) => elements.indexOf(el) % 2 === 0),
    '反选生效')

  // 大消息量：100 条全选顺序不乱
  const big: HTMLElement[] = []
  for (let i = 0; i < 100; i++) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    big.push(el)
  }
  const ui2 = new ChatUI()
  ui2.enterSelectionMode(big, new Set(), { onToggle: () => {}, onChange: () => {} })
  // 乱序点击
  for (const i of [55, 3, 99, 20, 41, 8, 76]) ui2.selectMessage(big[i], true)
  const ordered = ui2.getSelectedInOrder().map((el) => big.indexOf(el))
  assert(ordered.join(',') === ordered.slice().sort((a, b) => a - b).join(','),
    '乱序点击 100 条场景顺序仍为 DOM 序')

  // 退出清理
  ui.exitSelectionMode()
  assert(!ui.isSelectionMode(), '退出选择模式')
  ui2.exitSelectionMode()

  // 残留检查：页面上不应有任何 markdoc checkbox 残留（shadow 内部无法直接查，
  // 用行为验证：重新进入模式后选择集合为空）
  ui.enterSelectionMode(elements, new Set(), { onToggle: () => {}, onChange: () => {} })
  assert(ui.getSelectedInOrder().length === 0, '重新进入后无选择状态残留')
  ui.exitSelectionMode()
}

// ── 文件名可靠性 ─────────────────────────────────────────────────────────────

console.log('\n── 下载文件名可靠性 ──')
{
  const cases: Array<{ title: string; label: string; expect?: string }> = [
    { title: '反向传播原理讲解', label: '中文标题' },
    { title: 'Backpropagation Guide', label: '英文标题' },
    { title: '训练🚀指南✨', label: 'Emoji 标题' },
    { title: '第1章/导出*什么是?训练', label: '特殊字符过滤' },
    { title: '超长标题'.repeat(30), label: '超长标题截断' },
  ]
  for (const c of cases) {
    const name = buildExportFilename('# 正文', c.title)
    assert(name.length > 0 && name.length <= 60, `${c.label}（${name.slice(0, 30)}${name.length > 30 ? '…' : ''}）`,
      `len=${name.length}`)
    assert(!/[/\\:*?"<>|]/.test(name), `${c.label} 无非法字符`, name)
  }
  // 无标题 → 日期兜底
  const fallback = buildExportFilename('没有标题的正文', '')
  assert(/^MarkDoc-\d{4}-\d{2}-\d{2}$/.test(fallback), '无标题时日期兜底', fallback)
  // 标题优先于正文标题
  const fromTitle = buildExportFilename('# 正文里的标题', '设置里的标题')
  assert(fromTitle === '设置里的标题', '设置标题优先', fromTitle)
  // 正文标题兜底
  const fromHeading = buildExportFilename('# 正文里的标题', '')
  assert(fromHeading === '正文里的标题', '正文首个标题兜底', fromHeading)
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n失败明细:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
