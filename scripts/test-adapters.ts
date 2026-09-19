/**
 * Adapter DOM 测试（规范三十四/三十五/三十六/三十七节）：
 *
 *   fixture（人工构造，无真实聊天）→ JSDOM → Adapter 提取 → 断言
 *
 * 覆盖：消息数量与顺序、Markdown 还原（公式/表格/代码/图片/链接/列表）、
 * 主选择器失效时 fallback 生效、缺标题、缺公式 annotation、
 * 图片加载失败、未知节点、代码块按钮文字不混入。
 */

import { readFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { JSDOM } from 'jsdom'
import { ChatGptAdapter } from '../extension/src/adapters/chatgpt'
import { DeepSeekAdapter } from '../extension/src/adapters/deepseek'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'tests/fixtures')

// ── JSDOM 环境 ────────────────────────────────────────────────────────────────

let currentDom: JSDOM | null = null

async function loadFixture(platform: 'chatgpt' | 'deepseek', name: string): Promise<JSDOM> {
  const html = readFileSync(join(FIXTURES, platform, `${name}.html`), 'utf-8')
  const url = platform === 'chatgpt' ? 'https://chatgpt.com/' : 'https://chat.deepseek.com/'
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true })
  // jsdom 无布局引擎：getBoundingClientRect 恒为 0，会让 isVisible 误判隐藏。
  // 测试环境统一 mock 为非零尺寸（生产环境是真实浏览器布局，不受影响）。
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 50,
      width: 100, height: 50,
      toJSON: () => ({}),
    } as DOMRect
  }
  // 全局 document/location 指向当前 fixture（adapter 内部使用全局）
  ;(globalThis as Record<string, unknown>).document = dom.window.document
  ;(globalThis as Record<string, unknown>).location = dom.window.location
  ;(globalThis as Record<string, unknown>).MutationObserver = dom.window.MutationObserver
  ;(globalThis as Record<string, unknown>).Node = dom.window.Node
  ;(globalThis as Record<string, unknown>).Element = dom.window.Element
  ;(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement
  currentDom = dom
  return dom
}

// ── 微型测试框架 ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures: string[] = []
let currentGroup = ''

function group(name: string) {
  currentGroup = name
  console.log(`\n── ${name} ──`)
}

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    failures.push(`[${currentGroup}] ${label}${detail ? ` —— ${detail}` : ''}`)
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function assertIn(haystack: string | undefined, needle: string, label: string) {
  assert(!!haystack && haystack.includes(needle), label, `期望包含「${needle}」，实际：${(haystack || '').slice(0, 120)}`)
}

function assertNotIn(haystack: string | undefined, needle: string, label: string) {
  assert(!haystack || !haystack.includes(needle), label, `不应包含「${needle}」`)
}

// ── ChatGPT ──────────────────────────────────────────────────────────────────

group('ChatGPT: basic')
{
  const dom = await loadFixture('chatgpt', 'v1-basic')
  const adapter = new ChatGptAdapter()
  assert(adapter.detect(), 'detect() 识别 chatgpt.com')
  assert(adapter.getConversationTitle() === '简单问答', '对话标题来自侧栏', adapter.getConversationTitle())
  const msgs = await adapter.getMessages()
  assert(msgs.length === 2, '2 条消息（1 用户 + 1 AI）', `实际 ${msgs.length}`)
  assert(msgs[0].role === 'user' && msgs[1].role === 'assistant', '角色顺序正确')
  assertIn(msgs[1].markdown, '梯度下降', 'AI 回答正文保留')
  assertIn(msgs[1].markdown, '**优化算法**', '粗体还原为 **')
  assertIn(msgs[0].markdown, '什么是梯度下降', '用户消息文本保留')
}

group('ChatGPT: math（LaTeX 恢复）')
{
  const dom = await loadFixture('chatgpt', 'v1-math')
  const adapter = new ChatGptAdapter()
  const msgs = await adapter.getMessages()
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '$E = mc^2$', '行内公式恢复 LaTeX')
  assertIn(md, '$$', '块级公式围栏存在')
  assertIn(md, '\\sum_{i=1}^{n} w_i x_i + b', '块级公式恢复 LaTeX（求和）')
  assertIn(md, '\\begin{pmatrix}', '矩阵环境保留')
  assertIn(md, '\\begin{cases}', '分段函数环境保留')
  assertIn(md, '$x_i$', '下标公式')
  assertIn(md, '\\sqrt{x^2 + 1}', '根号公式')
  assertNotIn(md, 'katex-html', 'KaTeX 渲染 DOM 不混入')
}

