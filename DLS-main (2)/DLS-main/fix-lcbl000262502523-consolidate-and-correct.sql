-- ============================================================================
-- FIX BILL: LCBL000262502523 - EMPIRE DEPARTMENTAL STORE
-- ============================================================================
-- COMPLEX ISSUE: Multiple problems with this bill
-- 
-- Bill Details:
-- - Bill Number: LCBL000262502523
-- - Retailer: EMPIRE DEPARTMENTAL STORE (Selective)
-- - Sector: Empire Store
-- - Original Net Amount: ₹337,433
-- 
-- Problems Found:
-- 1. Payment history starts at payment #2 (missing payment #1 data)
-- 2. Payment #2 (Nov 18): ₹50,000 → outstanding ₹287,433 ❌ (should be based on original ₹337,433)
-- 3. Payment #3 (Nov 25): ₹50,000 → outstanding ₹287,433 ❌ (same wrong amount, should be ₹237,433)
-- 4. Bill exists in BOTH ugrai_data (net ₹287,433) AND ugrai_entries (net ₹337,433)
-- 5. Both show received_amount = 0, but 2 payments totaling ₹100,000 have been made
--
-- Reality: Payment history starts at #2 (no payment #1), total paid = ₹100,000
-- Outstanding should be: ₹337,433 - ₹100,000 = ₹237,433
--
-- Actions:
-- 1. Renumber payment #2 to #1, set outstanding to ₹287,433
-- 2. Renumber payment #3 to #2, set outstanding to ₹237,433
-- 3. Delete from ugrai_data (keep in ugrai_entries as source)
-- 4. Update ugrai_entries with correct received_amount ₹100,000
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Search for ALL payments (including payment #1)
-- ============================================================================
SELECT '=== STEP 1: ALL Payment History (including payment #1 if exists) ===' AS step;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    completed_by,
    approved_by,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502523'
ORDER BY payment_number;

-- ============================================================================
-- STEP 2: Verify both table entries
-- ============================================================================
SELECT '=== STEP 2: Bill in ugrai_data ===' AS step;
SELECT 
    id,
    user_id,
    net_amount,
    received_amount,
    status,
    created_at
FROM ugrai_data
WHERE bill_number = 'LCBL000262502523';

SELECT '=== STEP 3: Bill in ugrai_entries ===' AS step;
SELECT 
    id,
    user_id,
    net_amount,
    received_amount,
    status,
    original_supply_id,
    created_at
FROM ugrai_entries
WHERE bill_number = 'LCBL000262502523';

-- ============================================================================
-- STEP 4: Calculate totals
-- ============================================================================
SELECT '=== STEP 4: Payment Summary ===' AS step;
SELECT 
    COUNT(*) as total_payments,
    MIN(payment_number) as first_payment_number,
    MAX(payment_number) as last_payment_number,
    SUM(payment_amount) as total_paid,
    MAX(original_net_amount) as original_net_amount,
    MAX(original_net_amount) - SUM(payment_amount) as correct_outstanding
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502523';

-- ============================================================================
-- STEP 5: Renumber and fix payment #2 -> #1
-- ============================================================================
SELECT '=== STEP 5: Renumbering payment #2 to #1 and correcting outstanding ===' AS step;

-- Payment #1 (was #2): ₹50,000 paid
-- Outstanding after payment #1: ₹337,433 - ₹50,000 = ₹287,433
UPDATE ugrai_payment_history
SET 
    payment_number = 1,
    outstanding_amount = 287433.00,  -- After 1st payment of ₹50,000
    notes = 'Batch approval - CORRECTED: Payment #1, outstanding after ₹50,000 paid',
    updated_at = NOW()
WHERE bill_number = 'LCBL000262502523'
  AND payment_number = 2
  AND id = '1ca9a4c6-d9ca-455f-8304-64a56bf60317'
RETURNING 
    payment_number,
    payment_amount,
    outstanding_amount AS corrected_outstanding,
    payment_type;

-- ============================================================================
-- STEP 6: Renumber and fix payment #3 -> #2
-- ============================================================================
SELECT '=== STEP 6: Renumbering payment #3 to #2 and correcting outstanding ===' AS step;

-- Payment #2 (was #3): ₹50,000 paid
-- Outstanding after payment #2: ₹337,433 - ₹100,000 = ₹237,433
UPDATE ugrai_payment_history
SET 
    payment_number = 2,
    outstanding_amount = 237433.00,  -- After 2 payments of ₹100,000 total
    payment_type = 'partial',
    notes = 'Partial payment 50000 of 337433 - CORRECTED: Payment #2, total paid ₹100,000, outstanding ₹237,433',
    updated_at = NOW()
WHERE bill_number = 'LCBL000262502523'
  AND payment_number = 3
  AND id = 'a2436c06-e17d-4b12-a0b5-cf9d1c05b0f7'
RETURNING 
    payment_number,
    payment_amount,
    outstanding_amount AS corrected_outstanding,
    payment_type;

-- ============================================================================
-- STEP 7: Update ugrai_entries with correct received_amount
-- ============================================================================
SELECT '=== STEP 7: Updating ugrai_entries received_amount ===' AS step;

-- Calculate actual total paid from payment history
WITH total_paid AS (
    SELECT SUM(payment_amount) as amount
    FROM ugrai_payment_history
    WHERE bill_number = 'LCBL000262502523'
)
UPDATE ugrai_entries
SET 
    received_amount = (SELECT amount FROM total_paid),
    updated_at = NOW()
WHERE bill_number = 'LCBL000262502523'
  AND id = '03d7b203-8f84-44cf-8c85-59def18e3fdd'
RETURNING 
    bill_number,
    net_amount,
    received_amount,
    net_amount - received_amount AS outstanding;

-- ============================================================================
-- STEP 8: Delete duplicate from ugrai_data
-- ============================================================================
SELECT '=== STEP 8: Removing duplicate from ugrai_data ===' AS step;

DELETE FROM ugrai_data
WHERE bill_number = 'LCBL000262502523'
  AND id = '3c2c9465-092e-46df-b32d-c7548e1746db'
RETURNING 
    id,
    net_amount,
    received_amount;

-- ============================================================================
-- STEP 9: Verify corrected payment history
-- ============================================================================
SELECT '=== STEP 9: Verify corrected payment history ===' AS step;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502523'
ORDER BY payment_number;

-- ============================================================================
-- STEP 10: Verify ugrai_entries update
-- ============================================================================
SELECT '=== STEP 10: Verify ugrai_entries ===' AS step;
SELECT 
    bill_number,
    net_amount,
    received_amount,
    net_amount - received_amount AS outstanding,
    status,
    original_supply_id
FROM ugrai_entries
WHERE bill_number = 'LCBL000262502523';

-- ============================================================================
-- STEP 11: Confirm cleanup
-- ============================================================================
SELECT '=== STEP 11: Confirm removed from ugrai_data ===' AS step;
SELECT COUNT(*) AS remaining_in_ugrai_data
FROM ugrai_data
WHERE bill_number = 'LCBL000262502523';

-- ============================================================================
-- Summary of changes
-- ============================================================================
SELECT '=== FINAL SUMMARY ===' AS summary;
WITH payment_totals AS (
    SELECT 
        SUM(payment_amount) as total_paid,
        MAX(original_net_amount) as net_amount
    FROM ugrai_payment_history
    WHERE bill_number = 'LCBL000262502523'
)
SELECT 
    'LCBL000262502523' AS bill_number,
    'EMPIRE DEPARTMENTAL STORE (Selective)' AS retailer,
    'Empire Store' AS sector,
    net_amount,
    total_paid,
    net_amount - total_paid AS outstanding,
    'PARTIAL PAYMENT - Remains in ugrai_entries' AS status
FROM payment_totals;

COMMIT;

-- ============================================================================
-- Corrected Payment Breakdown:
-- Payment #1 (Nov 18, was #2): ₹50,000 → Outstanding: ₹287,433 ✓ (CORRECTED & RENUMBERED)
-- Payment #2 (Nov 25, was #3): ₹50,000 → Outstanding: ₹237,433 ✓ (CORRECTED & RENUMBERED)
-- Total Paid: ₹100,000
-- Still Outstanding: ₹237,433 (PARTIAL PAYMENT)
-- ============================================================================

-- ============================================================================
-- WHY THIS HAPPENED:
-- ============================================================================
-- MULTIPLE ISSUES:
-- 
-- 1. BATCH APPROVAL BUG: Payment #2 marked as "full" when it was partial
-- 
-- 2. WRONG NET AMOUNT USED: The outstanding calculation used ₹287,433 
--    (the reduced amount in ugrai_data) instead of the original ₹337,433
-- 
-- 3. DUPLICATE ENTRIES: Bill exists in both ugrai_data AND ugrai_entries
--    - ugrai_data shows net ₹287,433 (incorrect reduced amount)
--    - ugrai_entries shows net ₹337,433 (correct original amount)
--    This happened because the bill was processed through multiple flows
-- 
-- 4. PAYMENT HISTORY CORRUPTION: Both payments #2 and #3 show the same
--    outstanding amount (₹287,433), indicating the calculation wasn't
--    updating correctly between payments
--
-- 5. MISSING PAYMENT #1 REFERENCE: Payment history starts at #2, suggesting
--    payment #1 data exists but may have used wrong net amount for calculation
-- ============================================================================
