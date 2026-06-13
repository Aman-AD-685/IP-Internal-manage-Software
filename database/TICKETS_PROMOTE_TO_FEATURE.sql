-- =============================================================================
-- Chores/Bug → Feature promotion: preserve original reference, assign new EX-FE ref
-- Run once in Supabase SQL Editor after deploy.
-- =============================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS source_reference_no text,
  ADD COLUMN IF NOT EXISTS source_type text CHECK (source_type IS NULL OR source_type IN ('chore', 'bug')),
  ADD COLUMN IF NOT EXISTS promoted_to_feature_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by uuid REFERENCES public.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tickets.source_reference_no IS
  'Original CH/BU reference when a ticket was promoted from Chores/Bug to Feature.';

COMMENT ON COLUMN public.tickets.source_type IS
  'Original ticket type (chore or bug) before promotion to feature.';

CREATE INDEX IF NOT EXISTS idx_tickets_source_reference_no
  ON public.tickets (source_reference_no)
  WHERE source_reference_no IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Verification:
-- SELECT reference_no, source_reference_no, source_type, type, why_feature, promoted_to_feature_at
-- FROM public.tickets
-- WHERE source_reference_no IS NOT NULL
-- ORDER BY promoted_to_feature_at DESC
-- LIMIT 20;
