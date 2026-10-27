-- ============================================================================
-- MOVE INCOMPLETE BILLS FROM approved_ugrai TO ugrai_data
-- Preserves received_amount and all other relevant fields
-- Bills with received_amount < net_amount are considered incomplete
-- ============================================================================

-- STEP 1: Preview bills that will be moved (RUN THIS FIRST!)
SELECT 
    'Bills to be moved (incomplete payments)' as preview,
    bill_number,
    retailer_name,
    net_amount,
    received_amount,
    net_amount - received_amount as outstanding_amount,
    ROUND((received_amount / net_amount * 100), 2) as percent_paid,
    payment_method,
    date_completed,
    completed_by
FROM approved_ugrai
WHERE received_amount < net_amount
ORDER BY bill_number;

-- STEP 2: Count of bills to be moved
SELECT 
    'Summary: Bills to move' as summary,
    COUNT(*) as total_bills,
    SUM(net_amount) as total_net_amount,
    SUM(received_amount) as total_received,
    SUM(net_amount - received_amount) as total_outstanding
FROM approved_ugrai
WHERE received_amount < net_amount;

-- STEP 3: Check for conflicts (bills that already exist in ugrai_data)
SELECT 
    'Potential conflicts (already in ugrai_data)' as check_type,
    au.bill_number,
    au.net_amount as approved_amount,
    ud.net_amount as data_amount,
    au.received_amount as approved_received,
    ud.received_amount as data_received
FROM approved_ugrai au
INNER JOIN ugrai_data ud 
    ON au.bill_number = ud.bill_number 
    AND au.user_id = ud.user_id
WHERE au.received_amount < au.net_amount;

-- STEP 4: BACKUP before moving (RECOMMENDED!)
-- Creates a backup table with timestamp
DO $$
DECLARE
    backup_table_name TEXT;
    bill_count INT;
BEGIN
    backup_table_name := 'approved_ugrai_incomplete_backup_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS');
    
    -- Backup incomplete bills from approved_ugrai
    EXECUTE format('CREATE TABLE %I AS 
        SELECT * FROM approved_ugrai 
        WHERE received_amount < net_amount', 
        backup_table_name);
    
    EXECUTE format('SELECT COUNT(*) FROM %I', backup_table_name) INTO bill_count;
    RAISE NOTICE '✅ Backup created: % (% bills)', backup_table_name, bill_count;
END $$;

-- STEP 5: INSERT incomplete bills into ugrai_data (✅ PRESERVING received_amount)
WITH moved_bills AS (
    INSERT INTO ugrai_data (
        user_id,
        bill_number,
        bill_date,
        retailer_name,
        sector,
        net_amount,
        received_amount,  -- ✅ KEY FIELD: Preserve partial payments
        status,
        assigned_to,
        current_stage
    )
    SELECT 
        user_id,
        bill_number,
        bill_date,
        retailer_name,
        sector,
        net_amount,
        received_amount,  -- ✅ KEY: Copy the actual received_amount from approved_ugrai
        'Pending' as status,
        NULL as assigned_to,  -- Will be assigned when pickup starts
        'available' as current_stage
    FROM approved_ugrai
    WHERE received_amount < net_amount
    ON CONFLICT (user_id, bill_number) 
    DO UPDATE SET
        -- If bill already exists in ugrai_data, use the HIGHER received_amount
        received_amount = GREATEST(ugrai_data.received_amount, EXCLUDED.received_amount),
        net_amount = EXCLUDED.net_amount,
        bill_date = EXCLUDED.bill_date,
        retailer_name = EXCLUDED.retailer_name,
        sector = EXCLUDED.sector,
        status = CASE 
            WHEN ugrai_data.status = 'Completed' THEN ugrai_data.status
            ELSE 'Pending'
        END,
        current_stage = CASE 
            WHEN ugrai_data.status = 'Completed' THEN ugrai_data.current_stage
            ELSE 'available'
        END
    RETURNING bill_number, received_amount, net_amount
)
SELECT 
    COUNT(*) as bills_moved,
    SUM(received_amount) as total_received_preserved,
    SUM(net_amount - received_amount) as total_outstanding
FROM moved_bills;

-- STEP 6: DELETE incomplete bills from approved_ugrai (after successful insert)
WITH deleted_bills AS (
    DELETE FROM approved_ugrai
    WHERE received_amount < net_amount
    RETURNING bill_number, received_amount, net_amount
)
SELECT 
    COUNT(*) as bills_deleted_from_approved,
    SUM(received_amount) as total_received_deleted,
    SUM(net_amount) as total_net_deleted,
    SUM(net_amount - received_amount) as total_outstanding_deleted
FROM deleted_bills;

-- STEP 7: VERIFICATION - Final check
SELECT 
    '✅ Verification: After move' as summary,
    (SELECT COUNT(*) FROM approved_ugrai WHERE received_amount < net_amount) as incomplete_still_in_approved,
    (SELECT COUNT(*) FROM ugrai_data WHERE received_amount > 0 AND received_amount < net_amount) as incomplete_now_in_ugrai_data
FROM approved_ugrai
LIMIT 1;

-- STEP 8: Sample bills with preserved received_amount
SELECT 
    'Sample: Moved bills in ugrai_data' as check_type,
    bill_number,
    net_amount,
    received_amount,
    net_amount - received_amount as outstanding,
    ROUND((received_amount / net_amount * 100), 2) as percent_paid,
    status,
    current_stage
FROM ugrai_data
WHERE received_amount > 0 AND received_amount < net_amount
ORDER BY bill_number
LIMIT 20;

-- STEP 9: Specific bill check (e.g., L4816 that lost received_amount previously)
-- Replace 'L4816' with any specific bill number you want to verify
SELECT 
    'Specific bill check' as check_type,
    bill_number,
    net_amount,
    received_amount,
    net_amount - received_amount as outstanding,
    status
FROM ugrai_data
WHERE bill_number LIKE '%4816%'
   OR bill_number LIKE '%L4816%';

-- ============================================================================
-- NOTES:
-- ============================================================================
-- ✅ This script now PRESERVES received_amount when moving bills
-- ✅ Bills with partial payments (e.g., received_amount = 9025.00) will retain that value
-- ✅ Outstanding amounts will be calculated correctly: net_amount - received_amount
-- ✅ ON CONFLICT clause ensures we keep the HIGHER received_amount if bill exists
-- ✅ Backup table created before any changes
--
-- Example: Bill L4816 with net_amount=50000, received_amount=9025
--   Before: Lost received_amount (became 0)
--   After: Preserves received_amount=9025, outstanding=40975
-- ============================================================================
