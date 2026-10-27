-- Supply System Database Schema for Supabase
-- Run this in your Supabase SQL Editor

-- Enable Row Level Security (RLS) for all tables
-- We'll implement user isolation later when auth is added

-- 1. Retailers table
CREATE TABLE IF NOT EXISTS retailers (
    id SERIAL PRIMARY KEY,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) DEFAULT 'default-user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(retailer_name, user_id)
);

-- 2. Bills table (covers temporaryBills and bills from the system)
CREATE TABLE IF NOT EXISTS bills (
    id SERIAL PRIMARY KEY,
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    brand VARCHAR(50),
    sector VARCHAR(100),
    status VARCHAR(50) DEFAULT 'staged', -- staged, dispatched, completed, approved
    supply_through VARCHAR(100), -- Mohan, Supply, etc.
    user_id VARCHAR(100) DEFAULT 'default-user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(bill_number, user_id)
);

-- 3. Active Supplies table (bills in progress)
CREATE TABLE IF NOT EXISTS active_supplies (
    id SERIAL PRIMARY KEY,
    bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
    bill_number VARCHAR(100) NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    net_amount DECIMAL(10,2) NOT NULL,
    brand VARCHAR(50),
    supply_through VARCHAR(100),
    status VARCHAR(50) DEFAULT 'in_progress', -- in_progress, delivered, cancelled, edited
    payment_method VARCHAR(50), -- cash, credit, upi, cheque
    receipt_number VARCHAR(100),
    received_amount DECIMAL(10,2),
    cheque_date DATE,
    photo_url TEXT,
    completion_date TIMESTAMP WITH TIME ZONE,
    user_id VARCHAR(100) DEFAULT 'default-user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Approved Bills table (final approved records)
CREATE TABLE IF NOT EXISTS approved_bills (
    id SERIAL PRIMARY KEY,
    original_bill_id INTEGER,
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    net_amount DECIMAL(10,2) NOT NULL,
    received_amount DECIMAL(10,2),
    brand VARCHAR(50),
    supply_through VARCHAR(100),
    payment_method VARCHAR(50),
    receipt_number VARCHAR(100),
    cheque_date DATE,
    photo_url TEXT,
    status VARCHAR(50),
    approval_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Edited Bills table (audit trail)
CREATE TABLE IF NOT EXISTS edited_bills (
    id SERIAL PRIMARY KEY,
    original_bill_id INTEGER,
    bill_number VARCHAR(100) NOT NULL,
    original_amount DECIMAL(10,2) NOT NULL,
    edited_amount DECIMAL(10,2) NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    brand VARCHAR(50),
    edit_reason TEXT,
    edited_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default-user'
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_bills_user_id ON bills(user_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_bill_number ON bills(bill_number);
CREATE INDEX IF NOT EXISTS idx_retailers_user_id ON retailers(user_id);
CREATE INDEX IF NOT EXISTS idx_active_supplies_user_id ON active_supplies(user_id);
CREATE INDEX IF NOT EXISTS idx_active_supplies_status ON active_supplies(status);
CREATE INDEX IF NOT EXISTS idx_approved_bills_user_id ON approved_bills(user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_retailers_updated_at BEFORE UPDATE ON retailers FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_bills_updated_at BEFORE UPDATE ON bills FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_active_supplies_updated_at BEFORE UPDATE ON active_supplies FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Optional: Insert some sample data for testing
-- INSERT INTO retailers (retailer_name, sector) VALUES 
-- ('Sample Retailer 1', 'Retail'),
-- ('Sample Retailer 2', 'Wholesale');