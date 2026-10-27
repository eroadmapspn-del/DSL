-- SQL Function to get all approved bills for detailed table view
-- Fetches from approved_bills table only
-- Returns all fields needed for the detailed bills table
-- Note: Supabase RPC has default 1000 row limit, handled in JavaScript with .limit()
-- Run this in your Supabase SQL Editor

DROP FUNCTION IF EXISTS get_approved_bills_detailed();

CREATE OR REPLACE FUNCTION get_approved_bills_detailed()
RETURNS TABLE (
    id INTEGER,
    bill_number VARCHAR,
    bill_date DATE,
    retailer_name VARCHAR,
    sector VARCHAR,
    net_amount NUMERIC,
    received_amount NUMERIC,
    payment_method VARCHAR,
    status VARCHAR,
    supply_through VARCHAR,
    brand VARCHAR,
    receipt_number VARCHAR,
    cheque_date DATE,
    approval_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ab.id,
        ab.bill_number,
        ab.bill_date,
        ab.retailer_name,
        ab.sector,
        ab.net_amount,
        ab.received_amount,
        ab.payment_method,
        ab.status,
        ab.supply_through,
        ab.brand,
        ab.receipt_number,
        ab.cheque_date,
        ab.approval_date,
        ab.created_at
    FROM public.approved_bills ab
    ORDER BY ab.bill_date DESC, ab.created_at DESC;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_approved_bills_detailed() TO authenticated;
GRANT EXECUTE ON FUNCTION get_approved_bills_detailed() TO anon;
