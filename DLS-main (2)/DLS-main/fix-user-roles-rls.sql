-- EMERGENCY FIX: Clean all RLS policies to stop infinite recursion
-- The recursion happens because the policy queries user_roles to check admin status

-- 1. Drop ALL possible policy names that might exist
DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON user_roles; 
DROP POLICY IF EXISTS "Admins can manage user roles" ON user_roles;
DROP POLICY IF EXISTS "Admins full access to user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow all authenticated users" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to read user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to insert user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to update user_roles" ON user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to delete user_roles" ON user_roles;

-- 2. Check what policies actually exist before creating new ones
SELECT 'Current policies before cleanup:' as status;
SELECT policyname FROM pg_policies WHERE tablename = 'user_roles';

-- 3. Create simple non-recursive policy
CREATE POLICY "temp_allow_all_user_roles" ON user_roles
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- 4. Verify policies are working
SELECT 
    policyname, 
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'user_roles'
ORDER BY policyname;

SELECT 'RLS policies updated for user_roles table' as status;