-- Mark raised invoices as NA (excluded from Payment Management list & Total raised KPIs).
ALTER TABLE public.onboarding_client_payment
  ADD COLUMN IF NOT EXISTS marked_na boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_onboarding_client_payment_marked_na
  ON public.onboarding_client_payment (marked_na)
  WHERE marked_na = true;

COMMENT ON COLUMN public.onboarding_client_payment.marked_na IS
  'When true, invoice is hidden from default Payment Management list and its amount is excluded from Total raised KPIs.';
