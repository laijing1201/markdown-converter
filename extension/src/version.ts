/**
 * 扩展版本策略（P4C 第二十五节）：
 *   - Web：package.json version（当前 1.1.0）
 *   - Extension：EXT_VERSION（manifest.json version 保持一致）
 *   - Adapter：独立小版本，DOM 适配改动只升 adapter 版本
 * 诊断信息必须带全三类版本。
 */

export const EXT_VERSION = '0.1.0'

/** 平台 Adapter 版本（selector/提取逻辑改版时递增） */
export const ADAPTER_VERSIONS: Record<string, number> = {
  chatgpt: 1,
  deepseek: 1,
  claude: 1,
  gemini: 1,
  kimi: 1,
}

export function adapterVersionOf(id: string): number {
  return ADAPTER_VERSIONS[id] ?? 0
}

/** 快速设置 schema 版本（P4C 第三十四节：升级 migration 用） */
export const SETTINGS_SCHEMA_VERSION = 2
