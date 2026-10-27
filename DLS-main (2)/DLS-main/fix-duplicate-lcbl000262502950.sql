-- Fix duplicate LCBL000262502950 in ugrai_data
-- Keep the correct entry with original net_amount and cumulative received_amount

BEGIN;

-- Step 1: Show current state
SELECT 
    id,
    bill_number,
    net_amount,
    received_amount,
    net_amount - COALESCE(received_amount, 0) as due_amount,
    status,
    created_at,
    user_id
FROM ugrai_data
WHERE bill_number = 'LCBL000262502950'
ORDER BY created_at;

-- Step 2: Get total received from payment history
SELECT 
    bill_number,
    original_net_amount,
    SUM(payment_amount) as total_received,
    original_net_amount - SUM(payment_amount) as outstanding
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502950'
GROUP BY bill_number, original_net_amount;

-- Step 3: Fix payment history - update payment 2 to show it's full payment (0 outstanding)
UPDATE ugrai_payment_history
SET 
    payment_type = 'full',
    outstanding_amount = 0.00,
    notes = 'Full payment - Final payment of 2430 completing total 3430',
    updated_at = NOW()
WHERE bill_number = 'LCBL000262502950'
AND payment_number = 2;

-- Step 4: Delete BOTH entries from ugrai_data (bill is fully paid, shouldn't be there)
DELETE FROM ugrai_data
WHERE bill_number = 'LCBL000262502950';

-- Step 4a: Delete any existing entries in approved_ugrai (cleanup duplicates)
DELETE FROM approved_ugrai
WHERE bill_number = 'LCBL000262502950';

-- Step 5: Insert ONE entry into approved_ugrai (bill is fully paid)
-- Use the latest payment's details but sum all payments for received_amount
WITH latest_payment AS (
    SELECT *
    FROM ugrai_payment_history
    WHERE bill_number = 'LCBL000262502950'
    ORDER BY payment_number DESC
    LIMIT 1
),
total_received AS (
    SELECT SUM(payment_amount) as total
    FROM ugrai_payment_history
    WHERE bill_number = 'LCBL000262502950'
)
INSERT INTO approved_ugrai (
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
    date_approved,
    approved_by,
    assigned_to,
    user_id
)
SELECT 
    lp.bill_number,
    lp.bill_date,
    lp.retailer_name,
    lp.sector,
    lp.original_net_amount as net_amount,
    tr.total as received_amount,
    lp.payment_method,
    lp.receipt_number,
    lp.cheque_date,
    lp.photo_uploaded,
    lp.photo_url,
    lp.payment_date as date_completed,
    CURRENT_DATE as date_approved,
    'Manager' as approved_by,
    lp.completed_by as assigned_to,
    lp.user_id
FROM latest_payment lp
CROSS JOIN total_received tr;

-- Step 6: Verify ugrai_data is empty (bill should not be there)
SELECT 
    id,
    bill_number,
    net_amount,
    received_amount
FROM ugrai_data
WHERE bill_number = 'LCBL000262502950';

-- Step 7: Verify bill is in approved_ugrai
SELECT 
    id,
    bill_number,
    net_amount,
    received_amount,
    net_amount - received_amount as due_amount,
    date_approved,
    approved_by
FROM approved_ugrai
WHERE bill_number = 'LCBL000262502950';

-- Step 8: Verify payment history is correct
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502950'
ORDER BY payment_number;

COMMIT;

-- Expected result:
-- ugrai_data: Empty (0 rows)
-- approved_ugrai: 1 row with Net=3430, Received=3430, Due=0
-- payment_history: 
--   Payment 1: 1000, Outstanding 2430, Type: partial
--   Payment 2: 2430, Outstanding 0, Type: full
