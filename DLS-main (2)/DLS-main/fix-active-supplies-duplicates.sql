-- FIX FOR DUPLICATES IN ACTIVE_SUPPLIES TABLE
-- This script will:
-- 1. Identify duplicate records
-- 2. Remove duplicates (keeping the most recent one)
-- 3. Add a unique constraint to prevent future duplicates

-- ============================================================
-- STEP 1: ANALYZE CURRENT DUPLICATES
-- ============================================================

-- Show all duplicate bills in active_supplies
SELECT 
    bill_number,
    status,
    COUNT(*) as duplicate_count,
    STRING_AGG(id::text, ', ' ORDER BY created_at DESC) as record_ids,
    STRING_AGG(retailer_name, ' | ' ORDER BY created_at DESC) as retailers,
    MAX(created_at) as most_recent_created
FROM active_supplies
GROUP BY bill_number, status
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, bill_number;

-- ============================================================
-- STEP 2: CLEAN UP DUPLICATES
-- ============================================================

-- Create a temporary table with IDs to DELETE (keeping the most recent record for each bill_number + user_id + status combination)
WITH ranked_supplies AS (
    SELECT 
        id,
        bill_number,
        user_id,
        status,
        ROW_NUMBER() OVER (
            PARTITION BY bill_number, user_id, status 
            ORDER BY created_at DESC, id DESC
        ) as rn
    FROM active_supplies
)
DELETE FROM active_supplies
WHERE id IN (
    SELECT id 
    FROM ranked_supplies 
    WHERE rn > 1
);

-- Show how many records were deleted
-- (Run this AFTER the DELETE statement above to see the result)

-- ============================================================
-- STEP 3: VERIFY NO MORE DUPLICATES
-- ============================================================

-- Verify that duplicates are gone
SELECT 
    bill_number,
    status,
    user_id,
    COUNT(*) as count
FROM active_supplies
GROUP BY bill_number, status, user_id
HAVING COUNT(*) > 1;
-- Should return 0 rows

-- ============================================================
-- STEP 4: ADD UNIQUE CONSTRAINT TO PREVENT FUTURE DUPLICATES
-- ============================================================

-- Add unique constraint on bill_number + user_id + status
-- This ensures the same bill cannot be in progress multiple times for the same user
ALTER TABLE active_supplies 
ADD CONSTRAINT unique_active_supply_per_user 
UNIQUE (bill_number, user_id, status);

-- Add an index for better query performance
CREATE INDEX IF NOT EXISTS idx_active_supplies_bill_number_user_status 
ON active_supplies(bill_number, user_id, status);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Count total records and unique bills
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT bill_number) as unique_bills,
    COUNT(*) - COUNT(DISTINCT bill_number) as duplicates
FROM active_supplies
WHERE status IN ('in_progress', 'In Progress');

-- Show summary by status
SELECT 
    status,
    COUNT(*) as total_records,
    COUNT(DISTINCT bill_number) as unique_bills
FROM active_supplies
GROUP BY status
ORDER BY status;
