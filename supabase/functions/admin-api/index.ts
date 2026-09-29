// ═══════════════════════════════════════════════════════════════════════════
// 管理员后台 API —— 甲方《管理员后台交付清单》服务端实现
//
//   POST /functions/v1/admin-api
//   body: { action: string, params?: object }
//   auth: Authorization: Bearer <admin session token>（login 除外）
//
// 安全模型：
//   - 管理员账号不开放注册：由超级管理员经 admins.create 创建（GoTrue createUser）
//   - 会话独立于用户会话：admin_sessions 表，2 小时滚动过期，登出即吊销
//   - 2FA：GoTrue MFA（TOTP）。已注册 MFA 的管理员登录必须带 totpCode
//   - 失败锁定：login_logs 内 15 分钟 ≥5 次失败 → 拒绝登录 15 分钟
//   - 权限矩阵：admin_role_permissions（0001/0002 种子），每个 action 声明
//     所需权限，缺权限一律 403
//   - 审计：所有敏感操作写 audit_logs（表级 REVOKE UPDATE/DELETE，不可删改）
//   - 数据访问全部 service_role；客户端对这些表无任何直接权限
//
// 部署：supabase functions deploy admin-api
// 密钥：TICKET_HMAC_SECRET（登录锁定/邮箱哈希 pepper）、RESEND_API_KEY、MAIL_FROM（可选）
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { sendMail } from '../_shared/mail.ts'

const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // 甲方要求：管理员会话 2 小时
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_FAIL_LIMIT = 5
const PAGE_SIZE = 20

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function pepper(): string {
  return Deno.env.get('TICKET_HMAC_SECRET') ?? 'markdoc-dev-pepper'
}

async function hashEmail(email: string): Promise<string> {
  return sha256Hex(`${email.trim().toLowerCase()}|${pepper()}`)
}

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

async function ipHash(req: Request): Promise<string> {
  return sha256Hex(`${clientIp(req)}|${pepper()}`)
}

// ── 权限矩阵（与 0001/0002 种子一致；adminPermissions.ts 为前端镜像）─────────
const ACTION_PERMISSIONS: Record<string, string | null> = {
  'dashboard': 'dashboard.view',
  'users.list': 'user.list',
  'user.setStatus': 'user.enable_disable',
  'user.forceLogout': 'user.force_logout',
  'user.resetPassword': 'user.reset_password',
  'user.resendVerification': 'user.resend_verification',
  'user.delete': 'user.delete',
  'user.exportData': 'user.export_data',
  'histories.list': 'history.metadata',
  'history.get': 'history.content',
  'history.delete': 'history.delete',
  'history.clearUser': 'history.clear_user',
  'stats.daily': 'stats.view',
  'stats.exportCsv': 'stats.view',
  'emailLogs.list': 'email_log.view',
  'emailLogs.resend': 'email_log.resend',
  'config.get': 'config.edit',
  'config.set': 'config.edit',
  'admins.list': 'admin.manage',
  'admins.create': 'admin.manage',
  'admins.setActive': 'admin.manage',
  'admins.delete': 'admin.manage',
  'audit.list': 'audit.view',
  'me': null,
}

// ── 管理员会话 ───────────────────────────────────────────────────────────────

interface AdminContext {
  sb: ReturnType<typeof serviceClient>
  adminId: string
  role: string
  permissions: Set<string>
  sessionId: string
}

async function authenticate(req: Request, sb: ReturnType<typeof serviceClient>): Promise<AdminContext | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const { data: session } = await sb.from('admin_sessions')
    .select('id, admin_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) return null
  const { data: admin } = await sb.from('admin_users').select('id, role_key, is_active').eq('id', session.admin_id).maybeSingle()
  if (!admin || !admin.is_active) return null
  const { data: perms } = await sb.from('admin_role_permissions').select('permission_key').eq('role_key', admin.role_key)
  // 2 小时滚动续期：活跃会话自动延长，长期闲置自动过期
  await sb.from('admin_sessions').update({ last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() }).eq('id', session.id)
  return { sb, adminId: admin.id, role: admin.role_key, permissions: new Set((perms ?? []).map((p) => p.permission_key)), sessionId: session.id }
}

async function audit(ctx: AdminContext | null, action: string, target?: string, detail?: unknown, req?: Request): Promise<void> {
  await (ctx?.sb ?? serviceClient()).from('audit_logs').insert({
    admin_id: ctx?.adminId ?? null,
    action,
    target: target ?? null,
    detail: detail === undefined ? null : detail,
    ip_hash: req ? await ipHash(req) : null,
  })
}

