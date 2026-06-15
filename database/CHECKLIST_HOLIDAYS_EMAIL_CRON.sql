-- =============================================================================
-- Holidays + Sundays: NO automated cron emails on those days
-- =============================================================================
-- App logic (backend/app/email_working_day.py):
--   • Sundays — always skip (no DB row needed)
--   • Dates in checklist_holidays — skip all cron reminder mail
--
-- Skipped email types:
--   checklist daily, delegation daily, admin pending digest,
--   feature approval reminders, escalation (pending / critical / stages)
--
-- NOT skipped (user-triggered / transactional):
--   password reset, test email, approval submitter notify, improvement done
--
-- Timezone for "today": Asia/Kolkata (IST)
-- Upload holidays: Task → Checklist → Upload Holiday List (Admin, from Dec 15)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.checklist_holidays (
  holiday_date date NOT NULL,
  holiday_name text NOT NULL,
  year integer NOT NULL,
  PRIMARY KEY (holiday_date, year)
);

CREATE INDEX IF NOT EXISTS idx_checklist_holidays_year
  ON public.checklist_holidays (year);

CREATE INDEX IF NOT EXISTS idx_checklist_holidays_date
  ON public.checklist_holidays (holiday_date);

COMMENT ON TABLE public.checklist_holidays IS
  'Company holidays: no checklist occurrences on these dates; no cron reminder emails. Sundays always skipped in app.';

-- Keep year column aligned with holiday_date (required for year-filtered loads)
UPDATE public.checklist_holidays
SET year = EXTRACT(YEAR FROM holiday_date)::int
WHERE year IS DISTINCT FROM EXTRACT(YEAR FROM holiday_date)::int;

-- -----------------------------------------------------------------------------
-- Example holidays for 2026 (edit to match your company list)
-- -----------------------------------------------------------------------------
INSERT INTO public.checklist_holidays (holiday_date, holiday_name, year) VALUES
  ('2026-01-26', 'Republic Day', 2026),
  ('2026-03-25', 'Holi', 2026),
  ('2026-04-14', 'Ambedkar Jayanti', 2026),
  ('2026-08-15', 'Independence Day', 2026),
  ('2026-10-02', 'Gandhi Jayanti', 2026),
  ('2026-10-20', 'Dussehra', 2026),
  ('2026-11-08', 'Diwali', 2026),
  ('2026-12-25', 'Christmas', 2026)
ON CONFLICT (holiday_date, year) DO UPDATE SET holiday_name = EXCLUDED.holiday_name;

-- -----------------------------------------------------------------------------
-- VERIFY: list holidays for current calendar year (IST)
-- -----------------------------------------------------------------------------
SELECT holiday_date, holiday_name, year
FROM public.checklist_holidays
WHERE year = EXTRACT(YEAR FROM (timezone('Asia/Kolkata', now()))::date)::int
ORDER BY holiday_date;

-- -----------------------------------------------------------------------------
-- VERIFY: should cron emails run TODAY? (IST)
-- Returns skip_reason = NULL when emails MAY be sent
-- -----------------------------------------------------------------------------
WITH ist_today AS (
  SELECT (timezone('Asia/Kolkata', now()))::date AS d
)
SELECT
  t.d AS today_ist,
  to_char(t.d, 'Dy') AS weekday,
  CASE
    WHEN EXTRACT(DOW FROM t.d) = 0 THEN 'sunday'
    WHEN h.holiday_name IS NOT NULL THEN 'holiday:' || h.holiday_name
    ELSE NULL
  END AS skip_reason,
  CASE
    WHEN EXTRACT(DOW FROM t.d) = 0 THEN 'NO — Sunday'
    WHEN h.holiday_name IS NOT NULL THEN 'NO — ' || h.holiday_name
    ELSE 'YES — working day'
  END AS send_cron_emails
FROM ist_today t
LEFT JOIN public.checklist_holidays h ON h.holiday_date = t.d;

-- -----------------------------------------------------------------------------
-- VERIFY: all Sundays in 2026 (emails auto-skipped; no rows needed)
-- -----------------------------------------------------------------------------
SELECT d::date AS sunday_ist
FROM generate_series(
  '2026-01-01'::date,
  '2026-12-31'::date,
  '1 day'::interval
) AS d
WHERE EXTRACT(DOW FROM d::date) = 0
ORDER BY 1;

-- -----------------------------------------------------------------------------
-- Optional: remove a holiday (emails will resume on that date)
-- -----------------------------------------------------------------------------
-- DELETE FROM public.checklist_holidays WHERE holiday_date = '2026-03-25' AND year = 2026;

NOTIFY pgrst, 'reload schema';
