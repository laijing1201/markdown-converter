/**
 * PDF FontResolver —— 中文字体安全网。
 *
 * 职责：
 *   1. 字体映射：用户选择的字体（SimSun/微软雅黑/Consolas…）→ 项目内可嵌入的
 *      开源字体（思源宋体/黑体 = Noto Serif/Sans SC、JetBrains Mono、KaTeX 字体），
 *      映射发生替代时收集用户可见提示，绝不静默产生方块字。
 *   2. 字体加载：fetch（Electron file:// 下降级为 XHR）+ 内存缓存。
 *   3. 布局注册：把嵌入字体注册为 FontFace（family = MarkDoc Serif/Sans/Mono），
 *      让导出克隆 DOM 的测量与 PDF 绘制使用同一套字体度量。
 *   4. 子集化：按实际用到的字符用 harfbuzz（hb-subset.wasm）裁剪 TTF，
 *      再交给 pdf-lib 嵌入 —— 单份 PDF 通常只增加几十 KB，而不是整只 10MB 字体。
 */

/** 嵌入字体注册表：key → 文件与 FontFace family */
export interface FontDef {
  file: string
  family: string
  weight: number
  style: 'normal' | 'italic'
}

export const MAIN_FONT_FILES: Record<string, FontDef> = {
  serif: { file: 'NotoSerifSC-Regular.ttf', family: 'MarkDoc Serif', weight: 400, style: 'normal' },
  'serif-bold': { file: 'NotoSerifSC-Bold.ttf', family: 'MarkDoc Serif', weight: 700, style: 'normal' },
  sans: { file: 'NotoSansSC-Regular.ttf', family: 'MarkDoc Sans', weight: 400, style: 'normal' },
  'sans-bold': { file: 'NotoSansSC-Bold.ttf', family: 'MarkDoc Sans', weight: 700, style: 'normal' },
  mono: { file: 'JetBrainsMono-Regular.ttf', family: 'MarkDoc Mono', weight: 400, style: 'normal' },
  'mono-bold': { file: 'JetBrainsMono-Bold.ttf', family: 'MarkDoc Mono', weight: 700, style: 'normal' },
}

export const KATEX_FONT_FILES: Record<string, FontDef> = {
  'katex:Main': { file: 'katex/KaTeX_Main-Regular.ttf', family: 'KaTeX_Main', weight: 400, style: 'normal' },
  'katex:Main-Bold': { file: 'katex/KaTeX_Main-Bold.ttf', family: 'KaTeX_Main', weight: 700, style: 'normal' },
  'katex:Main-Italic': { file: 'katex/KaTeX_Main-Italic.ttf', family: 'KaTeX_Main', weight: 400, style: 'italic' },
  'katex:Main-BoldItalic': { file: 'katex/KaTeX_Main-BoldItalic.ttf', family: 'KaTeX_Main', weight: 700, style: 'italic' },
  'katex:Math-Italic': { file: 'katex/KaTeX_Math-Italic.ttf', family: 'KaTeX_Math', weight: 400, style: 'italic' },
  'katex:Math-BoldItalic': { file: 'katex/KaTeX_Math-BoldItalic.ttf', family: 'KaTeX_Math', weight: 700, style: 'italic' },
  'katex:Size1': { file: 'katex/KaTeX_Size1-Regular.ttf', family: 'KaTeX_Size1', weight: 400, style: 'normal' },
  'katex:Size2': { file: 'katex/KaTeX_Size2-Regular.ttf', family: 'KaTeX_Size2', weight: 400, style: 'normal' },
  'katex:Size3': { file: 'katex/KaTeX_Size3-Regular.ttf', family: 'KaTeX_Size3', weight: 400, style: 'normal' },
  'katex:Size4': { file: 'katex/KaTeX_Size4-Regular.ttf', family: 'KaTeX_Size4', weight: 400, style: 'normal' },
  'katex:AMS': { file: 'katex/KaTeX_AMS-Regular.ttf', family: 'KaTeX_AMS', weight: 400, style: 'normal' },
  'katex:Sans': { file: 'katex/KaTeX_SansSerif-Regular.ttf', family: 'KaTeX_SansSerif', weight: 400, style: 'normal' },
  'katex:Sans-Bold': { file: 'katex/KaTeX_SansSerif-Bold.ttf', family: 'KaTeX_SansSerif', weight: 700, style: 'normal' },
  'katex:Caligraphic': { file: 'katex/KaTeX_Caligraphic-Regular.ttf', family: 'KaTeX_Caligraphic', weight: 400, style: 'normal' },
  'katex:Caligraphic-Bold': { file: 'katex/KaTeX_Caligraphic-Bold.ttf', family: 'KaTeX_Caligraphic', weight: 700, style: 'normal' },
  'katex:Script': { file: 'katex/KaTeX_Script-Regular.ttf', family: 'KaTeX_Script', weight: 400, style: 'normal' },
  'katex:Fraktur': { file: 'katex/KaTeX_Fraktur-Regular.ttf', family: 'KaTeX_Fraktur', weight: 400, style: 'normal' },
  'katex:Typewriter': { file: 'katex/KaTeX_Typewriter-Regular.ttf', family: 'KaTeX_Typewriter', weight: 400, style: 'normal' },
}

