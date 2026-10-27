-- RBAC Schema for BeautyBasket by DLS
-- Production-ready Role-Based Access Control System
-- Run this in your Supabase SQL Editor

-- ==============================================
-- 1. ROLES TABLE
-- ==============================================
CREATE TABLE IF NOT EXISTS roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    is_system_role BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- 2. PERMISSIONS TABLE (Section-based)
-- ==============================================
CREATE TABLE IF NOT EXISTS permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    section_id VARCHAR(50) NOT NULL, -- Maps to HTML section IDs
    section_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- 3. USER PROFILES TABLE (Extended user info)
-- ==============================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    department VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- 4. USER ROLES TABLE (Many-to-Many)
-- ==============================================
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- ==============================================
-- 5. ROLE PERMISSIONS TABLE (Many-to-Many)
-- ==============================================
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES auth.users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(role_id, permission_id)
);

-- ==============================================
-- 6. AUDIT LOG TABLE
-- ==============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- INDEXES FOR PERFORMANCE
-- ==============================================
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_permissions_section_id ON permissions(section_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- ==============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================

-- Enable RLS on all tables
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Roles table policies
CREATE POLICY "Everyone can view roles" ON roles FOR SELECT USING (true);
CREATE POLICY "Only admins can modify roles" ON roles FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);

-- Permissions table policies
CREATE POLICY "Everyone can view permissions" ON permissions FOR SELECT USING (true);
CREATE POLICY "Only admins can modify permissions" ON permissions FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);

-- User profiles policies
CREATE POLICY "Users can view their own profile" ON user_profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can update their own profile" ON user_profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Admins can view all profiles" ON user_profiles FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);
CREATE POLICY "Admins can modify all profiles" ON user_profiles FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);

-- User roles policies
CREATE POLICY "Users can view their own roles" ON user_roles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can view all user roles" ON user_roles FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);
CREATE POLICY "Only admins can modify user roles" ON user_roles FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);

-- Role permissions policies
CREATE POLICY "Everyone can view role permissions" ON role_permissions FOR SELECT USING (true);
CREATE POLICY "Only admins can modify role permissions" ON role_permissions FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);

-- Audit logs policies
CREATE POLICY "Users can view their own audit logs" ON audit_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can view all audit logs" ON audit_logs FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
);

-- ==============================================
-- SYSTEM DATA - Default Roles and Permissions
-- ==============================================

-- Insert system roles
INSERT INTO roles (name, description, is_system_role) VALUES
('admin', 'Full system access with user management capabilities', true),
('supply_manager', 'Access to supply-related sections only', true),
('ugrai_manager', 'Access to UGRAI-related sections only', true),
('purchase_manager', 'Access to purchase-related sections only', true),
('viewer', 'Read-only access to permitted sections', true)
ON CONFLICT (name) DO NOTHING;

-- Insert section permissions (based on supply.html sections)
INSERT INTO permissions (name, description, section_id, section_name) VALUES
('base_file_management.view', 'Can view Base File Management section', 'base-file-management', 'Base File Management'),
('upload_bills.view', 'Can view Upload Supply Data section', 'upload-bills-content', 'Upload Supply Data'),
('bills_to_dispatch.view', 'Can view Bills to Dispatch section', 'bills-to-dispatch', 'Bills to Dispatch'),
('supplies_in_progress.view', 'Can view Supplies in Progress section', 'supplies-in-progress', 'Supplies in Progress'),
('supply_management.view', 'Can view Supply Management section', 'supply-management', 'Supply Management'),
('ugrai_base_file.view', 'Can view UGRAI Base File section', 'ugrai-base-file', 'UGRAI Base File'),
('admin_dashboard.view', 'Can access Admin Dashboard', 'admin-dashboard', 'Admin Dashboard')
ON CONFLICT (name) DO NOTHING;

-- Assign permissions to roles
WITH role_permission_mapping AS (
    SELECT 
        r.id as role_id,
        p.id as permission_id
    FROM roles r
    CROSS JOIN permissions p
    WHERE 
        -- Admin gets all permissions
        (r.name = 'admin') OR
        -- Supply manager gets supply-related permissions
        (r.name = 'supply_manager' AND p.name IN (
            'base_file_management.view',
            'upload_bills.view', 
            'bills_to_dispatch.view',
            'supplies_in_progress.view',
            'supply_management.view'
        )) OR
        -- UGRAI manager gets UGRAI permissions
        (r.name = 'ugrai_manager' AND p.name IN (
            'ugrai_base_file.view'
        )) OR
        -- Purchase manager gets purchase permissions (extend as needed)
        (r.name = 'purchase_manager' AND p.name IN (
            'base_file_management.view'
        )) OR
        -- Viewer gets read access to basic sections
        (r.name = 'viewer' AND p.name IN (
            'base_file_management.view',
            'supplies_in_progress.view'
        ))
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, permission_id FROM role_permission_mapping
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ==============================================
-- HELPER FUNCTIONS
-- ==============================================

-- Function to get user permissions
CREATE OR REPLACE FUNCTION get_user_permissions(user_uuid UUID)
RETURNS TABLE(permission_name VARCHAR, section_id VARCHAR, section_name VARCHAR) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT 
        p.name as permission_name,
        p.section_id,
        p.section_name
    FROM permissions p
    JOIN role_permissions rp ON p.id = rp.permission_id
    JOIN user_roles ur ON rp.role_id = ur.role_id
    WHERE ur.user_id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has specific permission
CREATE OR REPLACE FUNCTION user_has_permission(user_uuid UUID, permission_name VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN user_roles ur ON rp.role_id = ur.role_id
        WHERE ur.user_id = user_uuid AND p.name = permission_name
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- TRIGGERS FOR AUDIT LOGGING
-- ==============================================

-- Function to log changes
CREATE OR REPLACE FUNCTION log_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values)
        VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values)
        VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values)
        VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers for audit logging
CREATE TRIGGER audit_user_roles 
    AFTER INSERT OR UPDATE OR DELETE ON user_roles
    FOR EACH ROW EXECUTE FUNCTION log_changes();

CREATE TRIGGER audit_role_permissions 
    AFTER INSERT OR UPDATE OR DELETE ON role_permissions
    FOR EACH ROW EXECUTE FUNCTION log_changes();

-- ==============================================
-- SETUP COMPLETE
-- ==============================================

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Create a trigger to automatically create user profiles
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'RBAC Schema setup completed successfully!';
    RAISE NOTICE 'Tables created: roles, permissions, user_profiles, user_roles, role_permissions, audit_logs';
    RAISE NOTICE 'Default roles: admin, supply_manager, ugrai_manager, purchase_manager, viewer';
    RAISE NOTICE 'Section permissions configured for supply.html sections';
    RAISE NOTICE 'RLS policies enabled for security';
    RAISE NOTICE 'Helper functions: get_user_permissions(), user_has_permission()';
END $$;