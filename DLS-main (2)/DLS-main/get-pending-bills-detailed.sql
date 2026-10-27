-- SQL Function to get detailed pending bills (matching Total UGRAI logic)
-- This replicates the loadProcessedTotalUgrai() filtering

CREATE OR REPLACE FUNCTION get_pending_bills_detailed()
RETURNS TABLE (
    id UUID,
    bill_number TEXT,
    bill_date DATE,
    retailer_name TEXT,
    sector TEXT,
    net_amount DECIMAL,
    bill_received_amount DECIMAL,
    payment_history_received DECIMAL,
    total_received DECIMAL,
    due_amount DECIMAL,
    source_table TEXT,
    assigned_to TEXT,
    current_stage TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH 
    -- Get all bills from ugrai_data and ugrai_entries
    all_ugrai_bills AS (
        SELECT 
            ud.id AS bill_id,
            ud.bill_number AS bill_num,
            ud.bill_date AS bill_dt,
            ud.retailer_name AS retailer,
            ud.sector AS bill_sector,
            ud.net_amount AS bill_net_amt,
            COALESCE(ud.received_amount, 0) AS bill_received_amt,
            ud.assigned_to AS bill_assigned,
            ud.current_stage AS bill_stage,
            'ugrai_data' AS bill_source
        FROM ugrai_data ud
        
        UNION ALL
        
        SELECT 
            ue.id AS bill_id,
            ue.bill_number AS bill_num,
            ue.bill_date AS bill_dt,
            ue.retailer_name AS retailer,
            ue.sector AS bill_sector,
            ue.net_amount AS bill_net_amt,
            COALESCE(ue.received_amount, 0) AS bill_received_amt,
            ue.assigned_to AS bill_assigned,
            ue.current_stage AS bill_stage,
            'ugrai_entries' AS bill_source
        FROM ugrai_entries ue
    ),
    
    -- Get bills to exclude (already completed or approved)
    bills_to_exclude AS (
        SELECT DISTINCT UPPER(TRIM(cu.bill_number)) AS excluded_bill_num
        FROM completed_ugrai cu
        
        UNION
        
        SELECT DISTINCT UPPER(TRIM(au.bill_number)) AS excluded_bill_num
        FROM approved_ugrai au
    ),
    
    -- Sum payment history per bill
    payment_totals AS (
        SELECT 
            UPPER(TRIM(uph.bill_number)) AS payment_bill_num,
            SUM(uph.payment_amount) AS payment_total
        FROM ugrai_payment_history uph
        GROUP BY UPPER(TRIM(uph.bill_number))
    )
    
    -- Final selection with due amount calculation
    SELECT 
        ub.bill_id,
        ub.bill_num,
        ub.bill_dt,
        ub.retailer,
        ub.bill_sector,
        ub.bill_net_amt,
        ub.bill_received_amt,
        COALESCE(pt.payment_total, 0),
        -- Calculate total received - use GREATEST to avoid double-counting
        -- ✅ FIX: Take max of both sources, not CASE which can undercount
        GREATEST(
            COALESCE(ub.bill_received_amt, 0),
            COALESCE(pt.payment_total, 0)
        ),
        -- Calculate due amount
        ub.bill_net_amt - GREATEST(
            COALESCE(ub.bill_received_amt, 0),
            COALESCE(pt.payment_total, 0)
        ),
        ub.bill_source,
        ub.bill_assigned,
        ub.bill_stage
    FROM all_ugrai_bills ub
    LEFT JOIN payment_totals pt 
        ON UPPER(TRIM(ub.bill_num)) = pt.payment_bill_num
    -- Filter out bills that are in completed_ugrai or approved_ugrai
    WHERE UPPER(TRIM(ub.bill_num)) NOT IN (
        SELECT excluded_bill_num FROM bills_to_exclude
    )
    -- Only show bills with positive amounts (line 10233)
    AND ub.bill_net_amt > 0.01
    ORDER BY ub.bill_dt DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_pending_bills_detailed() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_bills_detailed() TO anon;

-- Test the function
SELECT * FROM get_pending_bills_detailed() LIMIT 10;

-- ============================================
-- DUPLICATE DETECTION QUERIES
-- ============================================

-- 1. Check for duplicate bill numbers in the function result
SELECT 
    bill_number,
    COUNT(*) as duplicate_count,
    STRING_AGG(DISTINCT source_table, ', ') as found_in_tables,
    STRING_AGG(DISTINCT id::TEXT, ', ') as bill_ids
FROM get_pending_bills_detailed()
GROUP BY bill_number
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- 2. Show full details of duplicate bills
WITH duplicates AS (
    SELECT bill_number
    FROM get_pending_bills_detailed()
    GROUP BY bill_number
    HAVING COUNT(*) > 1
)
SELECT 
    p.*
FROM get_pending_bills_detailed() p
INNER JOIN duplicates d ON p.bill_number = d.bill_number
ORDER BY p.bill_number, p.source_table;

-- 3. Count total bills vs unique bills
SELECT 
    COUNT(*) as total_bills,
    COUNT(DISTINCT bill_number) as unique_bills,
    COUNT(*) - COUNT(DISTINCT bill_number) as duplicate_count
FROM get_pending_bills_detailed();

-- 4. Check source of duplicates (both tables)
SELECT 
    bill_number,
    COUNT(*) as occurrences,
    SUM(CASE WHEN source_table = 'ugrai_data' THEN 1 ELSE 0 END) as in_ugrai_data,
    SUM(CASE WHEN source_table = 'ugrai_entries' THEN 1 ELSE 0 END) as in_ugrai_entries
FROM get_pending_bills_detailed()
GROUP BY bill_number
HAVING COUNT(*) > 1
ORDER BY occurrences DESC;
