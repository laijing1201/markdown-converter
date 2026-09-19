/**
 * 扩展导出管线测试（chatDocument 层）+ 大对话性能测试（规范四十一节）：
 *
 *   Adapter 提取结果 → buildChatDocument（answer/qa/selection/conversation）
 *   → 断言文档结构、角色处理、来源附录、标题降级
 *
 * 性能：100 / 200 / 500 条消息的对话，测 extraction + 文档构建耗时。
 * （同一 markdown 同时喂给 DOCX / PDF 两条渲染管线，内容一致性由
 *   结构同源保证，另由 scripts/test-ext-e2e.mjs 在真实浏览器中验证产物。）
 */

import { readFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { JSDOM } from 'jsdom'
import { ChatGptAdapter } from '../extension/src/adapters/chatgpt'
import {
  buildChatDocument,
  demoteHeadings,
  collectSources,
  emptyStats,
} from '../extension/src/extraction/chatDocument'
import type { ChatMessage } from '../extension/src/types'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'tests/fixtures')

async function loadFixture(platform: 'chatgpt' | 'deepseek', name: string): Promise<JSDOM> {
  const html = readFileSync(join(FIXTURES, platform, `${name}.html`), 'utf-8')
  const url = platform === 'chatgpt' ? 'https://chatgpt.com/' : 'https://chat.deepseek.com/'
  const dom = new JSDOM(html, { url, pretendToBeVisual: true })
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 50, top: 0, left: 0, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
  ;(globalThis as Record<string, unknown>).document = dom.window.document
  ;(globalThis as Record<string, unknown>).location = dom.window.location
  ;(globalThis as Record<string, unknown>).Node = dom.window.Node
  ;(globalThis as Record<string, unknown>).Element = dom.window.Element
  ;(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement
  ;(globalThis as Record<string, unknown>).MutationObserver = dom.window.MutationObserver
  return dom
}

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
  assert(!!haystack && haystack.includes(needle), label, `期望包含「${needle}」，实际：${(haystack || '').slice(0, 100)}`)
}

function assertNotIn(haystack: string | undefined, needle: string, label: string) {
  assert(!haystack || !haystack.includes(needle), label)
}

/** 从 fixture 提取消息 */
async function extractFromFixture(platform: 'chatgpt' | 'deepseek', name: string): Promise<{ messages: ChatMessage[]; extracts: ReturnType<typeof import('../extension/src/extraction/domToMarkdown').extractMarkdown>[] }> {
  const dom = await loadFixture(platform, name)
  const adapter = new ChatGptAdapter()
  const messages = await adapter.getMessages()
  const { extractMarkdown } = await import('../extension/src/extraction/domToMarkdown')
  const extracts = messages.map((m) =>
    extractMarkdown(
      (m.element?.querySelector('.markdown') as Element | null) ?? m.element ?? dom.window.document.body,
    ),
  )
  return { messages, extracts }
}

// ── 单条回答 ────────────────────────────────────────────────────────────────

group('answer 模式')
{
  const { messages, extracts } = await extractFromFixture('chatgpt', 'v1-mixed')
  const assistantOnly = messages.filter((m) => m.role === 'assistant')
  const { markdown, stats } = buildChatDocument(
    assistantOnly,
    extracts.filter((_, i) => messages[i].role === 'assistant'),
    {
      mode: 'answer', conversationStyle: 'dialogue', includeUserMessages: false,
      includeSources: true, conversationTitle: '反向传播原理讲解', platformName: 'ChatGPT',
    },
  )
  assertNotIn(markdown, '### 用户', '不带角色标签')
  assertNotIn(markdown, '请全面讲解', '不包含用户提问')
  assertIn(markdown, '## 反向传播原理', '回答正文保留')
  assertIn(markdown, '## 来源', '来源附录存在')
  assertIn(markdown, '[OpenAI 官网](https://openai.com)', '来源链接保留')
  assert(stats.assistantMessages === 2, '统计：2 条 AI 消息', String(stats.assistantMessages))
  assert(stats.formulas >= 3, '统计：公式 ≥ 3', String(stats.formulas))
  assert(stats.tables === 1, '统计：表格 1', String(stats.tables))
  assert(stats.codeBlocks + stats.mermaidBlocks >= 2, '统计：代码+mermaid ≥ 2', String(stats.codeBlocks + stats.mermaidBlocks))
}

// ── 问答 ────────────────────────────────────────────────────────────────────

