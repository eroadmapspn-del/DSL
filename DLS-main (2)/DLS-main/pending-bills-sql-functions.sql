-- SQL Functions for Pending Bills Analysis
-- Run this in your Supabase SQL Editor

-- ============================================================================
-- 1. PENDING BILLS OVERVIEW
-- Combines ugrai_data and ugrai_entries where status = 'Pending'
-- ============================================================================

DROP FUNCTION IF EXISTS get_pending_bills_summary();

CREATE OR REPLACE FUNCTION get_pending_bills_summary()
RETURNS TABLE (
    source_table VARCHAR,
    total_bills BIGINT,
    total_amount NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    -- From ugrai_data (exclude bills in completed_ugrai or approved_ugrai)
    -- Match Total UGRAI logic: amount > 0.01
    SELECT 
        'ugrai_data'::VARCHAR AS source_table,
        COUNT(*)::BIGINT AS total_bills,
        SUM(net_amount)::NUMERIC AS total_amount
    FROM public.ugrai_data ud
    WHERE ud.net_amount > 0.01
    AND NOT EXISTS (
        SELECT 1 FROM public.completed_ugrai cu 
        WHERE cu.bill_number = ud.bill_number
    )
    AND NOT EXISTS (
        SELECT 1 FROM public.approved_ugrai au 
        WHERE au.bill_number = ud.bill_number
    )
    
    UNION ALL
    
    -- From ugrai_entries (exclude bills in completed_ugrai or approved_ugrai)
    -- Match Total UGRAI logic: amount > 0.01
    SELECT 
        'ugrai_entries'::VARCHAR AS source_table,
        COUNT(*)::BIGINT AS total_bills,
        SUM(net_amount)::NUMERIC AS total_amount
    FROM public.ugrai_entries ue
    WHERE ue.net_amount > 0.01
    AND NOT EXISTS (
        SELECT 1 FROM public.completed_ugrai cu 
        WHERE cu.bill_number = ue.bill_number
    )
    AND NOT EXISTS (
        SELECT 1 FROM public.approved_ugrai au 
        WHERE au.bill_number = ue.bill_number
    );
END;
$$;

-- ============================================================================
-- 2. PENDING BILLS BY SECTOR
-- Breakdown of pending bills by sector (combined from both tables)
-- ============================================================================

DROP FUNCTION IF EXISTS get_pending_bills_by_sector();

CREATE OR REPLACE FUNCTION get_pending_bills_by_sector()
RETURNS TABLE (
    sector VARCHAR,
    total_bills BIGINT,
    total_amount NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(combined.sector, 'Unknown')::VARCHAR,
        COUNT(*)::BIGINT,
        SUM(combined.net_amount)::NUMERIC
    FROM (
        -- ugrai_data pending bills (exclude completed/approved, match Total UGRAI)
        SELECT ud.sector, ud.net_amount
        FROM public.ugrai_data ud
        WHERE ud.net_amount > 0.01
        AND NOT EXISTS (
            SELECT 1 FROM public.completed_ugrai cu 
            WHERE cu.bill_number = ud.bill_number
        )
        AND NOT EXISTS (
            SELECT 1 FROM public.approved_ugrai au 
            WHERE au.bill_number = ud.bill_number
        )
        
        UNION ALL
        
        -- ugrai_entries pending bills (exclude completed/approved, match Total UGRAI)
        SELECT ue.sector, ue.net_amount
        FROM public.ugrai_entries ue
        WHERE ue.net_amount > 0.01
        AND NOT EXISTS (
            SELECT 1 FROM public.completed_ugrai cu 
            WHERE cu.bill_number = ue.bill_number
        )
        AND NOT EXISTS (
            SELECT 1 FROM public.approved_ugrai au 
            WHERE au.bill_number = ue.bill_number
        )
    ) AS combined
    GROUP BY combined.sector
    ORDER BY total_bills DESC;
END;
$$;

-- ============================================================================
-- 3. PENDING BILLS BY ASSIGNED PERSON
-- Breakdown of pending bills by assigned_to (from ugrai_assignments table)
-- ============================================================================

DROP FUNCTION IF EXISTS get_pending_bills_by_person();

CREATE OR REPLACE FUNCTION get_pending_bills_by_person()
RETURNS TABLE (
    assigned_to VARCHAR,
    total_bills BIGINT,
    total_amount NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(ua.assigned_to, 'Unassigned')::VARCHAR,
        COUNT(*)::BIGINT,
        SUM(combined.net_amount)::NUMERIC
    FROM (
        -- ugrai_data pending bills (exclude completed/approved, match Total UGRAI)
        SELECT ud.sector, ud.net_amount, ud.user_id
        FROM public.ugrai_data ud
        WHERE ud.net_amount > 0.01
        AND NOT EXISTS (
            SELECT 1 FROM public.completed_ugrai cu 
            WHERE cu.bill_number = ud.bill_number
        )
        AND NOT EXISTS (
            SELECT 1 FROM public.approved_ugrai au 
            WHERE au.bill_number = ud.bill_number
        )
        
        UNION ALL
        
        -- ugrai_entries pending bills (exclude completed/approved, match Total UGRAI)
        SELECT ue.sector, ue.net_amount, ue.user_id
        FROM public.ugrai_entries ue
        WHERE ue.net_amount > 0.01
        AND NOT EXISTS (
            SELECT 1 FROM public.completed_ugrai cu 
            WHERE cu.bill_number = ue.bill_number
        )
        AND NOT EXISTS (
            SELECT 1 FROM public.approved_ugrai au 
            WHERE au.bill_number = ue.bill_number
        )
    ) AS combined
    LEFT JOIN public.ugrai_assignments ua 
        ON combined.sector = ua.sector 
        AND combined.user_id = ua.user_id
    GROUP BY ua.assigned_to
    ORDER BY total_bills DESC;
END;
$$;

-- ============================================================================
-- 4. PAYMENT HISTORY ANALYSIS
-- Summary of all payment history with breakdowns
-- ============================================================================

DROP FUNCTION IF EXISTS get_payment_history_summary();

CREATE OR REPLACE FUNCTION get_payment_history_summary()
RETURNS TABLE (
    payment_method VARCHAR,
    payment_type VARCHAR,
    total_payments BIGINT,
    total_amount_collected NUMERIC,
    total_outstanding NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ph.payment_method::VARCHAR,
        ph.payment_type::VARCHAR,
        COUNT(*)::BIGINT AS total_payments,
        SUM(ph.payment_amount)::NUMERIC AS total_amount_collected,
        SUM(ph.outstanding_amount)::NUMERIC AS total_outstanding
    FROM public.ugrai_payment_history ph
    GROUP BY ph.payment_method, ph.payment_type
    ORDER BY ph.payment_method, ph.payment_type;
END;
$$;

-- ============================================================================
-- 5. PAYMENT HISTORY BY PAYMENT METHOD (simplified)
-- Just payment method breakdown, regardless of type
-- ============================================================================

DROP FUNCTION IF EXISTS get_payment_history_by_method();

CREATE OR REPLACE FUNCTION get_payment_history_by_method()
RETURNS TABLE (
    payment_method VARCHAR,
    total_payments BIGINT,
    total_amount_collected NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ph.payment_method::VARCHAR,
        COUNT(*)::BIGINT AS total_payments,
        SUM(ph.payment_amount)::NUMERIC AS total_amount_collected
    FROM public.ugrai_payment_history ph
    GROUP BY ph.payment_method
    ORDER BY ph.payment_method;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_pending_bills_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_bills_summary() TO anon;

GRANT EXECUTE ON FUNCTION get_pending_bills_by_sector() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_bills_by_sector() TO anon;

GRANT EXECUTE ON FUNCTION get_pending_bills_by_person() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_bills_by_person() TO anon;

GRANT EXECUTE ON FUNCTION get_payment_history_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION get_payment_history_summary() TO anon;

GRANT EXECUTE ON FUNCTION get_payment_history_by_method() TO authenticated;
GRANT EXECUTE ON FUNCTION get_payment_history_by_method() TO anon;
