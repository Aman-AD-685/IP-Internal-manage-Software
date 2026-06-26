-- =====================================================================
-- RUN_ALL_PERFORMANCE_INDEXES.sql
-- One script to make dashboards + ticket lists fast.
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to re-run
-- (every statement uses IF NOT EXISTS). Run it ONCE; indexes are permanent.
--
-- WHY: the dashboard endpoints run many COUNT(*) queries with filters on
-- type / created_at / status_2 / status_4 / quality_solution / company_name /
-- staging_planned / live_review_status. Without these indexes Postgres does a
-- full sequential scan of the whole `tickets` table for EACH count — that is
-- the main database-side cause of slow dashboards once the table grows.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. STEP ONE: check what indexes you ALREADY have (run this block first,
--    note the result, then run the rest). If most idx_tickets_* below are
--    MISSING, that is almost certainly your slowness.
-- ---------------------------------------------------------------------
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'tickets'
-- ORDER BY indexname;

-- ---------------------------------------------------------------------
-- 1. TICKETS — open-queue / pending dashboard counts
--    (from TICKETS_OPEN_QUEUE_INDEXES.sql + DASHBOARD_KPI_INDEXES.sql)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tickets_type_created_at
  ON public.tickets (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_type_actual_2
  ON public.tickets (type, actual_2)
  WHERE type IN ('chore', 'bug');

CREATE INDEX IF NOT EXISTS idx_tickets_open_queue_chore_bug
  ON public.tickets (type, status_2, status_4)
  WHERE type IN ('chore', 'bug') AND quality_solution IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_open_queue_feature
  ON public.tickets (type, approval_status, status_2)
  WHERE type = 'feature';

-- ---------------------------------------------------------------------
-- 2. TICKETS — list filters + print/export
--    (from TICKET_LIST_FILTER_EXPORT_INDEXES.sql)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tickets_company_created_at_desc
  ON public.tickets (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_type_status2_created_at_desc
  ON public.tickets (type, status_2, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_type_approval_created_at_desc
  ON public.tickets (type, approval_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_priority_created_at_desc
  ON public.tickets (priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_reference_no_created_at_desc
  ON public.tickets (reference_no, created_at DESC);

-- ---------------------------------------------------------------------
-- 3. TICKETS — NEW indexes for the /dashboard/metrics counts that the
--    files above did NOT cover (staging counts, demo_c split, last-week
--    response/completion delay, and the join/lookup columns).
-- ---------------------------------------------------------------------
-- Staging pending counts: WHERE (staging_planned IS NOT NULL OR status_2='staging')
CREATE INDEX IF NOT EXISTS idx_tickets_staging_planned
  ON public.tickets (type, live_review_status)
  WHERE staging_planned IS NOT NULL;

-- Other half of the staging predicate: OR status_2='staging'
CREATE INDEX IF NOT EXISTS idx_tickets_staging_status2
  ON public.tickets (type, live_review_status)
  WHERE status_2 = 'staging';

-- Exact dashboard open-queue predicates used by /dashboard/metrics counts.
-- These are deliberately partial so COUNT(*) can stay on a tiny hot subset.
CREATE INDEX IF NOT EXISTS idx_tickets_dashboard_open_cb_fast
  ON public.tickets (type, company_name)
  WHERE type IN ('chore', 'bug')
    AND quality_solution IS NULL
    AND (status_4 IS NULL OR status_4 <> 'completed')
    AND (status_2 IS NULL OR (status_2 <> 'staging' AND status_2 <> 'na'))
    AND (staging_planned IS NULL OR live_review_status = 'completed');

CREATE INDEX IF NOT EXISTS idx_tickets_dashboard_open_feature_fast
  ON public.tickets (company_name, approval_status, status_2)
  WHERE type = 'feature'
    AND quality_solution IS NULL
    AND (status_4 IS NULL OR status_4 <> 'completed')
    AND (status_2 IS NULL OR (status_2 <> 'staging' AND status_2 <> 'na'))
    AND (staging_planned IS NULL OR live_review_status = 'completed');

-- Last-week dashboard cards fetch these columns for chores/bugs by created_at.
CREATE INDEX IF NOT EXISTS idx_tickets_dashboard_week_cb_covering
  ON public.tickets (type, created_at DESC)
  INCLUDE (assignee_id, status_4, actual_4, status)
  WHERE type IN ('chore', 'bug');

-- Demo C / non-Demo-C split filters on company_name
CREATE INDEX IF NOT EXISTS idx_tickets_company_name
  ON public.tickets (company_name);

-- Enrichment lookups (company / page / division names joined per ticket list)
CREATE INDEX IF NOT EXISTS idx_tickets_page_id
  ON public.tickets (page_id) WHERE page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_division_id
  ON public.tickets (division_id) WHERE division_id IS NOT NULL;

-- Repeat-children filter (list excludes repeat_of_ticket_id IS NOT NULL)
CREATE INDEX IF NOT EXISTS idx_tickets_repeat_of_ticket_id
  ON public.tickets (repeat_of_ticket_id) WHERE repeat_of_ticket_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. LOOKUP TABLES used by ticket enrichment (.in_('id', [...]))
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_companies_id_name
  ON public.companies (id) INCLUDE (name);

-- ---------------------------------------------------------------------
-- 5. PAYMENT / ONBOARDING tables used by the custom-email dashboard cards
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ocp_receive_client_payment_id
  ON public.onboarding_client_payment_receive (client_payment_id);

CREATE INDEX IF NOT EXISTS idx_ocp_payment_received_date
  ON public.onboarding_client_payment (payment_received_date);

CREATE INDEX IF NOT EXISTS idx_ocp_invoice_date
  ON public.onboarding_client_payment (invoice_date);

-- ---------------------------------------------------------------------
-- 6. DELEGATION (custom_pending_delegation count)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_delegation_tasks_status
  ON public.delegation_tasks (status)
  WHERE status IN ('pending', 'in_progress');

-- ---------------------------------------------------------------------
-- 7. Tell PostgREST (Supabase API) to reload so it sees the new indexes.
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 8. AFTER RUNNING: optional — refresh planner stats so Postgres starts
--    using the new indexes immediately on a large table.
-- =====================================================================
ANALYZE public.tickets;

-- =====================================================================
-- 9. VERIFY it worked. Re-run the block from step 0 and confirm the new
--    idx_tickets_* names appear. To see whether a specific dashboard query
--    now uses an index instead of a Seq Scan, run e.g.:
--
--   EXPLAIN ANALYZE
--   SELECT count(*) FROM public.tickets
--   WHERE type IN ('chore','bug') AND quality_solution IS NULL;
--
-- Look for "Index" / "Bitmap Index Scan" (good) instead of "Seq Scan"
-- on a large row count (bad).
-- =====================================================================