export const ALL_FONT_FILES: Record<string, FontDef> = { ...MAIN_FONT_FILES, ...KATEX_FONT_FILES }

/** 用户字体名 → 内嵌字体族的映射（命中即替代，且记录提示） */
const SERIF_FAMILIES = [
  'simsun', 'nsimsun', '宋体', 'songti', 'stsong', 'fangsong', '仿宋', 'kaiti', '楷体',
  'kaiti sc', 'stkaiti', 'noto serif', 'songti sc', 'georgia', 'cambria', 'serif', 'kai', 'song',
]
const SANS_FAMILIES = [
  'simhei', '黑体', 'heiti', 'stheiti', 'heiti sc', 'microsoft yahei', '微软雅黑', 'yahei',
  'dengxian', '等线', 'pingfang', 'arial', 'calibri', 'helvetica', 'sans-serif', 'system-ui', 'ui-sans-serif',
]
const MONO_FAMILIES = [
  'consolas', 'jetbrains mono', 'sfmono', 'sf mono', 'menlo', 'monaco', 'courier', 'monospace',
  'source code', 'fira code', 'roboto mono', 'cascadia',
]

const CJK_RE = /[\u1100-\u11FF\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F]/
export const hasCJK = (text: string): boolean => CJK_RE.test(text)

/** KaTeX_* 字体族 → fontKey 前缀（bold/italic 由运行时拼接）；键为小写 */
const KATEX_FAMILY_MAP: Record<string, string> = {
  katex_main: 'Main',
  katex_math: 'Math',
  katex_size1: 'Size1',
  katex_size2: 'Size2',
  katex_size3: 'Size3',
  katex_size4: 'Size4',
  katex_ams: 'AMS',
  katex_sansserif: 'Sans',
  katex_caligraphic: 'Caligraphic',
  katex_script: 'Script',
  katex_fraktur: 'Fraktur',
  katex_typewriter: 'Typewriter',
}

/** 已收集的用户提示（字体替代说明），导出结束时随 toast 展示 */
const notices: string[] = []
function pushNotice(msg: string) {
  if (!notices.includes(msg)) notices.push(msg)
}
export function takeFontNotices(): string[] {
  const out = [...notices]
  notices.length = 0
  return out
}
export function peekFontNotices(): string[] {
  return [...notices]
}

export interface ResolvedFont {
  fontKey: string
  /** 拉丁斜体：用标准 14 字体的 Times/Helvetica Italic（Noto 无意体） */
  stdItalic: 'times' | 'helvetica' | null
}

/**
 * 把 CSS font-family 声明解析为内嵌 fontKey。
 * @param cssFamily computed font-family（含回退列表）
 * @param bold      簇是否加粗
 * @param italic    簇是否斜体（KaTeX 有真斜体；正文中拉丁斜体用标准字体）
 */
