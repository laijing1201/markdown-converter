// ═══════════════════════════════════════════════════════════════════════════
// 自助注册端点 —— 绕开故障的邮件验证码链路
//
//   POST /functions/v1/auth-signup
//   body: { email, password, source?: 'web'|'extension' }
//   auth: 仅需 anon key（匿名注册）
//
//   背景（2026-10-23）：GoTrue /auth/v1/signup 在服务端发确认邮件环节超时（504），
//   邮箱验证码永远无法送达。本端点用 service role 直接创建「已确认」用户，
//   注册即完成，前端随后走密码登录建立会话（注册即登录，无需邮件）。
//
//   200 { ok: true, userId }        创建成功
//   400 { error: 'BAD_REQUEST' }    邮箱/密码不合法
//   409 { error: 'EMAIL_TAKEN' }    邮箱已注册
//   429 { error: 'RATE_LIMITED' }   同 IP 每日注册次数用完（signup_ip_daily）
//
// 部署：supabase functions deploy auth-signup --no-verify-jwt
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAILY_IP_LIMIT = 5

function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '密码至少 8 位，包含字母和数字'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '密码至少 8 位，包含字母和数字'
  if (pw.length > 72) return '密码过长（最多 72 位）'
  return null
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ipPepper = Deno.env.get('IP_HASH_PEPPER') ?? 'markdoc-ip-pepper'
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { email?: string; password?: string; source?: string }
  try {
    body = await req.json()
    if (!body || typeof body !== 'object') throw new Error('Invalid body')
  } catch {
    return json({ error: 'BAD_REQUEST', message: '请求格式不正确' }, 400)
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = body.password
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: 'BAD_REQUEST', message: '邮箱格式不正确' }, 400)
  }
  const pwErr = passwordProblem(password)
  if (pwErr) return json({ error: 'BAD_REQUEST', message: pwErr }, 400)

  // IP 频控（与 export-ticket 同源：反代后取真实 IP，只存哈希）
  const rawIp =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ??
    'unknown'
  const ipHash = (await sha256Hex(rawIp + ipPepper)).slice(0, 32)
  const today = new Date().toISOString().slice(0, 10)
  const { data: row } = await db.from('signup_ip_daily').select('day, count').eq('ip_hash', ipHash).maybeSingle()
  if (row && String(row.day) === today && row.count >= DAILY_IP_LIMIT) {
    return json({ error: 'RATE_LIMITED', message: '注册过于频繁，请明天再试或联系管理员' }, 429)
  }
  await db.from('signup_ip_daily').upsert({
    ip_hash: ipHash,
    day: today,
    count: row && String(row.day) === today ? row.count + 1 : 1,
  })

  // 创建「已确认」用户：跳过邮件验证（GoTrue 邮件链路故障期的替代注册路径）
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: body.source === 'extension' ? 'extension' : 'web' },
  })
  if (error) {
    const err = error as { status?: number; code?: string; message?: string }
    const msg = err.message ?? ''
    if (err.status === 422 || err.code === 'email_exists' || /already (been )?registered|already exists/i.test(msg)) {
      return json({ error: 'EMAIL_TAKEN', message: '该邮箱已注册，请直接登录' }, 409)
    }
    if (err.status === 429 || /rate/i.test(msg)) {
      return json({ error: 'RATE_LIMITED', message: '注册过于频繁，请稍后再试' }, 429)
    }
    if (/password/i.test(msg)) return json({ error: 'BAD_REQUEST', message: '密码至少 8 位，包含字母和数字' }, 400)
    if (/email/i.test(msg)) return json({ error: 'BAD_REQUEST', message: '邮箱格式不正确' }, 400)
    return json({ error: 'SERVER', message: '注册服务暂时不可用，请稍后重试' }, 500)
  }
  return json({ ok: true, userId: created?.user?.id ?? null })
})
