# MarkDoc - 把 AI 回答一键变成排版好的 Word / PDF

MarkDoc 是一个基于 React + TypeScript + Vite 的在线文档工具：把 **ChatGPT / DeepSeek / Kimi / 豆包** 等 AI 的回答（或任何 Markdown 内容）粘贴进去，一键导出排版规范的 `.docx` / `.pdf` —— **LaTeX 公式在 Word 中是原生可编辑公式、在 PDF 中保持矢量清晰**，PDF 文字可选中、可搜索、可复制，表格、代码、Mermaid 图表完整保留。

Markdown 是底层技术，不是使用门槛：普通用户不需要懂 Markdown，粘贴即可。

## 🌐 三种使用方式

| 入口 | 适合谁 | 说明 |
|------|--------|------|
| **MarkDoc Web（在线版）** | 所有人 | **无需安装、无需登录**，打开即用；全部转换在浏览器本地完成 |
| **MarkDoc Desktop（桌面增强版）** | 频繁处理本地文档的用户 | 拥有 Web 全部核心能力，额外提供：原生文件选择器、本地 Markdown 打开/保存、桌面工作流 |
| **MarkDoc Extension（浏览器扩展）** | ChatGPT / DeepSeek 重度用户 | 在 AI 页面直接把回答导出为 Word / PDF，或发送到 MarkDoc Web 中编辑 |

### MarkDoc Web（正式地址）

