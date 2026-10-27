-- Fix Cross-Table Duplicates: Remove bills that exist in BOTH ugrai_data AND ugrai_entries
-- Strategy: Delete from ugrai_entries, then keep lowest due amount in ugrai_data

-- ============================================================================
-- PART 1: Identify the problem
-- ============================================================================

-- Show bills that exist in BOTH tables
SELECT 
    'Cross-table duplicates' as issue,
    ud.bill_number,
    ud.id as data_id,
    ud.net_amount as data_net_amount,
    ud.net_amount as data_due_amount,
    ud.created_at as data_created,
    ue.id as entries_id,
    ue.net_amount as entries_net_amount,
    ue.net_amount as entries_due_amount,
    ue.created_at as entries_created
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
ORDER BY ud.bill_number;

-- Show duplicates within ugrai_data (same bill appearing multiple times)
SELECT 
    'Within ugrai_data duplicates' as issue,
    bill_number,
    id,
    net_amount,
    net_amount as due_amount,
    status,
    created_at
FROM ugrai_data
WHERE bill_number IN (
    SELECT bill_number
    FROM ugrai_data
    GROUP BY user_id, bill_number
    HAVING COUNT(*) > 1
)
ORDER BY bill_number, net_amount ASC;

-- ============================================================================
-- PART 2: Step 1 - Remove bills from ugrai_entries that also exist in ugrai_data
-- ============================================================================

-- Delete from ugrai_entries where the bill also exists in ugrai_data
DELETE FROM ugrai_entries
WHERE bill_number IN (
    SELECT ue.bill_number
    FROM ugrai_entries ue
    INNER JOIN ugrai_data ud 
        ON ue.bill_number = ud.bill_number 
        AND ue.user_id = ud.user_id
);

-- ============================================================================
-- PART 3: Step 2 - Remove duplicates from ugrai_data, keep LOWEST due amount
-- ============================================================================

-- For duplicates in ugrai_data, keep the one with LOWEST net amount (due amount)
-- Delete all others
DELETE FROM ugrai_data
WHERE id IN (
    SELECT id
    FROM (
        SELECT 
            id,
            bill_number,
            user_id,
            net_amount,
            ROW_NUMBER() OVER (
                PARTITION BY user_id, bill_number 
                ORDER BY net_amount ASC,
                         created_at DESC
            ) as row_num
        FROM ugrai_data
    ) t
    WHERE row_num > 1
);

-- ============================================================================
-- PART 4: Verification
-- ============================================================================

-- Check for remaining cross-table duplicates
SELECT 
    'Remaining cross-table duplicates' as status,
    COUNT(*) as count
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id;

-- Check for remaining within-table duplicates in ugrai_data
SELECT 
    'Remaining duplicates in ugrai_data' as status,
    COUNT(*) as count
FROM (
    SELECT bill_number
    FROM ugrai_data
    GROUP BY user_id, bill_number
    HAVING COUNT(*) > 1
) t;

-- Check for remaining within-table duplicates in ugrai_entries
SELECT 
    'Remaining duplicates in ugrai_entries' as status,
    COUNT(*) as count
FROM (
    SELECT bill_number
    FROM ugrai_entries
    GROUP BY user_id, bill_number
    HAVING COUNT(*) > 1
) t;

-- Show final state for previously duplicated bills
SELECT 
    'Final state' as status,
    bill_number,
    net_amount,
    net_amount as due_amount,
    status as bill_status,
    created_at,
    'ugrai_data' as source_table
FROM ugrai_data
WHERE bill_number IN (
    -- Bills that had issues before
    SELECT DISTINCT bill_number 
    FROM ugrai_data 
    WHERE bill_number = 'Cash-357' -- Replace with actual bill number if different
)
UNION ALL
SELECT 
    'Final state' as status,
    bill_number,
    net_amount,
    net_amount as due_amount,
    status as bill_status,
    created_at,
    'ugrai_entries' as source_table
FROM ugrai_entries
WHERE bill_number IN (
    SELECT DISTINCT bill_number 
    FROM ugrai_entries 
    WHERE bill_number = 'Cash-357'
)
ORDER BY source_table, net_amount;

-- Show summary
SELECT 
    'Summary' as status,
    (SELECT COUNT(*) FROM ugrai_data) as ugrai_data_total,
    (SELECT COUNT(DISTINCT bill_number) FROM ugrai_data) as ugrai_data_unique,
    (SELECT COUNT(*) FROM ugrai_entries) as ugrai_entries_total,
    (SELECT COUNT(DISTINCT bill_number) FROM ugrai_entries) as ugrai_entries_unique;
