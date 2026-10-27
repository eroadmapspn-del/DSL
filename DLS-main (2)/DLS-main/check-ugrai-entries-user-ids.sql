-- Check user_id distribution in ugrai_entries
-- This helps identify if the bills have the wrong user_id

-- 1. Check total records and unique user_ids
SELECT 
    'Total records in ugrai_entries' as description,
    COUNT(*) as count,
    COUNT(DISTINCT user_id) as unique_user_ids
FROM ugrai_entries;

-- 2. Show distribution of records by user_id
SELECT 
    user_id,
    COUNT(*) as bill_count,
    SUM(net_amount) as total_amount,
    MIN(created_at) as first_created,
    MAX(created_at) as last_created
FROM ugrai_entries
GROUP BY user_id
ORDER BY bill_count DESC;

-- 3. Sample bills from ugrai_entries
SELECT 
    bill_number,
    retailer_name,
    sector,
    net_amount,
    status,
    user_id,
    original_supply_id,
    created_at
FROM ugrai_entries
ORDER BY created_at DESC
LIMIT 10;

-- 4. Check user_ids in approved_bills for comparison
SELECT 
    'User IDs in approved_bills' as description,
    user_id,
    COUNT(*) as bill_count
FROM approved_bills
WHERE payment_method = 'Credit'
GROUP BY user_id;

-- 5. Check if ugrai_entries have current_stage column (from transfer function)
SELECT 
    current_stage,
    COUNT(*) as count
FROM ugrai_entries
GROUP BY current_stage;
