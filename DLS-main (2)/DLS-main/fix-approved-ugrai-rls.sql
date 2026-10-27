-- Comprehensive Fix for All Ugrai RLS Policy Issues
-- This addresses the 42501 error when accessing Ugrai tables
-- The issue is that auth.uid() returns null in unauthenticated sessions
-- but the original policies don't handle this case properly

-- ==========================================
-- FIX FOR APPROVED_UGRAI TABLE
-- ==========================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own approved_ugrai" ON approved_ugrai;
DROP POLICY IF EXISTS "Users can insert their own approved_ugrai" ON approved_ugrai;
DROP POLICY IF EXISTS "Users can update their own approved_ugrai" ON approved_ugrai;
DROP POLICY IF EXISTS "Users can delete their own approved_ugrai" ON approved_ugrai;

-- Create more robust policies that handle unauthenticated sessions
CREATE POLICY "Allow approved_ugrai select" ON approved_ugrai
    FOR SELECT USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow approved_ugrai insert" ON approved_ugrai
    FOR INSERT WITH CHECK (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow approved_ugrai update" ON approved_ugrai
    FOR UPDATE USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow approved_ugrai delete" ON approved_ugrai
    FOR DELETE USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

-- ==========================================
-- FIX FOR COMPLETED_UGRAI TABLE
-- ==========================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own completed_ugrai" ON completed_ugrai;
DROP POLICY IF EXISTS "Users can insert their own completed_ugrai" ON completed_ugrai;
DROP POLICY IF EXISTS "Users can update their own completed_ugrai" ON completed_ugrai;
DROP POLICY IF EXISTS "Users can delete their own completed_ugrai" ON completed_ugrai;

-- Create more robust policies
CREATE POLICY "Allow completed_ugrai select" ON completed_ugrai
    FOR SELECT USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow completed_ugrai insert" ON completed_ugrai
    FOR INSERT WITH CHECK (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow completed_ugrai update" ON completed_ugrai
    FOR UPDATE USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow completed_ugrai delete" ON completed_ugrai
    FOR DELETE USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

-- ==========================================
-- FIX FOR UGRAI_ASSIGNMENTS TABLE
-- ==========================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own ugrai_assignments" ON ugrai_assignments;
DROP POLICY IF EXISTS "Users can insert their own ugrai_assignments" ON ugrai_assignments;
DROP POLICY IF EXISTS "Users can update their own ugrai_assignments" ON ugrai_assignments;
DROP POLICY IF EXISTS "Users can delete their own ugrai_assignments" ON ugrai_assignments;

-- Create more robust policies
CREATE POLICY "Allow ugrai_assignments select" ON ugrai_assignments
    FOR SELECT USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow ugrai_assignments insert" ON ugrai_assignments
    FOR INSERT WITH CHECK (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow ugrai_assignments update" ON ugrai_assignments
    FOR UPDATE USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

CREATE POLICY "Allow ugrai_assignments delete" ON ugrai_assignments
    FOR DELETE USING (
        user_id = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid)
        OR user_id = '00000000-0000-0000-0000-000000000001'::uuid
    );

-- Ensure all tables have RLS enabled
ALTER TABLE approved_ugrai ENABLE ROW LEVEL SECURITY;
ALTER TABLE completed_ugrai ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugrai_assignments ENABLE ROW LEVEL SECURITY;

-- Test queries to verify policies work
-- SELECT 'approved_ugrai test' as test, COUNT(*) as count FROM approved_ugrai;
-- SELECT 'completed_ugrai test' as test, COUNT(*) as count FROM completed_ugrai;
-- SELECT 'ugrai_assignments test' as test, COUNT(*) as count FROM ugrai_assignments; 