**[https://laijing1201.github.io/markdown-converter/](https://laijing1201.github.io/markdown-converter/)**

打开网站后的完整流程：

```text
粘贴 AI / Markdown 内容 → 实时预览 → 选择模板（通用 / 学术 / 商务）→ 查看「最终效果」→ 导出 Word / PDF
```

不注册、不登录、不上传服务器；文档转换（含 PDF 字体子集化）全部在浏览器本地完成。PDF 字体在首次导出时按需加载并缓存，首屏不会下载大字体文件。

> 需要打开本地 Markdown、自动保存或桌面文件管理？可以在 Web 版基础上下载 [MarkDoc Desktop](https://github.com/laijing1201/markdown-converter/releases/latest)（可选增强，在线版功能不受影响）。

## ✨ 核心特性

- 🤖 **AI 内容容错**：粘贴时自动修复 AI 输出中最常见的格式破损（未闭合的代码块/公式/粗体、表格缺列、`#` 后缺空格），并提示"已自动修复 N 处"
- 🧮 **双公式管线**：Word 用 LaTeX → MathML → OMML 原生可编辑公式；PDF 用 KaTeX 矢量渲染（字形 + SVG 路径），缩放打印都清晰
- 📕 **真文本 PDF**：字体子集嵌入（思源宋体/黑体），文字可选中/搜索/复制；真实分页引擎（keep-with-next、孤行寡行控制、表格跨页表头重复、`<!-- pagebreak -->`）；目录页码可点击跳转；页眉/页脚/页码
- 📋 **导出前质量检查**：按导出目标（Word/PDF）分别检查公式语法、超宽表格、超大图片、字体替代等，避免下载后才发现问题
- 📑 **三套排版模板**：通用文档 / 学术论文 / 商务报告（工具栏缩略图一键切换，也可在高级设置中细调并另存为自定义模板），预览、Word、PDF 三端所见即所得；学术论文模板自动识别 摘要/关键词/参考文献 并套用对应样式（三线表、摘要样式）
- 📄 **目录与页码**：Word 自动目录（打开时更新域）+ PDF 静态目录；页码位置可选、首页可隐藏；页眉/页脚文字 Word/PDF 共用
- 👁 **最终效果**：导出前按打印分页逐页预览（真实分页、页眉页脚、页码），提前看到「第 3 页是什么样」；编辑区底部状态条实时显示 字数/公式/表格/图片/预计页数 与文档健康度
- 📝 **实时编辑与预览**：CodeMirror 编辑器 + A4 纸张视图预览，滚动同步
- 📊 **Mermaid 图表**：流程图、时序图、甘特图等，PDF 中以 3× 分辨率渲染
- 🖼 **图片支持**：Ctrl+V 粘贴截图、拖拽图片、Markdown 图片语法、Base64；PDF 提供图片质量档（高/标准/压缩）
- 📂 **文件导入**：拖入或选择 `.md` / `.txt` 文件（桌面版使用系统文件选择器，可直接保存 `.md`）
- 📋 **富文本复制**：复制渲染结果，直接粘贴进 Word 保留排版
- 🕘 **本地历史**：编辑内容自动保存在浏览器本地（最多 20 份），无需登录
- 🔒 **隐私安全**：所有转换（含 PDF 生成的字体子集化）均在浏览器本地完成，内容不上传服务器
- 🛠 **编码修复**：UTF-8/GBK/Big5 乱码一键深度修复；智能排版引擎（PDF 断行缝合、标题/表格结构推断）

## 技术栈与三端架构

```text
                    MarkDoc Core（src/core/*）
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
   MarkDoc Web      MarkDoc Desktop    MarkDoc Extension
   GitHub Pages        Electron        Chrome / Edge
  （在线零安装）     （桌面增强）        （AI 页面快捷入口）
```

- 三端共用同一条转换管线：Markdown 解析 → 预览 DOM → DOCX 导出（OMML 公式）→ 真文本 PDF（pdf-lib + harfbuzz 子集字体）；扩展导出引擎复用同一套 `buildDocxBlob` / `buildPdf` Blob 入口，没有第二套导出实现
- 平台差异收敛在 `src/platform/`（capabilities + adapter）：core 导出器只产出 Blob，「怎么保存」（浏览器下载 / Electron 原生另存为）由平台层决定
- 桌面增强通过 `electron/preload.ts` 的 contextBridge 白名单暴露（打开本地 Markdown / 原生另存为），渲染进程与 Node 隔离

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建工具 | Vite 5（Electron 插件按命令启用：`dev`/`build:electron` 含桌面端，`build`/`build:web` 纯 Web） |
| 样式 | Tailwind CSS 3 |
| Markdown 解析 | marked |
| 数学公式渲染 | KaTeX |
| 公式导出（Word） | KaTeX MathML 输出 + mathml2omml（OMML） |
| Word 文档生成 | docx (docxjs) — Office Open XML，含原生公式（OMML） |
| PDF 生成 | pdf-lib + @pdf-lib/fontkit（真文本 PDF） |
| PDF 分页引擎 | 浏览器实测 + 自研分页（`src/core/pdf/layout.ts`） |
| PDF 字体子集 | harfbuzzjs（hb-subset.wasm） |
| PDF 字体加载 | 按需 fetch + Cache API 跨会话缓存（首屏零字体流量） |
| Mermaid/图片（PDF） | SVG → Canvas 3× 光栅嵌入 |
| 流程图 | Mermaid |
| 代码高亮 | highlight.js |
| 编辑器 | @uiw/react-codemirror |
| XSS 过滤 | DOMPurify |

## 快速开始

```bash
npm install
npm run dev            # 开发模式（含 Electron；访问 http://localhost:5173）
npm run dev:web        # 纯 Web 开发模式
npm run typecheck      # TypeScript 检查
npm run build          # Web 生产构建（GitHub Pages 部署用），产物在 dist/
npm run build:electron # 桌面版构建 + electron-builder 打包
npm test               # 全部单元测试（markdown / OMML / docx / PDF 管线 / Adapter / 扩展管线）
npm run test:web:e2e   # Web E2E（真实浏览器，含 GitHub Pages 生产 base 模拟）
```

### GitHub Pages 部署

- push 到 `main` 分支后，`.github/workflows/deploy.yml` 自动：install → build（纯 Web）→ 部署 `dist/` 到 GitHub Pages
- 生产地址：`https://laijing1201.github.io/markdown-converter/`
- Vite `base: './'`（相对路径），同时兼容 Pages 子路径与 Electron `file://`；本地可用 `node scripts/serve-ghpages.mjs dist 8899` 模拟 `/markdown-converter/` 子路径验证

## Browser Extension（浏览器扩展）

不用复制粘贴：在 ChatGPT / DeepSeek 等 AI 页面，直接把当前回答、一组问答、多选消息或整段对话导出为排版良好的 **Word（公式可编辑）** 和 **PDF（文字可搜索）**。

扩展不依赖 Desktop：安装后即可独立完成 Word / PDF 导出；「在 MarkDoc 中编辑」直接连接 MarkDoc Web 正式地址。

### 开发与构建

```bash
npm run icons:ext        # 首次：生成扩展图标（仅图标变更时需要）
npm run build:extension  # 构建扩展 → dist-extension/
```

- 网页版与扩展共用 `src/core/*` 全部核心（Markdown 解析、DOCX/PDF 渲染、OMML 公式、模板、preflight、filename、DOMPurify 清洗），**没有第二套导出实现**
- `extension/` 只包含平台适配层（Adapter / 提取 / UI / 桥接）与导出引擎页
- Vite（`vite.extension.config.ts`）构建 popup 与 exporter 页面；esbuild 打包 background / content / bridge（MV3 单文件 IIFE）

### Chrome / Edge 加载方式（开发者模式）

1. `npm run build:extension` 生成 `dist-extension/`
2. Chrome：`chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选择 `dist-extension/`
3. Edge：`edge://extensions` → 「开发人员模式」→「加载解压缩的扩展」→ 选择 `dist-extension/`
4. 打开 [chatgpt.com](https://chatgpt.com) 或 [chat.deepseek.com](https://chat.deepseek.com)，页面右下角出现 📄 悬浮球，每条 AI 回答悬停时右上角出现 📄 导出按钮

> 自动化 E2E 测试需要 Chrome for Testing（品牌 Chrome 137+ 已移除 `--load-extension` 支持）：
> `npx @puppeteer/browsers install chrome@stable --path tests/ext/browsers`

### 支持的网站

| 平台 | 状态 |
|------|------|
| ChatGPT（chatgpt.com / chat.openai.com） | ✅ 稳定支持 |
| DeepSeek（chat.deepseek.com） | ✅ 稳定支持 |
| Claude（claude.ai） | 🧪 实验性 |
| Gemini（gemini.google.com） | 🧪 实验性 |
| Kimi（kimi.com） | 🧪 实验性 |

### 功能

- **单条回答**：每条 AI 回答右上角 📄 按钮 → 导出 Word / 导出 PDF / 导出问答（问题+回答）/ 在 MarkDoc 中编辑
- **多选消息**：悬浮球 → 选择消息 → 逐条勾选（全选 / 全不选 / 只选用户 / 只选 AI / 反选）→ 导出 Word / PDF / 在 MarkDoc 中编辑
- **整段对话**：A 对话模式（用户/AI 交替带角色标题）或 B 内容整理模式（去角色标签、以标题层级成文）
- **快捷键**：`Alt+Shift+W` 导出最近回答（默认格式在弹窗设置）
- **生成中提示**：回答仍在流式输出时先确认「继续导出 / 取消」，不无限等待
- **导出前质量检查**：复用网页版 target-aware preflight，有问题可「继续导出」或「在 MarkDoc 中修复」
- **在 MarkDoc 中编辑**：内容存入扩展本地临时区（30 分钟有效、读取一次即删除）→ 自动打开 MarkDoc Web（[正式地址](https://laijing1201.github.io/markdown-converter/)）填入编辑器

### 权限说明（最小权限）

- `storage`：保存快速设置、导出任务与「在 MarkDoc 中编辑」临时内容（全部本地）
- 站点访问：仅上述 5 个 AI 站点 + MarkDoc Web 正式地址（桥接用），不请求 `<all_urls>`
- **不申请**：浏览历史、Cookies、下载记录、`scripting` 等敏感权限；不读取任何其他页面

### 隐私说明

🔒 所有内容（对话文本、公式、图片、生成的 Word/PDF）默认在浏览器本地处理，不上传任何服务器。「在 MarkDoc 中编辑」的临时内容保存在本机 `chrome.storage.local`，30 分钟后自动过期，读取一次即删除。DOM 改版导致提取失败时提供的「复制诊断信息」只包含扩展版本 / 平台 / hostname / 选择器命中数 / 消息数量 / 浏览器版本，**不含任何聊天正文**。

### Adapter 开发说明（如何新增一个 AI 平台）

1. 在 `extension/src/adapters/` 新建 `<platform>.ts`，实现 `ChatPlatformAdapter` 接口（`detect` / `getConversationTitle` / `getMessages` / `getMessageFromElement` / `observeNewMessages` / `isGenerating` / `getMessageElements`）
2. 平台选择器集中写在 adapter 内部的 `selectors` 表：优先 `data-testid` / `role` / `aria-label` / 语义结构，每条链提供 fallback；禁止裸哈希 class 与随意 `:nth-child`
3. 在 `extension/src/adapters/registry.ts` 注册，并在 `extension/manifest.json` 的 `content_scripts` 与 `host_permissions` 增加站点
4. 内容提取直接调用 `extension/src/extraction/domToMarkdown.ts` 的 `extractMarkdown`（KaTeX annotation / MathJax script 中的 LaTeX 自动恢复；之后统一经网页版 DOMPurify 清洗）
5. 在 `tests/fixtures/<platform>/` 添加人工构造的 DOM fixture（禁止真实聊天数据），并在 `scripts/test-adapters.ts` 增加断言（消息数 / 顺序 / 公式 / 表格 / 代码 / 链接 + fallback 降级）
6. 平台未识别时扩展静默退出；DOM 改版导致提取失败时显示诊断入口而非裸报错

## 使用流程（Web 版）

1. **粘贴内容**：把 AI 回答粘贴到左侧编辑器（格式破损会自动修复并提示）；也支持拖入 `.md`/`.txt` 文件、Ctrl+V 粘贴截图
2. **选模板**：工具栏缩略图一键切换 通用 / 学术 / 商务；细项（字体、行距、页边距、页眉页脚、目录…）在「⚙ 高级设置」
3. **看最终效果**：点击「最终效果」逐页检查真实分页、页眉页脚、页码
4. **导出**：点击「导出 Word」或「导出 PDF」；有问题会先弹出对应目标的质量检查报告；编辑区底部状态条可随时查看文档健康度

## MarkDoc Desktop

在 Web 全部能力之上增加：

- 原生文件选择器打开本地 Markdown
- 「💾 保存」直接另存 `.md` 到任意本地路径
- 同样的 DOCX / PDF 导出（原生「另存为」对话框，导出管线与 Web 完全同源）
- 历史记录、拖放导入、自动保存等与 Web 一致

构建：`npm run build:electron`（产物在 `release/`）。
