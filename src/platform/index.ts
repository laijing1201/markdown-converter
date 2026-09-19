/**
 * 平台层唯一入口：
 *
 *   import { platform, capabilities } from '../platform'
 *
 * - capabilities：本端有什么能力（UI 据此显隐「桌面版功能」入口）
 * - platform：saveOrDownload / openMarkdownFile / saveMarkdownFile
 *
 * core 导出器只调用 platform.saveOrDownload(blob, filename)，
 * 不感知自己运行在浏览器还是 Electron。
 */

import type { PlatformAdapter } from './types'
import { detectPlatformCapabilities, getDesktopApi, type PlatformCapabilities } from './capabilities'
import { webAdapter } from './web'
import { electronAdapter } from './electron'

export type { PlatformAdapter } from './types'
export type { PlatformCapabilities, MarkdocDesktopApi } from './capabilities'
export { detectPlatformCapabilities, getDesktopApi } from './capabilities'

export const capabilities: PlatformCapabilities = detectPlatformCapabilities()

export const platform: PlatformAdapter = getDesktopApi() ? electronAdapter : webAdapter

/** 桌面增强版下载入口（GitHub Releases）。Web 上只作为「增强选项」露出，不是主 CTA。 */
export const DESKTOP_DOWNLOAD_URL = 'https://github.com/laijing1201/markdown-converter/releases/latest'
