-- Fix RLS policy blocking user role assignments
-- The current policies are preventing admins from creating role assignments

-- 1. Check current RLS policies
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'user_roles'
ORDER BY policyname;

-- 2. Check if is_user_admin function exists and works
SELECT is_user_admin() as am_i_admin;

-- 3. Test creating a role assignment manually to see exact error
-- (This will help us understand what's blocking the insert)