-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 —— 管理员后台补全：甲方验收清单对齐（权限矩阵补种子 + 统计辅助）
--
-- 0001 已建立 profiles / histories / anon_devices / usage_logs /
-- system_configs / email_logs / login_logs / admin_* / audit_logs。
-- 本迁移按甲方《管理员后台交付清单》补齐缺失的权限键与种子数据。
-- 可重复执行（幂等）。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. 补充权限键（用户管理 / 历史管理细粒度动作）────────────────────────────
insert into public.admin_permissions (key, name) values
  ('user.force_logout',        '强制用户下线'),
  ('user.reset_password',      '重置用户密码'),
  ('user.resend_verification', '重发验证邮件'),
  ('user.export_data',         '导出用户数据'),
  ('history.clear_user',       '按用户清空历史'),
  ('email_log.resend',         '重发邮件')
on conflict (key) do nothing;

-- 超级管理员：始终全量（与 0001 的 cross join 策略一致）
insert into public.admin_role_permissions (role_key, permission_key)
select 'super', p.key
from public.admin_permissions p
on conflict do nothing;

-- 普通管理员补充：甲方权限矩阵默认「不能查看用户历史正文、不能改配置、
-- 不能管理管理员、不能删除用户」——以下仅补充其明确拥有的细粒度动作
insert into public.admin_role_permissions (role_key, permission_key) values
  ('admin', 'user.force_logout'),
  ('admin', 'user.reset_password'),
  ('admin', 'user.resend_verification')
on conflict do nothing;

-- ── 2. 统计仪表盘辅助视图（service_role 专用；客户端无策略不可见）────────────
create or replace view public.admin_dashboard_stats
with (security_invoker = true) as
select
  (select count(*) from public.profiles where status = 'active')                                  as users_total,
  (select count(*) from public.profiles where created_at >= now() - interval '7 days')            as users_new_7d,
  (select count(*) from auth.users where email_confirmed_at is null)                              as users_unverified,
  (select count(*) from public.profiles where status = 'disabled')                                as users_disabled,
  (select count(*) from public.usage_logs where kind = 'anon')                                    as anon_exports,
  (select count(*) from public.usage_logs where kind = 'user')                                    as user_exports,
  (select count(*) from public.histories)                                                         as histories_total,
  (select count(*) from public.email_logs where created_at >= now() - interval '7 days')          as emails_7d,
  (select count(*) from public.email_logs where status = 'failed' and created_at >= now() - interval '7 days') as emails_failed_7d;

-- 转化率在 admin-api 中计算：注册转换 / (匿名 + 注册转换)，避免视图里除零

-- ── 3. 使用统计（按日聚合，近 30 天；CSV 由 admin-api 生成）──────────────────
create or replace view public.admin_usage_daily
with (security_invoker = true) as
select
  date_trunc('day', created_at)::date                                            as day,
  count(*) filter (where kind = 'anon')                                          as anon_count,
  count(*) filter (where kind = 'user')                                          as user_count,
  count(*) filter (where format = 'docx')                                        as docx_count,
  count(*) filter (where format = 'pdf')                                         as pdf_count
from public.usage_logs
where created_at >= now() - interval '30 days'
group by 1
order by 1 desc;
