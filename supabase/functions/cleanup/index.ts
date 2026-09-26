// 定时清理：历史保留期 / 匿名痕迹 / 日志（需求：数据库每日备份 + 保留策略）
//
// 部署：supabase functions deploy cleanup
// 调度：Supabase Dashboard → Edge Functions → cleanup → Schedule（每日 03:00 UTC）
//       或 pg_cron：select cron.schedule('markdoc-cleanup', '0 3 * * *', $$ select net.http_post(...) $$);
// 鉴权：Supabase 调度器自带 Authorization: Bearer <anon>，函数内部校验
//       x-cron-secret 或仅允许 service key 调用。
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const secret = Deno.env.get('CLEANUP_SECRET') ?? ''
  const provided = req.headers.get('x-cron-secret') ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const isService = auth === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
  if (!secret || provided !== secret) {
    if (!isService) return json({ error: 'FORBIDDEN' }, 403)
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: cfgRows } = await db.from('system_configs').select('key, value')
  const cfg = new Map<string, unknown>((cfgRows ?? []).map((r) => [r.key, r.value]))
  const retentionDays = Number(cfg.get('history_retention_days') ?? 365)

  const now = new Date()
  const historyBefore = new Date(now.getTime() - retentionDays * 86400_000).toISOString()
  const logBefore = new Date(now.getTime() - 90 * 86400_000).toISOString()
  const anonBefore = new Date(now.getTime() - 180 * 86400_000).toISOString()

  const results: Record<string, number | string> = {}

  const r1 = await db.from('histories').delete().lt('created_at', historyBefore)
  results.histories = r1.error ? String(r1.error.message) : 'ok'
  const r2 = await db.from('usage_logs').delete().lt('created_at', logBefore)
  results.usage_logs = r2.error ? String(r2.error.message) : 'ok'
  const r3 = await db.from('login_logs').delete().lt('created_at', logBefore)
  results.login_logs = r3.error ? String(r3.error.message) : 'ok'
  const r4 = await db.from('email_logs').delete().lt('created_at', logBefore)
  results.email_logs = r4.error ? String(r4.error.message) : 'ok'
  const r5 = await db.from('anon_devices').delete().lt('last_seen_at', anonBefore)
  results.anon_devices = r5.error ? String(r5.error.message) : 'ok'

  return json({ ok: !r1.error && !r2.error && !r3.error && !r4.error && !r5.error, results })
})
