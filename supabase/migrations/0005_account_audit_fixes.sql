-- 配额校验、扣减和日志在同一事务中完成；仅服务端可传入计费主体。
create or replace function public.consume_export_quota(
  p_user_id uuid, p_device_id text, p_fingerprint text, p_ip_hash text,
  p_format text, p_source text, p_check_only boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  cfg jsonb;
  profile public.profiles%rowtype;
  device_used int;
  ip_used int;
  device_left int;
  ip_left int;
  user_left int;
  unlimited boolean;
  remaining jsonb;
begin
  if p_format not in ('docx', 'pdf') or p_source not in ('web', 'extension') then
    raise exception 'Invalid export format or source';
  end if;
  select jsonb_object_agg(key, value) into cfg from public.system_configs;
  if coalesce((cfg->>'maintenance_mode')::boolean, false) then
    return jsonb_build_object('error', 'MAINTENANCE', 'message', '系统维护中，请稍后再试');
  end if;

  if p_user_id is not null then
    select * into profile from public.profiles where id = p_user_id for update;
    if not found or profile.status = 'deleted' then
      return jsonb_build_object('error', 'AUTH_REQUIRED');
    end if;
    if profile.status = 'disabled' then
      return jsonb_build_object('error', 'DISABLED', 'message', '账号已被禁用，请联系管理员');
    end if;
    unlimited := coalesce((cfg->>'registered_unlimited')::boolean, true);
    user_left := greatest(0, 100 - profile.export_count);
    remaining := case when unlimited then null else jsonb_build_object('userLeft', user_left) end;
    if not p_check_only then
      if not unlimited and user_left = 0 then
        return jsonb_build_object('error', 'QUOTA_EXCEEDED', 'message', '账号导出额度已用完，请联系管理员。', 'remaining', remaining);
      end if;
      update public.profiles set export_count = export_count + 1 where id = p_user_id;
      insert into public.usage_logs(user_id, ip_hash, kind, format, source)
        values (p_user_id, p_ip_hash, 'user', p_format, p_source);
      if not unlimited then remaining := jsonb_build_object('userLeft', user_left - 1); end if;
    end if;
    return jsonb_build_object('ok', true, 'kind', 'user', 'remaining', remaining);
  end if;

  if p_device_id is null or p_device_id = '' or p_ip_hash is null or p_ip_hash = '' then
    raise exception 'Missing anonymous identity';
  end if;
  -- 首次设备尚无行可锁；设备锁与 IP 锁使跨 IP/跨设备的并发也受限。
  perform pg_advisory_xact_lock(hashtextextended('markdoc-device:' || p_device_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('markdoc-ip:' || p_ip_hash, 0));
  select export_count into device_used from public.anon_devices where device_id = p_device_id;
  select count(*) into ip_used from public.usage_logs
    where ip_hash = p_ip_hash and kind = 'anon'
      and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  device_left := greatest(0, coalesce((cfg->>'free_full_uses')::int, 1) - coalesce(device_used, 0));
  ip_left := greatest(0, coalesce((cfg->>'ip_daily_extra')::int, 3) - ip_used);
  remaining := jsonb_build_object('deviceLeft', device_left, 'ipLeft', ip_left);
  if not p_check_only then
    if device_left = 0 or ip_left = 0 then
      return jsonb_build_object('error', 'QUOTA_EXCEEDED', 'message', '免费试用已结束，请注册后继续使用。', 'remaining', remaining);
    end if;
    insert into public.anon_devices(device_id, fingerprint_hash, export_count, last_seen_at)
      values (p_device_id, p_fingerprint, 1, now())
      on conflict (device_id) do update set
        export_count = anon_devices.export_count + 1,
        fingerprint_hash = excluded.fingerprint_hash, last_seen_at = now();
    insert into public.usage_logs(device_id, fingerprint_hash, ip_hash, kind, format, source)
      values (p_device_id, p_fingerprint, p_ip_hash, 'anon', p_format, p_source);
    remaining := jsonb_build_object('deviceLeft', device_left - 1, 'ipLeft', ip_left - 1);
  end if;
  return jsonb_build_object('ok', true, 'kind', 'anon', 'remaining', remaining);
end;
$$;
revoke all on function public.consume_export_quota(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.consume_export_quota(uuid, text, text, text, text, text, boolean) to service_role;

-- UUID 管理操作不能调用要求 JWT 的 auth.admin.signOut。
-- 删除刷新凭据及会话；下方 RLS/Edge 校验让尚未过期的 JWT 也失去业务访问权限。
create or replace function public.revoke_user_sessions(p_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  delete from auth.refresh_tokens where session_id in (select id from auth.sessions where user_id = p_user_id);
  delete from auth.sessions where user_id = p_user_id;
  update public.admin_sessions set revoked_at = now() where admin_id = p_user_id and revoked_at is null;
end;
$$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

create or replace function public.current_account_session_active()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = nullif(auth.jwt()->>'session_id', '')::uuid and s.user_id = auth.uid()
  );
$$;
revoke all on function public.current_account_session_active() from public, anon, authenticated;
grant execute on function public.current_account_session_active() to authenticated;

drop policy if exists profiles_active_session on public.profiles;
create policy profiles_active_session on public.profiles as restrictive
  for all to authenticated using ((select public.current_account_session_active()))
  with check ((select public.current_account_session_active()));
drop policy if exists histories_active_session on public.histories;
create policy histories_active_session on public.histories as restrictive
  for all to authenticated using ((select public.current_account_session_active()))
  with check ((select public.current_account_session_active()));
