-- Bulk upload: 5 resolved chore tickets (visible in Register of Tickets).
--
-- Register of Tickets (app) shows rows where:
--   quality_solution IS NOT NULL   (solution submitted — required)
--   type = chore (or bug)
-- UI "Completed" filter: status_1 = yes AND status_4 = completed
--
-- This sheet provides company_id / page_id, so the script uses them DIRECTLY,
-- falling back to NAME match when an id is not found. Any missing page is
-- auto-created by name. Updates existing matching rows, then inserts missing.
-- Run entire script in Supabase SQL Editor.

BEGIN;

-- =============================================================================
-- created_by (auto-pick first user)
-- =============================================================================
CREATE TEMP TABLE seed_batch_16_config (
  created_by uuid NOT NULL
);

INSERT INTO seed_batch_16_config (created_by)
SELECT COALESCE(
  NULL::uuid,
  (SELECT id FROM public.user_profiles ORDER BY created_at ASC NULLS LAST LIMIT 1)
);

-- =============================================================================
-- Source data (your sheet — ids + names)
-- =============================================================================
CREATE TEMP TABLE seed_batch_16_src (
  company_id uuid NOT NULL,
  company_name text NOT NULL,
  user_name text,
  page_id uuid NOT NULL,
  page_name text NOT NULL,
  division text,
  communicated_through text,
  problem_text text NOT NULL,
  solution_text text,
  stage4_remarks text
);

INSERT INTO seed_batch_16_src (
  company_id, company_name, user_name, page_id, page_name, division,
  communicated_through, problem_text, solution_text, stage4_remarks
) VALUES
  ('96f250cc-a604-4adb-bf5a-61acbbecd2f5', 'Kodarma Chemical Pvt. Ltd.', 'Pappu Ji', 'e7cc4c06-a679-4dfd-8074-61b8a32dfb0b', 'Create Item', 'All', 'phone', 'The user wanted to know whether they could make minor corrections to an item''s name.', 'It was clarified that minor name corrections can be made, provided the revised name continues to represent the same item.', 'This has been solved'),
  ('94f359ca-9834-4082-9818-15f3c5fa4f2e', 'M/s. Singhal Enterprises (Jharsuguda) Pvt. Ltd', 'Ashok Toppa', '7491dea2-4c06-4c11-9eb9-ae44474dae79', 'Users', 'All', 'phone', 'The user wanted to know how to create a new user, assign approval levels, and allocate the appropriate department to that user.', 'Guided the user through the process of creating a new user, assigning the required approval levels, and allotting the appropriate department.', 'This has been solved'),
  ('5d365f30-59e1-4fa8-bd10-8f8cad29b488', 'Ferro Metals', 'Navin Kurre', 'f1795d54-b719-48de-bb28-f9e04b1ac7a5', 'Stock Adjustment', 'All', 'phone', 'The user wanted to know how to perform a stock adjustment and which user ID has the authority to approve the adjustment.', 'Guided the user through the process of performing a stock adjustment and explained the approval workflow.', 'This has been solved'),
  ('d7558ed1-f622-496d-9945-41e17c7d16ad', 'Orissa Concrete & Allied Industries Ltd(New)', 'Narendra Patel', '5f45a434-6044-433d-9e1d-c3d40c3dc923', 'Create Po', 'All', 'phone', 'The user wanted to know whether a Purchase Order (PO) can be created with a back date.', 'Explained that a PO can be created with a back date, provided the date is not earlier than the indent creation date. For example, if an indent was created one week ago, the PO can be backdated to the indent creation date.', 'This has been solved'),
  ('90742b46-3193-4dbb-b68d-1138be6ee77b', 'Pratishtha Spirits Private Limited', 'Jotirmoy Paul', '553187fc-4a6d-48f1-a6ea-5c2c79ebfa88', 'Indent Register', 'All', 'phone', 'Can we reverse the short close Indent', 'Yes, go to indent register select on particular indent which you want to reverse then click on the reverse short close option then it will reflect on Pending Indent page.', 'This has been solved');

-- =============================================================================
-- Auto-create any page used here that is missing (by name)
-- =============================================================================
INSERT INTO public.pages (name)
SELECT DISTINCT s.page_name
FROM seed_batch_16_src s
WHERE NOT EXISTS (
  SELECT 1 FROM public.pages p
  WHERE lower(trim(p.name)) = lower(trim(s.page_name))
);

-- =============================================================================
-- Resolve effective company_id / page_id (prefer sheet id, fall back to name)
-- =============================================================================
CREATE TEMP TABLE seed_batch_16_rows AS
SELECT
  COALESCE(c_id.id, c_name.id) AS company_id,
  s.company_name,
  s.user_name,
  COALESCE(p_id.id, p_name.id) AS page_id,
  s.page_name AS page,
  s.division,
  NULL::uuid AS division_id,
  s.communicated_through,
  s.problem_text,
  s.solution_text,
  s.stage4_remarks
FROM seed_batch_16_src s
LEFT JOIN public.companies c_id
  ON c_id.id = s.company_id
LEFT JOIN public.companies c_name
  ON c_id.id IS NULL
 AND lower(trim(c_name.name)) = lower(trim(s.company_name))
LEFT JOIN public.pages p_id
  ON p_id.id = s.page_id
