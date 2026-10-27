-- Diagnose Bill 1569 Issue: NIV6014842501666
-- Error: "No bills found with dispatched status for IDs: 1569"

-- Step 1: Check if bill exists with basic info
SELECT 
    '1. Basic Bill Info' as step,
    id,
    bill_number,
    retailer_name,
    status,
    user_id,
    created_at,
    updated_at
FROM bills
WHERE id = 1569;

-- Step 2: Check the retailer_name more closely for hidden characters
SELECT 
    '2. Retailer Name Analysis' as step,
    id,
    bill_number,
    retailer_name,
    LENGTH(retailer_name) as name_length,
    LENGTH(TRIM(retailer_name)) as trimmed_length,
    OCTET_LENGTH(retailer_name) as byte_length,
    ENCODE(retailer_name::bytea, 'hex') as hex_representation
FROM bills
WHERE id = 1569;

-- Step 3: Check if there's a retailer with this exact name
SELECT 
    '3. Matching Retailers' as step,
    id,
    retailer_name,
    sector,
    user_id,
    created_at
FROM retailers
WHERE retailer_name LIKE '%SHIVALIK MEDICOS%';

-- Step 4: Check for retailers with similar names (case-insensitive, trimmed)
SELECT 
    '4. Similar Retailer Names' as step,
    id,
    retailer_name,
    sector,
    user_id,
    LOWER(TRIM(retailer_name)) as normalized_name
FROM retailers
WHERE LOWER(TRIM(retailer_name)) LIKE '%shivalik medicos%';

-- Step 5: Check if there are duplicate retailers with similar names
SELECT 
    '5. Duplicate Retailer Check' as step,
    LOWER(TRIM(retailer_name)) as normalized_name,
    COUNT(*) as count,
    STRING_AGG(DISTINCT sector, ', ') as sectors,
    STRING_AGG(DISTINCT user_id::text, ', ') as user_ids
FROM retailers
WHERE LOWER(TRIM(retailer_name)) LIKE '%shivalik medicos%'
GROUP BY LOWER(TRIM(retailer_name));

-- Step 6: Check all bills with similar retailer names
SELECT 
    '6. All Bills with Similar Retailer Names' as step,
    id,
    bill_number,
    retailer_name,
    LENGTH(retailer_name) as name_length,
    sector,
    status,
    user_id
FROM bills
WHERE LOWER(TRIM(retailer_name)) LIKE '%shivalik medicos%'
ORDER BY id DESC
LIMIT 20;

-- Step 7: Check if the retailers table has a UNIQUE constraint issue
SELECT 
    '7. Retailer Constraints' as step,
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'retailers'::regclass;

-- Step 8: Look for the specific pattern in bill 1569's retailer_name
SELECT 
    '8. Exact Retailer Name Pattern' as step,
    id,
    bill_number,
    retailer_name,
    CASE 
        WHEN retailer_name LIKE '%-%' THEN 'Contains dash'
        ELSE 'No dash'
    END as has_dash,
    CASE
        WHEN retailer_name ~ '\s+-\s+\d+$' THEN 'Ends with " - <number>"'
        ELSE 'Different pattern'
    END as pattern_type
FROM bills
WHERE id = 1569;

-- Step 9: Check if there's an issue with the retailer insert/update
SELECT 
    '9. Potential Retailer Insert Issue' as step,
    r.id,
    r.retailer_name,
    r.sector,
    r.user_id,
    COUNT(b.id) as bills_count
FROM retailers r
LEFT JOIN bills b ON b.retailer_name = r.retailer_name
WHERE r.retailer_name LIKE '%SHIVALIK MEDICOS%'
GROUP BY r.id, r.retailer_name, r.sector, r.user_id;

-- Step 10: Check RLS policies on bills table
SELECT 
    '10. RLS Policies on Bills Table' as step,
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bills';
