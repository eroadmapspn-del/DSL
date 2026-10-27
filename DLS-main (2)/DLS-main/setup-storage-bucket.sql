-- Manual Setup for Bill Photos Storage
-- Run this in your Supabase SQL Editor as it requires admin privileges

-- Step 1: Create the storage bucket
-- Note: This must be run with service_role key or in Supabase Dashboard
INSERT INTO storage.buckets (
    id, 
    name, 
    public, 
    allowed_mime_types, 
    file_size_limit,
    avif_autodetection,
    created_at,
    updated_at
)
VALUES (
    'bill-photos',
    'bill-photos',
    true,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    5242880, -- 5MB limit
    false,
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Set up storage policies (RLS for storage.objects)

-- First, enable RLS on storage.objects if not already enabled
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (ignore errors)
DROP POLICY IF EXISTS "Public read access for bill photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload bill photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own bill photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own bill photos" ON storage.objects;

-- Allow public read access to bill photos
CREATE POLICY "Public read access for bill photos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'bill-photos');

-- Allow authenticated users to upload bill photos
CREATE POLICY "Authenticated users can upload bill photos" 
ON storage.objects FOR INSERT 
WITH CHECK (
    bucket_id = 'bill-photos' 
    AND auth.role() = 'authenticated'
);

-- Allow users to update their own uploads
CREATE POLICY "Users can update their own bill photos" 
ON storage.objects FOR UPDATE 
USING (
    bucket_id = 'bill-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to delete their own uploads
CREATE POLICY "Users can delete their own bill photos" 
ON storage.objects FOR DELETE 
USING (
    bucket_id = 'bill-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Step 3: Verify the setup
SELECT 
    id, 
    name, 
    public, 
    allowed_mime_types, 
    file_size_limit,
    created_at
FROM storage.buckets 
WHERE id = 'bill-photos';

-- Step 4: Test access (should return empty list, not error)
-- SELECT * FROM storage.objects WHERE bucket_id = 'bill-photos' LIMIT 1;

-- Success message
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'bill-photos') THEN
        RAISE NOTICE '✅ Bill photos storage bucket setup completed successfully!';
    ELSE
        RAISE NOTICE '❌ Failed to create bill photos storage bucket.';
    END IF;
END $$;