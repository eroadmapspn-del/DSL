-- Simpler fix for RLS policies on ugrai_assignments
-- Use a single policy that checks both conditions properly

-- Drop all existing policies
DROP POLICY IF EXISTS "Allow ugrai_assignments select" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments insert" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments update" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments delete" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_select_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_insert_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_update_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_delete_policy" ON ugrai_assignments;

-- SELECT: Allow if user created it OR if user's name matches assigned_to
CREATE POLICY "ugrai_assignments_select_policy" ON ugrai_assignments
    FOR SELECT USING (
        -- Check if current user is the creator OR is the assigned delivery person
        ugrai_assignments.user_id = auth.uid()
        OR
        ugrai_assignments.assigned_to = (
            SELECT full_name::text 
            FROM user_profiles 
            WHERE user_id = auth.uid()
            LIMIT 1
        )
    );

-- INSERT: Only creator
CREATE POLICY "ugrai_assignments_insert_policy" ON ugrai_assignments
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
    );

-- UPDATE: Creator or assigned person
CREATE POLICY "ugrai_assignments_update_policy" ON ugrai_assignments
    FOR UPDATE USING (
        ugrai_assignments.user_id = auth.uid()
        OR
        ugrai_assignments.assigned_to = (
            SELECT full_name::text 
            FROM user_profiles 
            WHERE user_id = auth.uid()
            LIMIT 1
        )
    );

-- DELETE: Only creator
CREATE POLICY "ugrai_assignments_delete_policy" ON ugrai_assignments
    FOR DELETE USING (
        user_id = auth.uid()
    );

-- Ensure RLS is enabled
ALTER TABLE ugrai_assignments ENABLE ROW LEVEL SECURITY;
