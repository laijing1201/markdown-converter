/**
 * LaTeX → Word 原生公式（OMML）转换管线
 *
 *   LaTeX → MathML (KaTeX) → OMML (mathml2omml) → docx ImportedXmlComponent
 *
 * 生成的公式在 Word 中是原生可编辑公式（Cambria Math），而不是截图。
 * 任何一步失败返回 null，由调用方降级为图片捕获。
 */

import katex from 'katex'
import { mml2omml } from 'mathml2omml'
import { ImportedXmlComponent } from 'docx'

const cache = new Map<string, ImportedXmlComponent | null>()

/**
 * fromXmlString 返回的是一个 rootKey=undefined 的"文档"包装组件，
 * 真正的元素组件在它的 root 数组里；直接把包装组件塞进 Paragraph
 * 会序列化出非法的 <undefined> 标签。
 */
function extractElementComponent(xml: string): ImportedXmlComponent {
  const wrapper = ImportedXmlComponent.fromXmlString(xml)
  const inner = (wrapper as unknown as { root: unknown[] }).root.find(
    (c) => c && typeof c === 'object' && 'rootKey' in (c as object) && (c as { rootKey?: string }).rootKey,
  )
  if (!inner) throw new Error('empty component parsed from xml')
  return inner as ImportedXmlComponent
}

/**
 * 将 LaTeX 公式转换为 OMML 公式组件（同步、带缓存）。
 *
 * @param latex 公式源码（不含 $ 定界符）
 * @param displayMode 是否为块级公式（$$...$$）
 */
export function latexToOmml(latex: string, displayMode: boolean): ImportedXmlComponent | null {
  const key = `${displayMode ? 'B' : 'I'}\u0000${latex}`
  if (cache.has(key)) return cache.get(key)!

  let result: ImportedXmlComponent | null = null
  try {
    const rendered = katex.renderToString(latex, {
      output: 'mathml',
      displayMode,
      throwOnError: true,
      strict: false,
    })
    const mathMatch = rendered.match(/<math[\s\S]*?<\/math>/)
    if (mathMatch) {
      // annotation 节点里是 LaTeX 源码，转换器不支持，先剥掉
      const mathml = mathMatch[0].replace(/<annotation[\s\S]*?<\/annotation>/g, '')
      const omml = mml2omml(mathml)
      if (omml.includes('<m:oMath')) {
        const xml = displayMode
          ? `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${omml}</m:oMathPara>`
          : omml
        result = extractElementComponent(xml)
      }
    }
  } catch {
    result = null
  }

  cache.set(key, result)
  return result
}
