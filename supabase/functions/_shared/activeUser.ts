import { createClient } from 'jsr:@supabase/supabase-js@2'

/** getUser 验证 JWT；数据库会话检查拒绝强制下线后尚未过期的旧 JWT。 */
export async function getActiveUser(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  const { data: active, error: sessionError } = await client.rpc('current_account_session_active')
  return !sessionError && active === true ? data.user : null
}
