-- ========================================
-- UGRAI PAYMENT HISTORY DIAGNOSTIC SCRIPT
-- Issue: Multiple payments not calculating cumulative outstanding correctly
-- ========================================

-- 1. Find bills with multiple payments (potential miscalculation)
-- ========================================
SELECT 
    bill_number,
    COUNT(*) as payment_count,
    SUM(payment_amount) as total_paid,
    MAX(original_net_amount) as original_amount,
    MAX(original_net_amount) - SUM(payment_amount) as correct_outstanding,
    MIN(outstanding_amount) as last_recorded_outstanding,
    CASE 
        WHEN (MAX(original_net_amount) - SUM(payment_amount)) != MIN(outstanding_amount) 
        THEN 'MISMATCH' 
        ELSE 'OK' 
    END as status
FROM ugrai_payment_history
GROUP BY bill_number
HAVING COUNT(*) > 1
ORDER BY payment_count DESC, bill_number;

-- 2. Detailed view of all payments for bills with issues
-- ========================================
WITH multi_payment_bills AS (
    SELECT bill_number
    FROM ugrai_payment_history
    GROUP BY bill_number
    HAVING COUNT(*) > 1
),
payment_details AS (
    SELECT 
        uph.*,
        ROW_NUMBER() OVER (PARTITION BY uph.bill_number ORDER BY uph.payment_date, uph.created_at) as payment_seq,
        SUM(uph.payment_amount) OVER (PARTITION BY uph.bill_number ORDER BY uph.payment_date, uph.created_at) as cumulative_paid,
        uph.original_net_amount - SUM(uph.payment_amount) OVER (PARTITION BY uph.bill_number ORDER BY uph.payment_date, uph.created_at) as correct_outstanding
    FROM ugrai_payment_history uph
    WHERE uph.bill_number IN (SELECT bill_number FROM multi_payment_bills)
)
SELECT 
    bill_number,
    payment_number,
    payment_date,
    payment_amount,
    cumulative_paid,
    outstanding_amount as recorded_outstanding,
    correct_outstanding,
    (correct_outstanding - outstanding_amount) as outstanding_error,
    CASE 
        WHEN correct_outstanding != outstanding_amount THEN '❌ WRONG'
        ELSE '✅ CORRECT'
    END as accuracy,
    payment_type,
    payment_method,
    completed_by,
    approved_by
FROM payment_details
ORDER BY bill_number, payment_seq;

-- 3. Summary of bills with outstanding calculation errors
-- ========================================
WITH payment_analysis AS (
    SELECT 
        bill_number,
        original_net_amount,
        SUM(payment_amount) as total_paid,
        MAX(outstanding_amount) as last_outstanding,
        original_net_amount - SUM(payment_amount) as correct_outstanding,
        COUNT(*) as payment_count
    FROM ugrai_payment_history
    GROUP BY bill_number, original_net_amount
    HAVING COUNT(*) > 1
)
SELECT 
    bill_number,
    original_net_amount,
    total_paid,
    correct_outstanding,
    last_outstanding,
    (last_outstanding - correct_outstanding) as error_amount,
    payment_count,
    CASE 
        WHEN last_outstanding != correct_outstanding THEN '❌ MISCALCULATED'
        ELSE '✅ CORRECT'
    END as status
FROM payment_analysis
WHERE last_outstanding != correct_outstanding
ORDER BY ABS(last_outstanding - correct_outstanding) DESC;

-- 4. Check LCBL000262502759 specifically
-- ========================================
SELECT 
    '=== LCBL000262502759 Detailed Analysis ===' as analysis_section;

SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    completed_by,
    approved_by,
    date_approved,
    notes,
    created_at
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502759'
ORDER BY payment_date, created_at;

-- Expected calculation for LCBL000262502759:
SELECT 
    '=== Expected Calculations ===' as calculation_section;

SELECT 
    'Payment 1' as payment,
    151184 as original_amount,
    50000 as payment_amount,
    151184 - 50000 as correct_outstanding,
    101184 as recorded_outstanding,
    CASE WHEN (151184 - 50000) = 101184 THEN '✅ CORRECT' ELSE '❌ WRONG' END as status
UNION ALL
SELECT 
    'Payment 2' as payment,
    151184 as original_amount,
    50000 + 100000 as cumulative_payment,
    151184 - (50000 + 100000) as correct_outstanding,
    51184 as recorded_outstanding,
    CASE WHEN (151184 - 150000) = 51184 THEN '✅ CORRECT' ELSE '❌ WRONG' END as status;

-- 5. Root Cause Analysis
-- ========================================
SELECT 
    '=== Root Cause Analysis ===' as root_cause_section;

WITH payment_sequence AS (
    SELECT 
        bill_number,
        payment_number,
        payment_date,
        payment_amount,
        outstanding_amount,
        original_net_amount,
        LAG(outstanding_amount) OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as prev_outstanding,
        LAG(payment_amount) OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as prev_payment
    FROM ugrai_payment_history
    WHERE bill_number = 'LCBL000262502759'
)
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    prev_outstanding,
    prev_outstanding - payment_amount as expected_outstanding,
    outstanding_amount as actual_outstanding,
    CASE 
        WHEN payment_number = 1 THEN 'First payment - calculated from original'
        WHEN prev_outstanding - payment_amount = outstanding_amount THEN '✅ Calculated from previous outstanding'
        WHEN original_net_amount - payment_amount = outstanding_amount THEN '❌ Calculated from ORIGINAL amount (BUG!)'
        ELSE '❓ Unknown calculation method'
    END as calculation_method
FROM payment_sequence
ORDER BY payment_number;

-- 6. Find all bills with the same error pattern
-- ========================================
SELECT 
    '=== All Bills with Same Error Pattern ===' as all_affected_bills_section;

WITH payment_sequence AS (
    SELECT 
        bill_number,
        payment_number,
        payment_date,
        payment_amount,
        outstanding_amount,
        original_net_amount,
        LAG(outstanding_amount) OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as prev_outstanding,
        ROW_NUMBER() OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as seq
    FROM ugrai_payment_history
),
error_check AS (
    SELECT 
        bill_number,
        payment_number,
        seq,
        payment_amount,
        prev_outstanding,
        outstanding_amount,
        original_net_amount,
        CASE 
            WHEN seq > 1 AND (original_net_amount - payment_amount) = outstanding_amount 
            THEN true 
            ELSE false 
        END as has_recalculation_bug
    FROM payment_sequence
)
SELECT DISTINCT
    bill_number,
    MAX(payment_number) as total_payments,
    MAX(original_net_amount) as original_amount,
    SUM(payment_amount) as total_paid,
    MAX(original_net_amount) - SUM(payment_amount) as correct_outstanding,
    MIN(CASE WHEN has_recalculation_bug THEN outstanding_amount END) as buggy_outstanding
FROM error_check
WHERE bill_number IN (
    SELECT bill_number 
    FROM error_check 
    WHERE has_recalculation_bug = true
)
GROUP BY bill_number
ORDER BY bill_number;

-- 7. Count affected bills
-- ========================================
SELECT 
    COUNT(DISTINCT bill_number) as affected_bills_count
FROM (
    WITH payment_sequence AS (
        SELECT 
            bill_number,
            payment_number,
            outstanding_amount,
            original_net_amount,
            payment_amount,
            LAG(outstanding_amount) OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as prev_outstanding,
            ROW_NUMBER() OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as seq
        FROM ugrai_payment_history
    )
    SELECT bill_number
    FROM payment_sequence
    WHERE seq > 1 
      AND (original_net_amount - payment_amount) = outstanding_amount
) affected;
