-- One-time backfill: set null delegation_on / submission_date from due_date
-- for tasks created on 2026-07-23 (bot integration run). Safe to re-run.
--
-- Run in Supabase SQL editor after deploying the API fix that always writes these fields.

UPDATE public.delegation_tasks
SET
  delegation_on = COALESCE(delegation_on, due_date::date),
  submission_date = COALESCE(submission_date, due_date::date),
  last_assigned_date = COALESCE(
    last_assigned_date,
    submission_date,
    due_date::date
  ),
  updated_at = now()
WHERE created_at >= '2026-07-23T00:00:00+00'
  AND created_at < '2026-07-24T00:00:00+00'
  AND due_date IS NOT NULL
  AND (delegation_on IS NULL OR submission_date IS NULL);

-- Verify
SELECT reference_no, due_date, delegation_on, submission_date
FROM public.delegation_tasks
WHERE created_at >= '2026-07-23T00:00:00+00'
  AND created_at < '2026-07-24T00:00:00+00'
ORDER BY reference_no;
