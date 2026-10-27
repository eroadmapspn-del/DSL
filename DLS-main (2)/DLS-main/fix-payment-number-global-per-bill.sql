-- Fix: Make payment numbers global per bill (not scoped by user_id)
-- This prevents duplicate payment numbers when multiple users process the same bill

-- Drop the existing function
DROP FUNCTION IF EXISTS get_next_payment_number(UUID, TEXT);

-- Recreate with global payment number per bill
CREATE OR REPLACE FUNCTION get_next_payment_number(
    p_user_id UUID,  -- Keep parameter for backward compatibility but don't use it
    p_bill_number TEXT
) RETURNS INTEGER AS $$
DECLARE
    max_payment_num INTEGER;
BEGIN
    -- Get max payment number for this bill across ALL users
    SELECT COALESCE(MAX(payment_number), 0) INTO max_payment_num
    FROM ugrai_payment_history
    WHERE bill_number = p_bill_number;  -- Removed user_id filter
    
    RETURN max_payment_num + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify the function was created
SELECT 'Payment number function updated - now global per bill!' as status;

-- Optional: Show any bills with duplicate payment numbers from different users
SELECT 
    bill_number,
    payment_number,
    COUNT(*) as duplicate_count,
    STRING_AGG(DISTINCT user_id::text, ', ') as different_users,
    STRING_AGG(payment_date::text || ' (₹' || payment_amount || ')', ', ' ORDER BY payment_date) as payments
FROM ugrai_payment_history
GROUP BY bill_number, payment_number
HAVING COUNT(*) > 1
ORDER BY bill_number, payment_number;
