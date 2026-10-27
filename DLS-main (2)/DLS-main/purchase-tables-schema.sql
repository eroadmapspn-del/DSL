-- Purchase Tables Schema for Supabase
-- Run these CREATE TABLE statements in your Supabase SQL Editor

-- 1. Purchase Retailers Table
CREATE TABLE purchase_retailers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    retailer_name VARCHAR(255) NOT NULL,
    due_days INTEGER NOT NULL DEFAULT 0,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(retailer_name, user_id)
);

-- 2. Purchase Entries Table
CREATE TABLE purchase_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    unique_id VARCHAR(255) NOT NULL,
    bill_number VARCHAR(255) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    taxable_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_tax DECIMAL(10,2) NOT NULL DEFAULT 0,
    deduction DECIMAL(10,2) NOT NULL DEFAULT 0,
    net_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    deduction_type VARCHAR(100),
    credit_note_number VARCHAR(255),
    credit_note_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'Received',
    note TEXT,
    voucher_number VARCHAR(255),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    due_date DATE,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(unique_id, user_id),
    UNIQUE(bill_number, user_id)
);

-- Create indexes for better performance
CREATE INDEX idx_purchase_retailers_user_id ON purchase_retailers(user_id);
CREATE INDEX idx_purchase_retailers_retailer_name ON purchase_retailers(retailer_name);

CREATE INDEX idx_purchase_entries_user_id ON purchase_entries(user_id);
CREATE INDEX idx_purchase_entries_status ON purchase_entries(status);
CREATE INDEX idx_purchase_entries_retailer_name ON purchase_entries(retailer_name);
CREATE INDEX idx_purchase_entries_bill_date ON purchase_entries(bill_date);
CREATE INDEX idx_purchase_entries_created_at ON purchase_entries(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE purchase_retailers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_entries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (adjust user_id field based on your auth setup)
-- For purchase_retailers table
CREATE POLICY "Users can view their own purchase retailers" ON purchase_retailers
    FOR SELECT USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can insert their own purchase retailers" ON purchase_retailers
    FOR INSERT WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can update their own purchase retailers" ON purchase_retailers
    FOR UPDATE USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can delete their own purchase retailers" ON purchase_retailers
    FOR DELETE USING (user_id = current_setting('app.current_user_id', true));

-- For purchase_entries table
CREATE POLICY "Users can view their own purchase entries" ON purchase_entries
    FOR SELECT USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can insert their own purchase entries" ON purchase_entries
    FOR INSERT WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can update their own purchase entries" ON purchase_entries
    FOR UPDATE USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can delete their own purchase entries" ON purchase_entries
    FOR DELETE USING (user_id = current_setting('app.current_user_id', true));

-- Optional: Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_purchase_retailers_updated_at BEFORE UPDATE ON purchase_retailers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_entries_updated_at BEFORE UPDATE ON purchase_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();