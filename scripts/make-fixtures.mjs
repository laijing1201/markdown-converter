/**
 * 生成 Adapter 测试 fixtures（tests/fixtures/{chatgpt,deepseek}/*.html）。
 *
 * 规范三十六节：全部为人工构造的测试数据，不含任何真实私人聊天。
 * DOM 结构按两个平台的真实布局特征建模（data-testid / role 属性 / 设计系统类名）。
 *
 * 运行：node scripts/make-fixtures.mjs
 */

import { mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CG = resolve(ROOT, 'tests/fixtures/chatgpt')
const DS = resolve(ROOT, 'tests/fixtures/deepseek')
mkdirSync(CG, { recursive: true })
mkdirSync(DS, { recursive: true })

// ── 公共内容片段 ──────────────────────────────────────────────────────────────

/** KaTeX 渲染后的 DOM（含可恢复的 LaTeX annotation） */
const katexInline = (latex, visual) =>
  `<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>${visual}</mi></mrow><annotation encoding="application/x-tex">${latex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${visual}</span></span>`

const katexDisplay = (latex, visual) =>
  `<span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>${visual}</mi></mrow><annotation encoding="application/x-tex">${latex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${visual}</span></span></span>`

/** 无 annotation 的公式（降级路径测试） */
const katexNoSource = (visual) =>
  `<span class="katex"><span class="katex-html" aria-hidden="true">${visual}</span></span>`

/** 1×1 蓝色像素 data URI PNG */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const codePython = `def backward(grad_output):
    grad_input = grad_output * activation_prime(z)
    return grad_input`

const codeJs = `const losses = epoch.map(e => e.loss);
console.log(losses.reduce((a, b) => a + b, 0));`

const mermaidSrc = `graph TD
    A[前向传播] --> B{损失计算}
    B --> C[反向传播]
    C --> A`

const tableHtml = `<table>
  <thead>
    <tr><th>优化器</th><th>学习率</th><th>收敛轮数</th></tr>
  </thead>
  <tbody>
    <tr><td>SGD</td><td>0.01</td><td>120</td></tr>
    <tr><td>Adam</td><td>0.001</td><td>45</td></tr>
  </tbody>
</table>`

// ── ChatGPT DOM 建模 ──────────────────────────────────────────────────────────

let turnSeq = 0
function cgUser(text) {
  turnSeq++
  return `
  <div data-testid="conversation-turn-${turnSeq}">
    <div data-message-author-role="user" data-message-id="cg-u-${turnSeq}">
      <div class="whitespace-pre-wrap">${text}</div>
    </div>
  </div>`
}

function cgAssistant(inner, opts = {}) {
  turnSeq++
  const generating = opts.generating ? ' data-testid="stop-button" data-message-author-role="assistant"' : ' data-message-author-role="assistant"'
  const actionBar = `<div data-testid="message-action-bar"><button data-testid="copy-button">复制</button><button data-testid="thumb-up">👍</button></div>`
  return `
  <div data-testid="conversation-turn-${turnSeq}">
    <div${generating} data-message-id="cg-a-${turnSeq}">
      <div class="markdown prose">${inner}</div>
    </div>
    ${opts.generating ? '' : actionBar}
  </div>`
}

const cgShell = (title, body) => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<nav aria-label="Chat history"><a aria-current="page" href="/c/abc123">${title}</a></nav>
<main>
  <h1>${title}</h1>
  <div id="conversation-list">${body}
  </div>
  <div data-testid="composer-action-buttons"><button>语音</button></div>
</main>
</body></html>`

/** ChatGPT 代码块（含头部工具条：语言标签 + Copy 按钮） */
const cgCodeBlock = (lang, code) => `
<div class="contain-inline-size rounded-md border" data-language="${lang}">
  <div class="flex items-center rounded-t-md"><span class="select-none">${lang}</span><button>复制代码</button><button>Run</button></div>
  <div class="overflow-y-auto"><pre><code class="language-${lang}">${code}</code></pre></div>
</div>`

// ── DeepSeek DOM 建模 ─────────────────────────────────────────────────────────

let dsSeq = 0
function dsUser(text) {
  dsSeq++
  return `
  <div class="_4f6bf0d ds-message-group">
    <div class="a5b0ab3 ds-message"><div class="e1675d9">${text}</div></div>
  </div>`
}

function dsAssistant(inner) {
  dsSeq++
  return `
  <div class="_7c8c4f1 ds-message-group" data-message-id="ds-a-${dsSeq}">
    <div class="ds-markdown ds-markdown--block">${inner}</div>
  </div>`
}

const dsShell = (title, body) => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title} - DeepSeek</title></head>
<body>
<div class="sidebar"><a aria-current="page" href="/a/chat/s/1">${title}</a></div>
<div class="chat-container"><div class="_0d0e9cc">
${body}
</div></div>
</body></html>`

/** DeepSeek 代码块 */
const dsCodeBlock = (lang, code) => `
<div class="ds-code-block" data-language="${lang}">
  <div class="ds-code-header"><span class="ds-code-lang">${lang}</span><button class="ds-copy-btn">复制</button></div>
  <pre><code class="language-${lang}">${code}</code></pre>
</div>`

// ── 内容片段（两平台共用语义）────────────────────────────────────────────────

const richAnswer = `
<h2>反向传播原理</h2>
<p>反向传播是<strong>神经网络</strong>训练的核心算法，通过${katexInline('\\delta^{(l)} = \\delta^{(l+1)} (W^{(l+1)})^T \\odot \\sigma\'(z^{(l)})', 'δ')}逐层传播误差信号。</p>
<p>链式法则的完整表达：</p>
${katexDisplay('\\frac{\\partial L}{\\partial w^{(l)}} = \\delta^{(l)} (a^{(l-1)})^T', '∂L/∂w')}
${tableHtml}
<h3>Python 实现</h3>
${cgCodeBlock('python', codePython)}
<h3>要点列表</h3>
<ul>
  <li>前向传播计算输出</li>
  <li>反向传播计算梯度
    <ul><li>输出层直接计算</li><li>隐藏层递归传播</li></ul>
  </li>
  <li>梯度下降更新参数</li>
</ul>
<blockquote><p>注意：学习率过大可能导致梯度爆炸。</p></blockquote>
<p>更多参考见 <a href="https://openai.com">OpenAI 官网</a>，也推荐 <a href="https://www.deeplearningbook.org/">深度学习圣经</a>。</p>
<hr>
<p>块级公式二：</p>
${katexDisplay('\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}', '∫')}`

const mermaidAnswer = `
<h3>训练流程</h3>
<p>下图展示训练循环：</p>
<pre><code class="language-mermaid">${mermaidSrc}</code></pre>
<p>以上流程循环执行直到收敛。</p>`

const imageAnswer = `
<p>训练损失曲线（示意）：</p>
<p><img src="${PIXEL}" alt="训练损失曲线"></p>
<p>网络结构如图 <a href="https://arxiv.org/abs/1206.5533">[1]</a> 所示。</p>
<img src="https://example.com/architecture.png" alt="网络架构图">`

// ── 写出 ChatGPT fixtures ─────────────────────────────────────────────────────

writeFileSync(resolve(CG, 'basic.html'), cgShell('简单问答', `
${cgUser('什么是梯度下降？')}
${cgAssistant('<p>梯度下降是一种<strong>优化算法</strong>，通过沿负梯度方向迭代更新参数来最小化损失函数。</p>')}
`))

writeFileSync(resolve(CG, 'math.html'), cgShell('数学公式推导', `
${cgUser('推导反向传播公式')}
${cgAssistant(`
<p>行内公式：质能方程 ${katexInline('E = mc^2', 'E')}。</p>
${katexDisplay('\\sum_{i=1}^{n} w_i x_i + b', 'Σ')}
${katexDisplay('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\begin{cases} x^2 & x \\ge 0 \\\\ -x & x < 0 \\end{cases}', 'M')}
<p>下标与根号：${katexInline('x_i', 'x')}、${katexInline('\\sqrt{x^2 + 1}', '√')}。</p>
`)}
`))

writeFileSync(resolve(CG, 'table.html'), cgShell('模型对比表', `
${cgUser('对比几个优化器')}
${cgAssistant(`<p>对比如下：</p>${tableHtml}<p>表格之外的说明文字。</p>`)}
`))

writeFileSync(resolve(CG, 'code.html'), cgShell('代码示例', `
${cgUser('写一段反向传播代码')}
${cgAssistant(`
<p>Python 版本：</p>
${cgCodeBlock('python', codePython)}
<p>JavaScript 统计损失：</p>
${cgCodeBlock('javascript', codeJs)}
`)}
`))

writeFileSync(resolve(CG, 'images.html'), cgShell('图片说明', `
${cgUser('展示训练曲线')}
${cgAssistant(imageAnswer)}
`))

writeFileSync(resolve(CG, 'mixed.html'), cgShell('反向传播原理讲解', `
${cgUser('请全面讲解反向传播，包含公式、表格、代码、列表和图片。')}
${cgAssistant(richAnswer)}
${cgAssistant(mermaidAnswer)}
`))

writeFileSync(resolve(CG, 'conversation.html'), cgShell('深度学习面试准备', `
${cgUser('反向传播和梯度消失有什么关系？')}
${cgAssistant('<p>反向传播中梯度逐层相乘，<strong>深层网络</strong>中容易导致梯度消失。</p>')}
${cgUser('怎么缓解？')}
${cgAssistant(`<p>常用方法：</p><ol><li>ReLU 激活函数</li><li>残差连接</li><li>批归一化</li></ol><p>核心公式：${katexInline('h^{(l+1)} = h^{(l)} + F(h^{(l)})', 'h')}</p>`)}
${cgUser('BatchNorm 为什么有效？')}
${cgAssistant(`<p>它把每层输入拉回稳定分布，${katexDisplay('\\hat{x} = \\frac{x - \\mu}{\\sqrt{\\sigma^2 + \\epsilon}}', 'x̂')} 使梯度更稳定。</p>`)}
`))

// 回归：主选择器（data-testid）失效 → article fallback 生效
writeFileSync(resolve(CG, 'fallback.html'), cgShell('降级测试', `
<article data-message-id="fb-u1">
  <div data-message-author-role="user">
    <div class="whitespace-pre-wrap">回归测试问题</div>
  </div>
</article>
<article data-message-id="fb-a1">
  <div data-message-author-role="assistant">
    <div class="markdown">无 testid 包裹、无 prose 类的<strong>回答</strong>内容。</div>
  </div>
</article>
`))

// 回归：缺标题 / 缺 annotation / 图片失败 / 未知节点
writeFileSync(resolve(CG, 'degraded.html'), cgShell('', `
${cgUser('降级场景')}
${cgAssistant(`
<p>这个公式缺少 annotation：${katexNoSource('θ')}。</p>
<p><img src="https://127.0.0.1:1/broken.png" alt="加载失败图"></p>
<section><article><p>未知嵌套节点内的<span>文字</span>要保留。</p></article></section>
<details><summary>Thought for 2 seconds</summary><p>思考过程不应导出</p></details>
<p>思考之后可见的正文。</p>
`)}
`))

// ── 写出 DeepSeek fixtures ────────────────────────────────────────────────────

writeFileSync(resolve(DS, 'basic.html'), dsShell('梯度下降基础', `
${dsUser('什么是梯度下降？')}
${dsAssistant('<p>梯度下降是一种迭代优化方法，目标是最小化<strong>损失函数</strong>。</p>')}
`))

writeFileSync(resolve(DS, 'math.html'), dsShell('公式测试', `
${dsUser('写出损失函数')}
${dsAssistant(`
<p>均方误差：${katexInline('L = \\frac{1}{n}\\sum (y_i - \\hat{y}_i)^2', 'L')}</p>
${katexDisplay('\\nabla_\\theta L(\\theta) = \\frac{2}{n} \\sum (y_i - \\hat{y}_i) \\frac{\\partial \\hat{y}_i}{\\partial \\theta}', '∇')}
<p>交叉熵在 DeepSeek 页面同样以 KaTeX 渲染。</p>
`)}
`))

writeFileSync(resolve(DS, 'table.html'), dsShell('表格提取', `
${dsUser('列个表')}
${dsAssistant(`<p>如下：</p>${tableHtml}`)}
`))

writeFileSync(resolve(DS, 'code.html'), dsShell('代码提取', `
${dsUser('给代码')}
${dsAssistant(`
<p>示例：</p>
${dsCodeBlock('python', codePython)}
${dsCodeBlock('sql', 'SELECT id, loss FROM runs WHERE epoch > 10 ORDER BY loss;')}
`)}
`))

writeFileSync(resolve(DS, 'mixed.html'), dsShell('数学建模问题', `
${dsUser('帮我整理数学建模的梯度流。')}
${dsAssistant(richAnswer)}
${dsAssistant(mermaidAnswer)}
`))

writeFileSync(resolve(DS, 'conversation.html'), dsShell('完整对话导出', `
${dsUser('第一问：什么是过拟合？')}
${dsAssistant('<p>过拟合是模型在训练集表现好、测试集差的现象。</p>')}
${dsUser('第二问：怎么防止？')}
${dsAssistant('<p>正则化、早停、数据增强。</p>')}
`))

// 回归：DeepSeek 主选择器（.ds-markdown.ds-markdown--block）失效 → _ds_markdown 变体生效
writeFileSync(resolve(DS, 'fallback.html'), dsShell('DeepSeek 降级', `
${dsUser('降级问题')}
<div class="_1a2b3c _ds_markdown_redux" data-message-id="ds-fb-1">
  <p>没有标准 ds-markdown 类名的<strong>回答</strong>。</p>
</div>
`))

console.log('fixtures written:')
for (const dir of [CG, DS]) {
  for (const f of ['basic', 'math', 'table', 'code', 'mixed', 'conversation', 'fallback']) {
    console.log(`  ${resolve(dir, f + '.html')}`)
  }
}
console.log(`  ${resolve(CG, 'images.html')}`)
console.log(`  ${resolve(CG, 'degraded.html')}`)
