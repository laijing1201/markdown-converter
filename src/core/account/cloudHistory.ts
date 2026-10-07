import { getSupabase } from './client'
import { getAuthUser } from './auth'
import type { ExportFormat } from './quota'
import { loadHistory, makeTitle, type HistoryEntry } from '../history'

/**
 * 云端历史：历史跟随账号，仅登录后产生。编辑自动保存（草稿）与导出记录
 * 同列表展示，但 10 条上限分开计算——各保留最近 10 条，频繁编辑不会挤掉
 * 导出记录（上限由数据库触发器 histories_trim_cap 在每次插入后按类别裁剪）。
 * 退出登录后列表不可见、不再产生记录；重新登录即恢复。
 * 写入失败静默：不影响导出 / 编辑，仅在控制台留痕。
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

/**
 * 登录后编辑自动保存：以草稿形式入云端历史（与导出记录同列表，草稿类最多 10 条）。
 * 只与最新一条草稿内容比对去重——页面刷新 / 多标签页不产生重复条目，
 * 且最新一条若是导出记录也不受影响。
 * 返回是否已保存（未登录 / 内容为空 / 与最新重复视为已处理，返回 true）。
 */
export async function saveCloudDraft(content: string): Promise<boolean> {
  try {
    if (!content.trim()) return true
    const user = await getAuthUser()
    if (!user) return false
    const supabase = await getSupabase()
    const { data: newestDraft } = await supabase
      .from('histories')
      .select('content_md')
      .eq('format', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (newestDraft?.content_md === content) return true
    const { error } = await supabase.from('histories').insert({
      user_id: user.id,
      title: makeTitle(content).slice(0, 120),
      content_md: content,
      options: {},
      format: 'draft',
      status: 'ok',
    })
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.warn('[MarkDoc] 云端历史自动保存失败（不影响编辑）', err)
    return false
  }
}

/**
 * 把本机残留的历史条目（升级前存在 localStorage 的旧记录）导入当前账号，
 * 保留原始时间；超过 10 条的部分由服务端触发器按时间裁掉（最旧的先入先裁）。
 * 返回成功导入的条数；失败抛错由调用方提示。
 */
export async function importLocalHistoryToCloud(): Promise<number> {
  const user = await getAuthUser()
  if (!user) throw new Error('请先登录')
  const entries: HistoryEntry[] = loadHistory()
  if (entries.length === 0) return 0
  const supabase = await getSupabase()
  // 按时间从旧到新逐条插入：与云端记录合并后，裁剪保留的是真正「最近」的 10 条
  const ordered = [...entries].sort((a, b) => a.time - b.time)
  let imported = 0
  for (const entry of ordered) {
    const { error } = await supabase.from('histories').insert({
      user_id: user.id,
      title: (entry.title || makeTitle(entry.content)).slice(0, 120),
      content_md: entry.content,
      options: {},
      format: 'draft',
      status: 'ok',
      created_at: new Date(entry.time).toISOString(),
    })
    if (error) throw new Error(error.message)
    imported += 1
  }
  return imported
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
