/**
 * 社交分享图（og:image）生成：public/icon-v3.png → public/og-image.jpg
 *
 * 源文件 icon-v3.png 虽以 .png 结尾，实际是 630KB 的 JPEG（历史遗留，
 * pngjs 无法解码，png 命名还会误导 electron-builder 的 build.icon）。
 * 分享图直接用正确命名的 JPEG（og:image 原生支持），1024×1024、
 * quality 85，体积约为源图的 1/8，社交平台抓取更快。
 *
 * 解码复用 generate-pwa-icons.mjs 的方案：puppeteer-core + 系统 Chrome/Edge
 * 的 canvas（无独立图像解码依赖）。
 *
 * 运行：node scripts/generate-og-image.mjs（仅源图标变更时需要）
 */

import { existsSync, readFileSync, statSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'public/icon-v3.png')
const OUTPUT = join(ROOT, 'public/og-image.jpg')

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

const srcB64 = readFileSync(SOURCE).toString('base64')

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: 'new',
  args: ['--no-first-run', '--disable-gpu'],
})
try {
  const page = await browser.newPage()
  const dataUrl = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/jpeg;base64,${b64}`
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = () => rej(new Error('源图解码失败'))
    })
    // og:image 推荐 1:1 以上的大图；源图即 1024×1024，等幅重编码即可
    const size = 1024
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.85)
  }, srcB64)

  const b64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '')
  writeFileSync(OUTPUT, Buffer.from(b64, 'base64'))
  const kb = (statSync(OUTPUT).size / 1024).toFixed(0)
  console.log(`✓ og:image 已生成：public/og-image.jpg（1024×1024 JPEG，${kb}KB）`)
} finally {
  await browser.close()
}
