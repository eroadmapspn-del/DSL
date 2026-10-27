-- UGRAI Supabase Database Tables Setup
-- Copy and paste this entire code into your Supabase SQL Editor
--
-- NOTE: Foreign key constraints to auth.users have been removed to support testing without authentication.
-- In production, you may want to add them back: REFERENCES auth.users(id) ON DELETE CASCADE

-- 1. UGRAI Data Table (Main uploaded UGRAI data from Excel files)
CREATE TABLE ugrai_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- Removed foreign key constraint for testing flexibility
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Approved')),
    assigned_to TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Create unique constraint per user to prevent duplicate bill numbers
    UNIQUE(user_id, bill_number)
);

-- 2. UGRAI Entries Table (UGRAI entries created from credit bills)
CREATE TABLE ugrai_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- Removed foreign key constraint for testing flexibility,
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Approved')),
    assigned_to TEXT,
    original_supply_id TEXT, -- Reference to the original supply bill
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Create unique constraint per user to prevent duplicate bill numbers
    UNIQUE(user_id, bill_number)
);

-- 3. UGRAI Assignments Table (Sector-to-person assignment mapping)
CREATE TABLE ugrai_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- Removed foreign key constraint for testing flexibility,
    sector TEXT NOT NULL,
    assigned_to TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One assignment per sector per user
    UNIQUE(user_id, sector)
);

-- 4. Completed UGRAI Table (Bills completed and awaiting approval)
CREATE TABLE completed_ugrai (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- Removed foreign key constraint for testing flexibility,
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'Completed' CHECK (status IN ('Completed', 'Approved')),
    assigned_to TEXT,
    
    -- Payment completion details
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'UPI', 'Cheque', 'NEFT')),
    receipt_number TEXT,
    received_amount DECIMAL(10,2) NOT NULL,
    cheque_date DATE,
    photo_uploaded BOOLEAN DEFAULT FALSE,
    photo_url TEXT, -- For future photo storage implementation
    
    -- Completion tracking
    date_completed DATE NOT NULL,
    completed_by TEXT,
    original_supply_id TEXT, -- Reference to original supply bill if applicable
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Create unique constraint per user to prevent duplicate completed bills
    UNIQUE(user_id, bill_number)
);

-- 5. Approved UGRAI Table (Final approved bills - audit trail)
CREATE TABLE approved_ugrai (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- Removed foreign key constraint for testing flexibility,
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'Approved',
    assigned_to TEXT,
    
    -- Payment completion details
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'UPI', 'Cheque', 'NEFT')),
    receipt_number TEXT,
    received_amount DECIMAL(10,2) NOT NULL,
    cheque_date DATE,
    photo_uploaded BOOLEAN DEFAULT FALSE,
    photo_url TEXT,
    
    -- Completion and approval tracking
    date_completed DATE NOT NULL,
    date_approved DATE NOT NULL,
    completed_by TEXT,
    approved_by TEXT,
    original_supply_id TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Create unique constraint per user to prevent duplicate approved bills
    UNIQUE(user_id, bill_number)
);

-- Create indexes for better performance
CREATE INDEX idx_ugrai_data_user_id ON ugrai_data(user_id);
CREATE INDEX idx_ugrai_data_status ON ugrai_data(status);
CREATE INDEX idx_ugrai_data_sector ON ugrai_data(sector);
CREATE INDEX idx_ugrai_data_assigned_to ON ugrai_data(assigned_to);
CREATE INDEX idx_ugrai_data_bill_date ON ugrai_data(bill_date);

CREATE INDEX idx_ugrai_entries_user_id ON ugrai_entries(user_id);
CREATE INDEX idx_ugrai_entries_status ON ugrai_entries(status);
CREATE INDEX idx_ugrai_entries_sector ON ugrai_entries(sector);
CREATE INDEX idx_ugrai_entries_assigned_to ON ugrai_entries(assigned_to);

CREATE INDEX idx_ugrai_assignments_user_id ON ugrai_assignments(user_id);
CREATE INDEX idx_ugrai_assignments_sector ON ugrai_assignments(sector);

CREATE INDEX idx_completed_ugrai_user_id ON completed_ugrai(user_id);
CREATE INDEX idx_completed_ugrai_status ON completed_ugrai(status);
CREATE INDEX idx_completed_ugrai_payment_method ON completed_ugrai(payment_method);
CREATE INDEX idx_completed_ugrai_date_completed ON completed_ugrai(date_completed);