export function resolveFontFamily(cssFamily: string, bold: boolean, italic = false): ResolvedFont {
  const rawParts = cssFamily.split(',').map((s) => s.replace(/["']/g, '').trim())
  const parts = rawParts.map((s) => s.toLowerCase())
  let kind: 'serif' | 'sans' | 'mono' | null = null
  let katexBase: string | null = null
  let mentionedUserFont = ''

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (KATEX_FAMILY_MAP[p] !== undefined) {
      katexBase = KATEX_FAMILY_MAP[p]
      break
    }
    if (SERIF_FAMILIES.some((f) => p.startsWith(f))) {
      if (!kind) kind = 'serif'
      if (!mentionedUserFont) mentionedUserFont = rawParts[i]
      continue
    }
    if (SANS_FAMILIES.some((f) => p.startsWith(f))) {
      if (!kind) kind = 'sans'
      if (!mentionedUserFont) mentionedUserFont = rawParts[i]
      continue
    }
    if (MONO_FAMILIES.some((f) => p.startsWith(f))) {
      kind = 'mono'
      if (!mentionedUserFont) mentionedUserFont = rawParts[i]
      break
    }
    // MarkDoc 自己的 FontFace（导出克隆 DOM 已注册）
    if (p === 'markdoc serif') { kind = 'serif'; break }
    if (p === 'markdoc sans') { kind = 'sans'; break }
    if (p === 'markdoc mono') { kind = 'mono'; break }
  }

  if (katexBase) {
    if (katexBase === 'Math') {
      // 数学字母恒为斜体
      const key = bold ? 'katex:Math-BoldItalic' : 'katex:Math-Italic'
      if (ALL_FONT_FILES[key]) return { fontKey: key, stdItalic: null }
      return { fontKey: 'katex:Math-Italic', stdItalic: null }
    }
    if (katexBase === 'Main') {
      if (bold && italic) return { fontKey: 'katex:Main-BoldItalic', stdItalic: null }
      if (italic) return { fontKey: 'katex:Main-Italic', stdItalic: null }
      if (bold) return { fontKey: 'katex:Main-Bold', stdItalic: null }
      return { fontKey: 'katex:Main', stdItalic: null }
    }
    const boldKey = `katex:${katexBase}-Bold`
    const key = bold && ALL_FONT_FILES[boldKey] ? boldKey : `katex:${katexBase}`
    return { fontKey: ALL_FONT_FILES[key] ? key : 'katex:Main', stdItalic: null }
  }

  if (!kind) kind = 'sans' // 未知字体兜底：黑体系最不容易缺字

  if (kind === 'mono') return { fontKey: bold ? 'mono-bold' : 'mono', stdItalic: null }

  if (kind === 'serif') {
    noticeOnce(mentionedUserFont, 'serif')
    return { fontKey: bold ? 'serif-bold' : 'serif', stdItalic: 'times' }
  }
  noticeOnce(mentionedUserFont, 'sans')
  return { fontKey: bold ? 'sans-bold' : 'sans', stdItalic: 'helvetica' }
}

const noticedFamilies = new Set<string>()
function noticeOnce(family: string, kind: 'serif' | 'sans') {
  if (!family || noticedFamilies.has(family)) return
  noticedFamilies.add(family)
  const target = kind === 'serif' ? '思源宋体（Noto Serif SC）' : '思源黑体（Noto Sans SC）'
  pushNotice(`字体「${family}」在 PDF 中以内嵌的${target}替代显示，保证任何设备打开都不缺字`)
}

// ── 加载与注册 ───────────────────────────────────────────────────────────────

const bytesCache = new Map<string, Uint8Array>()
const inflight = new Map<string, Promise<Uint8Array>>()
const faceRegistered = new Set<string>()

function fontBaseUrl(): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  return `${base}fonts/`.replace('//fonts/', '/fonts/')
}

const isNodeEnv = (): boolean =>
  typeof process !== 'undefined' && !!(process as { versions?: { node?: string } }).versions?.node

async function nodeReadFont(def: FontDef): Promise<Uint8Array> {
  const { readFileSync } = await import('fs')
  const { resolve } = await import('path')
  // 测试运行目录 = 项目根；构建产物中 fontBaseUrl 已含前缀。
  // 返回 Buffer（Uint8Array 子类）：subset-font/fontverter 在 Node 下需要 Buffer 方法。
  const file = def.file.startsWith('katex/') ? `node_modules/katex/dist/fonts/${def.file.slice(6)}` : `public/fonts/${def.file}`
  return readFileSync(resolve(process.cwd(), file))
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    // Electron file:// 协议下 fetch 不可用，退回 XHR
    const fileProto = typeof location !== 'undefined' && (location.protocol === 'file:' || url.startsWith('file:'))
    if (fileProto) {
      return await new Promise<Uint8Array>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url, true)
        xhr.responseType = 'arraybuffer'
        xhr.onload = () => resolve(new Uint8Array(xhr.response as ArrayBuffer))
        xhr.onerror = () => reject(err)
        xhr.send()
      })
    }
    throw err
  }
}

