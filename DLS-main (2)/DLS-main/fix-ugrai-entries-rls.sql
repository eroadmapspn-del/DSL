-- ============================================================================
-- FIX: ugrai_entries RLS Policy Issue
-- ============================================================================

-- The issue is that RLS policies on ugrai_entries are too restrictive
-- Let's check and fix them

-- Step 1: Check current RLS policies
SELECT 
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE tablename = 'ugrai_entries';

-- Step 2: Check if RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'ugrai_entries';

-- ============================================================================
-- SOLUTION: Drop and recreate RLS policies for ugrai_entries
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON ugrai_entries;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON ugrai_entries;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON ugrai_entries;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON ugrai_entries;
DROP POLICY IF EXISTS "Users can view their own ugrai entries" ON ugrai_entries;
DROP POLICY IF EXISTS "Users can insert their own ugrai entries" ON ugrai_entries;
DROP POLICY IF EXISTS "Users can update their own ugrai entries" ON ugrai_entries;
DROP POLICY IF EXISTS "Users can delete their own ugrai entries" ON ugrai_entries;
DROP POLICY IF EXISTS "Enable read access for anon users" ON ugrai_entries;

-- OPTION 1: Completely disable RLS (RECOMMENDED for single-user app)
-- This is the simplest solution if you don't need row-level security
ALTER TABLE ugrai_entries DISABLE ROW LEVEL SECURITY;

-- OPTION 2: If you want to keep RLS enabled, use permissive policies
-- Comment out the line above and uncomment the policies below:

/*
-- Create new permissive policies that allow authenticated users to access all records
CREATE POLICY "Enable read access for authenticated users"
ON ugrai_entries FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert access for authenticated users"
ON ugrai_entries FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update access for authenticated users"
ON ugrai_entries FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Enable delete access for authenticated users"
ON ugrai_entries FOR DELETE
TO authenticated
USING (true);

-- Also allow anon access for reading (if needed for your app)
CREATE POLICY "Enable read access for anon users"
ON ugrai_entries FOR SELECT
TO anon
USING (true);
*/

-- ============================================================================
-- VERIFICATION: Test the query
-- ============================================================================

-- This should now return your 4k bills
SELECT COUNT(*) as total_bills FROM ugrai_entries;

-- Check by user_id
SELECT 
    user_id,
    COUNT(*) as bill_count
FROM ugrai_entries
GROUP BY user_id;

-- Sample records
SELECT 
    id,
    user_id,
    bill_number,
    retailer_name,
    net_amount,
    status
FROM ugrai_entries
LIMIT 10;
