/**
 * 构建期注入的版本信息（见 vite.config.ts define）。
 * 测试环境（tsx / node）没有 define，回退到占位值。
 */
declare const __APP_VERSION__: string | undefined
declare const __BUILD_COMMIT__: string | undefined

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev'

export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : ''

/** 低调展示用：v1.1.0 · build abc1234（无 commit 时仅显示版本号） */
export const VERSION_LABEL: string = BUILD_COMMIT
  ? `v${APP_VERSION} · build ${BUILD_COMMIT}`
  : `v${APP_VERSION}`
