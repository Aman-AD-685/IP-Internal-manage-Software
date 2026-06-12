-- =====================================================================
-- SUCC-0035 — Add-on: replace every remaining 68.41% with 63.15%
-- ---------------------------------------------------------------------
-- After the Gate Pass revert, some followup rows (logged AFTER the old
-- completed entry) still carry previous/total = 68.41. This rewrites
-- ONLY those values back to 63.15 for SUCC-0035, and resets the
-- training total to 63.15. Future followups will grow from 63.15.
--
-- Scoped strictly to SUCC-0035. Idempotent. Transaction-wrapped.
-- =====================================================================

BEGIN;

DO $$
DECLARE
    v_pm_id       uuid;
    v_training_id uuid;
    v_updated     int;
BEGIN
    SELECT id INTO v_pm_id
    FROM performance_monitoring
    WHERE reference_no = 'SUCC-0035';

    IF v_pm_id IS NULL THEN
        RAISE EXCEPTION 'performance_monitoring row not found for SUCC-0035';
    END IF;

    SELECT id INTO v_training_id
    FROM performance_training
    WHERE performance_id = v_pm_id;

    IF v_training_id IS NULL THEN
        RAISE EXCEPTION 'performance_training row not found for SUCC-0035';
    END IF;

    -- 1. Any followup row of this ticket still holding 68.41 -> 63.15
    UPDATE feature_followups ff
    SET previous_percentage = CASE WHEN ff.previous_percentage = 68.41 THEN 63.15 ELSE ff.previous_percentage END,
        total_percentage    = CASE WHEN ff.total_percentage    = 68.41 THEN 63.15 ELSE ff.total_percentage    END
    FROM ticket_features tf
    WHERE tf.id = ff.ticket_feature_id
      AND tf.training_id = v_training_id
      AND (ff.previous_percentage = 68.41 OR ff.total_percentage = 68.41);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE 'Rewrote % followup row(s) from 68.41 to 63.15', v_updated;

    -- 2. Training total back to 63.15 (next followup grows from here)
    UPDATE performance_training
    SET total_percentage = 63.15,
        updated_at = NOW()
    WHERE id = v_training_id;
END $$;

COMMIT;

-- =====================================================================
-- VERIFY (run after COMMIT)
-- =====================================================================

-- A. No followup row of SUCC-0035 should show 68.41 anymore
SELECT ff.feature_name, ff.previous_percentage, ff.added_percentage,
       ff.total_percentage, ff.status, ff.created_at
FROM feature_followups ff
JOIN ticket_features tf      ON tf.id = ff.ticket_feature_id
JOIN performance_training pt ON pt.id = tf.training_id
JOIN performance_monitoring pm ON pm.id = pt.performance_id
WHERE pm.reference_no = 'SUCC-0035'
ORDER BY ff.created_at DESC;

-- B. Training total should be 63.15
SELECT pm.reference_no, pt.total_percentage, pm.completion_status
FROM performance_monitoring pm
JOIN performance_training pt ON pt.performance_id = pm.id
WHERE pm.reference_no = 'SUCC-0035';
