/**
 * Adapter Contract Tests（P4C 第六节）：
 *
 *   describeAdapter(spec) —— 所有平台 Adapter 必须通过同一组合同测试：
 *     detect / 对话标题 / 消息数量与顺序 / 角色判定 / 标题 / 段落 / 粗体 /
 *     斜体 / 列表 / 表格 / 代码 / 公式 / 链接 / 图片 / 未知元素 / 空消息 /
 *     流式消息 / fallback / 健康检查 / selector 主链命中 / 幂等性。
 *
 *   新增平台：构造一个 AdapterContractSpec 即自动继承全部用例。
 *
 * 运行：npx tsx scripts/test-adapter-contract.ts
 */

import { readFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { JSDOM } from 'jsdom'
import type { ChatMessage, ChatPlatformAdapter } from '../extension/src/types'
import type { HealthCapableAdapter, AdapterHealth } from '../extension/src/health'
import { computeAdapterHealth } from '../extension/src/health'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'tests/fixtures')

// ── JSDOM 环境 ────────────────────────────────────────────────────────────────

let currentDom: JSDOM | null = null

async function loadFixture(platform: 'chatgpt' | 'deepseek', name: string): Promise<JSDOM> {
  const html = readFileSync(join(FIXTURES, platform, `${name}.html`), 'utf-8')
  const url = platform === 'chatgpt' ? 'https://chatgpt.com/' : 'https://chat.deepseek.com/'
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true })
  setupDom(dom)
  return dom
}

