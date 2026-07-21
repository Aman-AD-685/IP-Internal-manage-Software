-- =============================================================================
-- PURGE: cancelled delegations + deactivated-user checklist/delegation
-- Run in Supabase SQL Editor (production). Safe to re-run (IF NOT EXISTS).
--
-- Rules:
-- 1) Any delegation with status = 'cancelled' is HARD-DELETED 24h after cancel.
-- 2) After a user is deactivated for 24h:
--      - KEEP their checklist/delegation with business date BEFORE deactivate day
--      - DELETE their checklist/delegation with business date AFTER deactivate day
--    (deactivate day itself is kept = "ager" / same-day history)
--
-- Business dates:
--   delegation: COALESCE(delegation_on, due_date, (created_at AT TIME ZONE 'utc')::date)
--   checklist task: COALESCE(start_date, (created_at AT TIME ZONE 'utc')::date)
--   checklist completion / NA: occurrence_date
-- =============================================================================

-- ── 1) Columns ───────────────────────────────────────────────────────────────

ALTER TABLE public.delegation_tasks
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.delegation_tasks.cancelled_at IS
  'Set when status becomes cancelled; used to hard-delete after 24 hours.';

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_profiles.deactivated_at IS
  'Set when is_active flips to false; cleared on reactivate. Purge runs after 24h.';

-- Best-effort backfill for already-cancelled rows (no historical cancel time).
UPDATE public.delegation_tasks
SET cancelled_at = COALESCE(updated_at, created_at, NOW())
WHERE lower(status) IN ('cancelled', 'canceled', 'cancel')
  AND cancelled_at IS NULL;

-- Currently inactive users: start the 24h clock from now (one-time).
UPDATE public.user_profiles
SET deactivated_at = NOW()
WHERE is_active = FALSE
  AND deactivated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_delegation_tasks_cancelled_at
  ON public.delegation_tasks (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_deactivated_at
  ON public.user_profiles (deactivated_at)
  WHERE deactivated_at IS NOT NULL;

-- ── 2) Triggers: stamp cancel / deactivate times ─────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_delegation_set_cancelled_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(COALESCE(NEW.status, '')) IN ('cancelled', 'canceled', 'cancel')
     AND lower(COALESCE(OLD.status, '')) NOT IN ('cancelled', 'canceled', 'cancel') THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
  ELSIF lower(COALESCE(NEW.status, '')) NOT IN ('cancelled', 'canceled', 'cancel') THEN
    NEW.cancelled_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delegation_set_cancelled_at ON public.delegation_tasks;
CREATE TRIGGER trg_delegation_set_cancelled_at
  BEFORE UPDATE OF status ON public.delegation_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_delegation_set_cancelled_at();

CREATE OR REPLACE FUNCTION public.trg_user_set_deactivated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active IS FALSE AND OLD.is_active IS DISTINCT FROM FALSE THEN
    NEW.deactivated_at := COALESCE(NEW.deactivated_at, NOW());
  ELSIF NEW.is_active IS TRUE THEN
    NEW.deactivated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_set_deactivated_at ON public.user_profiles;
CREATE TRIGGER trg_user_set_deactivated_at
  BEFORE UPDATE OF is_active ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_user_set_deactivated_at();

-- ── 3) Preview helpers (run manually before first purge) ─────────────────────

-- Preview cancelled delegations that would be deleted NOW:
-- SELECT id, reference_no, title, assignee_id, status, cancelled_at
-- FROM public.delegation_tasks
-- WHERE lower(status) IN ('cancelled', 'canceled', 'cancel')
--   AND cancelled_at IS NOT NULL
--   AND cancelled_at <= NOW() - INTERVAL '24 hours';

-- Preview deactivated users eligible for post-date purge:
-- SELECT id, full_name, is_active, deactivated_at
-- FROM public.user_profiles
-- WHERE is_active = FALSE
--   AND deactivated_at IS NOT NULL
--   AND deactivated_at <= NOW() - INTERVAL '24 hours';

-- ── 4) Purge function ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_cancelled_and_deactivated_task_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled_deleted INT := 0;
  v_delegation_deleted INT := 0;
  v_checklist_tasks_deleted INT := 0;
  v_completions_deleted INT := 0;
  v_na_deleted INT := 0;
  r RECORD;
  v_cutoff DATE;
  v_task_ids UUID[];
  v_doomed_task_ids UUID[];
  v_n INT;
