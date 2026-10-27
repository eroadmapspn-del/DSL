-- Post-Migration: Assign Admin Role
-- Run this AFTER running the migration script
-- Replace 'your-email@example.com' with your actual email address

-- Step 1: Find your user ID and assign admin role
DO $$
DECLARE
    admin_role_id UUID;
    your_user_id UUID;
    your_email TEXT := 'your-email@example.com'; -- ⚠️ CHANGE THIS TO YOUR EMAIL
BEGIN
    -- Get admin role ID
    SELECT id INTO admin_role_id 
    FROM roles 
    WHERE name = 'admin';
    
    -- Get your user ID
    SELECT id INTO your_user_id 
    FROM auth.users 
    WHERE email = your_email;
    
    -- Check if we found both 
    IF admin_role_id IS NULL THEN
        RAISE EXCEPTION 'Admin role not found. Make sure you ran the migration script first.';
    END IF;
    
    IF your_user_id IS NULL THEN
        RAISE EXCEPTION 'User with email % not found. Please check the email address.', your_email;
    END IF;
    
    -- Assign admin role
    INSERT INTO user_roles (user_id, role_id, assigned_by)
    VALUES (your_user_id, admin_role_id, your_user_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
    
    -- Update user profile if needed
    INSERT INTO user_profiles (user_id, email, full_name, is_active)
    VALUES (your_user_id, your_email, 'Admin User', true)
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        email = EXCLUDED.email,
        is_active = true,
        updated_at = NOW();
    
    RAISE NOTICE '✅ Admin role assigned successfully to %', your_email;
    RAISE NOTICE '🔑 You can now access the admin dashboard';
    
END $$;

-- Verify the assignment
SELECT 
    u.email,
    r.name as role_name,
    r.display_name,
    ur.assigned_at
FROM auth.users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.email = 'your-email@example.com'; -- ⚠️ CHANGE THIS TO YOUR EMAIL