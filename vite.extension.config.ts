import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * 扩展页面构建（popup.html / exporter.html）。
 * background.js / content.js / bridge.js 由 scripts/build-extension.mjs
 * 用 esbuild 单独打包（MV3 内容脚本需单文件 IIFE）。
 *
 * base = '/'：扩展页面里 '/fonts/...' 解析为 chrome-extension://<id>/fonts/...，
 * 与 core/pdf/fonts.ts 的字体加载约定一致。
 */
export default defineConfig({
  root: fileURLToPath(new URL('./extension', import.meta.url)),
  base: '/',
  // 共享仓库根目录 .env：账号体系（VITE_SUPABASE_*）网站与扩展读同一份配置
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: 'public',
  define: {
    // 扩展包内字体为 WOFF v1（构建期转换，运行时解压回 TTF；WOFF2 与 MV3 CSP 冲突）
    __WOFF_FONTS__: 'true',
  },
  build: {
    outDir: fileURLToPath(new URL('./dist-extension', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome110',
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./extension/popup.html', import.meta.url)),
        exporter: fileURLToPath(new URL('./extension/exporter.html', import.meta.url)),
        options: fileURLToPath(new URL('./extension/options.html', import.meta.url)),
        onboarding: fileURLToPath(new URL('./extension/onboarding.html', import.meta.url)),
      },
    },
  },
})
