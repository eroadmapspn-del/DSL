-- Remove bills from ugrai_data and ugrai_entries that have been approved
-- This cleans up bills that exist in approved_ugrai table
-- Bills are matched by bill_number

-- Preview what will be deleted (run this first to verify)
-- Bills from ugrai_data that will be deleted
SELECT 
    'ugrai_data' as source_table,
    ud.bill_number,
    ud.retailer_name,
    ud.sector,
    ud.net_amount,
    ud.status,
    ud.user_id
FROM ugrai_data ud
INNER JOIN approved_ugrai au ON ud.bill_number = au.bill_number AND ud.user_id = au.user_id
ORDER BY ud.bill_number;

-- Bills from ugrai_entries that will be deleted
SELECT 
    'ugrai_entries' as source_table,
    ue.bill_number,
    ue.retailer_name,
    ue.sector,
    ue.net_amount,
    ue.status,
    ue.user_id
FROM ugrai_entries ue
INNER JOIN approved_ugrai au ON ue.bill_number = au.bill_number AND ue.user_id = au.user_id
ORDER BY ue.bill_number;

-- Count summary before deletion
SELECT 
    'BEFORE DELETION' as status,
    (SELECT COUNT(*) FROM ugrai_data) as ugrai_data_count,
    (SELECT COUNT(*) FROM ugrai_entries) as ugrai_entries_count,
    (SELECT COUNT(*) FROM approved_ugrai) as approved_ugrai_count;

-- === ACTUAL DELETION COMMANDS ===

-- Delete from ugrai_data where bill exists in approved_ugrai (matching both bill_number and user_id)
DELETE FROM ugrai_data ud
WHERE EXISTS (
    SELECT 1 
    FROM approved_ugrai au
    WHERE au.bill_number = ud.bill_number 
    AND au.user_id = ud.user_id
);

-- Delete from ugrai_entries where bill exists in approved_ugrai (matching both bill_number and user_id)
DELETE FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 
    FROM approved_ugrai au
    WHERE au.bill_number = ue.bill_number 
    AND au.user_id = ue.user_id
);

-- Count summary after deletion
SELECT 
    'AFTER DELETION' as status,
    (SELECT COUNT(*) FROM ugrai_data) as ugrai_data_count,
    (SELECT COUNT(*) FROM ugrai_entries) as ugrai_entries_count,
    (SELECT COUNT(*) FROM approved_ugrai) as approved_ugrai_count;

-- Verify cleanup is complete (should return 0 for both)
SELECT 
    'VERIFICATION - Should be 0' as info,
    (SELECT COUNT(*) FROM ugrai_data ud 
     INNER JOIN approved_ugrai au ON ud.bill_number = au.bill_number AND ud.user_id = au.user_id) as remaining_in_ugrai_data,
    (SELECT COUNT(*) FROM ugrai_entries ue 
     INNER JOIN approved_ugrai au ON ue.bill_number = au.bill_number AND ue.user_id = au.user_id) as remaining_in_ugrai_entries;
