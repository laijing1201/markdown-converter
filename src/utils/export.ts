import { saveAs } from 'file-saver'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  ImageRun,
  AlignmentType,
  ExternalHyperlink
} from 'docx'

// ─── PDF Export ───────────────────────────────────────────────────────────────

export async function exportToPdf(
  element: HTMLElement,
  filename: string,
): Promise<void> {
  // Check if running in Electron
  const isElectron = navigator.userAgent.toLowerCase().includes('electron')
  if (isElectron) {
    try {
      // @ts-ignore
      const { ipcRenderer } = window.require('electron')
      const success = await ipcRenderer.invoke('export-pdf', filename)
      if (success) {
        // Successfully saved via native dialog
        return
      }
    } catch (e) {
      console.warn('Electron PDF export failed, falling back to window.print', e)
    }
  }

  // Fallback to native browser print
  // The @media print in index.css will hide everything except the preview container.
  
  // Temporarily change document title so the default save filename is correct
  const originalTitle = document.title
  document.title = filename
  
  window.print()
  
  // Restore title
  setTimeout(() => {
    document.title = originalTitle
  }, 100)
}

// ─── DOCX Export ─────────────────────────────────────────────────────────────

export async function exportToDocx(innerHtml: string, filename: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(
    `<div id="root">${innerHtml}</div>`,
    'text/html',
  )
  const root = doc.getElementById('root')!

  // 1. Capture Mermaid and KaTeX elements as base64 PNG images
  const tasks: Promise<void>[] = []

  root.querySelectorAll<HTMLElement>('.mermaid-rendered, .math-block, .math-inline').forEach((el) => {
    if (el.querySelector('img[data-captured="true"]')) return
    if (el.closest('[data-capturing="true"]')) return

    el.setAttribute('data-capturing', 'true')

    const task = (async () => {
      try {
        const previewContainer = document.getElementById('preview-container')
        if (!previewContainer) return

        const liveEl = findLiveElement(previewContainer, el)
        if (!liveEl) return

        const html2canvas = (await import('html2canvas')).default
        const canvas = await html2canvas(liveEl, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        })
        const dataUrl = canvas.toDataURL('image/png')
        
        // Calculate display dimensions
        const rect = liveEl.getBoundingClientRect()
        const width = rect.width
        const height = rect.height

        const img = doc.createElement('img')
        img.src = dataUrl
        img.style.width = width + 'px'
        img.style.height = height + 'px'
        img.setAttribute('data-captured', 'true')
        el.parentNode?.replaceChild(img, el)
      } catch {
        el.removeAttribute('data-capturing')
      }
    })()
    tasks.push(task)
  })

  await Promise.allSettled(tasks)

  // 2. Convert DOM to docx elements
  const children = parseBlockNodes(root)

  const docxDoc = new Document({
    styles: {
      default: {
        document: {
          run: {
            size: 24, // 12pt
            font: 'SimSun',
            color: '333333',
          },
          paragraph: {
            spacing: { line: 360, before: 120, after: 120 },
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            size: 36, // 18pt
            bold: true,
            font: 'Microsoft YaHei',
            color: '1E40AF', // Deep blue
          },
          paragraph: {
            spacing: { before: 480, after: 240 }
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            size: 32, // 16pt
            bold: true,
            font: 'Microsoft YaHei',
            color: '1E40AF',
          },
          paragraph: {
            spacing: { before: 400, after: 200 },
          },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            size: 28, // 14pt
            bold: true,
            font: 'Microsoft YaHei',
            color: '374151',
          },
          paragraph: {
            spacing: { before: 300, after: 150 },
          },
        },
        {
          id: 'Heading4',
          name: 'Heading 4',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            size: 24, // 12pt
            bold: true,
            font: 'Microsoft YaHei',
            color: '4B5563',
          },
          paragraph: {
            spacing: { before: 240, after: 120 },
          },
        },
        {
          id: 'ListParagraph',
          name: 'List Paragraph',
          basedOn: 'Normal',
          quickFormat: true,
          paragraph: {
            spacing: { before: 100, after: 100 },
          },
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: children,
      },
    ],
  })

  // 3. Save as native .docx
  const blob = await Packer.toBlob(docxDoc)
  saveAs(blob, `${filename}.docx`)
}

// --- DOM to DOCX Helpers ---