/**
 * 字体字节的 Cache API 缓存（cache-first）：
 * 中文字体单只 10MB+，跨会话缓存避免每次导出重新下载。
 * 任何失败（file:// / 无 caches API / 配额不足）都回退普通 fetch，
 * 不影响字体嵌入本身。
 */
const FONT_CACHE_NAME = 'markdoc-fonts-v1'

async function fetchBytesCached(url: string): Promise<Uint8Array> {
  const cacheable = typeof caches !== 'undefined' && /^https?:/.test(url)
  if (!cacheable) return fetchBytes(url)
  try {
    const cache = await caches.open(FONT_CACHE_NAME)
    const hit = await cache.match(url)
    if (hit) return new Uint8Array(await hit.arrayBuffer())
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await cache.put(url, res.clone())
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return fetchBytes(url)
  }
}

/**
 * 浏览器扩展构建（__EXT_COMPRESSED_FONTS__）：
 *   扩展包内字体为 WOFF v1（构建期由 scripts/build-extension.mjs 逐表压缩，
 *   体积约为 TTF 的 60%），加载后用浏览器原生 DecompressionStream 解回 TTF
 *   再交给 harfbuzz 子集化与 FontFace。
 *   网页版 / Electron 不定义该开关，行为不变（直接 fetch TTF）。
 *   不用 WOFF2：其 wasm 运行时依赖 eval/new Function，与 MV3 CSP 冲突。
 */
declare const __EXT_COMPRESSED_FONTS__: boolean | undefined

const EXT_COMPRESSED_FONTS: boolean =
  typeof __EXT_COMPRESSED_FONTS__ !== 'undefined' && __EXT_COMPRESSED_FONTS__ === true

async function fetchFontBytes(def: FontDef): Promise<Uint8Array> {
  const base = fontBaseUrl()
  if (EXT_COMPRESSED_FONTS && !isNodeEnv() && def.file.endsWith('.ttf')) {
    const woffUrl = `${base}${def.file.replace(/\.ttf$/, '.woff')}`
    try {
      const woff = await fetchBytesCached(woffUrl)
      const { decodeWoff } = await import('../../../extension/src/lib/woff.js')
      return await decodeWoff(woff)
    } catch {
      // 包内缺 .woff（开发目录 / 旧包）→ 回退 TTF
      return fetchBytesCached(`${base}${def.file}`)
    }
  }
  return fetchBytesCached(`${base}${def.file}`)
}

/** 获取字体文件字节（带内存缓存与并发去重） */
export function loadFontBytes(key: string): Promise<Uint8Array> {
  const cached = bytesCache.get(key)
  if (cached) return Promise.resolve(cached)
  const running = inflight.get(key)
  if (running) return running
  const def = ALL_FONT_FILES[key]
  if (!def) return Promise.reject(new Error(`unknown font key: ${key}`))
  const task = (isNodeEnv() ? nodeReadFont(def) : fetchFontBytes(def)).then((bytes) => {
    bytesCache.set(key, bytes)
    inflight.delete(key)
    return bytes
  })
  inflight.set(key, task)
  return task
}

/** 把主字体注册为 FontFace，供导出布局容器使用（与 PDF 嵌入同一份度量） */
export async function ensureFontFace(key: string): Promise<void> {
  const def = ALL_FONT_FILES[key]
  if (!def || faceRegistered.has(key)) return
  const bytes = await loadFontBytes(key)
  if (typeof FontFace === 'undefined') return
  const face = new FontFace(def.family, bytes.buffer.slice(0) as ArrayBuffer, {
    weight: String(def.weight),
    style: def.style,
  })
  await face.load()
  document.fonts.add(face)
  faceRegistered.add(key)
}

/** 布局前批量注册主字体（正文/标题/等宽 × 常规/加粗） */
export async function ensureMainFontFaces(): Promise<void> {
  await Promise.allSettled(Object.keys(MAIN_FONT_FILES).map((k) => ensureFontFace(k)))
}

// ── 子集化（harfbuzz wasm）───────────────────────────────────────────────────

/**
 * harfbuzz hb-subset.wasm 直接调用，浏览器与 Node 通用。
 * （pdf-lib 自带 subsetting 对 CJK 有丢字问题，故用 harfbuzz。）
 */

