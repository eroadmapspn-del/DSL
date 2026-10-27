-- CORRECT SCRIPT: Revert UGRAI bills from approved_ugrai to completed_ugrai (for future use)
-- Use this script to move bills approved on a specific date back to completed UGRAI

-- Step 1: Insert bills into completed_ugrai from approved_ugrai
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
SELECT 
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
    false as photo_uploaded,
    date_approved as date_completed,  -- Use approval date as completion date
    approved_by as completed_by,
    assigned_to,
    user_id
FROM approved_ugrai
WHERE date_approved = '2025-11-18';  -- Change this date as needed

-- Step 2: Delete bills from approved_ugrai
DELETE FROM approved_ugrai
WHERE date_approved = '2025-11-18';  -- Change this date as needed

-- Verification queries
-- SELECT COUNT(*) as "Bills in completed_ugrai" 
-- FROM completed_ugrai WHERE date_completed = '2025-11-18';

-- SELECT COUNT(*) as "Bills still in approved_ugrai" 
-- FROM approved_ugrai WHERE date_approved = '2025-11-18';

-- View the reverted bills
-- SELECT bill_number, retailer_name, sector, net_amount, date_completed, completed_by
-- FROM completed_ugrai 
-- WHERE date_completed = '2025-11-18'
-- ORDER BY bill_number;
