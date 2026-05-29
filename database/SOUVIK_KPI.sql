-- Souvik KPI (EA Performance KPI Tracker) — daily 1–10 scores per KPI.
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Model: EA Performance KPI Tracker (Monday–Saturday).
--   3 areas: Payment Follow-up (35%), Accounts Work (35%), EA / Executive Support (30%).
--   12 KPIs total; each scored 1–10 per work day. Weekly + composite are computed
--   in the backend (app/souvik_dashboard_kpi.py) — this table only stores raw daily scores.
--
-- Backend writes use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Reads are gated
-- server-side by require_dashboard_kpi_person("Souvik"); RLS below is defence in depth.

-- ---------------------------------------------------------------------------
-- Daily score table (one row per work_date + KPI)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.souvik_kpi_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  kpi_key text NOT NULL,
  score numeric(4, 1) NULL CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
  created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT souvik_kpi_daily_date_kpi UNIQUE (work_date, kpi_key)
);

CREATE INDEX IF NOT EXISTS souvik_kpi_daily_date_idx
  ON public.souvik_kpi_daily (work_date);

COMMENT ON TABLE public.souvik_kpi_daily IS
  'Souvik EA Performance KPI: daily 1-10 score per KPI key. Weekly/composite computed in backend.';
COMMENT ON COLUMN public.souvik_kpi_daily.kpi_key IS
  'One of the 12 KPI keys defined in app/souvik_dashboard_kpi.py SOUVIK_KPI_AREAS.';

-- ---------------------------------------------------------------------------
-- Row-Level Security (reads by authenticated; writes via service role)
-- ---------------------------------------------------------------------------
ALTER TABLE public.souvik_kpi_daily ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'souvik_kpi_daily'
      AND policyname = 'souvik_kpi_daily_select_auth'
  ) THEN
    CREATE POLICY "souvik_kpi_daily_select_auth"
      ON public.souvik_kpi_daily FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'souvik_kpi_daily'
      AND policyname = 'souvik_kpi_daily_write_service'
  ) THEN
    CREATE POLICY "souvik_kpi_daily_write_service"
      ON public.souvik_kpi_daily FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Reload PostgREST schema cache so the API sees the new table immediately
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
