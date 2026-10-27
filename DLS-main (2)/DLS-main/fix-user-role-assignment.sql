-- Fix: Manually assign supply_in_progress role to mohan@delivery.com
-- Run this if the debug queries show the user has no role assigned

-- 1. Get the user ID and role ID
WITH user_info AS (
    SELECT u.id as user_id
    FROM auth.users u
    WHERE u.email = 'mohan@delivery.com'
),
role_info AS (
    SELECT r.id as role_id
    FROM roles r
    WHERE r.name = 'supply_in_progress'
)
-- 2. Insert the role assignment
INSERT INTO user_roles (user_id, role_id, assigned_by)
SELECT 
    ui.user_id,
    ri.role_id,
    (SELECT id FROM auth.users WHERE email = 'admin@example.com' LIMIT 1) -- Replace with admin user ID
FROM user_info ui, role_info ri
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 3. Verify the assignment worked
SELECT 
    u.email,
    r.name as role_name,
    r.permissions,
    ur.assigned_at
FROM auth.users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.email = 'mohan@delivery.com';