-- Fix email Reject: allow approval_status = 'rejected'
-- Error without this: tickets_approval_status_check (23514)
-- Run once in Supabase SQL Editor (production).

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_approval_status_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_approval_status_check
  CHECK (
    approval_status IS NULL
    OR approval_status = ''
    OR approval_status IN ('approved', 'unapproved', 'rejected', 'hold')
  );

COMMENT ON COLUMN public.tickets.approval_status IS
  'Feature tickets: null/empty=pending, approved, unapproved, rejected';
