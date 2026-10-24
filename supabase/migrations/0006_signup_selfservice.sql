-- 0006: 自助注册端点（auth-signup Edge Function）的 IP 频控表
--
-- 背景：GoTrue /auth/v1/signup 的邮件发送链路故障——请求在服务端「发确认邮件」
-- 环节卡死约 25 秒后被网关 504，用户未落库、验证码永远收不到（2026-10-23 实测）。
-- 新端点用 service role 直接创建「已确认」用户（注册即登录，不依赖邮件），
-- 此表按 IP 哈希做每日注册频控，防止匿名批量开号。

create table if not exists public.signup_ip_daily (
  ip_hash text primary key,
  day date not null default current_date,
  count integer not null default 0
);

-- 仅 service role（绕过 RLS）可读写；匿名/登录用户一律拒绝
alter table public.signup_ip_daily enable row level security;
