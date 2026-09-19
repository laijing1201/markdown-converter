/**
 * MarkDoc 扩展构建（P4C）：
 *
 *   1. 字体管线：TTF → WOFF v1（逐表 zlib 压缩，构建期 roundtrip 校验）——
 *      扩展包只带 WOFF（49MB → 约 29MB），运行时用浏览器原生
 *      DecompressionStream 解回 TTF 交给 harfbuzz 子集化。
 *      不用 WOFF2：其 wasm 运行时依赖 eval/new Function，与 MV3 CSP 冲突。
 *   2. vite build --config vite.extension.config.ts → popup/exporter/options/onboarding
 *   3. esbuild 打包 background.js / content.js / bridge.js（单文件 IIFE，MV3 要求）
 *   4. 拷贝 manifest.json / WOFF 字体（PDF 管线按 /fonts/ 约定加载后解压）
 *
 * 产物 dist-extension/ 可直接在 Chrome / Edge「加载已解压的扩展程序」。
 */

import { build } from 'esbuild'
import zlib from 'zlib'
import { cpSync, mkdirSync, copyFileSync, existsSync, statSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { decodeWoff } from '../extension/src/lib/woff.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist-extension')
const FONT_CACHE = resolve(ROOT, '.fontcache')
const FONTS_SRC = resolve(ROOT, 'public/fonts')

function log(step) {
  console.log(`\n=== ${step} ===`)
}

// ── 1. 字体：TTF → WOFF v1（缓存 + roundtrip 校验）───────────────────────────

/** TTF（sfnt）→ WOFF v1：逐表 raw-deflate，目录按 tag 排序 */
function ttfToWoff(ttf) {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
  const sfntVersion = v.getUint32(0)
  const numTables = v.getUint16(4)
  const tables = []
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16
    tables.push({
      tag: ttf.slice(off, off + 4),
      checksum: v.getUint32(off + 4),
      offset: v.getUint32(off + 8),
      length: v.getUint32(off + 12),
    })
  }
  let totalSfnt = 12 + 16 * numTables
  for (const t of tables) totalSfnt += Math.ceil(t.length / 4) * 4

  const entries = tables
    .map((t) => {
      const raw = ttf.slice(t.offset, t.offset + t.length)
      const comp = zlib.deflateRawSync(raw, { level: 9 })
      const useComp = comp.length < t.length
      return { ...t, data: useComp ? comp : raw, compLen: useComp ? comp.length : t.length }
    })
    .sort((a, b) => Buffer.compare(Buffer.from(a.tag), Buffer.from(b.tag)))

  const headerSize = 44 + 20 * entries.length
  let dataSize = 0
  for (const e of entries) dataSize += e.compLen
  const out = Buffer.alloc(headerSize + dataSize)
  const ov = new DataView(out.buffer)
  out.write('wOFF', 0, 'ascii')
  ov.setUint32(4, sfntVersion)
  ov.setUint32(8, out.length)
  ov.setUint16(12, numTables)
  ov.setUint16(14, 0)
  ov.setUint32(16, totalSfnt)
  ov.setUint16(20, 1)
  ov.setUint16(22, 0)
  ov.setUint32(24, 0)
  ov.setUint32(28, 0)
  ov.setUint32(32, 0)
  ov.setUint32(36, 0)
  ov.setUint32(40, 0)
  let dataOff = headerSize
  entries.forEach((e, i) => {
    const off = 44 + i * 20
    Buffer.from(e.tag).copy(out, off)
    ov.setUint32(off + 4, dataOff)
    ov.setUint32(off + 8, e.compLen)
    ov.setUint32(off + 12, e.length)
    ov.setUint32(off + 16, e.checksum)
    Buffer.from(e.data).copy(out, dataOff)
    dataOff += e.compLen
  })
  return out
}

