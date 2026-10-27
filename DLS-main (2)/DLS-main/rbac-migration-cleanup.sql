-- RBAC Schema Migration: Clean Old and Apply New
-- Run this in your Supabase SQL Editor to migrate to the new schema
-- This will safely remove the old RBAC structure and apply the new one

-- ==============================================
-- STEP 1: BACKUP EXISTING DATA (if needed)
-- ==============================================

-- Create temporary backup table for existing user roles (if you have important data)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles') THEN
        CREATE TEMP TABLE user_roles_backup AS 
        SELECT * FROM user_roles;
        
        RAISE NOTICE 'Created backup of existing user_roles data';
    END IF;
END $$;

-- ==============================================
-- STEP 2: DROP OLD SCHEMA SAFELY
-- ==============================================

-- Drop triggers first (only if tables exist)
DO $$
BEGIN
    -- Drop triggers only if tables exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles') THEN
        DROP TRIGGER IF EXISTS audit_user_roles ON user_roles;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'role_permissions') THEN
        DROP TRIGGER IF EXISTS audit_role_permissions ON role_permissions;
    END IF;
    
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    DROP TRIGGER IF EXISTS create_profile_trigger ON auth.users;
END $$;

-- Drop functions
DROP FUNCTION IF EXISTS log_changes() CASCADE;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS get_user_permissions(UUID) CASCADE;
DROP FUNCTION IF EXISTS user_has_permission(UUID, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS check_user_permission(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_user_permissions() CASCADE;
DROP FUNCTION IF EXISTS get_user_roles_with_details() CASCADE;
DROP FUNCTION IF EXISTS log_admin_action(TEXT, TEXT, TEXT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS create_user_profile() CASCADE;

-- Drop policies (only if tables exist)
DO $$
BEGIN
    -- Drop policies only if tables exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'roles') THEN
        DROP POLICY IF EXISTS "Everyone can view roles" ON roles;
        DROP POLICY IF EXISTS "Only admins can modify roles" ON roles;
        DROP POLICY IF EXISTS "Admins can manage roles" ON roles;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'permissions') THEN
        DROP POLICY IF EXISTS "Everyone can view permissions" ON permissions;
        DROP POLICY IF EXISTS "Only admins can modify permissions" ON permissions;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_profiles') THEN
        DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
        DROP POLICY IF EXISTS "Users can update their own profile" ON user_profiles;
        DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
        DROP POLICY IF EXISTS "Admins can modify all profiles" ON user_profiles;
        DROP POLICY IF EXISTS "Users can manage their own profile" ON user_profiles;
        DROP POLICY IF EXISTS "Admins can manage all profiles" ON user_profiles;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles') THEN
        DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
        DROP POLICY IF EXISTS "Admins can view all user roles" ON user_roles;
        DROP POLICY IF EXISTS "Only admins can modify user roles" ON user_roles;
        DROP POLICY IF EXISTS "Admins can manage user roles" ON user_roles;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'role_permissions') THEN
        DROP POLICY IF EXISTS "Everyone can view role permissions" ON role_permissions;
        DROP POLICY IF EXISTS "Only admins can modify role permissions" ON role_permissions;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        DROP POLICY IF EXISTS "Users can view their own audit logs" ON audit_logs;
        DROP POLICY IF EXISTS "Admins can view all audit logs" ON audit_logs;
    END IF;
END $$;

-- Drop tables in correct order (respecting foreign key constraints)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

DO $$
BEGIN
    RAISE NOTICE 'Old RBAC schema cleaned up successfully';
END $$;

-- ==============================================
-- STEP 3: APPLY NEW SCHEMA
-- ==============================================

-- 1. Roles table - Define system roles
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '[]'::jsonb,
    is_system_role BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. User Roles table - Assign roles to users
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- 3. User Profiles table - Extended user information
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    full_name VARCHAR(255),
    email VARCHAR(255),
    department VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Audit Logs table - Track admin actions
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(100),
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert system roles with granular subsection permissions
INSERT INTO roles (name, display_name, description, is_system_role, permissions) VALUES 

-- Admin: Full access to everything including admin dashboard
('admin', 'Administrator', 'Full system access including admin dashboard', true, 
 '[
   "admin.dashboard.view",
   "admin.users.create", "admin.users.read", "admin.users.update", "admin.users.delete",
   "admin.roles.create", "admin.roles.read", "admin.roles.update", "admin.roles.delete",
   "supply.base_file.view", "supply.upload.view", "supply.dispatch.view", "supply.in_progress.view", "supply.management.view",
   "ugrai.base_file.view", "ugrai.issue.view", "ugrai.in_progress.view", "ugrai.management.view",
   "purchase.base_file.view", "purchase.entry.view", "purchase.accounting.view", "purchase.management.view", "purchase.purchased.view"
 ]'::jsonb),

-- Supply In Progress Only: Only supply in progress subsection
('supply_in_progress', 'Supply In Progress', 'View only supply in progress subsection', true,
 '["supply.in_progress.view"]'::jsonb),

