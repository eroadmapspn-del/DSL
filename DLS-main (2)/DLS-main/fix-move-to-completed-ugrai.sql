-- URGENT FIX: Move bills from ugrai_entries to completed_ugrai
-- This fixes the bills that were accidentally moved to ugrai_entries instead of completed_ugrai

-- Step 1: Insert bills into completed_ugrai from ugrai_entries
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
    'Cash' as payment_method,  -- Default to Cash, update if needed
    '' as receipt_number,
    net_amount as received_amount,  -- Assuming full payment
    NULL as cheque_date,
    '' as photo_url,
    false as photo_uploaded,
    CURRENT_DATE as date_completed,
    assigned_to as completed_by,
    assigned_to,
    user_id
FROM ugrai_entries
WHERE bill_date = '2025-11-18'
OR created_at >= '2025-11-18'  -- Catch bills just inserted
OR id IN (
    SELECT id FROM ugrai_entries 
    WHERE status = 'Pending' 
    AND current_stage = 'available'
    ORDER BY id DESC 
    LIMIT 100  -- Adjust this number based on how many bills you had
);

-- Step 2: Delete from ugrai_entries
DELETE FROM ugrai_entries
WHERE bill_date = '2025-11-18'
OR created_at >= '2025-11-18'
OR id IN (
    SELECT id FROM ugrai_entries 
    WHERE status = 'Pending' 
    AND current_stage = 'available'
    ORDER BY id DESC 
    LIMIT 100
);

-- Verification
-- SELECT COUNT(*), 'completed_ugrai' as location FROM completed_ugrai WHERE date_completed = '2025-11-18'
-- UNION ALL
-- SELECT COUNT(*), 'ugrai_entries' as location FROM ugrai_entries WHERE bill_date = '2025-11-18';

-- View the bills in completed_ugrai
-- SELECT bill_number, retailer_name, sector, net_amount, date_completed 
-- FROM completed_ugrai 
-- WHERE date_completed = '2025-11-18'
-- ORDER BY bill_number;
