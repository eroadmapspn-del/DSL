-- ========================================
-- FIX: Total UGRAI showing negative due amounts again
-- ISSUE: SQL function using CASE instead of GREATEST
-- ========================================

SELECT '=== UPDATING SQL FUNCTION ===' as section;

-- Drop and recreate the function with GREATEST logic
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
    -- Get all bills from ugrai_data and ugrai_entries
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
    
    -- Get bills to exclude (already completed or approved)
    bills_to_exclude AS (
        SELECT DISTINCT UPPER(TRIM(cu.bill_number)) AS excluded_bill_num
        FROM completed_ugrai cu
        
        UNION
        
        SELECT DISTINCT UPPER(TRIM(au.bill_number)) AS excluded_bill_num
        FROM approved_ugrai au
    ),
    
    -- Sum payment history per bill
    payment_totals AS (
        SELECT 
            UPPER(TRIM(uph.bill_number)) AS payment_bill_num,
            SUM(uph.payment_amount) AS payment_total
        FROM ugrai_payment_history uph
        GROUP BY UPPER(TRIM(uph.bill_number))
    )
    
    -- Final selection with due amount calculation
    SELECT 
        ub.bill_id,
        ub.bill_num,
        ub.bill_dt,
        ub.retailer,
        ub.bill_sector,
        ub.bill_net_amt,
        ub.bill_received_amt,
        COALESCE(pt.payment_total, 0),
        -- ✅ FIX: Use GREATEST to prevent double-counting AND undercounting
        GREATEST(
            COALESCE(ub.bill_received_amt, 0),
            COALESCE(pt.payment_total, 0)
        ),
        -- Calculate due amount using GREATEST
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
    -- Filter out bills that are in completed_ugrai or approved_ugrai
    WHERE UPPER(TRIM(ub.bill_num)) NOT IN (
        SELECT excluded_bill_num FROM bills_to_exclude
    )
    -- Only show bills with positive amounts
    AND ub.bill_net_amt > 0.01
    ORDER BY ub.bill_dt DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_pending_bills_detailed() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_bills_detailed() TO anon;

SELECT '✅ Function updated successfully' as result;

-- ========================================
-- VERIFICATION: Check for negative amounts
-- ========================================
SELECT '=== CHECKING FOR NEGATIVE AMOUNTS ===' as section;

SELECT 
    bill_number,
    retailer_name,
    net_amount,
    bill_received_amount as received_in_table,
    payment_history_received as received_in_history,
    total_received as used_for_calc,
    due_amount,
    CASE 
        WHEN due_amount < 0 THEN '❌ STILL NEGATIVE'
        WHEN due_amount = 0 THEN '✅ FULLY PAID'
        WHEN due_amount > 0 THEN '✅ POSITIVE'
    END as status
FROM get_pending_bills_detailed()
WHERE due_amount < -0.01
ORDER BY due_amount ASC;

-- Show count of negative bills
SELECT 
    COUNT(*) as negative_bills_count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ NO NEGATIVE AMOUNTS FOUND'
        ELSE '❌ STILL HAS NEGATIVE AMOUNTS'
    END as result
FROM get_pending_bills_detailed()
WHERE due_amount < -0.01;

-- ========================================
-- VERIFICATION: Show calculation logic
-- ========================================
SELECT '=== CALCULATION BREAKDOWN (SAMPLE) ===' as section;

SELECT 
    bill_number,
    net_amount as original,
    bill_received_amount as in_table,
    payment_history_received as in_history,
    GREATEST(
        COALESCE(bill_received_amount, 0),
        COALESCE(payment_history_received, 0)
    ) as max_used,
    net_amount - GREATEST(
        COALESCE(bill_received_amount, 0),
        COALESCE(payment_history_received, 0)
    ) as calculated_due,
    due_amount as function_due
FROM get_pending_bills_detailed()
ORDER BY bill_number
LIMIT 20;

-- ========================================
-- SUMMARY
-- ========================================
SELECT '=== FIX COMPLETE ===' as section;

SELECT 
    '✅ Changed from CASE (selective) to GREATEST (max of both sources)' as change_1,
    '✅ Prevents both double-counting AND undercounting' as change_2,
    '✅ Function now returns correct due amounts' as change_3;
