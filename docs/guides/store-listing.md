# Chrome Web Store 发布素材 — MarkDoc 扩展

> 提交前请对照 `docs/guides/extension-release-checklist.md`，全部 Gate 通过后再上传。

## 名称（≤45 字符）

```
MarkDoc – AI 对话导出 Word / PDF
```

## 一句话介绍（≤132 字符）

```
把 ChatGPT、DeepSeek 等 AI 回答一键导出为排版良好的 Word / PDF：公式可编辑、文字可搜索、表格代码完整保留。全程本地处理。
```

## 分类

生产工具（Productivity）

## 详细描述

```
MarkDoc 把 AI 对话变成排版专业的文档。

✦ 导出内容
• 单条 AI 回答：鼠标移到回答上，点 MarkDoc 按钮
• 问答对：问题 + 回答一起导出
• 多选消息：勾选任意多条，按对话顺序合并
• 整段对话：对话模式（保留角色）或内容整理模式（仅 AI 内容）

✦ 两种格式
• Word（.docx）：数学公式转换为 Word 原生公式（OMML），在 Word 中可直接编辑
• PDF：真文本（可搜索、可复制），中文字体嵌入，含目录与页码

✦ 内容完整性
• 数学公式：行内 / 块级 / 矩阵 / 分段函数
• 表格（跨页）、代码块（语法高亮、跨页）
• 图片、Mermaid 图表、链接（可点击）、标题层级、列表

✦ 隐私
• 全部处理在你的浏览器本地完成，不上传任何内容
• 不读取浏览历史与 Cookie
• 「在 MarkDoc 中编辑」临时数据 30 分钟后自动删除

✦ 其他
• 快捷键 Alt+Shift+W：导出最近一条 AI 回答
• 支持站点：ChatGPT（chatgpt.com）、DeepSeek（chat.deepseek.com）；
  Claude / Gemini / Kimi 为实验性支持
• 网站改版导致识别失败时，扩展会主动提示并可一键复制诊断信息（不含聊天内容）

使用方法：打开任意 AI 对话 → 鼠标移到回答上 → 点击 MarkDoc 按钮 → 选择 Word 或 PDF。
```

## 权限说明（提交时填写）

| 权限 | 理由 |
| --- | --- |
| `storage` | 在本地保存导出偏好设置与一次性导出任务 |
| Host: `chatgpt.com`, `chat.openai.com`, `chat.deepseek.com`, `claude.ai`, `gemini.google.com`, `kimi.com` | 在受支持的 AI 对话页面注入导出按钮并读取页面内容以生成文档 |
| Host: `laijing1201.github.io/markdown-converter`, `localhost:5173` | 「在 MarkDoc 中编辑」功能：将所选内容填入 MarkDoc 网页版编辑器 |

单条用途声明（Single purpose）：将 AI 对话内容在本地转换为 Word / PDF 文档。

## 隐私实践声明（Privacy tab）

- ❌ 不收集个人身份信息
- ❌ 不收集健康 / 财务 / 通信信息
- ❌ 不收集位置 / 网络历史 / 浏览活动
- ❌ 不收集网站内容？（否 — 仅在你主动点击导出时读取当前页面对话，且不离开设备）
- ❌ 不出售数据 / 不用于无关用途 / 不转移给第三方
- ✅ 隐私政策 URL：https://github.com/laijing1201/markdown-converter/blob/main/docs/guides/extension-privacy.md

## 上传资产清单

| 项目 | 要求 | 状态 |
| --- | --- | --- |
| 安装包 | `artifacts/MarkDoc-Extension-v0.1.0.zip`（manifest.json 在 zip 根目录） | ✅ `npm run package:extension` |
| 商店图标 128×128 | `extension/public/icons/icon128.png` | ✅ |
| 截图 1280×800（至少 1 张） | 建议截取：① ChatGPT 页面 + 导出菜单 ② 生成的 Word 公式效果 ③ PDF 目录页码效果 | ⬜ 需人工截图 |
| 小型宣传图 440×280 | 可用产品名 + 一句话介绍 | ⬜ 需人工制作 |

## 措辞红线

不使用无法证明的营销词：「最好」「第一」「100%」「绝对安全」「零风险」。
以上文案已自查：无此类表述；「排版良好」「完整保留」基于已通过的 DOCX/PDF E2E 校验。
