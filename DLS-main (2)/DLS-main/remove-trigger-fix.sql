-- Fix for user creation issue: Remove problematic trigger
-- The trigger was causing foreign key constraint violations due to timing issues

-- 1. Drop the problematic trigger
DROP TRIGGER IF EXISTS create_profile_trigger ON auth.users;

-- 2. Drop the trigger function
DROP FUNCTION IF EXISTS create_user_profile();

-- 3. Verify trigger is removed
SELECT 
    trigger_name, 
    event_manipulation, 
    event_object_table
FROM information_schema.triggers 
WHERE event_object_table = 'users' AND trigger_schema = 'auth';

-- 4. Success message
SELECT 'Trigger removed successfully. User creation will now be handled manually in JavaScript.' as status;