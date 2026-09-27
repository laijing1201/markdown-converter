/**
 * 网站 / Electron 产物字体压缩：dist/fonts 内的 TTF → WOFF v1。
 *
 * 与浏览器扩展共用同一 WOFF 管线（scripts/lib/ttf-to-woff.mjs + 运行时
 * extension/src/lib/woff.js 解码）。网页运行时 __WOFF_FONTS__=true 时
 * fetchFontBytes 优先加载 .woff 并解回 TTF，因此产物内 TTF 可直接移除：
 * 部署体积 51.5MB → 约 29MB。
 *
 * 由 vite.config.ts 的 closeBundle 钩子在每次构建后调用（幂等，可重复运行）：
 *   node scripts/compress-web-fonts.mjs [distDir]   # 默认 dist
 */
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { compressFontsToWoff } from './lib/ttf-to-woff.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(ROOT, process.argv[2] ?? 'dist')

await compressFontsToWoff({
  srcDir: resolve(ROOT, 'public/fonts'),
  outDir: resolve(distDir, 'fonts'),
  cacheDir: resolve(ROOT, '.fontcache'),
  removeTtf: true,
})
