-- ============================================================================
-- CASH RECEIPT FEATURE - DATABASE DEPLOYMENT SCRIPT
-- ============================================================================
-- Version: 3.0
-- Date: February 20, 2026
-- Status: Production Ready
-- Architecture: Shared Team Data (No user_id filtering)
--
-- DEPLOYMENT INSTRUCTIONS:
-- 1. Run this entire script in Supabase SQL Editor
-- 2. Verify all statements execute successfully (no errors)
-- 3. Run verification queries at the end
-- 4. Proceed to frontend deployment only after database is confirmed
--
-- ROLLBACK: See rollback section at bottom of file
-- ============================================================================

-- ============================================================================
-- SECTION 1: TRIGGER FUNCTION (Check if exists first)
-- ============================================================================

-- Check if trigger function already exists
-- If it exists, you can skip creating it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
    ) THEN
        -- Create function if it doesn't exist
        CREATE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $func$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
        
        RAISE NOTICE 'Created update_updated_at_column() function';
    ELSE
        RAISE NOTICE 'update_updated_at_column() function already exists - skipping';
    END IF;
END $$;

-- ============================================================================
-- SECTION 2: CREATE CASH_RECEIPTS TABLE
-- ============================================================================

-- Create the main cash receipts table
-- Non-invasive: Does not modify existing payment tables
CREATE TABLE IF NOT EXISTS cash_receipts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- User who CREATED this receipt record (for audit, NOT for filtering)
    
    -- Reference to original payment
    -- payment_source values: 'supply' (from approved_bills), 'ugrai' (UGRAI full), 'ugrai_partial' (UGRAI partial)
    payment_source TEXT NOT NULL CHECK (payment_source IN ('supply', 'ugrai', 'ugrai_partial')),
    payment_reference_id TEXT NOT NULL, -- ID from source table (ab.id or uph.id) - TEXT to handle both INTEGER and UUID types
    source_table TEXT NOT NULL CHECK (source_table IN ('approved_bills', 'ugrai_payment_history')), -- Actual source table for traceability
    
    -- Payment details (denormalized for quick access)
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT,
    payment_amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL, -- When payment was made/approved
    
    -- Tally receipt tracking
    tally_receipt_number TEXT, -- e.g., CASH-001, CASH-002
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed')),
    
    -- Tracking
    processed_by UUID REFERENCES auth.users(id), -- Admin/Accountant who last modified/processed it
    processed_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate entries (use source_table to match JOIN logic)
    UNIQUE(source_table, payment_reference_id),
    
    -- CRITICAL: Enforce source consistency to prevent data corruption
    CONSTRAINT check_source_consistency CHECK (
        (payment_source = 'supply' AND source_table = 'approved_bills') OR
        (payment_source IN ('ugrai', 'ugrai_partial') AND source_table = 'ugrai_payment_history')
    )
);

-- Add comment to table
COMMENT ON TABLE cash_receipts IS 'Tracks Tally cash receipt numbers for cash payments - Shared team data (no user filtering)';

-- ============================================================================
-- SECTION 3: CREATE INDEXES
-- ============================================================================

-- Standard indexes for common queries
CREATE INDEX IF NOT EXISTS idx_cash_receipts_user_id 
    ON cash_receipts(user_id);

CREATE INDEX IF NOT EXISTS idx_cash_receipts_status 
    ON cash_receipts(status);

CREATE INDEX IF NOT EXISTS idx_cash_receipts_payment_date 
    ON cash_receipts(payment_date);

CREATE INDEX IF NOT EXISTS idx_cash_receipts_payment_source 
    ON cash_receipts(payment_source);

CREATE INDEX IF NOT EXISTS idx_cash_receipts_reference 
    ON cash_receipts(source_table, payment_reference_id);

-- CRITICAL: Case-insensitive unique constraint to prevent duplicate receipt numbers
-- Prevents 'CASH-001' and 'cash-001' from both being allowed
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_tally_receipt_number 
    ON cash_receipts(UPPER(tally_receipt_number)) 
    WHERE tally_receipt_number IS NOT NULL;

-- Composite index for faster date-based queries and sorting
-- Note: user_id included for potential audit queries
CREATE INDEX IF NOT EXISTS idx_cash_receipts_user_date 
    ON cash_receipts(user_id, payment_date DESC);

-- Performance indexes for source tables (optimized for cash payment queries)
-- Note: These may already exist - IF NOT EXISTS prevents errors
CREATE INDEX IF NOT EXISTS idx_approved_bills_cash_payments 
    ON approved_bills(payment_method, approval_date) 
    WHERE payment_method = 'Cash';

CREATE INDEX IF NOT EXISTS idx_ugrai_payment_cash 
    ON ugrai_payment_history(payment_method, payment_date) 
    WHERE payment_method = 'Cash';

