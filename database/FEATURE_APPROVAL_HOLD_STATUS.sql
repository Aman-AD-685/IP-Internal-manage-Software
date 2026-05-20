-- =============================================================================
-- Feature approval: add "hold" status + email Hold button tokens
-- Run in Supabase SQL Editor (safe to re-run).
-- =============================================================================

-- tickets.approval_status — allow hold (in addition to approved, unapproved, rejected)
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_approval_status_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_approval_status_check
  CHECK (
    approval_status IS NULL
    OR approval_status = ''
    OR approval_status IN ('approved', 'unapproved', 'rejected', 'hold')
  );

COMMENT ON COLUMN public.tickets.approval_status IS
  'Feature tickets: null/empty=pending approval, approved, unapproved, rejected, hold';

COMMENT ON COLUMN public.tickets.remarks IS
  'Approver remarks (required on reject/hold from email or UI).';

-- approval_tokens.action — allow hold (one-time email link).
-- Reminder emails use one token per ticket; ?action=approve|reject|hold selects the action.
ALTER TABLE public.approval_tokens DROP CONSTRAINT IF EXISTS approval_tokens_action_check;

ALTER TABLE public.approval_tokens
  ADD CONSTRAINT approval_tokens_action_check
  CHECK (action IN ('approve', 'reject', 'hold'));

-- Optional: tickets currently on hold
-- SELECT id, reference_no, company_name, approval_status, remarks
-- FROM public.tickets
-- WHERE type = 'feature' AND approval_status = 'hold'
-- ORDER BY updated_at DESC NULLS LAST;
