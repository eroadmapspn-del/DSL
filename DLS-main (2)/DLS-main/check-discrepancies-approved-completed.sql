-- ============================================================================
-- CHECK DISCREPANCIES & REMOVE APPROVED/COMPLETED BILLS
-- Remove bills from ugrai_data and ugrai_entries if they exist in approved_ugrai or completed_ugrai
-- Expected to clean up ~3808 duplicate bills
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: DISCREPANCY CHECK (PREVIEW ONLY - RUN THIS FIRST!)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1A. Bills in ugrai_data that are COMPLETED
SELECT 
    '1A. ugrai_data bills in completed_ugrai' as discrepancy_type,
    ud.bill_number,
    ud.retailer_name,
    ud.net_amount as data_amount,
    cu.net_amount as completed_amount,
    ud.net_amount - cu.net_amount as amount_difference,
    ud.sector as data_sector,
    cu.sector as completed_sector,
    cu.date_completed,
    ud.created_at as data_created_at
FROM ugrai_data ud
INNER JOIN completed_ugrai cu ON UPPER(ud.bill_number) = UPPER(cu.bill_number)
ORDER BY ud.bill_number
LIMIT 20;

-- 1B. Bills in ugrai_data that are APPROVED
SELECT 
    '1B. ugrai_data bills in approved_ugrai' as discrepancy_type,
    ud.bill_number,
    ud.retailer_name,
    ud.net_amount as data_amount,
    au.net_amount as approved_amount,
    ud.net_amount - au.net_amount as amount_difference,
    ud.sector as data_sector,
    au.sector as approved_sector,
    au.date_approved,
    ud.created_at as data_created_at
FROM ugrai_data ud
INNER JOIN approved_ugrai au ON UPPER(ud.bill_number) = UPPER(au.bill_number)
ORDER BY ud.bill_number
LIMIT 20;

-- 1C. Bills in ugrai_entries that are COMPLETED
SELECT 
    '1C. ugrai_entries bills in completed_ugrai' as discrepancy_type,
    ue.bill_number,
    ue.retailer_name,
    ue.net_amount as entries_amount,
    cu.net_amount as completed_amount,
    ue.net_amount - cu.net_amount as amount_difference,
    ue.sector as entries_sector,
    cu.sector as completed_sector,
    cu.date_completed,
    ue.created_at as entries_created_at
FROM ugrai_entries ue
INNER JOIN completed_ugrai cu ON UPPER(ue.bill_number) = UPPER(cu.bill_number)
ORDER BY ue.bill_number
LIMIT 20;

-- 1D. Bills in ugrai_entries that are APPROVED
SELECT 
    '1D. ugrai_entries bills in approved_ugrai' as discrepancy_type,
    ue.bill_number,
    ue.retailer_name,
    ue.net_amount as entries_amount,
    au.net_amount as approved_amount,
    ue.net_amount - au.net_amount as amount_difference,
    ue.sector as entries_sector,
    au.sector as approved_sector,
    au.date_approved,
    ue.created_at as entries_created_at
FROM ugrai_entries ue
INNER JOIN approved_ugrai au ON UPPER(ue.bill_number) = UPPER(au.bill_number)
ORDER BY ue.bill_number
LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2: COUNT SUMMARY (How many bills will be deleted?)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT 
    '=== DELETION SUMMARY ===' as report,
    NULL as source_table,
    NULL as bills_to_delete,
    NULL as total_amount;

-- 2A. ugrai_data bills in completed_ugrai
SELECT 
    'Count: ugrai_data → completed_ugrai' as report,
    'ugrai_data' as source_table,
    COUNT(*) as bills_to_delete,
    SUM(ud.net_amount) as total_amount
FROM ugrai_data ud
WHERE EXISTS (
    SELECT 1 FROM completed_ugrai cu 
    WHERE UPPER(cu.bill_number) = UPPER(ud.bill_number)
);

-- 2B. ugrai_data bills in approved_ugrai
SELECT 
    'Count: ugrai_data → approved_ugrai' as report,
    'ugrai_data' as source_table,
    COUNT(*) as bills_to_delete,
    SUM(ud.net_amount) as total_amount
FROM ugrai_data ud
WHERE EXISTS (
    SELECT 1 FROM approved_ugrai au 
    WHERE UPPER(au.bill_number) = UPPER(ud.bill_number)
);

-- 2C. ugrai_entries bills in completed_ugrai
SELECT 
    'Count: ugrai_entries → completed_ugrai' as report,
    'ugrai_entries' as source_table,
    COUNT(*) as bills_to_delete,
    SUM(ue.net_amount) as total_amount
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 FROM completed_ugrai cu 
    WHERE UPPER(cu.bill_number) = UPPER(ue.bill_number)
);

-- 2D. ugrai_entries bills in approved_ugrai
SELECT 
    'Count: ugrai_entries → approved_ugrai' as report,
    'ugrai_entries' as source_table,
    COUNT(*) as bills_to_delete,
    SUM(ue.net_amount) as total_amount
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 FROM approved_ugrai au 
    WHERE UPPER(au.bill_number) = UPPER(ue.bill_number)
);

-- 2E. TOTAL from ugrai_data (combined completed + approved)
SELECT 
    'TOTAL from ugrai_data (unique bills)' as report,
    'ugrai_data' as source_table,
    COUNT(DISTINCT ud.bill_number) as bills_to_delete,
    SUM(ud.net_amount) as total_amount
