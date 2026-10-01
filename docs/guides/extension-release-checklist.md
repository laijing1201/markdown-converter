# MarkDoc 扩展发布检查清单（P4C Release Gate）

> 版本 0.1.0 · 2026-09-19
> 全部通过后才允许上传 Chrome Web Store。

## 1. 自动化 Gate（全部脚本可执行）

| Gate | 命令 | 结果 |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | ✅ 通过 |
| 单元测试（含 OMML/Word/PDF/adapter/pipeline） | `npm test` | ✅ 通过（adapter 79 + contract 117 + UI/文件名 24 等） |
| Adapter Contract Tests | `npm run test:adapter:contract` | ✅ 117/117 |
| 扩展构建 | `npm run build:extension` | ✅ |
| 权限/CSP/产物审计 | `npm run audit:extension` | ✅ 31/31 |
| 扩展 E2E（Chrome for Testing） | `node scripts/test-ext-e2e.mjs` | ✅ 52/52 |
| 扩展 E2E（Edge） | `node scripts/test-ext-e2e.mjs --browser=edge` | ✅ 52/52 |
| 打包 + Unpack 校验 | `npm run package:extension` | ✅ artifacts/MarkDoc-Extension-v0.1.0.zip（32.0MB） |

## 2. ChatGPT 手动矩阵（真实账号，浅色 / 深色各一遍）

| 用例 | 浅色 | 深色 |
| --- | --- | --- |
| 打开对话 → Popup 显示 ✅ ChatGPT + 消息计数 | ⬜ | ⬜ |
| 单条回答 → Word（公式在 Word 中可编辑） | ⬜ | ⬜ |
| 单条回答 → PDF（文字可搜索、公式清晰） | ⬜ | ⬜ |
| 问答导出（问题 + 回答） | ⬜ | ⬜ |
| 多选（含跨页滚动选择）→ Word / PDF | ⬜ | ⬜ |
| 整段对话（对话模式 / 内容整理模式） | ⬜ | ⬜ |
| 表格跨页 / 代码块跨页 / 图片 / Mermaid | ⬜ | ⬜ |
| 「在 MarkDoc 中编辑」自动填入 | ⬜ | ⬜ |
| 流式生成中点击导出 → 弹「生成中」确认 | ⬜ | ⬜ |
| 切换聊天 → 重新导出不串内容 | ⬜ | ⬜ |
| 快捷键 Alt+Shift+W 导出最近回答 | ⬜ | ⬜ |

## 3. DeepSeek 手动矩阵（同上用例）

| 用例 | 浅色 | 深色 |
| --- | --- | --- |
| 打开对话 → Popup 显示 ✅ DeepSeek | ⬜ | ⬜ |
| 单条回答 → Word / PDF | ⬜ | ⬜ |
| 多选 / 整段对话 | ⬜ | ⬜ |
| 公式 / 表格 / 代码 / Mermaid | ⬜ | ⬜ |
| 切换聊天稳定性 | ⬜ | ⬜ |

## 4. 浏览器矩阵

| 用例 | Chrome | Edge |
| --- | --- | --- |
| 安装（加载已解压 / zip 解压） | ✅ E2E | ✅ E2E |
| Popup 各状态（正常 / 不支持 / 生成中 / 降级警告） | ✅ | ✅ |
| Content script 注入与防重复 | ✅ E2E | ✅ E2E |
| downloads 下载 Word / PDF | ✅ E2E | ✅ E2E |
| Options 设置页 | ✅ | ✅ |
| 首次安装 onboarding | ✅ | ✅ |
| 快捷键 | ⬜ 手动 | ⬜ 手动 |
| 离线导出（页面已加载 + 断网） | ✅ E2E | ✅ E2E |

## 5. 真实网站 Smoke（`scripts/smoke-extension.mjs`）

- [ ] 关闭浏览器 → `node scripts/smoke-extension.mjs --browser=edge` → 登录 ChatGPT → 回车 → 全项 PASS
- [ ] DeepSeek 同上
- 记录：2026-09-19 尚未在真实账号环境执行（需要人工登录）；工具已就绪。

## 6. 发布材料

- [x] `docs/guides/extension-privacy.md`（隐私政策）
- [x] `docs/guides/store-listing.md`（商店文案 + 权限说明）
- [ ] 商店截图（1280×800，≥1 张）
- [ ] 商店小宣传图（440×280）
- [x] 图标 16/32/48/128
- [x] zip 根目录含 manifest.json（package:extension 自动校验）

## 7. 已知问题与风险（发布前知悉）

1. **公式统计口径**：导出前统计把一个 aligned/matrix 块记为 1 个公式，DOCX 渲染为多行 oMath —— 仅影响界面计数展示，不影响导出内容。
2. **实验性平台**：Claude / Gemini / Kimi 有 Adapter 但无 DOM fixture 契约测试，标记为实验性；后续版本补齐。
3. **品牌 Chrome 137+**：不支持 `--load-extension` 开发模式加载，Smoke 工具推荐使用 Edge 或 Chrome for Testing。
4. **第三方 bundle 死路径**：exporter bundle 内存在少量第三方库 polyfill 的 `new Function`（浏览器 110+ 下短路/try-catch 优雅降级，永不执行），审计脚本按预算监控。
