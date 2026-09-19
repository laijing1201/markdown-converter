import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

/**
 * Electron 插件按命令启用：
 *   - dev / dev:electron / dev:exe / build:electron / build:exe → 含 Electron
 *   - dev:web / build / build:web → 纯 Web（GitHub Pages 部署用）
 * 可用 MARKDOC_TARGET=web|electron 显式覆盖（CI / 脚本使用）。
 */
function shouldIncludeElectron(): boolean {
  const forced = process.env.MARKDOC_TARGET
  if (forced === 'electron') return true
  if (forced === 'web') return false
  const lifecycle = process.env.npm_lifecycle_event ?? ''
  return /^(dev|dev:electron|dev:exe|build:electron|build:exe)$/.test(lifecycle)
}

/** GitHub Actions / 本地构建回退到 git；拿不到则空串（只显示版本号） */
function resolveCommit(): string {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

const plugins = [react()]

if (shouldIncludeElectron()) {
  plugins.push(
    electron([
      {
        entry: 'electron/main.ts',
      },
      {
        // preload 变更时只刷新渲染进程，不重启主进程。
        // ESM preload 必须以 .mjs 结尾（.js 会被 Electron 按 CJS 解析后报语法错误）
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            rollupOptions: {
              output: { entryFileNames: 'preload.mjs' },
            },
          },
        },
      },
    ]),
  )
}

export default defineConfig({
  // 相对路径同时兼容 GitHub Pages 子路径（/markdown-converter/）与 Electron file://
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_COMMIT__: JSON.stringify(resolveCommit()),
    // 网页版 / Electron 直接加载 TTF 字体；WOFF 仅用于浏览器扩展包
    __EXT_COMPRESSED_FONTS__: 'false',
  },
  plugins,
})
