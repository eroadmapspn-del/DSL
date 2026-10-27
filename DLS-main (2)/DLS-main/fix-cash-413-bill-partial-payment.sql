-- ============================================================================
-- FIX BILL: Cash-413 - Deepak Bhaiya RPS
-- ============================================================================
-- ISSUE: Payment #2 has incorrect outstanding_amount and wrongly marked as "full"
-- 
-- Bill Details:
-- - Bill Number: Cash-413
-- - Retailer: Deepak Bhaiya RPS
-- - Sector: MM CASH
-- - Net Amount: ₹78,413
-- - Payment #1 (Nov 18): ₹30,000 Cash → outstanding ₹48,413 ✓
-- - Payment #2 (Nov 25): ₹30,000 Cash → outstanding ₹48,413 ❌ (should be ₹18,413)
-- - Total Received: ₹60,000 (PARTIAL - Still owe ₹18,413)
--
-- Actions:
-- 1. Correct payment #2 outstanding_amount from ₹48,413 to ₹18,413
-- 2. Change payment #2 type from "full" to "partial"
-- 3. Keep bill in ugrai_data (NOT fully paid)
-- 4. Update received_amount in ugrai_data to ₹60,000
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
    completed_by,
    approved_by
FROM ugrai_payment_history
WHERE bill_number = 'Cash-413'
ORDER BY payment_number;

-- ============================================================================
-- STEP 2: Verify ugrai_data entry
-- ============================================================================
SELECT '=== STEP 2: Current ugrai_data entry ===' AS step;
SELECT 
    id,
    user_id,
    net_amount,
    received_amount,
    status,
    created_at
FROM ugrai_data
WHERE bill_number = 'Cash-413';

-- ============================================================================
-- STEP 3: Calculate correct values
-- ============================================================================
SELECT '=== STEP 3: Payment calculation ===' AS step;
SELECT 
    bill_number,
    original_net_amount,
    SUM(payment_amount) as total_paid,
    original_net_amount - SUM(payment_amount) as correct_outstanding
FROM ugrai_payment_history
WHERE bill_number = 'Cash-413'
GROUP BY bill_number, original_net_amount;

-- ============================================================================
-- STEP 4: Fix payment #2 outstanding_amount and payment_type
-- ============================================================================
SELECT '=== STEP 4: Correcting payment #2 ===' AS step;

UPDATE ugrai_payment_history
SET 
    outstanding_amount = 18413.00,  -- Correct: 78413 - 60000 = 18413
    payment_type = 'partial',       -- Change from "full" to "partial"
    notes = 'Batch approval - CORRECTED: Partial payment 30000, outstanding 18413',
    updated_at = NOW()
WHERE bill_number = 'Cash-413'
  AND payment_number = 2
  AND id = '2b037924-0db8-4bb7-a420-6d1db12af1a1'
RETURNING 
    payment_number,
    payment_amount,
    outstanding_amount AS corrected_outstanding,
    payment_type;

-- ============================================================================
-- STEP 5: Update ugrai_data with correct received_amount
-- ============================================================================
SELECT '=== STEP 5: Updating ugrai_data received_amount ===' AS step;

UPDATE ugrai_data
SET 
    received_amount = 60000.00,  -- Total of both payments
    updated_at = NOW()
WHERE bill_number = 'Cash-413'
  AND id = '350c1805-6d23-4a77-b045-94869b155824'
RETURNING 
    bill_number,
    net_amount,
    received_amount,
    net_amount - received_amount AS outstanding;

-- ============================================================================
-- STEP 6: Verify payment history correction
-- ============================================================================
SELECT '=== STEP 6: Verify corrected payment history ===' AS step;
SELECT 
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'Cash-413'
ORDER BY payment_number;

-- ============================================================================
-- STEP 7: Verify ugrai_data update
-- ============================================================================
SELECT '=== STEP 7: Verify ugrai_data ===' AS step;
SELECT 
    bill_number,
    net_amount,
    received_amount,
    net_amount - received_amount AS outstanding,
    status
FROM ugrai_data
WHERE bill_number = 'Cash-413';

-- ============================================================================
-- STEP 8: Verify bill is NOT in approved_ugrai
-- ============================================================================
SELECT '=== STEP 8: Confirm NOT in approved_ugrai ===' AS step;
SELECT COUNT(*) AS count_in_approved
FROM approved_ugrai
WHERE bill_number = 'Cash-413';

-- ============================================================================
-- Summary of changes
-- ============================================================================
SELECT '=== FINAL SUMMARY ===' AS summary;
SELECT 
    'Cash-413' AS bill_number,
    'Deepak Bhaiya RPS' AS retailer,
    'MM CASH' AS sector,
    78413.00 AS net_amount,
    60000.00 AS total_received,
    18413.00 AS outstanding,
    'PARTIAL PAYMENT - Remains in ugrai_data' AS status;

COMMIT;

-- ============================================================================
-- Payment Breakdown:
-- Payment #1 (Nov 18, 2025): ₹30,000.00 Cash → Outstanding: ₹48,413.00 ✓
-- Payment #2 (Nov 25, 2025): ₹30,000.00 Cash → Outstanding: ₹18,413.00 ✓ (CORRECTED)
-- Total Paid: ₹60,000.00
-- Still Outstanding: ₹18,413.00 (PARTIAL PAYMENT)
-- ============================================================================

-- ============================================================================
-- WHY THIS HAPPENED:
-- ============================================================================
-- This is the BATCH APPROVAL BUG that we diagnosed earlier!
-- 
-- In scripts.js, the approveUgraiBillsBatch() function (lines 5118-5260) has:
--   Line 5181: paymentType: 'full'  // HARDCODED - doesn't check if partial!
-- 
-- The function does NOT check if receivedAmount < netAmount before approving.
-- It always marks bills as "full" payment and moves them to approved_ugrai.
--
-- In contrast, the single approval function approveUgraiBill() (lines 5269-5500)
-- correctly checks for partial payments:
--   const isPartialPayment = receivedAmount < netAmount;
--   if (isPartialPayment) {
--     // Keeps in ugrai_data with outstanding amount
--   }
--
-- SOLUTION: Add the same partial payment check to batch approval function:
--   const receivedAmount = parseFloat(bill.receivedAmount || bill.netAmount || 0);
--   const netAmount = parseFloat(bill.netAmount || 0);
--   const isPartialPayment = receivedAmount < netAmount;
--   
--   if (isPartialPayment) {
--     // Don't move to approved_ugrai, update ugrai_data instead
--   }
-- ============================================================================
