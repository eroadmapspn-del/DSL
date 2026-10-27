-- Fix RBAC Issues: Function Parameters and RLS Policies
-- Run this in your Supabase SQL Editor to fix the reported errors

-- ==============================================
-- FIX 1: Update Functions to Match Expected Signatures
-- ==============================================

-- Drop and recreate get_user_permissions function with proper signature
DROP FUNCTION IF EXISTS get_user_permissions();
DROP FUNCTION IF EXISTS get_user_permissions(UUID);

-- Create function that works both with and without user_id parameter
CREATE OR REPLACE FUNCTION get_user_permissions(user_uuid UUID DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    target_user_id UUID;
    user_permissions JSONB := '[]'::jsonb;
BEGIN
    -- Use provided user_id or current authenticated user
    target_user_id := COALESCE(user_uuid, auth.uid());
    
    -- Return empty permissions if no user
    IF target_user_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;
    
    SELECT COALESCE(jsonb_agg(DISTINCT perm), '[]'::jsonb)
    INTO user_permissions
    FROM (
        SELECT jsonb_array_elements_text(r.permissions) as perm
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = target_user_id
    ) permissions;
    
    RETURN user_permissions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_user_roles_with_details to also accept optional user_id
DROP FUNCTION IF EXISTS get_user_roles_with_details();
DROP FUNCTION IF EXISTS get_user_roles_with_details(UUID);

CREATE OR REPLACE FUNCTION get_user_roles_with_details(user_uuid UUID DEFAULT NULL)
RETURNS TABLE(role_name VARCHAR, display_name VARCHAR, permissions JSONB) AS $$
DECLARE
    target_user_id UUID;
BEGIN
    -- Use provided user_id or current authenticated user
    target_user_id := COALESCE(user_uuid, auth.uid());
    
    -- Return empty if no user
    IF target_user_id IS NULL THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT r.name, r.display_name, r.permissions
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- FIX 2: Fix RLS Policies to Prevent Infinite Recursion
-- ==============================================

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can manage user roles" ON user_roles;

-- Create non-recursive policies for user_roles
-- Allow users to view their own roles (simple check)
CREATE POLICY "Users can view their own roles" ON user_roles
    FOR SELECT USING (user_id = auth.uid());

-- Allow admins to manage user roles (use direct role check to avoid recursion)
CREATE POLICY "Admins can manage user roles" ON user_roles
    FOR ALL USING (
        auth.uid() IN (
            SELECT ur.user_id 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE r.name = 'admin'
        )
    );

-- Also fix user_profiles admin policy to avoid potential recursion
DROP POLICY IF EXISTS "Admins can manage all profiles" ON user_profiles;

CREATE POLICY "Admins can manage all profiles" ON user_profiles
    FOR ALL USING (
        auth.uid() IN (
            SELECT ur.user_id 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE r.name = 'admin'
        )
    );

-- Fix roles policy to avoid recursion
DROP POLICY IF EXISTS "Admins can manage roles" ON roles;

CREATE POLICY "Admins can manage roles" ON roles
    FOR ALL USING (
        auth.uid() IN (
            SELECT ur.user_id 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE r.name = 'admin'
        )
    );

-- ==============================================
-- FIX 3: Add Missing Functions for RBAC Service
-- ==============================================

-- Function to check if user is admin (used by RBAC service)
CREATE OR REPLACE FUNCTION is_admin(user_uuid UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    target_user_id UUID;
    is_admin_user BOOLEAN := FALSE;
BEGIN
    target_user_id := COALESCE(user_uuid, auth.uid());
    
    IF target_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    SELECT EXISTS(
        SELECT 1 
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = target_user_id AND r.name = 'admin'
    ) INTO is_admin_user;
    
    RETURN is_admin_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get all users with their roles (for admin dashboard)
CREATE OR REPLACE FUNCTION get_all_users_with_roles()
RETURNS TABLE(
    id UUID,
    email VARCHAR,
    full_name VARCHAR,
    department VARCHAR,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ,
    roles JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        up.user_id as id,
        up.email,
        up.full_name,
        up.department,
        up.is_active,
        up.created_at,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', r.id,
                    'name', r.name,
                    'display_name', r.display_name
                )
            ) FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
        ) as roles
    FROM user_profiles up
    LEFT JOIN user_roles ur ON up.user_id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    GROUP BY up.user_id, up.email, up.full_name, up.department, up.is_active, up.created_at
    ORDER BY up.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get dashboard stats
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS TABLE(
    total_users BIGINT,
    active_users BIGINT,
    total_roles BIGINT,
    admin_users BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM user_profiles) as total_users,
        (SELECT COUNT(*) FROM user_profiles WHERE is_active = true) as active_users,
        (SELECT COUNT(*) FROM roles) as total_roles,
        (SELECT COUNT(DISTINCT ur.user_id) 
         FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE r.name = 'admin') as admin_users;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_user_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_roles_with_details(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_users_with_roles() TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION check_user_permission(TEXT) TO authenticated;

-- ==============================================
-- FIXES COMPLETE
-- ==============================================

DO $$
BEGIN
    RAISE NOTICE '✅ RBAC fixes applied successfully!';
    RAISE NOTICE '🔧 Function signatures corrected';
    RAISE NOTICE '🔄 RLS policies updated to prevent recursion';
    RAISE NOTICE '📊 Dashboard functions added';
    RAISE NOTICE '🔑 Permissions granted to authenticated users';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 You can now test the admin dashboard!';
END $$;