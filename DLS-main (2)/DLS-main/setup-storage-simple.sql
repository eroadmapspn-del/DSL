-- SIMPLE Bill Photos Storage Setup
-- Due to permission restrictions, use the Supabase Dashboard method

-- ================================
-- EASY METHOD: Supabase Dashboard
-- ================================

-- 1. Go to your Supabase Dashboard
-- 2. Navigate to Storage section
-- 3. Click "Create bucket"
-- 4. Set these values:
--    - Name: bill-photos
--    - Public: Yes (check this box)
--    - File size limit: 5MB
--    - Allowed MIME types: image/jpeg, image/png, image/webp
-- 5. Click "Save"

-- That's it! Public buckets automatically get the right policies.

-- ================================
-- VERIFICATION QUERIES
-- ================================

-- Check if bucket was created successfully
SELECT 
    id, 
    name, 
    public, 
    file_size_limit,
    created_at
FROM storage.buckets 
WHERE id = 'bill-photos';

-- Test bucket access (should return empty result, not error)
SELECT count(*) as file_count 
FROM storage.objects 
WHERE bucket_id = 'bill-photos';

-- Success message
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'bill-photos') THEN
        RAISE NOTICE '✅ Bill photos storage bucket exists and is ready!';
        RAISE NOTICE 'You can now use: await supabaseDataService.initializeBillPhotosStorage()';
    ELSE
        RAISE NOTICE '❌ Bill photos bucket not found. Please create it via Dashboard.';
    END IF;
END $$;

-- ================================
-- ALTERNATIVE: Service Role Method
-- ================================
-- Only use this if you have service_role access
-- (Most users should use the Dashboard method above)

/*
-- Run this only if you have service_role key access:

INSERT INTO storage.buckets (
    id, 
    name, 
    public, 
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'bill-photos',
    'bill-photos',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;
*/