-- ============================================================================
-- DELETE APPROVED BILLS FROM PENDING TABLES
-- This script removes bills from ugrai_data and ugrai_entries that exist in approved_ugrai
-- Run this in Supabase SQL Editor after importing approved bills
-- ============================================================================

-- Step 1: Check how many bills will be affected (PREVIEW)
-- Run this first to see what will be deleted
SELECT 'ugrai_data' as table_name, COUNT(*) as bills_to_delete
FROM ugrai_data ud
WHERE EXISTS (
    SELECT 1 FROM approved_ugrai au
    WHERE au.bill_number = ud.bill_number
    AND au.user_id = ud.user_id
)

UNION ALL

SELECT 'ugrai_entries' as table_name, COUNT(*) as bills_to_delete
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 FROM approved_ugrai au
    WHERE au.bill_number = ue.bill_number
    AND au.user_id = ue.user_id
);

-- ============================================================================
-- Step 2: DELETE from ugrai_data
-- ============================================================================

DELETE FROM ugrai_data
WHERE EXISTS (
    SELECT 1 FROM approved_ugrai au
    WHERE au.bill_number = ugrai_data.bill_number
    AND au.user_id = ugrai_data.user_id
);

-- Check result
SELECT COUNT(*) as remaining_bills_in_ugrai_data FROM ugrai_data;

-- ============================================================================
-- Step 3: DELETE from ugrai_entries
-- ============================================================================

DELETE FROM ugrai_entries
WHERE EXISTS (
    SELECT 1 FROM approved_ugrai au
    WHERE au.bill_number = ugrai_entries.bill_number
    AND au.user_id = ugrai_entries.user_id
);

-- Check result
SELECT COUNT(*) as remaining_bills_in_ugrai_entries FROM ugrai_entries;

-- ============================================================================
-- Step 4: VERIFICATION - Show bills that exist in approved_ugrai vs pending tables
-- ============================================================================

-- Bills in approved_ugrai
SELECT 'approved_ugrai' as table_name, COUNT(*) as bill_count
FROM approved_ugrai

UNION ALL

-- Bills remaining in ugrai_data
SELECT 'ugrai_data (remaining)' as table_name, COUNT(*) as bill_count
FROM ugrai_data

UNION ALL

-- Bills remaining in ugrai_entries
SELECT 'ugrai_entries (remaining)' as table_name, COUNT(*) as bill_count
FROM ugrai_entries;

-- ============================================================================
-- FINAL CHECK: Verify no overlap (should return 0 rows)
-- ============================================================================

-- Check for any bills still in ugrai_data that are also in approved_ugrai
SELECT 'ERROR: Still in ugrai_data' as issue, ud.bill_number, ud.retailer_name, ud.net_amount
FROM ugrai_data ud
WHERE EXISTS (
    SELECT 1 FROM approved_ugrai au
    WHERE au.bill_number = ud.bill_number
    AND au.user_id = ud.user_id
)

UNION ALL

-- Check for any bills still in ugrai_entries that are also in approved_ugrai
SELECT 'ERROR: Still in ugrai_entries' as issue, ue.bill_number, ue.retailer_name, ue.net_amount
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 FROM approved_ugrai au
    WHERE au.bill_number = ue.bill_number
    AND au.user_id = ue.user_id
);

-- If this query returns 0 rows, cleanup is complete! ✅