-- ============================================================================
-- SECTION 4: ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on cash_receipts table
ALTER TABLE cash_receipts ENABLE ROW LEVEL SECURITY;

-- DROP existing policies if re-running (for clean deployment)
DROP POLICY IF EXISTS "Admins and accountants can view all cash receipts" ON cash_receipts;
DROP POLICY IF EXISTS "Admins and accountants can insert cash receipts" ON cash_receipts;
DROP POLICY IF EXISTS "Admins and accountants can update cash receipts" ON cash_receipts;

-- SHARED DATA: All admin/accountant users can view all cash receipts
-- No user_id filtering - this is collaborative data for the team
CREATE POLICY "Admins and accountants can view all cash receipts" ON cash_receipts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('admin', 'accountant')
        )
    );

-- Only admins and accountants can insert cash receipts
CREATE POLICY "Admins and accountants can insert cash receipts" ON cash_receipts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('admin', 'accountant')
        )
    );

-- Only admins and accountants can update cash receipts
CREATE POLICY "Admins and accountants can update cash receipts" ON cash_receipts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('admin', 'accountant')
        )
    );

-- ============================================================================
-- SECTION 5: TRIGGER
-- ============================================================================

-- Drop existing trigger if re-running
DROP TRIGGER IF EXISTS update_cash_receipts_updated_at ON cash_receipts;

-- Create trigger to automatically update updated_at timestamp
CREATE TRIGGER update_cash_receipts_updated_at
    BEFORE UPDATE ON cash_receipts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SECTION 6: DATABASE FUNCTION
-- ============================================================================

-- Drop existing function if re-running
DROP FUNCTION IF EXISTS get_all_cash_payments(DATE, DATE);

