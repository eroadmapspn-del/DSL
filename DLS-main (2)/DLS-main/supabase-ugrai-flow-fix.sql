-- UGRAI Flow Enhancement - Proper State Management
-- This fixes the UGRAI flow to have clear state transitions and eliminate ghost bills

-- 4. UGRAI In Progress Table (Bills currently being worked on)
CREATE TABLE IF NOT EXISTS ugrai_in_progress (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    assigned_to TEXT NOT NULL,
    assigned_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source_table TEXT NOT NULL CHECK (source_table IN ('ugrai_data', 'ugrai_entries')),
    source_id UUID NOT NULL, -- Reference to original record
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, bill_number)
);

-- 5. UGRAI Completed Table (Bills completed and awaiting approval)
CREATE TABLE IF NOT EXISTS ugrai_completed (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    assigned_to TEXT NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'UPI', 'Cheque')),
    received_amount DECIMAL(10,2) NOT NULL,
    receipt_number TEXT,
    cheque_date DATE,
    payment_photo_url TEXT,
    completed_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source_table TEXT NOT NULL CHECK (source_table IN ('ugrai_data', 'ugrai_entries')),
    source_id UUID NOT NULL,
    in_progress_id UUID NOT NULL, -- Reference to ugrai_in_progress record
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, bill_number)
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ugrai_in_progress_user_assigned ON ugrai_in_progress(user_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_ugrai_in_progress_sector ON ugrai_in_progress(user_id, sector);
CREATE INDEX IF NOT EXISTS idx_ugrai_completed_user_assigned ON ugrai_completed(user_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_ugrai_completed_date ON ugrai_completed(user_id, completed_date);

-- Update existing tables to add status tracking
ALTER TABLE ugrai_data ADD COLUMN IF NOT EXISTS current_stage TEXT DEFAULT 'available' 
    CHECK (current_stage IN ('available', 'in_progress', 'completed', 'approved'));
    
ALTER TABLE ugrai_entries ADD COLUMN IF NOT EXISTS current_stage TEXT DEFAULT 'available' 
    CHECK (current_stage IN ('available', 'in_progress', 'completed', 'approved'));

-- Enable RLS on new tables
ALTER TABLE ugrai_in_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugrai_completed ENABLE ROW LEVEL SECURITY;

-- RLS Policies for new tables (drop and recreate to avoid conflicts)
DROP POLICY IF EXISTS "Users can manage their own UGRAI in progress" ON ugrai_in_progress;
CREATE POLICY "Users can manage their own UGRAI in progress"
ON ugrai_in_progress FOR ALL
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their own UGRAI completed" ON ugrai_completed;
CREATE POLICY "Users can manage their own UGRAI completed"
ON ugrai_completed FOR ALL
USING (user_id = auth.uid());

-- Create functions for state transitions

-- Function to move UGRAI bills to In Progress
CREATE OR REPLACE FUNCTION move_ugrai_to_in_progress(
    p_user_id UUID,
    p_source_table TEXT,
    p_source_ids UUID[],
    p_assigned_to TEXT
) RETURNS TABLE(moved_count INTEGER) AS $$
DECLARE
    moved_bills INTEGER := 0;
    source_bill RECORD;
BEGIN
    -- Validate source table
    IF p_source_table NOT IN ('ugrai_data', 'ugrai_entries') THEN
        RAISE EXCEPTION 'Invalid source table: %', p_source_table;
    END IF;
    
    -- Process each source ID
    FOR source_bill IN 
        EXECUTE format('
            SELECT id, bill_number, bill_date, retailer_name, sector, net_amount 
            FROM %I 
            WHERE user_id = $1 AND id = ANY($2) AND current_stage = ''available''
        ', p_source_table)
        USING p_user_id, p_source_ids
    LOOP
        -- Insert into in_progress table
        INSERT INTO ugrai_in_progress (
            user_id, bill_number, bill_date, retailer_name, sector, 
            net_amount, assigned_to, source_table, source_id
        ) VALUES (
            p_user_id, source_bill.bill_number, source_bill.bill_date, 
            source_bill.retailer_name, source_bill.sector, source_bill.net_amount,
            p_assigned_to, p_source_table, source_bill.id
        )
        ON CONFLICT (user_id, bill_number) DO NOTHING;
        
        -- No need to update source table - bills remain visible in UGRAI Issue
        -- They will be deleted when completed (Ugrai Done is clicked)
        
        moved_bills := moved_bills + 1;
    END LOOP;
    
    RETURN QUERY SELECT moved_bills;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to complete UGRAI bills
CREATE OR REPLACE FUNCTION complete_ugrai_bill(
    p_user_id UUID,
    p_bill_number TEXT,
    p_payment_method TEXT,
    p_received_amount DECIMAL,
    p_receipt_number TEXT DEFAULT NULL,
    p_cheque_date DATE DEFAULT NULL,
    p_payment_photo_url TEXT DEFAULT NULL
) RETURNS TABLE(completed_id UUID) AS $$
DECLARE
    in_progress_bill RECORD;
    new_completed_id UUID;
BEGIN
    -- Get the in-progress bill
    SELECT * INTO in_progress_bill 
    FROM ugrai_in_progress 
    WHERE user_id = p_user_id AND bill_number = p_bill_number;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bill % not found in progress', p_bill_number;
    END IF;
    
    -- Insert into completed table
    INSERT INTO ugrai_completed (
        user_id, bill_number, bill_date, retailer_name, sector, net_amount,
        assigned_to, payment_method, received_amount, receipt_number, 
        cheque_date, payment_photo_url, source_table, source_id, in_progress_id
    ) VALUES (
        p_user_id, in_progress_bill.bill_number, in_progress_bill.bill_date,
        in_progress_bill.retailer_name, in_progress_bill.sector, 
        in_progress_bill.net_amount, in_progress_bill.assigned_to,
        p_payment_method, p_received_amount, p_receipt_number,
        p_cheque_date, p_payment_photo_url, in_progress_bill.source_table,
        in_progress_bill.source_id, in_progress_bill.id
    ) RETURNING id INTO new_completed_id;
    
    -- Remove from in_progress
    DELETE FROM ugrai_in_progress WHERE user_id = p_user_id AND bill_number = p_bill_number;
    
    -- Delete from source table (bill is now completed, no longer needed in Issue)
    EXECUTE format('
        DELETE FROM %I WHERE user_id = $1 AND id = $2
    ', in_progress_bill.source_table)
    USING p_user_id, in_progress_bill.source_id;
    
    RETURN QUERY SELECT new_completed_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to approve completed UGRAI bills
CREATE OR REPLACE FUNCTION approve_ugrai_bills(
    p_user_id UUID,
    p_bill_numbers TEXT[]
) RETURNS TABLE(approved_count INTEGER) AS $$
DECLARE
    approved_bills INTEGER := 0;
    completed_bill RECORD;
BEGIN
    FOR completed_bill IN 
        SELECT * FROM ugrai_completed 
        WHERE user_id = p_user_id AND bill_number = ANY(p_bill_numbers)
    LOOP
        -- Delete from source table if still exists (should already be deleted from complete step)
        EXECUTE format('
            DELETE FROM %I WHERE user_id = $1 AND id = $2
        ', completed_bill.source_table)
        USING p_user_id, completed_bill.source_id;
        
        -- Keep completed record for audit trail but could move to archive table
        UPDATE ugrai_completed 
        SET updated_at = NOW() 
        WHERE user_id = p_user_id AND id = completed_bill.id;
        
        approved_bills := approved_bills + 1;
    END LOOP;
    
    RETURN QUERY SELECT approved_bills;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'UGRAI flow enhancement tables and functions created successfully!' as status;