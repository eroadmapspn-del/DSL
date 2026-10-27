-- ============================================================================
-- ADD CASH RECEIPT PERMISSION TO RBAC
-- ============================================================================
-- This script adds the cash_receipt.view permission to admin and accountant roles
-- Run this in Supabase SQL Editor AFTER running cash-receipt-database-deployment.sql
-- ============================================================================

-- Add cash_receipt.view permission to admin role
UPDATE roles
SET permissions = permissions || '["cash_receipt.view"]'::jsonb
WHERE name = 'admin'
AND NOT (permissions ? 'cash_receipt.view');

-- Add cash_receipt.view permission to accountant role
UPDATE roles
SET permissions = permissions || '["cash_receipt.view"]'::jsonb
WHERE name = 'accountant'
AND NOT (permissions ? 'cash_receipt.view');

-- Verify the changes
SELECT 
    name, 
    display_name,
    permissions
FROM roles
WHERE name IN ('admin', 'accountant')
ORDER BY name;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Cash Receipt permission added to admin and accountant roles';
    RAISE NOTICE '📋 Permission: cash_receipt.view';
    RAISE NOTICE '🔐 Roles updated: admin, accountant';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Verify the permissions in the output above';
    RAISE NOTICE '2. Refresh your application';
    RAISE NOTICE '3. Cash Receipt tab should now be visible for admin/accountant users';
END $$;