-- Function to get all cash payments (pending and processed)
-- SHARED DATA: No user_id filtering - returns all cash payments for team
-- user_id in cash_receipts is for audit only (who processed it)
CREATE OR REPLACE FUNCTION get_all_cash_payments(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
) RETURNS TABLE(
    id TEXT,
    source TEXT,
    bill_number TEXT,
    bill_date DATE,
    retailer_name TEXT,
    sector TEXT,
    payment_amount DECIMAL,
    payment_date DATE,
    tally_receipt_number TEXT,
    status TEXT,
    processed_by UUID,
    processed_date TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    
    -- Supply cash payments (from approved_bills)
    -- This includes full payments and partial payments from Supply workflow
    SELECT 
        ab.id::TEXT, -- Cast integer to TEXT for unified return type
        'supply'::TEXT as source, -- User-friendly source label
        ab.bill_number::TEXT, -- Cast varchar to TEXT
        ab.bill_date,
        ab.retailer_name::TEXT, -- Cast varchar to TEXT
        ab.sector::TEXT, -- Cast varchar to TEXT
        ab.received_amount as payment_amount,
        ab.approval_date::DATE as payment_date, -- Cast timestamp to DATE
        cr.tally_receipt_number,
        COALESCE(cr.status, 'pending') as status,
        cr.processed_by,
        cr.processed_date
    FROM approved_bills ab
    LEFT JOIN cash_receipts cr ON cr.source_table = 'approved_bills' 
        AND cr.payment_reference_id = ab.id::TEXT
    WHERE ab.payment_method = 'Cash'
        AND ab.received_amount > 0
        AND (p_start_date IS NULL OR ab.approval_date >= p_start_date)
        AND (p_end_date IS NULL OR ab.approval_date <= p_end_date)
    
    UNION ALL
    
    -- UGRAI cash payments (from ugrai_payment_history)
    -- This includes both partial and full payments tracked in UGRAI workflow
    -- Note: Same bill_number may appear multiple times for partial payments
    -- Detect partial by checking if outstanding_amount > 0 (robust approach)
    SELECT 
        uph.id::TEXT, -- Cast UUID to TEXT for unified return type
        -- Detect if partial payment using outstanding_amount (robust approach)
        CASE 
            WHEN COALESCE(uph.outstanding_amount, 0) > 0 THEN 'ugrai_partial'::TEXT
            ELSE 'ugrai'::TEXT
        END as source,
        uph.bill_number,
        uph.bill_date,
        uph.retailer_name,
        uph.sector,
        uph.payment_amount,
        uph.payment_date, -- Actual payment collection date
        cr.tally_receipt_number,
        COALESCE(cr.status, 'pending') as status,
        cr.processed_by,
        cr.processed_date
    FROM ugrai_payment_history uph
    LEFT JOIN cash_receipts cr ON cr.source_table = 'ugrai_payment_history' 
        AND cr.payment_reference_id = uph.id::TEXT
    WHERE uph.payment_method = 'Cash'
        AND (p_start_date IS NULL OR uph.payment_date >= p_start_date)
        AND (p_end_date IS NULL OR uph.payment_date <= p_end_date)
    
    UNION ALL
    
    -- Orphaned cash receipts (payment was deleted but receipt remains)
    -- This handles data integrity - shows orphaned records for cleanup
    SELECT 
        cr.id::TEXT, -- Cast UUID to TEXT for unified return type
        cr.payment_source as source,
        cr.bill_number,
        cr.bill_date,
        cr.retailer_name,
        cr.sector,
        cr.payment_amount,
        cr.created_at::DATE as payment_date,
        cr.tally_receipt_number,
        cr.status,
        cr.processed_by,
        cr.processed_date
    FROM cash_receipts cr
    WHERE cr.source_table = 'approved_bills'
        AND NOT EXISTS (
            SELECT 1 FROM approved_bills ab 
            WHERE ab.id::TEXT = cr.payment_reference_id
        )
        
    UNION ALL
    
    SELECT 
        cr.id::TEXT, -- Cast UUID to TEXT for unified return type
        cr.payment_source as source,
        cr.bill_number,
        cr.bill_date,
        cr.retailer_name,
        cr.sector,
        cr.payment_amount,
        cr.created_at::DATE as payment_date,
        cr.tally_receipt_number,
        cr.status,
        cr.processed_by,
        cr.processed_date
    FROM cash_receipts cr
    WHERE cr.source_table = 'ugrai_payment_history'
        AND NOT EXISTS (
            SELECT 1 FROM ugrai_payment_history uph 
            WHERE uph.id::TEXT = cr.payment_reference_id
        )
    
    ORDER BY payment_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment to function
COMMENT ON FUNCTION get_all_cash_payments(DATE, DATE) IS 'Returns all cash payments from approved_bills and ugrai_payment_history with receipt status - Shared team data';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_all_cash_payments(DATE, DATE) TO authenticated;

-- ============================================================================
-- SECTION 7: DEPLOYMENT VERIFICATION
-- ============================================================================

-- Run these queries to verify successful deployment
-- Copy and run each query separately to check results

-- 1. Verify table created
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_name = 'cash_receipts';
-- Expected: 1 row showing 'cash_receipts' as 'BASE TABLE'

-- 2. Verify indexes created
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'cash_receipts'
ORDER BY indexname;
-- Expected: 7 indexes (including PK and unique constraints)

-- 3. Verify RLS policies
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'cash_receipts';
-- Expected: 3 policies (SELECT, INSERT, UPDATE)

-- 4. Verify trigger exists
SELECT tgname 
FROM pg_trigger 
WHERE tgrelid = 'cash_receipts'::regclass;
-- Expected: 1 trigger (update_cash_receipts_updated_at)

-- 5. Verify function exists
SELECT proname, pronargs 
FROM pg_proc 
WHERE proname = 'get_all_cash_payments';
-- Expected: 1 row showing function with 2 arguments

-- 6. Test function execution (should return empty or existing cash payments)
SELECT * FROM get_all_cash_payments('2025-01-01', '2025-12-31') LIMIT 5;
-- Expected: No errors, returns rows if cash payments exist

-- 7. Check table constraints
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'cash_receipts'::regclass
ORDER BY conname;
-- Expected: Multiple constraints (PRIMARY KEY, CHECK, UNIQUE, FOREIGN KEY)

-- ============================================================================
-- SECTION 8: POST-DEPLOYMENT NOTES
-- ============================================================================

-- ✅ Database deployment complete!
-- 
-- NEXT STEPS:
-- 1. Verify all verification queries above return expected results
-- 2. Proceed to frontend deployment (supabase-service.js, supply.html, scripts.js)
-- 3. Deploy frontend code with feature flag = FALSE
-- 4. After deployment, set feature flag = TRUE to enable for testing
--
-- MONITORING:
-- - Check for any error logs in Supabase dashboard
-- - Monitor query performance in first few days
-- - Watch for any RLS policy violations
--
-- ============================================================================

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (IF NEEDED)
-- ============================================================================

-- ⚠️ ONLY RUN IF YOU NEED TO COMPLETELY REMOVE THIS FEATURE
-- 
-- Step 1: Drop function
-- DROP FUNCTION IF EXISTS get_all_cash_payments(DATE, DATE);
--
-- Step 2: Drop table (CASCADE removes triggers, constraints, policies)
-- DROP TABLE IF EXISTS cash_receipts CASCADE;
--
-- Step 3: Drop trigger function (ONLY if not used elsewhere)
-- DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
--
-- Step 4: Verify removal
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'cash_receipts';
-- -- Should return 0 rows
--
-- ============================================================================

-- Deployment completed at: February 20, 2026
-- Deployed by: [Your Name]
-- Status: ✅ READY FOR VERIFICATION
