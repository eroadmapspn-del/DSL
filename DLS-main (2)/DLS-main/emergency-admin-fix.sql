-- Emergency fix: Assign admin role to your account
-- Replace 'your-admin-email@example.com' with your actual admin email

-- Method 1: Assign admin role to specific user
INSERT INTO user_roles (user_id, role_id)
SELECT 
    u.id as user_id,
    r.id as role_id
FROM auth.users u, roles r
WHERE u.email = 'your-admin-email@example.com'  -- UPDATE THIS EMAIL
AND r.name = 'admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Method 2: If that fails, temporarily disable RLS to fix permissions
-- (Run this only if needed)
-- ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;

-- Method 3: Verify the assignment worked
SELECT 
    u.email,
    r.name as role_name,
    r.permissions
FROM auth.users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.email = 'your-admin-email@example.com';  -- UPDATE THIS EMAIL