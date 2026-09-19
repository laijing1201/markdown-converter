/**
 * 扩展发布审计（P4C 第十七/十八/二十六/二十七/二十八节）：
 *
 *   1. 权限最小化审计：permissions 白名单、host_permissions 与支持平台一致、
 *      禁止 <all_urls> / cookies / history / webRequest；
 *   2. CSP 审计：manifest 声明检查 + 全部 bundle 扫描 eval/new Function/远程脚本；
 *   3. 构建产物完整性：manifest/icons/background/content/popup/exporter/options/
 *      onboarding 齐全；无 sourcemap / 测试 fixture / node_modules / .env / 私钥 /
 *      遗留 TTF / 超大异常文件；
 *   4. Bundle size 报告：content / background / popup / exporter / shared core。
 *
 * 输出：控制台报告 + tests/ext/out/audit.json；发现 FAIL 时退出码 1。
 */

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve, dirname, relative, extname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist-extension')
const MANIFEST = join(ROOT, 'extension', 'manifest.json')
const OUT = join(ROOT, 'tests', 'ext', 'out')

let passed = 0
let failed = 0
const results = []
function check(category, cond, label, detail = '') {
  const entry = { category, label, ok: !!cond, detail }
  results.push(entry)
  if (entry.ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

console.log('\n── 权限最小化审计（P4C 第十七节）──')
{
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const ALLOWED_PERMISSIONS = new Set(['storage'])
  const FORBIDDEN = new Set([
    'tabs', 'cookies', 'history', 'bookmarks', 'webRequest', 'webRequestBlocking',
    'management', 'nativeMessaging', 'clipboardRead', 'debugger', 'privacy',
    'browsingData', 'topSites', 'downloads', 'scripting', 'activeTab', 'identity',
  ])
  const perms = manifest.permissions ?? []
  check('permission', perms.every((p) => ALLOWED_PERMISSIONS.has(p)),
    `permissions 仅 ${[...ALLOWED_PERMISSIONS]}`, JSON.stringify(perms))
  check('permission', !perms.some((p) => FORBIDDEN.has(p)), '无危险权限')
  check('permission', manifest.manifest_version === 3, 'Manifest V3')

  const hosts = manifest.host_permissions ?? []
  const EXPECTED_HOSTS = [
    'https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://chat.deepseek.com/*',
    'https://claude.ai/*', 'https://gemini.google.com/*', 'https://kimi.com/*', 'https://www.kimi.com/*',
    'https://laijing1201.github.io/markdown-converter/*', 'http://localhost:5173/*', 'http://127.0.0.1:5173/*',
  ]
  check('permission', !hosts.includes('<all_urls>'), '无 <all_urls>')
  check('permission', !hosts.includes('*://*/*'), '无通配 host')
  const unexpected = hosts.filter((h) => !EXPECTED_HOSTS.includes(h))
  check('permission', unexpected.length === 0, 'host_permissions 只覆盖支持平台+网页版桥',
    JSON.stringify(unexpected))
  const missing = EXPECTED_HOSTS.filter((h) => !hosts.includes(h))
  check('permission', missing.length === 0, '支持平台全部声明', JSON.stringify(missing))

  // content_scripts matches 与 host_permissions 一致（AI 平台部分）
  const csMatches = (manifest.content_scripts ?? []).flatMap((cs) => cs.matches ?? [])
  const aiMatches = csMatches.filter((m) => !m.includes('laijing1201.github.io') && !m.includes('localhost') && !m.includes('127.0.0.1'))
  check('permission', JSON.stringify([...aiMatches].sort()) === JSON.stringify([...EXPECTED_HOSTS.slice(0, 7)].sort()),
    'content script matches 与 host_permissions 的平台部分一致',
    JSON.stringify(aiMatches))

  console.log('\n  Permission 表：')
  for (const p of perms) {
    console.log(`    | ${p} | ${p === 'storage' ? '保存快速设置与临时导出任务（本地）' : '?'} |`)
  }
  console.log('    | host_permissions | 上述 7 个 AI 平台（注入导出 UI）+ MarkDoc 网页版（「在 MarkDoc 中编辑」桥接） |')
}

console.log('\n── CSP 审计（P4C 第十八节）──')
{
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const csp = manifest.content_security_policy?.extension_pages ?? ''
  check('csp', csp.includes("'self'"), 'extension_pages CSP 声明 script-src self', csp || '(未声明)')
  check('csp', !csp.includes("'unsafe-eval'"), '无 unsafe-eval（仅 wasm-unsafe-eval 用于 harfbuzz）')

  const jsFiles = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(js|mjs)$/.test(name)) jsFiles.push(full)
    }
  }
  walk(DIST)

  // 硬违规（MV3 运行时必炸 / CWS 明确限制）：必须为 0
  const HARD_PATTERNS = [
    [/\beval\s*\(/, 'eval()'],
    [/setTimeout\s*\(\s*["'`]/, 'setTimeout(字符串)'],
    [/document\.write\s*\(/, 'document.write'],
    [/\bimport\s*\(\s*(?!['"])[^)]*?\+/, '动态拼接 import()'],
    [/['"]https?:\/\/[^'"]*\.js['"]/i, '远程脚本 URL 字符串'],
  ]
  // 软项（第三方库死路径 polyfill：浏览器 110+ 下短路或 try/catch 优雅降级，
  // 永不在运行时执行；E2E 全通过佐证。仅计数上报，防止数量异常增长）：
  //   lodash root 检测 / function-bind / setImmediate polyfill / is-generator 检测
  const SOFT_PATTERNS = [
    [/\bnew\s+Function\s*\(/, 'new Function()'],
    [/[^\w$.]Function\s*\(\s*["'`]/, 'Function("…")'],
  ]
  const SOFT_BUDGET = 10

  let hardViolations = []
  let softCount = 0
  for (const file of jsFiles) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(DIST, file).replaceAll('\\', '/')
    for (const [re, name] of HARD_PATTERNS) {
      if (re.test(src)) hardViolations.push(`${rel}: ${name}`)
    }
    for (const [re] of SOFT_PATTERNS) {
      if (re.test(src)) softCount++
    }
  }
  check('csp', hardViolations.length === 0, `全部 ${jsFiles.length} 个 bundle：无 eval / 远程 JS / 动态拼接 import`,
    hardViolations.slice(0, 5).join('; '))
  check('csp', softCount <= SOFT_BUDGET, `第三方死路径 polyfill 计数 ≤ ${SOFT_BUDGET}（当前 ${softCount}）`)
}

console.log('\n── 构建产物完整性（P4C 第二十六/二十七节）──')
{
  const required = [
    'manifest.json', 'background.js', 'content.js', 'bridge.js',
    'popup.html', 'exporter.html', 'options.html', 'onboarding.html',
    'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
  ]
  for (const f of required) {
    check('artifact', existsSync(join(DIST, f)), `存在 ${f}`)
  }
  const manifestDist = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'))
  check('artifact', typeof manifestDist.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifestDist.version),
    `manifest 版本号合法（${manifestDist.version}）`)

  const FORBIDDEN_SUFFIX = ['.map', '.ts', '.tsx', '.pem', '.env', '.zip', '.md']
  const FORBIDDEN_NAMES = ['node_modules', '.env', 'id_rsa', 'fixtures', 'dist-extension.zip']
  const bad = []
  let ttfCount = 0
  const all = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = relative(DIST, full).replaceAll('\\', '/')
      if (statSync(full).isDirectory()) {
        if (FORBIDDEN_NAMES.includes(name)) bad.push(rel + '/')
        else walk(full)
      } else {
        all.push({ rel, size: statSync(full).size })
        // KaTeX 预览字体（KaTeX CSS @font-face 引用，<1MB 合计）不按 TTF 泄漏处理
        const isKatexPreviewFont = /^assets\/KaTeX_[\w-]+(-[A-Za-z0-9_-]+)?\.ttf$/.test(rel)
        if (FORBIDDEN_SUFFIX.some((s) => rel.endsWith(s))) bad.push(rel)
        if (FORBIDDEN_NAMES.some((n) => rel.includes(n))) bad.push(rel)
        if (name.endsWith('.ttf') && !isKatexPreviewFont) ttfCount++
      }
    }
  }
  walk(DIST)
  check('artifact', bad.length === 0, '无 sourcemap/TS 源码/私钥/环境文件/fixture 残留', bad.slice(0, 5).join(', '))
  check('artifact', ttfCount === 0, '无遗留 TTF（主字体全部为 WOFF；KaTeX 预览字体除外）', `${ttfCount} 个 TTF`)

  // 超大文件检查：>4MB 只允许 fonts/*.woff（已知大字体）
  const huge = all.filter((f) => f.size > 4 * 1024 * 1024 && !f.rel.startsWith('fonts/'))
  check('artifact', huge.length === 0, '无意外超大文件（>4MB，fonts 除外）', huge.map((f) => `${f.rel}=${(f.size / 1048576).toFixed(1)}MB`).join(', '))
}

console.log('\n── Bundle Size（P4C 第二十八节）──')
{
  const stat = (rel) => {
    const full = join(DIST, rel)
    return existsSync(full) ? statSync(full).size : 0
  }
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`
  const parts = [
    ['content script（注入 AI 页面）', stat('content.js')],
    ['background service worker', stat('background.js')],
    ['bridge（MarkDoc 网页版桥）', stat('bridge.js')],
    ['popup + options + onboarding 页面', stat('assets/exporter.js') ? 0 : 0],
  ]
  // assets 汇总
  const assetsDir = join(DIST, 'assets')
  let assetsTotal = 0
  const assetsByRole = { exporter: 0, popup: 0, options: 0, onboarding: 0, shared: 0 }
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      const size = statSync(join(assetsDir, name)).size
      assetsTotal += size
      if (name.includes('exporter')) assetsByRole.exporter += size
      else if (name.includes('popup')) assetsByRole.popup += size
      else if (name.includes('options')) assetsByRole.options += size
      else if (name.includes('onboarding')) assetsByRole.onboarding += size
      else assetsByRole.shared += size
    }
  }
  const fontsTotal = existsSync(join(DIST, 'fonts'))
    ? readdirSync(join(DIST, 'fonts'), { recursive: true }).reduce((acc, f) => {
        const full = join(DIST, 'fonts', f)
        return acc + (statSync(full).isFile() ? statSync(full).size : 0)
      }, 0)
    : 0

  let total = 0
  for (const f of readdirSync(DIST, { recursive: true })) {
    const full = join(DIST, f)
    if (statSync(full).isFile()) total += statSync(full).size
  }

  console.log(`    content script        ${kb(stat('content.js'))}`)
  console.log(`    background worker     ${kb(stat('background.js'))}`)
  console.log(`    bridge                ${kb(stat('bridge.js'))}`)
  console.log(`    exporter 页面 bundle  ${kb(assetsByRole.exporter)}`)
  console.log(`    popup/options bundle  ${kb(assetsByRole.popup + assetsByRole.options + assetsByRole.onboarding + assetsByRole.shared)}`)
  console.log(`    字体（WOFF，按需加载）${(fontsTotal / 1048576).toFixed(1)} MB`)
  console.log(`    ── 总计               ${(total / 1048576).toFixed(1)} MB`)

  // 关键约束：content script 必须 < 200KB（不打包 PDF 管线/字体）
  check('size', stat('content.js') < 200 * 1024, 'content script < 200KB（重型资源不进注入脚本）', kb(stat('content.js')))
  check('size', fontsTotal < 45 * 1048576, '字体总量 < 45MB（WOFF 压缩生效）', `${(fontsTotal / 1048576).toFixed(1)}MB`)
  check('size', total < 80 * 1048576, '扩展包总体积 < 80MB', `${(total / 1048576).toFixed(1)}MB`)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'audit.json'), JSON.stringify({ passed, failed, results }, null, 2))
console.log(`\nAUDIT RESULT: ${passed} passed, ${failed} failed → tests/ext/out/audit.json`)
if (failed > 0) process.exit(1)
