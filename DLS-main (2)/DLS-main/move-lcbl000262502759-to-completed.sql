-- Move bill LCBL000262502759 from ugrai_payment_history back to completed_ugrai for testing
-- This simulates the bill being completed again for batch approval testing

BEGIN;

-- Step 1: Get the payment history details
SELECT 
    bill_number,
    bill_date,
    retailer_name,
    sector,
    original_net_amount,
    payment_amount as received_amount,
    payment_method,
    receipt_number,
    cheque_date,
    photo_uploaded,
    photo_url,
    completed_by,
    date_approved as date_completed
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502759'
ORDER BY payment_number DESC
LIMIT 1;

-- Step 2: Delete from ugrai_payment_history
DELETE FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502759';

-- Step 3: Delete from approved_ugrai if exists
DELETE FROM approved_ugrai
WHERE bill_number = 'LCBL000262502759';

-- Step 4: Delete from ugrai_data if exists
DELETE FROM ugrai_data
WHERE bill_number = 'LCBL000262502759';

-- Step 5: Insert into completed_ugrai
INSERT INTO completed_ugrai (
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    payment_method,
    receipt_number,
    cheque_date,
    photo_uploaded,
    photo_url,
    date_completed,
    assigned_to,
    user_id
)
VALUES (
    'LCBL000262502759',
    '2025-10-09',
    'WOMEN GALLERY-MNY(SELECTIVE)',
    'Sector 15',
    151184.00,
    50000.00,
    'NEFT',
    '',
    NULL,
    false,
    '',
    '2025-11-26',
    'Prem',
    '91fedb12-77d7-41a2-880a-467b401949da'
);

-- Step 6: Verify the bill is in completed_ugrai
SELECT 
    id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    net_amount - received_amount as outstanding,
    payment_method,
    date_completed,
    assigned_to
FROM completed_ugrai
WHERE bill_number = 'LCBL000262502759';

-- Step 7: Verify the bill is NOT in ugrai_data (should be empty after this)
SELECT 
    id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    status
FROM ugrai_data
WHERE bill_number = 'LCBL000262502759';

-- Step 8: Verify the bill is NOT in ugrai_payment_history (should be empty)
SELECT 
    id,
    bill_number,
    payment_number,
    payment_amount,
    outstanding_amount
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502759';

-- Step 9: Verify the bill is NOT in approved_ugrai (should be empty)
SELECT 
    id,
    bill_number,
    net_amount,
    received_amount
FROM approved_ugrai
WHERE bill_number = 'LCBL000262502759';

COMMIT;

-- Expected result:
-- Bill LCBL000262502759 will be in completed_ugrai with:
--   Net Amount: 151184.00
--   Received Amount: 50000.00
--   Outstanding: 101184.00
-- 
-- Now you can test batch approval, which should:
-- 1. Detect it's a partial payment (50000 < 151184)
-- 2. Remove from completed_ugrai
-- 3. Check and remove from approved_ugrai if exists
-- 4. Add back to ugrai_data with status 'Pending'
-- 5. Record in payment history with payment_type='partial'
