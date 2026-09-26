import { getSupabase } from './client'
import { getAuthUser } from './auth'
import type { ExportFormat } from './quota'

/**
 * 云端历史：登录用户每次导出成功后异步保存（不阻塞导出，需求非功能 §2）。
 * 匿名记录不进云端（留在本地 localStorage），注册后由历史页提供
 * "将本地记录保存到账号"迁移（M2 交付）。
 * 写入失败静默：不影响导出结果，仅在控制台留痕。
 */
export async function saveCloudHistory(params: {
  format: ExportFormat
  title: string
  contentMd: string
  options: Record<string, unknown>
}): Promise<void> {
  try {
    const user = await getAuthUser()
    if (!user) return
    const supabase = await getSupabase()
    await supabase.from('histories').insert({
      user_id: user.id,
      title: params.title.slice(0, 120),
      content_md: params.contentMd,
      options: params.options,
      format: params.format,
      status: 'ok',
    })
  } catch (err) {
    console.warn('[MarkDoc] 云端历史保存失败（不影响导出）', err)
  }
}

/** 账号注销前导出自己的全部历史（需求 §3.4：用户可导出 JSON） */
export async function exportMyHistoryJson(): Promise<string | null> {
  try {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('histories')
      .select('id, title, content_md, options, format, created_at')
      .order('created_at', { ascending: false })
    if (error || !data) return null
    return JSON.stringify({ exportedAt: new Date().toISOString(), histories: data }, null, 2)
  } catch {
    return null
  }
}
