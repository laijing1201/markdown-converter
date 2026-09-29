/**
 * AI 对话链接导入单元测试（需求 P1-4）：
 *   平台识别 / 多链接解析 / 内嵌 JSON 提取（ChatGPT __NEXT_DATA__ 形状）/
 *   RSC flight 流提取 / 通用 HTML 兜底 / 对话转 Markdown / 多链接合并 /
 *   Edge Function 代理抓取（mock fetch）。
 *
 * 运行：npx tsx scripts/test-chat-import.ts
 */
import { JSDOM } from 'jsdom'

// ── jsdom 全局（通用 HTML 提取需要 DOMParser）───────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>')
const w = dom.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement']) {
  ;(globalThis as unknown as Record<string, unknown>)[key] = w[key]
}

const {
  detectChatPlatform,
  parseChatLinks,
  extractConversation,
  conversationToMarkdown,
  importChatLinks,
  importChatLink,
  ChatImportError,
  CHAT_PLATFORMS,
} = await import('../src/core/chatImport')

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

// ── 平台识别 ─────────────────────────────────────────────────────────────────
console.log('平台识别')
{
  check('DeepSeek 分享链接', detectChatPlatform('https://chat.deepseek.com/share/abc123')?.platform.id === 'deepseek')
  check('ChatGPT 分享链接', detectChatPlatform('https://chatgpt.com/share/uuid-1')?.platform.id === 'chatgpt')
  check('Kimi 分享链接', detectChatPlatform('https://kimi.moonshot.cn/share/xyz')?.platform.id === 'kimi')
  check('缺协议自动补 https', detectChatPlatform('chat.deepseek.com/share/abc')?.platform.id === 'deepseek')
  check('不支持的域名返回 null', detectChatPlatform('https://example.com/share/1') === null)
  check('纯文本返回 null', detectChatPlatform('这不是链接') === null)
  check('子域匹配', detectChatPlatform('https://www.doubao.com/chat/1')?.platform.id === 'doubao')

  const links = parseChatLinks('https://chat.deepseek.com/share/a，\nhttps://chatgpt.com/share/b; junk-text https://kimi.moonshot.cn/share/c')
  check('多链接解析（容忍中文标点/换行/空格）', links.length === 3, JSON.stringify(links))
}

// ── 内嵌 JSON 提取（__NEXT_DATA__ 形状）─────────────────────────────────────
console.log('内嵌 JSON 提取')
{
  const conversation = {
    title: '测试对话',
    messages: [
      { author: { role: 'user' }, content: { parts: ['什么是快速排序？'] } },
      { author: { role: 'assistant' }, content: { parts: ['快速排序是一种分治算法：\n\n```python\ndef qs(a):\n    return a\n```\n\n时间复杂度 $O(n\\log n)$。'] } },
      { author: { role: 'system' }, content: { parts: ['system prompt 不应出现'] } },
      { author: { role: 'user' }, content: { parts: ['谢谢'] } },
    ],
  }
  const html = `<html><head><title>测试对话 - ChatGPT Share</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: conversation } })}</script></body></html>`
  const conv = extractConversation(html, 'chatgpt')
  check('提取到 3 条消息（system 被过滤）', conv?.messages.length === 3, `got ${conv?.messages.length}`)
  check('消息顺序正确', conv?.messages[0].role === 'user' && conv?.messages[1].role === 'assistant' && conv?.messages[2].role === 'user')
  check('代码块原样保留', conv?.messages[1].content.includes('```python') === true)
  check('公式原样保留', conv?.messages[1].content.includes('$O(n\\log n)$') === true)
  check('标题提取并去平台尾巴', conv?.title === '测试对话', conv?.title)
}

