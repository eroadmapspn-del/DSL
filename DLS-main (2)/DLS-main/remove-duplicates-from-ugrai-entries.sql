-- ============================================================================
-- REMOVE DUPLICATE BILLS FROM ugrai_entries
-- If a bill exists in BOTH ugrai_data AND ugrai_entries, remove it from ugrai_entries
-- ============================================================================

-- STEP 1: Check what will be deleted (PREVIEW - run this first!)
SELECT 
    'PREVIEW: Bills to be deleted from ugrai_entries' as action,
    ue.id,
    ue.bill_number,
    ue.retailer_name,
    ue.net_amount as entries_amount,
    ud.net_amount as data_amount,
    ue.sector as entries_sector,
    ud.sector as data_sector,
    ue.created_at
FROM ugrai_entries ue
INNER JOIN ugrai_data ud ON UPPER(ue.bill_number) = UPPER(ud.bill_number)
ORDER BY ue.bill_number;

-- STEP 2: Count how many will be deleted
SELECT 
    'Count of bills to be deleted' as summary,
    COUNT(*) as bills_to_delete,
    SUM(ue.net_amount) as total_amount_to_delete
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 FROM ugrai_data ud 
    WHERE UPPER(ud.bill_number) = UPPER(ue.bill_number)
);

-- STEP 3: Backup before deletion (OPTIONAL but RECOMMENDED)
-- Creates a backup table with timestamp
DO $$
DECLARE
    backup_table_name TEXT;
BEGIN
    backup_table_name := 'ugrai_entries_backup_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS');
    
    EXECUTE format('CREATE TABLE %I AS SELECT * FROM ugrai_entries WHERE EXISTS (
        SELECT 1 FROM ugrai_data ud WHERE UPPER(ud.bill_number) = UPPER(ugrai_entries.bill_number)
    )', backup_table_name);
    
    RAISE NOTICE 'Backup created: %', backup_table_name;
END $$;

-- STEP 4: Delete duplicates from ugrai_entries
-- CAUTION: This will permanently delete records!
DELETE FROM ugrai_entries
WHERE bill_number IN (
    SELECT UPPER(ue.bill_number)
    FROM ugrai_entries ue
    INNER JOIN ugrai_data ud ON UPPER(ue.bill_number) = UPPER(ud.bill_number)
);

-- STEP 5: Verify deletion
SELECT 
    'Verification after deletion' as summary,
    (SELECT COUNT(*) FROM ugrai_entries) as remaining_entries,
    (SELECT COUNT(*) FROM ugrai_data) as total_in_data,
    (SELECT COUNT(*) FROM ugrai_entries ue 
     WHERE EXISTS (SELECT 1 FROM ugrai_data ud WHERE UPPER(ud.bill_number) = UPPER(ue.bill_number))
    ) as duplicates_remaining;

-- STEP 6: Show what remains in ugrai_entries
SELECT 
    'Bills remaining in ugrai_entries (unique to this table)' as note,
    COUNT(*) as unique_entries_count,
    SUM(net_amount) as total_amount
FROM ugrai_entries;

-- STEP 7: List backup tables (if you need to restore)
SELECT 
    'Available backup tables' as info,
    tablename as backup_table
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE 'ugrai_entries_backup_%'
ORDER BY tablename DESC;

/*
-- TO RESTORE FROM BACKUP (if needed):
-- Replace 'ugrai_entries_backup_YYYYMMDD_HHMMSS' with your actual backup table name

INSERT INTO ugrai_entries 
SELECT * FROM ugrai_entries_backup_YYYYMMDD_HHMMSS
ON CONFLICT (user_id, bill_number) DO NOTHING;
*/
