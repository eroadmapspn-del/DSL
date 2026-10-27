-- Revert bill IN10000262500196 from approved_bills back to active_supplies (Supply Management)
-- Run this script to move the bill back to supply management

-- Step 1: Insert the bill back into active_supplies from approved_bills
INSERT INTO active_supplies (
    bill_id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    brand,
    supply_through,
    status,
    payment_method,
    receipt_number,
    received_amount,
    cheque_date,
    photo_url,
    user_id
)
SELECT 
    original_bill_id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    brand,
    supply_through,
    'Delivered' as status,  -- Reset to Delivered status
    payment_method,
    receipt_number,
    received_amount,
    cheque_date,
    photo_url,
    user_id
FROM approved_bills
WHERE bill_number = 'IN10000262500196';

-- Step 2: Delete the bill from approved_bills
DELETE FROM approved_bills
WHERE bill_number = 'IN10000262500196';

-- Step 3: Also delete from ugrai_entries if it was created as a credit/partial payment bill
DELETE FROM ugrai_entries
WHERE bill_number = 'IN10000262500196'
AND status = 'Pending';

-- Verification queries (run these to confirm the revert was successful)
-- SELECT * FROM active_supplies WHERE bill_number = 'IN10000262500196';
-- SELECT * FROM approved_bills WHERE bill_number = 'IN10000262500196';
-- SELECT * FROM ugrai_entries WHERE bill_number = 'IN10000262500196';
