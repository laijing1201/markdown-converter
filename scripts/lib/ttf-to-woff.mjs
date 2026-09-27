/**
 * TTF → WOFF v1 压缩（构建期共用库）。
 *
 * 逐表 zlib raw-deflate，目录按 tag 排序；带磁盘缓存（.fontcache）与
 * roundtrip 校验（解回的 sfnt 逐表内容必须与原 TTF 完全一致）。
 * 供两个构建方使用：
 *   - scripts/build-extension.mjs     → dist-extension/fonts（浏览器扩展包）
 *   - scripts/compress-web-fonts.mjs  → dist/fonts（网站 / Electron 产物）
 * 运行时解码见 extension/src/lib/woff.js（DecompressionStream，零依赖）。
 */

import zlib from 'zlib'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, copyFileSync, rmSync, rmdirSync } from 'fs'
import { join, dirname } from 'path'
import { decodeWoff } from '../../extension/src/lib/woff.js'

/** TTF（sfnt）→ WOFF v1 字节 */
export function ttfToWoff(ttf) {
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

/** roundtrip 校验：解回的 sfnt 逐表内容必须与原始 TTF 完全一致 */
async function verifyRoundtrip(ttfPath, woff, rel) {
  const orig = new Uint8Array(readFileSync(ttfPath))
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
}

/**
 * 把 srcDir 下所有 .ttf 压缩为 .woff（缓存命中跳过转换），
 * WOFF 写入 outDir 镜像目录结构。
 * options.removeTtf: true 时同时删除 outDir 中的 .ttf（部署产物瘦身，
 * 运行时 fetchFontBytes 走 WOFF 路径，无需 TTF 兜底）。
 */
export async function compressFontsToWoff({ srcDir, outDir, cacheDir, removeTtf = false }) {
  if (!existsSync(srcDir)) {
    console.log(`  (跳过：字体源目录不存在 ${srcDir})`)
    return { totalTtf: 0, totalWoff: 0 }
  }
  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })

  const ttfFiles = []
  const walk = (dir, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`)
      else if (name.endsWith('.ttf')) ttfFiles.push({ full, rel: `${prefix}${name}` })
    }
  }
  walk(srcDir)

  let totalTtf = 0
  let totalWoff = 0
  for (const { full, rel } of ttfFiles) {
    const cached = join(cacheDir, rel.replace(/\.ttf$/, '.woff'))
    const srcMtime = statSync(full).mtimeMs
    if (!existsSync(cached) || statSync(cached).mtimeMs < srcMtime) {
      const woff = ttfToWoff(new Uint8Array(readFileSync(full)))
      await verifyRoundtrip(full, woff, rel)
      mkdirSync(dirname(cached), { recursive: true })
      writeFileSync(cached, woff)
      console.log(`  ⟳ ${rel}: ${(statSync(full).size / 1048576).toFixed(1)}MB → ${(woff.length / 1048576).toFixed(1)}MB ✓roundtrip`)
    }
    const outRel = rel.replace(/\.ttf$/, '.woff')
    const outPath = join(outDir, outRel)
    mkdirSync(dirname(outPath), { recursive: true })
    copyFileSync(cached, outPath)
    if (removeTtf) {
      const ttfInOut = join(outDir, rel)
      if (existsSync(ttfInOut)) rmSync(ttfInOut, { force: true })
      const ttfDir = dirname(ttfInOut)
      try {
        if (readdirSync(ttfDir).length === 0) rmdirSync(ttfDir)
      } catch { /* 目录非空或已删 */ }
    }
    totalTtf += statSync(full).size
    totalWoff += statSync(outPath).size
  }
  console.log(`  ✓ 字体 WOFF 化: ${(totalTtf / 1048576).toFixed(1)}MB → ${(totalWoff / 1048576).toFixed(1)}MB${removeTtf ? '（已移除产物内 TTF）' : ''}`)
  return { totalTtf, totalWoff }
}
