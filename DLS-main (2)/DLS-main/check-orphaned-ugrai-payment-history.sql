-- Find bills in ugrai_payment_history that are NOT in any of the main UGRAI tables
-- These are "orphaned" payment records that need to be moved back

SELECT DISTINCT
    ph.bill_number,
    ph.bill_date,
    ph.retailer_name,
    ph.sector,
    ph.original_net_amount,
    SUM(ph.payment_amount) as total_received,
    ph.original_net_amount - SUM(ph.payment_amount) as outstanding,
    COUNT(ph.payment_number) as payment_count,
    MAX(ph.payment_date) as last_payment_date,
    MAX(ph.payment_type) as last_payment_type
FROM ugrai_payment_history ph
WHERE 
    -- Not in ugrai_data
    NOT EXISTS (
        SELECT 1 FROM ugrai_data ud 
        WHERE ud.bill_number = ph.bill_number
    )
    -- Not in ugrai_entries
    AND NOT EXISTS (
        SELECT 1 FROM ugrai_entries ue 
        WHERE ue.bill_number = ph.bill_number
    )
    -- Not in completed_ugrai
    AND NOT EXISTS (
        SELECT 1 FROM completed_ugrai cu 
        WHERE cu.bill_number = ph.bill_number
    )
    -- Not in approved_ugrai
    AND NOT EXISTS (
        SELECT 1 FROM approved_ugrai au 
        WHERE au.bill_number = ph.bill_number
    )
GROUP BY 
    ph.bill_number, 
    ph.bill_date, 
    ph.retailer_name, 
    ph.sector, 
    ph.original_net_amount
ORDER BY 
    last_payment_date DESC;

-- Summary count
SELECT 
    COUNT(DISTINCT ph.bill_number) as orphaned_bills_count
FROM ugrai_payment_history ph
WHERE 
    NOT EXISTS (SELECT 1 FROM ugrai_data ud WHERE ud.bill_number = ph.bill_number)
    AND NOT EXISTS (SELECT 1 FROM ugrai_entries ue WHERE ue.bill_number = ph.bill_number)
    AND NOT EXISTS (SELECT 1 FROM completed_ugrai cu WHERE cu.bill_number = ph.bill_number)
    AND NOT EXISTS (SELECT 1 FROM approved_ugrai au WHERE au.bill_number = ph.bill_number);
