/**
 * 账号体系配置开关。
 *
 * 产品决策（2026-10）：全站免费开放，不再启用登录 / 注册 / 导出计次——
 * 打开即用、不限次数，历史记录只保存在浏览器本地（最近 10 份，见 core/history.ts）。
 * 因此 FREE_ACCESS_OPEN = true 时即使部署配置了 Supabase 环境变量也保持匿名模式，
 * 全站行为与无账号版本完全一致（导出不申请票据、历史走本地、登录入口不渲染）。
 * 如需恢复账号体系（登录 + 云端历史 + 服务端计次），把 FREE_ACCESS_OPEN 改回 false 即可。
 */
/** Vite 的 import.meta.env 在非 Vite 运行时（tsx 单测）不存在，统一安全读取 */
const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>

export const SUPABASE_URL: string = env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY ?? ''

/** 免费开放总开关：true = 不设登录，全站匿名可用（当前产品形态） */
export const FREE_ACCESS_OPEN = true

export const accountEnabled: boolean = !FREE_ACCESS_OPEN && Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** 云端历史是否启用（依赖账号体系） */
export const cloudHistoryEnabled = accountEnabled
