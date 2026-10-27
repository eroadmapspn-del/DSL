-- Remove Duplicate Bills from ugrai_data and ugrai_entries
-- Keep only the most recent entry for each bill_number per user

-- ============================================================================
-- PART 1: Identify duplicates
-- ============================================================================

-- Show duplicate bills in ugrai_data
SELECT 
    'Duplicates in ugrai_data' as table_name,
    bill_number,
    COUNT(*) as duplicate_count,
    STRING_AGG(id::text, ', ') as all_ids
FROM ugrai_data
GROUP BY user_id, bill_number
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Show duplicate bills in ugrai_entries  
SELECT 
    'Duplicates in ugrai_entries' as table_name,
    bill_number,
    COUNT(*) as duplicate_count,
    STRING_AGG(id::text, ', ') as all_ids
FROM ugrai_entries
GROUP BY user_id, bill_number
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Show detailed view of duplicates in ugrai_data
SELECT 
    bill_number,
    bill_date,
    retailer_name,
    net_amount,
    status,
    created_at,
    id
FROM ugrai_data
WHERE bill_number IN (
    SELECT bill_number
    FROM ugrai_data
    GROUP BY user_id, bill_number
    HAVING COUNT(*) > 1
)
ORDER BY bill_number, created_at DESC;

-- ============================================================================
-- PART 2: Remove duplicates - Keep the MOST RECENT entry
-- ============================================================================

-- Remove duplicate entries from ugrai_data (keep most recent by created_at)
DELETE FROM ugrai_data
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY user_id, bill_number 
                   ORDER BY created_at DESC
               ) as row_num
        FROM ugrai_data
    ) t
    WHERE row_num > 1
);

-- Remove duplicate entries from ugrai_entries (keep most recent by created_at)
DELETE FROM ugrai_entries
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY user_id, bill_number 
                   ORDER BY created_at DESC
               ) as row_num
        FROM ugrai_entries
    ) t
    WHERE row_num > 1
);

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

-- Verify no duplicates remain in ugrai_data
SELECT 
    'Remaining duplicates in ugrai_data' as status,
    COUNT(*) as duplicate_count
FROM (
    SELECT bill_number
    FROM ugrai_data
    GROUP BY user_id, bill_number
    HAVING COUNT(*) > 1
) t;

-- Verify no duplicates remain in ugrai_entries
SELECT 
    'Remaining duplicates in ugrai_entries' as status,
    COUNT(*) as duplicate_count
FROM (
    SELECT bill_number
    FROM ugrai_entries
    GROUP BY user_id, bill_number
    HAVING COUNT(*) > 1
) t;

-- Show final counts
SELECT 
    'Final Counts' as status,
    (SELECT COUNT(*) FROM ugrai_data) as ugrai_data_count,
    (SELECT COUNT(*) FROM ugrai_entries) as ugrai_entries_count,
    (SELECT COUNT(DISTINCT bill_number) FROM ugrai_data) as unique_bills_in_data,
    (SELECT COUNT(DISTINCT bill_number) FROM ugrai_entries) as unique_bills_in_entries;

-- ============================================================================
-- PART 4: Check for cross-table duplicates
-- ============================================================================

-- Check if any bills exist in BOTH ugrai_data AND ugrai_entries (this is okay, but good to know)
SELECT 
    'Bills in BOTH ugrai_data AND ugrai_entries' as status,
    ud.bill_number,
    ud.net_amount as data_amount,
    ue.net_amount as entries_amount,
    ud.status as data_status,
    ue.status as entries_status
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
ORDER BY ud.bill_number;