LEFT JOIN public.pages p_name
  ON p_id.id IS NULL
 AND lower(trim(p_name.name)) = lower(trim(s.page_name));

-- =============================================================================
-- Validate company / page resolved + created_by exists
-- =============================================================================
DO $$
DECLARE
  missing_count int;
  missing_list text;
  cfg uuid;
BEGIN
  SELECT created_by INTO cfg FROM seed_batch_16_config LIMIT 1;
  IF cfg IS NULL THEN
    RAISE EXCEPTION 'Batch 16 aborted: public.user_profiles is empty.';
  END IF;

  SELECT count(*) INTO missing_count
  FROM seed_batch_16_rows
  WHERE company_id IS NULL OR page_id IS NULL;

  IF missing_count > 0 THEN
    SELECT string_agg(company_name || ' | page=' || COALESCE(page, '?'), E'\n' ORDER BY company_name)
    INTO missing_list
    FROM seed_batch_16_rows
    WHERE company_id IS NULL OR page_id IS NULL;

    RAISE EXCEPTION E'Batch 16 aborted: % row(s) company/page not found by id or name.\n%\nRun: SELECT id, name FROM public.companies ORDER BY name;',
      missing_count, COALESCE(missing_list, '');
  END IF;

  RAISE NOTICE 'Batch 16: created_by = %', cfg;
END $$;

-- =============================================================================
-- STEP A — Fix existing tickets (same company + problem) so Register shows them
-- =============================================================================
WITH fixed AS (
  UPDATE public.tickets t
  SET
    company_name = s.company_name,
    page_id = s.page_id,
    page = s.page,
    division = s.division,
    user_name = s.user_name,
    communicated_through = s.communicated_through,
    submitted_by = COALESCE(t.submitted_by, s.user_name),
    customer_questions = s.problem_text,
    quality_of_response = s.solution_text,
    quality_solution = s.solution_text,
    remarks = s.stage4_remarks,
    status = 'resolved',
    status_1 = 'yes',
    actual_1 = COALESCE(t.actual_1, NOW()),
    status_4 = 'completed',
    actual_4 = COALESCE(t.actual_4, NOW()),
    query_arrival_at = COALESCE(t.query_arrival_at, NOW()),
    query_response_at = COALESCE(t.query_response_at, NOW()),
    updated_at = NOW()
  FROM seed_batch_16_rows s
  WHERE t.type = 'chore'
    AND t.company_id = s.company_id
    AND lower(trim(COALESCE(t.description, ''))) = lower(trim(s.problem_text))
  RETURNING t.reference_no
)
SELECT count(*) AS updated_existing_count FROM fixed;

-- =============================================================================
-- STEP B — Insert rows that do not exist yet
-- =============================================================================
WITH ref_seed AS (
  SELECT COALESCE(MAX((substring(reference_no FROM 'CH-(\d+)'))::int), 0) AS max_no
  FROM public.tickets
  WHERE reference_no ~ '^CH-\d+$'
),
actor AS (
  SELECT c.created_by
  FROM seed_batch_16_config c
  INNER JOIN public.user_profiles u ON u.id = c.created_by
),
to_insert AS (
  SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.company_name, s.problem_text) AS row_no
  FROM seed_batch_16_rows s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.type = 'chore'
      AND t.company_id = s.company_id
      AND lower(trim(COALESCE(t.description, ''))) = lower(trim(s.problem_text))
  )
),
inserted AS (
  INSERT INTO public.tickets (
    reference_no, title, description, type, status, priority,
    company_id, company_name, page_id, page, division_id, division,
    user_name, communicated_through, submitted_by,
    customer_questions, quality_of_response, quality_solution, remarks,
    query_arrival_at, query_response_at,
    status_1, actual_1, status_4, actual_4,
    created_by, created_at, updated_at
  )
  SELECT
    'CH-' || LPAD((ref_seed.max_no + ti.row_no)::text, 4, '0'),
    LEFT(ti.problem_text, 200),
    ti.problem_text,
    'chore',
    'resolved',
    'medium',
    ti.company_id,
    ti.company_name,
    ti.page_id,
    ti.page,
    ti.division_id,
    ti.division,
    ti.user_name,
    ti.communicated_through,
    ti.user_name,
    ti.problem_text,
    ti.solution_text,
    ti.solution_text,
    ti.stage4_remarks,
    NOW(),
    NOW(),
    'yes',
    NOW(),
    'completed',
    NOW(),
    actor.created_by,
    NOW(),
    NOW()
  FROM to_insert ti
  CROSS JOIN ref_seed
  CROSS JOIN actor
  RETURNING reference_no, company_name, page
)
SELECT count(*) AS inserted_new_count FROM inserted;

-- =============================================================================
-- STEP C — Verify: rows visible in Register of Tickets API rules
-- =============================================================================
SELECT
  t.reference_no,
  t.company_name,
  t.page,
  t.user_name,
  t.status_1,
  t.status_4,
  (t.quality_solution IS NOT NULL) AS visible_in_register,
  LEFT(t.description, 60) AS problem_preview
FROM public.tickets t
INNER JOIN seed_batch_16_rows s
  ON t.company_id = s.company_id
 AND lower(trim(COALESCE(t.description, ''))) = lower(trim(s.problem_text))
WHERE t.type = 'chore'
ORDER BY t.reference_no DESC;

COMMIT;

NOTIFY pgrst, 'reload schema';
