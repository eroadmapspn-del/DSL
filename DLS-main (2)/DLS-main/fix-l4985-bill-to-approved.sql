-- Fix L4985 bill: Consolidate duplicate entries and move to approved_ugrai
-- Bill L4985 has total received amount of 2368.00 (2345.00 + 23.00) = net_amount
-- This means the bill is FULLY PAID and should be in approved_ugrai

BEGIN;

-- Step 1: Verify the bill data
SELECT 
    'Current state in ugrai_data:' as step,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    user_id,
    created_at
FROM ugrai_data
WHERE bill_number = 'L4985'
ORDER BY created_at;

-- Step 2: Calculate total received amount
WITH payment_total AS (
    SELECT 
        bill_number,
        SUM(received_amount) as total_received,
        MAX(net_amount) as net_amount,
        COUNT(*) as record_count
    FROM ugrai_data
    WHERE bill_number = 'L4985'
    GROUP BY bill_number
)
SELECT 
    'Payment Summary:' as step,
    bill_number,
    total_received,
    net_amount,
    total_received - net_amount as outstanding,
    CASE 
        WHEN total_received >= net_amount THEN 'FULLY PAID ✓'
        ELSE 'PARTIAL PAYMENT'
    END as payment_status,
    record_count as duplicate_entries
FROM payment_total;

-- Step 3: Insert into approved_ugrai (using the first/older entry as the primary one)
-- Using user_id from the first entry (9cc4ab56-4287-4c19-ab9d-915859912b55)
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
    'L4985' as bill_number,
    DATE '2025-02-25' as bill_date,
    'NATIONAL MED HALL' as retailer_name,
    'Sector 8' as sector,
    2368.00 as net_amount,
    2368.00 as received_amount,  -- Total: 2345.00 + 23.00
    'Cash' as payment_method,    -- Default payment method
    '' as receipt_number,
    NULL as cheque_date,
    '' as photo_url,
    false as photo_uploaded,
    CURRENT_DATE as date_completed,
    CURRENT_DATE as date_approved,
    'System - Consolidated Duplicate Entries' as approved_by,
    NULL as assigned_to,
    '9cc4ab56-4287-4c19-ab9d-915859912b55'::uuid as user_id  -- Using first entry's user_id
WHERE NOT EXISTS (
    SELECT 1 FROM approved_ugrai WHERE bill_number = 'L4985'
);

-- Step 4: Delete all duplicate entries from ugrai_data
DELETE FROM ugrai_data
WHERE bill_number = 'L4985';

-- Step 5: Verify the move
SELECT 
    'Final verification - Bill in approved_ugrai:' as step,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    date_approved,
    approved_by,
    user_id
FROM approved_ugrai
WHERE bill_number = 'L4985';

-- Step 6: Confirm no duplicates remain in ugrai_data
SELECT 
    'Remaining in ugrai_data (should be 0):' as step,
    COUNT(*) as count
FROM ugrai_data
WHERE bill_number = 'L4985';

COMMIT;

-- Summary:
-- ✓ Bill L4985 had duplicate entries with partial payments totaling the full amount
-- ✓ Consolidated: 2345.00 + 23.00 = 2368.00 (matches net_amount)
-- ✓ Moved to approved_ugrai as FULLY PAID
-- ✓ Used user_id from the older entry (9cc4ab56-4287-4c19-ab9d-915859912b55)
-- ✓ Cleaned up duplicate entries from ugrai_data