group('qa 模式')
{
  const dom = await loadFixture('chatgpt', 'v1-conversation')
  const adapter = new ChatGptAdapter()
  const all = await adapter.getMessages()
  const qa = [all[0], all[1]]
  const { extractMarkdown } = await import('../extension/src/extraction/domToMarkdown')
  const extracts = qa.map((m) =>
    extractMarkdown((m.element?.querySelector('.markdown') as Element | null) ?? m.element!),
  )
  const { markdown } = buildChatDocument(qa, extracts, {
    mode: 'qa', conversationStyle: 'dialogue', includeUserMessages: true,
    includeSources: false, conversationTitle: '深度学习面试准备', platformName: 'ChatGPT',
  })
  assertIn(markdown, '## 问题', '问题标题')
  assertIn(markdown, '反向传播和梯度消失有什么关系', '用户问题内容')
  assertIn(markdown, '## 回答', '回答标题')
  assertIn(markdown, '**深层网络**', '回答内容')
  assert(markdown.indexOf('## 问题') < markdown.indexOf('## 回答'), '问题在回答之前')
}

// ── 多选 ────────────────────────────────────────────────────────────────────

group('selection 模式')
{
  const dom = await loadFixture('chatgpt', 'v1-conversation')
  const adapter = new ChatGptAdapter()
  const all = await adapter.getMessages()
  const picked = [all[1], all[2], all[3]] // AI / 用户 / AI，保持顺序
  const { extractMarkdown } = await import('../extension/src/extraction/domToMarkdown')
  const extracts = picked.map((m) =>
    extractMarkdown((m.element?.querySelector('.markdown') as Element | null) ?? m.element!),
  )
  const { markdown } = buildChatDocument(picked, extracts, {
    mode: 'selection', conversationStyle: 'dialogue', includeUserMessages: true,
    includeSources: false, conversationTitle: '', platformName: 'ChatGPT',
  })
  assertIn(markdown, '### AI 助手', 'AI 角色标题')
  assertIn(markdown, '### 用户', '用户角色标题')
  assertIn(markdown, '怎么缓解', '选中的用户消息内容')
  assert(markdown.indexOf('怎么缓解') < markdown.indexOf('常用方法'), '保持对话顺序')
  assertNotIn(markdown, 'BatchNorm 为什么有效', '未选中的消息不出现')
  assertNotIn(markdown, '把每层输入拉回稳定分布', '未选中的回答不出现')
}

// ── 整段对话：对话模式 / 内容整理模式 ─────────────────────────────────────────

