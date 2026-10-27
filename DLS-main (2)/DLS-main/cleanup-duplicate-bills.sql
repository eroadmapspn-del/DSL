-- Cleanup Script: Remove bills from completed_ugrai that already exist in approved_ugrai
-- This should be run periodically or as a one-time cleanup

-- ============================================================================
-- PART 1: Identify duplicate bills
-- ============================================================================

-- Show bills that exist in BOTH completed_ugrai AND approved_ugrai (shouldn't happen!)
SELECT 
    'Duplicate Bills Found' as status,
    cu.id as completed_id,
    cu.bill_number,
    cu.bill_date,
    cu.retailer_name,
    cu.net_amount as completed_amount,
    cu.received_amount as completed_received,
    au.net_amount as approved_amount,
    au.received_amount as approved_received,
    au.date_approved
FROM completed_ugrai cu
INNER JOIN approved_ugrai au 
    ON cu.bill_number = au.bill_number 
    AND cu.user_id = au.user_id
ORDER BY au.date_approved DESC;

-- Count of duplicates
SELECT 
    'Summary' as status,
    (SELECT COUNT(*) FROM completed_ugrai) as total_in_completed_ugrai,
    (SELECT COUNT(*) FROM approved_ugrai) as total_in_approved_ugrai,
    (SELECT COUNT(*) 
     FROM completed_ugrai cu 
     INNER JOIN approved_ugrai au 
        ON cu.bill_number = au.bill_number 
        AND cu.user_id = au.user_id) as duplicate_count;

-- ============================================================================
-- PART 2: Delete duplicate bills from completed_ugrai
-- ============================================================================

-- Remove bills from completed_ugrai that already exist in approved_ugrai
DELETE FROM completed_ugrai
WHERE id IN (
    SELECT cu.id
    FROM completed_ugrai cu
    INNER JOIN approved_ugrai au 
        ON cu.bill_number = au.bill_number 
        AND cu.user_id = au.user_id
);

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

-- Show results after cleanup
SELECT 
    'After Cleanup' as status,
    (SELECT COUNT(*) FROM completed_ugrai) as total_in_completed_ugrai,
    (SELECT COUNT(*) FROM approved_ugrai) as total_in_approved_ugrai,
    (SELECT COUNT(*) 
     FROM completed_ugrai cu 
     INNER JOIN approved_ugrai au 
        ON cu.bill_number = au.bill_number 
        AND cu.user_id = au.user_id) as remaining_duplicates;

-- Show remaining bills in completed_ugrai
SELECT 
    'Remaining in completed_ugrai' as status,
    id,
    bill_number,
    bill_date,
    retailer_name,
    net_amount,
    received_amount,
    payment_method,
    date_completed
FROM completed_ugrai
ORDER BY date_completed DESC;
