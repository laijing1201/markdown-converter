# MarkDoc Web 端优化记录与待办

> 本文记录 2026-10 两轮 Web 端体检的结论：已落地的优化、以及经评估维持现状的
> 已知问题（附原因），供后续迭代参考。

## 已落地（第一轮）

### 1. Mermaid 改为动态 import（首屏主包瘦身）

- `src/core/previewDom.ts`：`import mermaid from 'mermaid'` 改为按需动态加载
  （`loadMermaid()` 单例 Promise，首次渲染 Mermaid 图表时才下载并初始化）。
- 效果：主包（`dist/assets/main-*.js`，此前 ~1.9MB）不再包含 mermaid 核心；
  **不含图表的文档完全不下载 mermaid**，含图表的文档在首个图出现时按需加载。
- 预览 / Word / PDF / 扩展四端共用同一入口 `renderPreviewDom`，行为一致；
  `renderMermaidIn` 原本就是异步 API，调用方无需改动。

### 2. vendor 分包（跨发版缓存复用）

- `vite.config.ts`：新增 `manualChunks`，把 react / react-dom / scheduler、
  @codemirror 系列、katex 拆为独立 vendor chunk。
- 效果：应用代码发版后，vendor chunk 哈希不变，浏览器（GitHub Pages
  max-age=600 + ETag）可继续复用缓存，每次发版用户需重新下载的体积显著变小。

### 3. SEO：sitemap + robots + Open Graph 补全

- 新增 `public/sitemap.xml`（主站 / 隐私 / 条款三页），`public/robots.txt`
  末尾补 `Sitemap:` 行。
- 管理后台 `admin.html` 已有 `noindex, nofollow`，不进 sitemap（维持现状）。

### 4. PWA manifest 清理

- `public/manifest.webmanifest`：移除 `?action=export-docx` / `?action=export-pdf`
  两个 shortcuts——应用内从未实现对该参数的处理（点了只是普通打开），
  属于死功能；后续如需快捷方式应先在 App 内实现 `?action=` 分发再恢复。

### 5. 可访问性与文案修正

- `Toolbar.tsx`：滚动同步 / 暗色切换两个纯图标按钮补 `aria-label`；
  历史按钮 tooltip 原为「历史记录（登录后可用…）」，是账号体系停用前的
  残留文案，已改为与现状一致（本地历史、最近 10 份、无需登录）。
- `App.tsx`：警告条「✕」关闭按钮补 `aria-label`。
- `README.md`：本地历史上限由「最多 20 份」修正为与代码一致的
  「最近 10 份」（`src/core/history.ts` `MAX_ENTRIES = 10`）。

### 6. 工程杂项

- `package.json`：`pdfjs-dist` 仅测试脚本使用，由 dependencies 移到
  devDependencies（不影响产物，减少用户安装体积）。
- `.github/workflows/deploy.yml`：`npm install` → `npm ci`，保证 CI 构建
  与 package-lock 完全一致。

## 已落地（第二轮）

### 7. PDF 导出字体按需加载（首导下载 ~29MB → 按文档实际所需）⚡

此前三处无条件全量下载 6 只主字体（4 只思源 CJK 各 6~8MB WOFF）：

1. `layout.ts` 测量前 `ensureMainFontFaces()` 全量注册；
2. `render.ts` 缺字回退覆盖率（`FALLBACK_KEYS`）无条件下载 sans/serif/mono 全量字节；
3. `render.ts` 静态字符（目录/页码）对 serif/sans/serif-bold/sans-bold 四族冗余全加，
   把未使用的字族也拖进子集化。

现在的行为（**PDF 输出内容不变**，已被 `test-pdf-writer.ts` 的 pdfjs 文本提取
逐项验证）：

