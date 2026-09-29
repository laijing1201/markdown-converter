// ═══════════════════════════════════════════════════════════════════════════
// 用户账号自助服务 —— 甲方《账号体系交付清单》
//
//   POST /functions/v1/account-service
//   auth: Authorization: Bearer <用户 access_token>
//   body: { action: 'export' | 'delete' }
//
//   export：返回用户全部数据 JSON（profiles + histories，RLS 本人限定 +
//           my_export_bundle 视图），前端下载为文件
//   delete：注销账号（service_role deleteUser，auth.users 级联删除
//           profiles / histories），写 usage_logs 留痕（不含正文）
//
//   数据导出也可由客户端直接走 RLS 拉取；这里提供与注销绑定的完整出口，
//   保证「先导出、后注销」的操作闭环。
// 部署：supabase functions deploy account-service
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function getUser(req: Request, sb: ReturnType<typeof serviceClient>) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data } = await sb.auth.getUser(token)
  return data.user ?? null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const sb = serviceClient()
  const user = await getUser(req, sb)
  if (!user) return json({ error: '未登录' }, 401)

  let action = ''
  try {
    action = (await req.json()).action ?? ''
  } catch { /* default */ }

  if (action === 'export') {
    // 本人数据聚合（视图 security_invoker + 用户 JWT 限定到本人）
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${req.headers.get('Authorization')!.replace(/^Bearer\s+/i, '')}` } }, auth: { persistSession: false } },
    )
    const { data: profile } = await asUser.from('profiles').select('*').maybeSingle()
    const { data: histories } = await asUser.from('histories').select('*').order('created_at', { ascending: false })
    return json({
      exportedAt: new Date().toISOString(),
      profile,
      histories: histories ?? [],
    })
  }

  if (action === 'delete') {
    // 注销前校验：要求请求体带 confirm: email，防误删（前端有二次确认弹窗）
    let confirm = ''
    try { confirm = (await req.json()).confirm ?? '' } catch { /* ignore */ }
    if (confirm !== user.email) return json({ error: '确认信息不匹配：请输入账号邮箱确认注销' }, 400)

    await sb.from('usage_logs').insert({ user_id: null, kind: 'user', source: 'web' })
      .then(() => undefined).catch(() => undefined) // 留痕失败不阻塞注销
    const { error } = await sb.auth.admin.deleteUser(user.id)
    if (error) return json({ error: error.message }, 500)
    await sb.from('audit_logs').insert({ admin_id: null, action: 'account.deleted', target: user.id })
    return json({ ok: true })
  }

  return json({ error: `未知动作：${action}` }, 404)
})