function findLiveElement(
  liveContainer: HTMLElement,
  target: Element,
): HTMLElement | null {
  const targetClasses = Array.from(target.classList).sort()
  const candidates = liveContainer.querySelectorAll<HTMLElement>(
    targetClasses.map((c) => `.${CSS.escape(c)}`).join(''),
  )
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    const prevHeading = findPrecedingHeading(target)
    if (prevHeading) {
      for (const c of candidates) {
        const ch = findPrecedingHeading(c)
        if (ch && ch.textContent === prevHeading.textContent) return c
      }
    }
  }
  return candidates[0] || null
}

function findPrecedingHeading(el: Element): Element | null {
  let current = el.previousElementSibling
  while (current) {
    if (/^h[1-6]$/i.test(current.tagName)) return current
    current = current.previousElementSibling
  }
  if (el.parentElement && el.parentElement !== el.closest('body')) {
    let sibling = el.parentElement.previousElementSibling
    while (sibling) {
      if (/^h[1-6]$/i.test(sibling.tagName)) return sibling
      sibling = sibling.previousElementSibling
    }
    return findPrecedingHeading(el.parentElement)
  }
  return null
}

// Parse block-level elements (paragraphs, tables, lists, etc.)
function parseBlockNodes(container: HTMLElement): any[] {
  let blocks: any[] = []
  
  Array.from(container.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) {
        blocks.push(new Paragraph({ children: [new TextRun(text)] }))
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const tagName = el.tagName.toLowerCase()

      if (/^h[1-6]$/.test(tagName)) {
        const level = parseInt(tagName[1])
        blocks.push(new Paragraph({
          children: parseInlineNodes(el),
          heading: [
            HeadingLevel.HEADING_1,
            HeadingLevel.HEADING_2,
            HeadingLevel.HEADING_3,
            HeadingLevel.HEADING_4,
            HeadingLevel.HEADING_5,
            HeadingLevel.HEADING_6
          ][level - 1],
          spacing: { before: 240, after: 120 }
        }))
      } else if (tagName === 'p') {
        blocks.push(new Paragraph({
          children: parseInlineNodes(el),
          spacing: { after: 120 }
        }))
      } else if (tagName === 'ul' || tagName === 'ol') {
        const listBlocks = parseListNodes(el, 0)
        blocks.push(...listBlocks)
      } else if (tagName === 'blockquote') {
        blocks.push(new Paragraph({
          children: parseInlineNodes(el, { color: '6B7280', italics: true }),
          spacing: { before: 200, after: 200 },
          indent: { left: 480 }, // Indent
          border: {
            left: { style: BorderStyle.SINGLE, size: 24, color: 'D1D5DB', space: 10 }
          }
        }))
      } else if (tagName === 'pre') {
        const codeText = el.textContent || ''
        blocks.push(new Paragraph({
          children: [new TextRun({ text: codeText, font: "Consolas", size: 20, color: '24292F' })],
          spacing: { before: 160, after: 160 },
          shading: { type: "clear", fill: "F6F8FA" },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 8 },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 8 },
            left: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 8 },
            right: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 8 }
          }
        }))
      } else if (tagName === 'table') {
        blocks.push(parseTableNode(el))
        blocks.push(new Paragraph({ text: "" })) // spacing after table
      } else if (tagName === 'hr') {
        blocks.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "e5e7eb" } }
        }))
      } else if (tagName === 'div' && el.classList.contains('math-block')) {
        // usually already replaced by img if successfully captured
        const img = el.querySelector('img')
        if (img) {
          blocks.push(new Paragraph({
            children: parseInlineNodes(el),
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 }
          }))
        } else {
          blocks.push(new Paragraph({
            children: parseInlineNodes(el),
            alignment: AlignmentType.CENTER
          }))
        }
      } else if (tagName === 'div' && el.classList.contains('mermaid-rendered')) {
        blocks.push(new Paragraph({
          children: parseInlineNodes(el),
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 }
        }))
      } else {
        // Fallback: parse children as block nodes
        blocks.push(...parseBlockNodes(el))
      }
    }
  })

  return blocks
}

function parseListNodes(listEl: HTMLElement, level: number): Paragraph[] {
  let blocks: Paragraph[] = []
  Array.from(listEl.children).forEach(li => {
    if (li.tagName.toLowerCase() === 'li') {
      // Very basic list support
      blocks.push(new Paragraph({
        children: parseInlineNodes(li as HTMLElement),
        style: 'ListParagraph',
        bullet: { level },
      }))
    }
  })
  return blocks
}

