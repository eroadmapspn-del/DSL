-- Ultimate fix: Simple and reliable RLS policies
-- Avoid complex function calls that can cause ambiguity

-- 0. Create the is_user_admin function first
CREATE OR REPLACE FUNCTION is_user_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND r.name = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. Drop all existing policies
DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can manage user roles" ON user_roles;
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can manage user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to read user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to insert user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to update user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to delete user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to read user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to insert user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to update user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to delete user_profiles" ON user_profiles;

-- 2. Create simple, direct policies using is_user_admin function
-- User Roles policies
CREATE POLICY "Users can view their own roles" ON user_roles
    FOR SELECT USING (user_roles.user_id = auth.uid());

CREATE POLICY "Admins can manage user roles" ON user_roles
    FOR ALL USING (is_user_admin());

-- User Profiles policies  
CREATE POLICY "Users can view their own profile" ON user_profiles
    FOR SELECT USING (user_profiles.user_id = auth.uid());

CREATE POLICY "Admins can manage user profiles" ON user_profiles
    FOR ALL USING (is_user_admin());

-- 3. Verify the is_user_admin function exists and works
SELECT is_user_admin() as am_i_admin;

SELECT 'Simple RLS policies created using is_user_admin function' as status;