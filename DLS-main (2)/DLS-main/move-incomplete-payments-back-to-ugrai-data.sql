-- Move Incomplete Payment Bills from approved_ugrai back to ugrai_data
-- This handles bills where received_amount < net_amount (partial payments)
-- Author: System Generated
-- Date: 2025-11-08

-- STEP 1: Add received_amount column to ugrai_data if it doesn't exist
-- This allows tracking partial payments in the pending stage
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'ugrai_data' 
        AND column_name = 'received_amount'
    ) THEN
        ALTER TABLE ugrai_data 
        ADD COLUMN received_amount DECIMAL(10,2) DEFAULT 0 NOT NULL;
        
        RAISE NOTICE '✅ Added received_amount column to ugrai_data table';
    ELSE
        RAISE NOTICE '✓ received_amount column already exists in ugrai_data';
    END IF;
END $$;

-- STEP 2: Preview bills that will be moved (those with incomplete payments)
-- Run this to see what bills will be affected
SELECT 
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    (net_amount - received_amount) AS outstanding_amount,
    payment_method,
    date_approved,
    user_id
FROM approved_ugrai
WHERE received_amount < net_amount
ORDER BY bill_date DESC;

-- STEP 3: Insert/Update bills in ugrai_data with incomplete payments
-- Using ON CONFLICT DO UPDATE to handle duplicates
WITH incomplete_bills AS (
    SELECT 
        user_id,
        bill_number,
        bill_date,
        retailer_name,
        sector,
        net_amount,
        received_amount,
        assigned_to,
        NOW() AS created_at,
        NOW() AS updated_at
    FROM approved_ugrai
    WHERE received_amount < net_amount
)
INSERT INTO ugrai_data (
    user_id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    status,
    assigned_to,
    created_at,
    updated_at
)
SELECT 
    user_id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    'Pending' AS status,  -- Reset to Pending for re-processing
    assigned_to,
    created_at,
    updated_at
FROM incomplete_bills
ON CONFLICT (user_id, bill_number) 
DO UPDATE SET
    net_amount = EXCLUDED.net_amount,
    received_amount = EXCLUDED.received_amount,
    status = 'Pending',  -- Reset status to Pending
    sector = EXCLUDED.sector,
    retailer_name = EXCLUDED.retailer_name,
    bill_date = EXCLUDED.bill_date,
    assigned_to = EXCLUDED.assigned_to,
    updated_at = NOW();

-- Get count of affected rows
SELECT COUNT(*) AS bills_moved_to_ugrai_data
FROM approved_ugrai
WHERE received_amount < net_amount;

-- STEP 4: Delete the incomplete payment bills from approved_ugrai
-- Only delete bills that were successfully moved (those with received_amount < net_amount)
DELETE FROM approved_ugrai
WHERE received_amount < net_amount;

-- Get final count
SELECT COUNT(*) AS bills_deleted_from_approved_ugrai
FROM approved_ugrai
WHERE received_amount < net_amount;  -- Should return 0 after deletion

-- STEP 5: Verification - Show bills now in ugrai_data with received amounts
SELECT 
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    (net_amount - received_amount) AS outstanding_amount,
    status,
    assigned_to,
    updated_at
FROM ugrai_data
WHERE received_amount > 0 AND received_amount < net_amount
ORDER BY updated_at DESC
LIMIT 20;

-- STEP 6: Summary Report
SELECT 
    'Summary Report' AS report_type,
    (SELECT COUNT(*) FROM ugrai_data WHERE received_amount > 0 AND received_amount < net_amount) AS incomplete_bills_in_ugrai_data,
    (SELECT COUNT(*) FROM approved_ugrai WHERE received_amount < net_amount) AS incomplete_bills_remaining_in_approved_ugrai,
    (SELECT SUM(net_amount - received_amount) FROM ugrai_data WHERE received_amount > 0 AND received_amount < net_amount) AS total_outstanding_amount;

-- SUCCESS MESSAGE
DO $$ 
BEGIN
    RAISE NOTICE '✅ Migration Complete!';
    RAISE NOTICE '📊 Bills with incomplete payments have been moved from approved_ugrai back to ugrai_data';
    RAISE NOTICE '🔄 These bills now have status = Pending and can be re-processed';
    RAISE NOTICE '💰 The received_amount column preserves the partial payment already made';
END $$;
