/**
 * WOFF v1 → TTF 解码器（扩展 PDF 字体管线专用）。
 *
 * 背景（P4C 第二十九节 字体策略）：
 *   扩展包内字体为 WOFF v1（构建期 scripts/build-extension.mjs 逐表 zlib 压缩），
 *   运行时解回 TTF 再交给 harfbuzz 子集化与 FontFace。
 *   不用 WOFF2 是因为其生态（embind wasm）依赖 eval/new Function，与 MV3 CSP 冲突；
 *   WOFF v1 用浏览器原生 DecompressionStream('deflate-raw') 解压，零依赖、零 eval。
 *
 * 纯 JS ESM：构建脚本（Node）与扩展运行时（浏览器）共用同一实现，
 * 构建期对每个字体做 roundtrip 校验。
 */

const WOFF_SIGNATURE = 0x774f4646 // 'wOFF'

async function inflateRaw(data) {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/** WOFF v1 字节 → TTF（sfnt）字节 */
export async function decodeWoff(woff) {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)
  if (view.getUint32(0) !== WOFF_SIGNATURE) {
    throw new Error('not a WOFF file')
  }
  const flavor = view.getUint32(4)
  const numTables = view.getUint16(12)

  const entries = []
  for (let i = 0; i < numTables; i++) {
    const off = 44 + i * 20
    const tag = String.fromCharCode(
      woff[off], woff[off + 1], woff[off + 2], woff[off + 3],
    )
    entries.push({
      tag,
      offset: view.getUint32(off + 4),
      compLength: view.getUint32(off + 8),
      origLength: view.getUint32(off + 12),
      checksum: view.getUint32(off + 16),
    })
  }

  // 按 tag 排序重建 sfnt 目录（sfnt 规范要求）
  entries.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))

  const dirSize = 12 + 16 * numTables
  const padded = []
  let bodySize = 0
  for (const entry of entries) {
    const raw = woff.subarray(entry.offset, entry.offset + entry.compLength)
    const data = entry.compLength < entry.origLength
      ? await inflateRaw(raw)
      : raw.slice()
    if (data.length !== entry.origLength) {
      throw new Error(`woff table ${entry.tag}: size mismatch ${data.length} != ${entry.origLength}`)
    }
    const pad = (4 - (data.length % 4)) % 4
    padded.push({ entry, data, pad })
    bodySize += data.length + pad
  }

  // sfnt 头（searchRange / entrySelector / rangeShift 规范计算）
  const entrySelector = Math.max(0, Math.floor(Math.log2(numTables)))
  const searchRange = 2 ** entrySelector * 16
  const rangeShift = numTables * 16 - searchRange

  const out = new Uint8Array(dirSize + bodySize)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, flavor)
  ov.setUint16(4, numTables)
  ov.setUint16(6, searchRange)
  ov.setUint16(8, entrySelector)
  ov.setUint16(10, rangeShift)

  let bodyOff = dirSize
  padded.forEach(({ entry, data, pad }, i) => {
    const dirOff = 12 + i * 16
    for (let c = 0; c < 4; c++) out[dirOff + c] = entry.tag.charCodeAt(c)
    ov.setUint32(dirOff + 4, entry.checksum)
    ov.setUint32(dirOff + 8, bodyOff)
    ov.setUint32(dirOff + 12, data.length)
    out.set(data, bodyOff)
    bodyOff += data.length + pad // 表体 4 字节对齐（pad 字节保持 0）
  })
  return out
}
