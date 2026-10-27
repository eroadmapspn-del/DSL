-- ============================================================================
-- EXECUTE: REMOVE APPROVED/COMPLETED BILLS FROM ugrai_data & ugrai_entries
-- ⚠️ WARNING: This will PERMANENTLY DELETE records!
-- ⚠️ Only run this AFTER reviewing check-discrepancies-approved-completed.sql
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: CREATE AUTOMATIC BACKUPS
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    backup_data_table TEXT;
    backup_entries_table TEXT;
    data_count INT;
    entries_count INT;
BEGIN
    -- Generate timestamped backup table names
    backup_data_table := 'ugrai_data_backup_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS');
    backup_entries_table := 'ugrai_entries_backup_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS');
    
    -- Backup ugrai_data bills that will be deleted
    EXECUTE format('CREATE TABLE %I AS 
        SELECT * FROM ugrai_data WHERE EXISTS (
            SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ugrai_data.bill_number)
        ) OR EXISTS (
            SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ugrai_data.bill_number)
        )', backup_data_table);
    
    EXECUTE format('SELECT COUNT(*) FROM %I', backup_data_table) INTO data_count;
    RAISE NOTICE '✅ Backup created: % (% records)', backup_data_table, data_count;
    
    -- Backup ugrai_entries bills that will be deleted
    EXECUTE format('CREATE TABLE %I AS 
        SELECT * FROM ugrai_entries WHERE EXISTS (
            SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ugrai_entries.bill_number)
        ) OR EXISTS (
            SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ugrai_entries.bill_number)
        )', backup_entries_table);
    
    EXECUTE format('SELECT COUNT(*) FROM %I', backup_entries_table) INTO entries_count;
    RAISE NOTICE '✅ Backup created: % (% records)', backup_entries_table, entries_count;
    
    RAISE NOTICE '📊 Total backed up: % records', data_count + entries_count;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: DELETE FROM ugrai_data
-- ═══════════════════════════════════════════════════════════════════════════

-- Delete bills that exist in completed_ugrai or approved_ugrai
WITH deleted_bills AS (
    DELETE FROM ugrai_data
    WHERE EXISTS (
        SELECT 1 FROM completed_ugrai cu 
        WHERE UPPER(cu.bill_number) = UPPER(ugrai_data.bill_number)
    )
    OR EXISTS (
        SELECT 1 FROM approved_ugrai au 
        WHERE UPPER(au.bill_number) = UPPER(ugrai_data.bill_number)
    )
    RETURNING *
)
SELECT 
    '✅ Deleted from ugrai_data' as operation,
    COUNT(*) as deleted_count,
    SUM(net_amount) as total_amount_deleted
FROM deleted_bills;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: DELETE FROM ugrai_entries
-- ═══════════════════════════════════════════════════════════════════════════

-- Delete bills that exist in completed_ugrai or approved_ugrai
WITH deleted_bills AS (
    DELETE FROM ugrai_entries
    WHERE EXISTS (
        SELECT 1 FROM completed_ugrai cu 
        WHERE UPPER(cu.bill_number) = UPPER(ugrai_entries.bill_number)
    )
    OR EXISTS (
        SELECT 1 FROM approved_ugrai au 
        WHERE UPPER(au.bill_number) = UPPER(ugrai_entries.bill_number)
    )
    RETURNING *
)
SELECT 
    '✅ Deleted from ugrai_entries' as operation,
    COUNT(*) as deleted_count,
    SUM(net_amount) as total_amount_deleted
FROM deleted_bills;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════

-- 4A. Verify no duplicates remain in ugrai_data
SELECT 
    '4A. Remaining duplicates in ugrai_data' as verification,
    COUNT(*) as duplicates_remaining,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ CLEAN'
        ELSE '⚠️ STILL HAS DUPLICATES'
    END as status
FROM ugrai_data ud
WHERE EXISTS (
    SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ud.bill_number)
)
OR EXISTS (
    SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ud.bill_number)
);

-- 4B. Verify no duplicates remain in ugrai_entries
SELECT 
    '4B. Remaining duplicates in ugrai_entries' as verification,
    COUNT(*) as duplicates_remaining,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ CLEAN'
        ELSE '⚠️ STILL HAS DUPLICATES'
    END as status
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ue.bill_number)
)
OR EXISTS (
    SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ue.bill_number)
);

-- 4C. Current counts in all tables
SELECT 
    '4C. Current table counts' as verification,
    (SELECT COUNT(*) FROM ugrai_data) as ugrai_data_count,
    (SELECT COUNT(*) FROM ugrai_entries) as ugrai_entries_count,
    (SELECT COUNT(*) FROM completed_ugrai) as completed_ugrai_count,
    (SELECT COUNT(*) FROM approved_ugrai) as approved_ugrai_count;

-- 4D. Bills remaining in ugrai_data (should be unique to this table)
SELECT 
    '4D. Bills remaining in ugrai_data' as verification,
    COUNT(*) as remaining_bills,
    SUM(net_amount) as total_amount
FROM ugrai_data;

-- 4E. Bills remaining in ugrai_entries (should be unique to this table)
SELECT 
    '4E. Bills remaining in ugrai_entries' as verification,
    COUNT(*) as remaining_bills,
    SUM(net_amount) as total_amount
FROM ugrai_entries;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: LIST BACKUP TABLES FOR RESTORE
-- ═══════════════════════════════════════════════════════════════════════════

SELECT 
    '5. Available backup tables (if restore needed)' as info,
    tablename as backup_table,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as table_size
FROM pg_tables 
WHERE schemaname = 'public' 
AND (tablename LIKE 'ugrai_data_backup_%' OR tablename LIKE 'ugrai_entries_backup_%')
ORDER BY tablename DESC
LIMIT 10;

/*
═══════════════════════════════════════════════════════════════════════════
✅ DELETION COMPLETE!
═══════════════════════════════════════════════════════════════════════════

TO RESTORE FROM BACKUP (if needed):
Replace the table names with your actual backup table names from Step 5

-- Restore ugrai_data
INSERT INTO ugrai_data 
SELECT * FROM ugrai_data_backup_YYYYMMDD_HHMMSS
ON CONFLICT (user_id, bill_number) DO NOTHING;

-- Restore ugrai_entries
INSERT INTO ugrai_entries 
SELECT * FROM ugrai_entries_backup_YYYYMMDD_HHMMSS
ON CONFLICT (user_id, bill_number) DO NOTHING;

-- Drop backups after successful verification (OPTIONAL)
DROP TABLE ugrai_data_backup_YYYYMMDD_HHMMSS;
DROP TABLE ugrai_entries_backup_YYYYMMDD_HHMMSS;
*/
