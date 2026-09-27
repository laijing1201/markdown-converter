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
import { cpSync, mkdirSync, copyFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { compressFontsToWoff } from './lib/ttf-to-woff.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist-extension')
const FONT_CACHE = resolve(ROOT, '.fontcache')
const FONTS_SRC = resolve(ROOT, 'public/fonts')

function log(step) {
  console.log(`\n=== ${step} ===`)
}

// ── 1. 字体：TTF → WOFF v1（缓存 + roundtrip 校验）───────────────────────────

/** TTF → WOFF v1（共用库 scripts/lib/ttf-to-woff.mjs：缓存 + roundtrip 校验） */
async function convertFontsToWoff() {
  await compressFontsToWoff({
    srcDir: FONTS_SRC,
    outDir: join(DIST, 'fonts'),
    cacheDir: FONT_CACHE,
    removeTtf: false,
  })
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
  define: { '__APP_VERSION__': JSON.stringify('1.1.0-ext'), '__WOFF_FONTS__': 'false' },
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
