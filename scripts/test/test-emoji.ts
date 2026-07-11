const emojiRegex = /([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)/gu;

const testStrings = [
  "1. ✂️ PDF 断行智能缝合",
  "2. 🧹 页眉页脚与干扰字符剔除",
  "3. 💬 引用与标注智能识别",
  "4. 🔠 中英文排版与标点规范化",
  "💡 智能排版引擎全能力清单"
];

testStrings.forEach(s => {
  console.log(`Original: ${s}`);
  const parts = s.split(emojiRegex);
  console.log(`Split:`, parts);
});