FROM ugrai_data ud
WHERE EXISTS (
    SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ud.bill_number)
)
OR EXISTS (
    SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ud.bill_number)
);

-- 2F. TOTAL from ugrai_entries (combined completed + approved)
SELECT 
    'TOTAL from ugrai_entries (unique bills)' as report,
    'ugrai_entries' as source_table,
    COUNT(DISTINCT ue.bill_number) as bills_to_delete,
    SUM(ue.net_amount) as total_amount
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ue.bill_number)
)
OR EXISTS (
    SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ue.bill_number)
);

-- 2G. GRAND TOTAL (all tables combined)
SELECT 
    'GRAND TOTAL (all deletions)' as report,
    'BOTH TABLES' as source_table,
    (
        (SELECT COUNT(DISTINCT ud.bill_number) FROM ugrai_data ud
         WHERE EXISTS (SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ud.bill_number))
         OR EXISTS (SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ud.bill_number))
        ) +
        (SELECT COUNT(DISTINCT ue.bill_number) FROM ugrai_entries ue
         WHERE EXISTS (SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ue.bill_number))
         OR EXISTS (SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ue.bill_number))
        )
    ) as bills_to_delete,
    (
        (SELECT COALESCE(SUM(ud.net_amount), 0) FROM ugrai_data ud
         WHERE EXISTS (SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ud.bill_number))
         OR EXISTS (SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ud.bill_number))
        ) +
        (SELECT COALESCE(SUM(ue.net_amount), 0) FROM ugrai_entries ue
         WHERE EXISTS (SELECT 1 FROM completed_ugrai cu WHERE UPPER(cu.bill_number) = UPPER(ue.bill_number))
         OR EXISTS (SELECT 1 FROM approved_ugrai au WHERE UPPER(au.bill_number) = UPPER(ue.bill_number))
        )
    ) as total_amount;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3: AMOUNT DISCREPANCY CHECK
-- ═══════════════════════════════════════════════════════════════════════════

-- 3A. Amount mismatches in ugrai_data vs completed_ugrai
SELECT 
    '3A. Amount mismatches: ugrai_data vs completed_ugrai' as check_type,
    ud.bill_number,
    ud.net_amount as data_amount,
    cu.net_amount as completed_amount,
    ud.net_amount - cu.net_amount as difference,
    CASE 
        WHEN ABS(ud.net_amount - cu.net_amount) > 0.01 THEN 'MISMATCH'
        ELSE 'MATCH'
    END as status
FROM ugrai_data ud
INNER JOIN completed_ugrai cu ON UPPER(ud.bill_number) = UPPER(cu.bill_number)
WHERE ABS(ud.net_amount - cu.net_amount) > 0.01
LIMIT 20;

-- 3B. Amount mismatches in ugrai_data vs approved_ugrai
SELECT 
    '3B. Amount mismatches: ugrai_data vs approved_ugrai' as check_type,
    ud.bill_number,
    ud.net_amount as data_amount,
    au.net_amount as approved_amount,
    ud.net_amount - au.net_amount as difference,
    CASE 
        WHEN ABS(ud.net_amount - au.net_amount) > 0.01 THEN 'MISMATCH'
        ELSE 'MATCH'
    END as status
FROM ugrai_data ud
INNER JOIN approved_ugrai au ON UPPER(ud.bill_number) = UPPER(au.bill_number)
WHERE ABS(ud.net_amount - au.net_amount) > 0.01
LIMIT 20;

-- 3C. Amount mismatches in ugrai_entries vs completed_ugrai
SELECT 
    '3C. Amount mismatches: ugrai_entries vs completed_ugrai' as check_type,
    ue.bill_number,
    ue.net_amount as entries_amount,
    cu.net_amount as completed_amount,
    ue.net_amount - cu.net_amount as difference,
    CASE 
        WHEN ABS(ue.net_amount - cu.net_amount) > 0.01 THEN 'MISMATCH'
        ELSE 'MATCH'
    END as status
FROM ugrai_entries ue
INNER JOIN completed_ugrai cu ON UPPER(ue.bill_number) = UPPER(cu.bill_number)
WHERE ABS(ue.net_amount - cu.net_amount) > 0.01
LIMIT 20;

-- 3D. Amount mismatches in ugrai_entries vs approved_ugrai
SELECT 
    '3D. Amount mismatches: ugrai_entries vs approved_ugrai' as check_type,
    ue.bill_number,
    ue.net_amount as entries_amount,
    au.net_amount as approved_amount,
    ue.net_amount - au.net_amount as difference,
    CASE 
        WHEN ABS(ue.net_amount - au.net_amount) > 0.01 THEN 'MISMATCH'
        ELSE 'MATCH'
    END as status
FROM ugrai_entries ue
INNER JOIN approved_ugrai au ON UPPER(ue.bill_number) = UPPER(au.bill_number)
WHERE ABS(ue.net_amount - au.net_amount) > 0.01
LIMIT 20;

/*
═══════════════════════════════════════════════════════════════════════════
STOP HERE! REVIEW THE RESULTS ABOVE BEFORE PROCEEDING!
═══════════════════════════════════════════════════════════════════════════

If the preview looks correct and you're ready to delete, 
run the script: "execute-removal-of-approved-completed-bills.sql"

This will:
1. Create automatic backups
2. Delete from ugrai_data
3. Delete from ugrai_entries  
4. Verify deletions
5. Show restore commands if needed
*/