group('ChatGPT: table')
{
  const dom = await loadFixture('chatgpt', 'v1-table')
  const adapter = new ChatGptAdapter()
  const msgs = await adapter.getMessages()
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '| 优化器 | 学习率 | 收敛轮数 |', '表头转换为 GFM')
  assertIn(md, '| --- | --- | --- |', '分隔行存在')
  assertIn(md, '| SGD | 0.01 | 120 |', '数据行保留')
  assertIn(md, '| Adam | 0.001 | 45 |', '第二行保留')
}

group('ChatGPT: code（按钮文字不入文档）')
{
  const dom = await loadFixture('chatgpt', 'v1-code')
  const adapter = new ChatGptAdapter()
  const msgs = await adapter.getMessages()
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '```python', 'Python 代码块语言标注')
  assertIn(md, 'def backward(grad_output):', '代码内容保留')
  assertIn(md, '```javascript', 'JavaScript 代码块语言标注')
  assertNotIn(md, '复制代码', '「复制代码」按钮不混入')
  assertNotIn(md, 'Copy', '「Copy」按钮不混入')
  assertNotIn(md, 'python复制', '语言标签不重复混入')
}

group('ChatGPT: images')
{
  const dom = await loadFixture('chatgpt', 'v1-images')
  const adapter = new ChatGptAdapter()
  const msgs = await adapter.getMessages()
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '![训练损失曲线](data:image/png;base64,', 'data URI 图片转为 Markdown 图片')
  assertIn(md, '![网络架构图](https://example.com/architecture.png)', '外链图片保留 URL')
  assertIn(md, '[1](https://arxiv.org/abs/1206.5533)', '引用链接保留')
}

group('ChatGPT: mixed（场景 A 内容面）')
{
  const dom = await loadFixture('chatgpt', 'v1-mixed')
  const adapter = new ChatGptAdapter()
  const msgs = await adapter.getMessages()
  const assistant = msgs.filter((m) => m.role === 'assistant')
  assert(assistant.length === 2, '两条 AI 回答', `实际 ${assistant.length}`)
  const md = assistant[0].markdown
  assertIn(md, '## 反向传播原理', '标题层级保留')
  assertIn(md, '### Python 实现', '三级标题保留')
  assertIn(md, '\\frac{\\partial L}{\\partial w^{(l)}}', '块级公式（链式法则）')
  assertIn(md, '| SGD | 0.01 | 120 |', '表格')
  assertIn(md, '```python', '代码块')
  assertIn(md, '- 前向传播计算输出', '无序列表')
  assertIn(md, '    - 输出层直接计算', '嵌套列表缩进')
  assertIn(md, '> 注意：学习率过大', '引用块逐行前缀')
  assertIn(md, '[OpenAI 官网](https://openai.com)', '链接')
  assertIn(md, '---', '水平分割线')
  assertIn(assistant[1].markdown, '```mermaid', 'Mermaid 源码保留（优先于渲染结果）')
  assertIn(assistant[1].markdown, 'graph TD', 'Mermaid 内容完整')
}

group('ChatGPT: conversation（顺序与计数）')
{
  const dom = await loadFixture('chatgpt', 'v1-conversation')
  const adapter = new ChatGptAdapter()
  const msgs = await adapter.getMessages()
  assert(msgs.length === 6, '6 条消息', `实际 ${msgs.length}`)
  const roles = msgs.map((m) => m.role).join(',')
  assert(roles === 'user,assistant,user,assistant,user,assistant', '对话顺序正确', roles)
  assertIn(msgs[1].markdown, '梯度消失', '第一答')
  assertIn(msgs[3].markdown, '1. ReLU 激活函数', '有序列表还原')
  assertIn(msgs[5].markdown, '\\hat{x}', '末答公式')
}

group('ChatGPT: fallback（主选择器失效）')
{
  const dom = await loadFixture('chatgpt', 'v1-fallback')
  const adapter = new ChatGptAdapter()
  const msgs = await adapter.getMessages()
  assert(msgs.length >= 2, 'article fallback 提取到消息', `实际 ${msgs.length}`)
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '**回答**', 'fallback 路径内容完整')
}

group('ChatGPT: degraded（降级路径）')
{
  const dom = await loadFixture('chatgpt', 'v1-degraded')
  const adapter = new ChatGptAdapter()
  const msgs = await adapter.getMessages()
  assert(msgs.length >= 1, '降级场景仍能提取')
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, 'θ', '缺 annotation 公式降级为文本')
  assertIn(md, 'broken.png', '加载失败图片保留占位')
  assertIn(md, '未知嵌套节点', '未知节点内的文字保留')
  assertNotIn(md, '思考过程不应导出', '思考过程不混入文档')
  assertIn(md, '思考之后可见的正文', '思考后的正文保留')
  assert(adapter.getConversationTitle() === '', '缺标题时返回空串（调用方兜底）')
}

