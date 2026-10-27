-- Move specific 6 bills from ugrai_entries to completed_ugrai
-- Preserving all original data

-- Step 1: Insert the 6 specific bills into completed_ugrai
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
    'Cash' as payment_method,  -- Default payment method
    '' as receipt_number,
    net_amount as received_amount,  -- Full payment
    NULL as cheque_date,
    '' as photo_url,
    false as photo_uploaded,
    CURRENT_DATE as date_completed,
    assigned_to as completed_by,
    assigned_to,
    user_id
FROM ugrai_entries
WHERE id IN (
    'd3537411-42a2-4579-8f4b-d637974e8bf2',
    '5921d0eb-93e1-4258-aad4-2acb3977b67b',
    'cee79912-5fd9-44c9-9784-21c6b6989e2c',
    '63b80bd7-8307-4a31-a15e-9121706963a2',
    '424069e1-48cb-4192-82d6-c1d7024fcc10',
    'c1abf821-1ba3-4774-8503-636c72838575'
);

-- Step 2: Delete these bills from ugrai_entries
DELETE FROM ugrai_entries
WHERE id IN (
    'd3537411-42a2-4579-8f4b-d637974e8bf2',
    '5921d0eb-93e1-4258-aad4-2acb3977b67b',
    'cee79912-5fd9-44c9-9784-21c6b6989e2c',
    '63b80bd7-8307-4a31-a15e-9121706963a2',
    '424069e1-48cb-4192-82d6-c1d7024fcc10',
    'c1abf821-1ba3-4774-8503-636c72838575'
);

-- Verification: Check the bills are in completed_ugrai
SELECT 
    bill_number,
    retailer_name,
    sector,
    net_amount,
    assigned_to,
    date_completed
FROM completed_ugrai
WHERE bill_number IN (
    'Cash-375',
    'Cash-387',
    'LCBL000262502523',
    'LCBL000262502982',
    'NIV6014842501161',
    'NIV6014842501195'
)
ORDER BY bill_number;

-- Verification: Confirm they're gone from ugrai_entries
-- SELECT COUNT(*) as remaining_in_ugrai_entries
-- FROM ugrai_entries
-- WHERE id IN (
--     'd3537411-42a2-4579-8f4b-d637974e8bf2',
--     '5921d0eb-93e1-4258-aad4-2acb3977b67b',
--     'cee79912-5fd9-44c9-9784-21c6b6989e2c',
--     '63b80bd7-8307-4a31-a15e-9121706963a2',
--     '424069e1-48cb-4192-82d6-c1d7024fcc10',
--     'c1abf821-1ba3-4774-8503-636c72838575'
-- );
-- Should return 0
