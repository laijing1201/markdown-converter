/**
 * GitHub Pages 生产路径模拟服务器：
 *
 *   node scripts/serve-ghpages.mjs [distDir] [port]
 *
 * 把 Web 构建产物（dist/）挂在 /markdown-converter/ 子路径下服务，
 * 等价模拟 https://laijing1201.github.io/markdown-converter/ 的资源路径。
 * 用于本地验证 base:'./' 相对引用在子路径部署下不白屏：
 *
 *   npm run build && node scripts/serve-ghpages.mjs dist 8899
 *   # → http://127.0.0.1:8899/markdown-converter/
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(process.cwd(), process.argv[2] ?? 'dist')
const PORT = Number(process.argv[3] ?? 8899)
const BASE = '/markdown-converter'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.json': 'application/json', '.ico': 'image/x-icon',
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`❌ 缺少 ${join(DIST, 'index.html')}，请先 npm run build`)
  process.exit(1)
}

createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
  // 仅服务 /markdown-converter/ 子路径（模拟 GitHub Pages 项目站点）
  if (urlPath === BASE || urlPath === `${BASE}/`) {
    urlPath = '/index.html'
  } else if (urlPath.startsWith(`${BASE}/`)) {
    urlPath = urlPath.slice(BASE.length)
  } else {
    // 裸路径：301 到正式子路径（与 GH Pages 行为一致性最接近的做法）
    res.writeHead(301, { Location: `${BASE}/` })
    res.end()
    return
  }
  let filePath = join(DIST, urlPath)
  if (!filePath.startsWith(DIST) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`404 Not Found: ${urlPath}`)
    return
  }
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type })
  res.end(readFileSync(filePath))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`GitHub Pages 模拟服务器: http://127.0.0.1:${PORT}${BASE}/ (dist=${DIST})`)
})
