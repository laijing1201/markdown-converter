# DOM Fixture 版本体系（P4C 第五节）

## 目录结构

```
tests/fixtures/
  chatgpt/     ChatGPT（chatgpt.com / chat.openai.com）真实 DOM 结构快照
  deepseek/    DeepSeek（chat.deepseek.com）
```

## 命名规范

`v<版本号>-<场景>.html`

- `v1-basic.html` — 最小问答（1 用户 + 1 AI）
- `v1-math.html` — KaTeX/MathJax 公式（行内/块级/矩阵/分段）
- `v1-table.html` — GFM 表格
- `v1-code.html` — 代码块（含复制按钮等 UI 干扰）
- `v1-images.html` — 图片（data URI / 外链 / 加载失败）
- `v1-mixed.html` — 综合（标题/列表/引用/公式/表格/代码/Mermaid）
- `v1-conversation.html` — 多轮对话顺序
- `v1-fallback.html` — 主选择器失效（fallback 链测试）
- `v1-degraded.html` — 降级路径（缺 annotation / 未知节点 / 思考过程）
- `v1-streaming.html` — 流式生成中（停止按钮存在、内容不完整）
- `v1-empty.html` — 空消息容错

## 改版流程（重要）

AI 网站 DOM 改版时：

1. **不要修改旧的 `v1-*.html`** —— 它们是 v1 selector 兼容性的回归基线；
2. 新增 `v2-*.html` 快照反映新结构；
3. 在 adapter 中扩展 selector（primary 保持对 v1 命中，新增 v2 命中路径），
   或升级为 `chatgpt@2` adapter 版本并让 v2 fixture 成为 primary 断言；
4. 运行 `npm run test:adapter` + `npm run test:adapter:contract`：
   v1 全部断言必须继续通过（保证没有把旧兼容性弄坏），v2 断言按新版本通过。

Fixture 一律为人工构造的合成数据（无任何真实聊天内容）。
