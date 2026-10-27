-- Force reset of RLS policies on ugrai_assignments
-- This completely disables RLS, drops all policies, then recreates them

-- Step 1: Disable RLS temporarily
ALTER TABLE ugrai_assignments DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop ALL existing policies (just to be absolutely sure)
DROP POLICY IF EXISTS "Allow ugrai_assignments select" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments insert" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments update" ON ugrai_assignments;
DROP POLICY IF EXISTS "Allow ugrai_assignments delete" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_select_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_insert_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_update_policy" ON ugrai_assignments;
DROP POLICY IF EXISTS "ugrai_assignments_delete_policy" ON ugrai_assignments;

-- Step 3: Re-enable RLS
ALTER TABLE ugrai_assignments ENABLE ROW LEVEL SECURITY;

-- Step 4: Create brand new policies with full qualification
CREATE POLICY "ugrai_assignments_select_policy" ON ugrai_assignments
    FOR SELECT USING (
        ugrai_assignments.user_id = auth.uid()
        OR
        ugrai_assignments.assigned_to = (
            SELECT up.full_name::text 
            FROM user_profiles up
            WHERE up.user_id = auth.uid()
            LIMIT 1
        )
    );

CREATE POLICY "ugrai_assignments_insert_policy" ON ugrai_assignments
    FOR INSERT WITH CHECK (
        ugrai_assignments.user_id = auth.uid()
    );

CREATE POLICY "ugrai_assignments_update_policy" ON ugrai_assignments
    FOR UPDATE USING (
        ugrai_assignments.user_id = auth.uid()
        OR
        ugrai_assignments.assigned_to = (
            SELECT up.full_name::text 
            FROM user_profiles up
            WHERE up.user_id = auth.uid()
            LIMIT 1
        )
    );

CREATE POLICY "ugrai_assignments_delete_policy" ON ugrai_assignments
    FOR DELETE USING (
        ugrai_assignments.user_id = auth.uid()
    );