// ── RSC flight 流提取（ChatGPT 新版分享页形状）──────────────────────────────
console.log('flight 流提取')
{
  // 模拟 ChatGPT 新版分享页的 RSC flight 数据：消息以 JSON 片段散落在
  // 脚本标签里，parts 内含转义引号与 unicode 转义
  const html = `<html><head><title>排序对话</title></head><body><script>"author":{"role":"user"},"content":{"content_type":"text","parts":["帮我写一段冒泡排序"]}</script><script>"author":{"role":"assistant"},"content":{"content_type":"text","parts":["好的：","**冒泡排序** \\\"稳定\\\" 排序","\\u6570\\u7ec4"]}</script></body></html>`
  const conv = extractConversation(html, 'chatgpt')
  check('提取到 2 条消息', conv?.messages.length === 2, `got ${conv?.messages.length}`)
  check('多段 parts 合并', conv?.messages[1].content.includes('**冒泡排序**') && conv?.messages[1].content.includes('数组'))
  check('字符串内的引号/转义不破坏解析', conv?.messages[1].content.includes('"稳定"') === true, conv?.messages[1].content)
}

// ── 通用 HTML 兜底 ───────────────────────────────────────────────────────────
console.log('通用 HTML 兜底')
{
  const html = `<html><head><title>元宝分享</title></head><body>
    <nav>导航不应出现</nav>
    <article>
      <h2>问题：总结冒泡排序</h2>
      <p>冒泡排序的核心思想是<b>相邻比较</b>。</p>
      <pre><code class="language-python">def bubble(a): pass</code></pre>
      <ul><li>时间复杂度 O(n²)</li><li>稳定排序</li></ul>
      <table><tr><th>指标</th></tr><tr><td>稳定性</td></tr></table>
    </article>
  </body></html>`
  const conv = extractConversation(html, 'yuanbao')
  check('通用提取返回单条消息', conv?.messages.length === 1)
  check('标题转 Markdown', conv?.messages[0].content.includes('## 问题：总结冒泡排序'))
  check('加粗保留', conv?.messages[0].content.includes('**相邻比较**'))
  check('代码围栏保留', conv?.messages[0].content.includes('```python'))
  check('列表保留', conv?.messages[0].content.includes('- 时间复杂度 O(n²)'))
  check('表格转管道语法', conv?.messages[0].content.includes('| 指标 |'))
  check('导航被剔除', !conv?.messages[0].content.includes('导航不应出现'))

  check('空白页返回 null', extractConversation('<html><body></body></html>', 'generic') === null)
}

// ── 对话转 Markdown + 多链接合并 ─────────────────────────────────────────────
console.log('对话转 Markdown')
{
  const platform = CHAT_PLATFORMS.find((p) => p.id === 'deepseek')!
  const md = conversationToMarkdown(
    { title: '测试对话', messages: [{ role: 'user', content: '问题' }, { role: 'assistant', content: '回答' }] },
    platform,
  )
  check('含标题', md.includes('# 测试对话'))
  check('含来源标注', md.includes('来源：DeepSeek'))
  check('用户/AI 角色标题', md.includes('### 🙋 用户') && md.includes('### 🤖 AI'))

  // 多链接合并：mock fetch 走直连分支
  const originalFetch = globalThis.fetch
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const id = String(url).endsWith('/a') ? '对话甲' : '对话乙'
    return new Response(
      `<html><head><title>${id}</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        m: [{ role: 'user', content: { parts: [`${id}的问题`] } }, { role: 'assistant', content: { parts: [`${id}的回答`] } }],
      })}</script></body></html>`,
      { status: 200 },
    )
  }
  try {
    const results = await importChatLinks([
      'https://chat.deepseek.com/share/a',
      'https://chatgpt.com/share/b',
    ])
    check('两个链接都成功', results.length === 2)
    check('按输入顺序合并', results[0].markdown.includes('对话甲') && results[1].markdown.includes('对话乙'))
    check('消息数统计', results.reduce((s, r) => s + r.messageCount, 0) === 4)
    check('走浏览器直连路径', results.every((r) => r.via === 'direct'))
  } finally {
    ;(globalThis as unknown as { fetch: unknown }).fetch = originalFetch
  }

  // 单链接失败抛出明确错误
  try {
    await importChatLink('https://chat.deepseek.com/share/missing')
    check('失效链接抛出 ChatImportError', false)
  } catch (err) {
    check('失效链接抛出 ChatImportError', err instanceof ChatImportError && err.message.includes('未能'))
  }

  // 混合成功/失败：失败的链接被跳过，不拖垮其它链接
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const ok = String(url).endsWith('/a')
    return new Response(
      ok
        ? `<html><head><title>对话甲</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            m: [{ role: 'assistant', content: { parts: ['对话甲的回答，内容足够长所以能通过通用提取的长度门槛。'] } }],
          })}</script></body></html>`
        : '<html><body>空页面</body></html>',
      { status: 200 },
    )
  }
  try {
    const results = await importChatLinks(['https://chat.deepseek.com/share/a', 'https://chatgpt.com/share/b'])
    check('失败链接被跳过，成功链接正常返回', results.length === 1 && results[0].markdown.includes('对话甲'), `got ${results.length}`)
  } catch {
    check('失败链接被跳过，成功链接正常返回', false)
  }
  ;(globalThis as unknown as { fetch: unknown }).fetch = originalFetch
}

