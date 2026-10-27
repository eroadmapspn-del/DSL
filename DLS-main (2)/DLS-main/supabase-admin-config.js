// Admin configuration for user management
// WARNING: This should only be used server-side or in secure admin environments
// NEVER expose service role key in production client-side code

const SUPABASE_ADMIN_CONFIG = {
    url: 'YOUR_SUPABASE_URL',
    // This should be your service role key (anon key won't work for admin functions)
    serviceRoleKey: 'YOUR_SERVICE_ROLE_KEY'
};

// Create admin client for user management
const createAdminClient = () => {
    return supabase.createClient(
        SUPABASE_ADMIN_CONFIG.url,
        SUPABASE_ADMIN_CONFIG.serviceRoleKey,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storage: window.localStorage,
                flowType: 'pkce'
            }
        }
    );
};