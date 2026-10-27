-- Fix LCBL000262502613 bill: Consolidate duplicates and move to approved_ugrai
-- Bill has been FULLY PAID through 4 payments totaling ₹284,878
-- Payment 4 has incorrect outstanding_amount (should be 0, not 215000)

BEGIN;

-- ============================================
-- STEP 1: VERIFY CURRENT STATE
-- ============================================
SELECT 
    '1. Current state in ugrai_data:' as step,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    user_id,
    created_at
FROM ugrai_data
WHERE bill_number = 'LCBL000262502613'
ORDER BY created_at;

-- ============================================
-- STEP 2: VERIFY PAYMENT HISTORY
-- ============================================
SELECT 
    '2. Payment History:' as step,
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    approved_by,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502613'
ORDER BY payment_number;

-- ============================================
-- STEP 3: CALCULATE TOTALS
-- ============================================
WITH payment_summary AS (
    SELECT 
        bill_number,
        SUM(payment_amount) as total_paid,
        MAX(original_net_amount) as net_amount,
        COUNT(*) as payment_count
    FROM ugrai_payment_history
    WHERE bill_number = 'LCBL000262502613'
    GROUP BY bill_number
)
SELECT 
    '3. Payment Summary:' as step,
    bill_number,
    net_amount,
    total_paid,
    net_amount - total_paid as actual_outstanding,
    payment_count,
    CASE 
        WHEN total_paid >= net_amount THEN 'FULLY PAID ✓ - Ready for approval'
        ELSE 'PARTIAL PAYMENT'
    END as payment_status
FROM payment_summary;

-- ============================================
-- STEP 4: FIX PAYMENT HISTORY - Correct payment #4
-- ============================================
UPDATE ugrai_payment_history
SET 
    outstanding_amount = 0.00,  -- Correct: this was the final payment
    payment_type = 'full',      -- Keep as full since it completed the bill
    notes = 'Batch approval - Final payment (corrected outstanding_amount)',
    updated_at = NOW()
WHERE bill_number = 'LCBL000262502613'
  AND payment_number = 4;

-- ============================================
-- STEP 5: INSERT INTO approved_ugrai
-- ============================================
INSERT INTO approved_ugrai (
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    payment_method,
    receipt_number,
    cheque_date,
    photo_url,
    photo_uploaded,
    date_completed,
    date_approved,
    approved_by,
    assigned_to,
    user_id
)
SELECT 
    'LCBL000262502613' as bill_number,
    DATE '2025-09-29' as bill_date,
    'WOMEN GALLERY-MNY(SELECTIVE)' as retailer_name,
    'Sector 15' as sector,
    284878.00 as net_amount,
    284878.00 as received_amount,  -- Total: 50000 + 65000 + 100000 + 69878
    'NEFT' as payment_method,      -- Last payment method used
    '' as receipt_number,
    NULL as cheque_date,
    '' as photo_url,
    false as photo_uploaded,
    DATE '2025-11-22' as date_completed,  -- Date of last payment
    CURRENT_DATE as date_approved,
    'System - Consolidated 4 Payments' as approved_by,
    NULL as assigned_to,
    '9cc4ab56-4287-4c19-ab9d-915859912b55'::uuid as user_id  -- Using first entry's user_id
WHERE NOT EXISTS (
    SELECT 1 FROM approved_ugrai WHERE bill_number = 'LCBL000262502613'
);

-- ============================================
-- STEP 6: DELETE DUPLICATE ENTRIES FROM ugrai_data
-- ============================================
DELETE FROM ugrai_data
WHERE bill_number = 'LCBL000262502613';

-- ============================================
-- STEP 7: VERIFY THE MOVE
-- ============================================
SELECT 
    '4. Final verification - Bill in approved_ugrai:' as step,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,
    date_completed,
    date_approved,
    approved_by,
    user_id
FROM approved_ugrai
WHERE bill_number = 'LCBL000262502613';

-- ============================================
-- STEP 8: CONFIRM CLEANUP
-- ============================================
SELECT 
    '5. Remaining in ugrai_data (should be 0):' as step,
    COUNT(*) as count
FROM ugrai_data
WHERE bill_number = 'LCBL000262502613';

-- ============================================
-- STEP 9: VERIFY CORRECTED PAYMENT HISTORY
-- ============================================
SELECT 
    '6. Corrected Payment History:' as step,
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262502613'
ORDER BY payment_number;

COMMIT;

-- =============================================================================
-- SUMMARY:
-- =============================================================================
-- ✓ Bill LCBL000262502613 is FULLY PAID (₹284,878 total in 4 payments)
-- ✓ Corrected payment #4 outstanding_amount from ₹215,000 to ₹0
-- ✓ Consolidated duplicate entries in ugrai_data
-- ✓ Moved to approved_ugrai as FULLY PAID
-- ✓ Used user_id from older entry (9cc4ab56-4287-4c19-ab9d-915859912b55)
-- ✓ Cleaned up all duplicate entries from ugrai_data
--
-- Payment Breakdown:
--   Payment 1 (Nov 4):  ₹50,000  (NEFT)
--   Payment 2 (Nov 8):  ₹65,000  (NEFT)
--   Payment 3 (Nov 13): ₹100,000 (NEFT)
--   Payment 4 (Nov 22): ₹69,878  (NEFT) - Final payment
--   ─────────────────────────────────────
--   TOTAL PAID:         ₹284,878 ✓
-- =============================================================================
