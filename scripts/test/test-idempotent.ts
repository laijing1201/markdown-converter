import { smartFormatText } from './src/utils/smartFormat.ts'

const sampleText = `
**1.** ✂️ PDF 断行智能缝合 (Smart Paragraph Joining)
痛点：从 PDF 复制文字时，一句话常常被硬生生从中间切断，每一行结尾都有莫名其妙的回车。智能处理：算法将自动分析上下行的标点符号和语义连贯性，自动拼接被错误切断的段落，彻底免去您手动按 Backspace 删除回车的痛苦。

## 2. 🧹 页眉页脚与干扰字符剔除 (Noise Removal)
痛点：复制时经常会把原文档的页码(如 - 12 -、Page 3 of 10)或重复的页眉复制进来，混在正文里。智能处理：利用正则引擎自动扫描并剔除这些孤立的页码和页眉干扰项，保证正文纯净。
`

console.log(smartFormatText(sampleText))
