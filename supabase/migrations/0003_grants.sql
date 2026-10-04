-- 0003: 授予 anon / authenticated 对 public schema 的标准权限。
--
-- 背景：`supabase db push` 经平台管理角色执行迁移，绕过了 Supabase 针对
-- postgres 角色的默认授权（alter default privileges），导致新建表对
-- anon / authenticated 无 GRANT，前端直连查询（如 histories 云端历史）
-- 报 "permission denied for table histories"。此迁移显式补齐授权，
-- 并设置默认授权使后续新表自动继承。
grant usage on schema public to anon, authenticated;

grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
