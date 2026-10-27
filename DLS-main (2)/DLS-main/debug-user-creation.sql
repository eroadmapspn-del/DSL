-- Debug script to check database trigger and constraints
-- Run this to diagnose the user creation issue

-- 1. Check if the trigger exists and is working
SELECT 
    trigger_name, 
    event_manipulation, 
    action_statement, 
    trigger_schema, 
    event_object_table
FROM information_schema.triggers 
WHERE event_object_table = 'users' AND trigger_schema = 'auth';

-- 2. Check user_profiles table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'user_profiles' 
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- 3. Check for any constraints that might be failing
SELECT 
    conname,
    contype,
    pg_get_constraintdef(oid) as constraint_def
FROM pg_constraint 
WHERE conrelid = 'user_profiles'::regclass;

-- 4. Check roles table to ensure it has the expected roles
SELECT id, name, display_name FROM roles ORDER BY name;

-- 5. Test if we can manually create a profile (for debugging)
-- This will help identify which constraint is failing
BEGIN;
    -- Try to insert a test profile
    INSERT INTO user_profiles (user_id, email, full_name) 
    VALUES ('00000000-0000-0000-0000-000000000000', 'test@example.com', 'Test User');
    
    -- If this fails, it will show us the exact constraint error
ROLLBACK;