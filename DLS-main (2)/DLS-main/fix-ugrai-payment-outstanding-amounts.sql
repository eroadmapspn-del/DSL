-- ========================================
-- FIX UGRAI PAYMENT HISTORY OUTSTANDING AMOUNTS
-- Recalculate all outstanding amounts based on cumulative payments
-- ========================================

-- BACKUP FIRST!
-- Create backup table
CREATE TABLE IF NOT EXISTS ugrai_payment_history_backup_20251130 AS 
SELECT * FROM ugrai_payment_history;

SELECT 'Backup created: ugrai_payment_history_backup_20251130' as status;

-- ========================================
-- PART 1: Identify affected bills
-- ========================================
SELECT '=== AFFECTED BILLS REPORT ===' as section;

WITH payment_analysis AS (
    SELECT 
        bill_number,
        payment_number,
        payment_date,
        payment_amount,
        outstanding_amount,
        original_net_amount,
        SUM(payment_amount) OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as cumulative_paid,
        original_net_amount - SUM(payment_amount) OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as correct_outstanding,
        ROW_NUMBER() OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as payment_seq
    FROM ugrai_payment_history
)
SELECT 
    bill_number,
    payment_number,
    payment_seq,
    payment_date,
    payment_amount,
    cumulative_paid,
    outstanding_amount as current_outstanding,
    correct_outstanding,
    (outstanding_amount - correct_outstanding) as error_amount,
    CASE 
        WHEN outstanding_amount != correct_outstanding THEN '❌ NEEDS FIX'
        ELSE '✅ CORRECT'
    END as status
FROM payment_analysis
WHERE bill_number IN (
    SELECT bill_number 
    FROM payment_analysis 
    WHERE outstanding_amount != correct_outstanding
)
ORDER BY bill_number, payment_seq;

-- ========================================
-- PART 2: Fix outstanding amounts
-- ========================================
SELECT '=== FIXING OUTSTANDING AMOUNTS ===' as section;

-- Update outstanding amounts based on cumulative payments
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
        original_net_amount - cumulative_paid as new_outstanding
    FROM payment_cumulative
)
UPDATE ugrai_payment_history uph
SET outstanding_amount = co.new_outstanding,
    updated_at = NOW()
FROM correct_outstanding co
WHERE uph.id = co.id
  AND uph.outstanding_amount != co.new_outstanding;

-- Report: How many rows were updated
SELECT 
    COUNT(*) as rows_updated,
    'Outstanding amounts have been recalculated' as message
FROM ugrai_payment_history_backup_20251130 b
JOIN ugrai_payment_history c ON b.id = c.id
WHERE b.outstanding_amount != c.outstanding_amount;

-- ========================================
-- PART 3: Fix payment notes for clarity
-- ========================================
SELECT '=== UPDATING PAYMENT NOTES ===' as section;

-- Update notes to show payment sequence and cumulative totals
WITH payment_sequence AS (
    SELECT 
        id,
        bill_number,
        payment_amount,
        outstanding_amount,
        original_net_amount,
        SUM(payment_amount) OVER (
            PARTITION BY bill_number 
            ORDER BY payment_date, created_at
        ) as cumulative_paid,
        ROW_NUMBER() OVER (
            PARTITION BY bill_number 
            ORDER BY payment_date, created_at
        ) as payment_seq,
        COUNT(*) OVER (PARTITION BY bill_number) as total_payments
    FROM ugrai_payment_history
),
updated_notes AS (
    SELECT 
        id,
        CASE 
            WHEN outstanding_amount <= 0 THEN
                CONCAT('Final payment ', payment_seq, ' of ', total_payments, ': ₹', payment_amount, ' (Total: ₹', cumulative_paid, ')')
            ELSE
                CONCAT('Payment ', payment_seq, ' of ', total_payments, ': ₹', payment_amount, ' (Total paid: ₹', cumulative_paid, ' of ₹', original_net_amount, ')')
        END as new_note
    FROM payment_sequence
    WHERE payment_seq > 1 OR total_payments > 1  -- Only update multi-payment bills
)
UPDATE ugrai_payment_history uph
SET notes = un.new_note,
    updated_at = NOW()
