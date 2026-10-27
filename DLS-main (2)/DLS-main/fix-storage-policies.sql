-- Fix Storage RLS Policies for Bill Photos
-- Run this in your Supabase SQL Editor to fix photo upload permissions

-- Enable RLS on storage.objects (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop any existing conflicting policies for bill-photos bucket
DROP POLICY IF EXISTS "Public read access for bill photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload bill photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own bill photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own bill photos" ON storage.objects;

-- Create proper storage policies for bill-photos bucket

-- 1. Allow public read access to bill photos
CREATE POLICY "Bill photos public read" ON storage.objects
FOR SELECT USING (bucket_id = 'bill-photos');

-- 2. Allow authenticated users to upload to bill-photos
CREATE POLICY "Bill photos authenticated upload" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'bill-photos' 
    AND auth.role() = 'authenticated'
);

-- 3. Allow users to update files in bill-photos bucket
CREATE POLICY "Bill photos authenticated update" ON storage.objects
FOR UPDATE USING (
    bucket_id = 'bill-photos' 
    AND auth.role() = 'authenticated'
) WITH CHECK (
    bucket_id = 'bill-photos' 
    AND auth.role() = 'authenticated'
);

-- 4. Allow users to delete files in bill-photos bucket
CREATE POLICY "Bill photos authenticated delete" ON storage.objects
FOR DELETE USING (
    bucket_id = 'bill-photos' 
    AND auth.role() = 'authenticated'
);

-- Verify the policies were created
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    roles, 
    cmd, 
    qual
FROM pg_policies 
WHERE tablename = 'objects' 
AND policyname LIKE '%Bill photos%';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Storage policies for bill-photos bucket have been created!';
    RAISE NOTICE 'You can now upload photos to the bill-photos bucket.';
END $$;