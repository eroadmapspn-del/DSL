-- Quick Fix for RLS Policy Issues
-- Run this in your Supabase SQL Editor to fix the "new row violates row-level security policy" error

-- Option 1: Temporarily disable RLS (easiest fix for testing)
ALTER TABLE purchase_retailers DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_entries DISABLE ROW LEVEL SECURITY;

-- Option 2: If you prefer to keep RLS enabled, run this instead of the above:
-- DROP ALL existing policies first
-- DROP POLICY IF EXISTS "Users can view their own purchase retailers" ON purchase_retailers;
-- DROP POLICY IF EXISTS "Users can insert their own purchase retailers" ON purchase_retailers; 
-- DROP POLICY IF EXISTS "Users can update their own purchase retailers" ON purchase_retailers;
-- DROP POLICY IF EXISTS "Users can delete their own purchase retailers" ON purchase_retailers;
-- DROP POLICY IF EXISTS "Users can view their own purchase entries" ON purchase_entries;
-- DROP POLICY IF EXISTS "Users can insert their own purchase entries" ON purchase_entries;
-- DROP POLICY IF EXISTS "Users can update their own purchase entries" ON purchase_entries;
-- DROP POLICY IF EXISTS "Users can delete their own purchase entries" ON purchase_entries;

-- Create permissive policies for anonymous users
-- CREATE POLICY "Allow all operations on purchase_retailers" ON purchase_retailers
-- FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- CREATE POLICY "Allow all operations on purchase_entries" ON purchase_entries  
-- FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);