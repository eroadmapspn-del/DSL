-- ============================================================================
-- REPLICATE TOTAL UGRAI LOGIC IN SQL
-- This mimics the exact JavaScript logic in loadCombinedUgraiData()
-- Expected: 320 bills | Getting: 425 bills
-- ============================================================================

-- STEP 1: Get all bills from ugrai_data (with amount filter > 0.01)
WITH ugrai_data_bills AS (
    SELECT 
        'Ugrai Data' as source,
        bill_number,
        bill_date,
        retailer_name,
        sector,
        net_amount,
        0 as received_from_bill, -- ugrai_data doesn't have received_amount
        user_id
    FROM ugrai_data
    WHERE net_amount > 0.01 -- JavaScript filter: netAmount > 0.01
),

-- STEP 2: Get all bills from ugrai_entries (with amount filter > 0.01)
ugrai_entries_bills AS (
    SELECT 
        'Ugrai from Supplies' as source,
        bill_number,
        bill_date,
        retailer_name,
        sector,
        net_amount,
        0 as received_from_bill, -- ugrai_entries doesn't have received_amount field
        user_id
    FROM ugrai_entries
    WHERE net_amount > 0.01 -- JavaScript filter: netAmount > 0.01
),

-- STEP 3: Combine both sources (JavaScript: concat)
all_pending_bills AS (
    SELECT * FROM ugrai_data_bills
    UNION ALL  -- UNION ALL allows duplicates (same as JavaScript concat)
    SELECT * FROM ugrai_entries_bills
),

-- STEP 4: Get payment history and aggregate by bill_number
payment_aggregated AS (
    SELECT 
        UPPER(bill_number) as bill_number,
        SUM(payment_amount) as total_received
    FROM ugrai_payment_history
    GROUP BY UPPER(bill_number)
),

-- STEP 5: Add payment history to bills (JavaScript: map with paymentHistoryMap)
bills_with_payments AS (
    SELECT 
        apb.source,
        apb.bill_number,
        apb.bill_date,
        apb.retailer_name,
        apb.sector,
        apb.net_amount,
        COALESCE(pa.total_received, 0) as received_amount,
        apb.net_amount - COALESCE(pa.total_received, 0) as due_amount,
        apb.user_id
    FROM all_pending_bills apb
    LEFT JOIN payment_aggregated pa ON UPPER(apb.bill_number) = pa.bill_number
),

-- STEP 6: Get completed/approved bills to exclude (JavaScript: completedBillNumbers Set)
excluded_bills AS (
    SELECT DISTINCT UPPER(bill_number) as bill_number
    FROM completed_ugrai
    UNION
    SELECT DISTINCT UPPER(bill_number) as bill_number
    FROM approved_ugrai
),

-- STEP 7: Filter out excluded bills (JavaScript: filter)
final_bills AS (
    SELECT bwp.*
    FROM bills_with_payments bwp
    WHERE UPPER(bwp.bill_number) NOT IN (SELECT bill_number FROM excluded_bills)
)

-- ALL RESULTS IN ONE QUERY
SELECT 
    '=== INTERMEDIATE COUNTS ===' as section,
    'Step 1: ugrai_data bills (>0.01)' as step,
    (SELECT COUNT(*) FROM ugrai_data_bills) as count
UNION ALL
SELECT 
    '=== INTERMEDIATE COUNTS ===' as section,
    'Step 2: ugrai_entries bills (>0.01)' as step,
    (SELECT COUNT(*) FROM ugrai_entries_bills) as count
UNION ALL
SELECT 
    '=== INTERMEDIATE COUNTS ===' as section,
    'Step 3: Combined (with duplicates)' as step,
    (SELECT COUNT(*) FROM all_pending_bills) as count
UNION ALL
SELECT 
    '=== INTERMEDIATE COUNTS ===' as section,
    'Step 6: Excluded bills (completed/approved)' as step,
    (SELECT COUNT(*) FROM excluded_bills) as count
UNION ALL
SELECT 
    '=== INTERMEDIATE COUNTS ===' as section,
    'Step 7: Final bills (after exclusion)' as step,
    (SELECT COUNT(*) FROM final_bills) as count
UNION ALL
SELECT 
    '=== FINAL COUNT BREAKDOWN ===' as section,
    source as step,
    COUNT(*) as count
FROM final_bills
GROUP BY source
UNION ALL
SELECT 
    '=== TOTAL ===' as section,
    'TOTAL BILLS (should match UI: 425)' as step,
    COUNT(*) as count
FROM final_bills
UNION ALL
SELECT 
    '=== DUPLICATE ANALYSIS ===' as section,
    'Unique bill numbers' as step,
    COUNT(DISTINCT bill_number) as count
FROM final_bills
UNION ALL
SELECT 
    '=== DUPLICATE ANALYSIS ===' as section,
    'Total rows (with duplicates)' as step,
    COUNT(*) as count
FROM final_bills
UNION ALL
SELECT 
    '=== DUPLICATE ANALYSIS ===' as section,
    'Difference (duplicate count)' as step,
    (COUNT(*) - COUNT(DISTINCT bill_number)) as count
FROM final_bills
ORDER BY section, step;
