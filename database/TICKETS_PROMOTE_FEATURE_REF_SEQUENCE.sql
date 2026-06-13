-- =============================================================================
-- Feature reference sequence — preview & fix promote-to-feature numbering
-- Use when Shift to Feature assigned EX-FE-0001 instead of next FE-xxxx.
-- Run in Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) PREVIEW: current max feature number + next reference
-- -----------------------------------------------------------------------------
SELECT
  COALESCE(
    MAX(
      CASE
        WHEN reference_no ~* '^EX-FE-\d+$' THEN (substring(reference_no FROM 'EX-FE-(\d+)$'))::int
        WHEN reference_no ~* '^FE-\d+$' THEN (substring(reference_no FROM 'FE-(\d+)$'))::int
        ELSE NULL
      END
    ),
    0
  ) AS max_feature_num,
  'FE-' || lpad(
    (
      COALESCE(
        MAX(
          CASE
            WHEN reference_no ~* '^EX-FE-\d+$' THEN (substring(reference_no FROM 'EX-FE-(\d+)$'))::int
            WHEN reference_no ~* '^FE-\d+$' THEN (substring(reference_no FROM 'FE-(\d+)$'))::int
            ELSE NULL
          END
        ),
        0
      ) + 1
    )::text,
    4,
    '0'
  ) AS next_feature_reference
FROM public.tickets
WHERE type = 'feature';

-- -----------------------------------------------------------------------------
-- 2) LIST: promoted tickets with wrong low EX-FE-* refs (review before fix)
-- -----------------------------------------------------------------------------
SELECT
  id,
  reference_no,
  source_reference_no,
  source_type,
  title,
  promoted_to_feature_at
FROM public.tickets
WHERE type = 'feature'
  AND source_reference_no IS NOT NULL
  AND reference_no ~* '^EX-FE-\d+$'
ORDER BY promoted_to_feature_at ASC, id;

-- -----------------------------------------------------------------------------
-- 3) FIX: renumber ALL promoted EX-FE-* → proper FE-xxxx (run this block)
--    BACKUP recommended before running.
-- -----------------------------------------------------------------------------
BEGIN;

WITH legit_max AS (
  SELECT COALESCE(
    MAX((substring(reference_no FROM 'FE-(\d+)$'))::int),
    0
  ) AS m
  FROM public.tickets
  WHERE type = 'feature'
    AND reference_no ~* '^FE-\d+$'
),
to_fix AS (
  SELECT
    id,
    row_number() OVER (ORDER BY promoted_to_feature_at ASC NULLS LAST, id) AS rn
  FROM public.tickets
  WHERE type = 'feature'
    AND source_reference_no IS NOT NULL
    AND reference_no ~* '^EX-FE-\d+$'
),
staged AS (
  UPDATE public.tickets t
  SET reference_no = '__promote_fix__' || replace(t.id::text, '-', '')
  FROM to_fix f
  WHERE t.id = f.id
  RETURNING t.id, f.rn
)
UPDATE public.tickets t
SET reference_no = 'FE-' || lpad((legit_max.m + staged.rn)::text, 4, '0')
FROM staged
CROSS JOIN legit_max
WHERE t.id = staged.id;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 4) VERIFY after fix
-- -----------------------------------------------------------------------------
-- SELECT reference_no, source_reference_no, type, title
-- FROM public.tickets
-- WHERE source_reference_no IS NOT NULL
-- ORDER BY promoted_to_feature_at DESC
-- LIMIT 20;
