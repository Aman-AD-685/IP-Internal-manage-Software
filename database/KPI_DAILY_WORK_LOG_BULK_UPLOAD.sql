-- Akash KPI daily work log — full setup (safe if table is missing OR already exists)
-- Run entire script in Supabase → SQL editor → Run
-- Error "relation kpi_daily_work_log does not exist" means you only ran ALTER before;
-- this script creates the table first, then adds bulk_upload_tickets.

-- 1) Create table (all columns including bulk upload)
create table if not exists public.kpi_daily_work_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  work_date date not null,
  items_cleaned integer null,
  errors_found numeric null,
  accuracy_pct numeric null,
  videos_created integer null,
  video_type text null,
  bulk_upload_tickets integer null,
  ai_tasks_used integer null,
  process_improved integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kpi_daily_work_log_user_date unique (user_id, work_date)
);

-- 2) Existing DBs that had the table without bulk column
alter table public.kpi_daily_work_log
  add column if not exists bulk_upload_tickets integer null;

create index if not exists kpi_daily_work_log_user_month_idx
  on public.kpi_daily_work_log (user_id, work_date);

comment on table public.kpi_daily_work_log is
  'Manual KPI daily entries for Akash dashboard (items, video, bulk upload, AI).';

comment on column public.kpi_daily_work_log.bulk_upload_tickets is
  'Bulk upload tickets logged for this day (Akash KPI daily work log).';

alter table public.kpi_daily_work_log enable row level security;

-- 3) RLS policies (skip if already created)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'kpi_daily_work_log'
      and policyname = 'kpi_daily_work_log_select_own'
  ) then
    create policy "kpi_daily_work_log_select_own"
      on public.kpi_daily_work_log for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'kpi_daily_work_log'
      and policyname = 'kpi_daily_work_log_insert_own'
  ) then
    create policy "kpi_daily_work_log_insert_own"
      on public.kpi_daily_work_log for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'kpi_daily_work_log'
      and policyname = 'kpi_daily_work_log_update_own'
  ) then
    create policy "kpi_daily_work_log_update_own"
      on public.kpi_daily_work_log for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'kpi_daily_work_log'
      and policyname = 'kpi_daily_work_log_delete_own'
  ) then
    create policy "kpi_daily_work_log_delete_own"
      on public.kpi_daily_work_log for delete
      using (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
