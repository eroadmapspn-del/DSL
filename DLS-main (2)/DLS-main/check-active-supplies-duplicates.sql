-- Check for duplicate bills in active_supplies table
-- This query identifies bills that appear multiple times with 'in_progress' status

-- Check duplicates by bill_number
SELECT 
    bill_number,
    status,
    COUNT(*) as duplicate_count,
    STRING_AGG(id::text, ', ') as ids,
    STRING_AGG(retailer_name, ' | ') as retailers,
    STRING_AGG(net_amount::text, ' | ') as amounts,
    STRING_AGG(created_at::text, ' | ') as created_dates
FROM active_supplies
WHERE status IN ('in_progress', 'In Progress')
GROUP BY bill_number, status
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, bill_number;

-- Check total counts by status
SELECT 
    status,
    COUNT(*) as total_count,
    COUNT(DISTINCT bill_number) as unique_bills,
    COUNT(*) - COUNT(DISTINCT bill_number) as duplicate_count
FROM active_supplies
GROUP BY status
ORDER BY status;

-- Show all records for bills that have duplicates
SELECT 
    id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    status,
    supply_through,
    created_at,
    completion_date
FROM active_supplies
WHERE bill_number IN (
    SELECT bill_number
    FROM active_supplies
    WHERE status IN ('in_progress', 'In Progress')
    GROUP BY bill_number
    HAVING COUNT(*) > 1
)
ORDER BY bill_number, created_at;