BEGIN
  -- (A) Hard-delete cancelled delegations older than 24h
  WITH doomed AS (
    DELETE FROM public.delegation_tasks d
    WHERE lower(d.status) IN ('cancelled', 'canceled', 'cancel')
      AND d.cancelled_at IS NOT NULL
      AND d.cancelled_at <= NOW() - INTERVAL '24 hours'
    RETURNING d.id
  )
  SELECT COUNT(*)::INT INTO v_cancelled_deleted FROM doomed;

  -- (B) Per deactivated user (inactive ≥ 24h): delete post-deactivate-date rows only
  FOR r IN
    SELECT id, (deactivated_at AT TIME ZONE 'utc')::date AS deact_day
    FROM public.user_profiles
    WHERE is_active = FALSE
      AND deactivated_at IS NOT NULL
      AND deactivated_at <= NOW() - INTERVAL '24 hours'
  LOOP
    v_cutoff := r.deact_day; -- keep dates < cutoff; delete dates > cutoff

    SELECT COALESCE(array_agg(t.id), ARRAY[]::UUID[])
    INTO v_task_ids
    FROM public.checklist_tasks t
    WHERE t.doer_id = r.id;

    IF cardinality(v_task_ids) > 0 THEN
      DELETE FROM public.checklist_completions c
      WHERE c.task_id = ANY (v_task_ids)
        AND c.occurrence_date > v_cutoff;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_completions_deleted := v_completions_deleted + v_n;

      DELETE FROM public.checklist_occurrence_na n
      WHERE n.task_id = ANY (v_task_ids)
        AND n.occurrence_date > v_cutoff;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_na_deleted := v_na_deleted + v_n;
    END IF;

    SELECT COALESCE(array_agg(t.id), ARRAY[]::UUID[])
    INTO v_doomed_task_ids
    FROM public.checklist_tasks t
    WHERE t.doer_id = r.id
      AND COALESCE(t.start_date, (t.created_at AT TIME ZONE 'utc')::date) > v_cutoff;

    IF cardinality(v_doomed_task_ids) > 0 THEN
      DELETE FROM public.checklist_completions c
      WHERE c.task_id = ANY (v_doomed_task_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_completions_deleted := v_completions_deleted + v_n;

      DELETE FROM public.checklist_occurrence_na n
      WHERE n.task_id = ANY (v_doomed_task_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_na_deleted := v_na_deleted + v_n;

      DELETE FROM public.checklist_tasks t
      WHERE t.id = ANY (v_doomed_task_ids);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_checklist_tasks_deleted := v_checklist_tasks_deleted + v_n;
    END IF;

    DELETE FROM public.delegation_tasks d
    WHERE d.assignee_id = r.id
      AND COALESCE(
            d.delegation_on,
            d.due_date,
            (d.created_at AT TIME ZONE 'utc')::date
          ) > v_cutoff;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_delegation_deleted := v_delegation_deleted + v_n;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled_delegations_deleted', v_cancelled_deleted,
    'deactivated_user_delegations_deleted', v_delegation_deleted,
    'checklist_tasks_deleted', v_checklist_tasks_deleted,
    'checklist_completions_deleted', v_completions_deleted,
    'checklist_occurrence_na_deleted', v_na_deleted,
    'ran_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.purge_cancelled_and_deactivated_task_data() IS
  'Deletes cancelled delegations after 24h; for deactivated users after 24h, deletes checklist/delegation dated after deactivate day.';

REVOKE ALL ON FUNCTION public.purge_cancelled_and_deactivated_task_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_cancelled_and_deactivated_task_data() TO service_role;

-- Manual one-shot:
-- SELECT public.purge_cancelled_and_deactivated_task_data();

-- ── 5) Optional pg_cron (hourly) ─────────────────────────────────────────────
-- Enable extension first: Database → Extensions → pg_cron
--
-- SELECT cron.schedule(
--   'purge-cancelled-deactivated-tasks',
--   '15 * * * *',  -- every hour at :15
--   $$SELECT public.purge_cancelled_and_deactivated_task_data();$$
-- );
--
-- To unschedule:
-- SELECT cron.unschedule('purge-cancelled-deactivated-tasks');

NOTIFY pgrst, 'reload schema';