// ── 登录 ─────────────────────────────────────────────────────────────────────

async function login(sb: ReturnType<typeof serviceClient>, params: { email?: string; password?: string; totp?: string }, req: Request) {
  const email = (params.email ?? '').trim().toLowerCase()
  const password = params.password ?? ''
  if (!email || !password) return json({ error: '请输入邮箱与密码' }, 400)

  // 失败锁定：15 分钟窗口内 ≥5 次失败 → 拒绝（甲方验收：失败锁定）
  const eh = await hashEmail(email)
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString()
  const { count } = await sb.from('login_logs')
    .select('id', { count: 'exact', head: true })
    .eq('email_hash', eh).eq('success', false).gte('created_at', since)
  if ((count ?? 0) >= LOGIN_FAIL_LIMIT) {
    await sb.from('login_logs').insert({ email_hash: eh, ip_hash: await ipHash(req), success: false, reason: 'locked' })
    return json({ error: '失败次数过多，账号已临时锁定 15 分钟' }, 429)
  }

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } })
  const { data: signInData, error: signInErr } = await asUser.auth.signInWithPassword({ email, password })
  const fail = async (reason: string, status = 401) => {
    await sb.from('login_logs').insert({ email_hash: eh, ip_hash: await ipHash(req), success: false, reason })
    return json({ error: reason }, status)
  }
  if (signInErr || !signInData.session) return fail(signInErr?.message.includes('Email not confirmed') ? 'email_unconfirmed' : 'bad_credentials')
  if (signInData.user.email_confirmed_at == null) return fail('email_unconfirmed')

  // 2FA：已注册 MFA 的管理员必须通过 TOTP 校验
  const { data: factors } = await asUser.auth.mfa.listFactors()
  if (factors?.totp?.length) {
    if (!params.totp) {
      await asUser.auth.signOut({ scope: 'global' })
      return json({ error: '需要两步验证', needTotp: true }, 401)
    }
    const { error: mfaErr } = await asUser.auth.mfa.challengeAndVerify({ factorId: factors.totp[0].id, totpCode: params.totp })
    if (mfaErr) {
      await asUser.auth.signOut({ scope: 'global' })
      return fail('totp_invalid')
    }
  }

  const { data: admin } = await sb.from('admin_users').select('id, role_key, is_active, must_change_password').eq('id', signInData.user.id).maybeSingle()
  if (!admin) {
    await asUser.auth.signOut({ scope: 'global' })
    return fail('not_admin', 403) // 非管理员账号不得进入后台
  }
  if (!admin.is_active) {
    await asUser.auth.signOut({ scope: 'global' })
    return fail('admin_disabled', 403)
  }

  const { data: perms } = await sb.from('admin_role_permissions').select('permission_key').eq('role_key', admin.role_key)
  const token = crypto.randomUUID() + crypto.randomUUID()
  await sb.from('admin_sessions').insert({
    admin_id: admin.id,
    token_hash: await sha256Hex(token),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  })
  await sb.from('login_logs').insert({ user_id: admin.id, email_hash: eh, ip_hash: await ipHash(req), success: true, reason: 'admin_login' })
  const ctx: AdminContext = { sb, adminId: admin.id, role: admin.role_key, permissions: new Set((perms ?? []).map((p) => p.permission_key)), sessionId: 'login' }
  await audit(ctx, 'admin.login', admin.id, { role: admin.role_key }, req)
  return json({
    token,
    role: admin.role_key,
    mustChangePassword: admin.must_change_password,
    permissions: [...ctx.permissions],
  })
}

// ── 动作实现 ─────────────────────────────────────────────────────────────────

async function actionDashboard(ctx: AdminContext) {
  const { data } = await ctx.sb.from('admin_dashboard_stats').select('*').maybeSingle()
  const s = data ?? {}
  const anon = Number(s.anon_exports ?? 0)
  const reg = Number(s.user_exports ?? 0)
  return json({
    usersTotal: s.users_total ?? 0,
    usersNew7d: s.users_new_7d ?? 0,
    usersUnverified: s.users_unverified ?? 0,
    usersDisabled: s.users_disabled ?? 0,
    anonExports: anon,
    userExports: reg,
    conversionRate: anon + reg > 0 ? Math.round((reg / (anon + reg)) * 1000) / 10 : null,
    historiesTotal: s.histories_total ?? 0,
    emails7d: s.emails_7d ?? 0,
    emailsFailed7d: s.emails_failed_7d ?? 0,
    system: 'ok',
  })
}

