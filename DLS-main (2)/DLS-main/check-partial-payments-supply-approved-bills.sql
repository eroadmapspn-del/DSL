-- ============================================================================
-- CHECK PARTIAL PAYMENTS IN APPROVED_BILLS (SUPPLY CASH PAYMENTS)
-- ============================================================================
-- Purpose: Verify whether any supply cash payments in approved_bills are
--          partial (received_amount < net_amount) but show as full payments
--          in the Cash Receipt dashboard (source = 'supply' without distinction).
--
-- Key columns:
--   net_amount      = total bill amount
--   received_amount = amount actually collected (used as payment_amount in get_all_cash_payments)
--   payment_method  = must be 'Cash' to appear in cash receipt dashboard
-- ============================================================================


-- ============================================================================
-- QUERY 1: COUNT SUMMARY
-- How many Cash bills in approved_bills are partial vs full payments?
-- ============================================================================
SELECT
    COUNT(*) FILTER (WHERE received_amount = net_amount)  AS full_payments,
    COUNT(*) FILTER (WHERE received_amount < net_amount)  AS partial_payments,
    COUNT(*) FILTER (WHERE received_amount > net_amount)  AS over_payments,   -- data anomaly
    COUNT(*) FILTER (WHERE received_amount = 0)           AS zero_payments,   -- data anomaly
    COUNT(*)                                              AS total_cash_bills
FROM approved_bills
WHERE payment_method = 'Cash';


-- ============================================================================
-- QUERY 2: PARTIAL PAYMENT DETAILS
-- List every Cash bill where received_amount < net_amount.
-- These appear in the Cash Receipt dashboard as source='supply' (not flagged as partial).
-- ============================================================================
SELECT
    id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    (net_amount - received_amount)                            AS outstanding_balance,
    ROUND((received_amount / NULLIF(net_amount, 0)) * 100, 2) AS pct_paid,
    approval_date::DATE                                       AS payment_date,
    receipt_number,
    status
FROM approved_bills
WHERE payment_method = 'Cash'
  AND received_amount < net_amount
ORDER BY outstanding_balance DESC;


-- ============================================================================
-- QUERY 3: FINANCIAL IMPACT SUMMARY OF PARTIAL SUPPLY PAYMENTS
-- What is the total gap between billed and actually received for partial bills?
-- ============================================================================
SELECT
    COUNT(*)                                          AS partial_bill_count,
    SUM(net_amount)                                   AS total_billed_amount,
    SUM(received_amount)                              AS total_received_amount,
    SUM(net_amount - received_amount)                 AS total_outstanding_balance,
    ROUND(AVG(received_amount / NULLIF(net_amount,0)) * 100, 2) AS avg_pct_paid
FROM approved_bills
WHERE payment_method = 'Cash'
  AND received_amount < net_amount;


-- ============================================================================
-- QUERY 4: COMPARE HOW THEY APPEAR IN THE CASH RECEIPT DASHBOARD
-- Show supply partial payments exactly as get_all_cash_payments() returns them
-- (i.e., source = 'supply' with no partial distinction, unlike ugrai_partial).
-- ============================================================================
SELECT
    ab.id::TEXT                                               AS id,
    'supply'::TEXT                                            AS source,   -- always 'supply', never 'supply_partial'
    ab.bill_number,
    ab.bill_date,
    ab.retailer_name,
    ab.sector,
    ab.received_amount                                        AS payment_amount,
    ab.net_amount,
    (ab.net_amount - ab.received_amount)                      AS unreported_outstanding,
    ROUND((ab.received_amount / NULLIF(ab.net_amount,0)) * 100, 2) AS pct_paid,
    ab.approval_date::DATE                                    AS payment_date,
    cr.tally_receipt_number,
    COALESCE(cr.status, 'pending')                            AS receipt_status
FROM approved_bills ab
LEFT JOIN cash_receipts cr
       ON cr.source_table = 'approved_bills'
      AND cr.payment_reference_id = ab.id::TEXT
WHERE ab.payment_method = 'Cash'
  AND ab.received_amount < ab.net_amount
ORDER BY unreported_outstanding DESC;


-- ============================================================================
-- QUERY 5: ZERO-AMOUNT CASH BILLS (data anomaly check)
-- Bills marked as Cash payment but with received_amount = 0
-- These should not appear in the cash receipt dashboard ideally.
-- ============================================================================
SELECT
    id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    approval_date::DATE AS payment_date,
    status
FROM approved_bills
WHERE payment_method = 'Cash'
  AND received_amount = 0
ORDER BY approval_date DESC;


-- ============================================================================
-- QUERY 6: CROSS-CHECK — SAME BILL NUMBER IN BOTH SUPPLY AND UGRAI CASH
-- A bill may be partially paid via Supply and then have follow-up ugrai payments,
-- causing the same bill number to appear in BOTH sources in the dashboard.
-- ============================================================================
SELECT
    ab.bill_number,
    ab.retailer_name,
    ab.sector,
    ab.net_amount                     AS supply_net_amount,
    ab.received_amount                AS supply_received_amount,
    ab.approval_date::DATE            AS supply_payment_date,
    COUNT(uph.id)                     AS ugrai_payment_count,
    SUM(uph.payment_amount)           AS ugrai_total_paid,
    (ab.net_amount
        - ab.received_amount
        - COALESCE(SUM(uph.payment_amount), 0)) AS remaining_outstanding
FROM approved_bills ab
JOIN ugrai_payment_history uph
  ON uph.bill_number = ab.bill_number
 AND uph.payment_method = 'Cash'
WHERE ab.payment_method = 'Cash'
  AND ab.received_amount < ab.net_amount
GROUP BY
    ab.bill_number, ab.retailer_name, ab.sector,
    ab.net_amount, ab.received_amount, ab.approval_date
ORDER BY remaining_outstanding DESC;


-- ============================================================================
-- QUERY 7: SECTOR BREAKDOWN OF PARTIAL SUPPLY CASH PAYMENTS
-- Identify which sectors have the most partial payment exposure.
-- ============================================================================
SELECT
    sector,
    COUNT(*)                          AS partial_bill_count,
    SUM(net_amount)                   AS total_billed,
    SUM(received_amount)              AS total_received,
    SUM(net_amount - received_amount) AS total_outstanding
FROM approved_bills
WHERE payment_method = 'Cash'
  AND received_amount < net_amount
GROUP BY sector
ORDER BY total_outstanding DESC;
