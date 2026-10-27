-- SQL Function to get supply analysis summary with aggregation
-- This matches your working SQL query exactly
-- Business Rule: 
--   - Credit (approved) uses net_amount
--   - Cancelled and Returned use net_amount (since received_amount is 0)
--   - Edited uses net_amount (since received_amount is 0)
--   - Other approved bills use received_amount
-- Run this in your Supabase SQL Editor

-- Drop the old function first if it exists
DROP FUNCTION IF EXISTS get_supply_analysis_summary(VARCHAR);

-- Version WITHOUT user_id filter (since your SQL query doesn't use it)
CREATE OR REPLACE FUNCTION get_supply_analysis_summary()
RETURNS TABLE (
    status VARCHAR,
    payment_method VARCHAR,
    total_bills BIGINT,
    total_amount NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ab.status::VARCHAR,
        ab.payment_method::VARCHAR,
        COUNT(*)::BIGINT,
        -- Apply business rule:
        -- For cancelled/returned/edited: use net_amount
        -- For approved Credit: use net_amount
        -- For approved others: use received_amount
        SUM(
            CASE 
                WHEN ab.status IN ('cancelled', 'returned', 'edited') THEN ab.net_amount
                WHEN ab.payment_method = 'Credit' THEN ab.net_amount
                ELSE ab.received_amount
            END
        )::NUMERIC
    FROM public.approved_bills ab
    GROUP BY ab.status, ab.payment_method
    ORDER BY ab.status, ab.payment_method;
END;
$$;

-- Grant execute permission to allow the function to be called from the website
GRANT EXECUTE ON FUNCTION get_supply_analysis_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION get_supply_analysis_summary() TO anon;
