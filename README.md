# MarkDoc - Markdown 文档转换工具

MarkDoc 是一个基于 React + TypeScript + Vite 的在线 Markdown 文档转换工具，，支持实时预览、LaTeX 数学公式、Mermaid 流程图渲染，以及一键导出为 DOCX 或 PDF 文件。

## 功能特性

- ✨ **Markdown 实时编辑与预览**：左侧使用 CodeMirror 编辑器，右侧实时渲染
- 🧮 **LaTeX 数学公式**：支持行内 `$...$` 和块级 `$$...$$` 公式渲染（KaTeX）
- 📊 **Mermaid 流程图**：支持流程图、时序图、甘特图等 Mermaid 图表
- 💻 **代码语法高亮**：支持 JavaScript、Python、TypeScript、Java、C++ 等常见语言
- 📋 **表格渲染**：支持 Markdown 表格的渲染与导出
- 📄 **DOCX 导出**：将渲染后的文档导出为 `.docx` 文件
- 📑 **PDF 导出**：将渲染后的文档导出为 A4 格式的 PDF 文件
- 🌙 **暗色模式**：支持亮色/暗色主题切换
- 🔒 **安全过滤**：使用 DOMPurify 进行 XSS 防护

## 技术栈

| 类别 | 技术 |
|------|------|
| 应用名称 | MarkDoc |
| 框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| Markdown 解析 | marked |
| 数学公式 | KaTeX |
| 流程图 | Mermaid |
| 代码高亮 | highlight.js |
| 编辑器 | @uiw/react-codemirror |
| PDF 导出 | html2pdf.js (html2canvas + jsPDF) |
| DOCX 导出 | docx (docxjs) — 程序化生成 Office Open XML |
| DOCX 图片 | html2canvas — 将 Mermaid/KaTeX 转为图片嵌入 |
| XSS 过滤 | DOMPurify |

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

启动后访问 `http://localhost:5173` 即可使用。

### 构建生产版本

```bash
npm run build
```

构建产物在 `dist/` 目录。

### 预览生产构建

```bash
npm run preview
```

## 使用说明

1. **编辑 Markdown**：在左侧编辑区输入或粘贴 Markdown 内容
2. **实时预览**：右侧自动渲染 Markdown，包括数学公式和流程图
3. **导出文档**：点击工具栏的「导出 DOCX」或「导出 PDF」按钮
4. **复制内容**：点击「复制内容」将渲染后的文本复制到剪贴板
5. **加载示例**：点击「加载示例」查看功能演示
6. **暗色模式**：点击「🌙 暗色」切换主题
7. **修复乱码**：粘贴内容出现乱码时，点击「修复乱码」自动尝试编码修复

### 导出文件名格式

导出的文件自动命名为 `MarkDoc-YYYYMMDDHHmmss.docx`（或 `.pdf`），其中时间戳为导出时的年、月、日、时、分、秒。

### 支持的 Markdown 语法

- 标题：`# H1` 到 `###### H6`
- 文本样式：`**粗体**`、`*斜体*`、`~~删除线~~`
- 列表：有序和无序列表
- 代码块：使用三个反引号 + 语言名称
- 表格：使用 `|` 分隔
- 链接：`[文本](url)`
- 图片：`![替代文本](url)`
- 任务列表：`- [x] 已完成`
- 引用：`> 引用文本`

### 导出提示

- 导出前请确保所有图表和公式已完全渲染
- PDF 导出使用 A4 纸张大小
- DOCX 导出会保留大部分样式，但复杂排版可能需要微调

## 项目结构

```
markdown-converter/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main.tsx                 # 入口
│   ├── App.tsx                  # 主组件（状态管理 + 布局）
│   ├── index.css                # 全局样式
│   ├── components/
│   │   ├── EditorPanel.tsx      # Markdown 编辑器
│   │   ├── PreviewPanel.tsx     # 实时预览面板
│   │   └── Toolbar.tsx          # 工具栏
│   ├── utils/
│   │   ├── markdownProcessor.ts # Markdown → HTML 处理管线
│   │   └── export.ts            # DOCX/PDF 导出功能
│   └── types/
│   │                       # (已移除) html-docx-js 不兼容浏览器
│               └── html2pdf.d.ts          # html2pdf.js 类型声明
└── README.md
```

## 注意事项

- 所有操作均在浏览器本地完成，无需后端服务
- 导出功能纯前端实现，不依赖第三方 API
- Mermaid 和 KaTeX 渲染为异步操作，导出等待渲染完成
- 如遇公式渲染错误，会显示原始 LaTeX 代码作为降级方案
- 乱码修复功能支持 UTF-8、GBK、Big5 等多种编码的自动检测与修复
