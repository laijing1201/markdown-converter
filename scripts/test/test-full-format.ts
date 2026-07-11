import { smartFormatText } from './src/utils/smartFormat.ts'

const sampleText = `
第1章 介绍
这本来是一段完整的文字，但是因为PDF的问题
被强行截断了
而且还没有标点符号，你看这句

这里是正常的，结束了。
下一句开始了，这也是正常的。

- 12 -

摘要：这是一个关于AI排版引擎的介绍。

1. 特性A
这是一个很长的列表项，超过了四十个字符，所以不能是标题，而是应该自动加粗前缀。
2. 特性B
也是一样，很长的特性。

• 这是无序列表1
· 这是无序列表2
Ø 这是无序列表3

{
  "name": "shift-ai",
  "version": "1.0.0"
}

import os
def test():
    print("hello")

测试一下中英文混排的排版,比如apple和banana.

https://github.com/google/gemini

[1] 张三, "AI 发展史", 2024.
[2] 李四, "智能排版", 2025.
`

console.log(smartFormatText(sampleText))
