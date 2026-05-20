-- =============================================================================
-- Feature tickets — pending counts & lists (aligned with app logic in main.py)
-- Table: public.tickets
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) DASHBOARD STYLE: "pending" feature count (feature_excluding_demo_c / with demo)
--    Same rules as GET /dashboard/metrics for type = feature:
--    - NOT considered "in staging": no meaningful staging_planned (null/blank) OR live_review_status = completed
--    - status_4 <> 'completed'
--    - quality_solution is empty (not submitted)
-- -----------------------------------------------------------------------------

-- Count (all companies)
SELECT COUNT(*) AS pending_feature_dashboard_count
FROM public.tickets t
WHERE t.type = 'feature'
  AND lower(coalesce(t.status_4::text, '')) <> 'completed'
  AND (
       t.quality_solution IS NULL
    OR trim(t.quality_solution::text) = ''
    OR lower(trim(t.quality_solution::text)) IN ('null', 'none')
  )
  AND (
       (t.staging_planned IS NULL OR trim(t.staging_planned::text) = '')
    OR lower(coalesce(t.live_review_status::text, '')) = 'completed'
  );

-- Count excluding Demo C companies (matches "Feature Excluding Demo C" card)
SELECT COUNT(*) AS pending_feature_excl_demo_c
FROM public.tickets t
WHERE t.type = 'feature'
  AND lower(coalesce(t.status_4::text, '')) <> 'completed'
  AND (
       t.quality_solution IS NULL
    OR trim(t.quality_solution::text) = ''
    OR lower(trim(t.quality_solution::text)) IN ('null', 'none')
  )
  AND (
       (t.staging_planned IS NULL OR trim(t.staging_planned::text) = '')
    OR lower(coalesce(t.live_review_status::text, '')) = 'completed'
  )
  AND lower(trim(coalesce(t.company_name::text, ''))) NOT IN ('demo_c', 'demo c');

-- List those tickets (excluding Demo C)
SELECT
  t.id,
  t.reference_no,
  t.title,
  t.company_name,
  t.approval_status,
  t.status_2,
  t.live_status,
  t.staging_planned,
  t.live_review_status,
  t.created_at
FROM public.tickets t
WHERE t.type = 'feature'
  AND lower(coalesce(t.status_4::text, '')) <> 'completed'
  AND (
       t.quality_solution IS NULL
    OR trim(t.quality_solution::text) = ''
    OR lower(trim(t.quality_solution::text)) IN ('null', 'none')
  )
  AND (
       (t.staging_planned IS NULL OR trim(t.staging_planned::text) = '')
    OR lower(coalesce(t.live_review_status::text, '')) = 'completed'
  )
  AND lower(trim(coalesce(t.company_name::text, ''))) NOT IN ('demo_c', 'demo c')
ORDER BY t.created_at DESC;


-- -----------------------------------------------------------------------------
-- B) APPROVAL STATUS: awaiting approval (approval_status IS NULL)
--    Matches /tickets?section=approval-status&approval_filter=pending
-- -----------------------------------------------------------------------------

SELECT COUNT(*) AS feature_approval_pending_count
FROM public.tickets t
WHERE t.type = 'feature'
  AND t.approval_status IS NULL
  AND (
       (t.staging_planned IS NULL OR trim(t.staging_planned::text) = '')
    OR lower(coalesce(t.live_review_status::text, '')) = 'completed'
  );

SELECT
  t.id,
  t.reference_no,
  t.title,
  t.company_name,
  t.created_at
FROM public.tickets t
WHERE t.type = 'feature'
  AND t.approval_status IS NULL
  AND (
       (t.staging_planned IS NULL OR trim(t.staging_planned::text) = '')
    OR lower(coalesce(t.live_review_status::text, '')) = 'completed'
  )
ORDER BY t.created_at DESC;


-- -----------------------------------------------------------------------------
-- C) STAGING: feature tickets still in staging (dashboard "Feature Pending in Staging")
-- -----------------------------------------------------------------------------

SELECT COUNT(*) AS feature_in_staging_count
FROM public.tickets t
WHERE t.type = 'feature'
  AND (
       (t.staging_planned IS NOT NULL AND trim(t.staging_planned::text) <> '')
    OR lower(coalesce(t.status_2::text, '')) = 'staging'
  )
  AND (
       t.live_review_status IS NULL
    OR lower(t.live_review_status::text) <> 'completed'
  );

SELECT
  t.id,
  t.reference_no,
  t.title,
  t.company_name,
  t.staging_planned,
  t.status_2,
  t.live_review_status
FROM public.tickets t
WHERE t.type = 'feature'
  AND (
       (t.staging_planned IS NOT NULL AND trim(t.staging_planned::text) <> '')
    OR lower(coalesce(t.status_2::text, '')) = 'staging'
  )
  AND (
       t.live_review_status IS NULL
    OR lower(t.live_review_status::text) <> 'completed'
  )
ORDER BY t.created_at DESC;


-- -----------------------------------------------------------------------------
-- D) FEATURE LIST PAGE: /tickets?type=feature (approved only, not live completed)
-- -----------------------------------------------------------------------------

SELECT COUNT(*) AS approved_feature_open_count
FROM public.tickets t
WHERE t.type = 'feature'
  AND lower(coalesce(t.approval_status::text, '')) = 'approved'
  AND (
       (t.staging_planned IS NULL OR trim(t.staging_planned::text) = '')
    OR lower(coalesce(t.live_review_status::text, '')) = 'completed'
  )
  AND (
       t.live_status IS NULL
    OR lower(t.live_status::text) <> 'completed'
  );

SELECT
  t.id,
  t.reference_no,
  t.title,
  t.company_name,
  t.approval_status,
  t.status_2,
  t.live_status,
  t.created_at
FROM public.tickets t
WHERE t.type = 'feature'
  AND lower(coalesce(t.approval_status::text, '')) = 'approved'
  AND (
       (t.staging_planned IS NULL OR trim(t.staging_planned::text) = '')
    OR lower(coalesce(t.live_review_status::text, '')) = 'completed'
  )
  AND (
       t.live_status IS NULL
    OR lower(t.live_status::text) <> 'completed'
  )
ORDER BY t.created_at DESC;
