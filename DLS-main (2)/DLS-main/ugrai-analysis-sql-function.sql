-- SQL Function to get UGRAI/Payment Received analysis summary with aggregation
-- This matches your working SQL query exactly
-- Business Rule: Always use net_amount for all payment methods
-- Run this in your Supabase SQL Editor

-- Drop the old function first if it exists
DROP FUNCTION IF EXISTS get_ugrai_analysis_summary();

-- Version WITHOUT user_id or status filter (matches your working query)
CREATE OR REPLACE FUNCTION get_ugrai_analysis_summary()
RETURNS TABLE (
    payment_method VARCHAR,
    total_bills BIGINT,
    total_net_amount NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        au.payment_method::VARCHAR,
        COUNT(*)::BIGINT,
        SUM(au.net_amount)::NUMERIC
    FROM public.approved_ugrai au
    GROUP BY au.payment_method
    ORDER BY au.payment_method;
END;
$$;

-- Grant execute permission to allow the function to be called from the website
GRANT EXECUTE ON FUNCTION get_ugrai_analysis_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION get_ugrai_analysis_summary() TO anon;
