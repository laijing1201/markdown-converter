// ═══════════════════════════════════════════════════════════════════════════
// 导出票据端点 —— 防白嫖的服务端执法点
//
//   POST /functions/v1/export-ticket
//   body: { deviceId, fingerprint, format: 'docx'|'pdf', source: 'web'|'extension', checkOnly? }
//   auth: 可选 Bearer <supabase access token>（登录用户）
//
//   登录用户：校验账号状态（disabled → 403）；默认不限次（system_configs 可改）
//   匿名用户：设备终身 free_full_uses 次 + 同 IP 每日 ip_daily_extra 次
//   通过 → 写 usage_logs（计数权威），签发 5 分钟 HMAC 票据
//   超限 → 402 { error: 'QUOTA_EXCEEDED', remaining }
//
//   checkOnly: true 时只查询不计数（前端展示剩余次数用）
//
// 部署：supabase functions deploy export-ticket
// 密钥：supabase secrets set TICKET_HMAC_SECRET=... IP_HASH_PEPPER=...
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const TICKET_TTL_MS = 5 * 60 * 1000

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function issueTicket(subject: string, format: string, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify({ sub: subject, fmt: format, exp: Date.now() + TICKET_TTL_MS }))
  const sig = await hmacSign(payload, secret)
  return `${payload}.${sig}`
}

interface QuotaInfo {
  deviceLeft: number | null
  ipLeft: number | null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ticketSecret = Deno.env.get('TICKET_HMAC_SECRET') ?? ''
  const ipPepper = Deno.env.get('IP_HASH_PEPPER') ?? 'markdoc-ip-pepper'
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { deviceId?: string; fingerprint?: string; format?: string; source?: string; checkOnly?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'BAD_REQUEST' }, 400)
  }
  const format = body.format === 'pdf' ? 'pdf' : 'docx'
  const source = body.source === 'extension' ? 'extension' : 'web'
  const checkOnly = body.checkOnly === true

  // 请求方真实 IP（Supabase 边缘位于反代后）→ 只存哈希
  const rawIp =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ??
    'unknown'
  const ipHash = (await sha256Hex(rawIp + ipPepper)).slice(0, 32)

  // 系统配置
  const { data: configRows } = await db.from('system_configs').select('key, value')
  const cfg = new Map<string, unknown>((configRows ?? []).map((r) => [r.key, r.value]))
  const freeFullUses = Number(cfg.get('free_full_uses') ?? 1)
  const ipDailyExtra = Number(cfg.get('ip_daily_extra') ?? 3)
  const registeredUnlimited = cfg.get('registered_unlimited') !== false
  const maintenanceMode = cfg.get('maintenance_mode') === true

  if (maintenanceMode) return json({ error: 'MAINTENANCE', message: '系统维护中，请稍后再试' }, 503)

  // ── 登录用户 ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data: userData } = await db.auth.getUser(token)
    const user = userData?.user
    if (user) {
      const { data: profile } = await db.from('profiles').select('status, must_change_password, export_count').eq('id', user.id).single()
      if (!profile || profile.status === 'deleted') return json({ error: 'AUTH_REQUIRED' }, 401)
      if (profile.status === 'disabled') return json({ error: 'DISABLED', message: '账号已被禁用，请联系管理员' }, 403)

      if (!checkOnly) {
        await db.from('usage_logs').insert({ user_id: user.id, ip_hash: ipHash, kind: 'user', format, source })
        await db.from('profiles').update({ export_count: (profile.export_count ?? 0) + 1, last_login_at: new Date().toISOString() }).eq('id', user.id)
      }
      const unlimited = registeredUnlimited
      const ticket = checkOnly ? null : await issueTicket(`u:${user.id}`, format, ticketSecret)
      return json({
        ok: true,
        ticket,
        kind: 'user',
        remaining: unlimited ? null : { userLeft: Math.max(0, 100 - (profile.export_count ?? 0)) },
      })
    }
    // Token 无效 → 按匿名继续（前端会话过期场景）
  }

  // ── 匿名用户 ──────────────────────────────────────────────────────────────
  const deviceId = (body.deviceId ?? '').slice(0, 64)
  if (!deviceId) return json({ error: 'BAD_REQUEST', message: '缺少设备标识' }, 400)
  const fingerprintHash = body.fingerprint ? (await sha256Hex(body.fingerprint + ipPepper)).slice(0, 32) : null

  // 设备终身计数
  const { data: device } = await db
    .from('anon_devices')
    .select('export_count')
    .eq('device_id', deviceId)
    .single()
  const deviceUsed = device?.export_count ?? 0

  // 同 IP 每日计数（今日 0 点起）
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const { count: ipToday } = await db
    .from('usage_logs')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('kind', 'anon')
    .gte('created_at', dayStart.toISOString())
  const ipUsed = ipToday ?? 0

  const deviceLeft = Math.max(0, freeFullUses - deviceUsed)
  const ipLeft = Math.max(0, ipDailyExtra - ipUsed)
  const quota: QuotaInfo = { deviceLeft, ipLeft }

  if (checkOnly) return json({ ok: true, kind: 'anon', remaining: quota, ticket: null })

  if (deviceLeft <= 0 || ipLeft <= 0) {
    return json(
      {
        error: 'QUOTA_EXCEEDED',
        message: '免费试用已结束，请注册后继续使用。',
        remaining: quota,
      },
      402,
    )
  }

  if (!ticketSecret) return json({ error: 'SERVER_MISCONFIGURED', message: '服务端未配置票据密钥' }, 500)

  await db.from('anon_devices').upsert({
    device_id: deviceId,
    fingerprint_hash: fingerprintHash,
    export_count: deviceUsed + 1,
    last_seen_at: new Date().toISOString(),
  })
  await db.from('usage_logs').insert({
    device_id: deviceId,
    fingerprint_hash: fingerprintHash,
    ip_hash: ipHash,
    kind: 'anon',
    format,
    source,
  })

  const ticket = await issueTicket(`d:${deviceId}`, format, ticketSecret)
  return json({ ok: true, ticket, kind: 'anon', remaining: { deviceLeft: deviceLeft - 1, ipLeft: ipLeft - 1 } })
})