FROM updated_notes un
WHERE uph.id = un.id
  AND (uph.notes IS NULL OR uph.notes NOT LIKE 'Payment % of %:%');

-- ========================================
-- PART 4: Verification
-- ========================================
SELECT '=== VERIFICATION REPORT ===' as section;

-- Check if any bills still have miscalculated outstanding
WITH payment_check AS (
    SELECT 
        bill_number,
        original_net_amount,
        SUM(payment_amount) as total_paid,
        original_net_amount - SUM(payment_amount) as expected_outstanding,
        MAX(outstanding_amount) as last_outstanding
    FROM ugrai_payment_history
    GROUP BY bill_number, original_net_amount
)
SELECT 
    COUNT(*) as miscalculated_bills,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ ALL BILLS FIXED!'
        ELSE '❌ SOME BILLS STILL HAVE ERRORS'
    END as status
FROM payment_check
WHERE ABS(expected_outstanding - last_outstanding) > 0.01;

-- Show sample of corrected bills
SELECT 
    '=== SAMPLE OF CORRECTED BILLS ===' as section;

WITH before_after AS (
    SELECT 
        b.bill_number,
        b.payment_number,
        b.outstanding_amount as old_outstanding,
        c.outstanding_amount as new_outstanding,
        c.notes as new_notes
    FROM ugrai_payment_history_backup_20251130 b
    JOIN ugrai_payment_history c ON b.id = c.id
    WHERE b.outstanding_amount != c.outstanding_amount
)
SELECT * FROM before_after
ORDER BY bill_number, payment_number
LIMIT 20;

-- ========================================
-- PART 5: Specific fix for LCBL000262502759
-- ========================================
SELECT '=== LCBL000262502759 FIX REPORT ===' as section;

SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    notes,
    CASE payment_number
        WHEN 1 THEN '✅ Should be: 101,184 (151,184 - 50,000)'
        WHEN 2 THEN '✅ Should be: 1,184 (101,184 - 100,000 = 1,184)'
        ELSE 'Unknown'
    END as expected_value,
    CASE 
        WHEN payment_number = 1 AND outstanding_amount = 101184 THEN '✅ CORRECT'
        WHEN payment_number = 2 AND outstanding_amount = 1184 THEN '✅ FIXED!'
        ELSE '❌ CHECK REQUIRED'
    END as status
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502759'
ORDER BY payment_number;

-- ========================================
-- SUMMARY STATISTICS
-- ========================================
SELECT '=== FINAL SUMMARY ===' as section;

SELECT 
    'Total bills in payment history' as metric,
    COUNT(DISTINCT bill_number) as count
FROM ugrai_payment_history
UNION ALL
SELECT 
    'Bills with multiple payments' as metric,
    COUNT(DISTINCT bill_number) as count
FROM ugrai_payment_history
GROUP BY bill_number
HAVING COUNT(*) > 1
UNION ALL
SELECT 
    'Rows updated' as metric,
    COUNT(*) as count
FROM ugrai_payment_history_backup_20251130 b
JOIN ugrai_payment_history c ON b.id = c.id
WHERE b.outstanding_amount != c.outstanding_amount
UNION ALL
SELECT 
    'Bills now fully paid (outstanding = 0)' as metric,
    COUNT(DISTINCT bill_number) as count
FROM (
    SELECT bill_number, MAX(outstanding_amount) as final_outstanding
    FROM ugrai_payment_history
    GROUP BY bill_number
) x
WHERE final_outstanding <= 0.01;

-- ========================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ========================================
/*
-- If you need to rollback:

-- 1. Restore from backup
DELETE FROM ugrai_payment_history;
INSERT INTO ugrai_payment_history 
SELECT * FROM ugrai_payment_history_backup_20251130;

-- 2. Drop backup table
DROP TABLE ugrai_payment_history_backup_20251130;
*/
