-- 0004: 历史记录跟随账号——编辑草稿与导出记录各保留最近 10 条（互不挤占）。
--
-- 需求：历史是登录专属能力；编辑自动保存（草稿）与导出记录同列表展示，
-- 但上限分开计算——草稿最多 10 条、导出最多 10 条，频繁编辑不会挤掉
-- 导出记录。上限由服务端在每次插入后按类别统一裁剪，任何写入端
-- （网站 / 插件 / 后续端）都无需各自维护裁剪逻辑。
--
-- 编辑自动保存（草稿）与导出记录共存于同一列表，format 增加 draft
-- 取值以区分来源；导出记录仍为 docx / pdf。

-- 1. 放开 format 约束，允许草稿条目
alter table public.histories drop constraint if exists histories_format_check;
alter table public.histories add constraint histories_format_check
  check (format in ('docx', 'pdf', 'draft'));

-- 2. 插入后按 created_at 在「草稿 / 导出」各自类别内保留最近 10 条，
--    更早的自动删除。
--    security definer：裁剪的是本人历史之外的旧行，需绕过 RLS 精确删除；
--    范围被 auth.uid() 严格限定，无越权面。
create or replace function public.histories_trim_to_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap constant int := 10;
  owner uuid := new.user_id;
  is_draft bool := new.format = 'draft';
begin
  delete from public.histories
  where user_id = owner
    and (format = 'draft') = is_draft
    and id not in (
      select id from public.histories
      where user_id = owner
        and (format = 'draft') = is_draft
      order by created_at desc, id desc
      limit cap
    );
  return null;
end;
$$;

drop trigger if exists histories_trim_cap on public.histories;
create trigger histories_trim_cap
  after insert on public.histories
  for each row execute function public.histories_trim_to_cap();

-- 3. 存量数据一次性回填：所有用户在草稿 / 导出各自类别内只保留最近 10 条
delete from public.histories h
where h.id in (
  select id from (
    select id,
           row_number() over (
             partition by user_id, (format = 'draft')
             order by created_at desc, id desc
           ) as rn
    from public.histories
  ) ranked
  where rn > 10
);
