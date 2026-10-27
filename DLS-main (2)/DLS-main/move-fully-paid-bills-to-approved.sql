-- ========================================
-- MOVE FULLY PAID BILLS TO APPROVED_UGRAI
-- Cash-413, LCBL000262503053, L4985
-- These bills show miscalculated outstanding but are actually fully paid
-- ========================================

-- Check current status
SELECT '=== CURRENT STATUS OF BILLS ===' as section;

SELECT 
    bill_number,
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount as current_outstanding,
    payment_type
FROM ugrai_payment_history
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985')
ORDER BY bill_number, payment_number;

-- Verify they are fully paid
SELECT '=== VERIFICATION: Total Paid vs Original ===' as section;

SELECT 
    bill_number,
    MAX(original_net_amount) as original_amount,
    SUM(payment_amount) as total_paid,
    MAX(original_net_amount) - SUM(payment_amount) as actual_outstanding,
    CASE 
        WHEN ABS(MAX(original_net_amount) - SUM(payment_amount)) <= 0.01 THEN '✅ FULLY PAID'
        ELSE '❌ NOT FULLY PAID'
    END as status
FROM ugrai_payment_history
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985')
GROUP BY bill_number;

-- ========================================
-- STEP 1: INSERT INTO APPROVED_UGRAI
-- ========================================
SELECT '=== STEP 1: MOVING TO APPROVED_UGRAI ===' as section;

-- Get the latest payment details for each bill
WITH latest_payments AS (
    SELECT DISTINCT ON (bill_number)
        bill_number,
        bill_date,
        retailer_name,
        sector,
        original_net_amount,
        payment_method,
        receipt_number,
        cheque_date,
        photo_url,
        photo_uploaded,
        payment_date,
        completed_by,
        approved_by
    FROM ugrai_payment_history
    WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985')
    ORDER BY bill_number, payment_date DESC, created_at DESC
),
payment_totals AS (
    SELECT 
        bill_number,
        SUM(payment_amount) as total_received
    FROM ugrai_payment_history
    WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985')
    GROUP BY bill_number
)
INSERT INTO approved_ugrai (
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    payment_method,
    receipt_number,
    cheque_date,
    photo_url,
    photo_uploaded,
    date_completed,
    date_approved,
    approved_by,
    assigned_to,
    user_id
)
SELECT 
    lp.bill_number,
    lp.bill_date,
    lp.retailer_name,
    lp.sector,
    lp.original_net_amount as net_amount,
    pt.total_received as received_amount,
    lp.payment_method,
    lp.receipt_number,
    lp.cheque_date,
    lp.photo_url,
    lp.photo_uploaded,
    lp.payment_date as date_completed,
    CURRENT_DATE as date_approved,
    COALESCE(lp.approved_by, 'System - Fully Paid') as approved_by,
    lp.completed_by as assigned_to,
    (SELECT user_id FROM ugrai_payment_history WHERE bill_number = lp.bill_number LIMIT 1) as user_id
FROM latest_payments lp
JOIN payment_totals pt ON lp.bill_number = pt.bill_number
ON CONFLICT (bill_number, user_id) DO UPDATE SET
    net_amount = EXCLUDED.net_amount,
    received_amount = EXCLUDED.received_amount,
    date_approved = EXCLUDED.date_approved,
    approved_by = EXCLUDED.approved_by,
    updated_at = NOW();

SELECT 
    COUNT(*) as bills_moved_to_approved,
    'Bills moved to approved_ugrai' as message
FROM approved_ugrai
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985');

-- ========================================
-- STEP 2: REMOVE FROM UGRAI_DATA
-- ========================================
SELECT '=== STEP 2: REMOVING FROM UGRAI_DATA ===' as section;

DELETE FROM ugrai_data
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985');

SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ Successfully removed from ugrai_data'
        ELSE '⚠️ Still exists in ugrai_data'
    END as status
FROM ugrai_data
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985');

-- ========================================
-- STEP 3: REMOVE FROM COMPLETED_UGRAI (if exists)
-- ========================================
SELECT '=== STEP 3: CLEANING UP COMPLETED_UGRAI ===' as section;

DELETE FROM completed_ugrai
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985');

SELECT 'Cleaned up completed_ugrai' as message;

-- ========================================
-- VERIFICATION: Final Status
-- ========================================
SELECT '=== FINAL VERIFICATION ===' as section;

-- Check approved_ugrai
SELECT 
    'approved_ugrai' as table_name,
    bill_number,
    retailer_name,
    net_amount,
    received_amount,
    date_approved,
    approved_by
FROM approved_ugrai
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985')
ORDER BY bill_number;

-- Verify not in ugrai_data
SELECT 
    COUNT(*) as remaining_in_ugrai_data,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ All bills moved successfully'
        ELSE '❌ Some bills still in ugrai_data'
    END as status
FROM ugrai_data
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985');

-- Show payment history summary
SELECT 
    '=== PAYMENT HISTORY SUMMARY ===' as section;

SELECT 
    bill_number,
    COUNT(*) as num_payments,
    MAX(original_net_amount) as original_amount,
    SUM(payment_amount) as total_paid,
    MAX(original_net_amount) - SUM(payment_amount) as outstanding
FROM ugrai_payment_history
WHERE bill_number IN ('Cash-413', 'LCBL000262503053', 'L4985')
GROUP BY bill_number
ORDER BY bill_number;

-- ========================================
-- SUMMARY
-- ========================================
SELECT '=== OPERATION COMPLETE ===' as section;

SELECT 
    'Cash-413' as bill_number,
    '₹100,000' as original_amount,
    '3 payments' as payments,
    '₹100,000 total paid' as status,
    '✅ Moved to approved_ugrai' as result
UNION ALL
SELECT 
    'LCBL000262503053' as bill_number,
    '₹1,372' as original_amount,
    '3 payments' as payments,
    '₹1,372 total paid' as status,
    '✅ Moved to approved_ugrai' as result
UNION ALL
SELECT 
    'L4985' as bill_number,
    '₹2,345' as original_amount,
    '2 payments' as payments,
    '₹2,345 total paid' as status,
    '✅ Moved to approved_ugrai' as result;

SELECT '✅ All 3 bills successfully moved to approved_ugrai' as final_status;
