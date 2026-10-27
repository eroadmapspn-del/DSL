-- Add Analysis Permissions to RBAC System
-- Run this in your Supabase SQL Editor to add analysis permissions

-- Update admin role to include analysis permissions
UPDATE roles 
SET permissions = permissions || '["analysis.supply.view", "analysis.ugrai.view", "analysis.purchase.view", "analysis.pending_bills.view"]'::jsonb
WHERE name = 'admin';

-- Verify the update
SELECT name, display_name, permissions 
FROM roles 
WHERE name = 'admin';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Analysis permissions added to admin role!';
    RAISE NOTICE '📊 Added permissions: analysis.supply.view, analysis.ugrai.view, analysis.purchase.view, analysis.pending_bills.view';
    RAISE NOTICE '🔄 Existing admin users now have access to Analysis section';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 You can now:';
    RAISE NOTICE '1. Access the Analysis section in supply.html';
    RAISE NOTICE '2. View Supply, UGRAI, Purchase, and Pending Bills analysis';
    RAISE NOTICE '3. Assign analysis permissions to other users in admin.html';
    RAISE NOTICE '4. Create custom roles with specific analysis permissions';
END $$;