# MarkDoc Web 端优化记录与待办

> 本文记录 2026-10 一轮 Web 端体检的结论：已落地的优化、以及经评估暂不做的
> 已知问题（附原因与建议方案），供后续迭代参考。

## 已落地（本轮）

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
- `index.html`：补 `og:image:width/height/alt`（1024×1024）与
  `twitter:image` / `twitter:image:alt`。
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

## 已知问题与待办（本轮未做，按影响排序）

### A. PDF 首次导出需下载全部 6 只主字体（~29MB）⚡ 影响最大

- 现状：`src/core/pdf/layout.ts` 在布局开头无条件 `ensureMainFontFaces()`，
  4 只思源字体各 6~8.4MB WOFF，无论文档是否包含中文、模板是否用到该字重，
  首次导出都要拉全量（有 Cache API 跨会话缓存，仅首次慢；移动端尤其明显）。
- 建议方案：按文档实际字符集（是否含 CJK）与 `DocSettings` 实际命中的
  字体族/字重惰性加载；需要同时调整 fallback 链，避免「全英文文档 + 中文
  字体」场景缺字形。改动面在 `src/core/pdf/fonts.ts` + `layout.ts`，需配合
  `test:pdf:visual` 回归。

### B. og:image 是 630KB 的「假 PNG」

- `public/icon-v3.png` 实为 JPEG（1024×1024，扩展名误导）；作为社交分享图
  偏大，且 electron-builder 的 `build.icon` 也指向它（要求真 PNG）。
- 建议：用图像工具转出真 PNG（≥512×512）替换或另存 `og-image.png` 并压缩
  到 <200KB；同步更新 `index.html` 与 `package.json` 的 `build.icon`。

### C. 弹窗可访问性：Escape 关闭与焦点管理

- 12 个 Modal 中仅 DocumentSettingsModal / AuthModal 处理了按键；
  无 focus trap，Toast 为可点击 `div` 无键盘可达，移动端 tablist 无方向键
  导航与 `aria-controls`。
- 建议：抽一个 `useEscapeClose(onClose)` + 通用 focus-trap hook，先覆盖
  内容型弹窗（History / DeepFix / SmartFormat / PreExport / ImportLink /
  Batch / ExportReport）；ExportProgressModal 等进度类弹窗需确认业务上
  是否允许中途关闭再接入。

### D. 部署体积小项

- `dist/assets/KaTeX_*`（~1.2MB，预览公式渲染用，浏览器只取 woff2）与
  `dist/fonts/katex/`（~340KB TTF，PDF 嵌入用）双份部署——用途不同，
  合计可接受；若要省可评估预览侧换 CDN 或子集化。
- `admin.html` 与主站共用 CSS chunk（含 KaTeX CSS），后台并不渲染公式；
  可给 admin 单独入口样式或接受现状。
- `public/_redirects` 与 `netlify.toml` 为 Netlify 部署链路配置（国内
  Supabase SNI 反代在用），GitHub Pages 忽略之，**不要删除**。