// Parse inline elements (bold, italic, images, text, links)
function parseInlineNodes(container: HTMLElement, currentStyle: any = {}): any[] {
  let runs: any[] = []

  Array.from(container.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent
      if (text) {
        const emojiRegex = /([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)/gu
        if (emojiRegex.test(text)) {
          emojiRegex.lastIndex = 0
          const parts = text.split(emojiRegex)
          parts.forEach(part => {
            if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?$/u.test(part)) {
              runs.push(new TextRun({
                text: part,
                bold: currentStyle.bold,
                italics: currentStyle.italics,
                strike: currentStyle.strike,
                font: 'Segoe UI Emoji'
              }))
            } else if (part) {
              runs.push(new TextRun({
                text: part,
                bold: currentStyle.bold,
                italics: currentStyle.italics,
                strike: currentStyle.strike,
                font: currentStyle.font
              }))
            }
          })
        } else {
          runs.push(new TextRun({
            text: text,
            bold: currentStyle.bold,
            italics: currentStyle.italics,
            strike: currentStyle.strike,
            font: currentStyle.font
          }))
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const tagName = el.tagName.toLowerCase()

      if (tagName === 'strong' || tagName === 'b') {
        runs.push(...parseInlineNodes(el, { ...currentStyle, bold: true }))
      } else if (tagName === 'em' || tagName === 'i') {
        runs.push(...parseInlineNodes(el, { ...currentStyle, italics: true }))
      } else if (tagName === 'del' || tagName === 's') {
        runs.push(...parseInlineNodes(el, { ...currentStyle, strike: true }))
      } else if (tagName === 'code') {
        // Inline code styling
        runs.push(...parseInlineNodes(el, { ...currentStyle, font: "Consolas", color: "D92D20", size: 21 }))
      } else if (tagName === 'a') {
        const href = el.getAttribute('href') || ''
        // docx external hyperlink
        runs.push(new ExternalHyperlink({
          children: parseInlineNodes(el, { ...currentStyle, color: "2563eb" }),
          link: href
        }))
      } else if (tagName === 'img') {
        const src = el.getAttribute('src')
        if (src && src.startsWith('data:image')) {
          const base64Data = src.split(',')[1]
          let width = 400
          let height = 300
          
          if (el.style.width) width = parseFloat(el.style.width)
          if (el.style.height) height = parseFloat(el.style.height)
          
          // Basic bounds check
          if (width > 600) {
            height = height * (600 / width)
            width = 600
          }

          runs.push(new ImageRun({
            data: Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)),
            transformation: { width, height }
          }))
        } else {
          // If it's not base64 (e.g. external image), we just output its alt text because docx imageRun requires binary data
          const alt = el.getAttribute('alt') || 'image'
          runs.push(new TextRun({ text: `[Image: ${alt}]`, italics: true }))
        }
      } else if (tagName === 'br') {
        runs.push(new TextRun({ text: "", break: 1 }))
      } else {
        // Traverse deeper
        runs.push(...parseInlineNodes(el, currentStyle))
      }
    }
  })

  return runs
}

// Generate Three-line Table
function parseTableNode(tableEl: HTMLElement): Table {
  const rows: TableRow[] = []
  
  // No inner borders, only thick top/bottom and thin header-bottom
  const threeLineBorders = {
    top: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
    bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
    left: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
    right: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'ffffff' }
  }

  const thead = tableEl.querySelector('thead')
  if (thead) {
    Array.from(thead.querySelectorAll('tr')).forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('th, td')).map(td => {
        return new TableCell({
          children: [new Paragraph({ children: parseInlineNodes(td as HTMLElement), alignment: AlignmentType.CENTER })],
          borders: {
            top: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
            left: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
            right: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
          }
        })
      })
      rows.push(new TableRow({ children: cells, tableHeader: true }))
    })
  }

  const tbody = tableEl.querySelector('tbody')
  if (tbody) {
    const trs = Array.from(tbody.querySelectorAll('tr'))
    trs.forEach((tr, index) => {
      const isLast = index === trs.length - 1
      const cells = Array.from(tr.querySelectorAll('th, td')).map(td => {
        const borders: any = {
          left: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
          right: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
          top: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
          bottom: { style: BorderStyle.NONE, size: 0, color: 'ffffff' },
        }
        if (isLast) {
          borders.bottom = { style: BorderStyle.SINGLE, size: 12, color: '000000' }
        }
        return new TableCell({
          children: [new Paragraph({ children: parseInlineNodes(td as HTMLElement) })],
          borders
        })
      })
      rows.push(new TableRow({ children: cells }))
    })
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: threeLineBorders
  })
}
