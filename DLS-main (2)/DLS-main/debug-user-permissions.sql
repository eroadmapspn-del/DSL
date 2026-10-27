-- Check what permissions a specific user has
-- Replace 'test@example.com' with the actual email of your test user

-- 1. Find the user ID from email
SELECT 
    u.id as user_id,
    u.email,
    up.full_name,
    up.department,
    up.is_active
FROM auth.users u
LEFT JOIN user_profiles up ON u.id = up.user_id
WHERE u.email = 'mohan@delivery.com';

-- 2. Check user's roles and permissions
SELECT 
    u.email,
    ur.user_id,
    r.name as role_name,
    r.display_name,
    r.permissions
FROM auth.users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.email = 'mohan@delivery.com';

-- 3. Test the get_user_permissions function for this user
-- (You'll need to run this while logged in as that user)
-- SELECT get_user_permissions();

-- 5. Debug: Check if user_roles table has the assignment
SELECT 
    ur.user_id,
    ur.role_id,
    ur.assigned_at,
    r.name as role_name,
    r.permissions,
    u.email
FROM user_roles ur
JOIN roles r ON ur.role_id = r.id
JOIN auth.users u ON ur.user_id = u.id
WHERE u.email = 'mohan@delivery.com';

-- 6. Debug: Test the get_user_permissions function manually
SELECT 
    COALESCE(jsonb_agg(DISTINCT perm), '[]'::jsonb) as computed_permissions
FROM (
    SELECT jsonb_array_elements_text(r.permissions) as perm
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    JOIN auth.users u ON ur.user_id = u.id
    WHERE u.email = 'mohan@delivery.com'
) permissions;

-- 4. Check all available roles and their permissions
SELECT 
    name,
    display_name,
    permissions
FROM roles
ORDER BY name;