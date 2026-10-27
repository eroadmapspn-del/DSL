-- UGRAI Payment History Table
-- Tracks all payments made for UGRAI bills, including partial payments
-- This ensures no payment data is lost when bills cycle through partial payments

CREATE TABLE ugrai_payment_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    
    -- Bill identification
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT NOT NULL,
    original_net_amount DECIMAL(10,2) NOT NULL, -- Original bill amount
    
    -- Payment details
    payment_number INTEGER NOT NULL, -- 1st, 2nd, 3rd payment for this bill
    payment_date DATE NOT NULL, -- When this payment was made
    payment_amount DECIMAL(10,2) NOT NULL, -- Amount received in this payment
    outstanding_amount DECIMAL(10,2) NOT NULL, -- Remaining balance after this payment
    payment_type TEXT NOT NULL CHECK (payment_type IN ('partial', 'full')),
    
    -- Payment method details
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'UPI', 'Cheque', 'NEFT')),
    receipt_number TEXT,
    cheque_date DATE,
    photo_uploaded BOOLEAN DEFAULT FALSE,
    photo_url TEXT,
    
    -- Tracking
    completed_by TEXT, -- Who completed this payment
    approved_by TEXT, -- Who approved this payment
    date_approved DATE NOT NULL, -- When this payment was approved
    
    -- Reference to source
    source_bill_id UUID, -- Reference to completed_ugrai entry (if exists)
    notes TEXT, -- Any additional notes
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_ugrai_payment_history_user_id ON ugrai_payment_history(user_id);
CREATE INDEX idx_ugrai_payment_history_bill_number ON ugrai_payment_history(bill_number);
CREATE INDEX idx_ugrai_payment_history_payment_date ON ugrai_payment_history(payment_date);
CREATE INDEX idx_ugrai_payment_history_date_approved ON ugrai_payment_history(date_approved);

-- RLS Policies
ALTER TABLE ugrai_payment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ugrai payment history" ON ugrai_payment_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ugrai payment history" ON ugrai_payment_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ugrai payment history" ON ugrai_payment_history
    FOR UPDATE USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_ugrai_payment_history_updated_at
    BEFORE UPDATE ON ugrai_payment_history
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to get payment history for a specific bill
CREATE OR REPLACE FUNCTION get_ugrai_payment_history(
    p_user_id UUID,
    p_bill_number TEXT
) RETURNS TABLE(
    payment_number INTEGER,
    payment_date DATE,
    payment_amount DECIMAL,
    outstanding_amount DECIMAL,
    payment_type TEXT,
    payment_method TEXT,
    receipt_number TEXT,
    completed_by TEXT,
    approved_by TEXT,
    date_approved DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        h.payment_number,
        h.payment_date,
        h.payment_amount,
        h.outstanding_amount,
        h.payment_type,
        h.payment_method,
        h.receipt_number,
        h.completed_by,
        h.approved_by,
        h.date_approved
    FROM ugrai_payment_history h
    WHERE h.user_id = p_user_id 
      AND h.bill_number = p_bill_number
    ORDER BY h.payment_number ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get next payment number for a bill
CREATE OR REPLACE FUNCTION get_next_payment_number(
    p_user_id UUID,
    p_bill_number TEXT
) RETURNS INTEGER AS $$
DECLARE
    max_payment_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(payment_number), 0) INTO max_payment_num
    FROM ugrai_payment_history
    WHERE user_id = p_user_id AND bill_number = p_bill_number;
    
    RETURN max_payment_num + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'UGRAI Payment History table created successfully!' as status;
