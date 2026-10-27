-- Query to check partial payment bills in ugrai_data and identify missing ones
-- 
-- This query identifies:
-- 1. Bills IN ugrai_data that have partial payments (correct placement)
-- 2. Bills NOT IN ugrai_data but have partial payments (should be there but missing)
-- 3. Validates against ugrai_payment_history to ensure data consistency

-- Part 1: Get all partial payment bills from ugrai_payment_history
WITH partial_payment_bills AS (
    SELECT 
        bill_number,
        original_net_amount,
        SUM(payment_amount) as total_paid,
        original_net_amount - SUM(payment_amount) as due_amount,
        COUNT(*) as payment_count,
        MAX(payment_date) as last_payment_date
    FROM ugrai_payment_history
    GROUP BY bill_number, original_net_amount
    HAVING SUM(payment_amount) < original_net_amount  -- Partial payments only
),

-- Part 2: Check which partial payment bills are in ugrai_data
bills_in_ugrai_data AS (
    SELECT 
        ud.bill_number,
        ud.bill_date,
        ud.retailer_name,
        ud.sector,
        ud.net_amount,
        ud.received_amount,
        ud.status,
        ud.assigned_to,
        (ud.net_amount - ud.received_amount) as calculated_due,
        'IN_UGRAI_DATA' as location
    FROM ugrai_data ud
    INNER JOIN partial_payment_bills ppb ON ud.bill_number = ppb.bill_number
),

-- Part 3: Check completed_ugrai for partial payments NOT in ugrai_data
missing_from_ugrai_data AS (
    SELECT 
        cu.bill_number,
        cu.bill_date,
        cu.retailer_name,
        cu.sector,
        cu.net_amount,
        cu.received_amount,
        'Completed' as status,
        cu.assigned_to,
        (cu.net_amount - cu.received_amount) as calculated_due,
        'MISSING_FROM_UGRAI_DATA' as location
    FROM completed_ugrai cu
    WHERE cu.received_amount < cu.net_amount  -- Partial payment
    AND NOT EXISTS (
        SELECT 1 FROM ugrai_data ud 
        WHERE ud.bill_number = cu.bill_number
    )
)

-- Final output: Show both groups
SELECT 
    location,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    calculated_due as due_amount,
    status,
    assigned_to
FROM (
    SELECT * FROM bills_in_ugrai_data
    UNION ALL
    SELECT * FROM missing_from_ugrai_data
) combined
ORDER BY 
    CASE 
        WHEN location = 'MISSING_FROM_UGRAI_DATA' THEN 1  -- Show missing bills first (priority)
        ELSE 2
    END,
    bill_date DESC,
    bill_number;

-- Summary counts
SELECT 
    location,
    COUNT(*) as bill_count,
    SUM(net_amount) as total_net_amount,
    SUM(received_amount) as total_received,
    SUM(calculated_due) as total_due
FROM (
    SELECT 
        'IN_UGRAI_DATA' as location,
        ud.net_amount,
        ud.received_amount,
        (ud.net_amount - ud.received_amount) as calculated_due
    FROM ugrai_data ud
    INNER JOIN partial_payment_bills ppb ON ud.bill_number = ppb.bill_number
    
    UNION ALL
    
    SELECT 
        'MISSING_FROM_UGRAI_DATA' as location,
        cu.net_amount,
        cu.received_amount,
        (cu.net_amount - cu.received_amount) as calculated_due
    FROM completed_ugrai cu
    WHERE cu.received_amount < cu.net_amount
    AND NOT EXISTS (
        SELECT 1 FROM ugrai_data ud 
        WHERE ud.bill_number = cu.bill_number
    )
) summary
GROUP BY location;

-- Additional check: Bills in ugrai_data that might have payment history
SELECT 
    ud.bill_number,
    ud.net_amount as ugrai_data_net_amount,
    ud.received_amount as ugrai_data_received,
    ppb.original_net_amount as payment_history_original,
    ppb.total_paid as payment_history_total_paid,
    ppb.due_amount as payment_history_due,
    ppb.payment_count,
    CASE 
        WHEN ppb.bill_number IS NULL THEN '❌ No payment history found'
        WHEN ppb.due_amount != (ud.net_amount - ud.received_amount) THEN '⚠️ Amount mismatch'
        ELSE '✅ Data consistent'
    END as data_status
FROM ugrai_data ud
LEFT JOIN partial_payment_bills ppb ON ud.bill_number = ppb.bill_number
WHERE ud.received_amount > 0 OR ppb.bill_number IS NOT NULL
ORDER BY data_status, ud.bill_number;
