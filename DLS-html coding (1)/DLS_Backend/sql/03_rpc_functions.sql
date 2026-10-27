-- ============================================================================
-- SQL Functions matching all RPC calls
-- ============================================================================

-- 1. Get user permissions
CREATE OR REPLACE FUNCTION get_user_permissions(user_uuid UUID DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    target_uid UUID;
    result JSONB;
BEGIN
    target_uid := COALESCE(user_uuid, auth.uid());
    
    SELECT COALESCE(jsonb_agg(DISTINCT perm), '[]'::jsonb)
    INTO result
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    CROSS JOIN LATERAL jsonb_array_elements_text(r.permissions) AS perm
    WHERE ur.user_id = target_uid;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Get user roles with details
CREATE OR REPLACE FUNCTION get_user_roles_with_details(user_uuid UUID DEFAULT NULL)
RETURNS TABLE (
    user_id UUID,
    role_id UUID,
    role_name VARCHAR,
    role_display_name VARCHAR,
    role_description TEXT,
    assigned_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    target_uid UUID;
BEGIN
    target_uid := COALESCE(user_uuid, auth.uid());
    
    RETURN QUERY
    SELECT 
        ur.user_id,
        r.id AS role_id,
        r.name AS role_name,
        r.display_name AS role_display_name,
        r.description AS role_description,
        ur.assigned_at
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = target_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Get all users with roles
CREATE OR REPLACE FUNCTION get_all_users_with_roles()
RETURNS TABLE (
    id UUID,
    user_id UUID,
    email VARCHAR,
    full_name VARCHAR,
    department VARCHAR,
    is_active BOOLEAN,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE,
    role_name VARCHAR,
    roles TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        up.id,
        up.user_id,
        up.email,
        up.full_name,
        up.department,
        up.is_active,
        up.last_login,
        up.created_at,
        COALESCE((ARRAY_AGG(r.name))[1], 'viewer')::VARCHAR AS role_name,
        ARRAY_AGG(DISTINCT r.name)::TEXT[] AS roles
    FROM user_profiles up
    LEFT JOIN user_roles ur ON up.user_id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    GROUP BY up.id, up.user_id, up.email, up.full_name, up.department, up.is_active, up.last_login, up.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Get dashboard stats
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSONB AS $$
DECLARE
    tot_users INT;
    act_users INT;
    tot_roles INT;
    adm_users INT;
    act_supplies INT;
    pend_ugrai INT;
    pend_cash INT;
BEGIN
    SELECT COUNT(*) INTO tot_users FROM user_profiles;
    SELECT COUNT(*) INTO act_users FROM user_profiles WHERE is_active = TRUE;
    SELECT COUNT(*) INTO tot_roles FROM roles;
    SELECT COUNT(DISTINCT ur.user_id) INTO adm_users 
    FROM user_roles ur 
    JOIN roles r ON ur.role_id = r.id 
    WHERE r.name = 'admin';

    SELECT COUNT(*) INTO act_supplies FROM active_supplies;
    SELECT COUNT(*) INTO pend_ugrai FROM ugrai_data WHERE status = 'Pending';
    SELECT COUNT(*) INTO pend_cash FROM cash_receipts WHERE status = 'pending';

    RETURN jsonb_build_object(
        'total_users', tot_users,
        'active_users', act_users,
        'total_roles', tot_roles,
        'admin_users', adm_users,
        'active_supplies', act_supplies,
        'pending_ugrai', pend_ugrai,
        'pending_cash_receipts', pend_cash
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
