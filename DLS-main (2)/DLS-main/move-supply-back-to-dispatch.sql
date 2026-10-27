-- Move bill from active_supplies back to bills with dispatched status
-- Bill: NIV6014842501666

BEGIN;

-- Step 1: Verify the bill exists in active_supplies
SELECT 
    '1. Current state in active_supplies:' as step,
    id,
    bill_id,
    bill_number,
    retailer_name,
    sector,
    net_amount,
    brand,
    supply_through,
    status,
    user_id
FROM active_supplies
WHERE bill_number = 'NIV6014842501666';

-- Step 2: Check the corresponding bill in bills table
SELECT 
    '2. Current state in bills table:' as step,
    id,
    bill_number,
    retailer_name,
    sector,
    net_amount,
    brand,
    status,
    supply_through,
    user_id
FROM bills
WHERE bill_number = 'NIV6014842501666';

-- Step 3: Update the bill status back to 'dispatched' in bills table
UPDATE bills
SET 
    status = 'dispatched',
    updated_at = NOW()
WHERE bill_number = 'NIV6014842501666';

-- Step 4: Delete the entry from active_supplies
DELETE FROM active_supplies
WHERE bill_number = 'NIV6014842501666';

-- Step 5: Verify the bill is now back in dispatched status
SELECT 
    '3. Final state - Bill back in dispatched:' as step,
    id,
    bill_number,
    retailer_name,
    sector,
    net_amount,
    brand,
    status,
    supply_through,
    user_id
FROM bills
WHERE bill_number = 'NIV6014842501666';

-- Step 6: Verify it's removed from active_supplies
SELECT 
    '4. Verify removed from active_supplies:' as step,
    COUNT(*) as remaining_count
FROM active_supplies
WHERE bill_number = 'NIV6014842501666';

COMMIT;

-- Expected result: Bill should be back in bills table with status='dispatched' and removed from active_supplies
