-- ========================================
-- COMPREHENSIVE UGRAI PAYMENT HISTORY DIAGNOSTIC
-- Identifies both duplicate payments AND miscalculations
-- ========================================

-- ========================================
-- PROBLEM 1: DUPLICATE PAYMENTS (Negative Balances)
-- ========================================
SELECT '=== DUPLICATE PAYMENT ANALYSIS ===' as section;

-- Find bills with negative outstanding (overpayment - likely duplicates)
WITH payment_totals AS (
    SELECT 
        bill_number,
        original_net_amount,
        SUM(payment_amount) as total_paid,
        original_net_amount - SUM(payment_amount) as actual_outstanding,
        COUNT(*) as payment_count,
        COUNT(DISTINCT payment_amount) as unique_amounts
    FROM ugrai_payment_history
    GROUP BY bill_number, original_net_amount
)
SELECT 
    bill_number,
    original_net_amount,
    total_paid,
    actual_outstanding,
    payment_count,
    unique_amounts,
    CASE 
        WHEN actual_outstanding < 0 THEN '❌ OVERPAID (Duplicates)'
        WHEN actual_outstanding = 0 THEN '✅ FULLY PAID'
        ELSE '⚠️ PARTIAL PAYMENT'
    END as status,
    CASE 
        WHEN payment_count > unique_amounts THEN '🔴 LIKELY HAS DUPLICATES'
        ELSE '✅ Unique payments'
    END as duplicate_check
FROM payment_totals
WHERE actual_outstanding < 0  -- Overpaid bills
ORDER BY actual_outstanding ASC;

-- Detailed view of suspected duplicate payments
SELECT '=== SUSPECTED DUPLICATE PAYMENT DETAILS ===' as section;

WITH overpaid_bills AS (
    SELECT bill_number
    FROM ugrai_payment_history
    GROUP BY bill_number, original_net_amount
    HAVING original_net_amount - SUM(payment_amount) < 0
)
SELECT 
    uph.bill_number,
    uph.payment_number,
    uph.payment_date,
    uph.payment_amount,
    uph.outstanding_amount,
    uph.payment_method,
    uph.completed_by,
    uph.approved_by,
    uph.date_approved,
    uph.created_at,
    -- Look for duplicate amounts on same date
    COUNT(*) OVER (
        PARTITION BY uph.bill_number, uph.payment_amount, uph.payment_date
    ) as same_amount_same_date_count,
    CASE 
        WHEN COUNT(*) OVER (PARTITION BY uph.bill_number, uph.payment_amount, uph.payment_date) > 1 
        THEN '🔴 DUPLICATE'
        ELSE '✅ Unique'
    END as duplicate_flag
FROM ugrai_payment_history uph
WHERE uph.bill_number IN (SELECT bill_number FROM overpaid_bills)
ORDER BY uph.bill_number, uph.payment_date, uph.created_at;

-- ========================================
-- PROBLEM 2: FIRST PAYMENT MISCALCULATION
-- ========================================
SELECT '=== FIRST PAYMENT MISCALCULATION ANALYSIS ===' as section;

-- Pattern: First payment shows cumulative_paid > payment_amount
-- This indicates the first payment was entered with wrong original amount
WITH first_payments AS (
    SELECT 
        bill_number,
        payment_number,
        payment_amount,
        original_net_amount,
        outstanding_amount,
        SUM(payment_amount) OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as cumulative_paid,
        ROW_NUMBER() OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as payment_seq
    FROM ugrai_payment_history
)
SELECT 
    bill_number,
    payment_number,
    payment_seq,
    payment_amount,
    original_net_amount,
    cumulative_paid,
    outstanding_amount,
    CASE 
        WHEN payment_seq = 1 AND cumulative_paid > payment_amount 
        THEN '❌ FIRST PAYMENT SHOWS HIGHER CUMULATIVE (Wrong original amount entered)'
        WHEN payment_seq = 1 AND cumulative_paid = payment_amount 
        THEN '✅ CORRECT'
        ELSE 'Not first payment'
    END as diagnosis
FROM first_payments
WHERE payment_seq = 1 
  AND cumulative_paid > payment_amount
ORDER BY bill_number;

-- ========================================
-- PROBLEM 3: SUBSEQUENT PAYMENT MISCALCULATION
-- ========================================
SELECT '=== SUBSEQUENT PAYMENT MISCALCULATION ANALYSIS ===' as section;

-- Pattern: Payment 2+ has outstanding != previous_outstanding - current_payment
WITH payment_sequence AS (
    SELECT 
        bill_number,
        payment_number,
        payment_date,
        payment_amount,
        outstanding_amount,
        LAG(outstanding_amount) OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as prev_outstanding,
        ROW_NUMBER() OVER (PARTITION BY bill_number ORDER BY payment_date, created_at) as payment_seq
    FROM ugrai_payment_history
),
miscalculated AS (
    SELECT 
        bill_number,
        payment_number,
        payment_seq,
        payment_amount,
        prev_outstanding,
        outstanding_amount as recorded_outstanding,
        prev_outstanding - payment_amount as expected_outstanding,
        outstanding_amount - (prev_outstanding - payment_amount) as error_amount
    FROM payment_sequence
    WHERE payment_seq > 1  -- Only check payments after the first
      AND prev_outstanding IS NOT NULL
      AND ABS(outstanding_amount - (prev_outstanding - payment_amount)) > 0.01  -- Allow rounding
)
SELECT 
    bill_number,
    payment_number,
    payment_seq,
    payment_amount,
    prev_outstanding,
    expected_outstanding,
    recorded_outstanding,
    error_amount,
    '❌ MISCALCULATED FROM ORIGINAL AMOUNT (Bug we fixed)' as diagnosis