async function actionUsersList(ctx: AdminContext, params: Record<string, unknown>) {
  const q = String(params.q ?? '').toLowerCase()
  const page = Math.max(1, Number(params.page ?? 1))
  let query = ctx.sb.from('profiles').select('id, email, status, display_name, export_count, register_source, last_login_at, created_at', { count: 'exact' }).order('created_at', { ascending: false })
  if (q) query = query.ilike('email', `%${q}%`)
  if (params.status) query = query.eq('status', String(params.status))
  const { data: profiles, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  // 补邮箱验证状态（auth.users 只能经 admin API 读取）
  const confirmed = new Map<string, boolean>()
  const { data: authUsers } = await ctx.sb.auth.admin.listUsers({ page: page - 1, perPage: PAGE_SIZE })
  for (const u of authUsers?.users ?? []) confirmed.set(u.id, u.email_confirmed_at != null)
  const rows = (profiles ?? []).map((p: Record<string, unknown>) => ({ ...p, emailVerified: confirmed.get(p.id as string) ?? false }))
  return json({ rows, total: count ?? 0, page, pageSize: PAGE_SIZE })
}

async function actionHistoriesList(ctx: AdminContext, params: Record<string, unknown>) {
  const page = Math.max(1, Number(params.page ?? 1))
  let query = ctx.sb.from('histories').select('id, user_id, title, format, status, created_at, options', { count: 'exact' }).order('created_at', { ascending: false })
  if (params.userId) query = query.eq('user_id', String(params.userId))
  if (params.q) query = query.ilike('title', `%${String(params.q)}%`)
  const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  return json({ rows: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
}

async function actionEmailLogsList(ctx: AdminContext, params: Record<string, unknown>) {
  const page = Math.max(1, Number(params.page ?? 1))
  let query = ctx.sb.from('email_logs').select('id, to_email, type, status, error, created_at', { count: 'exact' }).order('created_at', { ascending: false })
  if (params.status) query = query.eq('status', String(params.status))
  const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  return json({ rows: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
}

async function actionAuditList(ctx: AdminContext, params: Record<string, unknown>) {
  const page = Math.max(1, Number(params.page ?? 1))
  let query = ctx.sb.from('audit_logs').select('id, admin_id, action, target, detail, created_at', { count: 'exact' }).order('created_at', { ascending: false })
  if (params.action) query = query.eq('action', String(params.action))
  const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  return json({ rows: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
}

async function actionStatsDaily(ctx: AdminContext) {
  const { data } = await ctx.sb.from('admin_usage_daily').select('*')
  return json({ rows: data ?? [] })
}

async function actionStatsExportCsv(ctx: AdminContext) {
  const { data } = await ctx.sb.from('admin_usage_daily').select('*')
  const rows = data ?? [] as Record<string, unknown>[]
  const csv = ['日期,匿名转换,注册转换,Word,PDF', ...rows.map((r) => [r.day, r.anon_count, r.user_count, r.docx_count, r.pdf_count].join(','))].join('\n')
  return new Response(csv, { headers: { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="usage-daily.csv"' } })
}

async function actionEmailLogsResend(ctx: AdminContext, params: Record<string, unknown>, req: Request) {
  const id = Number(params.id)
  const { data: log } = await ctx.sb.from('email_logs').select('to_email, type').eq('id', id).maybeSingle()
  if (!log) return json({ error: '记录不存在' }, 404)
  const type = log.type === 'reset' ? 'recover' : 'signup'
  const { data: link, error } = await ctx.sb.auth.admin.generateLink({ type: type as 'recover' | 'signup', email: log.to_email })
  if (error || !link?.properties?.action_link) {
    await ctx.sb.from('email_logs').insert({ to_email: log.to_email, type: log.type, status: 'failed', error: error?.message ?? 'generateLink 失败' })
    return json({ error: '生成链接失败' }, 500)
  }
  const result = await sendMail(log.to_email, 'MarkDoc 账户操作链接', `<p>请点击以下链接完成操作（1 小时内有效）：</p><p><a href="${link.properties.action_link}">${link.properties.action_link}</a></p>`, log.type as 'signup' | 'reset' | 'admin_broadcast', async (t, status, err2) => {
    await ctx.sb.from('email_logs').insert({ to_email: log.to_email, type: t, status, error: err2 ?? null })
  })
  await audit(ctx, 'email.resend', log.to_email, { ok: result.ok }, req)
  return json({ ok: result.ok, error: result.error })
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const sb = serviceClient()
  let body: { action?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400)
  }
  const action = body.action ?? ''
  const params = body.params ?? {}

  if (action === 'login') return login(sb, params as { email?: string; password?: string; totp?: string }, req)

  const ctx = await authenticate(req, sb)
  if (!ctx) return json({ error: '未登录或会话已过期' }, 401)

  if (action === 'logout') {
    await sb.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', ctx.sessionId)
    await audit(ctx, 'admin.logout', undefined, undefined, req)
    return json({ ok: true })
  }
  if (action === 'me') return json({ adminId: ctx.adminId, role: ctx.role, permissions: [...ctx.permissions] })

  const required = ACTION_PERMISSIONS[action]
  if (required === undefined) return json({ error: `未知动作：${action}` }, 404)
  if (required !== null && !ctx.permissions.has(required)) return json({ error: `无权限：需要 ${required}` }, 403)

  switch (action) {
    case 'dashboard': return actionDashboard(ctx)
    case 'users.list': return actionUsersList(ctx, params)
    case 'histories.list': return actionHistoriesList(ctx, params)
    case 'emailLogs.list': return actionEmailLogsList(ctx, params)
    case 'audit.list': return actionAuditList(ctx, params)
    case 'stats.daily': return actionStatsDaily(ctx)
    case 'stats.exportCsv': return actionStatsExportCsv(ctx)
    case 'emailLogs.resend': return actionEmailLogsResend(ctx, params, req)

    case 'history.get': {
      if (!params.id) return json({ error: '缺少 id' }, 400)
      const { data } = await ctx.sb.from('histories').select('*').eq('id', String(params.id)).maybeSingle()
      if (!data) return json({ error: '不存在' }, 404)
      // 查看正文属于敏感操作：每次都记审计（甲方验收要求）
      await audit(ctx, 'history.view_content', String(params.id), { userId: (data as Record<string, unknown>).user_id }, req)
      return json(data)
    }
    case 'history.delete': {
      await ctx.sb.from('histories').update({ status: 'deleted' }).eq('id', String(params.id))
      await audit(ctx, 'history.delete', String(params.id), undefined, req)
      return json({ ok: true })
    }
    case 'history.clearUser': {
      if (ctx.role !== 'super') return json({ error: '仅超级管理员可按用户清空历史' }, 403)
      await ctx.sb.from('histories').update({ status: 'deleted' }).eq('user_id', String(params.userId))
      await audit(ctx, 'history.clear_user', String(params.userId), undefined, req)
      return json({ ok: true })
    }

    case 'user.setStatus': {
      const disabled = params.disabled === true
      await ctx.sb.from('profiles').update({ status: disabled ? 'disabled' : 'active' }).eq('id', String(params.id))
      await ctx.sb.auth.admin.updateUserById(String(params.id), { ban_duration: disabled ? '876000h' : 'none' })
      if (disabled) await ctx.sb.auth.admin.signOut(String(params.id)) // 禁用即强制下线
      await audit(ctx, disabled ? 'user.disable' : 'user.enable', String(params.id), undefined, req)
      return json({ ok: true })
    }
    case 'user.forceLogout': {
      await ctx.sb.auth.admin.signOut(String(params.id))
      await audit(ctx, 'user.force_logout', String(params.id), undefined, req)
      return json({ ok: true })
    }
    case 'user.resetPassword': {
      const { data: link, error } = await ctx.sb.auth.admin.generateLink({ type: 'recover', email: String(params.email ?? '') })
      if (error || !link?.properties?.action_link) return json({ error: '生成重置链接失败' }, 500)
      const result = await sendMail(String(params.email), 'MarkDoc 密码重置', `<p>管理员已为您发起密码重置，请点击链接完成（1 小时内有效）：</p><p><a href="${link.properties.action_link}">${link.properties.action_link}</a></p>`, 'reset', async (t, status, err2) => {
        await ctx.sb.from('email_logs').insert({ to_email: String(params.email), type: t, status, error: err2 ?? null })
      })
      await audit(ctx, 'user.reset_password', String(params.id), { emailSent: result.ok }, req)
      return json({ ok: result.ok, error: result.error })
    }
    case 'user.resendVerification': {
      // 按邮箱直接生成新验证链接并发送——不依赖 email_logs 里是否存在历史记录
      const email = String(params.email ?? '').trim().toLowerCase()
      if (!email) return json({ error: '缺少 email' }, 400)
      const { data: link, error } = await ctx.sb.auth.admin.generateLink({ type: 'signup', email })
      if (error || !link?.properties?.action_link) {
        await ctx.sb.from('email_logs').insert({ to_email: email, type: 'signup', status: 'failed', error: error?.message ?? 'generateLink 失败' })
        return json({ error: '生成验证链接失败' }, 500)
      }
      const result = await sendMail(email, 'MarkDoc 邮箱验证', `<p>请点击以下链接完成邮箱验证（1 小时内有效）：</p><p><a href="${link.properties.action_link}">${link.properties.action_link}</a></p>`, 'signup', async (t, status, err2) => {
        await ctx.sb.from('email_logs').insert({ to_email: email, type: t, status, error: err2 ?? null })
      })
      await audit(ctx, 'user.resend_verification', email, { ok: result.ok }, req)
      return json({ ok: result.ok, error: result.error })
    }
    case 'user.delete': {
      if (ctx.role !== 'super') return json({ error: '仅超级管理员可删除用户' }, 403)
      await ctx.sb.auth.admin.deleteUser(String(params.id))
      await audit(ctx, 'user.delete', String(params.id), undefined, req)
      return json({ ok: true })
    }
    case 'user.exportData': {
      if (ctx.role !== 'super') return json({ error: '仅超级管理员可导出用户数据' }, 403)
      const { data: profile } = await ctx.sb.from('profiles').select('*').eq('id', String(params.id)).maybeSingle()
      const { data: histories } = await ctx.sb.from('histories').select('id, title, format, created_at').eq('user_id', String(params.id))
      await audit(ctx, 'user.export_data', String(params.id), { count: histories?.length ?? 0 }, req)
      return json({ profile, histories: histories ?? [] })
    }

    case 'config.get': {
      const { data } = await ctx.sb.from('system_configs').select('*').order('key')
      return json({ rows: data ?? [] })
    }
    case 'config.set': {
      if (!params.key) return json({ error: '缺少 key' }, 400)
      await ctx.sb.from('system_configs').upsert({ key: String(params.key), value: params.value as never, updated_at: new Date().toISOString() })
      await audit(ctx, 'config.set', String(params.key), { value: params.value }, req)
      return json({ ok: true })
    }

    case 'admins.list': {
      const { data } = await ctx.sb.from('admin_users').select('id, role_key, is_active, must_change_password, created_at').order('created_at')
      return json({ rows: data ?? [] })
    }
    case 'admins.create': {
      const email = String(params.email ?? '').trim().toLowerCase()
      const password = String(params.password ?? '')
      const role = String(params.role ?? 'admin')
      if (!email || password.length < 12) return json({ error: '邮箱必填，初始密码至少 12 位' }, 400)
      const { data: created, error } = await ctx.sb.auth.admin.createUser({ email, password, email_confirm: true })
      if (error || !created.user) return json({ error: error?.message ?? '创建失败' }, 500)
      await ctx.sb.from('admin_users').insert({ id: created.user.id, role_key: role, must_change_password: true, created_by: ctx.adminId })
      await audit(ctx, 'admin.create', created.user.id, { email, role }, req)
      return json({ ok: true, id: created.user.id })
    }
    case 'admins.setActive': {
      if (String(params.id) === ctx.adminId) return json({ error: '不能禁用自己' }, 400)
      await ctx.sb.from('admin_users').update({ is_active: params.active === true }).eq('id', String(params.id))
      if (params.active !== true) {
        await ctx.sb.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_id', String(params.id))
      }
      await audit(ctx, params.active === true ? 'admin.enable' : 'admin.disable', String(params.id), undefined, req)
      return json({ ok: true })
    }
    case 'admins.delete': {
      if (String(params.id) === ctx.adminId) return json({ error: '不能删除自己' }, 400)
      await ctx.sb.auth.admin.deleteUser(String(params.id))
      await audit(ctx, 'admin.delete', String(params.id), undefined, req)
      return json({ ok: true })
    }

    default:
      return json({ error: `未知动作：${action}` }, 404)
  }
})