-- Ugrai In Progress Only: Only ugrai in progress subsection
('ugrai_in_progress', 'Ugrai In Progress', 'View only ugrai in progress subsection', true,
 '["ugrai.in_progress.view"]'::jsonb),

-- Accountant: Purchase and accounting related subsections
('accountant', 'Accountant', 'Access to accounting and purchase management', true,
 '[
   "purchase.accounting.view", "purchase.management.view", "purchase.purchased.view",
   "supply.management.view", "ugrai.management.view"
 ]'::jsonb),

-- Full Supply Manager: All supply subsections
('supply_manager', 'Supply Manager', 'Full access to all supply subsections', true,
 '["supply.base_file.view", "supply.upload.view", "supply.dispatch.view", "supply.in_progress.view", "supply.management.view"]'::jsonb),

-- Full Ugrai Manager: All ugrai subsections
('ugrai_manager', 'Ugrai Manager', 'Full access to all ugrai subsections', true,
 '["ugrai.base_file.view", "ugrai.issue.view", "ugrai.in_progress.view", "ugrai.management.view"]'::jsonb),

-- Viewer: Basic read access to specific subsections
('viewer', 'Viewer', 'Limited read-only access', true,
 '["supply.in_progress.view", "ugrai.in_progress.view", "purchase.purchased.view"]'::jsonb);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Roles: Only admins can manage roles
CREATE POLICY "Admins can manage roles" ON roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = auth.uid() 
            AND r.permissions ? 'admin.dashboard.view'
        )
    );

-- User Roles: Users can view their own roles, admins can manage all
CREATE POLICY "Users can view their own roles" ON user_roles
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage user roles" ON user_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = auth.uid() 
            AND r.permissions ? 'admin.users.update'
        )
    );

-- User Profiles: Users can view/edit their own profile, admins can manage all
CREATE POLICY "Users can manage their own profile" ON user_profiles
    FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all profiles" ON user_profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = auth.uid() 
            AND r.permissions ? 'admin.users.read'
        )
    );

-- Audit Logs: Only admins can view audit logs
CREATE POLICY "Admins can view audit logs" ON audit_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = auth.uid() 
            AND r.permissions ? 'admin.dashboard.view'
        )
    );

-- Function to check user permissions
CREATE OR REPLACE FUNCTION check_user_permission(required_permission TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    has_permission BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS(
        SELECT 1 
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid()
        AND r.permissions ? required_permission
    ) INTO has_permission;
    
    RETURN has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's permissions
CREATE OR REPLACE FUNCTION get_user_permissions()
RETURNS JSONB AS $$
DECLARE
    user_permissions JSONB := '[]'::jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(DISTINCT perm), '[]'::jsonb)
    INTO user_permissions
    FROM (
        SELECT jsonb_array_elements_text(r.permissions) as perm
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid()
    ) permissions;
    
    RETURN user_permissions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's roles with details
CREATE OR REPLACE FUNCTION get_user_roles_with_details()
RETURNS TABLE(role_name VARCHAR, display_name VARCHAR, permissions JSONB) AS $$
BEGIN
    RETURN QUERY
    SELECT r.name, r.display_name, r.permissions
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log admin actions
CREATE OR REPLACE FUNCTION log_admin_action(
    action_name TEXT,
    resource_type TEXT DEFAULT NULL,
    resource_id TEXT DEFAULT NULL,
    details JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
    VALUES (auth.uid(), action_name, resource_type, resource_id, details)
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create user profile on signup
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (user_id, email, full_name)
    VALUES (
        NEW.id, 
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    );
    
    -- Assign default viewer role to new users
    INSERT INTO user_roles (user_id, role_id)
    SELECT NEW.id, r.id
    FROM roles r
    WHERE r.name = 'viewer';
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS create_profile_trigger ON auth.users;
CREATE TRIGGER create_profile_trigger
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_user_profile();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Add comments
COMMENT ON TABLE roles IS 'System roles with granular permissions';
COMMENT ON TABLE user_roles IS 'User role assignments';
COMMENT ON TABLE user_profiles IS 'Extended user profile information';
COMMENT ON TABLE audit_logs IS 'Admin action audit trail';

-- ==============================================
-- MIGRATION COMPLETE
-- ==============================================

DO $$
BEGIN
    RAISE NOTICE '✅ RBAC Migration completed successfully!';
    RAISE NOTICE '📋 New schema applied with simplified structure';
    RAISE NOTICE '🔑 System roles created: admin, supply_in_progress, ugrai_in_progress, accountant, supply_manager, ugrai_manager, viewer';
    RAISE NOTICE '🛡️ Row Level Security policies enabled';
    RAISE NOTICE '⚡ Helper functions created for permission checking';
    RAISE NOTICE '📊 Audit logging system ready';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 Next steps:';
    RAISE NOTICE '1. Assign admin role to your user account';
    RAISE NOTICE '2. Test the admin dashboard';
    RAISE NOTICE '3. Create users and assign roles as needed';
END $$;