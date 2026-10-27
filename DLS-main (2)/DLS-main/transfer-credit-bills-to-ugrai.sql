-- Transfer Credit Bills from approved_bills to ugrai_entries
-- This function moves credit bills to UGRAI for collection tracking
-- Original bills remain in approved_bills table with status='approved'

-- Drop function if exists
DROP FUNCTION IF EXISTS transfer_credit_bills_to_ugrai();

-- Create the transfer function
CREATE OR REPLACE FUNCTION transfer_credit_bills_to_ugrai()
RETURNS TABLE (
    total_credit_bills INTEGER,
    already_in_ugrai INTEGER,
    newly_transferred INTEGER,
    transfer_details JSONB
) 
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_credit INTEGER := 0;
    v_already_exists INTEGER := 0;
    v_inserted INTEGER := 0;
    v_details JSONB;
BEGIN
    -- Count total credit bills in approved_bills
    SELECT COUNT(*) INTO v_total_credit
    FROM approved_bills
    WHERE payment_method = 'Credit' 
    AND status = 'approved';
    
    -- Count how many already exist in ugrai_entries (by user_id + bill_number)
    SELECT COUNT(*) INTO v_already_exists
    FROM approved_bills ab
    INNER JOIN ugrai_entries ue ON ab.bill_number = ue.bill_number
        AND ue.user_id = CASE 
            WHEN ab.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
            THEN ab.user_id::UUID
            ELSE '91fedb12-77d7-41a2-880a-467b401949da'::UUID
        END
    WHERE ab.payment_method = 'Credit' 
    AND ab.status = 'approved';
    
    -- Insert credit bills that don't already exist in ugrai_entries
    WITH credit_bills_with_uuid AS (
        -- First CTE: Normalize user_id to UUID
        SELECT 
            CASE 
                WHEN ab.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
                THEN ab.user_id::UUID
                ELSE '91fedb12-77d7-41a2-880a-467b401949da'::UUID  -- Your actual user UUID
            END as user_uuid,
            ab.bill_number,
            ab.bill_date,
            ab.retailer_name,
            ab.sector,
            ab.net_amount
        FROM approved_bills ab
        WHERE ab.payment_method = 'Credit'
        AND ab.status = 'approved'
    ),
    inserted_rows AS (
        INSERT INTO ugrai_entries (
            user_id,
            bill_number,
            bill_date,
            retailer_name,
            sector,
            net_amount,
            status,
            assigned_to,
            original_supply_id,
            created_at,
            updated_at,
            current_stage
        )
        SELECT 
            cb.user_uuid,
            cb.bill_number,
            cb.bill_date,
            cb.retailer_name,
            COALESCE(cb.sector, 'Unknown') as sector,
            cb.net_amount,
            'Pending' as status,  -- Start as Pending in UGRAI
            NULL as assigned_to,  -- Will be assigned later based on sector
            cb.bill_number as original_supply_id,  -- Track original bill
            NOW() as created_at,
            NOW() as updated_at,
            'available' as current_stage  -- Set initial stage
        FROM credit_bills_with_uuid cb
        ON CONFLICT (user_id, bill_number) DO NOTHING  -- Skip duplicates gracefully
        RETURNING *
    )
    SELECT COUNT(*) INTO v_inserted FROM inserted_rows;
    
    -- Build details JSON
    SELECT jsonb_build_object(
        'timestamp', NOW(),
        'source_table', 'approved_bills',
        'destination_table', 'ugrai_entries',
        'filter', 'payment_method = Credit AND status = approved',
        'action', 'INSERT (original bills kept in approved_bills)',
        'status_in_ugrai', 'Pending'
    ) INTO v_details;
    
    -- Return summary
    RETURN QUERY
    SELECT 
        v_total_credit,
        v_already_exists,
        v_inserted,
        v_details;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION transfer_credit_bills_to_ugrai() TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_credit_bills_to_ugrai() TO anon;

-- Execute the function to perform the transfer
SELECT * FROM transfer_credit_bills_to_ugrai();

-- Verification queries (run these to check the results)
/*
-- Check total credit bills in approved_bills
SELECT COUNT(*), SUM(net_amount) as total_amount
FROM approved_bills
WHERE payment_method = 'Credit' AND status = 'approved';

-- Check bills now in ugrai_entries
SELECT COUNT(*), SUM(net_amount) as total_amount
FROM ugrai_entries
WHERE original_supply_id IS NOT NULL;

-- View sample of transferred bills
SELECT 
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    status,
    original_supply_id
FROM ugrai_entries
WHERE original_supply_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
*/
