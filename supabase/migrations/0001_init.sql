-- ═══════════════════════════════════════════════════════════════════════════
-- MarkDoc 账号体系与云端历史 —— 初始 Schema（Supabase / PostgreSQL）
--
-- 与需求书的表名映射：
--   users              → auth.users（Supabase Auth 内置）+ public.profiles（扩展字段）
--   sessions           → auth.sessions（Supabase Auth 内置）+ admin_sessions（管理端独立会话）
--   verification_codes → Supabase Auth 内置确认/OTP token；发送行为落 public.email_logs
--   histories / usage_logs / email_logs / login_logs / system_configs /
--   anon_devices / admin_users / admin_roles / admin_permissions /
--   admin_role_permissions / audit_logs → 本文件自建
--
-- 安全模型：
--   - 面向用户的隔离全部由 RLS 保证（user_id = auth.uid()），不依赖前端
--   - 匿名计次 / 管理员敏感操作只走 service_role（Edge Functions），客户端
--     对这些表无任何直接权限（RLS 开启且不建策略）
--   - audit_logs 通过 REVOKE UPDATE/DELETE 实现"不可修改、不可删除"
--
-- 可重复执行：幂等（create if not exists / drop-if-exists-then-create 策略）
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. 用户扩展表 ───────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  status        text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  display_name  text,
  export_count  int  not null default 0,
  register_source text not null default 'web' check (register_source in ('web', 'extension')),
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_status_idx on public.profiles (status);
create index if not exists profiles_created_idx on public.profiles (created_at desc);

-- 注册即建 profiles（对 auth.users 的级联响应）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, register_source)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'source', 'web'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. 云端历史（验收 6/7/8：隔离由 RLS 保证）────────────────────────────────

