-- Seed 9 resolved chore tickets (CH-#### references).
-- Idempotent: skips rows already present (same company + description + type chore).
-- Fail-fast: aborts if any company/page name is missing or created_by is invalid.
-- Resolves page_id / company_id by name (inserts missing pages only).
-- Run in Supabase SQL Editor (single transaction).

-- =============================================================================
-- CONFIG — replace created_by before run (required)
-- =============================================================================
-- SELECT id, email, role FROM public.user_profiles ORDER BY created_at LIMIT 20;

BEGIN;

CREATE TEMP TABLE seed_batch_9_config (
  created_by uuid NOT NULL
);

INSERT INTO seed_batch_9_config (created_by)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid  -- <<< REPLACE with a real user_profiles.id
);

-- =============================================================================
-- STEP 0 — Ensure page names exist
-- =============================================================================
INSERT INTO public.pages (name)
SELECT v.page_name
FROM (
  VALUES
    ('Quotation Comparison'),
    ('GRN Entry'),
    ('Create Indent'),
    ('RFQ'),
    ('GRN Register'),
    ('Set Up'),
    ('Pending Indent RFQ'),
    ('Users')
) AS v(page_name)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pages p
  WHERE lower(trim(p.name)) = lower(trim(v.page_name))
);

-- =============================================================================
-- STEP 1 — Resolve source rows (names only)
-- =============================================================================
CREATE TEMP TABLE seed_batch_9_rows AS
WITH src_raw AS (
  SELECT *
  FROM (
    VALUES
      (
        'Maa Mangla Ispat Pvt. Ltd.',
        'Rajesh ji',
        'Quotation Comparison',
        'All',
        'phone',
        'He wants to add a vendor in RFQ but vendor not appear in RFQ page',
        'Check his system and found that vendor is not approved, then explain him that 1st approved the vendor and it will show in RFQ.',
        'This has been solved'
      ),
      (
        'Ugen Ferro Alloys Pvt. Ltd.',
        'Bindo Rai',
        'GRN Entry',
        'All',
        'phone',
        'please unlock the date 7/5/2026. Bill date is blocked',
        'Called him and check the PO date that is 8/05/26 then explain him that Bill date cannot be before the PO date then he said ok we adjust it.',
        'This has been solved'
      ),
      (
        'Kodarma Chemical Pvt. Ltd.',
        'Ranjit Behera',
        'Quotation Comparison',
        'All',
        'phone',
        'Unable to add rates for other items for a vendor while editing a quote.',
        'The user had already entered 0 for 7 out of 8 items. Due to this, the quote could not be edited for those items with 0 rate.',
        'This has been solved'
      ),
      (
        'Shri Varu Polytex Pvt. Ltd.',
        'Purchase',
        'Create Indent',
        'All',
        'whatsapp',
        'Unable to create indent in back date.',
        'Indent back date of 3 days has been provided.',
        'This has been solved'
      ),
      (
        'Balmukund Sponge & Iron Pvt Ltd',
        'Dipannita, Aniruddha',
        'RFQ',
        'All',
        'whatsapp',
        'Vendor is not showing in RFQ.',
        'Same vendor was in approved and draft state.',
        'This has been solved'
      ),
      (
        'Ugen Ferro Alloys Pvt. Ltd.',
        'Binod',
        'GRN Register',
        'All',
        'whatsapp',
        'Only 2 GRNS are showing in GRN Register.',
        'User can see GRN for the departments which they have access.',
        'This has been solved'
      ),
      (
        'Orissa Concrete & Allied Industries Ltd',
        'Suresh',
        'Set Up',
        'All',
        'phone',
        'Some vendors have no GST, how to register them.',
        'User confirmed that there is not so many vendors like this so, if some vendors arrived like this they could create with a dummy GST and could maintain a sequence of this like DUMMYGST0000001.',
        'This has been solved'
      ),
      (
        'Nirman TMT',
        'Alok',
        'Pending Indent RFQ',
        'All',
        'whatsapp',
        'We cant send enquiry to other vendor no option shows for enquiry to other vendor',
        'As I have checked, this RFQ was created before 21st April, i.e., before the new RFQ flow. For such cases, you can create the RFQ from the Pending Indent RFQ page and add vendors using the previous process.',
        'This has been solved'
      ),
      (
        'Orissa Concrete & Allied Industries Ltd',
        'P Suresh',
        'Users',
        'All',
        'phone',
        'Want to know how can he managed change roles for a user and give access',
        'Guide him for user access: Go to Setup, identify the ID, click the three dots under Action, then click ''Change Roles'' and make the required changes.',
        'This has been solved'
      )
  ) AS t(
    company_name,
    user_name,
    page,
    division,
    communicated_through,
    problem_text,
    solution_text,
    stage4_remarks
  )
)
SELECT
  r.company_name,
  c.id AS company_id,
  r.user_name,
  r.page,
  p.id AS page_id,
  r.division,
  NULL::uuid AS division_id,
  r.communicated_through,
  r.problem_text,
  r.solution_text,
  r.stage4_remarks
