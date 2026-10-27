-- ========================================
-- COMPREHENSIVE FIX: Partial Payment Negative Due Amounts
-- ROOT CAUSE: ugrai_data.net_amount contains outstanding instead of original
-- ========================================

SELECT '=== STEP 1: DIAGNOSE THE PROBLEM ===' as section;

-- Show bills where net_amount != original_net_amount
SELECT 
    ud.bill_number,
    ph.original_net_amount as should_be_in_net_amount,
    ud.net_amount as currently_in_net_amount,
    ph.total_paid,
    ud.received_amount,
    ph.original_net_amount - ph.total_paid as correct_due,
    ud.net_amount - GREATEST(COALESCE(ud.received_amount, 0), ph.total_paid) as wrong_due,
    (ph.original_net_amount - ph.total_paid) - (ud.net_amount - GREATEST(COALESCE(ud.received_amount, 0), ph.total_paid)) as difference
FROM ugrai_data ud
JOIN (
    SELECT 
        bill_number,
        MAX(original_net_amount) as original_net_amount,
        SUM(payment_amount) as total_paid
    FROM ugrai_payment_history
    GROUP BY bill_number
) ph ON UPPER(TRIM(ud.bill_number)) = UPPER(TRIM(ph.bill_number))
WHERE ABS(ud.net_amount - ph.original_net_amount) > 0.01
ORDER BY ud.bill_number;

SELECT '=== STEP 2: BACKUP BEFORE FIX ===' as section;

-- Create backup
CREATE TABLE IF NOT EXISTS ugrai_data_backup_partial_payment_fix_20251207 AS 
SELECT * FROM ugrai_data 
WHERE bill_number IN (
    SELECT ud.bill_number
    FROM ugrai_data ud
    JOIN ugrai_payment_history ph ON UPPER(TRIM(ud.bill_number)) = UPPER(TRIM(ph.bill_number))
    WHERE ABS(ud.net_amount - ph.original_net_amount) > 0.01
);

SELECT COUNT(*) as backed_up_bills FROM ugrai_data_backup_partial_payment_fix_20251207;

SELECT '=== STEP 3: FIX NET_AMOUNT IN UGRAI_DATA ===' as section;

-- Update net_amount to match original_net_amount from payment history
WITH payment_originals AS (
    SELECT 
        bill_number,
        MAX(original_net_amount) as original_amount
    FROM ugrai_payment_history
    GROUP BY bill_number
)
UPDATE ugrai_data ud
SET 
    net_amount = po.original_amount,
    updated_at = NOW()
FROM payment_originals po
WHERE UPPER(TRIM(ud.bill_number)) = UPPER(TRIM(po.bill_number))
  AND ABS(ud.net_amount - po.original_amount) > 0.01;

SELECT ' net_amount updated in ugrai_data' as result;

SELECT '=== STEP 4: UPDATE SQL FUNCTION (if not already done) ===' as section;

DROP FUNCTION IF EXISTS get_pending_bills_detailed();

CREATE OR REPLACE FUNCTION get_pending_bills_detailed()
RETURNS TABLE (
    id UUID,
    bill_number TEXT,
    bill_date DATE,
    retailer_name TEXT,
    sector TEXT,
    net_amount DECIMAL,
    bill_received_amount DECIMAL,
    payment_history_received DECIMAL,
    total_received DECIMAL,
    due_amount DECIMAL,
    source_table TEXT,
    assigned_to TEXT,
    current_stage TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH 
    all_ugrai_bills AS (
        SELECT 
            ud.id AS bill_id,
            ud.bill_number AS bill_num,
            ud.bill_date AS bill_dt,
            ud.retailer_name AS retailer,
            ud.sector AS bill_sector,
            ud.net_amount AS bill_net_amt,
            COALESCE(ud.received_amount, 0) AS bill_received_amt,
            ud.assigned_to AS bill_assigned,
            ud.current_stage AS bill_stage,
            'ugrai_data' AS bill_source
        FROM ugrai_data ud
        
        UNION ALL
        
        SELECT 
            ue.id AS bill_id,
            ue.bill_number AS bill_num,
            ue.bill_date AS bill_dt,
            ue.retailer_name AS retailer,
            ue.sector AS bill_sector,
            ue.net_amount AS bill_net_amt,
            COALESCE(ue.received_amount, 0) AS bill_received_amt,
            ue.assigned_to AS bill_assigned,
            ue.current_stage AS bill_stage,
            'ugrai_entries' AS bill_source
        FROM ugrai_entries ue
    ),
    bills_to_exclude AS (
        SELECT DISTINCT UPPER(TRIM(cu.bill_number)) AS excluded_bill_num
        FROM completed_ugrai cu
        UNION
        SELECT DISTINCT UPPER(TRIM(au.bill_number)) AS excluded_bill_num
        FROM approved_ugrai au
    ),
    payment_totals AS (
        SELECT 
            UPPER(TRIM(uph.bill_number)) AS payment_bill_num,
            SUM(uph.payment_amount) AS payment_total
        FROM ugrai_payment_history uph
        GROUP BY UPPER(TRIM(uph.bill_number))
    )
    SELECT 
        ub.bill_id,
        ub.bill_num,
        ub.bill_dt,
        ub.retailer,
        ub.bill_sector,
        ub.bill_net_amt,
        ub.bill_received_amt,
        COALESCE(pt.payment_total, 0),
        GREATEST(
            COALESCE(ub.bill_received_amt, 0),
            COALESCE(pt.payment_total, 0)
        ),
        ub.bill_net_amt - GREATEST(
            COALESCE(ub.bill_received_amt, 0),
            COALESCE(pt.payment_total, 0)
        ),
        ub.bill_source,
        ub.bill_assigned,
        ub.bill_stage
    FROM all_ugrai_bills ub
    LEFT JOIN payment_totals pt 
        ON UPPER(TRIM(ub.bill_num)) = pt.payment_bill_num
    WHERE UPPER(TRIM(ub.bill_num)) NOT IN (
        SELECT excluded_bill_num FROM bills_to_exclude
    )
    AND ub.bill_net_amt > 0.01
    ORDER BY ub.bill_dt DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_pending_bills_detailed() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_bills_detailed() TO anon;

SELECT ' SQL function updated' as result;

SELECT '=== STEP 5: VERIFY THE FIX ===' as section;

-- Check for negative amounts (should be 0)
SELECT 
    COUNT(*) as negative_due_count,
    CASE 
        WHEN COUNT(*) = 0 THEN ' NO NEGATIVE AMOUNTS'
        ELSE ' STILL HAS ISSUES'
    END as status
FROM get_pending_bills_detailed()
WHERE due_amount < -0.01;

-- Show corrected bills
SELECT 
    bill_number,
    net_amount as now_original,
    bill_received_amount,
    payment_history_received,
    total_received,
    due_amount as now_correct_due,
    CASE 
        WHEN due_amount < 0 THEN ' STILL NEGATIVE'
        WHEN due_amount >= 0 THEN ' NOW POSITIVE'
    END as status
FROM get_pending_bills_detailed()
WHERE bill_number IN (
    SELECT bill_number FROM ugrai_data_backup_partial_payment_fix_20251207
)
ORDER BY bill_number;

SELECT '=== FIX COMPLETE ===' as section;