interface HarfbuzzExports {
  malloc(n: number): number
  free(p: number): void
  memory: WebAssembly.Memory
  hb_blob_create(d: number, len: number, mode: number, ud: number, ud2: number): number
  hb_blob_destroy(b: number): void
  hb_blob_get_data(b: number, len: number): number
  hb_blob_get_length(b: number): number
  hb_face_create(b: number, index: number): number
  hb_face_destroy(f: number): void
  hb_face_reference_blob(f: number): number
  hb_subset_input_create_or_fail(): number
  hb_subset_input_destroy(i: number): void
  hb_subset_input_unicode_set(i: number): number
  hb_set_add(s: number, cp: number): void
  hb_subset_or_fail(f: number, i: number): number
}

let harfbuzzPromise: Promise<HarfbuzzExports> | null = null

async function loadHarfbuzz(): Promise<HarfbuzzExports> {
  if (harfbuzzPromise) return harfbuzzPromise
  harfbuzzPromise = (async () => {
    let bytes: ArrayBuffer | Uint8Array
    if (isNodeEnv()) {
      const { readFileSync } = await import('fs')
      const { resolve } = await import('path')
      bytes = readFileSync(resolve(process.cwd(), 'node_modules/harfbuzzjs/hb-subset.wasm'))
    } else {
      const mod = (await import('harfbuzzjs/hb-subset.wasm?url')) as { default: string }
      bytes = await (await fetch(mod.default)).arrayBuffer()
    }
    const { instance } = await WebAssembly.instantiate(bytes as ArrayBuffer)
    return instance.exports as unknown as HarfbuzzExports
  })()
  return harfbuzzPromise
}

/**
 * TTF 手术：剥离排版表（GSUB/GPOS/GDEF/kern 等）。
 *
 * harfbuzz 子集化后的 GSUB 会让 @pdf-lib/fontkit 解析崩溃
 * （JetBrainsMono 的编程连字 <=、>= 必现）。且 PDF 里每个文本簇都在
 * 浏览器量好的绝对位置上绘制，连字/字距本就用不上 —— 去掉最安全。
 */
function stripLayoutTables(font: Uint8Array): Uint8Array {
  try {
    const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
    const numTables = view.getUint16(4)
    const DROP = new Set(['GSUB', 'GPOS', 'GDEF', 'kern', 'feat', 'mort', 'morx', 'bdat', 'bloc'])
    const dirs: Array<{ tag: string; checksum: number; offset: number; length: number }> = []
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16
      const tag = String.fromCharCode(font[off], font[off + 1], font[off + 2], font[off + 3])
      if (!DROP.has(tag)) {
        dirs.push({ tag, checksum: view.getUint32(off + 4), offset: view.getUint32(off + 8), length: view.getUint32(off + 12) })
      }
    }
    if (dirs.length === numTables) return font // 没有需要剥离的表
    dirs.sort((a, b) => (a.tag < b.tag ? -1 : 1))
    const n = dirs.length
    const entrySelector = Math.max(0, Math.floor(Math.log2(n)))
    const searchRange = 2 ** entrySelector * 16
    const headerSize = 12 + n * 16
    const chunks: Uint8Array[] = []
    let dataOff = headerSize
    for (const d of dirs) {
      const table = font.subarray(d.offset, d.offset + d.length)
      const pad = (4 - (table.length % 4)) % 4
      d.offset = dataOff
      chunks.push(table, new Uint8Array(pad))
      dataOff += table.length + pad
    }
    const out = new Uint8Array(dataOff)
    const ov = new DataView(out.buffer)
    ov.setUint32(0, view.getUint32(0)) // sfnt version
    ov.setUint16(4, n)
    ov.setUint16(6, searchRange)
    ov.setUint16(8, entrySelector)
    ov.setUint16(10, n * 16 - searchRange)
    dirs.forEach((d, i) => {
      const off = 12 + i * 16
      for (let k = 0; k < 4; k++) out[off + k] = d.tag.charCodeAt(k)
      ov.setUint32(off + 4, d.checksum)
      ov.setUint32(off + 8, d.offset)
      ov.setUint32(off + 12, d.length)
    })
    let pos = headerSize
    for (const c of chunks) {
      out.set(c, pos)
      pos += c.length
    }
    return out
  } catch {
    return font // 手术失败回退原字体
  }
}

