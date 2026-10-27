-- SQL Function to revert a delivered supply bill back to in_progress status
-- This allows correcting mistakes when a bill was marked as delivered incorrectly

CREATE OR REPLACE FUNCTION revert_delivered_supply_to_in_progress(
    p_bill_number TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    reverted_bill_id INTEGER
) AS $$
DECLARE
    v_bill_id INTEGER;
    v_current_status TEXT;
BEGIN
    -- Check if bill exists and get current status
    SELECT id, status INTO v_bill_id, v_current_status
    FROM active_supplies
    WHERE bill_number = p_bill_number;
    
    -- If bill not found
    IF v_bill_id IS NULL THEN
        RETURN QUERY SELECT 
            FALSE, 
            'Bill not found in active supplies: ' || p_bill_number,
            NULL::INTEGER;
        RETURN;
    END IF;
    
    -- Check if bill is in Delivered status
    IF v_current_status != 'Delivered' THEN
        RETURN QUERY SELECT 
            FALSE, 
            'Bill is not in Delivered status. Current status: ' || v_current_status,
            v_bill_id;
        RETURN;
    END IF;
    
    -- Revert the bill back to in_progress
    UPDATE active_supplies
    SET 
        status = 'in_progress',
        completion_date = NULL,
        payment_method = NULL,
        receipt_number = NULL,
        received_amount = NULL,
        cheque_date = NULL,
        updated_at = NOW()
    WHERE id = v_bill_id;
    
    -- Return success
    RETURN QUERY SELECT 
        TRUE, 
        'Bill ' || p_bill_number || ' reverted to in_progress successfully',
        v_bill_id;
    
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION revert_delivered_supply_to_in_progress(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION revert_delivered_supply_to_in_progress(TEXT) TO anon;

-- Test the function (comment out after testing)
-- SELECT * FROM revert_delivered_supply_to_in_progress('NIV6014842501352');
