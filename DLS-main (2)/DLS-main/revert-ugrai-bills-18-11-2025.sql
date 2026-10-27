-- Revert UGRAI bills approved on 2025-11-18 from approved_ugrai back to ugrai_entries (UGRAI Management)
-- Run this script to move bills back to UGRAI management

-- Step 1: Insert bills back into ugrai_entries from approved_ugrai
INSERT INTO ugrai_entries (
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    status,
    assigned_to,
    current_stage,
    user_id
)
SELECT 
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    'Pending' as status,  -- Reset to Pending status
    assigned_to,
    'available' as current_stage,  -- Reset to available stage
    user_id
FROM approved_ugrai
WHERE date_approved = '2025-11-18';

-- Step 2: Delete bills from approved_ugrai
DELETE FROM approved_ugrai
WHERE date_approved = '2025-11-18';

-- Verification queries (run these to confirm the revert was successful)
-- SELECT COUNT(*) as "Bills in ugrai_entries for 2025-11-18" 
-- FROM ugrai_entries WHERE bill_date = '2025-11-18';

-- SELECT COUNT(*) as "Bills in approved_ugrai for 2025-11-18" 
-- FROM approved_ugrai WHERE date_approved = '2025-11-18';

-- View the reverted bills
-- SELECT bill_number, retailer_name, sector, net_amount, status 
-- FROM ugrai_entries 
-- WHERE bill_date = '2025-11-18'
-- ORDER BY bill_number;
