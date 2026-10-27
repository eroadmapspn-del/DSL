-- Update all ugrai_entries to use the correct user_id
-- This fixes the issue where bills were transferred with default test UUID
-- but the app is using a different user_id

-- Update all records in ugrai_entries table
UPDATE ugrai_entries
SET user_id = '91fedb12-77d7-41a2-880a-467b401949da'
WHERE user_id = '00000000-0000-0000-0000-000000000001';

-- Verify the update
SELECT 
    user_id,
    COUNT(*) as bill_count,
    SUM(net_amount) as total_amount
FROM ugrai_entries
GROUP BY user_id;

-- Show sample of updated records
SELECT 
    bill_number,
    retailer_name,
    sector,
    net_amount,
    status,
    user_id
FROM ugrai_entries
ORDER BY created_at DESC
LIMIT 10;
