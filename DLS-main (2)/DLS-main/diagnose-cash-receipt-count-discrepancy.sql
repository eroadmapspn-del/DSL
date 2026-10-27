-- ============================================================================
-- DIAGNOSTIC: Count discrepancy between manual backend count and frontend
--
-- Manual count:  511 (approved_bills) + 2048 (ugrai_payment_history) = 2559
-- Frontend shows: 2967
-- Difference: +408 unexplained rows
--
-- get_all_cash_payments() has 4 UNION ALL branches:
--   Branch 1: approved_bills       WHERE payment_method = 'Cash'
--   Branch 2: ugrai_payment_history WHERE payment_method = 'Cash'
--   Branch 3: Orphaned cash_receipts for approved_bills (source deleted)
--   Branch 4: Orphaned cash_receipts for ugrai_payment_history (source deleted)
--
-- Your manual count added "received_amount != 0" — the function does NOT.
-- That alone can account for some of the gap.
-- ============================================================================


-- ============================================================================
-- STEP 1: Reproduce the exact row counts for each branch of get_all_cash_payments()
-- (no date filter — matches frontend "All Time" view)
-- ============================================================================

-- Branch 1: approved_bills (what the function actually queries)
SELECT 'Branch 1 - approved_bills (function logic)'    AS branch,
       COUNT(*)                                        AS row_count
FROM approved_bills
WHERE payment_method = 'Cash';

-- Branch 2: ugrai_payment_history (what the function actually queries)
SELECT 'Branch 2 - ugrai_payment_history (function logic)' AS branch,
       COUNT(*)                                             AS row_count
FROM ugrai_payment_history
WHERE payment_method = 'Cash';

-- Branch 3: Orphaned cash_receipts (approved_bills source deleted)
SELECT 'Branch 3 - Orphaned (approved_bills source deleted)' AS branch,
       COUNT(*)                                               AS row_count
FROM cash_receipts cr
WHERE cr.source_table = 'approved_bills'
  AND NOT EXISTS (
      SELECT 1 FROM approved_bills ab
      WHERE ab.id::TEXT = cr.payment_reference_id
  );

-- Branch 4: Orphaned cash_receipts (ugrai_payment_history source deleted)
SELECT 'Branch 4 - Orphaned (ugrai_payment_history source deleted)' AS branch,
       COUNT(*)                                                      AS row_count
FROM cash_receipts cr
WHERE cr.source_table = 'ugrai_payment_history'
  AND NOT EXISTS (
      SELECT 1 FROM ugrai_payment_history uph
      WHERE uph.id::TEXT = cr.payment_reference_id
  );

-- Grand total of all 4 branches (should match frontend count of 2967)
SELECT
    (SELECT COUNT(*) FROM approved_bills WHERE payment_method = 'Cash')
    +
    (SELECT COUNT(*) FROM ugrai_payment_history WHERE payment_method = 'Cash')
    +
    (SELECT COUNT(*) FROM cash_receipts cr
     WHERE cr.source_table = 'approved_bills'
       AND NOT EXISTS (SELECT 1 FROM approved_bills ab WHERE ab.id::TEXT = cr.payment_reference_id))
    +
    (SELECT COUNT(*) FROM cash_receipts cr
     WHERE cr.source_table = 'ugrai_payment_history'
       AND NOT EXISTS (SELECT 1 FROM ugrai_payment_history uph WHERE uph.id::TEXT = cr.payment_reference_id))
    AS total_function_rows;


-- ============================================================================
-- STEP 2: Explain the gap from YOUR manual count
-- Your count: approved_bills WHERE received_amount != 0  → 511
-- Function:   approved_bills with NO received_amount filter
-- ============================================================================

-- How many supply bills have received_amount = 0 (included by function, excluded by your count)?
SELECT 'approved_bills Cash + received_amount = 0 (function includes, your count excluded)' AS note,
       COUNT(*) AS extra_rows
FROM approved_bills
WHERE payment_method = 'Cash'
  AND received_amount = 0;

-- How many ugrai bills have payment_amount = 0 (check if column name mismatch too)?
SELECT 'ugrai_payment_history Cash + payment_amount = 0' AS note,
       COUNT(*) AS extra_rows
FROM ugrai_payment_history
WHERE payment_method = 'Cash'
  AND payment_amount = 0;


-- ============================================================================
-- STEP 3: Map out where the full 2967 comes from
-- Unified summary showing all contributing factors
-- ============================================================================
SELECT
    'approved_bills (all Cash)'                   AS source,
    COUNT(*)                                       AS count,
    COUNT(*) FILTER (WHERE received_amount = 0)   AS zero_amount_count,
    COUNT(*) FILTER (WHERE received_amount > 0)   AS nonzero_amount_count
FROM approved_bills WHERE payment_method = 'Cash'

UNION ALL

SELECT
    'ugrai_payment_history (all Cash)',
    COUNT(*),
    COUNT(*) FILTER (WHERE payment_amount = 0),
    COUNT(*) FILTER (WHERE payment_amount > 0)
FROM ugrai_payment_history WHERE payment_method = 'Cash'

UNION ALL

SELECT
    'Orphaned cash_receipts (approved_bills)',
    COUNT(*), 0, COUNT(*)
FROM cash_receipts cr
WHERE cr.source_table = 'approved_bills'
  AND NOT EXISTS (SELECT 1 FROM approved_bills ab WHERE ab.id::TEXT = cr.payment_reference_id)

UNION ALL

SELECT
    'Orphaned cash_receipts (ugrai_payment_history)',
    COUNT(*), 0, COUNT(*)
FROM cash_receipts cr
WHERE cr.source_table = 'ugrai_payment_history'
  AND NOT EXISTS (SELECT 1 FROM ugrai_payment_history uph WHERE uph.id::TEXT = cr.payment_reference_id);


-- ============================================================================
-- STEP 4: List the differing bills
-- Bills in approved_bills with Cash payment but received_amount = 0
-- (included in frontend but excluded from your manual count)
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
-- STEP 5: List orphaned cash_receipts (receipts whose source row was deleted)
-- These show up in the frontend but have no matching bill in any source table.
-- These should be investigated / cleaned up.
-- ============================================================================

-- Orphaned from approved_bills
SELECT
    cr.id,
    cr.payment_source,
    cr.source_table,
    cr.payment_reference_id,
    cr.bill_number,
    cr.bill_date,
    cr.retailer_name,
    cr.payment_amount,
    cr.tally_receipt_number,
    cr.status,
    cr.created_at
FROM cash_receipts cr
WHERE cr.source_table = 'approved_bills'
  AND NOT EXISTS (
      SELECT 1 FROM approved_bills ab
      WHERE ab.id::TEXT = cr.payment_reference_id
  )
ORDER BY cr.created_at DESC;

-- Orphaned from ugrai_payment_history
SELECT
    cr.id,
    cr.payment_source,
    cr.source_table,
    cr.payment_reference_id,
    cr.bill_number,
    cr.bill_date,
    cr.retailer_name,
    cr.payment_amount,
    cr.tally_receipt_number,
    cr.status,
    cr.created_at
FROM cash_receipts cr
WHERE cr.source_table = 'ugrai_payment_history'
  AND NOT EXISTS (
      SELECT 1 FROM ugrai_payment_history uph
      WHERE uph.id::TEXT = cr.payment_reference_id
  )
ORDER BY cr.created_at DESC;
