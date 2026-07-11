import { smartFormatText } from './src/utils/smartFormat.ts'

const sampleText = `
第一章 引言
1.1 背景
这个是一个很长很长很长的段落。这里面包含了很多的内容，不信你可以看看，字数一定超过40个字符了。而且里面有标点符号！

1. 项目介绍
2. 这是一个很长的列表项，因为它的长度很长，所以它不应该变成标题，而是应该自动识别为一个普通的列表，只不过前面的数字会被加粗而已。
3. 结论

这是表格数据
名称    年龄    性别
张三    25    男
李四    28    女

1. 这是一个短小精悍的标题
`

console.log(smartFormatText(sampleText))
