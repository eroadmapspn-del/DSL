-- Debug admin account issues
-- This will help identify why admin can't see anything

-- 1. Find all users and their basic info
SELECT 
    u.id,
    u.email,
    u.created_at,
    up.full_name,
    up.is_active
FROM auth.users u
LEFT JOIN user_profiles up ON u.id = up.user_id
ORDER BY u.created_at;

-- 2. Check ALL user role assignments
SELECT 
    u.email,
    r.name as role_name,
    r.display_name,
    r.permissions,
    ur.assigned_at
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
ORDER BY u.email;

-- 3. Check if admin role exists and has correct permissions
SELECT 
    name,
    display_name,
    permissions,
    is_system_role
FROM roles
WHERE name = 'admin';

-- 4. Find users with admin role specifically
SELECT 
    u.email,
    u.id as user_id,
    r.name as role_name,
    r.permissions
FROM auth.users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE r.name = 'admin';

-- 5. Check RLS policies that might be blocking access
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename IN ('user_roles', 'user_profiles', 'roles')
ORDER BY tablename, policyname;