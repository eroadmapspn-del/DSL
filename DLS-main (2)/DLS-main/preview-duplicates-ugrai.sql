-- ============================================================================
-- PREVIEW DUPLICATES BETWEEN ugrai_data AND ugrai_entries
-- Shows bills that exist in BOTH tables
-- ============================================================================

-- PREVIEW 1: Count of duplicates
SELECT 
    '📊 Duplicate Summary' as check_type,
    COUNT(DISTINCT ud.bill_number) as duplicate_bill_count,
    SUM(ud.net_amount) as total_net_amount_in_data,
    SUM(ue.net_amount) as total_net_amount_in_entries
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id;

-- PREVIEW 2: List all duplicate bills with details
SELECT 
    '🔍 Duplicate Bills List' as check_type,
    ud.bill_number,
    ud.retailer_name,
    ud.sector,
    ud.net_amount as data_net_amount,
    ue.net_amount as entries_net_amount,
    ud.received_amount as data_received,
    ud.status as data_status,
    ue.status as entries_status,
    ud.current_stage as data_stage,
    ue.current_stage as entries_stage,
    ud.bill_date
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
ORDER BY ud.bill_number;

-- PREVIEW 3: Duplicates by sector
SELECT 
    '📍 Duplicates by Sector' as check_type,
    ud.sector,
    COUNT(*) as duplicate_count,
    SUM(ud.net_amount) as total_amount
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
GROUP BY ud.sector
ORDER BY duplicate_count DESC;

-- PREVIEW 4: Duplicates by status combination
SELECT 
    '⚡ Status Combinations' as check_type,
    ud.status as data_status,
    ue.status as entries_status,
    COUNT(*) as count
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
GROUP BY ud.status, ue.status
ORDER BY count DESC;

-- PREVIEW 5: Amount discrepancies (where net_amount differs)
SELECT 
    '⚠️ Amount Discrepancies' as check_type,
    ud.bill_number,
    ud.net_amount as data_amount,
    ue.net_amount as entries_amount,
    ud.net_amount - ue.net_amount as difference,
    ud.retailer_name
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
WHERE ud.net_amount != ue.net_amount
ORDER BY ABS(ud.net_amount - ue.net_amount) DESC;

-- PREVIEW 6: Bills with received amounts in ugrai_data
SELECT 
    '💰 Bills with Partial Payments (in ugrai_data)' as check_type,
    ud.bill_number,
    ud.net_amount,
    ud.received_amount,
    ud.net_amount - ud.received_amount as outstanding,
    ROUND((ud.received_amount / ud.net_amount * 100), 2) as percent_paid,
    ud.status,
    ud.retailer_name
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
WHERE ud.received_amount > 0
ORDER BY ud.received_amount DESC
LIMIT 20;

-- PREVIEW 7: Check if duplicates exist in approved or completed tables too
SELECT 
    '🚨 Triple/Quadruple Duplicates' as check_type,
    ud.bill_number,
    ud.retailer_name,
    EXISTS(SELECT 1 FROM approved_ugrai au WHERE au.bill_number = ud.bill_number AND au.user_id = ud.user_id) as in_approved,
    EXISTS(SELECT 1 FROM completed_ugrai cu WHERE cu.bill_number = ud.bill_number AND cu.user_id = ud.user_id) as in_completed
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
WHERE EXISTS(SELECT 1 FROM approved_ugrai au WHERE au.bill_number = ud.bill_number AND au.user_id = ud.user_id)
   OR EXISTS(SELECT 1 FROM completed_ugrai cu WHERE cu.bill_number = ud.bill_number AND cu.user_id = ud.user_id)
ORDER BY ud.bill_number
LIMIT 50;

-- PREVIEW 8: Sample of first 50 duplicates with all key fields
SELECT 
    '📋 Sample Duplicates (First 50)' as check_type,
    ROW_NUMBER() OVER (ORDER BY ud.bill_number) as row_num,
    ud.bill_number,
    ud.retailer_name,
    ud.sector,
    ud.net_amount,
    ud.received_amount,
    ud.status,
    ud.current_stage,
    ud.assigned_to,
    ud.bill_date
FROM ugrai_data ud
INNER JOIN ugrai_entries ue 
    ON ud.bill_number = ue.bill_number 
    AND ud.user_id = ue.user_id
ORDER BY ud.bill_number
LIMIT 50;

-- ============================================================================
-- SUMMARY COUNTS
-- ============================================================================
SELECT 
    '📈 Table Summary' as summary,
    (SELECT COUNT(*) FROM ugrai_data) as total_in_ugrai_data,
    (SELECT COUNT(*) FROM ugrai_entries) as total_in_ugrai_entries,
    (SELECT COUNT(DISTINCT ud.bill_number) 
     FROM ugrai_data ud
     INNER JOIN ugrai_entries ue ON ud.bill_number = ue.bill_number AND ud.user_id = ue.user_id) as duplicate_bills,
    (SELECT COUNT(*) FROM ugrai_data WHERE bill_number NOT IN (SELECT bill_number FROM ugrai_entries)) as only_in_data,
    (SELECT COUNT(*) FROM ugrai_entries WHERE bill_number NOT IN (SELECT bill_number FROM ugrai_data)) as only_in_entries;