async function convertFontsToWoff() {
  mkdirSync(FONT_CACHE, { recursive: true })
  mkdirSync(join(DIST, 'fonts'), { recursive: true })

  const ttfFiles = []
  const walk = (dir, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`)
      else if (name.endsWith('.ttf')) ttfFiles.push({ full, rel: `${prefix}${name}` })
    }
  }
  walk(FONTS_SRC)

  let totalTtf = 0
  let totalWoff = 0
  for (const { full, rel } of ttfFiles) {
    const cached = join(FONT_CACHE, rel.replace(/\.ttf$/, '.woff'))
    const srcMtime = statSync(full).mtimeMs
    if (!existsSync(cached) || statSync(cached).mtimeMs < srcMtime) {
      const woff = ttfToWoff(new Uint8Array(readFileSync(full)))
      // roundtrip 校验：解回的 sfnt 逐表内容必须与原始 TTF 完全一致
      //（表顺序/对齐布局允许不同，表内容必须一致）
      const orig = new Uint8Array(readFileSync(full))
      const decoded = await decodeWoff(woff)
      const tablesOf = (font) => {
        const v = new DataView(font.buffer, font.byteOffset, font.byteLength)
        const n = v.getUint16(4)
        const map = new Map()
        for (let i = 0; i < n; i++) {
          const off = 12 + i * 16
          const tag = String.fromCharCode(font[off], font[off + 1], font[off + 2], font[off + 3])
          map.set(tag, font.slice(v.getUint32(off + 8), v.getUint32(off + 8) + v.getUint32(off + 12)))
        }
        return map
      }
      const tOrig = tablesOf(orig)
      const tDec = tablesOf(decoded)
      if (tOrig.size !== tDec.size) throw new Error(`woff roundtrip 表数量不一致: ${rel}`)
      for (const [tag, bytes] of tOrig) {
        const other = tDec.get(tag)
        if (!other || other.length !== bytes.length) throw new Error(`woff roundtrip 表 ${tag} 缺失或尺寸不一致: ${rel}`)
        if (Buffer.compare(Buffer.from(bytes), Buffer.from(other)) !== 0) {
          throw new Error(`woff roundtrip 表 ${tag} 内容不一致: ${rel}`)
        }
      }
      mkdirSync(dirname(cached), { recursive: true })
      writeFileSync(cached, woff)
      console.log(`  ⟳ ${rel}: ${(orig.length / 1048576).toFixed(1)}MB → ${(woff.length / 1048576).toFixed(1)}MB ✓roundtrip`)
    }
    const outRel = rel.replace(/\.ttf$/, '.woff')
    const outPath = join(DIST, 'fonts', outRel)
    mkdirSync(dirname(outPath), { recursive: true })
    copyFileSync(cached, outPath)
    totalTtf += statSync(full).size
    totalWoff += statSync(outPath).size
  }
  console.log(`  ✓ 字体 WOFF 化: ${(totalTtf / 1048576).toFixed(1)}MB → ${(totalWoff / 1048576).toFixed(1)}MB`)
}

// ── 构建流程 ─────────────────────────────────────────────────────────────────

log('vite build: popup + exporter + options + onboarding pages')
mkdirSync(DIST, { recursive: true })
execFileSync('npx', ['vite', 'build', '--config', 'vite.extension.config.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

// ── esbuild：service worker / content scripts（单文件 IIFE）────────────────

const esbuildCommon = {
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  legalComments: 'none',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
  define: { '__APP_VERSION__': JSON.stringify('1.1.0-ext'), '__EXT_COMPRESSED_FONTS__': 'false' },
}

log('esbuild: background.js')
await build({
  ...esbuildCommon,
  entryPoints: [resolve(ROOT, 'extension/src/background/background.ts')],
  outfile: resolve(DIST, 'background.js'),
})

log('esbuild: content.js')
await build({
  ...esbuildCommon,
  entryPoints: [resolve(ROOT, 'extension/src/content/index.ts')],
  outfile: resolve(DIST, 'content.js'),
})

log('esbuild: bridge.js')
await build({
  ...esbuildCommon,
  entryPoints: [resolve(ROOT, 'extension/src/bridge/markdoc-site.ts')],
  outfile: resolve(DIST, 'bridge.js'),
})

// ── 静态资源（vite 会清空 outDir，字体拷贝必须在其后）───────────────────────

log('copy: manifest.json')
copyFileSync(resolve(ROOT, 'extension/manifest.json'), resolve(DIST, 'manifest.json'))

log('fonts: TTF → WOFF → dist-extension/fonts')
await convertFontsToWoff()

if (!existsSync(resolve(DIST, 'icons/icon128.png'))) {
  console.warn('⚠ icons 缺失：请先运行 node scripts/generate-ext-icons.mjs')
}

log('done → dist-extension/')
