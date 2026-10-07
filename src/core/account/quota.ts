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

/**
 * 匿名免费次数的客户端兜底计次（按设备）。
 *
 * 服务端 export-ticket 是计次权威，但客户端此前存在绕过面（批量转换不申请票据），
 * 且服务端不可达时匿名用户没有可见的额度墙。这里在本地按 deviceId 记录已用次数：
 *   - 默认总额度 1 次（与服务端种子 free_full_uses=1 一致）
 *   - 服务端返回的剩余更多时（管理员调大额度）自动向上对齐，不会错杀
 *   - 服务端返回更少 / 超限 / 不可达时按本地与服务的较小值拦截
 * 清空浏览器存储会同时重置 deviceId 与本地计次，与「限设备」语义一致（IP 限额兜底）。
 */
const ANON_USES_KEY = 'markdoc.anon.uses.v1'
const ANON_FREE_DEFAULT = 1

interface AnonUseState {
  deviceId: string
  used: number
  total: number
}

function loadAnonState(): AnonUseState {
  const deviceId = getDeviceId()
  try {
    const raw = localStorage.getItem(ANON_USES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AnonUseState>
      if (parsed.deviceId === deviceId && typeof parsed.used === 'number' && parsed.used >= 0) {
        const total = typeof parsed.total === 'number' && parsed.total >= ANON_FREE_DEFAULT ? parsed.total : ANON_FREE_DEFAULT
        return { deviceId, used: Math.min(parsed.used, total), total }
      }
    }
  } catch { /* ignore */ }
  return { deviceId, used: 0, total: ANON_FREE_DEFAULT }
}

function saveAnonState(state: AnonUseState): void {
  try {
    localStorage.setItem(ANON_USES_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

/** 匿名用户本地剩余次数（0 表示本地额度已用完） */
function anonLocalLeft(): number {
  const s = loadAnonState()
  return Math.max(0, s.total - s.used)
}

/** 服务端剩余与本地剩余取较小值（任一方为空则取另一方） */
function mergeDeviceLeft(serverLeft: number | null | undefined, localLeft: number): number {
  if (serverLeft == null) return localLeft
  return Math.min(serverLeft, localLeft)
}

const ANON_BLOCK_MESSAGE = '免费试用已结束，请注册后继续使用。'

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
  let loggedIn = false
  try {
    const supabase = await getSupabase()
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`
      loggedIn = true
    }
  } catch { /* 匿名继续 */ }

  // ── 匿名：本地额度墙先行（不依赖服务端可达）────────────────────────────
  if (!loggedIn) {
    const localLeft = anonLocalLeft()
    if (!opts.checkOnly && localLeft <= 0) {
      const cached = cachedRemaining()
      const remaining = { deviceLeft: 0, ipLeft: cached?.ipLeft ?? null }
      cacheRemaining(remaining)
      return { ok: false, reason: 'QUOTA_EXCEEDED', message: ANON_BLOCK_MESSAGE, remaining }
    }
    if (opts.checkOnly && localLeft <= 0) {
      // 只查询也合并本地视图，保证徽标与墙一致
      const cached = cachedRemaining()
      return {
        ok: true,
        ticket: 'check',
        kind: 'anon',
        remaining: { deviceLeft: 0, ipLeft: cached?.ipLeft ?? null },
      }
    }
  }

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
    // 服务端不可达：匿名按本地剩余兜底（fail-closed），登录用户照旧报网络错误
    if (!loggedIn) {
      const localLeft = anonLocalLeft()
      return {
        ok: false,
        reason: localLeft <= 0 ? 'QUOTA_EXCEEDED' : 'NETWORK',
        message: localLeft <= 0 ? ANON_BLOCK_MESSAGE : '网络错误，请检查网络后重试',
        remaining: { deviceLeft: localLeft, ipLeft: null },
      }
    }
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
    if (!loggedIn && opts.checkOnly) {
      // 只查询：合并本地视图返回，不计次
      const merged = mergeDeviceLeft(body.remaining?.deviceLeft, anonLocalLeft())
      const remaining = { deviceLeft: merged, ipLeft: body.remaining?.ipLeft ?? null }
      cacheRemaining(remaining)
      return { ok: true, ticket: 'check', kind: body.kind ?? 'anon', remaining }
    }
    if (!loggedIn) {
      // 匿名成功：本地计次 +1；服务端总额度更大时向上对齐，剩余取两方较小值
      const state = loadAnonState()
      state.used += 1
      const serverLeft = body.remaining?.deviceLeft
      if (serverLeft != null && serverLeft + state.used > state.total) {
        state.total = serverLeft + state.used
      }
      saveAnonState(state)
      const merged = mergeDeviceLeft(serverLeft, Math.max(0, state.total - state.used))
      const remaining = { deviceLeft: merged, ipLeft: body.remaining?.ipLeft ?? null }
      cacheRemaining(remaining)
      return { ok: true, ticket: body.ticket ?? 'check', kind: body.kind ?? 'anon', remaining }
    }
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
  if (!loggedIn) {
    // 服务端明确超限：本地计次同步打满，保证墙的即时性与一致性
    if (reason === 'QUOTA_EXCEEDED') {
      const state = loadAnonState()
      state.used = state.total
      saveAnonState(state)
    }
    const localLeft = reason === 'QUOTA_EXCEEDED' ? 0 : anonLocalLeft()
    const remaining = {
      deviceLeft: mergeDeviceLeft(body.remaining?.deviceLeft, localLeft),
      ipLeft: body.remaining?.ipLeft ?? null,
    }
    cacheRemaining(remaining)
    return {
      ok: false,
      reason,
      message: body.message ?? ANON_BLOCK_MESSAGE,
      remaining,
    }
  }
  if (body.remaining) cacheRemaining(body.remaining)
  return {
    ok: false,
    reason,
    message: body.message ?? '免费试用已结束，请注册后继续使用。',
    remaining: body.remaining,
  }
}

/** 工具栏展示用：未登录 + 启用账号体系时拉取剩余次数（不消耗配额；匿名已并入本地额度视图） */
export async function refreshRemaining(format: ExportFormat = 'pdf'): Promise<Remaining | null> {
  if (!accountEnabled) return null
  const res = await requestExportTicket(format, { checkOnly: true })
  return res.ok ? res.remaining : (res.remaining ?? cachedRemaining())
}
