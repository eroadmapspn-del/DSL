-- Alternative trigger approach - simpler and more robust
-- Run this if the current trigger is causing issues

-- Drop existing trigger
DROP TRIGGER IF EXISTS create_profile_trigger ON auth.users;

-- Create a simpler, more robust trigger function
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create profile if it doesn't exist
    INSERT INTO user_profiles (user_id, email, full_name)
    VALUES (
        NEW.id, 
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    )
    ON CONFLICT (user_id) DO NOTHING; -- Ignore if already exists
    
    -- Only assign viewer role if user has no roles
    INSERT INTO user_roles (user_id, role_id)
    SELECT NEW.id, r.id
    FROM roles r
    WHERE r.name = 'viewer'
    AND NOT EXISTS (
        SELECT 1 FROM user_roles ur WHERE ur.user_id = NEW.id
    );
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail user creation
        RAISE WARNING 'Error in create_user_profile trigger: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
CREATE TRIGGER create_profile_trigger
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_user_profile();
    
-- Test the trigger works
SELECT 'Trigger updated successfully' as status;