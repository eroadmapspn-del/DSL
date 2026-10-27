-- Diagnose partial payment bills showing negative due amounts

-- Step 1: Find bills with payment history (partial payments)
SELECT '=== BILLS WITH PAYMENT HISTORY ===' as section;

SELECT 
    bill_number,
    COUNT(*) as payment_count,
    MAX(original_net_amount) as original_amount,
    SUM(payment_amount) as total_paid_from_history,
    MAX(original_net_amount) - SUM(payment_amount) as should_be_due
FROM ugrai_payment_history
GROUP BY bill_number
ORDER BY bill_number;

-- Step 2: Check what's in ugrai_data for these bills
SELECT '=== UGRAI_DATA VALUES FOR PARTIAL PAYMENT BILLS ===' as section;

SELECT 
    ud.bill_number,
    ud.net_amount as net_amount_in_ugrai_data,
    ud.received_amount as received_amount_in_ugrai_data,
    ph.original_net_amount as original_from_payment_history,
    ph.total_paid as paid_from_payment_history,
    ud.net_amount - COALESCE(ud.received_amount, 0) as calculated_due_from_table,
    ph.original_net_amount - ph.total_paid as calculated_due_from_history
FROM ugrai_data ud
JOIN (
    SELECT 
        bill_number,
        MAX(original_net_amount) as original_net_amount,
        SUM(payment_amount) as total_paid
    FROM ugrai_payment_history
    GROUP BY bill_number
) ph ON UPPER(TRIM(ud.bill_number)) = UPPER(TRIM(ph.bill_number))
ORDER BY ud.bill_number;

-- Step 3: Check what get_pending_bills_detailed returns
SELECT '=== FUNCTION OUTPUT FOR PARTIAL PAYMENT BILLS ===' as section;

SELECT 
    p.bill_number,
    p.net_amount as function_net_amount,
    p.bill_received_amount as function_bill_received,
    p.payment_history_received as function_payment_history,
    p.total_received as function_total_received,
    p.due_amount as function_due_amount,
    CASE 
        WHEN p.due_amount < 0 THEN ' NEGATIVE'
        WHEN p.due_amount = 0 THEN ' ZERO'
        ELSE ' POSITIVE'
    END as status
FROM get_pending_bills_detailed() p
WHERE EXISTS (
    SELECT 1 FROM ugrai_payment_history ph 
    WHERE UPPER(TRIM(ph.bill_number)) = UPPER(TRIM(p.bill_number))
)
ORDER BY p.bill_number;

-- Step 4: Compare the sources side by side
SELECT '=== SIDE BY SIDE COMPARISON ===' as section;

SELECT 
    ph.bill_number,
    ph.original_net_amount as ph_original,
    ud.net_amount as ud_net_amount,
    CASE 
        WHEN ph.original_net_amount = ud.net_amount THEN ' MATCH'
        ELSE ' MISMATCH - THIS IS THE PROBLEM!'
    END as net_amount_status,
    ph.total_paid as ph_total_paid,
    ud.received_amount as ud_received_amount,
    GREATEST(COALESCE(ud.received_amount, 0), ph.total_paid) as greatest_used,
    ph.original_net_amount - ph.total_paid as correct_due,
    ud.net_amount - GREATEST(COALESCE(ud.received_amount, 0), ph.total_paid) as calculated_due
FROM ugrai_payment_history ph
JOIN ugrai_data ud ON UPPER(TRIM(ph.bill_number)) = UPPER(TRIM(ud.bill_number))
WHERE ph.payment_number > 1  -- Only partial payment bills
GROUP BY ph.bill_number, ph.original_net_amount, ud.net_amount, ph.total_paid, ud.received_amount
HAVING ph.original_net_amount != ud.net_amount
ORDER BY ph.bill_number;

-- Step 5: Show the root cause
SELECT '=== ROOT CAUSE ANALYSIS ===' as section;

SELECT 
    'If net_amount in ugrai_data = outstanding (not original)' as issue,
    'Then: outstanding - total_paid = negative (double subtraction)' as result,
    'Example: 93,497 (outstanding) - 115,000 (paid) = -21,503' as example,
    'Should be: 208,497 (original) - 115,000 (paid) = 93,497' as correct;
