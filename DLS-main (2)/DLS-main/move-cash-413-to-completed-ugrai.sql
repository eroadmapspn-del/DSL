-- Move bill Cash-413 from ugrai_entries to completed_ugrai
-- This bill has a partial payment history, preserving all data accurately
-- 
-- DATA TO PRESERVE:
-- Bill Number: Cash-413
-- Bill Date: 2025-11-14
-- Retailer: Deepak Bhaiya RPS
-- Sector: MM CASH
-- Net Amount: ₹48,413 (outstanding amount after ₹30,000 partial payment)
-- Payment Method: Cash
-- Receipt Number: 1234
-- Received Amount: ₹30,000 (partial payment made)
-- Completed By: Akash
-- Photo Uploaded: true
-- User ID: 91fedb12-77d7-41a2-880a-467b401949da

-- Step 1: Insert the bill into completed_ugrai with accurate data
INSERT INTO completed_ugrai (
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    payment_method,
    receipt_number,
    received_amount,
    cheque_date,
    photo_url,
    photo_uploaded,
    date_completed,
    completed_by,
    assigned_to,
    user_id
)
VALUES (
    'Cash-413',
    '2025-11-14',
    'Deepak Bhaiya RPS',
    'MM CASH',
    48413.00,  -- Outstanding amount
    'Cash',
    '1234',
    30000.00,  -- Partial payment received
    NULL,
    NULL,
    true,
    '2025-11-18',
    'Akash',
    'Akash',
    '91fedb12-77d7-41a2-880a-467b401949da'
);

-- Step 2: Delete the bill from ugrai_entries
DELETE FROM ugrai_entries
WHERE id = 'd71ea798-3050-4023-a6f9-1017fdce3ec2'
AND bill_number = 'Cash-413';

-- Verification: Check the bill is in completed_ugrai
SELECT 
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    payment_method,
    receipt_number,
    received_amount,
    completed_by,
    date_completed,
    photo_uploaded
FROM completed_ugrai
WHERE bill_number = 'Cash-413'
ORDER BY id DESC
LIMIT 1;

-- Verification: Confirm payment history is still intact
SELECT 
    bill_number,
    original_net_amount,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    receipt_number,
    completed_by,
    approved_by,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'Cash-413'
ORDER BY payment_number;

-- Verification: Confirm it's gone from ugrai_entries
-- SELECT COUNT(*) as remaining_in_ugrai_entries
-- FROM ugrai_entries
-- WHERE bill_number = 'Cash-413';
-- Should return 0

-- Summary of what this preserves:
-- ✓ Bill Number: Cash-413
-- ✓ Bill Date: 2025-11-14
-- ✓ Retailer: Deepak Bhaiya RPS
-- ✓ Sector: MM CASH
-- ✓ Net Amount: 48413.00 (outstanding amount after 30000 payment)
-- ✓ Payment Method: Cash (from payment history)
-- ✓ Receipt Number: 1234 (from payment history)
-- ✓ Completed By: Akash (from payment history)
-- ✓ Photo Uploaded: true (from payment history)
-- ✓ Payment History: Remains in ugrai_payment_history table
