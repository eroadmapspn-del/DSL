-- Move bill L4816 from ugrai_data to approved_ugrai
-- Using payment_history data for all field values
-- Manual approval migration

BEGIN;

-- Step 1: Verify the bill exists in ugrai_data
SELECT 
    'Current state in ugrai_data:' as step,
    id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    status,
    assigned_to,
    user_id,
    created_at
FROM ugrai_data
WHERE bill_number = 'L4816';

-- Step 2: Check payment_history records for L4816
SELECT 
    'Payment history records:' as step,
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    receipt_number,
    cheque_date,
    completed_by,
    approved_by,
    date_approved,
    photo_uploaded,
    photo_url
FROM ugrai_payment_history
WHERE bill_number = 'L4816'
ORDER BY payment_number;

-- Step 3: Verify full payment (sum of payments = net_amount)
SELECT 
    'Payment verification:' as step,
    u.bill_number,
    u.net_amount as original_net_amount,
    COALESCE(SUM(ph.payment_amount), 0) as total_paid,
    u.net_amount - COALESCE(SUM(ph.payment_amount), 0) as difference,
    CASE 
        WHEN u.net_amount = COALESCE(SUM(ph.payment_amount), 0) THEN 'FULL PAYMENT CONFIRMED ✓'
        ELSE 'WARNING: PARTIAL PAYMENT - Aborting!'
    END as payment_status
FROM ugrai_data u
LEFT JOIN ugrai_payment_history ph ON ph.bill_number = u.bill_number
WHERE u.bill_number = 'L4816'
GROUP BY u.bill_number, u.net_amount;

-- Step 4: Insert into approved_ugrai using last payment record
INSERT INTO approved_ugrai (
    user_id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    status,
    assigned_to,
    payment_method,
    receipt_number,
    cheque_date,
    photo_uploaded,
    photo_url,
    date_completed,
    date_approved,
    completed_by,
    approved_by
)
SELECT 
    u.user_id,
    u.bill_number,
    u.bill_date,
    u.retailer_name,
    u.sector,
    u.net_amount,
    payments.total_received_amount,
    'Approved' as status,
    u.assigned_to,
    last_payment.payment_method,
    last_payment.receipt_number,
    last_payment.cheque_date,
    last_payment.photo_uploaded,
    last_payment.photo_url,
    last_payment.payment_date as date_completed,
    last_payment.date_approved,
    last_payment.completed_by,
    last_payment.approved_by
FROM ugrai_data u
CROSS JOIN LATERAL (
    -- Get sum of all payments
    SELECT SUM(payment_amount) as total_received_amount
    FROM ugrai_payment_history
    WHERE bill_number = 'L4816'
) payments
CROSS JOIN LATERAL (
    -- Get the last payment record (highest payment_number)
    SELECT 
        payment_method,
        receipt_number,
        cheque_date,
        photo_uploaded,
        photo_url,
        payment_date,
        date_approved,
        completed_by,
        approved_by
    FROM ugrai_payment_history
    WHERE bill_number = 'L4816'
    ORDER BY payment_number DESC
    LIMIT 1
) last_payment
WHERE u.bill_number = 'L4816'
AND NOT EXISTS (
    SELECT 1 FROM approved_ugrai WHERE bill_number = 'L4816'
)
-- Ensure full payment before inserting
AND u.net_amount = payments.total_received_amount;

-- Step 5: Delete from ugrai_data
DELETE FROM ugrai_data
WHERE bill_number = 'L4816'
AND EXISTS (
    SELECT 1 FROM approved_ugrai WHERE bill_number = 'L4816'
)
RETURNING 
    bill_number,
    net_amount,
    received_amount,
    'Deleted from ugrai_data' as action;

-- Step 6: Verify the move
SELECT 
    'Bill successfully moved to approved_ugrai:' as step,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    status,
    payment_method,
    receipt_number,
    date_completed,
    date_approved,
    assigned_to,
    completed_by,
    approved_by,
    photo_uploaded,
    photo_url
FROM approved_ugrai
WHERE bill_number = 'L4816';

-- Step 7: Final verification - ensure it's not in ugrai_data
SELECT 
    'Remaining in ugrai_data (should be 0):' as step,
    COUNT(*) as count
FROM ugrai_data
WHERE bill_number = 'L4816';

COMMIT;
