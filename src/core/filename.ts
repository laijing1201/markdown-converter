/**
 * 导出文件名 —— Word / PDF 共用的唯一实现。
 *
 * 优先级：文档设置里的「文档标题」→ 文档第一标题 → MarkDoc-YYYY-MM-DD。
 * 过滤 Windows / 通用文件系统的非法字符，超长截断。
 */

const ILLEGAL_CHARS = /[/\\:*?"<>|]/g
const MAX_FILENAME_CHARS = 60

/** 从 Markdown 源码提取第一个 ATX 标题（跳过代码块内的 # 行） */
export function extractFirstHeading(markdown: string): string {
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    if (m) {
      // 去掉强调/代码/链接等行内语法，保留可读文本
      return m[1]
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .trim()
    }
  }
  return ''
}

function sanitize(name: string): string {
  return name
    .replace(ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MAX_FILENAME_CHARS)
    .trim()
}

/**
 * 生成导出文件名（不含扩展名）。
 * @param markdown    当前 Markdown 源码
 * @param documentTitle 设置中的文档标题（可选，优先级最高）
 */
export function buildExportFilename(markdown: string, documentTitle = ''): string {
  const fromTitle = sanitize(documentTitle)
  if (fromTitle) return fromTitle

  const fromHeading = sanitize(extractFirstHeading(markdown))
  if (fromHeading) return fromHeading

  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `MarkDoc-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
