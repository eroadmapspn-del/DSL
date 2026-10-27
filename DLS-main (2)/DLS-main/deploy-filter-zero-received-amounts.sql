-- ============================================================================
-- DEPLOY: Filter out zero-received-amount bills from approved_bills
-- in the Cash Receipt dashboard
--
-- Change: Added AND ab.received_amount > 0 to the approved_bills branch
-- Impact: Bills with received_amount = 0 will no longer appear in dashboard
-- ============================================================================

DROP FUNCTION IF EXISTS get_all_cash_payments(DATE, DATE);

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
    -- FILTERED: Only include bills with received_amount > 0
    SELECT 
        ab.id::TEXT,
        'supply'::TEXT as source,
        ab.bill_number::TEXT,
        ab.bill_date,
        ab.retailer_name::TEXT,
        ab.sector::TEXT,
        ab.received_amount as payment_amount,
        ab.approval_date::DATE as payment_date,
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
    SELECT 
        uph.id::TEXT,
        CASE 
            WHEN COALESCE(uph.outstanding_amount, 0) > 0 THEN 'ugrai_partial'::TEXT
            ELSE 'ugrai'::TEXT
        END as source,
        uph.bill_number,
        uph.bill_date,
        uph.retailer_name,
        uph.sector,
        uph.payment_amount,
        uph.payment_date,
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
    
    -- Orphaned cash receipts (approved_bills source deleted)
    SELECT 
        cr.id::TEXT,
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
    
    -- Orphaned cash receipts (ugrai_payment_history source deleted)
    SELECT 
        cr.id::TEXT,
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

COMMENT ON FUNCTION get_all_cash_payments(DATE, DATE) IS 'Returns all cash payments from approved_bills (received_amount > 0) and ugrai_payment_history with receipt status - Shared team data';

GRANT EXECUTE ON FUNCTION get_all_cash_payments(DATE, DATE) TO authenticated;

-- Verify the update
SELECT 'Function updated successfully. Verifying row count:' AS status;

-- Check how many rows will now be returned (sample with no date filter)
SELECT COUNT(*) AS total_cash_receipt_rows FROM get_all_cash_payments();
