-- Alternative fix: Simplify RLS policies to avoid function complexity
-- If the above doesn't work, use these simpler policies

-- 1. Drop all existing policies
DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can manage user roles" ON user_roles;
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can manage user profiles" ON user_profiles;

-- 2. Temporarily disable RLS to allow user creation
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;

-- 3. Create simple policies without function calls
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Simple policies for user_roles
CREATE POLICY "Allow authenticated users to read user_roles" ON user_roles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert user_roles" ON user_roles
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update user_roles" ON user_roles
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to delete user_roles" ON user_roles
    FOR DELETE TO authenticated USING (true);

-- Simple policies for user_profiles
CREATE POLICY "Allow authenticated users to read user_profiles" ON user_profiles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert user_profiles" ON user_profiles
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update user_profiles" ON user_profiles
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to delete user_profiles" ON user_profiles
    FOR DELETE TO authenticated USING (true);

SELECT 'Simplified RLS policies applied - should resolve ambiguous column errors' as status;