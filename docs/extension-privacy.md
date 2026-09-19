# MarkDoc 浏览器扩展 — 隐私说明

> 适用对象：MarkDoc 浏览器扩展（Chrome / Edge，Manifest V3）
> 版本：0.1.0 · 最近更新：2026-09-19

## 一句话结论

MarkDoc 扩展**在你的浏览器本地**完成全部内容提取与文档生成，**默认不上传任何数据**，没有自有服务器。

## 扩展读取什么？

| 数据 | 是否读取 | 说明 |
| --- | --- | --- |
| AI 页面中的对话内容 | ✅ 仅在你主动点击导出时 | 只读取当前标签页中你要求导出的消息（单条回答 / 问答 / 多选 / 整段对话），用于生成 Word / PDF 或填入 MarkDoc 编辑器 |
| 浏览历史 | ❌ 否 | 扩展没有 `history` 权限，也不记录任何浏览行为 |
| Cookie | ❌ 否 | 没有 `cookies` 权限，不读写任何 Cookie |
| 其他标签页内容 | ❌ 否 | 没有 `tabs` 权限；仅在受支持的 AI 平台页面注入内容脚本 |
| 键盘输入 / 表单 | ❌ 否 | 不监听、不采集 |
| 文件 | ❌ 否 | 不读取本地文件 |

## 数据会发送到服务器吗？

**默认不会。** 内容提取（DOM → Markdown）、公式转换（LaTeX → Word OMML）、PDF 排版与字体嵌入，全部在浏览器本地完成。扩展没有任何统计、埋点或遥测。

唯一的网络访问发生在**你自己**的操作下：

- 导出文档中引用的**外链图片**：生成 Word / PDF 时需要下载图片本身（浏览器直接向图片源请求）；
- 「在 MarkDoc 中编辑」：按你的设置打开 MarkDoc 网页版（默认 `markdocshift.netlify.app`）。

## 数据保存在哪里？保存多久？

| 数据 | 位置 | 保留时长 |
| --- | --- | --- |
| 快速设置（默认格式/模板等） | 浏览器本地 `chrome.storage.local` | 永久，直到你卸载扩展或清除 |
| 待导出任务（含导出内容） | 本地 `chrome.storage.local` | 一次性读取，1 小时后自动过期清除 |
| 「在 MarkDoc 中编辑」临时数据 | 本地 `chrome.storage.local` | **30 分钟**自动失效；网页版读取后立即删除；扩展启动时清扫过期数据 |
| 聊天正文的其他任何副本 | ❌ 无 | 扩展不做任何持久化缓存 |

## 权限清单（P4C 最小化审计）

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存快速设置与一次性导出任务（全部本地） |
| `host_permissions: chatgpt.com / chat.openai.com / chat.deepseek.com / claude.ai / gemini.google.com / kimi.com` | 在受支持的 AI 页面注入导出按钮（content script） |
| `host_permissions: markdocshift.netlify.app / localhost:5173` | 「在 MarkDoc 中编辑」桥接（仅传递你主动选择的内容） |

没有 `<all_urls>`、没有 `downloads`（下载通过页面内 `<a download>` 完成）、没有 `scripting` / `activeTab` / `cookies`。

## 诊断信息

扩展提供「复制诊断信息」功能（Popup / 导出失败弹窗），内容**仅包含结构信息**：扩展与核心版本、浏览器与平台标识、hostname、选择器命中层级、消息与公式/表格/代码数量、错误代码、匿名化的错误栈指纹。**绝不包含**聊天正文、公式内容、代码内容或图片内容。诊断信息只在你在 issue 中主动粘贴时才会离开你的设备。

## DOM 改版提醒

当 AI 网站改版导致 MarkDoc 无法识别页面时，扩展会在本地记录「上次识别成功」的结构快照（仅消息条数）用于对比提醒，不会上传。

## 数据删除

- 卸载扩展即删除全部本地数据；
- 或在浏览器扩展详情页「清除扩展数据」。

## 联系

问题反馈：https://github.com/laijing1201/markdown-converter/issues
