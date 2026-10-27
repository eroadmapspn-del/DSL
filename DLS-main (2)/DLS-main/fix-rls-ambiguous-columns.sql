-- Fix ambiguous column reference in RLS policies
-- The error occurs because RLS policies have ambiguous "user_id" references

-- 1. Drop existing RLS policies that might have ambiguous references
DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can manage user roles" ON user_roles;
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can manage user profiles" ON user_profiles;

-- 2. Create new RLS policies with explicit table aliases
-- User Roles policies
CREATE POLICY "Users can view their own roles" ON user_roles
    FOR SELECT USING (user_roles.user_id = auth.uid());

CREATE POLICY "Admins can manage user roles" ON user_roles
    FOR ALL USING (
        get_user_permissions() ? 'admin.users.create' OR
        get_user_permissions() ? 'admin.users.read' OR
        get_user_permissions() ? 'admin.users.update' OR
        get_user_permissions() ? 'admin.users.delete'
    );

-- User Profiles policies  
CREATE POLICY "Users can view their own profile" ON user_profiles
    FOR SELECT USING (user_profiles.user_id = auth.uid());

CREATE POLICY "Admins can manage user profiles" ON user_profiles
    FOR ALL USING (
        get_user_permissions() ? 'admin.users.create' OR
        get_user_permissions() ? 'admin.users.read' OR
        get_user_permissions() ? 'admin.users.update' OR
        get_user_permissions() ? 'admin.users.delete'
    );

-- 3. Verify policies are created correctly
SELECT schemaname, tablename, policyname, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('user_roles', 'user_profiles')
ORDER BY tablename, policyname;

SELECT 'RLS policies fixed - ambiguous column references resolved' as status;