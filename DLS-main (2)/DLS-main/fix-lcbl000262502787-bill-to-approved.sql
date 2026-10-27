-- ============================================================================
-- FIX BILL: LCBL000262502787 - Vishal Dairy & Confectionary
-- ============================================================================
-- ISSUE: Bill fully paid but has incorrect outstanding_amount in payment #2
-- 
-- Bill Details:
-- - Bill Number: LCBL000262502787
-- - Retailer: Vishal Dairy & Confectionary
-- - Sector: Sector 16
-- - Net Amount: ₹2,717
-- - Payment #1 (Nov 16): ₹1,717 UPI → outstanding ₹1,000 ✓
-- - Payment #2 (Nov 23): ₹1,000 Cash → outstanding ₹1,717 ❌ (should be ₹0)
-- - Total Received: ₹2,717 (FULLY PAID)
--
-- Actions:
-- 1. Correct payment #2 outstanding_amount from ₹1,717 to ₹0
-- 2. Move bill from ugrai_data to approved_ugrai
-- 3. Clean up duplicate entries
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Verify current state
-- ============================================================================
SELECT '=== STEP 1: Current Payment History ===' AS step;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    user_id
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502787'
ORDER BY payment_number;

-- ============================================================================
-- STEP 2: Verify ugrai_data entries
-- ============================================================================
SELECT '=== STEP 2: Current ugrai_data entries ===' AS step;
SELECT 
    id,
    user_id,
    net_amount,
    received_amount,
    status,
    created_at
FROM ugrai_data
WHERE bill_number = 'LCBL000262502787'
ORDER BY created_at;

-- ============================================================================
-- STEP 3: Fix payment #2 outstanding_amount
-- ============================================================================
SELECT '=== STEP 3: Correcting payment #2 outstanding_amount ===' AS step;

UPDATE ugrai_payment_history
SET 
    outstanding_amount = 0.00,
    payment_type = 'full',
    updated_at = NOW()
WHERE bill_number = 'LCBL000262502787'
  AND payment_number = 2
  AND id = '12ef33b5-7533-426b-9f3e-08b562b67e78'
RETURNING 
    payment_number,
    payment_amount,
    outstanding_amount AS corrected_outstanding,
    payment_type;

-- ============================================================================
-- STEP 4: Verify payment history correction
-- ============================================================================
SELECT '=== STEP 4: Verify corrected payment history ===' AS step;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502787'
ORDER BY payment_number;

-- Verify total payments
SELECT 
    '=== Payment Summary ===' AS summary,
    COUNT(*) AS total_payments,
    SUM(payment_amount) AS total_paid,
    MIN(outstanding_amount) AS final_outstanding
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502787';

-- ============================================================================
-- STEP 5: Move bill to approved_ugrai
-- ============================================================================
SELECT '=== STEP 5: Moving bill to approved_ugrai ===' AS step;

INSERT INTO approved_ugrai (
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    status,
    assigned_to,
    date_completed,
    date_approved,
    payment_method,
    user_id
)
SELECT 
    'LCBL000262502787',
    '2025-10-11'::date,
    'Vishal Dairy & Confectionary',
    'Sector 16',
    2717.00,
    2717.00,  -- Fully paid
    'Completed',
    'Prem',
    '2025-11-23'::timestamp,  -- Date of final payment
    '2025-11-23'::timestamp,
    'Cash',  -- Last payment method used
    '91fedb12-77d7-41a2-880a-467b401949da'  -- Most recent user_id
WHERE NOT EXISTS (
    SELECT 1 FROM approved_ugrai 
    WHERE bill_number = 'LCBL000262502787'
)
RETURNING bill_number, net_amount, received_amount, date_approved;

-- ============================================================================
-- STEP 6: Delete bill from ugrai_data
-- ============================================================================
SELECT '=== STEP 6: Removing bill from ugrai_data ===' AS step;

DELETE FROM ugrai_data
WHERE bill_number = 'LCBL000262502787'
RETURNING 
    id,
    user_id,
    net_amount,
    received_amount;

-- ============================================================================
-- STEP 7: Verify final state
-- ============================================================================
SELECT '=== STEP 7: Verify bill in approved_ugrai ===' AS step;
SELECT 
    bill_number,
    net_amount,
    received_amount,
    status,
    date_approved,
    assigned_to
FROM approved_ugrai
WHERE bill_number = 'LCBL000262502787';

-- Verify no longer in ugrai_data
SELECT '=== STEP 8: Confirm removal from ugrai_data ===' AS step;
SELECT COUNT(*) AS remaining_in_ugrai_data
FROM ugrai_data
WHERE bill_number = 'LCBL000262502787';

-- ============================================================================
-- STEP 9: Final payment history verification
-- ============================================================================
SELECT '=== STEP 9: Final payment history ===' AS step;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    receipt_number
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502787'
ORDER BY payment_number;

-- ============================================================================
-- Summary of changes
-- ============================================================================
SELECT '=== FINAL SUMMARY ===' AS summary;
SELECT 
    'LCBL000262502787' AS bill_number,
    'Vishal Dairy & Confectionary' AS retailer,
    'Sector 16' AS sector,
    2717.00 AS net_amount,
    2717.00 AS total_received,
    0.00 AS outstanding,
    'Fully Paid - Moved to approved_ugrai' AS status;

COMMIT;

-- ============================================================================
-- Payment Breakdown:
-- Payment #1 (Nov 16, 2025): ₹1,717.00 UPI → Outstanding: ₹1,000.00 ✓
-- Payment #2 (Nov 23, 2025): ₹1,000.00 Cash → Outstanding: ₹0.00 ✓ (CORRECTED)
-- Total: ₹2,717.00 (FULLY PAID)
-- ============================================================================
