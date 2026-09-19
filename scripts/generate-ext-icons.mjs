/**
 * 程序化生成扩展图标（16/32/48/128）：
 * 蓝色圆角渐变方块 + 白色文档页（右上折角）+ 三条蓝色文字线。仅用 pngjs 像素绘制。
 */

import { writeFileSync, mkdirSync } from 'fs'
import { PNG } from 'pngjs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'extension/public/icons')
mkdirSync(OUT_DIR, { recursive: true })

const BG_TOP = [59, 130, 246] // #3b82f6
const BG_BOTTOM = [29, 78, 216] // #1d4ed8
const WHITE = [255, 255, 255]
const FOLD_GRAY = [203, 213, 225]

/** 圆角矩形 SDF（<=0 在内部） */
function roundedRectDist(x, y, halfW, halfH, r) {
  const qx = Math.abs(x) - halfW + r
  const qy = Math.abs(y) - halfH + r
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r
}

function drawIcon(size) {
  const png = new PNG({ width: size, height: size })
  const half = size / 2
  const bgHalf = half - Math.max(1, size * 0.015)
  const bgR = size * 0.22
  const pageW = size * 0.52
  const pageH = size * 0.62
  const pageR = size * 0.07
  const fold = size * 0.13

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5 - half
      const y = py + 0.5 - half
      const idx = (py * size + px) * 4

      const inBg = roundedRectDist(x, y, bgHalf, bgHalf, bgR) <= 0
      if (!inBg) {
        png.data[idx + 3] = 0
        continue
      }

      const t = (px + py) / (2 * size)
      let r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t
      let g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t
      let b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t

      const inPage = roundedRectDist(x, y, pageW / 2, pageH / 2, pageR) <= 0
      if (inPage) {
        const cornerX = x - (pageW / 2 - fold)
        const cornerY = y - (pageH / 2 - fold)
        const inFoldCut = cornerX > 0 && cornerY > 0
        if (!inFoldCut) {
          // 页面白底 + 三条文字线
          r = WHITE[0]; g = WHITE[1]; b = WHITE[2]
          const lineH = size * 0.045
          const lineW = pageW * 0.56
          const lineX0 = -lineW / 2 + pageW * 0.06
          const rows = [-pageH * 0.22, 0, pageH * 0.22]
          const rowW = [lineW, lineW, lineW * 0.62]
          for (let i = 0; i < rows.length; i++) {
            const inY = Math.abs(y - rows[i]) <= lineH / 2
            const inX = x >= lineX0 && x <= lineX0 + rowW[i]
            if (inY && inX) {
              r = BG_BOTTOM[0]; g = BG_BOTTOM[1]; b = BG_BOTTOM[2]
            }
          }
        } else if (Math.abs(cornerX + cornerY - fold) <= size * 0.018 || cornerX + cornerY - fold <= 0) {
          // 折角三角
          r = FOLD_GRAY[0]; g = FOLD_GRAY[1]; b = FOLD_GRAY[2]
        }
      }

      png.data[idx] = Math.round(r)
      png.data[idx + 1] = Math.round(g)
      png.data[idx + 2] = Math.round(b)
      png.data[idx + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(OUT_DIR, `icon${size}.png`), drawIcon(size))
  console.log(`icon${size}.png ✓`)
}
console.log(`→ ${OUT_DIR}`)
