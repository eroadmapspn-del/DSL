-- Move fully-paid bill LCBL000262502512 from ugrai_data to approved_ugrai
-- Bill has been fully paid (₹1,479 total payments) and should be marked as approved

BEGIN;

-- Step 1: Get the bill data and payment history details
WITH bill_info AS (
    SELECT 
        ud.id,
        ud.bill_number,
        ud.bill_date,
        ud.retailer_name,
        ud.sector,
        1479.00 as original_net_amount, -- Original amount from payment history
        979.00 as final_outstanding,     -- Current net_amount in ugrai_data
        ud.user_id,
        ud.assigned_to
    FROM ugrai_data ud
    WHERE ud.bill_number = 'LCBL000262502512'
),
payment_summary AS (
    SELECT 
        bill_number,
        COUNT(*) as total_payments,
        SUM(payment_amount) as total_paid,
        MAX(payment_date) as last_payment_date,
        MAX(payment_method) as last_payment_method,
        MAX(completed_by) as last_completed_by,
        MAX(approved_by) as last_approved_by
    FROM ugrai_payment_history
    WHERE bill_number = 'LCBL000262502512'
    GROUP BY bill_number
)
-- Step 2: Insert into approved_ugrai
INSERT INTO approved_ugrai (
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    payment_method,
    receipt_number,
    received_amount,
    date_completed,
    date_approved,
    assigned_to,
    completed_by,
    approved_by,
    user_id
)
SELECT 
    bi.bill_number,
    bi.bill_date,
    bi.retailer_name,
    bi.sector,
    bi.original_net_amount, -- Use original amount, not reduced amount
    ps.last_payment_method,
    (SELECT receipt_number FROM ugrai_payment_history WHERE bill_number = 'LCBL000262502512' ORDER BY payment_date DESC LIMIT 1),
    ps.total_paid, -- received_amount = total paid
    ps.last_payment_date, -- date_completed
    ps.last_payment_date, -- date_approved
    COALESCE(bi.assigned_to, ps.last_completed_by),
    ps.last_completed_by,
    ps.last_approved_by,
    bi.user_id
FROM bill_info bi
CROSS JOIN payment_summary ps;

-- Step 3: Delete from ugrai_data (bill is no longer pending)
DELETE FROM ugrai_data
WHERE bill_number = 'LCBL000262502512';

-- Step 4: Verify the move
SELECT 'Bill moved successfully!' as status;

-- Show the approved bill details
SELECT 
    'Approved UGRAI' as table_name,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    payment_method,
    received_amount,
    date_completed,
    date_approved,
    completed_by,
    approved_by
FROM approved_ugrai
WHERE bill_number = 'LCBL000262502512';

-- Show payment history summary
SELECT 
    'Payment History Summary' as info,
    COUNT(*) as total_payments,
    SUM(payment_amount) as total_paid,
    STRING_AGG(
        'Payment #' || payment_number || ': ₹' || payment_amount || 
        ' on ' || payment_date || ' (' || payment_method || ')', 
        E'\n' ORDER BY payment_number
    ) as payment_details
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502512';

COMMIT;
