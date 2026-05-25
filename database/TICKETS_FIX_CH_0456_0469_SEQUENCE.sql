-- =============================================================================
-- Fix CH-0456 … CH-0469 (and neighbors) — reference format + list sort order
--
-- Symptom: Chores & Bugs list sorts by created_at DESC (newest first).
--   CH-0471 on top is correct; CH-0456 jumping above CH-0457–CH-0464 happens when
--   one row has a newer created_at (e.g. bulk repair UPDATE) or malformed ref
--   (CH-456 vs CH-0456).
--
-- This script:
--   1) Preview affected rows
--   2) Normalize reference_no → CH-#### (4 digits)
--   3) Set created_at / query_arrival_at in numeric ref order below CH-0471
--
-- Run in Supabase SQL Editor. BACKUP first:
--   SELECT id, reference_no, created_at, company_name, LEFT(description,80)
--   FROM public.tickets WHERE reference_no ~ '^CH-' AND type = 'chore';
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 0 — PREVIEW (run alone first)
-- -----------------------------------------------------------------------------
SELECT
  t.id,
  t.reference_no,
  t.reference_no ~ '^CH-\d{4}$' AS ref_is_4_digit,
  (substring(t.reference_no FROM 'CH-(\d+)'))::int AS ref_num,
  t.created_at,
  t.updated_at,
  t.company_name,
  LEFT(t.description, 70) AS description_preview
FROM public.tickets t
WHERE t.type IN ('chore', 'bug')
  AND t.reference_no ~ '^CH-'
  AND COALESCE((substring(t.reference_no FROM 'CH-(\d+)'))::int, 0) BETWEEN 450 AND 475
ORDER BY
  (substring(t.reference_no FROM 'CH-(\d+)'))::int DESC NULLS LAST,
  t.created_at DESC;


-- -----------------------------------------------------------------------------
-- STEP 1 — APPLY FIX (wrap in transaction after preview looks correct)
-- -----------------------------------------------------------------------------
BEGIN;

-- 1a) Normalize reference_no to CH-#### (fixes CH-456 → CH-0456, etc.)
UPDATE public.tickets t
SET
  reference_no = 'CH-' || LPAD((substring(t.reference_no FROM 'CH-(\d+)'))::text, 4, '0'),
  updated_at = NOW()
WHERE t.type IN ('chore', 'bug')
  AND t.reference_no ~ '^CH-(\d+)$'
  AND t.reference_no <> 'CH-' || LPAD((substring(t.reference_no FROM 'CH-(\d+)'))::text, 4, '0');

-- 1b) Stagger timestamps so higher ref = newer row (list: … 0471, 0470, 0469 … 0456)
--     Anchor = CH-0471 created_at if present; else now() at UTC.
WITH anchor AS (
  SELECT COALESCE(
    (
      SELECT t.created_at
      FROM public.tickets t
      WHERE t.reference_no = 'CH-0471'
      ORDER BY t.created_at DESC
      LIMIT 1
    ),
    (NOW() AT TIME ZONE 'UTC')
  ) AS t_anchor
),
batch AS (
  SELECT
    t.id,
    (substring(t.reference_no FROM 'CH-(\d+)'))::int AS ref_num
  FROM public.tickets t
  WHERE t.type = 'chore'
    AND t.reference_no ~ '^CH-\d{4}$'
    AND (substring(t.reference_no FROM 'CH-(\d+)'))::int BETWEEN 456 AND 469
)
UPDATE public.tickets t
SET
  created_at = a.t_anchor - ((471 - b.ref_num) * INTERVAL '1 minute'),
  query_arrival_at = a.t_anchor - ((471 - b.ref_num) * INTERVAL '1 minute'),
  updated_at = NOW()
FROM batch b
CROSS JOIN anchor a
WHERE t.id = b.id;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- -----------------------------------------------------------------------------
-- STEP 2 — VERIFY (same order as app: created_at DESC)
-- -----------------------------------------------------------------------------
SELECT
  reference_no,
  created_at,
  company_name,
  LEFT(description, 60) AS description_preview
FROM public.tickets
WHERE type = 'chore'
  AND reference_no ~ '^CH-'
  AND (substring(reference_no FROM 'CH-(\d+)'))::int BETWEEN 455 AND 472
ORDER BY created_at DESC;
