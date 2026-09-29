import { getSupabase } from './client'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

/**
 * 账号自助服务（注销 / 数据导出）—— 走 account-service Edge Function。
 * 修改密码 / 退出所有设备由 GoTrue 直接完成（auth.ts）。
 */

async function callAccountService<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const supabase = await getSupabase()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('未登录')
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/account-service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ action, ...body }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `请求失败（${res.status}）`)
  return json as T
}

/** 导出本人全部数据（JSON）：profiles + 全部云端历史 */
export async function exportAccountData(): Promise<void> {
  const bundle = await callAccountService<Record<string, unknown>>('export')
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `markdoc-账号数据导出-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** 注销账号：需输入邮箱二次确认；服务端删除 auth.users（级联删除云端历史） */
export async function deleteAccount(confirmEmail: string): Promise<void> {
  await callAccountService('delete', { confirm: confirmEmail.trim().toLowerCase() })
}
