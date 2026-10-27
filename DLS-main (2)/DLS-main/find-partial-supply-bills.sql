-- ============================================================================
-- FIND PARTIAL SUPPLY BILLS
-- Bills in approved_bills where received_amount < net_amount (Cash payment)
-- These are shown in the Cash Receipt dashboard as source = 'supply'
-- but only the received_amount is shown, not the full net_amount.
-- ============================================================================

SELECT
    id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    (net_amount - received_amount)                                  AS outstanding_balance,
    ROUND((received_amount / NULLIF(net_amount, 0)) * 100, 2)      AS pct_paid,
    approval_date::DATE                                             AS payment_date,
    receipt_number,
    status
FROM approved_bills
WHERE payment_method = 'Cash'
  AND received_amount > 0
  AND received_amount < net_amount
  
ORDER BY outstanding_balance DESC;