// ── DeepSeek 分享：公开 JSON 接口直取（修复「SPA 空壳抓不到正文」）──────────
console.log('DeepSeek 分享导入')
{
  const { deepSeekShareId, parseDeepSeekShareJson, importChatLink } = await import('../src/core/chatImport')

  check('share_id 提取', deepSeekShareId('https://chat.deepseek.com/share/abc_123') === 'abc_123')
  check('非分享路径返回 null', deepSeekShareId('https://chat.deepseek.com/a/chat/s/x') === null)
  check('非 DeepSeek 域名返回 null', deepSeekShareId('https://example.com/share/x') === null)

  const okJson = JSON.stringify({
    code: 0,
    data: {
      biz_code: 0,
      biz_data: {
        title: '排序算法讨论',
        messages: [
          { message_id: 1, role: 'USER', fragments: [{ type: 'TEXT', content: '什么是快速排序？' }] },
          { message_id: 2, role: 'ASSISTANT', fragments: [
            { type: 'THINKING', content: '先想一下……' },
            { type: 'TEXT', content: '快速排序是分治算法：' },
            { type: 'TEXT', content: '```python\ndef qs(a): pass\n```' },
          ] },
        ],
      },
    },
  })
  const parsed = parseDeepSeekShareJson(okJson)
  check('biz_code=0 解析成功', parsed.ok === true)
  check('标题提取', parsed.conversation?.title === '排序算法讨论')
  check('USER/ASSISTANT 角色映射', parsed.conversation?.messages[0].role === 'user' && parsed.conversation?.messages[1].role === 'assistant')
  check('THINKING 片段不进正文', !parsed.conversation?.messages[1].content.includes('先想一下'))
  check('多片段合并 + 代码块保留', parsed.conversation?.messages[1].content.includes('分治算法') && parsed.conversation?.messages[1].content.includes('```python'))

  const missing = parseDeepSeekShareJson(JSON.stringify({ code: 0, data: { biz_code: 1, biz_msg: 'share does not exist' } }))
  check('biz_code=1 → 明确中文原因', !missing.ok && missing.error?.includes('不存在或已被删除'), missing.error)
  check('非 JSON → NOT_JSON', parseDeepSeekShareJson('<html>shell</html>').ok === false)
  check('空消息 → EMPTY', parseDeepSeekShareJson(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { title: 't', messages: [] } } })).ok === false)

  // 集成：mock fetch 对 API 路径返回 JSON、对页面返回空壳 HTML
  const originalFetch2 = globalThis.fetch
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    if (String(url).includes('/api/v0/share/content')) return new Response(okJson, { status: 200 })
    return new Response('<html><body>deepseek shell</body></html>', { status: 200 })
  }
  try {
    const r = await importChatLink('https://chat.deepseek.com/share/real1')
    check('DeepSeek 链接走 JSON 接口导入成功', r.messageCount === 2 && r.markdown.includes('排序算法讨论'), `count=${r.messageCount}`)
  } catch (e) {
    check('DeepSeek 链接走 JSON 接口导入成功', false, (e as Error).message)
  } finally {
    ;(globalThis as unknown as { fetch: unknown }).fetch = originalFetch2
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
