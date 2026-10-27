-- ============================================================================
-- DIAGNOSE TOTAL UGRAI COUNT DISCREPANCY
-- Expected: 320 bills | Actual: 425 bills | Difference: 105 bills
-- ============================================================================

-- Part 1: Count bills in each source table
SELECT 
    '1. Bills in ugrai_data' as source,
    COUNT(*) as total_count,
    COUNT(DISTINCT bill_number) as unique_bill_numbers
FROM ugrai_data;

SELECT 
    '2. Bills in ugrai_entries' as source,
    COUNT(*) as total_count,
    COUNT(DISTINCT bill_number) as unique_bill_numbers
FROM ugrai_entries;

-- Part 2: Check for duplicates within ugrai_data
SELECT 
    '3. Duplicate bill_numbers in ugrai_data' as check_type,
    bill_number,
    COUNT(*) as occurrence_count
FROM ugrai_data
GROUP BY bill_number
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- Part 3: Check for duplicates within ugrai_entries
SELECT 
    '4. Duplicate bill_numbers in ugrai_entries' as check_type,
    bill_number,
    COUNT(*) as occurrence_count
FROM ugrai_entries
GROUP BY bill_number
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- Part 4: Check for bills appearing in BOTH tables
SELECT 
    '5. Bills in BOTH ugrai_data AND ugrai_entries' as check_type,
    COUNT(*) as duplicate_count
FROM (
    SELECT DISTINCT UPPER(bill_number) as bill_number
    FROM ugrai_data
    INTERSECT
    SELECT DISTINCT UPPER(bill_number) as bill_number
    FROM ugrai_entries
) as duplicates;

-- Part 5: Show sample bills that appear in both tables
SELECT 
    '6. Sample bills in BOTH tables' as note,
    ud.bill_number,
    ud.retailer_name as data_retailer,
    ue.retailer_name as entries_retailer,
    ud.net_amount as data_amount,
    ue.net_amount as entries_amount,
    ud.sector as data_sector,
    ue.sector as entries_sector
FROM ugrai_data ud
INNER JOIN ugrai_entries ue ON UPPER(ud.bill_number) = UPPER(ue.bill_number)
LIMIT 20;

-- Part 6: Count bills that should be excluded (completed/approved)
SELECT 
    '7. Bills in completed_ugrai (should be excluded)' as check_type,
    COUNT(DISTINCT UPPER(bill_number)) as count
FROM completed_ugrai;

SELECT 
    '8. Bills in approved_ugrai (should be excluded)' as check_type,
    COUNT(DISTINCT UPPER(bill_number)) as count
FROM approved_ugrai;

-- Part 9: Expected calculation
SELECT 
    '9. CALCULATION CHECK' as report,
    (SELECT COUNT(DISTINCT UPPER(bill_number)) FROM ugrai_data) as unique_in_data,
    (SELECT COUNT(DISTINCT UPPER(bill_number)) FROM ugrai_entries) as unique_in_entries,
    (SELECT COUNT(*) FROM (
        SELECT DISTINCT UPPER(bill_number) as bill_number FROM ugrai_data
        INTERSECT
        SELECT DISTINCT UPPER(bill_number) as bill_number FROM ugrai_entries
    ) as dup) as overlap_count,
    (SELECT COUNT(DISTINCT UPPER(bill_number)) FROM ugrai_data) +
    (SELECT COUNT(DISTINCT UPPER(bill_number)) FROM ugrai_entries) -
    (SELECT COUNT(*) FROM (
        SELECT DISTINCT UPPER(bill_number) as bill_number FROM ugrai_data
        INTERSECT
        SELECT DISTINCT UPPER(bill_number) as bill_number FROM ugrai_entries
    ) as dup) as expected_unique_total;

-- Part 10: Total unique bills across both tables
SELECT 
    '10. TOTAL UNIQUE BILLS (ugrai_data + ugrai_entries)' as report,
    COUNT(DISTINCT bill_number) as total_unique_bills
FROM (
    SELECT UPPER(bill_number) as bill_number FROM ugrai_data
    UNION
    SELECT UPPER(bill_number) as bill_number FROM ugrai_entries
) as all_bills;

-- Part 11: Check if bills in completed/approved are being properly excluded
SELECT 
    '11. Bills that exist in sources but also in completed/approved' as check_type,
    COUNT(*) as count
FROM (
    SELECT UPPER(bill_number) as bill_number FROM ugrai_data
    UNION
    SELECT UPPER(bill_number) as bill_number FROM ugrai_entries
) as source_bills
WHERE bill_number IN (
    SELECT UPPER(bill_number) FROM completed_ugrai
    UNION
    SELECT UPPER(bill_number) FROM approved_ugrai
);
