-- Checklist holidays — used for Checklist task dates AND skipping cron emails on those days.
-- Sundays are always skipped in the app (no row needed).
-- Upload/update holidays: Task → Checklist → Upload Holiday List (Admin), or run INSERTs below.

CREATE TABLE IF NOT EXISTS public.checklist_holidays (
  holiday_date date NOT NULL,
  holiday_name text NOT NULL,
  year integer NOT NULL,
  PRIMARY KEY (holiday_date, year)
);

CREATE INDEX IF NOT EXISTS idx_checklist_holidays_year
  ON public.checklist_holidays (year);

COMMENT ON TABLE public.checklist_holidays IS
  'Company holidays: no checklist occurrences; no checklist/delegation/feature/escalation cron emails.';

-- Example: 7 holidays for 2026 (edit names/dates to match your list)
INSERT INTO public.checklist_holidays (holiday_date, holiday_name, year) VALUES
  ('2026-01-26', 'Republic Day', 2026),
  ('2026-03-25', 'Holi', 2026),
  ('2026-04-14', 'Ambedkar Jayanti', 2026),
  ('2026-08-15', 'Independence Day', 2026),
  ('2026-10-02', 'Gandhi Jayanti', 2026),
  ('2026-10-20', 'Dussehra', 2026),
  ('2026-12-25', 'Christmas', 2026)
ON CONFLICT (holiday_date, year) DO UPDATE SET holiday_name = EXCLUDED.holiday_name;

-- View holidays for the current year
-- SELECT holiday_date, holiday_name FROM public.checklist_holidays WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int ORDER BY holiday_date;

NOTIFY pgrst, 'reload schema';
