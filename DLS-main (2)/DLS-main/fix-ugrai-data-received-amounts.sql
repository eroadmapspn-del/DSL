-- ========================================
-- FIX UGRAI_DATA RECEIVED_AMOUNT COLUMN
-- Updates received_amount to show total cumulative paid amount
-- based on ugrai_payment_history
-- ========================================

-- SAFETY: Create backup
CREATE TABLE IF NOT EXISTS ugrai_data_backup_received_amount_20251130 AS 
SELECT * FROM ugrai_data WHERE received_amount IS NOT NULL;

SELECT 'Backup created: ugrai_data_backup_received_amount_20251130' as status;

-- ========================================
-- FIX RECEIVED_AMOUNT FOR BILLS WITH PAYMENT HISTORY
-- ========================================
SELECT '=== FIXING RECEIVED_AMOUNT IN UGRAI_DATA ===' as section;

-- Calculate total paid from payment history
WITH payment_totals AS (
    SELECT 
        bill_number,
        SUM(payment_amount) as total_paid,
        COUNT(*) as payment_count,
        MAX(original_net_amount) as original_amount
    FROM ugrai_payment_history
    GROUP BY bill_number
),
bills_in_ugrai_data AS (
    SELECT 
        ud.id,
        ud.bill_number,
        ud.net_amount as current_net_amount,
        ud.received_amount as old_received_amount,
        pt.total_paid as new_received_amount,
        pt.original_amount,
        pt.payment_count
    FROM ugrai_data ud
    INNER JOIN payment_totals pt ON ud.bill_number = pt.bill_number
    WHERE ud.received_amount IS NOT NULL  -- Only bills with partial payments
)
UPDATE ugrai_data ud
SET received_amount = bid.new_received_amount,
    updated_at = NOW()
FROM bills_in_ugrai_data bid
WHERE ud.id = bid.id
  AND ABS(COALESCE(ud.received_amount, 0) - bid.new_received_amount) > 0.01;

-- Report what was changed
SELECT 
    COUNT(*) as bills_updated,
    'Received amounts updated in ugrai_data' as message
FROM ugrai_data_backup_received_amount_20251130 b
JOIN ugrai_data c ON b.id = c.id
WHERE ABS(COALESCE(b.received_amount, 0) - COALESCE(c.received_amount, 0)) > 0.01;

-- ========================================
-- VERIFICATION: Show bills that were updated
-- ========================================
SELECT '=== BILLS UPDATED ===' as section;

SELECT 
    ud.bill_number,
    ud.retailer_name,
    b.received_amount as old_received_amount,
    ud.received_amount as new_received_amount,
    ud.net_amount as outstanding,
    ROUND((ud.received_amount - COALESCE(b.received_amount, 0))::numeric, 2) as difference,
    pt.payment_count as num_payments,
    pt.original_amount
FROM ugrai_data ud
JOIN ugrai_data_backup_received_amount_20251130 b ON ud.id = b.id
LEFT JOIN (
    SELECT bill_number, COUNT(*) as payment_count, MAX(original_net_amount) as original_amount
    FROM ugrai_payment_history
    GROUP BY bill_number
) pt ON ud.bill_number = pt.bill_number
WHERE ABS(COALESCE(b.received_amount, 0) - COALESCE(ud.received_amount, 0)) > 0.01
ORDER BY ud.bill_number;

-- ========================================
-- VERIFICATION: Check calculations are correct
-- ========================================
SELECT '=== VERIFICATION ===' as section;

WITH payment_totals AS (
    SELECT 
        bill_number,
        SUM(payment_amount) as total_paid,
        MAX(original_net_amount) as original_amount
    FROM ugrai_payment_history
    GROUP BY bill_number
)
SELECT 
    ud.bill_number,
    ud.retailer_name,
    pt.original_amount,
    ud.received_amount as received_in_ugrai_data,
    pt.total_paid as total_in_payment_history,
    ud.net_amount as outstanding,
    ROUND((pt.original_amount - pt.total_paid)::numeric, 2) as expected_outstanding,
    CASE 
        WHEN ABS(ud.received_amount - pt.total_paid) <= 0.01 THEN '✅ CORRECT'
        ELSE '❌ MISMATCH'
    END as received_status,
    CASE 
        WHEN ABS(ud.net_amount - (pt.original_amount - pt.total_paid)) <= 0.01 THEN '✅ CORRECT'
        ELSE '❌ MISMATCH'
    END as outstanding_status
FROM ugrai_data ud
INNER JOIN payment_totals pt ON ud.bill_number = pt.bill_number
WHERE ud.received_amount IS NOT NULL
ORDER BY 
    CASE WHEN ABS(ud.received_amount - pt.total_paid) > 0.01 THEN 0 ELSE 1 END,
    ud.bill_number;

-- ========================================
-- SUMMARY
-- ========================================
SELECT '=== SUMMARY ===' as section;

SELECT 
    COUNT(*) as total_bills_with_received_amount,
    SUM(CASE WHEN received_amount IS NOT NULL THEN 1 ELSE 0 END) as bills_with_value,
    SUM(CASE WHEN received_amount IS NULL THEN 1 ELSE 0 END) as bills_with_null
FROM ugrai_data;

-- Count how many match payment history
WITH payment_totals AS (
    SELECT 
        bill_number,
        SUM(payment_amount) as total_paid
    FROM ugrai_payment_history
    GROUP BY bill_number
)
SELECT 
    COUNT(*) as bills_checked,
    SUM(CASE WHEN ABS(ud.received_amount - pt.total_paid) <= 0.01 THEN 1 ELSE 0 END) as matching,
    SUM(CASE WHEN ABS(ud.received_amount - pt.total_paid) > 0.01 THEN 1 ELSE 0 END) as mismatched
FROM ugrai_data ud
INNER JOIN payment_totals pt ON ud.bill_number = pt.bill_number
WHERE ud.received_amount IS NOT NULL;

-- ========================================
-- ROLLBACK INSTRUCTIONS
-- ========================================
/*
-- If you need to rollback:

UPDATE ugrai_data ud
SET received_amount = b.received_amount,
    updated_at = NOW()
FROM ugrai_data_backup_received_amount_20251130 b
WHERE ud.id = b.id;

DROP TABLE ugrai_data_backup_received_amount_20251130;
*/