- **layout.ts**：新增 `collectNeededMainFontKeys(livePreview, settings)` —— 以预览
  DOM 的 computed style 逐元素判定（与 `harmonizeFonts` 同一套
  `resolveFontFamily` 映射），叠加渲染期静态文本保底规则：
  serif 恒需（正文固定 + 页码/页脚/目录条目）；任一标题 → sans + sans-bold
  （目录标题恒以 sans-bold 绘制）；页眉文字 → sans（`headerFont` 用 sans）；
  文档含 CJK → sans（等宽内 CJK 回退黑体、未知族兜底）；等宽/粗体变体按实际命中。
  例：纯文字无代码无标题的文档只注册 serif 一族（约 8MB → 实际下载仅 8MB 中的一只），
  典型文档跳过未使用的粗体/等宽变体。
- **fonts.ts**：`ensureMainFontFaces(needed?)` 支持传子集（缺省全量，测试与旧路径不变）。
- **render.ts**：覆盖率改为惰性加载——只为实际绘制的 fontKey 预载；
  回退链（sans → serif → mono → katex:Main → katex:AMS）在**首个缺字出现时**
  才逐个加载，指派顺序与结果与此前完全一致；静态字符按「实际绘制字体」
  裁剪（页眉→sans、目录标题→sans-bold 仅存在目录时、页码/页脚/条目→serif），
  并补上页脚「文字　页码」全角分隔符的字形。
- Cache API 跨会话缓存不变：同一设备只有第一次导出需要下载，之后命中本地缓存。

### 8. 社交分享图（og:image）正确化

- `public/icon-v3.png` 实为 630KB 的 JPEG（历史遗留，扩展名误导；
  pngjs 无法解码）。新增 `scripts/generate-og-image.mjs`
  （`npm run icons:og`，puppeteer-core + 系统 Chrome/Edge canvas 解码，
  与 `generate-pwa-icons.mjs` 同一方案）生成 `public/og-image.jpg`
  （1024×1024 JPEG q85，**95KB**，约为源图 1/8）。
- `index.html` og:image / twitter:image 指向 `og-image.jpg`（带尺寸与 alt）。
- `icon-v3.png` 本身保留：它仍是 electron-builder `build.icon` 与
  `generate-pwa-icons.mjs` 的输入；electron-builder 若要求真 PNG 可后续替换。

### 9. 弹窗键盘可访问性：Escape 关闭

- 新增 `src/components/modals/useEscapeClose.ts`：Escape 触发 `onClose`，
  与背景点击 / ✕ 按钮行为对齐；嵌套弹窗只关最上层（挂载顺序栈）；
  已被 preventDefault 的 Escape（如 DocumentSettingsModal 内部取消重命名）不响应。
- 接入 9 个弹窗：History / DeepFix / SmartFormat / PreExport / ExportReport /
  ImportLink / BatchExport / Auth / PdfPreview。
- **有意不接入**：ExportProgressModal（导出中不允许关闭）、AccountModal
  （背景点击本就不关闭，只有「关闭」按钮）、DocumentSettingsModal
  （内部有细粒度 Escape 处理，避免双重响应）。

## 维持现状（评估过，不改）

- **`netlify.toml` / `public/_redirects`**：Netlify 部署链路配置（国内 Supabase
  SNI 同源反代在用），GitHub Pages 忽略之，**不要删除**。
- **KaTeX 字体双份部署**：`dist/assets/KaTeX_*`（~1.2MB，预览公式渲染，
  浏览器只取 woff2）与 `dist/fonts/katex/`（~340KB TTF，PDF 嵌入）用途不同，
  合计可接受。
- **admin.html 与主站共用 CSS chunk**（含 KaTeX CSS ~100KB）：后台不渲染公式
  但共用构建产物；单独入口样式收益有限。
- **PDF 商务模板正文强制 Serif**：导出克隆固定 `--pd-body-font: MarkDoc Serif`
  （layout.ts），与模板/预览的正文字体（商务模板为雅黑系）存在既有的观感差异；
  改动会变更既有 PDF 输出并需重制视觉 baseline（`tests/pdf/baseline`），
  需要产品决策后再做。
