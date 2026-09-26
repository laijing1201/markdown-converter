import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, accountEnabled } from './config'

/**
 * 惰性加载的 Supabase 客户端：动态 import 使 supabase-js 只在启用账号体系时
 * 才进入构建产物（未配置时主包零增量）。多调用共享同一实例。
 */
let clientPromise: Promise<SupabaseClient> | null = null

export function getSupabase(): Promise<SupabaseClient> {
  if (!accountEnabled) return Promise.reject(new Error('account disabled'))
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true, // 邮箱验证/重置链接回跳时自动接管
        },
      }),
    )
  }
  return clientPromise
}
