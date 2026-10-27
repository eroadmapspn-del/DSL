-- ============================================================================
-- BeautyBasket by DLS - Complete PostgreSQL Database Schema
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Retailers
CREATE TABLE IF NOT EXISTS retailers (
    id SERIAL PRIMARY KEY,
    retailer_name VARCHAR(255) NOT NULL UNIQUE,
    sector VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) DEFAULT 'default-user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Bills (Staged / Inflow)
CREATE TABLE IF NOT EXISTS bills (
    id SERIAL PRIMARY KEY,
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    net_amount NUMERIC(15,2) NOT NULL,
    brand VARCHAR(100),
    sector VARCHAR(100),
    status VARCHAR(50) DEFAULT 'staged',
    supply_through VARCHAR(100),
    user_id VARCHAR(100) DEFAULT 'default-user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Active Supplies (In-Progress Deliveries)
CREATE TABLE IF NOT EXISTS active_supplies (
    id SERIAL PRIMARY KEY,
    bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    net_amount NUMERIC(15,2) NOT NULL,
    brand VARCHAR(100),
    supply_through VARCHAR(100),
    status VARCHAR(50) DEFAULT 'in_progress',
    payment_method VARCHAR(50),
    receipt_number VARCHAR(100),
    received_amount NUMERIC(15,2),
    cheque_date DATE,
    photo_url TEXT,
    completion_date TIMESTAMP WITH TIME ZONE,
    user_id VARCHAR(100) DEFAULT 'default-user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Approved Bills (Completed Deliveries)
CREATE TABLE IF NOT EXISTS approved_bills (
    id SERIAL PRIMARY KEY,
    original_bill_id INTEGER,
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    net_amount NUMERIC(15,2) NOT NULL,
    received_amount NUMERIC(15,2),
    brand VARCHAR(100),
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

-- 5. Edited Bills
CREATE TABLE IF NOT EXISTS edited_bills (
    id SERIAL PRIMARY KEY,
    original_bill_id INTEGER,
    bill_number VARCHAR(100) NOT NULL,
    original_amount NUMERIC(15,2) NOT NULL,
    edited_amount NUMERIC(15,2) NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    brand VARCHAR(100),
    edit_reason TEXT,
    edited_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    bill_date DATE
);

-- 6. Ugrai Data (Recovery Base Data)
CREATE TABLE IF NOT EXISTS ugrai_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100) NOT NULL,
    net_amount NUMERIC(15,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    assigned_to VARCHAR(100),
    current_stage VARCHAR(50) DEFAULT 'available',
    received_amount NUMERIC(15,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Ugrai Entries
CREATE TABLE IF NOT EXISTS ugrai_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100) NOT NULL,
    net_amount NUMERIC(15,2) NOT NULL,
    status VARCHAR(50),
    assigned_to VARCHAR(100),
    original_supply_id VARCHAR(100),
    current_stage VARCHAR(50),
    received_amount NUMERIC(15,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Ugrai Assignments
CREATE TABLE IF NOT EXISTS ugrai_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    sector VARCHAR(100) NOT NULL,
    assigned_to VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Completed Ugrai
CREATE TABLE IF NOT EXISTS completed_ugrai (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100) NOT NULL,
    net_amount NUMERIC(15,2) NOT NULL,
    status VARCHAR(50),
    assigned_to VARCHAR(100),
    payment_method VARCHAR(50) NOT NULL,
    receipt_number VARCHAR(100),
    received_amount NUMERIC(15,2) NOT NULL,
    cheque_date DATE,
    photo_uploaded BOOLEAN,
    photo_url TEXT,
    date_completed DATE NOT NULL,
    completed_by VARCHAR(100),
    original_supply_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Approved Ugrai
CREATE TABLE IF NOT EXISTS approved_ugrai (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100) NOT NULL,
    net_amount NUMERIC(15,2) NOT NULL,
    status VARCHAR(50),
    assigned_to VARCHAR(100),
    payment_method VARCHAR(50) NOT NULL,
    receipt_number VARCHAR(100),
    received_amount NUMERIC(15,2) NOT NULL,
    cheque_date DATE,
    photo_uploaded BOOLEAN,
    photo_url TEXT,
    date_completed DATE,
    date_approved DATE,
    completed_by VARCHAR(100),
    approved_by VARCHAR(100),
    original_supply_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Ugrai Payment History
CREATE TABLE IF NOT EXISTS ugrai_payment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    original_net_amount NUMERIC(15,2) NOT NULL,
    payment_number INTEGER NOT NULL,
    payment_date DATE NOT NULL,
    payment_amount NUMERIC(15,2) NOT NULL,
    outstanding_amount NUMERIC(15,2) NOT NULL,
    payment_type VARCHAR(50) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    receipt_number VARCHAR(100),
    cheque_date DATE,
    photo_uploaded BOOLEAN,
    photo_url TEXT,
    completed_by VARCHAR(100),
    approved_by VARCHAR(100),
    date_approved DATE,
    source_bill_id UUID,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. Cash Receipts (Tally Integration)
CREATE TABLE IF NOT EXISTS cash_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'default-user',
    payment_source VARCHAR(50) NOT NULL, -- 'supply', 'ugrai', 'ugrai_partial'
    payment_reference_id VARCHAR(100) NOT NULL,
    source_table VARCHAR(100) NOT NULL,
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    payment_amount NUMERIC(15,2) NOT NULL,
    payment_date DATE NOT NULL,
    tally_receipt_number VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processed'
    processed_by VARCHAR(100),
    processed_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. Bill Photos
CREATE TABLE IF NOT EXISTS bill_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_number VARCHAR(100) NOT NULL,
    bill_type VARCHAR(100) NOT NULL,
    photo_type VARCHAR(100),
    photo_url TEXT NOT NULL,
    photo_name VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    file_size INTEGER,
    file_type VARCHAR(100),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    uploaded_by VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB
);

-- 14. RBAC: Roles
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    description TEXT,
    permissions JSONB DEFAULT '[]'::jsonb,
    is_system_role BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. RBAC: User Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    department VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 16. RBAC: User Roles (User <-> Role mapping)
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- 17. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(100),
    details JSONB,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
