-- Diagnostic SQL to find the 10 missing bills that weren't transferred to ugrai_entries
-- Updated: Check actual counts and find the discrepancy

-- Step 0: Get exact counts
SELECT 
    'approved_bills (Credit + Approved)' as source,
    COUNT(*) as count
FROM approved_bills
WHERE payment_method = 'Credit' 
  AND status = 'Approved'

UNION ALL

SELECT 
    'ugrai_entries (all bills)' as source,
    COUNT(*) as count
FROM ugrai_entries

UNION ALL

SELECT 
    'approved_bills (has duplicates?)' as source,
    COUNT(DISTINCT bill_number) as count
FROM approved_bills
WHERE payment_method = 'Credit' 
  AND status = 'Approved'
  AND bill_number IS NOT NULL;

-- Step 1: Check for duplicate bill_numbers in approved_bills (most likely cause)
WITH credit_bills_to_transfer AS (
    SELECT 
        bill_number,
        user_id,
        retailer_name,
        sector,
        net_amount,
        bill_date
    FROM approved_bills
    WHERE payment_method = 'Credit' 
      AND status = 'Approved'
),

-- Step 2: Find bills that are already in ugrai_entries
bills_in_ugrai AS (
    SELECT DISTINCT bill_number, user_id
    FROM ugrai_entries
)

-- Step 3: Find bills that are in approved_bills but NOT in ugrai_entries
SELECT 
    cb.bill_number,
    cb.user_id,
    cb.retailer_name,
    cb.sector,
    cb.net_amount,
    cb.bill_date,
    CASE 
        WHEN cb.bill_number IS NULL THEN 'NULL bill_number'
        WHEN cb.user_id IS NULL THEN 'NULL user_id'
        WHEN ug.bill_number IS NOT NULL THEN 'Already exists in ugrai_entries'
        ELSE 'Unknown reason'
    END AS reason_not_transferred
FROM credit_bills_to_transfer cb
LEFT JOIN bills_in_ugrai ug 
    ON cb.bill_number = ug.bill_number 
    AND cb.user_id::text = ug.user_id::text
WHERE ug.bill_number IS NULL  -- Not in ugrai_entries
   OR cb.bill_number IS NULL  -- Has NULL bill_number
   OR cb.user_id IS NULL;     -- Has NULL user_id

-- Step 4: Count by reason
SELECT 
    CASE 
        WHEN bill_number IS NULL THEN 'NULL bill_number'
        WHEN user_id IS NULL THEN 'NULL user_id'
        ELSE 'Other'
    END AS issue_type,
    COUNT(*) as count
FROM approved_bills
WHERE payment_method = 'Credit' 
  AND status = 'Approved'
  AND bill_number NOT IN (
      SELECT bill_number 
      FROM ugrai_entries 
      WHERE bill_number IS NOT NULL
  )
GROUP BY issue_type;

-- Step 5: Find duplicate bill_numbers in approved_bills (PRIMARY SUSPECT)
SELECT 
    bill_number,
    COUNT(*) as duplicate_count,
    ARRAY_AGG(id) as bill_ids,
    ARRAY_AGG(retailer_name) as retailer_names,
    ARRAY_AGG(net_amount::text) as net_amounts
FROM approved_bills
WHERE payment_method = 'Credit' 
  AND status = 'Approved'
  AND bill_number IS NOT NULL
GROUP BY bill_number
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;

-- Step 6: If duplicates found, show total duplicate count
SELECT 
    'Total bills with duplicates' as description,
    COUNT(DISTINCT bill_number) as unique_bills_with_duplicates,
    SUM(duplicate_count - 1) as extra_duplicate_rows
FROM (
    SELECT 
        bill_number,
        COUNT(*) as duplicate_count
    FROM approved_bills
    WHERE payment_method = 'Credit' 
      AND status = 'Approved'
      AND bill_number IS NOT NULL
    GROUP BY bill_number
    HAVING COUNT(*) > 1
) duplicates;
