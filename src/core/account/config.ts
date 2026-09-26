/**
 * 账号体系配置开关。
 *
 * 未配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 时 accountEnabled = false，
 * 全站行为与无账号版本完全一致（导出不再要票据）——保证：
 *   - 现有部署（GitHub Pages 无环境变量）零行为变化
 *   - 单元测试 / e2e 无需后端即可运行
 * 配置后：导出前先向 Edge Function 申请票据（服务端计次），未登录用完免费
 * 次数会被拦截并弹出注册引导。
 */
/** Vite 的 import.meta.env 在非 Vite 运行时（tsx 单测）不存在，统一安全读取 */
const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>

export const SUPABASE_URL: string = env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY ?? ''

export const accountEnabled: boolean = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** 云端历史是否启用（依赖账号体系） */
export const cloudHistoryEnabled = accountEnabled
