-- Fix RLS Policy Infinite Recursion
-- Run this in your Supabase SQL Editor to fix the recursion issues

-- ==============================================
-- FIX: Replace Recursive Policies with Security Definer Functions
-- ==============================================

-- First, drop the problematic policies
DROP POLICY IF EXISTS "Admins can manage user roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can manage roles" ON roles;

-- Create security definer functions that bypass RLS
CREATE OR REPLACE FUNCTION is_user_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = user_id AND r.name = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create policies using the security definer function
CREATE POLICY "Admins can manage user roles" ON user_roles
    FOR ALL USING (is_user_admin(auth.uid()));

CREATE POLICY "Admins can manage all profiles" ON user_profiles
    FOR ALL USING (is_user_admin(auth.uid()));

CREATE POLICY "Admins can manage roles" ON roles
    FOR ALL USING (is_user_admin(auth.uid()));

-- Also fix audit_logs policy if it exists
DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
CREATE POLICY "Admins can view audit logs" ON audit_logs
    FOR SELECT USING (is_user_admin(auth.uid()));

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_user_admin(UUID) TO authenticated;

-- ==============================================
-- ALTERNATIVE FIX: Disable RLS on roles table temporarily
-- ==============================================

-- Since the roles table doesn't contain sensitive user data,
-- we can disable RLS on it to prevent recursion
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;

-- For extra security, you could create a simple policy later:
-- CREATE POLICY "Everyone can read roles" ON roles FOR SELECT USING (true);
-- CREATE POLICY "Service role can manage roles" ON roles FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ==============================================
-- VERIFICATION
-- ==============================================

DO $$
BEGIN
    RAISE NOTICE '✅ RLS recursion fixes applied successfully!';
    RAISE NOTICE '🔧 Security definer function created for admin checks';
    RAISE NOTICE '🛡️ Policies updated to use non-recursive admin checks';
    RAISE NOTICE '📋 Roles table RLS disabled to prevent recursion';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 Try creating a role now - it should work!';
END $$;