FROM src_raw r
LEFT JOIN public.companies c
  ON lower(trim(c.name)) = lower(trim(r.company_name))
LEFT JOIN public.pages p
  ON lower(trim(p.name)) = lower(trim(r.page));

-- =============================================================================
-- STEP 2 — Validate (fail-fast)
-- =============================================================================
DO $$
DECLARE
  missing_count int;
  cfg uuid;
BEGIN
  SELECT created_by INTO cfg FROM seed_batch_9_config LIMIT 1;

  IF cfg IS NULL OR cfg = '00000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION
      'Batch 9 aborted: replace placeholder created_by in seed_batch_9_config (see CONFIG comment at top of script).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = cfg) THEN
    RAISE EXCEPTION
      'Batch 9 aborted: created_by % not found in public.user_profiles.', cfg;
  END IF;

  SELECT count(*) INTO missing_count
  FROM seed_batch_9_rows
  WHERE company_id IS NULL OR page_id IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Batch 9 aborted: % row(s) missing company or page. Run: SELECT company_name, page FROM seed_batch_9_rows WHERE company_id IS NULL OR page_id IS NULL;',
      missing_count;
  END IF;
END $$;

-- =============================================================================
-- STEP 3 — Insert new rows only (idempotent)
-- =============================================================================
WITH ref_seed AS (
  SELECT COALESCE(MAX((substring(reference_no FROM 'CH-(\d+)'))::int), 0) AS max_no
  FROM public.tickets
  WHERE reference_no ~ '^CH-\d+$'
),
actor AS (
  SELECT c.created_by
  FROM seed_batch_9_config c
  INNER JOIN public.user_profiles u ON u.id = c.created_by
),
to_insert AS (
  SELECT
    s.*,
    ROW_NUMBER() OVER (ORDER BY s.problem_text) AS row_no
  FROM seed_batch_9_rows s
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.tickets t
    WHERE t.type = 'chore'
      AND t.company_id = s.company_id
      AND lower(trim(t.description)) = lower(trim(s.problem_text))
  )
),
inserted AS (
  INSERT INTO public.tickets (
    reference_no,
    title,
    description,
    type,
    status,
    priority,
    company_id,
    company_name,
    page_id,
    page,
    division_id,
    division,
    user_name,
    communicated_through,
    submitted_by,
    customer_questions,
    quality_of_response,
    query_arrival_at,
    query_response_at,
    status_1,
    actual_1,
    status_4,
    actual_4,
    quality_solution,
    remarks,
    created_by,
    created_at,
    updated_at
  )
  SELECT
    'CH-' || LPAD((ref_seed.max_no + ti.row_no)::text, 4, '0') AS reference_no,
    LEFT(ti.problem_text, 200) AS title,
    ti.problem_text AS description,
    'chore' AS type,
    'resolved' AS status,
    'medium' AS priority,
    ti.company_id,
    ti.company_name,
    ti.page_id,
    ti.page,
    ti.division_id,
    ti.division,
    ti.user_name,
    ti.communicated_through,
    ti.user_name AS submitted_by,
    ti.problem_text AS customer_questions,
    ti.solution_text AS quality_of_response,
    NOW() AS query_arrival_at,
    NOW() AS query_response_at,
    'yes' AS status_1,
    NOW() AS actual_1,
    'completed' AS status_4,
    NOW() AS actual_4,
    ti.solution_text AS quality_solution,
    ti.stage4_remarks AS remarks,
    actor.created_by,
    NOW(),
    NOW()
  FROM to_insert ti
  CROSS JOIN ref_seed
  CROSS JOIN actor
  RETURNING reference_no
)
SELECT count(*) AS inserted_count FROM inserted;

COMMIT;

-- =============================================================================
-- Verify (run after commit if needed)
-- =============================================================================
-- SELECT count(*) AS batch_9_rows FROM public.tickets t
-- JOIN seed_batch_9_rows s ON t.company_id = s.company_id
--   AND lower(trim(t.description)) = lower(trim(s.problem_text))
-- WHERE t.type = 'chore';
--
-- SELECT id, name FROM public.pages
-- WHERE lower(trim(name)) IN (
--   lower('Quotation Comparison'), lower('GRN Entry'), lower('Create Indent'),
--   lower('RFQ'), lower('GRN Register'), lower('Set Up'),
--   lower('Pending Indent RFQ'), lower('Users')
-- );
