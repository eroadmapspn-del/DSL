-- Check for negative due amounts in get_pending_bills_detailed()

SELECT 
    bill_number,
    retailer_name,
    net_amount,
    bill_received_amount,
    payment_history_received,
    total_received,
    due_amount,
    source_table,
    CASE 
        WHEN due_amount < 0 THEN ' NEGATIVE'
        WHEN due_amount = 0 THEN ' FULLY PAID'
        ELSE ' PENDING'
    END as status
FROM get_pending_bills_detailed()
WHERE due_amount < 0
ORDER BY due_amount ASC;

-- Show calculation breakdown
SELECT 
    bill_number,
    net_amount as original_amount,
    bill_received_amount as received_in_bill_table,
    payment_history_received as received_in_payment_history,
    CASE 
        WHEN bill_received_amount > 0 
        THEN bill_received_amount
        ELSE payment_history_received
    END as total_received_used,
    net_amount - CASE 
        WHEN bill_received_amount > 0 
        THEN bill_received_amount
        ELSE payment_history_received
    END as calculated_due
FROM get_pending_bills_detailed()
WHERE due_amount < 0
ORDER BY bill_number;
