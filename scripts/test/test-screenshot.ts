import { smartFormatText } from './src/utils/smartFormat.ts'
import { validateMarkdown } from './src/utils/validation.ts'

const sampleText = `
一步”。当您把一份杂乱无章的纯文本(尤其可能是从 PDF、网页、微信里复制来的)丢进来时，文档里需要处理的细节远远不止标题和表格。

为了打造一个真正完美的全能型智能排版引擎，我全面梳理了纯文本排版中所有可能遇到的痛点，并为您拟定了这份终极升级计划：

💡 智能排版引擎全能力清单 (待您审核) 除了已经做好的 [多级标题智能推断] 和 [空格/Tab 表格组装] 之外，我还计划为您加入以下核心智能能力：

1. ✂️ PDF 断行智能缝合 (Smart Paragraph Joining)
痛点：从 PDF 复制文字时，一句话常常被硬生生从中间切断，每一行结尾都有莫名其妙的回车。智能处理：算法将自动分析上下行的标点符号和语义连贯性，自动拼接被错误切断的段落，彻底免去您手动按 Backspace 删除回车的痛苦。

2. 🧹 页眉页脚与干扰字符剔除 (Noise Removal)
痛点：复制时经常会把原文档的页码(如 - 12 -、Page 3 of 10)或重复的页眉复制进来，混在正文里。智能处理：利用正则引擎自动扫描并剔除这些孤立的页码和页眉干扰项，保证正文纯净。

3. 💬 引用与标注智能识别 (Blockquote Inference)
痛点：文本中的“注意：”、“Note:”、“摘要：”等特殊段落没有凸显。智能处理：自动识别这些提示性前缀，将其转换为 Markdown 的引用块 (\`> \`)，导出 Word 时会自动带有侧边框和背景色，极其美观。

4. 🔠 中英文排版与标点规范化 (Typography Polish)
痛点：中英文之间缺少空格挤在一起；中文段落里混用了英文逗号(,)和句号(.)。
`

console.log("FORMATTED TEXT:\n")
const formatted = smartFormatText(sampleText)
console.log(formatted)

console.log("\nVALIDATION WARNINGS:\n")
console.log(validateMarkdown(formatted))
