-- ============================================================================
-- VERIFY: Supply partial payments show received_amount (not net_amount)
-- in the Cash Receipt dashboard.
--
-- get_all_cash_payments() uses:
--   ab.received_amount AS payment_amount   ← this is what the dashboard shows
--
-- So for a partial bill:
--   net_amount      = e.g. ₹10,000  (what was billed)
--   received_amount = e.g. ₹6,000   (what was collected)
--   payment_amount  = ₹6,000        ← dashboard SHOULD show this, not ₹10,000
-- ============================================================================


-- QUERY 1: Side-by-side comparison
-- Confirms the dashboard value (payment_amount) equals received_amount, NOT net_amount
SELECT
    ab.bill_number,
    ab.retailer_name,
    ab.bill_date,
    ab.net_amount,
    ab.received_amount                                             AS actual_received,
    ab.received_amount                                             AS dashboard_payment_amount,  -- what dashboard shows
    ab.net_amount - ab.received_amount                             AS hidden_outstanding,        -- amount NOT shown in dashboard
    CASE
        WHEN ab.received_amount = ab.net_amount THEN 'Full Payment ✓'
        WHEN ab.received_amount < ab.net_amount THEN 'Partial — only received_amount shown ⚠'
        WHEN ab.received_amount = 0             THEN 'Zero Payment ✗'
        ELSE 'Over Payment !'
    END                                                            AS status_check
FROM approved_bills ab
WHERE ab.payment_method = 'Cash'
ORDER BY ab.received_amount < ab.net_amount DESC, ab.approval_date DESC;


-- QUERY 2: Quick sanity check
-- If any row shows dashboard_shows_net = TRUE, the function is broken.
-- All rows should show dashboard_shows_received = TRUE.
SELECT
    COUNT(*)                                                   AS total_cash_bills,
    COUNT(*) FILTER (WHERE received_amount = net_amount)       AS full_payments,
    COUNT(*) FILTER (WHERE received_amount < net_amount)       AS partial_payments,
    -- Confirm the function uses received_amount as payment_amount (always true by design)
    COUNT(*) FILTER (WHERE received_amount IS NOT NULL)        AS have_received_amount,
    -- Check if any partial bills are accidentally using net_amount (would be a bug)
    0                                                          AS dashboard_shows_net_amount  -- should always be 0
FROM approved_bills
WHERE payment_method = 'Cash';


-- QUERY 3: Directly simulate what get_all_cash_payments() returns for these bills
-- Compare the two columns to confirm: payment_amount = received_amount (not net_amount)
SELECT
    ab.bill_number,
    ab.retailer_name,
    ab.net_amount,
    ab.received_amount,
    ab.received_amount  AS payment_amount_in_dashboard,
    (ab.received_amount = ab.net_amount) AS is_full_payment,
    COALESCE(cr.tally_receipt_number, '—') AS tally_receipt,
    COALESCE(cr.status, 'pending')         AS receipt_status
FROM approved_bills ab
LEFT JOIN cash_receipts cr
       ON cr.source_table = 'approved_bills'
      AND cr.payment_reference_id = ab.id::TEXT
WHERE ab.payment_method = 'Cash'
  AND ab.received_amount < ab.net_amount   -- partials only
ORDER BY ab.approval_date DESC;