CREATE INDEX idx_approved_ugrai_user_id ON approved_ugrai(user_id);
CREATE INDEX idx_approved_ugrai_date_approved ON approved_ugrai(date_approved);
CREATE INDEX idx_approved_ugrai_payment_method ON approved_ugrai(payment_method);

-- Enable Row Level Security (RLS) for all tables
ALTER TABLE ugrai_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugrai_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugrai_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE completed_ugrai ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_ugrai ENABLE ROW LEVEL SECURITY;

-- Create RLS policies to ensure users can only access their own data

-- Policy for ugrai_data
CREATE POLICY "Users can view their own ugrai_data" ON ugrai_data
    FOR SELECT USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can insert their own ugrai_data" ON ugrai_data
    FOR INSERT WITH CHECK (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can update their own ugrai_data" ON ugrai_data
    FOR UPDATE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can delete their own ugrai_data" ON ugrai_data
    FOR DELETE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

-- Policy for ugrai_entries
CREATE POLICY "Users can view their own ugrai_entries" ON ugrai_entries
    FOR SELECT USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can insert their own ugrai_entries" ON ugrai_entries
    FOR INSERT WITH CHECK (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can update their own ugrai_entries" ON ugrai_entries
    FOR UPDATE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can delete their own ugrai_entries" ON ugrai_entries
    FOR DELETE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

-- Policy for ugrai_assignments
CREATE POLICY "Users can view their own ugrai_assignments" ON ugrai_assignments
    FOR SELECT USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can insert their own ugrai_assignments" ON ugrai_assignments
    FOR INSERT WITH CHECK (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can update their own ugrai_assignments" ON ugrai_assignments
    FOR UPDATE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can delete their own ugrai_assignments" ON ugrai_assignments
    FOR DELETE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

-- Policy for completed_ugrai
CREATE POLICY "Users can view their own completed_ugrai" ON completed_ugrai
    FOR SELECT USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can insert their own completed_ugrai" ON completed_ugrai
    FOR INSERT WITH CHECK (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can update their own completed_ugrai" ON completed_ugrai
    FOR UPDATE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can delete their own completed_ugrai" ON completed_ugrai
    FOR DELETE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

-- Policy for approved_ugrai
CREATE POLICY "Users can view their own approved_ugrai" ON approved_ugrai
    FOR SELECT USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can insert their own approved_ugrai" ON approved_ugrai
    FOR INSERT WITH CHECK (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can update their own approved_ugrai" ON approved_ugrai
    FOR UPDATE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY "Users can delete their own approved_ugrai" ON approved_ugrai
    FOR DELETE USING (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000001'::uuid));

-- Create functions to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at on all tables
CREATE TRIGGER update_ugrai_data_updated_at
    BEFORE UPDATE ON ugrai_data
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ugrai_entries_updated_at
    BEFORE UPDATE ON ugrai_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ugrai_assignments_updated_at
    BEFORE UPDATE ON ugrai_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_completed_ugrai_updated_at
    BEFORE UPDATE ON completed_ugrai
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_approved_ugrai_updated_at
    BEFORE UPDATE ON approved_ugrai
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default persons for assignment (optional - you can modify or remove this)
-- This is just sample data - modify according to your needs
/*
INSERT INTO ugrai_assignments (user_id, sector, assigned_to)
SELECT 
    auth.uid(),
    'Default',
    'Unassigned'
WHERE auth.uid() IS NOT NULL;
*/

-- Views for easier data analysis (optional)
-- Note: Views inherit RLS policies from their underlying tables automatically
CREATE VIEW ugrai_dashboard_summary AS
SELECT 
    user_id,
    'ugrai_data' as source_table,
    COUNT(*) as total_bills,
    SUM(net_amount) as total_amount,
    status,
    assigned_to
FROM ugrai_data 
GROUP BY user_id, status, assigned_to
UNION ALL
SELECT 
    user_id,
    'ugrai_entries' as source_table,
    COUNT(*) as total_bills,
    SUM(net_amount) as total_amount,
    status,
    assigned_to
FROM ugrai_entries 
GROUP BY user_id, status, assigned_to
UNION ALL
SELECT 
    user_id,
    'completed_ugrai' as source_table,
    COUNT(*) as total_bills,
    SUM(received_amount) as total_amount,
    status,
    assigned_to
FROM completed_ugrai 
GROUP BY user_id, status, assigned_to;

-- Note: For testing without authentication, we use a fixed UUID: 00000000-0000-0000-0000-000000000001
-- The RLS policies will work with this test UUID as well

-- Success message
SELECT 'UGRAI tables created successfully! You can now use the UGRAI functionality with Supabase.' as status;