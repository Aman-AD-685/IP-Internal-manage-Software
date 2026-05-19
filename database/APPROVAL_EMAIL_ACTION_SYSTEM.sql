-- =============================================================================
-- Email Approve / Reject (one-time links, no login)
-- Run in Supabase SQL Editor if tables/columns are missing.
-- =============================================================================

-- tickets.remarks — stored when approver rejects (shown in Approval Status)
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS remarks text;

-- tickets.approval_status — allow: null (pending), approved, unapproved, rejected
-- (text column; no enum change needed if already text)

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approval_source text,
  ADD COLUMN IF NOT EXISTS approval_actual_at timestamptz,
  ADD COLUMN IF NOT EXISTS unapproval_actual_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

COMMENT ON COLUMN public.tickets.remarks IS 'Approver remarks (required on reject from email or UI).';
COMMENT ON COLUMN public.tickets.approval_status IS 'Feature tickets: null=pending, approved, unapproved, rejected';

-- Allow rejected (required for email Reject). Safe to re-run.
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_approval_status_check;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_approval_status_check
  CHECK (
    approval_status IS NULL
    OR approval_status = ''
    OR approval_status IN ('approved', 'unapproved', 'rejected')
  );

-- One-time tokens for email Approve / Rejected buttons
CREATE TABLE IF NOT EXISTS public.approval_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  action text NOT NULL CHECK (action IN ('approve', 'reject')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_tokens_token ON public.approval_tokens (token);
CREATE INDEX IF NOT EXISTS idx_approval_tokens_ticket ON public.approval_tokens (ticket_id);

-- Audit trail
CREATE TABLE IF NOT EXISTS public.approval_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  approved_by uuid,
  approved_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  source text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_logs_ticket ON public.approval_logs (ticket_id, approved_at DESC);

-- Optional: allow service_role full access (backend uses service_role key)
ALTER TABLE public.approval_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_logs ENABLE ROW LEVEL SECURITY;
