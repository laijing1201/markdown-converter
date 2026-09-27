/**
 * PDF 导出真实浏览器 E2E 测试。
 *
 * 流程：构建产物由 vite preview 提供 → puppeteer-core 驱动系统 Chrome →
 * 每个场景注入 Markdown → 点击「导出 PDF」→ 捕获下载 → 保存到 tests/pdf/out/。
 * 之后的验证（pdfinfo / pdfjs 提取 / pdftoppm 渲染）由 test-pdf-verify.mjs 完成。
 *
 * 运行：node scripts/test-pdf-e2e.mjs [--skip-build] [--only=caseA]
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'
import { mkdirSync, existsSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve('.')
const OUT_DIR = join(ROOT, 'tests/pdf/out')
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

function findBrowser() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p
  }
  throw new Error('未找到 Chrome/Edge，请安装后重试')
}

// ── 测试文档 ─────────────────────────────────────────────────────────────────

const CASE_A = `# 人工智能发展简报

人工智能是计算机科学的一个分支，中文正文用于验证字体渲染。English paragraph mixing with 中文内容 12345.

## 研究背景

从 ChatGPT 到 DeepSeek，大模型能力快速提升。**加粗文本**与*斜体文本*以及\`行内代码\`都应该正确渲染。

- 无序列表第一项
- 无序列表第二项
  - 嵌套列表项
- 第三项

1. 有序列表一
2. 有序列表二
3. 有序列表三

- [x] 已完成任务
- [ ] 待办任务

> 引用块：这是一段引用文字，验证引用样式。

[OpenAI 链接](https://openai.com) 与 [中文链接：百度](https://www.baidu.com)

---

## 结束

文档到此结束。
`

const CASE_B = `# 数学公式测试

行内公式：质能方程 $E = mc^2$ 以及 $\`\\alpha^2 + \\beta^2 = \\gamma^2$\`

块级公式：

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$

$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$

$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$

矩阵：

$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$

分段函数：

$$f(x) = \\begin{cases} x^2, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}$$

多行对齐：

$$\\begin{aligned} f(x) &= x^2 + 2x \\\\ g(x) &= \\sqrt{x} \\end{aligned}$$

嵌套分数：$\\frac{1}{1 + \\frac{1}{x}}$，希腊字母 $\\alpha\\ \\beta\\ \\gamma\\ \\delta\\ \\pi\\ \\Omega$，上下标 $x^{2n}_{i=1}$
`

const CASE_C_ROWS = 32
const CASE_C = (() => {
  let md = '# 30 行表格测试\n\n以下表格用于验证表格跨页与表头重复。\n\n| 序号 | 模型名称 | 参数量 | 上下文 | 备注 |\n|------|----------|--------|--------|------|\n'
  for (let i = 1; i <= CASE_C_ROWS; i++) {
    md += `| ${i} | Model-${i} | ${i * 7}B | ${i * 8}K | 测试行数据 ${i} |\n`
  }
  md += '\n表格之后还有一段文字，确认表格结束后内容正常。这句话应该出现在表格下一页或同一页尾部。\n'
  return md
})()

const CASE_D = `# 代码与图表综合测试

## Python 代码

\`\`\`python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    right = [x for x in arr if x >= pivot]
    return quicksort(left) + quicksort(right)
\`\`\`

## JavaScript 代码（长行）

\`\`\`javascript
const veryLongLine = "这是一个非常长的代码行用来测试自动换行策略这是一个非常长的代码行用来测试自动换行策略这是一个非常长的代码行用来测试自动换行策略 ABCDEF";
console.log(veryLongLine);
function greet(name) { return \`Hello, \${name}!\`; }
\`\`\`

## Mermaid 流程图

\`\`\`mermaid
graph TD
    A[用户输入] --> B{格式校验}
    B -->|通过| C[解析内容]
    B -->|失败| D[提示错误]
    C --> E[渲染预览]
    E --> F[导出文档]
\`\`\`

图片（SVG data URI）：

![测试图](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzNiODJmNiIvPjx0ZXh0IHg9IjEwMCIgeT0iNTUiIGZvbnQtc2l6ZT0iMjAiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5UZXN0IFNWRzwvdGV4dD48L3N2Zz4=)

代码之后的内容确认正常结束。
`

const CASE_E = `# 基于深度学习的文本分类研究

## 摘要

本文提出一种基于深度学习的中文文本分类方法。摘要部分用于验证学术论文模板的自动识别。

关键词：深度学习；文本分类；中文

## 绪论

### 研究背景

近年来，预训练语言模型发展迅速。

### 研究意义

自动化文本分类可以大幅提升效率。

## 方法

### 模型结构

模型采用 Transformer 编码器。

### 实验设置

数据集包含 10000 条样本。

## 实验结果

实验表明方法有效。

## 参考文献

[1] Devlin J, et al. BERT: Pre-training of Deep Bidirectional Transformers. 2019.
[2] Vaswani A, et al. Attention Is All You Need. 2017.
`

const CASE_F = `# 横向 Letter 测试

这是一份横向 Letter 纸张的测试文档。验证页面尺寸与方向设置正确应用于 PDF。

## 第二节

第二段内容，用于填充页面。

- 项目一
- 项目二
`

const CASE_G = `# 分页符测试

这是第一页的内容。

<!-- pagebreak -->

这是第二页的内容，出现在分页符之后。

<!-- pagebreak -->

第三页内容。如果分页正确，本 PDF 应该至少有三页，且每个"第 X 页"的字样正好落在各自的页面上。
`

const LONG_PARA = (n) => Array.from({ length: n }, (_, i) => `这是第 ${i + 1} 段测试文字，包含中英文混合内容 mixed content with numbers ${i * 13}，用于生成足够长的文档验证分页稳定性与大文档性能表现。The quick brown fox jumps over the lazy dog.`).join('\n\n')
const CASE_H = `# 超长文档压力测试

${LONG_PARA(120)}

## 中间章节

${LONG_PARA(60)}

## 表格

| 列A | 列B | 列C |
|-----|-----|-----|
| 1 | 2 | 3 |
| 4 | 5 | 6 |

${LONG_PARA(40)}

## 结束章节

${LONG_PARA(30)}
`

// 模拟 AI 审稿报告：列表内 **标签：**加粗、ASCII 行内代码（引用键）、
// 多列中文长文表格 —— 回归三类问题：
//   1. 字面 ** 泄漏（CommonMark flanking 规则对 CJK 失效）
//   2. 行内代码在 PDF 中只剩背景色块、文字消失（ASCII + mono 字体路径）
//   3. 表格列被 auto 布局挤成一字一行
const CASE_I = `# 整篇一致性检查报告

总体判断：研究问题基本明确，影响论文质量的主要问题集中在**引言与实际实现不一致、比较基线的身份**，以及理论假设与实验模型之间的距离。

## 问题清单

- **位置：**引言贡献第（3）项；第2.6节；附录C.4。
- **问题类型：**实现事实不一致，贡献表述超出证据。
- **具体表现：**引言称依据参数维数选择 Woodbury 或参数空间 CG，第2.6节却明确实际实现采用参数空间 CG；引用键 \`zhO9,zhO10,zhO11\` 被共同用于概括随机化、对偶及矩阵无关自然梯度。
- **可能造成的影响：**读者会误以为论文实现并评估了两种计算路径，详见 \`engd.py\` 与 [原文页面](https://example.com/paper)。
- **修改建议：**将"当前实现"和"满足额外结构条件时可考虑的替代形式"分开，统一 \`ALM-L-BFGS\` 写法。

符号回退验证：∂ − ⊤ ⊥ ≤ ≥ ≠ → ∈ ★ § ✓ ✗ × ① 以及 © ° ± 与 CJK 破折号 ——，这些字符必须全部可见而非空方框。

## 一致性检查表

| 【发现的问题】 | 【所在位置】 | 【前文表述】 | 【后文表述】 | 【是否存在冲突】 | 【建议统一方式】 |
|---|---|---|---|---|---|
| Woodbury 是否实际采用 | 引言贡献（3）／2.6／附录C.4 | 按规模采用 Woodbury 或 CG | 当前仅用 CG，辅助 Woodbury 未使用 | 明确冲突 | 全文以实际实现为准，另列条件性替代方案 |
| CAPU 名称对应何种算法 | 引言／2.2／实验表 | 引用原 CAPU 的独立自适应机制 | 本地采用不同判据及共同增长规则，表中仍写 CAPU | 身份混用 | 统一标注本地变体，限定比较结论 |
| 条件数改善是否已验证 | 引言／3.1／4.1 | 以强病态及改善内层条件性解释收益 | 明确没有条件数测量，第四章只支持条件性收益 | 证据强度不一致 | 分开"设计目标"与"已验证结果" |
| 残差 ri 的尺度 | 2.1／附录C.2／实验设置 | $r_i = \\mathcal{N}[u_\\theta] - f$，目标为半平方和 | 理论—实现映射使用缩放残差 | 可经过变换协调，但当前定义不够统一 | 主文区分原始残差、缩放残差与采样均值 |
| 摘要与正文关系 | frontmatter／全文 | 摘要为空 | 正文已有完整结论与限制 | 无法核验，属于缺失 | 摘要完成后检查目标、方法、主要结果和限制是否逐项对应 |

表格核查未发现需要列入问题清单的主要汇总数值矛盾：**引用键完整不等于文献内容均支持相应论断**。
`

// 甲方验收样张（2026-09-27 导出质量事故整改）：覆盖全部污染形态 ——
//   1. \(...\)/\[...\] 定界符公式（含 KaTeX 三重复制污染）
//   2. ===== Page N ===== PDF 提取分页标记
//   3. \*\*转义加粗\*\* 与 **标签：**后紧跟英文
//   4. 整段 HTML 表格 + 段内转义 HTML 表格
//   5. GFM 表格单元格内公式
// 验收标准：导出正文无源码残留、无 Page 标记、公式可编辑、表格为原生表格。
const CASE_J = readFileSync(join(ROOT, 'tests/fixtures/caseJ-acceptance.md'), 'utf8')

const CASES = [
  ['caseA-basic', CASE_A, {}],
  ['caseB-math-heavy', CASE_B, {}],
  ['caseC-table-heavy', CASE_C, {}],
  ['caseD-code-mermaid-image', CASE_D, {}],
  ['caseE-academic', CASE_E, { settings: { template: 'academic', headingNumbering: '1.1', includeToc: true, includePageNumbers: true } }],
  ['caseF-landscape-letter', CASE_F, { settings: { paper: 'letter', orientation: 'landscape' } }],
  ['caseG-pagebreak', CASE_G, {}],
  ['caseH-long-doc', CASE_H, {}],
  ['caseI-review-report', CASE_I, {}],
  ['caseJ-acceptance', CASE_J, {}],
]

// ── 主流程 ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--only='))?.slice(7)
const PORT = 4390

async function waitForFile(dir, prevNames, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.pdf') && !prevNames.includes(f))
    if (files.length > 0) {
      const f = files[0]
      const p = join(dir, f)
      // 等文件写入完成（大小稳定）
      let last = -1
      for (let i = 0; i < 20; i++) {
        const size = statSync(p).size
        if (size > 0 && size === last) return p
        last = size
        await sleep(300)
      }
      return p
    }
    await sleep(400)
  }
  throw new Error('下载超时：未捕获到 PDF 文件')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const existing = existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  })

  // 静态服务：直接用 python http.server 提供 dist（vite preview 更慢且需要 cwd）
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', join(ROOT, 'dist')], { stdio: 'ignore' })
  await sleep(1500)

  let pass = 0
  let fail = 0
  const results = []

  try {
    for (const [name, markdown, opts] of CASES) {
      if (only && name !== only) continue
      console.log(`\n═══ ${name} ═══`)
      const page = await browser.newPage()
      const cdp = await page.createCDPSession()
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT_DIR })
      page.on('console', async (msg) => {
        const t = msg.type()
        if ((t === 'error' || t === 'warning' || t === 'warn') && !msg.text().includes('favicon')) {
          const parts = await Promise.all(msg.args().map(async (a) => {
            try { return await a.jsonValue().then(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).catch(() => a.toString()) } catch { return '?' }
          }))
          console.log(`  [console.${t}]`, parts.join(' | ').slice(0, 2000))
        }
      })

      try {
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2', timeout: 60000 })
        await page.evaluate(() => localStorage.clear())
        await page.reload({ waitUntil: 'networkidle2' })
        await page.waitForFunction('window.__MARKDOC_TEST__?.ready', { timeout: 15000 })

        // 应用场景设置
        await page.evaluate((o) => {
          if (o?.settings) window.__MARKDOC_TEST__.setSettings({ ...window.__MARKDOC_TEST__.getSettings(), ...o.settings })
        }, opts)
        await sleep(300)

        // 注入内容并等待预览渲染（KaTeX/Mermaid 异步）
        await page.evaluate((md) => window.__MARKDOC_TEST__.setContent(md), markdown)
        await sleep(2500)
        await page.waitForFunction(() => {
          const el = document.getElementById('preview-container')
          if (!el || !el.innerHTML.trim()) return false
          const mathEls = el.querySelectorAll('.math-inline, .math-block')
          for (const m of mathEls) if (!m.querySelector('.katex') && !m.textContent.startsWith('$')) return false
          const mermaidEls = el.querySelectorAll('pre > code')
          return el.querySelectorAll('.mermaid-rendered, .mermaid-error').length >= 0 && (mermaidEls.length === 0 || el.querySelectorAll('.mermaid-rendered').length > 0 || el.querySelector('.mermaid-error'))
        }, { timeout: 30000 })
        await sleep(800)

        // 点击导出 PDF
        const before = readdirSync(OUT_DIR)
        const exportBtn = await page.waitForSelector('::-p-text(导出 PDF)', { timeout: 5000 })
        await exportBtn.click()

        // 预检弹窗可能出现 → 点击「仍要导出PDF」
        await sleep(1200)
        const confirmBtn = await page.$('::-p-text(仍要导出PDF)')
        if (confirmBtn) {
          console.log('  （预检弹窗出现，点击仍要导出）')
          await confirmBtn.click()
        }

        const file = await waitForFile(OUT_DIR, before)
        const sizeKB = statSync(file).size / 1024
        // 统一命名保存
        const finalPath = join(OUT_DIR, `${name}.pdf`)
        rmSync(finalPath, { force: true })
        const raw = readFileSync(file)
        writeFileSync(finalPath, raw)
        rmSync(file, { force: true })
        console.log(`  ✓ 下载成功：${name}.pdf（${sizeKB.toFixed(0)} KB）`)
        results.push({ name, file: finalPath, sizeKB })
        pass++
      } catch (err) {
        console.log(`  ✗ 失败：${err.message}`)
        results.push({ name, error: err.message })
        fail++
      } finally {
        await page.close()
      }
    }
  } finally {
    server.kill()
    await browser.close()
  }

  writeFileSync(join(OUT_DIR, 'e2e-results.json'), JSON.stringify(results, null, 2))
  console.log(`\nE2E RESULT: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