group('conversation 对话模式')
{
  const { messages, extracts } = await extractFromFixture('chatgpt', 'v1-conversation')
  const { markdown } = buildChatDocument(messages, extracts, {
    mode: 'conversation', conversationStyle: 'dialogue', includeUserMessages: true,
    includeSources: false, conversationTitle: '深度学习面试准备', platformName: 'ChatGPT',
  })
  const userCount = (markdown.match(/### 用户/g) || []).length
  const aiCount = (markdown.match(/### AI 助手/g) || []).length
  assert(userCount === 3 && aiCount === 3, '角色标签 3+3', `${userCount}+${aiCount}`)
  assertIn(markdown, 'BatchNorm 为什么有效', '用户消息保留')
}

group('conversation 内容整理模式')
{
  const { messages, extracts } = await extractFromFixture('chatgpt', 'v1-conversation')
  const { markdown } = buildChatDocument(messages, extracts, {
    mode: 'conversation', conversationStyle: 'article', includeUserMessages: true,
    includeSources: false, conversationTitle: '深度学习面试准备', platformName: 'ChatGPT',
  })
  assertNotIn(markdown, '### 用户', '无角色标签')
  assertNotIn(markdown, 'BatchNorm 为什么有效', '用户消息不出现')
  assert((markdown.match(/梯度消失|残差连接/g) || []).length >= 2, '保留 AI 内容主体')
  // 若正文有 h1 应已降级
  assertNotIn(markdown, '^# ', '无裸 h1（正则外的粗验）')
}

// ── 标题降级 / 来源收集 ──────────────────────────────────────────────────────

group('工具函数')
{
  const demoted = demoteHeadings('# 一\n\n## 二\n\n### 三', 2)
  assert(demoted.includes('### 一') && demoted.includes('#### 二') && demoted.includes('##### 三'), 'demoteHeadings 正确降级')
  assert(demoteHeadings('# x', 0) === '# x', '0 级不降')

  const msgs: ChatMessage[] = [
    { id: 'a', role: 'assistant', text: '', markdown: '', metadata: { sources: [{ url: 'https://a.com', text: 'A' }, { url: 'https://b.com', text: 'B' }] } },
    { id: 'b', role: 'assistant', text: '', markdown: '', metadata: { sources: [{ url: 'https://a.com', text: 'A dup' }, { url: 'https://c.com', text: 'C' }] } },
  ]
  const sources = collectSources(msgs)
  assert(sources.length === 3, '来源去重', JSON.stringify(sources.map((s) => s.url)))

  const stats = emptyStats()
  assert(stats.messages === 0, 'emptyStats 初始为 0')
}

// ── 大对话性能（100 / 200 / 500 条）───────────────────────────────────────────

group('性能：大对话提取与文档构建')

async function perfCase(count: number): Promise<void> {
  // 构造 count 条消息的对话 DOM（含公式 / 代码 / 表格 / 图片 metadata）
  let turns = ''
  for (let i = 0; i < count; i++) {
    const u = `<div data-testid="conversation-turn-u${i}"><div data-message-author-role="user" data-message-id="u${i}"><div class="whitespace-pre-wrap">第 ${i} 个问题：请解释反向传播的第 ${i} 个细节？</div></div></div>`
    const a = `<div data-testid="conversation-turn-a${i}"><div data-message-author-role="assistant" data-message-id="a${i}"><div class="markdown">
<h3>第 ${i} 题解析</h3>
<p>第 ${i} 层的梯度为 $\\delta_{${i}} = W^{T}\\delta_{${i + 1}}$，块级表达：</p>
$$\\delta_{${i}} = \\frac{\\partial L}{\\partial z_{${i}}}$$
<table><thead><tr><th>层</th><th>维度</th></tr></thead><tbody><tr><td>${i}</td><td>512</td></tr></tbody></table>
<pre><code class="language-python">layer_${i} = Dense(512, activation='relu')</code></pre>
<p><img src="https://example.com/img-${i}.png" alt="示意图 ${i}"></p>
</div></div></div>`
    turns += u + a
  }
  const html = `<!doctype html><html><head><title>压力测试</title></head><body><main><div id="conversation-list">${turns}</div></main></body></html>`
  const dom = new JSDOM(html, { url: 'https://chatgpt.com/', pretendToBeVisual: true })
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 50, top: 0, left: 0, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
  ;(globalThis as Record<string, unknown>).document = dom.window.document
  ;(globalThis as Record<string, unknown>).location = dom.window.location
  ;(globalThis as Record<string, unknown>).Node = dom.window.Node
  ;(globalThis as Record<string, unknown>).Element = dom.window.Element
  ;(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement
  ;(globalThis as Record<string, unknown>).MutationObserver = dom.window.MutationObserver

  const adapter = new ChatGptAdapter()
  const t0 = Date.now()
  const messages = await adapter.getMessages()
  const t1 = Date.now()
  const { extractMarkdown } = await import('../extension/src/extraction/domToMarkdown')
  const extracts = messages.map((m) =>
    extractMarkdown((m.element?.querySelector('.markdown') as Element | null) ?? m.element!),
  )
  const t2 = Date.now()
  const { markdown } = buildChatDocument(messages, extracts, {
    mode: 'conversation', conversationStyle: 'dialogue', includeUserMessages: true,
    includeSources: true, conversationTitle: `压测 ${count}`, platformName: 'ChatGPT',
  })
  const t3 = Date.now()

  assert(messages.length === count * 2, `${count} 条对话：消息数 ${count * 2}`, `实际 ${messages.length}`)
  assert(markdown.length > count * 100, '文档非空', `markdown ${markdown.length} 字符`)
  console.log(`      ⏱ 提取 ${t1 - t0}ms · 序列化 ${t2 - t1}ms · 建文档 ${t3 - t2}ms（合计 ${t3 - t0}ms）`)
  // 500 条也应在数秒内完成（jsdom 无布局引擎，真实浏览器更快）
  assert(t3 - t0 < Math.max(10_000, count * 40), `${count} 条消息提取+构建 < ${Math.max(10, count * 40 / 1000)}s`, `${t3 - t0}ms`)
}

await perfCase(100)
await perfCase(200)
await perfCase(500)

console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n失败明细:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
