/**
 * PWA / Android 图标生成：public/icon-v3.png → 各尺寸 PNG。
 *
 * 源文件虽以 .png 结尾，实际是 JPEG（历史遗留），pngjs 无法解码——
 * 这里用 puppeteer-core + 系统 Chrome 的 canvas 做缩放转换，顺便完成：
 *   - public/icons/icon-{192,512}.png          PWA manifest 图标
 *   - public/icons/icon-maskable-512.png       PWA maskable（内容缩到 66% 留安全区）
 *   - public/icons/apple-touch-icon.png        iOS 添加到主屏幕
 *   - assets/icon-only.png / assets/splash.png @capacitor/assets 生成安卓原生图标的输入
 *
 * 运行：node scripts/generate-pwa-icons.mjs
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'public/icon-v3.png')

if (!existsSync(SOURCE)) {
  console.error(`✗ 找不到源图标 ${SOURCE}`)
  process.exit(1)
}

// Chrome for Testing（tests/ext/browsers）→ 系统安装的 Chrome → Edge
function findBrowser() {
  const fromEnv = process.env.CHROME_PATH ?? process.env.MARKDOC_CHROME
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const CFT_DIR = join(ROOT, 'tests/ext/browsers')
  if (existsSync(CFT_DIR)) {
    const stack = [CFT_DIR]
    while (stack.length) {
      const dir = stack.pop()
      if (!existsSync(dir)) continue
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (!existsSync(full)) continue
        if (name === 'chrome.exe' && statSync(full).isFile()) return full
        if (statSync(full).isDirectory()) stack.push(full)
      }
    }
  }
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]) if (existsSync(p)) return p
  return null
}

const browserPath = findBrowser()
if (!browserPath) {
  console.error('✗ 未找到 Chrome/Edge，可设置 CHROME_PATH 环境变量后重试')
  process.exit(1)
}

// [输出路径, 画布边长, 内容缩放（1 = 铺满）]
const targets = [
  ['public/icons/icon-192.png', 192, 1],
  ['public/icons/icon-512.png', 512, 1],
  ['public/icons/icon-maskable-512.png', 512, 0.66],
  ['public/icons/apple-touch-icon.png', 180, 1],
  ['assets/icon-only.png', 1024, 1],
  ['assets/splash.png', 2732, 0.32],
]

const imageDataUrls = readFileSync(SOURCE).toString('base64')

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: 'new',
  args: ['--no-first-run', '--disable-gpu'],
})
try {
  const page = await browser.newPage()
  const results = await page.evaluate(
    async (srcB64, specs) => {
      const img = new Image()
      img.src = `data:image/jpeg;base64,${srcB64}`
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = () => rej(new Error('源图解码失败'))
      })
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      return specs.map(([, size, scale]) => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        // 底层先整幅铺满（maskable 图标被系统裁圆角时不露白边）
        ctx.drawImage(img, 0, 0, size, size)
        const drawSize = Math.floor(side * scale)
        const offset = Math.floor((size - drawSize) / 2)
        ctx.drawImage(
          img,
          Math.floor((img.naturalWidth - side) / 2),
          Math.floor((img.naturalHeight - side) / 2),
          side,
          side,
          offset,
          offset,
          drawSize,
          drawSize,
        )
        return canvas.toDataURL('image/png')
      })
    },
    imageDataUrls,
    targets,
  )

  for (const [i, [out]] of targets.entries()) {
    const dest = join(ROOT, out)
    mkdirSync(join(dest, '..'), { recursive: true })
    writeFileSync(dest, Buffer.from(results[i].split(',')[1], 'base64'))
    console.log(`✓ ${out}`)
  }
  console.log(`\n完成：${targets.length} 个图标已生成（源图实际为 JPEG，已由 Chrome canvas 转码）`)
} finally {
  await browser.close()
}