create table if not exists public.histories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default '未命名',
  content_md  text not null,
  options     jsonb not null default '{}'::jsonb,
  format      text not null check (format in ('docx', 'pdf')),
  status      text not null default 'ok' check (status in ('ok', 'deleted')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists histories_user_created_idx on public.histories (user_id, created_at desc);
create index if not exists histories_title_trgm_idx on public.histories
  using gin (to_tsvector('simple', title));

-- ── 3. 匿名计次（需求：设备终身 1 次 + 同 IP 每日额外放行）───────────────────

create table if not exists public.anon_devices (
  device_id        text primary key,
  fingerprint_hash text,
  export_count     int not null default 0,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

create table if not exists public.usage_logs (
  id               bigint generated always as identity primary key,
  user_id          uuid references auth.users (id) on delete set null,
  device_id        text,
  fingerprint_hash text,
  ip_hash          text,
  kind             text not null check (kind in ('anon', 'user')),
  format           text check (format in ('docx', 'pdf')),
  source           text not null default 'web' check (source in ('web', 'extension')),
  created_at       timestamptz not null default now()
);

create index if not exists usage_logs_ip_day_idx on public.usage_logs (ip_hash, created_at desc);
create index if not exists usage_logs_user_idx on public.usage_logs (user_id, created_at desc);

-- ── 4. 系统配置（管理后台可改；服务端读取执法）──────────────────────────────

create table if not exists public.system_configs (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.system_configs (key, value) values
  ('free_full_uses',        '1'),      -- 匿名设备终身免费完整使用次数
  ('ip_daily_extra',        '3'),      -- 同 IP 每日匿名额外放行次数
  ('history_retention_days','365'),    -- 云端历史保留天数
  ('registered_unlimited',  'true'),   -- 注册用户是否不限次
  ('registration_open',     'true'),   -- 是否开放注册
  ('force_email_verify',    'true'),   -- 未验证邮箱是否限制使用
  ('session_days',          '7'),      -- 用户会话天数（供前端展示与 Auth 配置对照）
  ('maintenance_mode',      'false'),
  ('announcement',          'null')
on conflict (key) do nothing;

-- ── 5. 邮件 / 登录日志（频控执法数据源；不存验证码明文）──────────────────────

create table if not exists public.email_logs (
  id         bigint generated always as identity primary key,
  to_email   text not null,
  type       text not null check (type in ('signup', 'reset', 'login_alert', 'admin_broadcast')),
  status     text not null check (status in ('sent', 'failed')),
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists email_logs_email_idx on public.email_logs (to_email, created_at desc);

create table if not exists public.login_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users (id) on delete set null,
  email_hash text,
  ip_hash    text,
  success    boolean not null,
  reason     text,
  created_at timestamptz not null default now()
);

create index if not exists login_logs_email_idx on public.login_logs (email_hash, created_at desc);

-- ── 6. 管理员体系（不开放注册，超管由部署脚本创建）──────────────────────────

create table if not exists public.admin_roles (
  key  text primary key,
  name text not null
);

create table if not exists public.admin_permissions (
  key  text primary key,
  name text not null
);

create table if not exists public.admin_role_permissions (
  role_key       text not null references public.admin_roles (key) on delete cascade,
  permission_key text not null references public.admin_permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table if not exists public.admin_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  role_key    text not null default 'admin' references public.admin_roles (key),
  is_active   boolean not null default true,
  must_change_password boolean not null default true,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references auth.users (id) on delete cascade,
  token_hash   text not null,
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists admin_sessions_admin_idx on public.admin_sessions (admin_id);

-- 角色与权限矩阵种子（需求书补充文档 §4）
insert into public.admin_roles (key, name) values
  ('super', '超级管理员'), ('admin', '普通管理员'), ('auditor', '审计员')
on conflict (key) do nothing;

insert into public.admin_permissions (key, name) values
  ('dashboard.view',        '查看仪表盘'),
  ('user.list',             '用户列表/搜索'),
  ('user.enable_disable',   '禁用/启用用户'),
  ('user.delete',           '删除用户'),
  ('history.metadata',      '查看历史元数据'),
  ('history.content',       '查看历史正文'),
  ('history.delete',        '删除历史'),
  ('stats.view',            '查看统计'),
  ('email_log.view',        '查看邮件日志'),
  ('config.edit',           '修改系统配置'),
  ('admin.manage',          '管理员管理'),
  ('audit.view',            '查看审计日志'),
  ('data.export',           '导出数据')
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_key, permission_key)
select r.key, p.key
from (values ('super')) as r(key)
cross join public.admin_permissions p
on conflict do nothing;

insert into public.admin_role_permissions (role_key, permission_key) values
  ('admin', 'dashboard.view'),
  ('admin', 'user.list'),
  ('admin', 'user.enable_disable'),
  ('admin', 'history.metadata'),
  ('admin', 'history.delete'),
  ('admin', 'stats.view'),
  ('admin', 'email_log.view')
on conflict do nothing;

insert into public.admin_role_permissions (role_key, permission_key) values
  ('auditor', 'dashboard.view'),
  ('auditor', 'user.list'),
  ('auditor', 'history.metadata'),
  ('auditor', 'stats.view'),
  ('auditor', 'email_log.view'),
  ('auditor', 'audit.view')
on conflict do nothing;

-- ── 7. 审计日志（只追加：REVOKE UPDATE/DELETE 实现"不可删改"）───────────────

create table if not exists public.audit_logs (
  id         bigint generated always as identity primary key,
  admin_id   uuid references auth.users (id) on delete set null,
  action     text not null,
  target     text,
  detail     jsonb,
  ip_hash    text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_admin_idx on public.audit_logs (admin_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);

revoke update, delete on public.audit_logs from anon, authenticated;
alter table public.audit_logs enable row level security;

-- ── 8. RLS：开启全部表，按需放行 ────────────────────────────────────────────

alter table public.profiles            enable row level security;
alter table public.histories           enable row level security;
alter table public.anon_devices        enable row level security;
alter table public.usage_logs          enable row level security;
alter table public.system_configs      enable row level security;
alter table public.email_logs          enable row level security;
alter table public.login_logs          enable row level security;
alter table public.admin_roles         enable row level security;
alter table public.admin_permissions   enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_users         enable row level security;
alter table public.admin_sessions      enable row level security;

-- profiles：本人可读可改基础字段；禁止自改 status / export_count / must_change_password
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid()
    and status = (select p.status from public.profiles p where p.id = auth.uid())
    and export_count = (select p.export_count from public.profiles p where p.id = auth.uid())
    and must_change_password = (select p.must_change_password from public.profiles p where p.id = auth.uid()));

-- histories：严格本人隔离（验收 7/8 的 401/403 由此产生）
drop policy if exists histories_select_own on public.histories;
create policy histories_select_own on public.histories
  for select using (user_id = auth.uid());
drop policy if exists histories_insert_own on public.histories;
create policy histories_insert_own on public.histories
  for insert with check (user_id = auth.uid());
drop policy if exists histories_update_own on public.histories;
create policy histories_update_own on public.histories
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists histories_delete_own on public.histories;
create policy histories_delete_own on public.histories
  for delete using (user_id = auth.uid());

-- 其余业务/管理表：客户端一律无策略 = 无直接访问，只走 service_role（Edge Functions）

-- ── 9. 注销清理（验收 11：注销后无敏感残留）────────────────────────────────
-- 注销走 Edge Function（service_role）：delete user → auth.users 级联删除
-- profiles / histories / admin 关联；anon_devices 与 usage_logs 中的匿名痕迹
-- 由保留策略函数定期清理。此处提供导出聚合视图（用户数据导出为 JSON 用）。

create or replace view public.my_export_bundle
with (security_invoker = true) as
select
  p.id, p.email, p.display_name, p.created_at,
  coalesce((select json_agg(h order by h.created_at desc)
            from public.histories h where h.user_id = p.id), '[]') as histories
from public.profiles p
where p.id = auth.uid();
