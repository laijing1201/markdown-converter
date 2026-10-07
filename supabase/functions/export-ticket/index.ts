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
import { getActiveUser } from '../_shared/activeUser.ts'

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
    if (!body || typeof body !== 'object') throw new Error('Invalid body')
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

  if (!checkOnly && !ticketSecret) return json({ error: 'SERVER_MISCONFIGURED', message: '服务端未配置票据密钥' }, 500)

  const hasAuth = Boolean(req.headers.get('Authorization'))
  const user = hasAuth ? await getActiveUser(req) : null
  if (hasAuth && !user) return json({ error: 'AUTH_REQUIRED', message: '会话已失效，请重新登录' }, 401)
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 64) : ''
  if (!user && !deviceId) return json({ error: 'BAD_REQUEST', message: '缺少设备标识' }, 400)
  const fingerprintHash = typeof body.fingerprint === 'string'
    ? (await sha256Hex(body.fingerprint + ipPepper)).slice(0, 32) : null

  const { data: result, error } = await db.rpc('consume_export_quota', {
    p_user_id: user?.id ?? null,
    p_device_id: deviceId,
    p_fingerprint: fingerprintHash,
    p_ip_hash: ipHash,
    p_format: format,
    p_source: source,
    p_check_only: checkOnly,
  })
  if (error || !result) return json({ error: 'SERVER', message: '额度查询失败，请稍后重试' }, 500)
  if (!result.ok) {
    const status = result.error === 'QUOTA_EXCEEDED' ? 402
      : result.error === 'DISABLED' ? 403 : result.error === 'AUTH_REQUIRED' ? 401
      : result.error === 'MAINTENANCE' ? 503 : 500
    return json(result, status)
  }
  const ticket = checkOnly ? null : await issueTicket(user ? `u:${user.id}` : `d:${deviceId}`, format, ticketSecret)
  return json({ ...result, ticket })
})
