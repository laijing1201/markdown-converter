/**
 * 扩展打包（P4C 第二十六节）：
 *
 *   npm run build:extension && npm run package:extension
 *   → artifacts/MarkDoc-Extension-v<version>.zip
 *
 *   - zip 根目录直接包含 manifest.json（可直接上传 Chrome Web Store / 解压测试）；
 *   - 打包后做 unpack 验证：重新解压并核对关键文件 + 与源目录逐字节比对；
 *   - 输出体积报告。
 */

import JSZip from 'jszip'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist-extension')
const ARTIFACTS = join(ROOT, 'artifacts')

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('❌ 缺少 dist-extension/manifest.json —— 请先运行 npm run build:extension')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'))
const version = manifest.version
const OUT_DIR = ARTIFACTS
const OUT_ZIP = join(OUT_DIR, `MarkDoc-Extension-v${version}.zip`)
mkdirSync(OUT_DIR, { recursive: true })

// ── 收集文件 ─────────────────────────────────────────────────────────────────

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else files.push({ rel: relative(DIST, full).replaceAll('\\', '/'), full })
  }
}
walk(DIST)

console.log(`打包 ${files.length} 个文件 → ${OUT_ZIP}`)
const zip = new JSZip()
for (const f of files) {
  zip.file(f.rel, readFileSync(f.full))
}
const t0 = Date.now()
const content = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
})
writeFileSync(OUT_ZIP, content)
console.log(`✓ zip ${(content.length / 1048576).toFixed(1)} MB（源 ${(files.reduce((a, f) => a + statSync(f.full).size, 0) / 1048576).toFixed(1)} MB，${((Date.now() - t0) / 1000).toFixed(1)}s）`)

// ── Unpack 验证 ──────────────────────────────────────────────────────────────

console.log('\n=== Unpack 验证 ===')
const verify = new JSZip()
await verify.loadAsync(content)
const names = Object.keys(verify.files)

const REQUIRED = [
  'manifest.json', 'background.js', 'content.js', 'bridge.js',
  'popup.html', 'exporter.html', 'options.html', 'onboarding.html',
  'icons/icon16.png', 'icons/icon128.png',
]
let failed = 0
for (const req of REQUIRED) {
  if (!names.includes(req)) {
    console.error(`  ✗ zip 缺少 ${req}`)
    failed++
  }
}
if (!names.some((n) => /^fonts\/.+\.woff$/.test(n))) {
  console.error('  ✗ zip 缺少 WOFF 字体')
  failed++
}
// manifest 必须在 zip 根目录（不能多套一层 dist-extension/）
if (!names.includes('manifest.json') || names.includes('dist-extension/manifest.json')) {
  console.error('  ✗ manifest.json 不在 zip 根目录')
  failed++
}

// 逐字节比对抽样（manifest / content / 一个字体）
for (const sample of ['manifest.json', 'content.js', 'background.js']) {
  const inZip = await verify.files[sample].async('uint8array')
  const onDisk = readFileSync(join(DIST, sample))
  if (Buffer.compare(Buffer.from(inZip), onDisk) !== 0) {
    console.error(`  ✗ ${sample} 内容不一致`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\nPACKAGE VERIFY FAILED: ${failed}`)
  process.exit(1)
}
console.log(`  ✓ zip 根目录含 manifest.json（v${version}）`)
console.log(`  ✓ 关键文件齐全（${REQUIRED.length} 项 + ${names.length} 总文件）`)
console.log(`  ✓ 抽样逐字节比对一致`)

writeFileSync(join(OUT_DIR, 'package-info.json'), JSON.stringify({
  version,
  zip: OUT_ZIP,
  zipBytes: content.length,
  files: names.length,
  packagedAt: new Date().toISOString(),
}, null, 2))
console.log(`\n✓ artifacts/MarkDoc-Extension-v${version}.zip`)