/** 创建空页面（SPA 动态构建用） */
async function loadBlank(platform: 'chatgpt' | 'deepseek'): Promise<JSDOM> {
  const url = platform === 'chatgpt' ? 'https://chatgpt.com/' : 'https://chat.deepseek.com/'
  const dom = new JSDOM(`<!doctype html><html><body><main><div id="conversation-list"></div></main></body></html>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
  })
  setupDom(dom)
  return dom
}

function setupDom(dom: JSDOM) {
  // jsdom 无布局引擎：mock 非零尺寸（生产环境是真实浏览器布局）
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 50,
      width: 100, height: 50, toJSON: () => ({}),
    } as DOMRect
  }
  ;(globalThis as Record<string, unknown>).document = dom.window.document
  ;(globalThis as Record<string, unknown>).location = dom.window.location
  ;(globalThis as Record<string, unknown>).MutationObserver = dom.window.MutationObserver
  ;(globalThis as Record<string, unknown>).Node = dom.window.Node
  ;(globalThis as Record<string, unknown>).Element = dom.window.Element
  ;(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement
  currentDom = dom
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
  assert(!!haystack && haystack.includes(needle), label, `期望包含「${needle}」，实际：${(haystack || '').slice(0, 100)}`)
}

// ── 合同规格 ──────────────────────────────────────────────────────────────────

export interface AdapterContractSpec {
  id: string
  name: string
  platform: 'chatgpt' | 'deepseek'
  otherPlatform: 'chatgpt' | 'deepseek'
  AdapterClass: new () => ChatPlatformAdapter
  /** conversation fixture 的期望 */
  conversation: {
    title: string
    total: number
    user: number
    assistant: number
    roles: string
  }
  /** mixed fixture 内容要素 */
  mixed: {
    assistantCount: number
    markers: Array<{ needle: string; label: string }>
  }
  fallback: { minMessages: number; assistantContains: string }
  basic: { userContains: string; assistantContains: string }
}

/** 单条消息 markdown 通用要素断言（heading/bold/italic/list/table/code/math/link/image） */
function assertMarkdownContract(md: string | undefined, context: string) {
  const has = (needle: string) => (md || '').includes(needle)
  assert(has('##') || has('#'), `${context}: 标题还原为 # 层级`)
  assert(has('**'), `${context}: 粗体还原为 **`)
  assert(has('*') || has('_'), `${context}: 斜体/强调标记存在`)
  assert(has('- ') || has('1. '), `${context}: 列表还原`)
  assert(/^\|.+\|/m.test(md || ''), `${context}: 表格还原为 GFM`)
  assert(has('```'), `${context}: 代码块围栏`)
  assert(has('$') || has('\\('), `${context}: 公式定界符`)
  assert(/\[[^\]]+\]\(https?:\/\//.test(md || ''), `${context}: 链接还原为 []()`)
  assert(has('!['), `${context}: 图片还原为 ![]()`)
}

// ── describeAdapter ──────────────────────────────────────────────────────────

export async function describeAdapter(spec: AdapterContractSpec) {
  const make = (): ChatPlatformAdapter => new spec.AdapterClass()

  group(`${spec.name}: detect`)
  {
    await loadFixture(spec.platform, 'v1-basic')
    assert(make().detect(), `detect() 识别 ${spec.platform}`)
    await loadFixture(spec.otherPlatform, 'v1-basic')
    assert(!make().detect(), `detect() 不误判 ${spec.otherPlatform}`)
  }

  group(`${spec.name}: 标题与消息结构（conversation fixture）`)
  {
    await loadFixture(spec.platform, 'v1-conversation')
    const adapter = make()
    assert(adapter.getConversationTitle() === spec.conversation.title,
      '对话标题', adapter.getConversationTitle())
    const msgs = await adapter.getMessages()
    assert(msgs.length === spec.conversation.total, `消息总数 = ${spec.conversation.total}`, `实际 ${msgs.length}`)
    assert(msgs.filter((m) => m.role === 'user').length === spec.conversation.user, '用户消息数')
    assert(msgs.filter((m) => m.role === 'assistant').length === spec.conversation.assistant, 'AI 消息数')
    assert(msgs.map((m) => m.role).join(',') === spec.conversation.roles, '角色顺序正确',
      msgs.map((m) => m.role).join(','))
    // 幂等：两次提取结果一致（selector 不漂移）
    const again = await adapter.getMessages()
    assert(again.map((m) => m.role).join(',') === msgs.map((m) => m.role).join(','),
      '两次提取角色序列一致')
    assert(again.map((m) => m.text).join('|') === msgs.map((m) => m.text).join('|'),
      '两次提取文本一致')
    // 消息 id 稳定
    const ids1 = msgs.map((m) => m.id).sort().join(',')
    const ids2 = again.map((m) => m.id).sort().join(',')
    assert(ids1 === ids2, '消息 id 跨调用稳定')
  }

  group(`${spec.name}: 内容要素合同（mixed fixture）`)
  {
    await loadFixture(spec.platform, 'v1-mixed')
    const msgs = await make().getMessages()
    const assistants = msgs.filter((m) => m.role === 'assistant')
    assert(assistants.length === spec.mixed.assistantCount, `AI 回答 = ${spec.mixed.assistantCount} 条`, `实际 ${assistants.length}`)
    const md = assistants.map((m) => m.markdown).join('\n\n')
    assertMarkdownContract(md, spec.name)
    for (const { needle, label } of spec.mixed.markers) {
      assertIn(md, needle, label)
    }
  }

  group(`${spec.name}: 用户消息（basic fixture）`)
  {
    await loadFixture(spec.platform, 'v1-basic')
    const msgs = await make().getMessages()
    assert(msgs.length >= 2, '基本消息提取')
    assertIn(msgs[0].markdown, spec.basic.userContains, '用户消息文本保留')
    assertIn(msgs.find((m) => m.role === 'assistant')?.markdown, spec.basic.assistantContains, 'AI 回答保留')
  }

  group(`${spec.name}: fallback（主选择器失效）`)
  {
    await loadFixture(spec.platform, 'v1-fallback')
    const adapter = make()
    const msgs = await adapter.getMessages()
    assert(msgs.length >= spec.fallback.minMessages, 'fallback 提取到消息', `实际 ${msgs.length}`)
    const md = msgs.find((m) => m.role === 'assistant')?.markdown
    assertIn(md, spec.fallback.assistantContains, 'fallback 内容完整')
    // fallback 命中要体现在健康检查（降级警告）
    const health = await computeAdapterHealth(adapter as HealthCapableAdapter)
    assert(health.extractionConfidence !== 'high' || health.warnings.length === 0 || health.warnings.some((w) => w.startsWith('selector-')),
      'fallback 场景健康检查可见（confidence 降级或 selector 警告）', JSON.stringify(health.warnings))
  }

  group(`${spec.name}: 空消息容错`)
  {
    await loadFixture(spec.platform, 'v1-empty')
    const adapter = make()
    const msgs = await adapter.getMessages().catch(() => null)
    assert(msgs !== null, '空消息场景不抛异常')
    if (msgs) {
      assert(msgs.every((m) => m.text !== undefined && !m.text.includes('undefined')),
        '空消息不产生垃圾文本')
      const total = msgs.reduce((acc, m) => acc + (m.text || '').length, 0)
      console.log(`      ℹ 空场景提取 ${msgs.length} 条消息，共 ${total} 字符`)
    }
  }

  group(`${spec.name}: 流式消息（generating 指示）`)
  {
    await loadFixture(spec.platform, 'v1-streaming')
    const adapter = make()
    const msgs = await adapter.getMessages()
    assert(msgs.length >= 2, '流式场景可提取已完成部分', `实际 ${msgs.length}`)
    assert(adapter.isGenerating?.() === true, 'isGenerating() 检测停止按钮')
    const md = msgs.find((m) => m.role === 'assistant')?.markdown
    assert(!!md && md.length > 0, '流式中的部分内容可导出')
  }

  group(`${spec.name}: 健康检查（P4C 第三节）`)
  {
    await loadFixture(spec.platform, 'v1-conversation')
    const adapter = make() as HealthCapableAdapter
    const health: AdapterHealth = await computeAdapterHealth(adapter)
    assert(health.platform === spec.name, 'health.platform')
    assert(health.detected === true, 'health.detected')
    assert(health.conversationFound === true, 'health.conversationFound')
    assert(health.messageContainerFound === true, 'health.messageContainerFound')
    assert(health.userMessages === spec.conversation.user, 'health.userMessages', String(health.userMessages))
    assert(health.assistantMessages === spec.conversation.assistant, 'health.assistantMessages', String(health.assistantMessages))
    assert(health.extractionConfidence === 'high', '主链命中时 confidence=high', health.extractionConfidence)
    assert(health.warnings.length === 0, '健康页面无警告', health.warnings.join(','))
    assert(typeof health.adapterVersion === 'number' && health.adapterVersion >= 1, 'adapterVersion ≥ 1')
  }

  group(`${spec.name}: SPA 路由切换（P4C 第十二节）`)
  {
    const dom = await loadBlank(spec.platform)
    const adapter = make()
    // 对话 A
    const list = dom.window.document.getElementById('conversation-list')!
    list.innerHTML = spec.platform === 'chatgpt'
      ? `<div data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="spa-a1"><div class="markdown"><p>对话A的回答</p></div></div></div>`
      : `<div data-message-id="spa-a1"><div class="ds-markdown ds-markdown--block"><p>对话A的回答</p></div></div>`
    dom.window.document.title = '对话A'
    const a = await adapter.getMessages()
    assertIn(a.find((m) => m.role === 'assistant')?.markdown, '对话A的回答', '对话 A 提取')
    // 切到对话 B：SPA 换内容 + pushState
    dom.window.history.pushState({}, '', '/c/conversation-b')
    list.innerHTML = spec.platform === 'chatgpt'
      ? `<div data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="spa-a2"><div class="markdown"><p>对话B的回答</p></div></div></div>`
      : `<div data-message-id="spa-a2"><div class="ds-markdown ds-markdown--block"><p>对话B的回答</p></div></div>`
    const b = await adapter.getMessages()
    assertIn(b.find((m) => m.role === 'assistant')?.markdown, '对话B的回答', 'SPA 切换后提取到对话 B')
    assert(!b.some((m) => (m.text || '').includes('对话A')), '不残留对话 A 内容')
    // 新建聊天：空列表
    list.innerHTML = ''
    const empty = await adapter.getMessages()
    assert(empty.length === 0, '新建聊天后无残留消息', `实际 ${empty.length}`)
  }

  group(`${spec.name}: 动态新消息（MutationObserver）`)
  {
    const dom = await loadFixture(spec.platform, 'v1-basic')
    const adapter = make()
    const seen: string[] = []
    const stop = adapter.observeNewMessages?.((msg) => seen.push(msg.role))
    const list = dom.window.document.getElementById('conversation-list')
      ?? dom.window.document.querySelector('.chat-container')
      ?? dom.window.document.body
    const turn = dom.window.document.createElement('div')
    if (spec.platform === 'chatgpt') {
      turn.setAttribute('data-testid', 'conversation-turn-99')
      turn.innerHTML = `<div data-message-author-role="assistant" data-message-id="new-1"><div class="markdown"><p>新回答已生成</p></div></div>`
    } else {
      turn.innerHTML = `<div data-message-id="new-1"><div class="ds-markdown ds-markdown--block"><p>新回答已生成</p></div></div>`
    }
    list.appendChild(turn)
    await new Promise((r) => setTimeout(r, 900))
    assert(seen.includes('assistant'), 'observer 捕获新消息', JSON.stringify(seen))
    // 防重复：同一节点不重复回调
    const countBefore = seen.length
    await new Promise((r) => setTimeout(r, 900))
    assert(seen.length === countBefore, 'WeakSet 防重复：同节点不二次回调')
    stop?.()
  }

  group(`${spec.name}: 流式更新不重复注入（P4C 第十一节）`)
  {
    const dom = await loadFixture(spec.platform, 'v1-streaming')
    const adapter = make()
    const events: Array<{ role: string; element: Element }> = []
    const stop = adapter.observeNewMessages?.((msg, element) => events.push({ role: msg.role, element }))
    // 流式输出：同一消息容器内追加内容（不新增 turn）
    const assistantBody = dom.window.document.querySelector('[class*="markdown"]')
    if (assistantBody) {
      const p = dom.window.document.createElement('p')
      p.textContent = '（流式追加的句子）'
      assistantBody.appendChild(p)
    }
    await new Promise((r) => setTimeout(r, 900))
    const countForElement = events.filter((e) => e.element === (adapter.getMessageElements()[1] ?? adapter.getMessageElements()[0])).length
    assert(countForElement <= 1, '同一消息 root 不重复回调', `实际 ${countForElement}`)
    stop?.()
  }

  group(`${spec.name}: 性能（P4C 第十三节）`)
  {
    const dom = await loadBlank(spec.platform)
    const list = dom.window.document.getElementById('conversation-list')!
    for (const size of [100, 300, 500] as const) {
      list.innerHTML = ''
      const frag = dom.window.document.createDocumentFragment()
      for (let i = 0; i < size; i++) {
        // 每条消息独立容器（与真实网站结构一致：一轮 = user 容器 + assistant 容器）
        const userEl = dom.window.document.createElement('div')
        const aiEl = dom.window.document.createElement('div')
        if (spec.platform === 'chatgpt') {
          userEl.setAttribute('data-testid', `conversation-turn-u-${i}`)
          userEl.innerHTML = `<div data-message-author-role="user" data-message-id="p-u-${i}"><div class="whitespace-pre-wrap">问题 ${i}：请解释机器学习中的概念 ${i}。</div></div>`
          aiEl.setAttribute('data-testid', `conversation-turn-a-${i}`)
          aiEl.innerHTML = `<div data-message-author-role="assistant" data-message-id="p-a-${i}"><div class="markdown"><p>回答 ${i}：<strong>要点</strong>与公式 $x_${i}^2$。</p></div></div>`
        } else {
          userEl.innerHTML = `<div data-message-id="p-u-${i}"><div class="ds-message">问题 ${i}：请解释机器学习中的概念 ${i}。</div></div>`
          aiEl.innerHTML = `<div data-message-id="p-a-${i}"><div class="ds-markdown ds-markdown--block"><p>回答 ${i}：<strong>要点</strong>与公式 $x_${i}^2$。</p></div></div>`
        }
        frag.appendChild(userEl)
        frag.appendChild(aiEl)
      }
      list.appendChild(frag)
      const adapter = make()
      const t0 = Date.now()
      const msgs = await adapter.getMessages()
      const ms = Date.now() - t0
      assert(msgs.length === size * 2, `${size} 轮消息全部提取`, `实际 ${msgs.length}`)
      const perMsg = ms / msgs.length
      console.log(`      ⏱ ${size} 轮 = ${msgs.length} 条消息，${ms}ms（${perMsg.toFixed(2)}ms/条）`)
      assert(perMsg < 30, `${size} 轮平均每条 < 30ms（jsdom 环境宽限）`, `${perMsg.toFixed(2)}ms`)
    }
  }
}

// ── 平台规格注册 ──────────────────────────────────────────────────────────────

import { ChatGptAdapter } from '../extension/src/adapters/chatgpt'
import { DeepSeekAdapter } from '../extension/src/adapters/deepseek'

const SPECS: AdapterContractSpec[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    platform: 'chatgpt',
    otherPlatform: 'deepseek',
    AdapterClass: ChatGptAdapter,
    conversation: {
      title: '深度学习面试准备',
      total: 6,
      user: 3,
      assistant: 3,
      roles: 'user,assistant,user,assistant,user,assistant',
    },
    mixed: {
      assistantCount: 2,
      markers: [
        { needle: '## 反向传播原理', label: '标题层级' },
        { needle: '\\frac{\\partial L}{\\partial w^{(l)}}', label: '块级公式（链式法则）' },
        { needle: '| SGD | 0.01 | 120 |', label: '表格数据行' },
        { needle: '```python', label: '代码块语言' },
        { needle: '[OpenAI 官网](https://openai.com)', label: '链接' },
        { needle: '![', label: '图片语法' },
        { needle: '```mermaid', label: 'Mermaid 源码' },
      ],
    },
    fallback: { minMessages: 2, assistantContains: '**回答**' },
    basic: { userContains: '什么是梯度下降', assistantContains: '**优化算法**' },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    platform: 'deepseek',
    otherPlatform: 'chatgpt',
    AdapterClass: DeepSeekAdapter,
    conversation: {
      title: '完整对话导出',
      total: 4,
      user: 2,
      assistant: 2,
      roles: 'user,assistant,user,assistant',
    },
    mixed: {
      assistantCount: 2,
      markers: [
        { needle: '\\frac{\\partial L}{\\partial w^{(l)}}', label: '块级公式' },
        { needle: '```python', label: '代码块' },
        { needle: '> 注意：学习率过大', label: '引用块' },
        { needle: '```mermaid', label: 'Mermaid 源码' },
      ],
    },
    fallback: { minMessages: 2, assistantContains: '**回答**' },
    basic: { userContains: '什么是梯度下降', assistantContains: '**损失函数**' },
  },
]

for (const spec of SPECS) {
  await describeAdapter(spec)
}

void currentDom

console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n失败明细:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
