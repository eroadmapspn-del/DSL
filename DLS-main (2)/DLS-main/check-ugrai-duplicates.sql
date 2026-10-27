-- ============================================================================
-- CHECK FOR DUPLICATE BILLS BETWEEN ugrai_data AND ugrai_entries
-- Run this first to see what would be affected
-- ============================================================================

-- Part 1: Count duplicates by bill_number only
SELECT 
    '1. Duplicates by bill_number only' as check_type,
    COUNT(*) as duplicate_count
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 
    FROM ugrai_data ud 
    WHERE UPPER(ud.bill_number) = UPPER(ue.bill_number)
);

-- Part 2: Show sample duplicates with details
SELECT 
    '2. Sample duplicate bills' as note,
    ue.bill_number,
    ue.retailer_name as entries_retailer,
    ud.retailer_name as data_retailer,
    ue.net_amount as entries_amount,
    ud.net_amount as data_amount,
    ue.sector as entries_sector,
    ud.sector as data_sector,
    ue.status as entries_status,
    ud.status as data_status,
    CASE 
        WHEN ue.net_amount = ud.net_amount THEN 'Same Amount'
        ELSE 'Different Amount'
    END as amount_match
FROM ugrai_entries ue
INNER JOIN ugrai_data ud ON UPPER(ud.bill_number) = UPPER(ue.bill_number)
ORDER BY ue.bill_number
LIMIT 20;

-- Part 3: Count by user_id match
SELECT 
    '3. Duplicates matching bill_number AND user_id' as check_type,
    COUNT(*) as duplicate_count
FROM ugrai_entries ue
WHERE EXISTS (
    SELECT 1 
    FROM ugrai_data ud 
    WHERE UPPER(ud.bill_number) = UPPER(ue.bill_number)
    AND ud.user_id = ue.user_id
);

-- Part 4: Summary statistics
SELECT 
    '4. Summary' as report,
    (SELECT COUNT(*) FROM ugrai_entries) as total_ugrai_entries,
    (SELECT COUNT(*) FROM ugrai_data) as total_ugrai_data,
    (SELECT COUNT(*) FROM ugrai_entries ue 
     WHERE EXISTS (SELECT 1 FROM ugrai_data ud WHERE UPPER(ud.bill_number) = UPPER(ue.bill_number))) 
     as entries_that_exist_in_data,
    (SELECT COUNT(*) FROM ugrai_entries ue 
     WHERE NOT EXISTS (SELECT 1 FROM ugrai_data ud WHERE UPPER(ud.bill_number) = UPPER(ue.bill_number))) 
     as entries_unique_to_entries_table;

-- Part 5: Check for amount differences in duplicates
SELECT 
    '5. Duplicates with DIFFERENT amounts' as note,
    ue.bill_number,
    ue.net_amount as entries_amount,
    ud.net_amount as data_amount,
    (ud.net_amount - ue.net_amount) as difference
FROM ugrai_entries ue
INNER JOIN ugrai_data ud ON UPPER(ud.bill_number) = UPPER(ue.bill_number)
WHERE ue.net_amount != ud.net_amount
LIMIT 10;
