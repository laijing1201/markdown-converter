import { SUPABASE_ANON_KEY, SUPABASE_URL, accountEnabled } from './config'
import { getSupabase } from './client'
import { getDeviceId, getFingerprint } from './fingerprint'

/**
 * 导出票据 —— 防白嫖的服务端执法点（详见 supabase/functions/export-ticket）。
 * 前端在执行导出前必须先取得票据；匿名免费次数用完返回 QUOTA_EXCEEDED，
 * 由调用方弹出注册引导。剩余次数缓存在 localStorage 供工具栏展示。
 */

export type ExportFormat = 'docx' | 'pdf'

export type TicketResult =
  | { ok: true; ticket: string; kind: 'anon' | 'user'; remaining: Remaining | null }
  | { ok: false; reason: 'QUOTA_EXCEEDED' | 'DISABLED' | 'AUTH_REQUIRED' | 'NETWORK' | 'MAINTENANCE' | 'SERVER'; message: string; remaining?: Remaining }

export interface Remaining {
  deviceLeft?: number | null
  ipLeft?: number | null
}

const QUOTA_CACHE_KEY = 'markdoc.quota.v1'

export function cachedRemaining(): Remaining | null {
  try {
    const raw = localStorage.getItem(QUOTA_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Remaining) : null
  } catch {
    return null
  }
}

function cacheRemaining(r: Remaining | null): void {
  try {
    if (r) localStorage.setItem(QUOTA_CACHE_KEY, JSON.stringify(r))
    else localStorage.removeItem(QUOTA_CACHE_KEY)
  } catch { /* ignore */ }
}

export async function requestExportTicket(
  format: ExportFormat,
  opts: { checkOnly?: boolean; source?: 'web' | 'extension' } = {},
): Promise<TicketResult> {
  if (!accountEnabled) return { ok: true, ticket: 'local', kind: 'anon', remaining: null }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  }
  try {
    const supabase = await getSupabase()
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`
  } catch { /* 匿名继续 */ }

  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/export-ticket`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceId: getDeviceId(),
        fingerprint: getFingerprint(),
        format,
        source: opts.source ?? 'web',
        checkOnly: opts.checkOnly === true,
      }),
    })
  } catch {
    return { ok: false, reason: 'NETWORK', message: '网络错误，请检查网络后重试' }
  }

  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    ticket?: string | null
    kind?: 'anon' | 'user'
    error?: string
    message?: string
    remaining?: Remaining
  }

  if (res.ok && body.ok) {
    cacheRemaining(body.remaining ?? null)
    return {
      ok: true,
      ticket: body.ticket ?? 'check',
      kind: body.kind ?? 'anon',
      remaining: body.remaining ?? null,
    }
  }

  const reason =
    res.status === 402 ? 'QUOTA_EXCEEDED'
    : res.status === 403 ? 'DISABLED'
    : res.status === 401 ? 'AUTH_REQUIRED'
    : res.status === 503 ? 'MAINTENANCE'
    : 'SERVER'
  if (body.remaining) cacheRemaining(body.remaining)
  return {
    ok: false,
    reason,
    message: body.message ?? '免费试用已结束，请注册后继续使用。',
    remaining: body.remaining,
  }
}

/** 工具栏展示用：未登录 + 启用账号体系时拉取剩余次数（不消耗配额） */
export async function refreshRemaining(format: ExportFormat = 'pdf'): Promise<Remaining | null> {
  if (!accountEnabled) return null
  const res = await requestExportTicket(format, { checkOnly: true })
  return res.ok ? res.remaining : (res.remaining ?? cachedRemaining())
}
