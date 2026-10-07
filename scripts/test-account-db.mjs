import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'

// 独立内存数据库：只模拟 Supabase 管理的 auth schema，业务 SQL 使用真实迁移。
const db = new PGlite()
const userId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users);
    create table auth.refresh_tokens(session_id uuid references auth.sessions);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated;
  `)
  for (const name of readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'))
  }
  // 新迁移可重复执行。
  await db.exec(readFileSync('supabase/migrations/0005_account_audit_fixes.sql', 'utf8'))
  const consume = async (device = 'device', ip = 'ip', user = null, check = false) => {
    const { rows } = await db.query('select public.consume_export_quota($1,$2,null,$3,\'pdf\',\'web\',$4) as result', [user, device, ip, check])
    return rows[0].result
  }
  assert.equal((await consume('device', 'ip', null, true)).remaining.deviceLeft, 1)
  assert.equal((await consume()).remaining.deviceLeft, 0)
  assert.equal((await consume()).error, 'QUOTA_EXCEEDED')
  assert.equal((await consume('device', 'different-ip')).error, 'QUOTA_EXCEEDED')
  await consume('device2'); await consume('device3')
  assert.equal((await consume('device4')).error, 'QUOTA_EXCEEDED')
  assert.equal((await db.query('select count(*)::int as n from usage_logs')).rows[0].n, 3)
  console.log('✓ 匿名设备终身额度、跨设备 IP 上限、只查询不扣减')

  await db.exec(`insert into auth.users(id,email) values ('${userId}','test@example.test');
    update system_configs set value = 'false' where key = 'registered_unlimited';
    update profiles set export_count = 99 where id = '${userId}';`)
  assert.equal((await consume('', 'ip', userId)).remaining.userLeft, 0)
  assert.equal((await consume('', 'ip', userId)).error, 'QUOTA_EXCEEDED')
  assert.equal((await consume('', 'ip', userId, true)).remaining.userLeft, 0)
  await db.exec("update system_configs set value = 'true' where key = 'registered_unlimited'")
  assert.equal((await consume('', 'ip', userId)).remaining, null)
  await db.exec("update system_configs set value = 'true' where key = 'maintenance_mode'")
  assert.equal((await consume('', 'ip', userId)).error, 'MAINTENANCE')
  await db.exec("update system_configs set value = 'false' where key = 'maintenance_mode'")
  await db.exec(`update profiles set status = 'disabled' where id = '${userId}'`)
  assert.equal((await consume('', 'ip', userId)).error, 'DISABLED')
  await db.exec(`update profiles set status = 'active' where id = '${userId}'`)
  console.log('✓ 注册用户第 100/101 次、无限额度、维护及禁用状态')

  await db.exec(`create function fail_usage() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
    create trigger fail_usage before insert on usage_logs for each row execute function fail_usage();`)
  await assert.rejects(consume('rollback-device', 'new-ip'), /test failure/)
  assert.equal((await db.query("select count(*)::int as n from anon_devices where device_id = 'rollback-device'")).rows[0].n, 0)
  await db.exec('drop trigger fail_usage on usage_logs')
  console.log('✓ 日志写入失败时设备扣减整体回滚')

  await db.exec(`insert into auth.sessions values ('${sessionId}','${userId}');
    insert into auth.refresh_tokens values ('${sessionId}');
    insert into histories(user_id,title,content_md,format) values ('${userId}','private','private','pdf');
    select set_config('request.jwt.claims','{"sub":"${userId}","session_id":"${sessionId}"}',false);
    set role authenticated;`)
  assert.equal((await db.query('select current_account_session_active() as active')).rows[0].active, true)
  assert.equal((await db.query('select * from histories')).rows.length, 1)
  await assert.rejects(db.query('select revoke_user_sessions($1)', [userId]), /permission denied/)
  await assert.rejects(consume(), /permission denied/)
  await db.exec('reset role; set role anon')
  await assert.rejects(consume(), /permission denied/)
  await db.exec('reset role; set role service_role')
  await db.query('select revoke_user_sessions($1)', [userId])
  await db.exec('reset role; set role authenticated')
  assert.equal((await db.query('select current_account_session_active() as active')).rows[0].active, false)
  assert.equal((await db.query('select * from histories')).rows.length, 0)
  await assert.rejects(db.query('insert into histories(user_id,content_md,format) values ($1,\'blocked\',\'pdf\')', [userId]), /row-level security/)
  await db.exec('reset role')
  assert.equal((await db.query('select * from auth.refresh_tokens')).rows.length, 0)
  // 重新登录建立新 session 后恢复本人访问。
  await db.exec(`insert into auth.sessions values ('${sessionId}','${userId}'); set role authenticated;`)
  assert.equal((await db.query('select * from histories')).rows.length, 1)
  console.log('✓ 服务端专属 RPC 权限、刷新凭据撤销、旧 JWT 读写拒绝、重新登录恢复')
} finally {
  await db.close()
}