FROM miscalculated
ORDER BY ABS(error_amount) DESC, bill_number, payment_seq;

-- ========================================
-- COMBINED SUMMARY
-- ========================================
SELECT '=== COMPREHENSIVE SUMMARY ===' as section;

WITH problem_categorization AS (
    SELECT 
        bill_number,
        original_net_amount,
        SUM(payment_amount) as total_paid,
        original_net_amount - SUM(payment_amount) as net_outstanding,
        COUNT(*) as payment_count,
        CASE 
            WHEN original_net_amount - SUM(payment_amount) < -0.01 
            THEN 'DUPLICATE_OVERPAID'
            WHEN MAX(CASE 
                WHEN payment_number = 1 
                THEN payment_amount 
                END) != MIN(CASE 
                    WHEN payment_number = 1 
                    THEN (SELECT SUM(payment_amount) 
                          FROM ugrai_payment_history 
                          WHERE bill_number = uph.bill_number 
                          AND payment_number = 1)
                    END)
            THEN 'FIRST_PAYMENT_WRONG_ORIGINAL'
            ELSE 'MISCALCULATED_OUTSTANDING'
        END as problem_type
    FROM ugrai_payment_history uph
    GROUP BY bill_number, original_net_amount
)
SELECT 
    problem_type,
    COUNT(*) as affected_bills_count,
    SUM(payment_count) as total_payments_affected,
    ROUND(SUM(ABS(net_outstanding))::numeric, 2) as total_error_amount
FROM problem_categorization
WHERE net_outstanding < -0.01 
   OR problem_type != 'MISCALCULATED_OUTSTANDING'
GROUP BY problem_type
ORDER BY affected_bills_count DESC;

-- ========================================
-- ACTIONABLE: Bills to manually review
-- ========================================
SELECT '=== BILLS REQUIRING MANUAL REVIEW ===' as section;

SELECT 
    bill_number,
    retailer_name,
    original_net_amount,
    (SELECT SUM(payment_amount) FROM ugrai_payment_history WHERE bill_number = uph.bill_number) as total_paid,
    (original_net_amount - (SELECT SUM(payment_amount) FROM ugrai_payment_history WHERE bill_number = uph.bill_number)) as actual_outstanding,
    (SELECT COUNT(*) FROM ugrai_payment_history WHERE bill_number = uph.bill_number) as payment_count,
    CASE 
        WHEN (original_net_amount - (SELECT SUM(payment_amount) FROM ugrai_payment_history WHERE bill_number = uph.bill_number)) < 0 
        THEN '🔴 OVERPAID - Check for duplicates'
        ELSE '⚠️ MISCALCULATED - Run fix script'
    END as action_required
FROM ugrai_payment_history uph
WHERE bill_number IN (
    SELECT bill_number 
    FROM ugrai_payment_history
    GROUP BY bill_number, original_net_amount
    HAVING original_net_amount - SUM(payment_amount) < 0
       OR COUNT(DISTINCT payment_amount) < COUNT(*)
)
GROUP BY bill_number, retailer_name, original_net_amount
ORDER BY 
    CASE WHEN (original_net_amount - (SELECT SUM(payment_amount) FROM ugrai_payment_history WHERE bill_number = uph.bill_number)) < 0 THEN 0 ELSE 1 END,
    bill_number;

-- ========================================
-- SPECIFIC EXAMPLES FROM YOUR DATA
-- ========================================
SELECT '=== SPECIFIC EXAMPLES ===' as section;

-- Cash-375: Duplicate full payment (91113 x 2 = 182226 but original is 91113)
SELECT 'Cash-375: DUPLICATE PAYMENT' as example;
SELECT * FROM ugrai_payment_history WHERE bill_number = 'Cash-375' ORDER BY payment_date, created_at;

-- LCBL000262502759: Miscalculated second payment (your original example)
SELECT 'LCBL000262502759: MISCALCULATED OUTSTANDING' as example;
SELECT * FROM ugrai_payment_history WHERE bill_number = 'LCBL000262502759' ORDER BY payment_date, created_at;

-- L4964: First payment shows cumulative 1783 but amount is 783 (wrong original?)
SELECT 'L4964: WRONG ORIGINAL AMOUNT IN FIRST PAYMENT' as example;
SELECT * FROM ugrai_payment_history WHERE bill_number = 'L4964' ORDER BY payment_date, created_at;

-- LCBL000262502523: Recent miscalculation (payment 3)
SELECT 'LCBL000262502523: MISCALCULATED THIRD PAYMENT' as example;
SELECT * FROM ugrai_payment_history WHERE bill_number = 'LCBL000262502523' ORDER BY payment_date, created_at;
