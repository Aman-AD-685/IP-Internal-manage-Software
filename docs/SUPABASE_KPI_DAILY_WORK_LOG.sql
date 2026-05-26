-- KPI daily work log (Akash dashboard) — safe to re-run (no duplicate policy errors)
-- Save failures: set SUPABASE_SERVICE_ROLE_KEY on the API host.
-- RLS delegates: docs/SUPABASE_KPI_DAILY_WORK_LOG_RLS_DELEGATES.sql

CREATE TABLE IF NOT EXISTS public.kpi_daily_work_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  work_date date NOT NULL,
  items_cleaned integer NULL,
  errors_found numeric NULL,
  accuracy_pct numeric NULL,
  videos_created integer NULL,
  video_type text NULL,
  bulk_upload_tickets integer NULL,
  ai_tasks_used integer NULL,
  process_improved integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_daily_work_log_user_date UNIQUE (user_id, work_date)
);

-- Add bulk column if table existed before bulk upload feature
ALTER TABLE public.kpi_daily_work_log
  ADD COLUMN IF NOT EXISTS bulk_upload_tickets integer NULL;

CREATE INDEX IF NOT EXISTS kpi_daily_work_log_user_month_idx
  ON public.kpi_daily_work_log (user_id, work_date);

COMMENT ON TABLE public.kpi_daily_work_log IS
  'Manual KPI daily entries for Akash dashboard (items, video, bulk upload, AI).';

COMMENT ON COLUMN public.kpi_daily_work_log.bulk_upload_tickets IS
  'Bulk upload tickets logged for this day (Akash KPI daily work log).';

ALTER TABLE public.kpi_daily_work_log ENABLE ROW LEVEL SECURITY;

-- Policies: create only if missing (fixes error 42710 "already exists")
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kpi_daily_work_log'
      AND policyname = 'kpi_daily_work_log_select_own'
  ) THEN
    CREATE POLICY "kpi_daily_work_log_select_own"
      ON public.kpi_daily_work_log FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kpi_daily_work_log'
      AND policyname = 'kpi_daily_work_log_insert_own'
  ) THEN
    CREATE POLICY "kpi_daily_work_log_insert_own"
      ON public.kpi_daily_work_log FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kpi_daily_work_log'
      AND policyname = 'kpi_daily_work_log_update_own'
  ) THEN
    CREATE POLICY "kpi_daily_work_log_update_own"
      ON public.kpi_daily_work_log FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kpi_daily_work_log'
      AND policyname = 'kpi_daily_work_log_delete_own'
  ) THEN
    CREATE POLICY "kpi_daily_work_log_delete_own"
      ON public.kpi_daily_work_log FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
