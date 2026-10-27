-- Bill Photos Storage Schema for Supabase
-- This file contains the database schema for storing bill photos

-- Create bill_photos table
CREATE TABLE IF NOT EXISTS bill_photos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bill_number TEXT NOT NULL,
    bill_type TEXT NOT NULL CHECK (bill_type IN ('supply', 'ugrai', 'purchase')),
    photo_type TEXT DEFAULT 'general', -- 'receipt', 'invoice', 'delivery', 'completion', etc.
    photo_url TEXT NOT NULL,
    photo_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size INTEGER,
    file_type TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    uploaded_by UUID REFERENCES auth.users(id),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}' -- For any additional metadata
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_bill_photos_bill_number ON bill_photos(bill_number);
CREATE INDEX IF NOT EXISTS idx_bill_photos_bill_type ON bill_photos(bill_type);
CREATE INDEX IF NOT EXISTS idx_bill_photos_uploaded_at ON bill_photos(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_bill_photos_uploaded_by ON bill_photos(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_bill_photos_is_active ON bill_photos(is_active);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_bill_photos_bill_number_type ON bill_photos(bill_number, bill_type);

-- Enable Row Level Security (RLS)
ALTER TABLE bill_photos ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bill_photos table

-- Policy: Users can view all active bill photos
CREATE POLICY "Users can view active bill photos" ON bill_photos
    FOR SELECT 
    USING (is_active = true);

-- Policy: Authenticated users can insert bill photos
CREATE POLICY "Authenticated users can insert bill photos" ON bill_photos
    FOR INSERT 
    WITH CHECK (
        auth.role() = 'authenticated' 
        AND uploaded_by = auth.uid()
    );

-- Policy: Users can update their own bill photos
CREATE POLICY "Users can update their own bill photos" ON bill_photos
    FOR UPDATE 
    USING (uploaded_by = auth.uid())
    WITH CHECK (uploaded_by = auth.uid());

-- Policy: Users can delete their own bill photos (by marking inactive)
CREATE POLICY "Users can delete their own bill photos" ON bill_photos
    FOR UPDATE 
    USING (uploaded_by = auth.uid() AND is_active = true)
    WITH CHECK (uploaded_by = auth.uid());

-- Function to get bill photos count
CREATE OR REPLACE FUNCTION get_bill_photos_count(p_bill_number TEXT, p_bill_type TEXT DEFAULT NULL)
RETURNS INTEGER AS $$
BEGIN
    IF p_bill_type IS NULL THEN
        RETURN (
            SELECT COUNT(*)
            FROM bill_photos
            WHERE bill_number = p_bill_number
            AND is_active = true
        );
    ELSE
        RETURN (
            SELECT COUNT(*)
            FROM bill_photos
            WHERE bill_number = p_bill_number
            AND bill_type = p_bill_type
            AND is_active = true
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old inactive photos (run periodically)
CREATE OR REPLACE FUNCTION cleanup_inactive_photos(days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM bill_photos
    WHERE is_active = false
    AND uploaded_at < NOW() - INTERVAL '1 day' * days_old;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create storage bucket policy (run this in Supabase dashboard SQL editor)
-- Note: This needs to be run separately as it requires storage admin privileges

/*
-- Create the storage bucket (run this in Supabase dashboard)
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES (
    'bill-photos',
    'bill-photos',
    true,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    5242880 -- 5MB limit
)
ON CONFLICT (id) DO NOTHING;

-- Storage bucket policies
CREATE POLICY "Public read access for bill photos" ON storage.objects
    FOR SELECT USING (bucket_id = 'bill-photos');

CREATE POLICY "Authenticated users can upload bill photos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'bill-photos'
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Users can update their own bill photos" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'bill-photos'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete their own bill photos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'bill-photos'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
*/

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON bill_photos TO authenticated;
GRANT EXECUTE ON FUNCTION get_bill_photos_count(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_inactive_photos(INTEGER) TO service_role;

-- Sample queries for testing

-- Get all photos for a specific bill
-- SELECT * FROM bill_photos WHERE bill_number = 'NIV601484242039' AND is_active = true;

-- Get photos count for a bill
-- SELECT get_bill_photos_count('NIV601484242039');

-- Get photos by type
-- SELECT * FROM bill_photos WHERE bill_type = 'supply' AND is_active = true ORDER BY uploaded_at DESC;

-- Clean up old inactive photos (for maintenance)
-- SELECT cleanup_inactive_photos(30);

COMMENT ON TABLE bill_photos IS 'Stores metadata for bill-related photos uploaded to Supabase Storage';
COMMENT ON COLUMN bill_photos.bill_number IS 'Reference to the bill this photo belongs to';
COMMENT ON COLUMN bill_photos.bill_type IS 'Type of bill: supply, ugrai, or purchase';
COMMENT ON COLUMN bill_photos.photo_type IS 'Purpose of the photo: receipt, invoice, delivery, completion, etc.';
COMMENT ON COLUMN bill_photos.storage_path IS 'Full path to the file in Supabase Storage';
COMMENT ON COLUMN bill_photos.metadata IS 'Additional metadata as JSON (e.g., GPS coordinates, device info, etc.)';