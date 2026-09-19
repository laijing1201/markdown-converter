/**
 * Unit test: LaTeX → MathML (KaTeX) → OMML (mathml2omml) → docx document.xml
 * Verifies every formula family from the acceptance list serializes as m:oMath
 * inside a real .docx package.
 */
import katex from 'katex'
import { mml2omml } from 'mathml2omml'
import { Document, Packer, Paragraph, ImportedXmlComponent } from 'docx'
import JSZip from 'jszip'
import { writeFileSync, mkdirSync } from 'fs'

/**
 * fromXmlString returns a wrapper component with rootKey=undefined (the parsed
 * "document" node); the real element component lives in its .root array.
 * Pushing the wrapper directly serializes a literal <undefined> tag.
 */
function parseXmlComponent(xml) {
  const wrapper = ImportedXmlComponent.fromXmlString(xml)
  const inner = wrapper.root.find((c) => c && typeof c === 'object' && c.rootKey)
  if (!inner) throw new Error('no element component parsed from xml')
  return inner
}

const FORMULAS = [
  ['fraction', '\\frac{1}{2}'],
  ['superscript', 'x^2 + y^2 = z^2'],
  ['subscript', 'w_i x_i + b'],
  ['sqrt', '\\sqrt{\\pi}'],
  ['integral', '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx'],
  ['sum', '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}'],
  ['limit', '\\lim_{x \\to 0} \\frac{\\sin x}{x}'],
  ['greek', '\\alpha^2 + \\beta^2 = \\gamma^2'],
  ['matrix pmatrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
  ['cases', '\\begin{cases} x > 0 \\\\ x \\le 0 \\end{cases}'],
  ['aligned', '\\begin{aligned} f(x) &= x^2 \\\\ g(x) &= x^3 \\end{aligned}'],
  ['inline display frac', '\\frac{d}{dx}\\left( e^x \\right)'],
]

let pass = 0
let fail = 0
const components = []

for (const [name, latex] of FORMULAS) {
  try {
    const mathml = katex.renderToString(latex, {
      output: 'mathml',
      displayMode: true,
      throwOnError: true,
    })
    const m = mathml.match(/<math[\s\S]*?<\/math>/)
    if (!m) throw new Error('no <math> element in KaTeX output')
    const omml = mml2omml(m[0].replace(/<annotation[\s\S]*?<\/annotation>/g, ''))
    if (!omml.includes('oMath')) throw new Error('OMML output missing m:oMath')
    components.push(parseXmlComponent(
      `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${omml}</m:oMathPara>`
    ))
    console.log(`  ✓ ${name}: ${omml.length} chars OMML`)
    pass++
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`)
    fail++
  }
}

// Build a real docx and inspect the serialized XML
const doc = new Document({
  sections: [{
    children: FORMULAS.map(([, latex]) => new Paragraph({ children: [] })).map((p, i) => p),
  }],
})

const doc2 = new Document({
  sections: [{
    children: components.map(c => new Paragraph({ children: [c] })),
  }],
})

const buf = await Packer.toBuffer(doc2)
const zip = await JSZip.loadAsync(buf)
const xml = await zip.file('word/document.xml').async('string')
const omathCount = (xml.match(/<m:oMath[ >]/g) || []).length
const mathNs = xml.includes('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"')

console.log(`\ndocx document.xml: ${omathCount} <m:oMath> elements, math namespace declared: ${mathNs}`)

mkdirSync('scripts/tmp', { recursive: true })
writeFileSync('scripts/tmp/omml-test.docx', buf)
console.log('sample written to scripts/tmp/omml-test.docx')

const okStructure = omathCount >= pass
console.log(`\nRESULT: ${pass}/${FORMULAS.length} formulas converted; docx structure ${okStructure ? 'OK' : 'BROKEN'}`)
process.exit(pass === FORMULAS.length && okStructure ? 0 : 1)