/** 裁剪 TTF，只保留 text 中出现的字形（保持原字形 ID 语义，bbox/advance 不变） */
export async function subsetTtfWithHarfbuzz(fontData: Uint8Array, text: string): Promise<Uint8Array> {
  const exports = await loadHarfbuzz()
  const fontBuf = exports.malloc(fontData.byteLength)
  if (!fontBuf) throw new Error('harfbuzz malloc failed')
  {
    const heap = new Uint8Array(exports.memory.buffer)
    heap.set(fontData, fontBuf)
  }

  let result: Uint8Array | null = null
  try {
    const blob = exports.hb_blob_create(fontBuf, fontData.byteLength, 2 /* WRITABLE */, 0, 0)
    const face = exports.hb_face_create(blob, 0)
    exports.hb_blob_destroy(blob)

    const input = exports.hb_subset_input_create_or_fail()
    if (!input) throw new Error('hb_subset_input_create_or_fail failed')
    const unicodes = exports.hb_subset_input_unicode_set(input)
    const seen = new Set<string>()
    for (const ch of text) {
      if (seen.has(ch)) continue
      seen.add(ch)
      const cp = ch.codePointAt(0)
      if (cp !== undefined) exports.hb_set_add(unicodes, cp)
    }
    const subsetFace = exports.hb_subset_or_fail(face, input)
    exports.hb_subset_input_destroy(input)
    if (!subsetFace) throw new Error('hb_subset_or_fail failed')

    const resultBlob = exports.hb_face_reference_blob(subsetFace)
    const offset = exports.hb_blob_get_data(resultBlob, 0)
    const length = exports.hb_blob_get_length(resultBlob)
    if (!length) {
      exports.hb_blob_destroy(resultBlob)
      exports.hb_face_destroy(subsetFace)
      exports.hb_face_destroy(face)
      throw new Error('empty subset result')
    }
    // 子集过程可能扩容 memory，重新取视图
    const heap = new Uint8Array(exports.memory.buffer)
    result = heap.slice(offset, offset + length)
    exports.hb_blob_destroy(resultBlob)
    exports.hb_face_destroy(subsetFace)
    exports.hb_face_destroy(face)
  } finally {
    try {
      exports.free(fontBuf)
    } catch { /* 某些构建未导出 free */ }
  }
  if (!result) throw new Error('subset failed')
  return stripLayoutTables(result)
}

/**
 * 按用到的字符子集化字体。失败时回退完整字体（文件更大但保证可用）。
 * @returns fontKey → 可嵌入的 TTF 字节
 */
export async function subsetUsedFonts(
  used: Map<string, Set<string>>,
  onNotice?: (msg: string) => void,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()
  const entries = [...used.entries()].filter(([key]) => ALL_FONT_FILES[key])
  // 串行执行：所有子集共享同一个 harfbuzz wasm 实例与线性内存，
  // 并发调用会互相覆盖内存导致产物损坏（表现为 fontkit 无法解析 cmap）。
  for (const [key, chars] of entries) {
    const full = await loadFontBytes(key)
    try {
      // 预过滤：只保留该字体真正拥有的字形。
      // 字体不含的字符交给回退字体绘制（如等宽字体里的中文 → 黑体）；
      // 若全部缺失则整个跳过该字体 —— harfbuzz 对“空子集”会产出 fontkit
      // 无法解析的退化字体，导致整个导出失败。
      const fontkit = (await import('@pdf-lib/fontkit')).default
      const fkFont = fontkit.create(full as unknown as Uint8Array)
      const supported = new Set<number>(fkFont.characterSet ?? [])
      const text = [...chars].filter((ch) => {
        const cp = ch.codePointAt(0)!
        return supported.has(cp)
      }).join('')
      if (!text) continue // 该字体没有任何可画字符：不嵌入，绘制时走回退
      const buf = await subsetTtfWithHarfbuzz(full, text)
      out.set(key, buf)
    } catch (err) {
      console.warn(`font subset failed for ${key}, embedding full font`, err)
      onNotice?.('字体子集化失败，PDF 中嵌入了完整字体（文件体积会偏大）')
      out.set(key, full)
    }
  }
  return out
}

/** 测试/诊断用：清空缓存 */
export function resetFontCacheForTest(): void {
  bytesCache.clear()
  inflight.clear()
  faceRegistered.clear()
  notices.length = 0
  noticedFamilies.clear()
}
