-- ========================================
-- FIX UGRAI PAYMENT HISTORY - DUPLICATES AND MISCALCULATIONS
-- Removes duplicate payments and fixes miscalculated outstanding amounts
-- ========================================

-- SAFETY FIRST: Create backup
CREATE TABLE IF NOT EXISTS ugrai_payment_history_backup_full_20251130 AS 
SELECT * FROM ugrai_payment_history;

SELECT 'Full backup created: ugrai_payment_history_backup_full_20251130' as status;

-- ========================================
-- STEP 1: IDENTIFY AND REMOVE DUPLICATE PAYMENTS
-- ========================================
SELECT '=== STEP 1: REMOVING DUPLICATE PAYMENTS ===' as section;

-- Strategy: Keep the first occurrence, delete subsequent duplicates
-- Duplicate = same bill_number, same payment_amount, same payment_date

WITH duplicate_payments AS (
    SELECT 
        id,
        bill_number,
        payment_amount,
        payment_date,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY bill_number, payment_amount, payment_date 
            ORDER BY created_at ASC  -- Keep the first one created
        ) as occurrence_num
    FROM ugrai_payment_history
),
duplicates_to_delete AS (
    SELECT id, bill_number, payment_amount, payment_date
    FROM duplicate_payments
    WHERE occurrence_num > 1  -- Delete 2nd, 3rd, etc. occurrences
)
DELETE FROM ugrai_payment_history
WHERE id IN (SELECT id FROM duplicates_to_delete);

-- Report how many duplicates were removed
SELECT 
    COUNT(*) as duplicates_removed,
    'Duplicate payment entries have been deleted' as message
FROM ugrai_payment_history_backup_full_20251130 b
WHERE b.id NOT IN (SELECT id FROM ugrai_payment_history);

-- Show which bills were affected
SELECT '=== Bills with duplicates removed ===' as subsection;

SELECT DISTINCT
    b.bill_number,
    b.retailer_name,
    COUNT(*) as duplicates_removed
FROM ugrai_payment_history_backup_full_20251130 b
WHERE b.id NOT IN (SELECT id FROM ugrai_payment_history)
GROUP BY b.bill_number, b.retailer_name
ORDER BY duplicates_removed DESC;

-- ========================================
-- STEP 2: FIX OUTSTANDING AMOUNTS (cumulative calculation)
-- ========================================
SELECT '=== STEP 2: RECALCULATING OUTSTANDING AMOUNTS ===' as section;

-- Recalculate outstanding based on cumulative payments
WITH payment_cumulative AS (
    SELECT 
        id,
        bill_number,
        original_net_amount,
        SUM(payment_amount) OVER (
            PARTITION BY bill_number 
            ORDER BY payment_date, created_at
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) as cumulative_paid
    FROM ugrai_payment_history
),
correct_outstanding AS (
    SELECT 
        id,
        bill_number,
        cumulative_paid,
        GREATEST(original_net_amount - cumulative_paid, 0) as new_outstanding  -- Never negative
    FROM payment_cumulative
)
UPDATE ugrai_payment_history uph
SET outstanding_amount = co.new_outstanding,
    updated_at = NOW()
FROM correct_outstanding co
WHERE uph.id = co.id
  AND ABS(uph.outstanding_amount - co.new_outstanding) > 0.01;

-- Show what was fixed
SELECT 
    uph.bill_number,
    uph.payment_number,
    uph.payment_amount,
    b.outstanding_amount as old_outstanding,
    uph.outstanding_amount as new_outstanding,
    ROUND((b.outstanding_amount - uph.outstanding_amount)::numeric, 2) as correction
FROM ugrai_payment_history uph
JOIN ugrai_payment_history_backup_full_20251130 b ON uph.id = b.id
WHERE ABS(b.outstanding_amount - uph.outstanding_amount) > 0.01
ORDER BY uph.bill_number, uph.payment_number;

-- ========================================
-- VERIFICATION
-- ========================================
SELECT '=== VERIFICATION REPORT ===' as section;

-- Check 1: No negative outstanding amounts
SELECT 
    COUNT(*) as negative_outstanding_count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ No negative outstanding amounts'
        ELSE '❌ Still have negative outstanding'
    END as status
FROM ugrai_payment_history
WHERE outstanding_amount < -0.01;

-- Check 2: All outstanding calculations correct
WITH verification AS (
    SELECT 
        bill_number,
        original_net_amount,
        SUM(payment_amount) as total_paid,
        MAX(outstanding_amount) as last_outstanding,
        GREATEST(original_net_amount - SUM(payment_amount), 0) as expected_outstanding
    FROM ugrai_payment_history
    GROUP BY bill_number, original_net_amount
)
SELECT 
    COUNT(*) as miscalculated_count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ All outstanding amounts correct'
        ELSE '❌ Some bills still have errors'
    END as status
FROM verification
WHERE ABS(last_outstanding - expected_outstanding) > 0.01;

-- ========================================
-- SPECIFIC BILLS VERIFICATION
-- ========================================
SELECT '=== SPECIFIC BILLS AFTER FIX ===' as section;

-- LCBL000262502759 (your original example)
SELECT 'LCBL000262502759 (Original example)' as bill_check;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502759'
ORDER BY payment_number;

-- Cash-375 (duplicate example)
SELECT 'Cash-375 (Had duplicates)' as bill_check;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'Cash-375'
ORDER BY payment_number;

-- LCBL000262502523 (3 payments example)
SELECT 'LCBL000262502523 (3 payments)' as bill_check;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502523'
ORDER BY payment_number;

-- ========================================
-- SUMMARY STATISTICS
-- ========================================
SELECT '=== FINAL SUMMARY ===' as section;

SELECT 
    'Before Fix' as timing,
    COUNT(DISTINCT bill_number) as total_bills,
    COUNT(*) as total_payment_records,
    SUM(CASE WHEN outstanding_amount < 0 THEN 1 ELSE 0 END) as negative_outstanding
FROM ugrai_payment_history_backup_full_20251130
UNION ALL
SELECT 
    'After Fix' as timing,
    COUNT(DISTINCT bill_number) as total_bills,
    COUNT(*) as total_payment_records,
    SUM(CASE WHEN outstanding_amount < 0 THEN 1 ELSE 0 END) as negative_outstanding
FROM ugrai_payment_history;

-- Summary of changes
SELECT '=== CHANGES MADE ===' as section;

SELECT 
    'Duplicate payments deleted' as change_type,
    (SELECT COUNT(*) FROM ugrai_payment_history_backup_full_20251130) -
    (SELECT COUNT(*) FROM ugrai_payment_history) as count
UNION ALL
SELECT 
    'Outstanding amounts fixed' as change_type,
    COUNT(*) as count
FROM ugrai_payment_history_backup_full_20251130 b
JOIN ugrai_payment_history c ON b.id = c.id
WHERE ABS(b.outstanding_amount - c.outstanding_amount) > 0.01;

-- ========================================
-- ROLLBACK INSTRUCTIONS
-- ========================================
/*
-- If you need to rollback ALL changes:

DELETE FROM ugrai_payment_history;
INSERT INTO ugrai_payment_history 
SELECT * FROM ugrai_payment_history_backup_full_20251130;

DROP TABLE ugrai_payment_history_backup_full_20251130;
*/
