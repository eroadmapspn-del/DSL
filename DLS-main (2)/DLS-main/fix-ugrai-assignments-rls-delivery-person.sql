-- Fix RLS policies for ugrai_assignments to allow delivery persons to see their assignments
-- Problem: Current RLS only allows viewing where user_id = auth.uid()
-- But user_id is the ADMIN who created the assignment
-- Delivery person is identified by the assigned_to field (their name)

-- Drop existing restrictive policies (all possible names)
DROP POLICY IF EXISTS "Allow ugrai_assignments select" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments insert" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments update" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments delete" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_select_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_insert_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_update_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_delete_policy" ON ugrai_assignments;

-- New SELECT policy: Allow users to see assignments they created OR assignments assigned to them
CREATE POLICY "ugrai_assignments_select_policy" ON ugrai_assignments
    FOR SELECT USING (
        -- Admin/creator can see their own assignments
        user_id = auth.uid()
        OR
        -- Delivery person can see assignments where their name matches assigned_to
        EXISTS (
            SELECT 1 
            FROM user_profiles up 
            WHERE up.user_id = auth.uid()
            AND up.full_name::text = assigned_to
        )
    );

-- INSERT: Only the creator can insert (admins creating assignments)
CREATE POLICY "ugrai_assignments_insert_policy" ON ugrai_assignments
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
    );

-- UPDATE: Creator can update, OR delivery person can update their own assignments
CREATE POLICY "ugrai_assignments_update_policy" ON ugrai_assignments
    FOR UPDATE USING (
        user_id = auth.uid()
        OR
        EXISTS (
            SELECT 1 
            FROM user_profiles up 
            WHERE up.user_id = auth.uid()
            AND up.full_name::text = assigned_to
        )
    );

-- DELETE: Only the creator can delete
CREATE POLICY "ugrai_assignments_delete_policy" ON ugrai_assignments
    FOR DELETE USING (
        user_id = auth.uid()
    );

-- Ensure RLS is enabled
ALTER TABLE ugrai_assignments ENABLE ROW LEVEL SECURITY;
