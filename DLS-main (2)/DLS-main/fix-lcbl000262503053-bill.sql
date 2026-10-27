-- Fix LCBL000262503053 bill: Consolidate payment history and move to approved_ugrai
-- Payment History Analysis:
--   Payment 1: 872.00 (partial) - Outstanding: 1000.00
--   Payment 2: 500.00 (marked as full but actually partial) - Outstanding should be: 500.00
-- Total Received: 872.00 + 500.00 = 1372.00
-- Net Amount: 1872.00
-- ACTUAL Outstanding: 500.00 (NOT FULLY PAID)
-- 
-- DECISION: This bill should NOT go to approved_ugrai yet - it's still incomplete
-- We need to consolidate the duplicate entries and keep it in ugrai_data with correct outstanding

BEGIN;

-- Step 1: Verify current state
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
WHERE bill_number = 'LCBL000262503053'
ORDER BY created_at;

-- Step 2: Verify payment history
SELECT 
    '2. Payment History:' as step,
    bill_number,
    payment_number,
    payment_date,
    payment_amount,
    outstanding_amount,
    payment_type,
    payment_method,
    approved_by,
    date_approved
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262503053'
ORDER BY payment_number;

-- Step 3: Calculate accurate totals
WITH payment_summary AS (
    SELECT 
        bill_number,
        SUM(payment_amount) as total_paid,
        MAX(original_net_amount) as net_amount,
        COUNT(*) as payment_count
    FROM ugrai_payment_history
    WHERE bill_number = 'LCBL000262503053'
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
        WHEN total_paid >= net_amount THEN 'FULLY PAID ✓'
        ELSE 'INCOMPLETE - STILL PENDING'
    END as payment_status
FROM payment_summary;

-- Step 4: Fix the incorrect payment_type in payment history
-- Payment 2 should be 'partial', not 'full'
UPDATE ugrai_payment_history
SET 
    payment_type = 'partial',
    outstanding_amount = 500.00,  -- Correct outstanding after this payment
    notes = 'Batch approval - Corrected from "full" to "partial"',
    updated_at = NOW()
WHERE bill_number = 'LCBL000262503053'
  AND payment_number = 2
  AND payment_type = 'full';

-- Step 5: Delete the duplicate entry from ugrai_data (keep the older one)
-- Keep: user_id 9cc4ab56-4287-4c19-ab9d-915859912b55 (created 2025-11-17)
-- Delete: user_id 91fedb12-77d7-41a2-880a-467b401949da (created 2025-11-25)
DELETE FROM ugrai_data
WHERE bill_number = 'LCBL000262503053'
  AND user_id = '91fedb12-77d7-41a2-880a-467b401949da'::uuid
  AND created_at = '2025-11-25 12:54:59.178964+00';

-- Step 6: Update the remaining ugrai_data entry with correct total received amount
UPDATE ugrai_data
SET 
    received_amount = 1372.00,  -- Total: 872.00 + 500.00
    net_amount = 1872.00,       -- Ensure correct net amount
    updated_at = NOW()
WHERE bill_number = 'LCBL000262503053'
  AND user_id = '9cc4ab56-4287-4c19-ab9d-915859912b55'::uuid;

-- Step 7: Verify the fix
SELECT 
    '4. After Fix - ugrai_data (should have 1 entry):' as step,
    bill_number,
    bill_date,
    retailer_name,
    net_amount,
    received_amount,
    net_amount - received_amount as outstanding,
    CASE 
        WHEN received_amount >= net_amount THEN 'READY FOR APPROVAL'
        ELSE 'STILL PENDING'
    END as status,
    user_id
FROM ugrai_data
WHERE bill_number = 'LCBL000262503053';

-- Step 8: Verify corrected payment history
SELECT 
    '5. After Fix - Payment History:' as step,
    payment_number,
    payment_amount,
    outstanding_amount,
    payment_type,
    notes
FROM ugrai_payment_history
WHERE bill_number = 'LCBL000262503053'
ORDER BY payment_number;

COMMIT;

-- =============================================================================
-- SUMMARY:
-- =============================================================================
-- ❌ Bill is NOT fully paid yet - Outstanding: ₹500.00
-- ✓ Corrected payment_type from "full" to "partial" for payment #2
-- ✓ Consolidated duplicate entries in ugrai_data
-- ✓ Updated received_amount to 1372.00 (872.00 + 500.00)
-- ⚠️ Bill remains in ugrai_data until final ₹500.00 is paid
-- 
-- NEXT STEPS:
-- When the final ₹500.00 payment is received:
-- 1. Complete the payment in UGRAI Management
-- 2. Then approve the bill - it will automatically move to approved_ugrai
-- =============================================================================
