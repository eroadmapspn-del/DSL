-- ============================================================================
-- DEBUG: Why ugrai_entries is returning 0 rows
-- ============================================================================

-- Step 1: Check total count in ugrai_entries (bypass RLS with service role if needed)
SELECT 'Total rows in ugrai_entries' as check_type, COUNT(*) as count
FROM ugrai_entries;

-- Step 2: Check what user_ids exist in ugrai_entries
SELECT 
    'user_ids in ugrai_entries' as check_type,
    user_id,
    COUNT(*) as bill_count
FROM ugrai_entries
GROUP BY user_id
ORDER BY bill_count DESC;

-- Step 3: Check a sample of records
SELECT 
    id,
    user_id,
    bill_number,
    retailer_name,
    sector,
    net_amount,
    status,
    created_at
FROM ugrai_entries
LIMIT 10;

-- Step 4: Check if user_id '9cc4ab56-4287-4c19-ab9d-915859912b55' exists
SELECT 
    'Bills for target user_id' as check_type,
    COUNT(*) as count
FROM ugrai_entries
WHERE user_id = '9cc4ab56-4287-4c19-ab9d-915859912b55';

-- Step 5: Check RLS policies on ugrai_entries
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'ugrai_entries';

-- Step 6: Compare user_ids across all tables
SELECT 'ugrai_data' as table_name, user_id, COUNT(*) as count
FROM ugrai_data
GROUP BY user_id

UNION ALL

SELECT 'ugrai_entries' as table_name, user_id, COUNT(*) as count
FROM ugrai_entries
GROUP BY user_id

UNION ALL

SELECT 'approved_ugrai' as table_name, user_id, COUNT(*) as count
FROM approved_ugrai
GROUP BY user_id

UNION ALL

SELECT 'completed_ugrai' as table_name, user_id, COUNT(*) as count
FROM completed_ugrai
GROUP BY user_id

ORDER BY table_name, user_id;

-- ============================================================================
-- SOLUTION 1: If user_id is NULL in ugrai_entries
-- ============================================================================

-- Check for NULL user_ids
SELECT 'NULL user_ids in ugrai_entries' as issue, COUNT(*) as count
FROM ugrai_entries
WHERE user_id IS NULL;

-- If there are NULL user_ids, update them to the correct user_id:
-- UPDATE ugrai_entries
-- SET user_id = '9cc4ab56-4287-4c19-ab9d-915859912b55'
-- WHERE user_id IS NULL;

-- ============================================================================
-- SOLUTION 2: If user_id is wrong in ugrai_entries
-- ============================================================================

-- If all ugrai_entries have a different user_id, update them:
-- UPDATE ugrai_entries
-- SET user_id = '9cc4ab56-4287-4c19-ab9d-915859912b55'
-- WHERE user_id != '9cc4ab56-4287-4c19-ab9d-915859912b55';

-- Verify after update:
-- SELECT 'After fix' as status, COUNT(*) as count
-- FROM ugrai_entries
-- WHERE user_id = '9cc4ab56-4287-4c19-ab9d-915859912b55';