// ── DeepSeek ─────────────────────────────────────────────────────────────────

group('DeepSeek: basic')
{
  const dom = await loadFixture('deepseek', 'v1-basic')
  const adapter = new DeepSeekAdapter()
  assert(adapter.detect(), 'detect() 识别 chat.deepseek.com')
  assert(adapter.getConversationTitle() === '梯度下降基础', '标题来自 document.title 兜底', adapter.getConversationTitle())
  const msgs = await adapter.getMessages()
  assert(msgs.length === 2, '2 条消息', `实际 ${msgs.length}`)
  assert(msgs[0].role === 'user' && msgs[1].role === 'assistant', '角色正确')
  assertIn(msgs[1].markdown, '**损失函数**', '粗体还原')
}

group('DeepSeek: math')
{
  const dom = await loadFixture('deepseek', 'v1-math')
  const adapter = new DeepSeekAdapter()
  const msgs = await adapter.getMessages()
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '\\frac{1}{n}', '行内分式')
  assertIn(md, '\\nabla_\\theta L(\\theta)', '块级梯度公式')
  assertNotIn(md, 'katex-html', '渲染 DOM 不混入')
}

group('DeepSeek: table')
{
  const dom = await loadFixture('deepseek', 'v1-table')
  const adapter = new DeepSeekAdapter()
  const msgs = await adapter.getMessages()
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '| 优化器 | 学习率 | 收敛轮数 |', 'GFM 表格')
  assertIn(md, '| SGD | 0.01 | 120 |', '数据行')
}

group('DeepSeek: code')
{
  const dom = await loadFixture('deepseek', 'v1-code')
  const adapter = new DeepSeekAdapter()
  const msgs = await adapter.getMessages()
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '```python', 'Python 块')
  assertIn(md, '```sql', 'SQL 块')
  assertIn(md, 'SELECT id, loss FROM runs', 'SQL 内容')
  assertNotIn(md, '复制', '「复制」按钮不混入')
}

group('DeepSeek: mixed（与 ChatGPT 提取路径独立验证）')
{
  const dom = await loadFixture('deepseek', 'v1-mixed')
  const adapter = new DeepSeekAdapter()
  const msgs = await adapter.getMessages()
  const assistant = msgs.filter((m) => m.role === 'assistant')
  assert(assistant.length === 2, '两条 AI 回答')
  assertIn(assistant[0].markdown, '\\frac{\\partial L}{\\partial w^{(l)}}', '块级公式')
  assertIn(assistant[0].markdown, '```python', '代码块')
  assertIn(assistant[0].markdown, '> 注意：学习率过大', '引用块')
  assertIn(assistant[1].markdown, '```mermaid', 'Mermaid 源码')
}

group('DeepSeek: conversation')
{
  const dom = await loadFixture('deepseek', 'v1-conversation')
  const adapter = new DeepSeekAdapter()
  const msgs = await adapter.getMessages()
  assert(msgs.length === 4, '4 条消息', `实际 ${msgs.length}`)
  const roles = msgs.map((m) => m.role).join(',')
  assert(roles === 'user,assistant,user,assistant', '顺序正确', roles)
}

group('DeepSeek: fallback（_ds_markdown 变体）')
{
  const dom = await loadFixture('deepseek', 'v1-fallback')
  const adapter = new DeepSeekAdapter()
  const msgs = await adapter.getMessages()
  assert(msgs.length >= 2, '变体类名 fallback 提取到消息', `实际 ${msgs.length}`)
  const md = msgs.find((m) => m.role === 'assistant')?.markdown
  assertIn(md, '**回答**', 'fallback 内容完整')
}

// ── observeNewMessages（动态新消息）────────────────────────────────────────────

group('动态新消息（MutationObserver）')
{
  const dom = await loadFixture('chatgpt', 'v1-basic')
  const adapter = new ChatGptAdapter()
  const seen: string[] = []
  const stop = adapter.observeNewMessages?.((msg) => seen.push(msg.role))

  // 模拟流式输出完成后新增一条回答
  const list = dom.window.document.getElementById('conversation-list')!
  const turn = dom.window.document.createElement('div')
  turn.setAttribute('data-testid', 'conversation-turn-99')
  turn.innerHTML = `<div data-message-author-role="assistant" data-message-id="new-1"><div class="markdown"><p>新回答已生成</p></div></div>`
  list.appendChild(turn)

  await new Promise((r) => setTimeout(r, 900))
  assert(seen.includes('assistant'), '新消息被 observer 捕获', `seen=${JSON.stringify(seen)}`)
  stop?.()
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────

console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n失败明细:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
