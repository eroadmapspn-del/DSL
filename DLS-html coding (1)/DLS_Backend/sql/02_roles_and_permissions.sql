-- ============================================================================
-- Default Roles and Initial Seed Data
-- ============================================================================

INSERT INTO roles (id, name, display_name, description, permissions, is_system_role) VALUES
(
    '00000000-0000-0000-0000-000000000010',
    'admin',
    'Administrator',
    'Full system access with user management capabilities',
    '[
        "admin.dashboard.view",
        "admin.users.create",
        "admin.users.read",
        "admin.users.update",
        "admin.users.delete",
        "supply.in_progress.view",
        "supply.management.view",
        "ugrai.base_file.view",
        "ugrai.total.view",
        "ugrai.issue.view",
        "ugrai.in_progress.view",
        "ugrai.management.view",
        "purchase.accounting.view",
        "analysis.supply.view",
        "analysis.ugrai.view",
        "analysis.purchase.view",
        "analysis.pending_bills.view",
        "cash_receipts.view",
        "cash_receipts.manage"
    ]'::jsonb,
    TRUE
),
(
    '00000000-0000-0000-0000-000000000011',
    'supply_manager',
    'Supply Manager',
    'Access to supply-related sections only',
    '[
        "supply.in_progress.view",
        "supply.management.view",
        "analysis.supply.view"
    ]'::jsonb,
    TRUE
),
(
    '00000000-0000-0000-0000-000000000012',
    'ugrai_manager',
    'UGRAI Manager',
    'Access to UGRAI-related sections only',
    '[
        "ugrai.base_file.view",
        "ugrai.total.view",
        "ugrai.issue.view",
        "ugrai.in_progress.view",
        "ugrai.management.view",
        "analysis.ugrai.view"
    ]'::jsonb,
    TRUE
),
(
    '00000000-0000-0000-0000-000000000013',
    'accountant',
    'Accountant',
    'Financial, reporting and cash receipt management',
    '[
        "analysis.supply.view",
        "analysis.ugrai.view",
        "analysis.purchase.view",
        "analysis.pending_bills.view",
        "cash_receipts.view",
        "cash_receipts.manage"
    ]'::jsonb,
    TRUE
),
(
    '00000000-0000-0000-0000-000000000014',
    'viewer',
    'Viewer',
    'Read-only access to basic sections',
    '[
        "supply.in_progress.view",
        "ugrai.in_progress.view"
    ]'::jsonb,
    TRUE
)
ON CONFLICT (name) DO UPDATE SET
    permissions = EXCLUDED.permissions,
    description = EXCLUDED.description;
