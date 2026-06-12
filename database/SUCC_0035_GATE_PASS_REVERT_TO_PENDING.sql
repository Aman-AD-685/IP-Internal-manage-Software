-- =====================================================================
-- SUCC-0035 — Revert "Gate Pass" feature from Completed back to Pending
-- ---------------------------------------------------------------------
-- What this does (ONLY for SUCC-0035 + Gate Pass, nothing else):
--   1. Deletes the feature_followups row(s) with status='completed'
--      for the Gate Pass feature (the "+5.26% = 68.41% (completed)" entry).
--      All "(pending)" history rows are kept untouched.
--   2. Sets ticket_features.status back to 'Pending' for Gate Pass.
--   3. Recalculates performance_training.total_percentage from the
--      latest remaining followup (falls back to initial_percentage).
--   4. Ensures performance_monitoring.completion_status = 'in_progress'
--      (so the row stays in Performance Monitoring, not Comp- Perform).
--
-- Safe to re-run (idempotent). Wrapped in a transaction:
-- if anything is missing it RAISEs and nothing is changed.
-- =====================================================================

BEGIN;

DO $$
DECLARE
    v_pm_id        uuid;
    v_training_id  uuid;
    v_tf_id        uuid;
    v_deleted      int;
    v_new_total    numeric;
BEGIN
    -- 1. Resolve the SUCC-0035 performance ticket
    SELECT id INTO v_pm_id
    FROM performance_monitoring
    WHERE reference_no = 'SUCC-0035';

    IF v_pm_id IS NULL THEN
        RAISE EXCEPTION 'performance_monitoring row not found for reference_no SUCC-0035';
    END IF;

    -- 2. Resolve training for this ticket
    SELECT id INTO v_training_id
    FROM performance_training
    WHERE performance_id = v_pm_id;

    IF v_training_id IS NULL THEN
        RAISE EXCEPTION 'performance_training row not found for SUCC-0035';
    END IF;

    -- 3. Resolve the Gate Pass ticket_feature
    SELECT tf.id INTO v_tf_id
    FROM ticket_features tf
    JOIN feature_list fl ON fl.id = tf.feature_id
    WHERE tf.training_id = v_training_id
      AND lower(trim(fl.name)) = 'gate pass';

    IF v_tf_id IS NULL THEN
        RAISE EXCEPTION 'Gate Pass ticket_feature not found for SUCC-0035';
    END IF;

    -- 4. Delete ONLY the completed followup row(s) for Gate Pass
    DELETE FROM feature_followups
    WHERE ticket_feature_id = v_tf_id
      AND status = 'completed';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE 'Deleted % completed followup row(s) for Gate Pass', v_deleted;

    -- 5. Set the feature back to Pending
    UPDATE ticket_features
    SET status = 'Pending'
    WHERE id = v_tf_id;

    -- 6. Recalculate total_percentage = latest remaining followup total
    --    across ALL features of this ticket (falls back to initial_percentage)
    SELECT ff.total_percentage INTO v_new_total
    FROM feature_followups ff
    JOIN ticket_features tf ON tf.id = ff.ticket_feature_id
    WHERE tf.training_id = v_training_id
    ORDER BY ff.created_at DESC
    LIMIT 1;

    IF v_new_total IS NULL THEN
        SELECT COALESCE(initial_percentage, 0) INTO v_new_total
        FROM performance_training
        WHERE id = v_training_id;
    END IF;

    UPDATE performance_training
    SET total_percentage = v_new_total,
        updated_at = NOW()
    WHERE id = v_training_id;
    RAISE NOTICE 'performance_training.total_percentage reset to %', v_new_total;

    -- 7. Keep the ticket in Performance Monitoring (not Comp- Perform)
    UPDATE performance_monitoring
    SET completion_status = 'in_progress',
        updated_at = NOW()
    WHERE id = v_pm_id
      AND completion_status = 'completed';
END $$;

COMMIT;

-- =====================================================================
-- VERIFY (run after COMMIT)
-- =====================================================================

-- A. Gate Pass feature status should be 'Pending'; no completed followups left
SELECT fl.name AS feature, tf.status,
       COUNT(ff.id) FILTER (WHERE ff.status = 'completed') AS completed_followups,
       COUNT(ff.id) FILTER (WHERE ff.status = 'pending')   AS pending_followups
FROM performance_monitoring pm
JOIN performance_training pt ON pt.performance_id = pm.id
JOIN ticket_features tf      ON tf.training_id = pt.id
JOIN feature_list fl         ON fl.id = tf.feature_id
LEFT JOIN feature_followups ff ON ff.ticket_feature_id = tf.id
WHERE pm.reference_no = 'SUCC-0035'
GROUP BY fl.name, tf.status
ORDER BY fl.name;

-- B. Total should be back to the pre-completion value (e.g. 63.15)
SELECT pm.reference_no, pm.completion_status, pt.total_percentage, pt.initial_percentage
FROM performance_monitoring pm
JOIN performance_training pt ON pt.performance_id = pm.id
WHERE pm.reference_no = 'SUCC-0035';
