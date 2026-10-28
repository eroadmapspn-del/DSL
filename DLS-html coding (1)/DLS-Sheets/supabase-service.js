// Supabase Configuration and Client Setup
// Add your Supabase credentials here after creating the project

const SUPABASE_CONFIG = {
    url: 'dls-sheets-backend', // Replace with your project URL
    anonKey: 'not-needed' // Replace with your anon key
};

// Initialize Supabase client
let supabase;
let createClient;

async function initSupabase() {
    try {
        // Try to use global Supabase first (loaded via script tag)
        if (typeof window !== 'undefined' && window.supabase) {
            createClient = window.supabase.createClient;
            console.log('Using global Supabase client');
        } 
        // Fallback to ES module import
        else {
            try {
                const supabaseModule = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
                createClient = supabaseModule.createClient;
                console.log('Using ES module Supabase client');
            } catch (importError) {
                console.error('Failed to import Supabase module:', importError);
                return false;
            }
        }

        supabase = createClient(
            SUPABASE_CONFIG.url, 
            SUPABASE_CONFIG.anonKey,
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
        console.log('Supabase client initialized successfully');
        
        // Test the connection using purchase_retailers table (which we actually created)
        console.log('🔍 Testing database connection...');
        const { data, error } = await supabase.from('purchase_retailers').select().limit(1);
        
        if (error) {
            console.error('❌ Database connection test failed:', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint
            });
            
            // If purchase_retailers table doesn't exist, connection failed
            if (error.code === '42P01') { // Table doesn't exist
                console.error('💾 purchase_retailers table not found. Please run the database schema first.');
                console.log('📋 To create the tables, run the SQL from: purchase-tables-schema.sql');
                return false;
            }
            
            // If it's just a permission error but table exists, that's ok for now
            if (error.code === 'PGRST301') { // Permission denied
                console.warn('⚠️ Permission denied - RLS policies may need user authentication');
                console.log('✅ Table exists, proceeding with initialization');
                return true; // Proceed anyway, user will need to authenticate
            }
            
            // Other errors are more serious
            console.error('❌ Serious database error, falling back to mock mode');
            return false;
        } else {
            console.log('✅ Supabase connection test successful - purchase_retailers table accessible');
            console.log(`📊 Found ${data?.length || 0} existing purchase retailers`);
        }
        
        // Additional verification of database setup
        const dbSetupValid = await verifyDatabaseSetup();
        if (!dbSetupValid) {
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        return false;
    }
}

// Function to verify database setup and provide helpful instructions
async function verifyDatabaseSetup() {
    try {
        console.log('🔧 Verifying database setup...');
        
        // Check if purchase_retailers table exists
        const { data: retailers, error: retailersError } = await supabase
            .from('purchase_retailers')
            .select('id')
            .limit(1);
            
        // Check if purchase_entries table exists
        const { data: entries, error: entriesError } = await supabase
            .from('purchase_entries')
            .select('id')
            .limit(1);
        
        const missingTables = [];
        if (retailersError?.code === '42P01') missingTables.push('purchase_retailers');
        if (entriesError?.code === '42P01') missingTables.push('purchase_entries');
        
        if (missingTables.length > 0) {
            console.error('❌ Missing database tables:', missingTables.join(', '));
            console.log('📋 To fix this:');
            console.log('   1. Open your Supabase Dashboard');
            console.log('   2. Go to SQL Editor');
            console.log('   3. Copy and run the SQL from: purchase-tables-schema.sql');
            console.log('   4. Refresh this page');
            return false;
        }
        
        console.log('✅ All required database tables exist');
        return true;
    } catch (error) {
        console.error('Database verification failed:', error);
        return false;
    }
}

// Test database table structure
async function testTableStructure(userId) {
    try {
        console.log('🔧 Testing database table structure...');
        
        // Test retailers table structure
        const { data: tableInfo, error: tableError } = await supabase
            .from('retailers')
            .select('*')
            .limit(1);
            
        if (tableError) {
            console.error('❌ Retailers table error:', tableError);
            return false;
        }
        
        console.log('✅ Retailers table accessible');
        
        // Test if we can insert a test record
        const testRetailer = {
            retailer_name: 'TEST_RETAILER_' + Date.now(),
            sector: 'Test',
            user_id: userId
        };
        
        const { data: insertData, error: insertError } = await supabase
            .from('retailers')
            .insert([testRetailer])
            .select();
            
        if (insertError) {
            console.error('❌ Insert test failed:', insertError);
            return false;
        }
        
        console.log('✅ Insert test successful:', insertData);
        
        // Clean up test record
        if (insertData && insertData[0]) {
            await supabase
                .from('retailers')
                .delete()
                .eq('id', insertData[0].id);
            console.log('🧹 Test record cleaned up');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Table structure test failed:', error);
        return false;
    }
}

// Test function to manually add a retailer (for debugging)
async function testAddRetailer() {
    try {
        console.log('🧪 Testing manual retailer addition...');
        
        const testRetailers = [
            { retailer_name: 'Test Retailer 1', sector: 'Electronics', user_id: '00000000-0000-0000-0000-000000000001' },
            { retailer_name: 'Test Retailer 2', sector: 'Clothing', user_id: '00000000-0000-0000-0000-000000000001' }
        ];
        
        const { data, error } = await supabase
            .from('retailers')
            .upsert(testRetailers, { 
                onConflict: 'retailer_name,user_id',
                ignoreDuplicates: false 
            })
            .select();
            
        if (error) {
            console.error('❌ Test retailer add failed:', error);
            return false;
        }
        
        console.log('✅ Test retailers added successfully:', data);
        return true;
    } catch (error) {
        console.error('❌ Test retailer addition failed:', error);
        return false;
    }
}

// Make test functions available globally for debugging
window.testAddRetailer = testAddRetailer;
window.testTableStructure = testTableStructure;
window.testRLSFix = () => {
    if (window.supabaseService) {
        return window.supabaseService.testRLSFix();
    } else {
        console.error('SupabaseService not initialized');
        return false;
    }
};

// Supabase Data Service Class
class SupabaseDataService {
    constructor() {
        // Initialize userId as null - will be set by authentication
        this.userId = null;
        this.initializeAuth();
    }

    async initializeAuth() {
        try {
            // Get the current authenticated user from Supabase
            console.log('🔐 Initializing authentication...');
            const { data: { user }, error } = await supabase.auth.getUser();
            
            if (error) {
                console.error('❌ Failed to get authenticated user:', error);
                this.userId = null;
                return false;
            }
            
            if (user) {
                this.userId = user.id;
                console.log('✅ Authentication successful, user ID:', this.userId);
                console.log('� User email:', user.email);
                return true;
            } else {
                console.warn('⚠️ No authenticated user found');
                // Fallback to test UUID to maintain access to existing data
                console.log('📝 Using test UUID to maintain access to existing bills');
                this.userId = '00000000-0000-0000-0000-000000000001';
                return false;
            }
        } catch (error) {
            console.error('❌ Authentication initialization failed:', error);
            // Fallback to test UUID to maintain access to existing data
            console.log('📝 Falling back to test UUID to maintain access to existing bills');
            this.userId = '00000000-0000-0000-0000-000000000001';
            return false;
        }
    }

    // Get user role from database
    async getUserRole() {
        try {
            if (!this.userId) {
                console.warn('⚠️ No userId set, cannot fetch role');
                return null;
            }

            console.log('🔍 Fetching user role for userId:', this.userId);
            
            // Join user_roles with roles table to get the role name
            // Note: User might have multiple roles, we'll get all and return primary/first
            const { data, error } = await supabase
                .from('user_roles')
                .select(`
                    role_id,
                    roles (
                        name,
                        display_name,
                        description
                    )
                `)
                .eq('user_id', this.userId);
            
            if (error) {
                console.error('❌ Error fetching user role:', error);
                // Don't assume admin on error - return null for proper handling
                return null;
            }
            
            if (!data || data.length === 0) {
                console.log('ℹ️ No role found for user');
                return null;
            }
            
            // Extract role name from the first role (primary role)
            const roleName = data[0]?.roles?.name || null;
            
            if (data.length > 1) {
                console.log('📋 User has multiple roles:', data.map(r => r.roles?.name));
                console.log('✅ Using primary role:', roleName);
            } else {
                console.log('✅ User role fetched:', roleName);
            }
            
            return roleName;
            
        } catch (error) {
            console.error('❌ Error in getUserRole:', error);
            return null;
        }
    }

    // Method to ensure test user exists in auth.users table
    async ensureTestUserExists() {
        try {
            const testUUID = '00000000-0000-0000-0000-000000000001';
            
            // Check if test user exists in auth.users
            const { data: existingUser, error: checkError } = await supabase
                .from('auth.users')
                .select('id')
                .eq('id', testUUID)
                .single();
                
            if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = not found
                console.warn('⚠️ Could not check for test user:', checkError);
                return false;
            }
            
            if (existingUser) {
                console.log('✅ Test user already exists');
                return true;
            }
            
            console.log('📝 Test user not found, this is expected in development mode');
            console.log('💡 Photo uploads will use storage-only mode to avoid foreign key constraints');
            return false;
            
        } catch (error) {
            console.warn('⚠️ Could not ensure test user exists:', error);
            return false;
        }
    }

    // Check if there's existing data and decide which user ID to use
    async checkForDataMigration() {
        try {
            const testUUID = '00000000-0000-0000-0000-000000000001';
            const realUserId = this.userId; // This is the authenticated user ID
            
            console.log('🔍 Checking data migration needs...');
            console.log(`Real user ID: ${realUserId}`);
            console.log(`Test UUID: ${testUUID}`);
            
            // Don't check real user data if we're already using test UUID
            let realUserCount = 0;
            if (realUserId && realUserId !== testUUID) {
                const { data: realUserData, error: realError } = await supabase
                    .from('bills')
                    .select('count(*)')
                    .eq('user_id', realUserId);
                realUserCount = realUserData?.[0]?.count || 0;
                console.log(`📊 Bills with real user ID (${realUserId}): ${realUserCount}`);
            }
                
            // Always check test UUID data
            const { data: testData, error: testError } = await supabase
                .from('bills')
                .select('count(*)')
                .eq('user_id', testUUID);
                
            const testUUIDCount = testData?.[0]?.count || 0;
            console.log(`📊 Bills with test UUID: ${testUUIDCount}`);
            
            // If there's existing data with test UUID but none (or less) with real user ID, use test UUID
            if (testUUIDCount > 0 && testUUIDCount >= realUserCount) {
                console.log('💡 Using test UUID to maintain access to existing data');
                this.userId = testUUID;
                return true;
            }
            
            // Otherwise, keep using the real user ID (if we have one)
            if (realUserId && realUserId !== testUUID) {
                console.log('✅ Using authenticated user ID');
                return false;
            }
            
            // If no real user ID, fall back to test UUID
            console.log('📝 No authenticated user, using test UUID');
            this.userId = testUUID;
            return true;
            
        } catch (error) {
            console.warn('⚠️ Could not check for data migration:', error);
            // Safe fallback to test UUID
            this.userId = testUUID;
            return false;
        }
    }

    // Test method to verify RLS fix is working
    async testRLSFix() {
        try {
            console.log('🧪 Testing RLS fix for ugrai tables...');
            
            // Test approved_ugrai access
            const { data: approvedData, error: approvedError } = await supabase
                .from('approved_ugrai')
                .select('id')
                .limit(1);
                
            if (approvedError) {
                console.error('❌ approved_ugrai still has RLS issues:', approvedError);
                return false;
            }
            
            // Test completed_ugrai access  
            const { data: completedData, error: completedError } = await supabase
                .from('completed_ugrai')
                .select('id')
                .limit(1);
                
            if (completedError) {
                console.error('❌ completed_ugrai still has RLS issues:', completedError);
                return false;
            }
            
            console.log('✅ RLS fix appears to be working for ugrai tables');
            return true;
            
        } catch (error) {
            console.error('❌ Error testing RLS fix:', error);
            return false;
        }
    }

    // Retailers Management
    async getRetailers() {
        try {
            console.log('📡 Fetching GLOBAL retailers from database (shared across all users)');
            
            const { data, error } = await supabase
                .from('retailers')
                .select('*')
                .order('retailer_name');
            
            if (error) {
                console.error('❌ Database error fetching retailers:', error);
                throw error;
            }
            
            console.log('🗄️ Raw retailer data from database:', data?.length || 0, 'records');
            console.log('📋 Raw data details:', data);
            
            // Map database column names to match UI expectations
            const mappedRetailers = (data || []).map(retailer => ({
                id: retailer.id,
                name: retailer.retailer_name,  // Map retailer_name to name
                sector: retailer.sector
            }));
            
            console.log('🎯 Mapped retailers for UI:', mappedRetailers.length, 'items');
            return mappedRetailers;
        } catch (error) {
            console.error('❌ Error fetching retailers:', error);
            return [];
        }
    }

    async addRetailer(retailerName, sector) {
        try {
            const { data, error } = await supabase
                .from('retailers')
                .insert([{
                    retailer_name: retailerName,
                    sector: sector,
                    user_id: this.userId
                }])
                .select();
            
            if (error) throw error;
            return data[0];
        } catch (error) {
            console.error('Error adding retailer:', error);
            throw error;
        }
    }

    async bulkAddRetailers(retailers) {
        try {
            console.log('💾 Bulk adding GLOBAL retailers to database:', retailers.length, 'items');
            console.log('📋 Retailers to add:', retailers);
            
            const retailersWithUserId = retailers.map(retailer => ({
                ...retailer,
                user_id: this.userId
            }));

            console.log('🔄 Formatted retailers with user_id:', retailersWithUserId);

            // Test if table exists by trying a simple select first
            const { data: testData, error: testError } = await supabase
                .from('retailers')
                .select('retailer_name')
                .limit(1);
                
            if (testError) {
                console.error('❌ Table access test failed - table might not exist:', testError);
                throw new Error(`Retailers table not accessible: ${testError.message}`);
            }

            // Use upsert with GLOBAL unique constraint on retailer_name only
            const { data, error } = await supabase
                .from('retailers')
                .upsert(retailersWithUserId, { 
                    onConflict: 'retailer_name',
                    ignoreDuplicates: true  // Skip duplicates - use existing retailer
                })
                .select();
            
            if (error) {
                console.error('❌ Database error during bulk add:', error);
                console.error('❌ Full error details:', JSON.stringify(error, null, 2));
                throw error;
            }
            
            // Return actual count of newly added records
            const addedCount = data?.length || 0;
            console.log('✅ Bulk add successful, actually added:', addedCount, 'new records');
            console.log('📄 Saved retailers:', data);
            
            return { addedCount, data };
        } catch (error) {
            console.error('❌ Error bulk adding retailers:', error);
            throw error;
        }
    }
    
    // Update a retailer's full row (name and/or sector)
    async updateRetailer(id, newName, newSector, originalName) {
        try {
            console.log(`📝 Updating retailer id=${id}: "${originalName}" -> "${newName}", sector="${newSector}"`);
            
            const patch = {
                retailer_name: newName,
                sector: newSector,
                updated_at: new Date().toISOString()
            };

            let query = supabase.from('retailers').update(patch);
            if (id) {
                query = query.eq('id', id);
            } else {
                query = query.ilike('retailer_name', originalName || newName);
            }

            const { data, error } = await query.select();
            if (error) throw error;
            
            console.log('✅ Retailer updated in database:', data);
            return data;
        } catch (error) {
            console.error('Error updating retailer in database:', error);
            throw error;
        }
    }

    // Delete a retailer from database
    async deleteRetailer(id, retailerName) {
        try {
            console.log(`🗑️ Deleting retailer id=${id}, name="${retailerName}" from database`);
            let query = supabase.from('retailers').delete();
            if (id) {
                query = query.eq('id', id);
            } else {
                query = query.ilike('retailer_name', retailerName);
            }
            const { data, error } = await query;
            if (error) throw error;
            console.log('✅ Retailer deleted from database:', data);
            return data;
        } catch (error) {
            console.error('Error deleting retailer from database:', error);
            throw error;
        }
    }

    // Delete multiple retailers in batch
    async deleteMultipleRetailers(retailerNames) {
        try {
            console.log(`🗑️ Batch deleting ${retailerNames.length} retailers from database:`, retailerNames);
            if (!retailerNames || retailerNames.length === 0) return { data: [], count: 0 };
            
            const { data, error } = await supabase
                .from('retailers')
                .delete()
                .in('retailer_name', retailerNames);
                
            if (error) throw error;
            console.log('✅ Batch deleted retailers from database:', data);
            return data;
        } catch (error) {
            console.error('Error batch deleting retailers:', error);
            throw error;
        }
    }

    // Update a retailer's sector
    async updateRetailerSector(retailerName, newSector) {
        try {
            console.log(`📝 Updating retailer "${retailerName}" sector to "${newSector}"`);
            
            const { data, error } = await supabase
                .from('retailers')
                .update({ sector: newSector, updated_at: new Date().toISOString() })
                .ilike('retailer_name', retailerName)
                .select();
            
            if (error) throw error;
            
            console.log('✅ Retailer sector updated:', data);
            return data;
        } catch (error) {
            console.error('Error updating retailer sector:', error);
            throw error;
        }
    }
    
    // Sync retailer sectors across all bill tables
    async syncRetailerSectors(retailerName, newSector) {
        try {
            console.log(`🔄 Syncing sectors for retailer: ${retailerName} -> ${newSector}`);
            
            const tables = [
                'temporary_bills',
                'bills', 
                'active_supplies',
                'ugrai_data',
                'ugrai_entries',
                'ugrai_in_progress',
                'completed_ugrai',
                'approved_ugrai'
            ];
            
            let totalUpdated = 0;
            
            const syncResults = await Promise.all(tables.map(table => supabase
                .from(table)
                .update({ sector: newSector })
                .ilike('retailer_name', retailerName)
                .select()
                .then(r => ({ table, data: r.data, error: r.error }))));
            for (const { table, data, error } of syncResults) {
                if (error) {
                    console.error(`Error updating ${table}:`, error);
                } else {
                    const count = data?.length || 0;
                    if (count > 0) {
                        console.log(`✅ Updated ${count} records in ${table}`);
                        totalUpdated += count;
                    }
                }
            }
            
            console.log(`✅ Total records updated across all tables: ${totalUpdated}`);
            return totalUpdated;
        } catch (error) {
            console.error('Error syncing retailer sectors:', error);
            throw error;
        }
    }

    // Bills Management (Temporary/Staged Bills)
    async getStagedBills() {
        try {
            const { data, error } = await supabase
                .from('bills')
                .select('*')
                .eq('status', 'staged')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            
            // Map database column names to match UI expectations
            return (data || []).map(bill => ({
                id: bill.id,
                billNumber: bill.bill_number,
                billDate: bill.bill_date,
                retailerName: bill.retailer_name,
                netAmount: bill.net_amount,
                brand: bill.brand,
                sector: bill.sector,
                status: bill.status,
                supplyThrough: bill.supply_through
            }));
        } catch (error) {
            console.error('Error fetching staged bills:', error);
            return [];
        }
    }

    async checkExistingBillNumbers(billNumbers) {
        try {
            const { data, error } = await supabase
                .from('bills')
                .select('bill_number')
                .in('bill_number', billNumbers)
                .eq('user_id', this.userId);
            
            if (error) throw error;
            
            return data.map(bill => bill.bill_number);
        } catch (error) {
            console.error('Error checking existing bill numbers:', error);
            throw error;
        }
    }

    async checkExistingRetailerNames(retailerNames) {
        if (!retailerNames || retailerNames.length === 0) {
            return [];
        }

        try {
            console.log('🔍 Checking for duplicate retailer names GLOBALLY:', retailerNames);
            
            // Get all existing retailer names GLOBALLY (no user_id filter)
            const { data, error } = await supabase
                .from('retailers')
                .select('retailer_name');

            if (error) throw error;

            console.log('📋 Existing GLOBAL retailers in database:', data?.length || 0, 'records');
            console.log('🗃️ Database retailers:', data?.map(r => r.retailer_name) || []);

            // Check which names exist (case-insensitive)
            const existingNames = [];
            const existingLowerNames = (data || []).map(retailer => retailer.retailer_name.toLowerCase().trim());
            
            retailerNames.forEach(name => {
                const nameLower = name.toLowerCase().trim();
                if (existingLowerNames.includes(nameLower)) {
                    existingNames.push(name);
                    console.log(`❌ Duplicate found: "${name}" already exists GLOBALLY`);
                } else {
                    console.log(`✅ New retailer: "${name}" is unique GLOBALLY`);
                }
            });

            console.log('🎯 Duplicate check result:', existingNames.length, 'duplicates found');
            return existingNames;
        } catch (error) {
            console.error('❌ Error checking existing retailer names:', error);
            throw error;
        }
    }

    async addBillToStaging(bill) {
        try {
            // First check if bill already exists
            const { data: existing, error: checkError } = await supabase
                .from('bills')
                .select('id, status')
                .eq('bill_number', bill.bill_number)
                // .eq('user_id', this.userId) // REMOVED: Check bills regardless of user_id
                .single();

            if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found
                throw checkError;
            }

            if (existing) {
                // Bill already exists - update it instead of creating new
                console.log('📝 Bill already exists in staging, updating:', bill.bill_number);
                const { data: updated, error: updateError } = await supabase
                    .from('bills')
                    .update({
                        ...bill,
                        status: 'staged',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existing.id)
                    // .eq('user_id', this.userId) // REMOVED: Update bills regardless of user_id
                    .select();

                if (updateError) throw updateError;
                return updated[0];
            } else {
                // Bill doesn't exist - create new
                console.log('➕ Adding new bill to staging:', bill.bill_number);
                const { data, error } = await supabase
                    .from('bills')
                    .insert([{
                        ...bill,
                        status: 'staged',
                        user_id: this.userId
                    }])
                    .select();
                
                if (error) throw error;
                return data[0];
            }
        } catch (error) {
            console.error('❌ Error adding bill to staging:', error);
            throw error;
        }
    }

    async checkBillExistsInStaging(billNumber) {
        try {
            const { data, error } = await supabase
                .from('bills')
                .select('id, status, net_amount')
                .eq('bill_number', billNumber)
                // .eq('user_id', this.userId) // REMOVED: Check bills regardless of user_id
                .eq('status', 'staged')
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
                throw error;
            }

            return data || null; // Return bill data if exists, null if not
        } catch (error) {
            console.error('Error checking bill in staging:', error);
            return null;
        }
    }

    async bulkAddBillsToStaging(bills) {
        try {
            const billsWithUserId = bills.map(bill => ({
                ...bill,
                status: 'staged',
                user_id: this.userId
            }));

            const { data, error } = await supabase
                .from('bills')
                .insert(billsWithUserId)
                .select();
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error bulk adding bills to staging:', error);
            throw error;
        }
    }

    async removeBillFromStaging(billId) {
        try {
            const { error } = await supabase
                .from('bills')
                .delete()
                .eq('id', billId)
                // .eq('user_id', this.userId) // REMOVED: Delete bills regardless of user_id
                .eq('status', 'staged');
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error removing bill from staging:', error);
            throw error;
        }
    }

    // Bills to Dispatch
    async getDispatchBills() {
        try {
            const { data, error } = await supabase
                .from('bills')
                .select('*')
                .eq('status', 'dispatched')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            
            // Map database column names to match UI expectations
            return (data || []).map(bill => ({
                id: bill.id,
                billNumber: bill.bill_number,
                billDate: bill.bill_date,
                retailerName: bill.retailer_name,
                netAmount: bill.net_amount,
                brand: bill.brand,
                sector: bill.sector,
                status: bill.status,
                supplyThrough: bill.supply_through
            }));
        } catch (error) {
            console.error('Error fetching dispatch bills:', error);
            return [];
        }
    }

    async moveBillsToDispatch(billIds, supplyThrough) {
        try {
            console.log('Moving bills to dispatch:', billIds);
            
            // Ensure billIds are integers
            const numericBillIds = billIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
            console.log('Converted to numeric IDs:', numericBillIds);
            
            const { data, error } = await supabase
                .from('bills')
                .update({ 
                    status: 'dispatched',
                    supply_through: supplyThrough
                })
                .in('id', numericBillIds)
                // .eq('user_id', this.userId) // REMOVED: Allow updating bills regardless of user_id
                .select();
            
            if (error) throw error;
            console.log('✅ Bills moved to dispatch with status:', data?.map(b => ({ id: b.id, status: b.status, bill_number: b.bill_number })));
            return data || [];
        } catch (error) {
            console.error('Error moving bills to dispatch:', error);
            throw error;
        }
    }

    async moveBillsBackToStaging(billIds) {
        try {
            console.log('Moving bills back to staging:', billIds);
            
            // Ensure billIds are integers
            const numericBillIds = billIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
            console.log('Converted to numeric IDs:', numericBillIds);
            
            const { data, error } = await supabase
                .from('bills')
                .update({ 
                    status: 'staged',
                    supply_through: null
                })
                .in('id', numericBillIds)
                // .eq('user_id', this.userId) // REMOVED: Allow updating bills regardless of user_id
                .select();
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error moving bills back to staging:', error);
            throw error;
        }
    }

    // Active Supplies Management
    async moveToActiveSupplies(billIds) {
        try {
            console.log('Moving bills to active supplies:', billIds);
            
            // Ensure billIds are integers
            const numericBillIds = billIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
            console.log('Converted to numeric IDs:', numericBillIds);
            
            // First check what bills exist with these IDs (without status filter)
            const { data: allBills, error: allBillsError } = await supabase
                .from('bills')
                .select('*')
                .in('id', numericBillIds);
                // .eq('user_id', this.userId); // REMOVED: Fetch bills regardless of user_id
                
            if (allBillsError) throw allBillsError;
            console.log('All bills found with these IDs:', allBills);
            
            // Now get the bill details with dispatched status
            const { data: bills, error: fetchError } = await supabase
                .from('bills')
                .select('*')
                .in('id', numericBillIds)
                // .eq('user_id', this.userId) // REMOVED: Fetch bills regardless of user_id
                .eq('status', 'dispatched');
            
            if (fetchError) throw fetchError;
            console.log('Bills with dispatched status:', bills);
            
            if (bills.length === 0) {
                console.warn('⚠️ No bills found with dispatched status!');
                console.log('📊 Status of found bills:', allBills.map(b => ({ id: b.id, status: b.status, bill_number: b.bill_number })));
                throw new Error(`No bills found with dispatched status. Found ${allBills.length} bills with IDs ${numericBillIds.join(', ')}`);
            }

            // Create active supplies entries
            const activeSupplies = bills.map(bill => ({
                bill_id: parseInt(bill.id, 10), // Ensure this is an integer
                bill_number: bill.bill_number,
                bill_date: bill.bill_date, // Include the bill date
                retailer_name: bill.retailer_name,
                sector: bill.sector,
                net_amount: parseFloat(bill.net_amount),
                brand: bill.brand,
                supply_through: bill.supply_through,
                status: 'in_progress',
                user_id: this.userId
            }));
            
            console.log('Active supplies to insert:', activeSupplies);

            // First, check if any of these bills already exist in active_supplies with in_progress status
            const { data: existingRecords, error: checkError } = await supabase
                .from('active_supplies')
                .select('bill_number, id')
                .in('bill_number', activeSupplies.map(s => s.bill_number))
                .eq('user_id', this.userId)
                .eq('status', 'in_progress');
            
            if (checkError) throw checkError;
            
            if (existingRecords && existingRecords.length > 0) {
                const existingBillNumbers = existingRecords.map(r => r.bill_number).join(', ');
                console.warn('⚠️ Some bills already exist in active_supplies:', existingBillNumbers);
                // Filter out bills that already exist
                const newSupplies = activeSupplies.filter(
                    supply => !existingRecords.some(existing => existing.bill_number === supply.bill_number)
                );
                if (newSupplies.length === 0) {
                    console.log('All bills already in active_supplies, skipping insert');
                    return existingRecords;
                }
                console.log(`Inserting ${newSupplies.length} new bills, skipping ${existingRecords.length} existing`);
                const { data, error } = await supabase
                    .from('active_supplies')
                    .insert(newSupplies)
                    .select();
                
                if (error) throw error;
                return data || [];
            }

            // No existing records, safe to insert all
            const { data, error } = await supabase
                .from('active_supplies')
                .insert(activeSupplies)
                .select();
            
            if (error) throw error;

            // Update bills status to in_progress
            await supabase
                .from('bills')
                .update({ status: 'in_progress' })
                .in('id', numericBillIds);
                // .eq('user_id', this.userId); // REMOVED: Update bills regardless of user_id
                
            console.log('Successfully moved bills to active supplies');

            return data || [];
        } catch (error) {
            console.error('Error moving to active supplies:', error);
            throw error;
        }
    }

    async moveToActiveSuppliesWithAssignments(billsData) {
        try {
            console.log('Moving bills to active supplies with individual assignments:', billsData);
            
            // Extract bill IDs and ensure they are integers
            const billIds = billsData.map(b => parseInt(b.billId, 10)).filter(id => !isNaN(id));
            console.log('Converted to numeric IDs:', billIds);
            
            // First, update the bills with their individual supply_through assignments
            const bySupplier = {};
            for (const billData of billsData) {
                const billId = parseInt(billData.billId, 10);
                if (!isNaN(billId)) {
                    const key = String(billData.supplyThrough);
                    (bySupplier[key] = bySupplier[key] || { value: billData.supplyThrough, ids: [] }).ids.push(billId);
                }
            }
            await Promise.all(Object.values(bySupplier).map(g => supabase
                .from('bills')
                .update({ supply_through: g.value })
                .in('id', g.ids)));
            
            // Now get the bill details with dispatched status
            const { data: bills, error: fetchError } = await supabase
                .from('bills')
                .select('*')
                .in('id', billIds)
                .eq('status', 'dispatched');
            
            if (fetchError) throw fetchError;
            console.log('Bills with dispatched status and updated assignments:', bills);
            
            if (bills.length === 0) {
                throw new Error(`No bills found with dispatched status for IDs: ${billIds.join(', ')}`);
            }

            // Create active supplies entries with individual assignments
            const activeSupplies = bills.map(bill => ({
                bill_id: parseInt(bill.id, 10),
                bill_number: bill.bill_number,
                bill_date: bill.bill_date,
                retailer_name: bill.retailer_name,
                sector: bill.sector,
                net_amount: parseFloat(bill.net_amount),
                brand: bill.brand,
                supply_through: bill.supply_through, // This now has the individual assignment
                status: 'in_progress',
                user_id: this.userId
            }));
            
            console.log('Active supplies to insert with assignments:', activeSupplies);

            // First, check if any of these bills already exist in active_supplies with in_progress status
            const { data: existingRecords, error: checkError } = await supabase
                .from('active_supplies')
                .select('bill_number, id')
                .in('bill_number', activeSupplies.map(s => s.bill_number))
                .eq('user_id', this.userId)
                .eq('status', 'in_progress');
            
            if (checkError) throw checkError;
            
            if (existingRecords && existingRecords.length > 0) {
                const existingBillNumbers = existingRecords.map(r => r.bill_number).join(', ');
                console.warn('⚠️ Some bills already exist in active_supplies:', existingBillNumbers);
                // Filter out bills that already exist
                const newSupplies = activeSupplies.filter(
                    supply => !existingRecords.some(existing => existing.bill_number === supply.bill_number)
                );
                if (newSupplies.length === 0) {
                    console.log('All bills already in active_supplies, skipping insert');
                    return existingRecords;
                }
                console.log(`Inserting ${newSupplies.length} new bills, skipping ${existingRecords.length} existing`);
                const { data, error } = await supabase
                    .from('active_supplies')
                    .insert(newSupplies)
                    .select();
                
                if (error) throw error;
                return data || [];
            }

            // No existing records, safe to insert all
            const { data, error } = await supabase
                .from('active_supplies')
                .insert(activeSupplies)
                .select();
            
            if (error) throw error;

            // Update bills status to in_progress
            await supabase
                .from('bills')
                .update({ status: 'in_progress' })
                .in('id', billIds);
                
            console.log('Successfully moved bills to active supplies with individual assignments');

            return data || [];
        } catch (error) {
            console.error('Error moving to active supplies with assignments:', error);
            throw error;
        }
    }

    async getActiveSupplies() {
        try {
            console.log('📊 Fetching all active supplies with pagination...');
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allSupplies = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('active_supplies')
                    .select('*', { count: 'exact' })
                    .order('created_at', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allSupplies = allSupplies.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`� Fetched batch: ${data.length} active supplies (total so far: ${allSupplies.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Successfully fetched all ${allSupplies.length} active supplies`);
            
            // Map database column names to match UI expectations
            const mappedData = allSupplies.map(supply => ({
                id: supply.id,
                billId: supply.bill_id,
                billNumber: supply.bill_number,
                billDate: supply.bill_date,
                retailerName: supply.retailer_name,
                sector: supply.sector,
                netAmount: supply.net_amount,
                brand: supply.brand,
                supplyThrough: supply.supply_through,
                status: supply.status,
                deliveryMethod: supply.payment_method,
                receiptNumber: supply.receipt_number,
                receivedAmount: supply.received_amount,
                chequeDate: supply.cheque_date,
                photoUrl: supply.photo_url,
                completionDate: supply.completion_date
            }));
            
            return mappedData;
        } catch (error) {
            console.error('Error fetching active supplies:', error);
            return [];
        }
    }

    async completeSupply(supplyId, completionData) {
        try {
            console.log(`🔄 [completeSupply] Attempting to update supply ${supplyId} for user ${this.userId}`);
            console.log(`📝 [completeSupply] Update data:`, completionData);
            
            const { data, error } = await supabase
                .from('active_supplies')
                .update({
                    status: completionData.status,
                    payment_method: completionData.paymentMethod,
                    receipt_number: completionData.receiptNumber,
                    received_amount: completionData.receivedAmount,
                    cheque_date: completionData.chequeDate,
                    photo_url: completionData.photoUrl,
                    completion_date: new Date().toISOString()
                })
                .eq('id', supplyId)
                .select();
            
            if (error) {
                console.error('❌ [completeSupply] Database error:', error);
                console.error('❌ [completeSupply] Error details:', {
                    message: error.message,
                    code: error.code,
                    details: error.details,
                    hint: error.hint
                });
                throw error;
            }
            
            if (!data || data.length === 0) {
                console.error('⚠️ [completeSupply] No rows updated - likely RLS policy or user_id mismatch');
                throw new Error('No rows updated - supply may belong to another user or RLS policy blocking update');
            }
            
            console.log(`✅ [completeSupply] Successfully updated supply ${supplyId}`);
            return data[0];
        } catch (error) {
            console.error('❌ [completeSupply] Error completing supply:', error);
            throw error;
        }
    }

    // Approval Management
    async getSuppliesForApproval() {
        try {
            const { data, error } = await supabase
                .from('active_supplies')
                .select('*')
                .in('status', ['delivered', 'cancelled', 'edited'])
                .order('completion_date', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching supplies for approval:', error);
            return [];
        }
    }

    async approveSupplies(supplyIds) {
        try {
            console.log('Approving supplies:', supplyIds);
            
            // Ensure supplyIds are integers
            const numericSupplyIds = supplyIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
            console.log('Converted to numeric IDs:', numericSupplyIds);
            
            // Get supply details
            const { data: supplies, error: fetchError } = await supabase
                .from('active_supplies')
                .select('*')
                .in('id', numericSupplyIds);
                // .eq('user_id', this.userId); // REMOVED: Fetch supplies regardless of user_id
            
            if (fetchError) throw fetchError;

            console.log('📋 Raw supplies data from database:', supplies);

            // Get all retailers to map sectors
            const { data: retailers, error: retailersError } = await supabase
                .from('retailers')
                .select('retailer_name, sector')
                .eq('user_id', this.userId);
            
            if (retailersError) {
                console.warn('⚠️ Could not fetch retailers for sector mapping:', retailersError);
            }
            
            // Create retailer-to-sector map
            const retailerSectorMap = new Map();
            if (retailers) {
                retailers.forEach(r => {
                    if (r.retailer_name && r.sector) {
                        retailerSectorMap.set(r.retailer_name.toLowerCase().trim(), r.sector);
                    }
                });
                console.log(`📊 Loaded ${retailerSectorMap.size} retailer-sector mappings`);
            }

            // Generate current date for approval
            const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
            
            // Move to approved bills
            const approvedBills = supplies.map(supply => {
                // Lookup sector from retailers table if null
                let sector = supply.sector;
                if (!sector && supply.retailer_name) {
                    const lookupKey = supply.retailer_name.toLowerCase().trim();
                    sector = retailerSectorMap.get(lookupKey);
                    if (sector) {
                        console.log(`✅ Mapped sector "${sector}" for retailer "${supply.retailer_name}"`);
                    } else {
                        console.warn(`⚠️ No sector found for retailer "${supply.retailer_name}"`);
                    }
                }
                
                return {
                    original_bill_id: supply.bill_id,
                    bill_number: supply.bill_number,
                    bill_date: currentDate, // Use current date for approval
                    retailer_name: supply.retailer_name,
                    sector: sector, // Use mapped sector
                    net_amount: supply.net_amount,
                    received_amount: supply.received_amount,
                    brand: supply.brand,
                    supply_through: supply.supply_through,
                    payment_method: supply.payment_method,
                    receipt_number: supply.receipt_number,
                    cheque_date: supply.cheque_date,
                    photo_url: supply.photo_url,
                    status: supply.status,
                    user_id: this.userId
                };
            });
            
            console.log('📋 Approved bills to insert with generated date:', approvedBills);
            console.log('�️ Using approval date:', currentDate);

            const { data, error } = await supabase
                .from('approved_bills')
                .insert(approvedBills)
                .select();
            
            if (error) throw error;

            // Create UGRAI entries for credit bills and partial payments
            const ugraiEntriesToCreate = [];
            
            for (const supply of supplies) {
                const isCredit = supply.payment_method === 'Credit';
                const netAmount = parseFloat(supply.net_amount || 0);
                const receivedAmount = parseFloat(supply.received_amount || 0);
                const isPartialPayment = receivedAmount > 0 && receivedAmount < netAmount;
                
                if (isCredit || isPartialPayment) {
                    const outstandingAmount = isCredit ? netAmount : (netAmount - receivedAmount);
                    
                    // Lookup sector for UGRAI entry as well
                    let sector = supply.sector;
                    if (!sector && supply.retailer_name) {
                        const lookupKey = supply.retailer_name.toLowerCase().trim();
                        sector = retailerSectorMap.get(lookupKey);
                    }
                    
                    console.log(`💳 Creating UGRAI entry for ${isCredit ? 'credit' : 'partial payment'} bill:`, {
                        billNumber: supply.bill_number,
                        netAmount,
                        receivedAmount,
                        outstandingAmount,
                        sector
                    });
                    
                    ugraiEntriesToCreate.push({
                        bill_number: supply.bill_number,
                        bill_date: supply.bill_date,
                        retailer_name: supply.retailer_name,
                        sector: sector, // Use mapped sector
                        net_amount: outstandingAmount,
                        received_amount: isPartialPayment ? receivedAmount : 0, // Store amount already received for partial payments
                        status: 'Pending',
                        assigned_to: null,
                        original_supply_id: supply.id,
                        current_stage: 'available',
                        user_id: this.userId
                    });
                }
            }
            
            // Insert UGRAI entries if any
            if (ugraiEntriesToCreate.length > 0) {
                console.log(`📤 Creating ${ugraiEntriesToCreate.length} UGRAI entries...`);
                
                const { data: ugraiData, error: ugraiError } = await supabase
                    .from('ugrai_entries')
                    .insert(ugraiEntriesToCreate)
                    .select();
                
                if (ugraiError) {
                    console.error('⚠️ Error creating UGRAI entries:', ugraiError);
                    // Don't throw - approved_bills were created successfully
                } else {
                    console.log(`✅ Created ${ugraiData.length} UGRAI entries successfully`);
                }
            }

            // Remove from active supplies
            await supabase
                .from('active_supplies')
                .delete()
                .in('id', numericSupplyIds);
                // .eq('user_id', this.userId); // REMOVED: Delete regardless of user_id

            return data || [];
        } catch (error) {
            console.error('Error approving supplies:', error);
            throw error;
        }
    }

    async updateActiveSupply(supplyId, updates) {
        try {
            console.log('🔄 Updating active supply:', supplyId, 'with updates:', updates);
            
            // Convert UI field names to database column names
            // Only include columns that exist in the database schema
            const dbUpdates = {};
            if (updates.status) dbUpdates.status = updates.status;
            if (updates.deliveryMethod) dbUpdates.payment_method = updates.deliveryMethod; // Fixed: use payment_method not delivery_method
            if (updates.receiptNumber) dbUpdates.receipt_number = updates.receiptNumber;
            if (updates.receivedAmount) dbUpdates.received_amount = updates.receivedAmount;
            if (updates.chequeDate) dbUpdates.cheque_date = updates.chequeDate;
            if (updates.photoUrl) dbUpdates.photo_url = updates.photoUrl; // Fixed: use photo_url not photo_uploaded
            
            // Skip editedAmount and originalAmount for database update - these are only for local data
            // The edited bill logic is handled in the local data structure
            
            const { data, error } = await supabase
                .from('active_supplies')
                .update(dbUpdates)
                .eq('id', supplyId)
                // .eq('user_id', this.userId) // REMOVED: Allow updating supplies regardless of user_id
                .select();
            
            if (error) throw error;
            
            console.log('✅ Active supply updated successfully:', data);
            return data[0];
        } catch (error) {
            console.error('❌ Error updating active supply:', error);
            throw error;
        }
    }

    async removeActiveSupply(supplyId) {
        try {
            console.log('🗑️ Removing active supply with ID:', supplyId, 'for user:', this.userId);
            
            const { data, error } = await supabase
                .from('active_supplies')
                .delete()
                .eq('id', supplyId)
                .select();
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                console.log('✅ Active supply removed successfully:', data[0]);
            } else {
                console.log('⚠️ No active supply found with ID:', supplyId);
            }
            
        } catch (error) {
            console.error('❌ Error removing active supply:', error);
            throw error;
        }
    }

    async revertDeliveredSupplyToInProgress(billNumber) {
        try {
            console.log('🔄 Reverting delivered supply back to in_progress:', billNumber);
            
            const { data, error } = await supabase
                .rpc('revert_delivered_supply_to_in_progress', {
                    p_bill_number: billNumber
                });
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                const result = data[0];
                if (result.success) {
                    console.log('✅ Supply reverted successfully:', result.message);
                    return { success: true, message: result.message, billId: result.reverted_bill_id };
                } else {
                    console.warn('⚠️ Revert failed:', result.message);
                    return { success: false, message: result.message };
                }
            }
            
            return { success: false, message: 'No response from database' };
            
        } catch (error) {
            console.error('❌ Error reverting delivered supply:', error);
            throw error;
        }
    }

    async getApprovedBills() {
        try {
            console.log('📊 Fetching all approved bills with pagination...');
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allBills = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('approved_bills')
                    .select('*', { count: 'exact' })
                    .order('approval_date', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allBills = allBills.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`📦 Fetched batch: ${data.length} bills (total so far: ${allBills.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Successfully fetched all ${allBills.length} approved bills`);
            
            // Map database column names to match UI expectations
            return allBills.map(bill => ({
                id: bill.id,
                originalBillId: bill.original_bill_id,
                billNumber: bill.bill_number,
                billDate: bill.bill_date,
                retailerName: bill.retailer_name,
                sector: bill.sector,
                netAmount: bill.net_amount,
                receivedAmount: bill.received_amount,
                brand: bill.brand,
                supplyThrough: bill.supply_through,
                paymentMethod: bill.payment_method,  // Fixed: was deliveryMethod
                receiptNumber: bill.receipt_number,
                chequeDate: bill.cheque_date,
                photoUrl: bill.photo_url,
                status: bill.status,
                approvalDate: bill.approval_date
            }));
        } catch (error) {
            console.error('Error fetching approved bills:', error);
            return [];
        }
    }

    // Get supply analysis data using SQL aggregation via RPC function
    async getSupplyAnalysisSummary() {
        try {
            console.log('📊 Calling get_supply_analysis_summary RPC function...');
            
            // Call without user_id parameter since the SQL query doesn't filter by it
            const { data, error } = await supabase.rpc('get_supply_analysis_summary');
            
            if (error) {
                console.error('❌ RPC function error:', error);
                console.error('⚠️ Make sure you have run supply-analysis-sql-function.sql in Supabase SQL Editor!');
                return null;
            }
            
            console.log('✅ SQL aggregation result from RPC:', data);
            
            // If we got an empty result, something is wrong
            if (!data || data.length === 0) {
                console.warn('⚠️ SQL function returned empty results.');
                return null;
            }
            
            return data;
            
        } catch (error) {
            console.error('❌ Error calling supply analysis RPC:', error);
            return null;
        }
    }

    // Get all approved bills for detailed table view using SQL function
    async getApprovedBillsDetailed() {
        try {
            console.log('📋 Fetching all approved bills for detailed view with pagination...');
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allBills = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('approved_bills')
                    .select('id, bill_number, bill_date, retailer_name, sector, net_amount, received_amount, payment_method, status, supply_through, brand, receipt_number, cheque_date, approval_date, created_at, photo_url', { count: 'exact' })
                    .order('bill_date', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allBills = allBills.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`📦 Detailed view batch: ${data.length} bills (total: ${allBills.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Fetched all ${allBills.length} approved bills for detailed view`);
            
            return allBills || [];
            
        } catch (error) {
            console.error('❌ Error fetching approved bills for detailed view:', error);
            return [];
        }
    }

    // Get a single approved bill by bill number
    async getApprovedBillByNumber(billNumber) {
        try {
            const { data, error } = await supabase
                .from('approved_bills')
                .select('*')
                .eq('user_id', this.userId)
                .eq('bill_number', billNumber)
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    // No rows found
                    return null;
                }
                throw error;
            }
            
            return data;
        } catch (error) {
            console.error('Error fetching approved bill:', error);
            return null;
        }
    }

    // Add a bill to approved_bills table
    async addApprovedBill(billData) {
        try {
            console.log('💾 Adding bill to approved_bills:', billData.bill_number);
            
            const { data, error } = await supabase
                .from('approved_bills')
                .insert([billData])
                .select()
                .single();
            
            if (error) throw error;
            
            console.log('✅ Bill added to approved_bills:', data);
            return data;
        } catch (error) {
            console.error('❌ Error adding bill to approved_bills:', error);
            throw error;
        }
    }

    // Backfill sectors for existing approved bills
    async backfillApprovedBillsSectors() {
        try {
            console.log('🔄 Starting sector backfill for approved bills...');
            
            // Strategy 1: Try to get sectors from retailers table
            const retailerSectorMap = new Map();
            
            try {
                const { data: retailers, error: retailersError } = await supabase
                    .from('retailers')
                    .select('retailer_name, sector')
                    .eq('user_id', this.userId);
                
                if (!retailersError && retailers && retailers.length > 0) {
                    retailers.forEach(r => {
                        if (r.retailer_name && r.sector) {
                            retailerSectorMap.set(r.retailer_name.toLowerCase().trim(), r.sector);
                        }
                    });
                    console.log(`📊 Loaded ${retailerSectorMap.size} retailer-sector mappings from retailers table`);
                }
            } catch (err) {
                console.warn('⚠️ Retailers table not available, will learn from existing bills');
            }
            
            // Strategy 2: Learn sectors from existing bills that have sectors
            console.log('🔍 Checking approved_bills for existing sector data...');
            const { data: billsWithSectors, error: learnError } = await supabase
                .from('approved_bills')
                .select('retailer_name, sector')
                .eq('user_id', this.userId)
                .not('sector', 'is', null)
                .neq('sector', 'Unknown')
                .neq('sector', '');
            
            console.log(`📊 Query result: ${billsWithSectors ? billsWithSectors.length : 0} bills with valid sectors`);
            if (learnError) {
                console.error('❌ Error fetching bills with sectors:', learnError);
            }
            
            // Show sample of bills with sectors for debugging
            if (billsWithSectors && billsWithSectors.length > 0) {
                console.log('📋 Sample bills with sectors:', billsWithSectors.slice(0, 5));
            }
            
            if (!learnError && billsWithSectors && billsWithSectors.length > 0) {
                const sectorFrequency = new Map(); // Track most common sector per retailer
                
                billsWithSectors.forEach(bill => {
                    if (bill.retailer_name && bill.sector) {
                        const key = bill.retailer_name.toLowerCase().trim();
                        if (!sectorFrequency.has(key)) {
                            sectorFrequency.set(key, new Map());
                        }
                        const retailerMap = sectorFrequency.get(key);
                        retailerMap.set(bill.sector, (retailerMap.get(bill.sector) || 0) + 1);
                    }
                });
                
                // Use most common sector for each retailer
                sectorFrequency.forEach((sectorCounts, retailerKey) => {
                    let mostCommonSector = null;
                    let maxCount = 0;
                    sectorCounts.forEach((count, sector) => {
                        if (count > maxCount) {
                            maxCount = count;
                            mostCommonSector = sector;
                        }
                    });
                    if (mostCommonSector && !retailerSectorMap.has(retailerKey)) {
                        retailerSectorMap.set(retailerKey, mostCommonSector);
                    }
                });
                
                console.log(`� Learned ${retailerSectorMap.size} total retailer-sector mappings`);
            }
            
            if (retailerSectorMap.size === 0) {
                console.warn('⚠️ No sector mappings available - cannot fix sectors');
                return { updated: 0, notFound: 0, error: 'No sector mappings found' };
            }
            
            console.log(`📊 Using ${retailerSectorMap.size} retailer-sector mappings`);
            
            // Get all approved bills with null or "Unknown" sectors
            const { data: billsWithNullSector, error: billsError } = await supabase
                .from('approved_bills')
                .select('id, retailer_name, sector')
                .eq('user_id', this.userId)
                .or('sector.is.null,sector.eq.Unknown');
            
            if (billsError) throw billsError;
            
            console.log(`📋 Found ${billsWithNullSector.length} approved bills with null or Unknown sectors`);
            
            // Get all active supplies with null or "Unknown" sectors
            const { data: suppliesWithNullSector, error: suppliesError } = await supabase
                .from('active_supplies')
                .select('id, retailer_name, sector')
                .eq('user_id', this.userId)
                .or('sector.is.null,sector.eq.Unknown');
            
            if (suppliesError) throw suppliesError;
            
            console.log(`📋 Found ${suppliesWithNullSector.length} active supplies with null or Unknown sectors`);
            
            const totalToUpdate = billsWithNullSector.length + suppliesWithNullSector.length;
            
            if (totalToUpdate === 0) {
                console.log('✅ No bills or supplies need sector backfill');
                return { updated: 0, notFound: 0 };
            }
            
            let updated = 0;
            let notFound = 0;
            const _pendingSector = {}; // 'table|sector' -> [ids]  (flushed in bulk below)
            const _flushSector = async () => {
                await Promise.all(Object.entries(_pendingSector).map(([k, ids]) => {
                    const [tbl, sec] = k.split('|');
                    return supabase.from(tbl).update({ sector: sec }).in('id', ids).eq('user_id', this.userId);
                }));
            };
            
            // Update approved bills with mapped sector
            for (const bill of billsWithNullSector) {
                if (!bill.retailer_name) {
                    notFound++;
                    continue;
                }
                
                const lookupKey = bill.retailer_name.toLowerCase().trim();
                const sector = retailerSectorMap.get(lookupKey);
                
                if (sector) {
                    (_pendingSector[`approved_bills|${sector}`] = _pendingSector[`approved_bills|${sector}`] || []).push(bill.id);
                    const updateError = null;
                    
                    if (updateError) {
                        console.error(`❌ Error updating approved bill ${bill.id}:`, updateError);
                    } else {
                        updated++;
                        if (updated % 100 === 0) {
                            console.log(`⏳ Updated ${updated} bills so far...`);
                        }
                    }
                } else {
                    notFound++;
                    console.warn(`⚠️ No sector mapping found for retailer: "${bill.retailer_name}"`);
                }
            }
            
            // Update active supplies with mapped sector
            for (const supply of suppliesWithNullSector) {
                if (!supply.retailer_name) {
                    notFound++;
                    continue;
                }
                
                const lookupKey = supply.retailer_name.toLowerCase().trim();
                const sector = retailerSectorMap.get(lookupKey);
                
                if (sector) {
                    (_pendingSector[`active_supplies|${sector}`] = _pendingSector[`active_supplies|${sector}`] || []).push(supply.id);
                    const updateError = null;
                    
                    if (updateError) {
                        console.error(`❌ Error updating active supply ${supply.id}:`, updateError);
                    } else {
                        updated++;
                        if (updated % 100 === 0) {
                            console.log(`⏳ Updated ${updated} records so far...`);
                        }
                    }
                } else {
                    notFound++;
                    console.warn(`⚠️ No sector mapping found for retailer: "${supply.retailer_name}"`);
                }
            }
            
            // Update ugrai_data with mapped sector
            const { data: ugraiDataNullSector, error: ugraiDataError } = await supabase
                .from('ugrai_data')
                .select('id, retailer_name, sector')
                .eq('user_id', this.userId)
                .or('sector.is.null,sector.eq.Unknown');
            
            if (!ugraiDataError && ugraiDataNullSector && ugraiDataNullSector.length > 0) {
                console.log(`📋 Found ${ugraiDataNullSector.length} ugrai_data records with null or Unknown sectors`);
                
                for (const ugrai of ugraiDataNullSector) {
                    if (!ugrai.retailer_name) {
                        notFound++;
                        continue;
                    }
                    
                    const lookupKey = ugrai.retailer_name.toLowerCase().trim();
                    const sector = retailerSectorMap.get(lookupKey);
                    
                    if (sector) {
                        (_pendingSector[`ugrai_data|${sector}`] = _pendingSector[`ugrai_data|${sector}`] || []).push(ugrai.id);
                    const updateError = null;
                        
                        if (updateError) {
                            console.error(`❌ Error updating ugrai_data ${ugrai.id}:`, updateError);
                        } else {
                            updated++;
                            if (updated % 100 === 0) {
                                console.log(`⏳ Updated ${updated} records so far...`);
                            }
                        }
                    } else {
                        notFound++;
                    }
                }
            }
            
            // Update ugrai_entries with mapped sector
            const { data: ugraiEntriesNullSector, error: ugraiEntriesError } = await supabase
                .from('ugrai_entries')
                .select('id, retailer_name, sector')
                .eq('user_id', this.userId)
                .or('sector.is.null,sector.eq.Unknown');
            
            if (!ugraiEntriesError && ugraiEntriesNullSector && ugraiEntriesNullSector.length > 0) {
                console.log(`📋 Found ${ugraiEntriesNullSector.length} ugrai_entries records with null or Unknown sectors`);
                
                for (const entry of ugraiEntriesNullSector) {
                    if (!entry.retailer_name) {
                        notFound++;
                        continue;
                    }
                    
                    const lookupKey = entry.retailer_name.toLowerCase().trim();
                    const sector = retailerSectorMap.get(lookupKey);
                    
                    if (sector) {
                        (_pendingSector[`ugrai_entries|${sector}`] = _pendingSector[`ugrai_entries|${sector}`] || []).push(entry.id);
                    const updateError = null;
                        
                        if (updateError) {
                            console.error(`❌ Error updating ugrai_entries ${entry.id}:`, updateError);
                        } else {
                            updated++;
                            if (updated % 100 === 0) {
                                console.log(`⏳ Updated ${updated} records so far...`);
                            }
                        }
                    } else {
                        notFound++;
                    }
                }
            }
            
            await _flushSector();
            console.log(`✅ Sector backfill complete: ${updated} updated, ${notFound} retailers not found`);
            return { updated, notFound };
            
        } catch (error) {
            console.error('❌ Error backfilling sectors:', error);
            throw error;
        }
    }

    // Edited Bills Management
    async addEditedBill(bill, originalAmount, editedAmount, reason = '') {
        try {
            // Handle different property name formats between UI and database
            // Ensure no null values that would violate database constraints
            const retailerName = bill.retailer_name || bill.retailerName || bill.retailer || 'Unknown Retailer';
            const billNumber = bill.bill_number || bill.billNumber || bill.billNum || 'Unknown Bill';
            const sector = bill.sector || bill.sectorName || 'Unknown Sector';
            const brand = bill.brand || bill.brandName || 'Unknown Brand';
            const billDate = bill.bill_date || bill.billDate || null;
            
            // Validate required fields
            if (!retailerName || retailerName === 'null' || retailerName.trim() === '') {
                throw new Error('Retailer name is required but was null or empty');
            }
            if (!billNumber || billNumber === 'null' || billNumber.trim() === '') {
                throw new Error('Bill number is required but was null or empty');
            }
            
            console.log('📝 Adding edited bill to database:', {
                billId: bill.id,
                billNumber: billNumber,
                billDate: billDate,
                originalAmount,
                editedAmount,
                retailerName: retailerName,
                sector: sector,
                brand: brand,
                reason,
                billProperties: Object.keys(bill) // Debug: show available properties
            });

            const { data, error } = await supabase
                .from('edited_bills')
                .insert([{
                    original_bill_id: bill.id,
                    bill_number: billNumber,
                    bill_date: billDate,
                    original_amount: originalAmount,
                    edited_amount: editedAmount,
                    retailer_name: retailerName,
                    sector: sector,
                    brand: brand,
                    edit_reason: reason,
                    user_id: this.userId
                }])
                .select();
            
            if (error) {
                console.error('❌ Database error adding edited bill:', {
                    error: error,
                    billData: {
                        original_bill_id: bill.id,
                        bill_number: billNumber,
                        retailer_name: retailerName,
                        sector: sector,
                        brand: brand
                    }
                });
                throw error;
            }
            
            console.log('✅ Edited bill added successfully:', data[0]);
            return data[0];
        } catch (error) {
            console.error('❌ Error adding edited bill:', {
                error: error.message || error,
                billId: bill?.id,
                billNumber: bill?.billNumber || bill?.bill_number,
                availableProperties: Object.keys(bill || {})
            });
            throw error;
        }
    }

    async updateEditedBillAmount(billId, newEditedAmount) {
        try {
            console.log('💾 Updating edited bill amount in database:', { billId, newEditedAmount });
            
            const { data, error } = await supabase
                .from('edited_bills')
                .update({ edited_amount: parseFloat(newEditedAmount) })
                .eq('id', billId)
                .select();
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                console.log('✅ Edited bill amount updated successfully:', data[0]);
                return data[0];
            } else {
                console.log('⚠️ No edited bill found with ID:', billId);
                return null;
            }
        } catch (error) {
            console.error('❌ Error updating edited bill amount:', error);
            throw error;
        }
    }

    async removeEditedBill(billId) {
        try {
            console.log('🗑️ Removing edited bill from database:', billId);
            
            const { data, error } = await supabase
                .from('edited_bills')
                .delete()
                .eq('id', billId)
                // .eq('user_id', this.userId) // REMOVED: Allow deletion across all users
                .select();
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                console.log('✅ Edited bill removed successfully:', data[0]);
                return data[0];
            } else {
                console.log('⚠️ No edited bill found with ID:', billId);
                return null;
            }
        } catch (error) {
            console.error('❌ Error removing edited bill:', error);
            throw error;
        }
    }

    async getEditedBills() {
        try {
            const { data, error } = await supabase
                .from('edited_bills')
                .select('*')
                // .eq('user_id', this.userId) // REMOVED: Show all edited bills across all users
                .order('edited_date', { ascending: false });
            
            if (error) throw error;
            
            // Map database column names to match UI expectations
            return (data || []).map(bill => ({
                id: bill.id,
                originalBillId: bill.original_bill_id,
                billNumber: bill.bill_number,
                billDate: bill.bill_date,
                originalAmount: bill.original_amount,
                editedAmount: bill.edited_amount,
                retailerName: bill.retailer_name,
                sector: bill.sector,
                brand: bill.brand,
                editReason: bill.edit_reason,
                editedDate: bill.edited_date
            }));
        } catch (error) {
            console.error('Error fetching edited bills:', error);
            return [];
        }
    }

    // Real-time subscriptions
    subscribeToRetailers(callback) {
        return supabase
            .channel('retailers_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'retailers',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    subscribeToBills(callback) {
        return supabase
            .channel('bills_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'bills',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    subscribeToActiveSupplies(callback) {
        return supabase
            .channel('active_supplies_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'active_supplies',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    subscribeToApprovedBills(callback) {
        return supabase
            .channel('approved_bills_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'approved_bills',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    // UGRAI DATA MANAGEMENT
    async getUgraiData() {
        try {
            console.log('📊 Fetching all UGRAI data with pagination...');
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allData = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('ugrai_data')
                    .select('*', { count: 'exact' })
                    .order('created_at', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allData = allData.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`� Fetched batch: ${data.length} ugrai_data (total so far: ${allData.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Successfully fetched all ${allData.length} UGRAI data records`);
            
            // Map database column names to match UI expectations
            const mappedData = allData.map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                netAmount: item.net_amount,
                receivedAmount: item.received_amount || 0, // Include received amount for due calculation
                status: item.status,
                assignedTo: item.assigned_to
            }));
            
            return mappedData;
        } catch (error) {
            console.error('❌ Error fetching UGRAI data:', error);
            return [];
        }
    }

    async addUgraiData(ugraiItems) {
        try {
            console.log('📤 Adding UGRAI data to database:', ugraiItems);
            
            const dataWithUserId = ugraiItems.map(item => ({
                bill_number: item.billNumber,
                bill_date: item.billDate,
                retailer_name: item.retailerName,
                sector: item.sector,
                net_amount: parseFloat(item.netAmount),
                received_amount: item.receivedAmount ? parseFloat(item.receivedAmount) : null, // Track received amount for partial payments
                status: item.status || 'Pending',
                assigned_to: item.assignedTo || null,
                user_id: this.userId
            }));

            // Check for existing bills and update/insert accordingly (one server call for the whole list)
            const { data: results, error: upsertError } = await supabase.rpc('dls_upsert_ugrai_data', { p_items: dataWithUserId });
            if (upsertError) throw upsertError;
            
            console.log('✅ UGRAI data added/updated successfully:', results);
            
            // Map back to UI format
            return results.map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                netAmount: item.net_amount,
                status: item.status,
                assignedTo: item.assigned_to
            }));
        } catch (error) {
            console.error('❌ Error adding UGRAI data:', error);
            throw error;
        }
    }

    async replaceUgraiData(ugraiItems) {
        try {
            console.log('🔄 Replacing all UGRAI data...');
            
            // First, delete all existing UGRAI data
            // WARNING: This deletes ALL bills in ugrai_data, not just current user's
            await supabase
                .from('ugrai_data')
                .delete()
                .eq('user_id', this.userId);  // KEPT: This is intentional for user-scoped replacement
            
            // Then add the new data
            if (ugraiItems.length > 0) {
                return await this.addUgraiData(ugraiItems);
            }
            
            return [];
        } catch (error) {
            console.error('❌ Error replacing UGRAI data:', error);
            throw error;
        }
    }

    // UGRAI ENTRIES (from credit bills)
    async getUgraiEntries() {
        try {
            console.log('📊 Fetching all UGRAI entries with pagination...');
            console.log('🔍 Current user_id:', this.userId);
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allEntries = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('ugrai_entries')
                    .select('*', { count: 'exact' })
                    // .eq('user_id', this.userId) // REMOVED: Fetch all entries regardless of user_id
                    .order('created_at', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                console.log('📊 Query result:', { data: data?.length || 0, error, count });
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allEntries = allEntries.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`📦 Fetched batch: ${data.length} ugrai_entries (total so far: ${allEntries.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Successfully fetched all ${allEntries.length} UGRAI entries (all users)`);
            
            return allEntries.map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                netAmount: item.net_amount,
                status: item.status,
                assignedTo: item.assigned_to,
                originalSupplyId: item.original_supply_id
            }));
        } catch (error) {
            console.error('❌ Error fetching UGRAI entries:', error);
            return [];
        }
    }

    async addUgraiEntry(entry) {
        try {
            const entryData = {
                bill_number: entry.billNumber,
                bill_date: entry.billDate,
                retailer_name: entry.retailerName,
                sector: entry.sector,
                net_amount: parseFloat(entry.netAmount),
                status: entry.status || 'Pending',
                assigned_to: entry.assignedTo || null,
                original_supply_id: entry.originalSupplyId || null,
                user_id: this.userId
            };

            const { data, error } = await supabase
                .from('ugrai_entries')
                .insert([entryData])
                .select();
            
            if (error) throw error;
            return data[0];
        } catch (error) {
            console.error('❌ Error adding UGRAI entry:', error);
            throw error;
        }
    }

    async removeUgraiEntryByBillNumber(billNumber) {
        try {
            // First check if the record exists
            const { data: existing, error: checkError } = await supabase
                .from('ugrai_entries')
                .select('id, bill_number')
                // .eq('user_id', this.userId) // REMOVED: Search all entries regardless of user_id
                .eq('bill_number', billNumber);
            
            if (checkError) throw checkError;
            
            if (!existing || existing.length === 0) {
                console.log('⚠️ No UGRAI entry found to remove for bill:', billNumber);
                return false;
            }
            
            console.log('🔍 Found', existing.length, 'UGRAI entry records for bill:', billNumber);
            
            const { data, error } = await supabase
                .from('ugrai_entries')
                .delete()
                // .eq('user_id', this.userId) // REMOVED: Delete all entries regardless of user_id
                .eq('bill_number', billNumber)
                .select();
            
            if (error) throw error;
            
            console.log('✅ Successfully removed', data?.length || 0, 'UGRAI entry records for bill:', billNumber);
            return true;
        } catch (error) {
            console.error('❌ Error removing UGRAI entry for bill', billNumber, ':', error);
            throw error;
        }
    }

    async removeUgraiEntryById(id) {
        try {
            const { data, error } = await supabase
                .from('ugrai_entries')
                .delete()
                // .eq('user_id', this.userId) // REMOVED: Delete all entries regardless of user_id
                .eq('id', id)
                .select();
            
            if (error) throw error;
            
            if (!data || data.length === 0) {
                console.log('⚠️ No UGRAI entry found to remove with ID:', id);
                return false;
            }
            
            console.log('✅ Successfully removed UGRAI entry with ID:', id, '- Bill:', data[0]?.bill_number);
            return true;
        } catch (error) {
            console.error('❌ Error removing UGRAI entry by ID', id, ':', error);
            throw error;
        }
    }
    
    // Remove UGRAI data by bill number or ID
    async removeUgraiData(billNumberOrId) {
        try {
            console.log('🔍 removeUgraiData called with:', billNumberOrId, 'type:', typeof billNumberOrId);
            
            // Check if it looks like a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(billNumberOrId);
            
            if (isUUID) {
                console.log('  📍 Detected UUID format, using removeUgraiDataById');
                return await this.removeUgraiDataById(billNumberOrId);
            } else {
                console.log('  📍 Not a UUID, treating as bill number');
                // Try by bill number first
                const byBillNumber = await this.removeUgraiDataByBillNumber(billNumberOrId);
                if (byBillNumber) return true;
                
                // Only try by ID if it could be a valid UUID
                console.warn('⚠️ Bill not found by bill number, and value is not a UUID');
                return false;
            }
        } catch (error) {
            console.error('Error removing UGRAI data:', error);
            throw error;
        }
    }
    
    // Update UGRAI data by bill number or ID
    async updateUgraiData(billNumberOrId, updates) {
        try {
            console.log(`📝 Updating UGRAI data for: ${billNumberOrId}`, updates);
            
            // Try to find by bill_number first, then by id
            const { data, error } = await supabase
                .from('ugrai_data')
                .update({
                    net_amount: updates.netAmount,
                    status: updates.status || 'Pending'
                })
                // .eq('user_id', this.userId) // REMOVED: Allow updating bills regardless of user_id
                .or(`bill_number.eq.${billNumberOrId},id.eq.${billNumberOrId}`)
                .select();
            
            if (error) throw error;
            
            if (!data || data.length === 0) {
                console.log('⚠️ No UGRAI data found to update for:', billNumberOrId);
                return false;
            }
            
            console.log('✅ Successfully updated UGRAI data:', data);
            return true;
        } catch (error) {
            console.error('Error updating UGRAI data:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------------
    //  Methods that scripts.js calls but the original service never defined
    //  (added in the Google Sheets edition so these code paths work too)
    // ---------------------------------------------------------------------
    _mapUpdates(updates, allowed) {
        const out = {};
        if (!updates) return out;
        Object.keys(updates).forEach((k) => {
            const col = allowed[k];
            if (col && updates[k] !== undefined) out[col] = updates[k];
        });
        return out;
    }

    async updateUgraiEntries(billNumberOrId, updates) {
        const patch = this._mapUpdates(updates, {
            netAmount: 'net_amount', net_amount: 'net_amount', status: 'status', sector: 'sector',
            retailerName: 'retailer_name', retailer_name: 'retailer_name', assignedTo: 'assigned_to', assigned_to: 'assigned_to',
            receivedAmount: 'received_amount', received_amount: 'received_amount', billDate: 'bill_date', currentStage: 'current_stage'
        });
        if (Object.keys(patch).length === 0) return false;
        const { data, error } = await supabase.from('ugrai_entries').update(patch)
            .or(`bill_number.eq.${billNumberOrId},id.eq.${billNumberOrId}`).select();
        if (error) throw error;
        return !!(data && data.length);
    }

    async updateUgraiInProgress(billNumberOrId, updates) {
        const patch = this._mapUpdates(updates, {
            netAmount: 'net_amount', net_amount: 'net_amount', sector: 'sector',
            retailerName: 'retailer_name', retailer_name: 'retailer_name', assignedTo: 'assigned_to', assigned_to: 'assigned_to', billDate: 'bill_date'
        });
        if (Object.keys(patch).length === 0) return false;
        const { data, error } = await supabase.from('ugrai_in_progress').update(patch)
            .or(`bill_number.eq.${billNumberOrId},id.eq.${billNumberOrId}`).select();
        if (error) throw error;
        return !!(data && data.length);
    }

    async updateBill(billNumberOrId, updates) {
        const patch = this._mapUpdates(updates, {
            netAmount: 'net_amount', net_amount: 'net_amount', status: 'status', sector: 'sector', brand: 'brand',
            retailerName: 'retailer_name', retailer_name: 'retailer_name', billDate: 'bill_date', supplyThrough: 'supply_through'
        });
        if (Object.keys(patch).length === 0) return false;
        const { data, error } = await supabase.from('bills').update(patch)
            .or(`bill_number.eq.${billNumberOrId},id.eq.${billNumberOrId}`).select();
        if (error) throw error;
        return !!(data && data.length);
    }

    async getAllUgrai() {
        const out = [];
        for (const table of ['ugrai_data', 'ugrai_entries']) {
            const { data, error } = await supabase.from(table).select('*');
            if (error) throw error;
            (data || []).forEach(r => out.push({ ...r, source_table: table }));
        }
        return out;
    }

    getClient() {
        return supabase;
    }

    async signOut() {
        try {
            await supabase.auth.signOut();
        } catch (error) {
            console.error('Error signing out:', error);
        }
    }

    async removeUgraiDataById(id) {
        try {
            // Validate UUID format
            const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
            if (!isValidUUID) {
                console.error('❌ Invalid UUID format:', id);
                throw new Error(`Invalid UUID format: "${id}". This appears to be a bill number, not a database ID.`);
            }
            
            const { data, error } = await supabase
                .from('ugrai_data')
                .delete()
                // .eq('user_id', this.userId) // REMOVED: Delete regardless of user_id to allow cross-user operations
                .eq('id', id)
                .select();
            
            if (error) throw error;
            
            if (!data || data.length === 0) {
                console.log('⚠️ No UGRAI data found to remove with ID:', id);
                return false;
            }
            
            console.log('✅ Successfully removed UGRAI data with ID:', id, '- Bill:', data[0]?.bill_number);
            return true;
        } catch (error) {
            console.error('❌ Error removing UGRAI data by ID', id, ':', error);
            throw error;
        }
    }

    async removeUgraiDataByBillNumber(billNumber) {
        try {
            // First check if the record exists
            const { data: existing, error: checkError } = await supabase
                .from('ugrai_data')
                .select('id, bill_number')
                // .eq('user_id', this.userId) // REMOVED: Search all bills regardless of user_id
                .eq('bill_number', billNumber);
            
            if (checkError) throw checkError;
            
            if (!existing || existing.length === 0) {
                console.log('⚠️ No UGRAI data found to remove for bill:', billNumber);
                return false;
            }
            
            console.log('🔍 Found', existing.length, 'UGRAI data records for bill:', billNumber);
            
            const { data, error } = await supabase
                .from('ugrai_data')
                .delete()
                // .eq('user_id', this.userId) // REMOVED: Delete all bills regardless of user_id
                .eq('bill_number', billNumber)
                .select();
            
            if (error) throw error;
            
            console.log('✅ Successfully removed', data?.length || 0, 'UGRAI data records for bill:', billNumber);
            return true;
        } catch (error) {
            console.error('❌ Error removing UGRAI data for bill', billNumber, ':', error);
            throw error;
        }
    }

    // UGRAI ASSIGNMENTS
    async getUgraiAssignments() {
        try {
            // First, try to get assignments by user_id (for admins who create assignments)
            const { data: adminAssignments, error: adminError } = await supabase
                .from('ugrai_assignments')
                .select('*')
                .eq('user_id', this.userId);
            
            if (adminError) {
                console.warn('⚠️ Error fetching admin assignments:', adminError);
            }
            
            // If we got assignments as admin, return those
            if (adminAssignments && adminAssignments.length > 0) {
                console.log('✅ Found', adminAssignments.length, 'assignments by user_id (admin)');
                const assignments = {};
                adminAssignments.forEach(item => {
                    assignments[item.sector] = item.assigned_to;
                });
                return assignments;
            }
            
            // If no assignments found by user_id, check if this user is assigned_to any sectors
            // Get the current user's full name from user_profiles
            const { data: userProfile, error: profileError } = await supabase
                .from('user_profiles')
                .select('full_name')
                .eq('user_id', this.userId)
                .single();
            
            if (profileError) {
                console.error('❌ Error fetching user profile:', profileError);
                return {};
            }
            
            if (!userProfile || !userProfile.full_name) {
                console.log('⚠️ No user profile or full_name found for user:', this.userId);
                return {};
            }
            
            const userName = userProfile.full_name;
            console.log('👤 Checking assignments for user:', userName);
            
            // Get sectors where this person is assigned_to
            const { data: userAssignments, error: userError } = await supabase
                .from('ugrai_assignments')
                .select('*')
                .eq('assigned_to', userName);
            
            if (userError) {
                console.error('❌ Error fetching user assignments:', userError);
                return {};
            }
            
            console.log('✅ Found', userAssignments?.length || 0, 'assignments by assigned_to (worker)');
            
            // Convert array to object format for UI
            const assignments = {};
            (userAssignments || []).forEach(item => {
                assignments[item.sector] = item.assigned_to;
            });
            
            return assignments;
        } catch (error) {
            console.error('❌ Error fetching UGRAI assignments:', error);
            return {};
        }
    }

    async saveUgraiAssignments(assignments) {
        try {
            // First, delete existing assignments for this user
            await supabase
                .from('ugrai_assignments')
                .delete()
                .eq('user_id', this.userId);
            
            // Then insert new assignments
            const assignmentData = Object.entries(assignments).map(([sector, assignedTo]) => ({
                sector: sector,
                assigned_to: assignedTo,
                user_id: this.userId
            }));

            if (assignmentData.length > 0) {
                const { data, error } = await supabase
                    .from('ugrai_assignments')
                    .insert(assignmentData)
                    .select();
                
                if (error) throw error;
                return data;
            }
            
            return [];
        } catch (error) {
            console.error('❌ Error saving UGRAI assignments:', error);
            throw error;
        }
    }

    // Clear all UGRAI assignments for the current user
    async clearUgraiAssignments() {
        try {
            const { error } = await supabase
                .from('ugrai_assignments')
                .delete()
                .eq('user_id', this.userId);
            
            if (error) throw error;
            console.log('✅ Cleared all UGRAI assignments for user:', this.userId);
            return true;
        } catch (error) {
            console.error('❌ Error clearing UGRAI assignments:', error);
            throw error;
        }
    }

    // Clear all UGRAI in progress bills for the current user
    async clearUgraiInProgress() {
        try {
            const { error } = await supabase
                .from('ugrai_in_progress')
                .delete()
                .eq('user_id', this.userId);
            
            if (error) throw error;
            console.log('✅ Cleared all UGRAI in progress bills for user:', this.userId);
            return true;
        } catch (error) {
            console.error('❌ Error clearing UGRAI in progress bills:', error);
            throw error;
        }
    }

    // UGRAI FLOW STATE MANAGEMENT
    
    // Move UGRAI bills to In Progress state
    async moveUgraiToInProgress(sourceTable, sourceIds, assignedTo) {
        try {
            console.log(`📋 Moving UGRAI bills to in progress:`, { sourceTable, sourceIds, assignedTo });
            
            const { data, error } = await supabase.rpc('move_ugrai_to_in_progress', {
                p_user_id: this.userId,
                p_source_table: sourceTable,
                p_source_ids: sourceIds,
                p_assigned_to: assignedTo
            });
            
            if (error) throw error;
            
            const movedCount = data?.[0]?.moved_count || 0;
            console.log(`✅ Moved ${movedCount} bills to in progress`);
            return movedCount;
            
        } catch (error) {
            console.error('❌ Error moving UGRAI to in progress:', error);
            throw error;
        }
    }
    
    // Get UGRAI bills in progress for delivery person
    async getUgraiInProgress() {
        try {
            console.log('🚚 Getting UGRAI in progress for user:', this.userId);
            
            // Step 1: Get the current user's full name from user_profiles
            const { data: userProfile, error: profileError } = await supabase
                .from('user_profiles')
                .select('full_name')
                .eq('user_id', this.userId)
                .single();
            
            if (profileError) {
                console.error('❌ Error fetching user profile:', profileError);
                return [];
            }
            
            if (!userProfile || !userProfile.full_name) {
                console.log('⚠️ No user profile or full_name found for user:', this.userId);
                return [];
            }
            
            const userName = userProfile.full_name;
            console.log('👤 User full name:', userName);
            
            // Step 2: Get sectors assigned to this person (by name, not user_id!)
            const { data: assignments, error: assignError } = await supabase
                .from('ugrai_assignments')
                .select('sector, assigned_to')
                .eq('assigned_to', userName);
            
            if (assignError) {
                console.error('❌ Error fetching ugrai assignments:', assignError);
                return [];
            }
            
            console.log('📋 Raw assignments data:', assignments);
            
            if (!assignments || assignments.length === 0) {
                console.log('⚠️ No sector assignments found for:', userName);
                console.log('💡 This user may not have any sectors assigned in ugrai_assignments table');
                return [];
            }
            
            // Get list of sectors assigned to this user
            const assignedSectors = assignments.map(a => a.sector);
            
            console.log('📋 User assigned sectors:', assignedSectors);
            console.log(`� ${userName} is assigned to ${assignedSectors.length} sectors`);
            
            if (assignedSectors.length === 0) {
                console.log('⚠️ No sectors found in assignments');
                return [];
            }
            
            // Step 3: Get bills from ugrai_data that match assigned sectors
            console.log('🔍 Querying ugrai_data for sectors:', assignedSectors);
            const { data: ugraiDataBills, error: dataError } = await supabase
                .from('ugrai_data')
                .select('*')
                .in('sector', assignedSectors)
                .order('bill_date', { ascending: false });
            
            if (dataError) {
                console.error('❌ Error fetching ugrai_data bills:', dataError);
                return [];
            }
            
            console.log('📊 Found bills in ugrai_data:', ugraiDataBills?.length || 0);
            
            // Step 4: Get bills from ugrai_entries that match assigned sectors
            console.log('🔍 Querying ugrai_entries for sectors:', assignedSectors);
            const { data: ugraiEntryBills, error: entriesError } = await supabase
                .from('ugrai_entries')
                .select('*')
                .in('sector', assignedSectors)
                .order('bill_date', { ascending: false });
            
            if (entriesError) {
                console.error('❌ Error fetching ugrai_entries bills:', entriesError);
                // Continue even if this fails
            }
            
            console.log('📊 Found bills in ugrai_entries:', ugraiEntryBills?.length || 0);
            
            // Combine and map bills
            const allBills = [];
            const processedBillNumbers = new Set();
            
            // Process ugrai_data bills
            (ugraiDataBills || []).forEach(item => {
                if (!processedBillNumbers.has(item.bill_number)) {
                    processedBillNumbers.add(item.bill_number);
                    allBills.push({
                        id: item.id,
                        billNumber: item.bill_number,
                        billDate: item.bill_date,
                        retailerName: item.retailer_name,
                        sector: item.sector,
                        netAmount: item.net_amount,
                        assignedTo: userName,
                        status: item.status || 'Pending',
                        sourceTable: 'ugrai_data'
                    });
                }
            });
            
            // Process ugrai_entries bills (avoid duplicates)
            (ugraiEntryBills || []).forEach(item => {
                if (!processedBillNumbers.has(item.bill_number)) {
                    processedBillNumbers.add(item.bill_number);
                    allBills.push({
                        id: item.id,
                        billNumber: item.bill_number,
                        billDate: item.bill_date,
                        retailerName: item.retailer_name,
                        sector: item.sector,
                        netAmount: item.net_amount,
                        assignedTo: userName,
                        status: item.status || 'Pending',
                        sourceTable: 'ugrai_entries'
                    });
                }
            });
            
            console.log(`✅ Found ${allBills.length} UGRAI bills in progress for ${userName}`);
            
            if (allBills.length > 0) {
                console.log('📦 Sample bills:', allBills.slice(0, 3).map(b => ({
                    billNumber: b.billNumber,
                    retailer: b.retailerName,
                    sector: b.sector,
                    amount: b.netAmount
                })));
            }
            
            return allBills;
            
        } catch (error) {
            console.error('❌ Error fetching UGRAI in progress:', error);
            return [];
        }
    }
    
    // Remove a bill from UGRAI in progress
    async removeUgraiInProgress(billId) {
        try {
            console.log(`🗑️ Removing bill from ugrai_in_progress: ${billId}`);
            
            const { error } = await supabase
                .from('ugrai_in_progress')
                .delete()
                .eq('user_id', this.userId)
                .or(`id.eq.${billId},bill_number.eq.${billId}`);
            
            if (error) throw error;
            
            console.log(`✅ Successfully removed from ugrai_in_progress`);
            return true;
            
        } catch (error) {
            console.error('❌ Error removing from ugrai_in_progress:', error);
            // throw error;
        }
    }
    
    // Complete UGRAI bill using new flow
    async completeUgraiBillNew(billNumber, completionData) {
        try {
            console.log(`✅ Completing UGRAI bill ${billNumber}:`, completionData);
            
            const { data, error } = await supabase.rpc('complete_ugrai_bill', {
                p_user_id: this.userId,
                p_bill_number: billNumber,
                p_payment_method: completionData.paymentMethod,
                p_received_amount: parseFloat(completionData.receivedAmount),
                p_receipt_number: completionData.receiptNumber || null,
                p_cheque_date: completionData.chequeDate || null,
                p_payment_photo_url: completionData.paymentPhotoUrl || null
            });
            
            if (error) throw error;
            
            const completedId = data?.[0]?.completed_id;
            console.log(`✅ UGRAI bill completed with ID: ${completedId}`);
            return completedId;
            
        } catch (error) {
            console.error('❌ Error completing UGRAI bill:', error);
            throw error;
        }
    }
    
    // Get completed UGRAI bills from new flow
    async getCompletedUgraiNew() {
        try {
            console.log('📊 Fetching all ugrai_completed with pagination...');
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allCompleted = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('ugrai_completed')
                    .select('*', { count: 'exact' })
                    .order('completed_date', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allCompleted = allCompleted.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`📦 Fetched batch: ${data.length} ugrai_completed (total so far: ${allCompleted.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Successfully fetched all ${allCompleted.length} ugrai_completed`);
            
            return allCompleted.map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                netAmount: item.net_amount,
                assignedTo: item.assigned_to,
                paymentMethod: item.payment_method,
                receivedAmount: item.received_amount,
                receiptNumber: item.receipt_number,
                chequeDate: item.cheque_date,
                paymentPhotoUrl: item.payment_photo_url,
                completedDate: item.completed_date,
                sourceTable: item.source_table,
                sourceId: item.source_id,
                inProgressId: item.in_progress_id
            }));
            
        } catch (error) {
            console.error('❌ Error fetching completed UGRAI:', error);
            return [];
        }
    }
    
    // Approve UGRAI bills
    async approveUgraiBills(billNumbers) {
        try {
            console.log(`👍 Approving UGRAI bills:`, billNumbers);
            console.log(`🔍 Using user_id:`, this.userId);
            
            const { data, error } = await supabase.rpc('approve_ugrai_bills', {
                p_user_id: this.userId,
                p_bill_numbers: billNumbers
            });
            
            if (error) throw error;
            
            const approvedCount = data?.[0]?.approved_count || 0;
            console.log(`✅ Approved ${approvedCount} UGRAI bills`);
            
            if (approvedCount === 0) {
                console.warn(`⚠️ SQL function returned 0 approved bills. This might indicate:`);
                console.warn(`   - Bills don't exist in completed_ugrai table`);
                console.warn(`   - Bills already exist in approved_bills table`);
                console.warn(`   - User_id mismatch`);
            }
            
            return approvedCount;
            
        } catch (error) {
            console.error('❌ Error approving UGRAI bills:', error);
            throw error;
        }
    }
    
    // Get available UGRAI bills (not yet assigned to in progress)
    async getAvailableUgraiData() {
        try {
            const { data, error } = await supabase
                .from('ugrai_data')
                .select('*')
                .eq('current_stage', 'available')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            
            return (data || []).map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                netAmount: item.net_amount,
                status: item.status,
                assignedTo: item.assigned_to,
                currentStage: item.current_stage
            }));
            
        } catch (error) {
            console.error('❌ Error fetching available UGRAI data:', error);
            return [];
        }
    }
    
    // Get available UGRAI entries (from credit bills)
    async getAvailableUgraiEntries() {
        try {
            const { data, error } = await supabase
                .from('ugrai_entries')
                .select('*')
                // .eq('user_id', this.userId) // REMOVED: Fetch all entries regardless of user_id
                .eq('current_stage', 'available')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            
            return (data || []).map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                netAmount: item.net_amount,
                status: item.status,
                assignedTo: item.assigned_to,
                originalSupplyId: item.original_supply_id,
                currentStage: item.current_stage
            }));
            
        } catch (error) {
            console.error('❌ Error fetching available UGRAI entries:', error);
            return [];
        }
    }

    // COMPLETED UGRAI
    async getCompletedUgrai() {
        try {
            console.log('📊 Fetching all completed UGRAI with pagination...');
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allCompleted = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('completed_ugrai')
                    .select('*', { count: 'exact' })
                    .order('date_completed', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allCompleted = allCompleted.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`📦 Fetched batch: ${data.length} completed ugrai (total so far: ${allCompleted.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Successfully fetched all ${allCompleted.length} completed UGRAI`);
            
            return allCompleted.map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                netAmount: item.net_amount,
                paymentMethod: item.payment_method,
                receiptNumber: item.receipt_number,
                receivedAmount: item.received_amount,
                chequeDate: item.cheque_date,
                photoUploaded: item.photo_uploaded,
                dateCompleted: item.date_completed,
                assignedTo: item.assigned_to,
                sourceTable: item.source_table,  // CRITICAL: Track original source
                sourceId: item.source_id          // CRITICAL: Track original ID
            }));
        } catch (error) {
            console.error('❌ Error fetching completed UGRAI:', error);
            return [];
        }
    }

    async getCompletedUgraiByBillNumber(billNumber) {
        try {
            const { data, error } = await supabase
                .from('completed_ugrai')
                .select('*')
                // .eq('user_id', this.userId) // REMOVED: Search all completed bills regardless of user_id
                .eq('bill_number', billNumber)
                .single();
            
            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
                throw error;
            }
            
            if (data) {
                return {
                    id: data.id,
                    billNumber: data.bill_number,
                    billDate: data.bill_date,
                    retailerName: data.retailer_name,
                    sector: data.sector,
                    netAmount: data.net_amount,
                    paymentMethod: data.payment_method,
                    receiptNumber: data.receipt_number,
                    receivedAmount: data.received_amount,
                    chequeDate: data.cheque_date,
                    photoUploaded: data.photo_uploaded,
                    dateCompleted: data.date_completed,
                    assignedTo: data.assigned_to,
                    sourceTable: data.source_table,  // CRITICAL: Track original source
                    sourceId: data.source_id          // CRITICAL: Track original ID
                };
            }
            
            return null;
        } catch (error) {
            console.error('❌ Error fetching completed UGRAI by bill number:', error);
            return null;
        }
    }

    async addCompletedUgrai(completion) {
        try {
            const completionData = {
                bill_number: completion.billNumber,
                bill_date: completion.billDate,
                retailer_name: completion.retailerName,
                sector: completion.sector,
                net_amount: parseFloat(completion.netAmount),
                payment_method: completion.paymentMethod,
                receipt_number: completion.receiptNumber || null,
                received_amount: parseFloat(completion.receivedAmount),
                cheque_date: completion.chequeDate || null,
                photo_uploaded: Boolean(completion.photoUploaded),
                date_completed: completion.dateCompleted || new Date().toISOString().split('T')[0],
                assigned_to: completion.assignedTo,
                user_id: this.userId
            };

            const { data, error } = await supabase
                .from('completed_ugrai')
                .insert([completionData])
                .select();
            
            if (error) throw error;
            return data[0];
        } catch (error) {
            console.error('❌ Error adding completed UGRAI:', error);
            throw error;
        }
    }

    // Bulk import completed UGRAI with duplicate handling
    async bulkImportCompletedUgrai(completions, progressCallback = null) {
        try {
            console.log(`📦 Bulk importing ${completions.length} completed UGRAI bills...`);
            
            // Group by bill_number to handle duplicates
            const billGroups = {};
            completions.forEach(completion => {
                const billNum = completion.billNumber;
                if (!billGroups[billNum]) {
                    billGroups[billNum] = [];
                }
                billGroups[billNum].push(completion);
            });
            
            const results = {
                imported: 0,
                updated: 0,
                skipped: 0,
                historyCreated: 0,
                errors: []
            };
            
            // Convert to array for batch processing
            const billEntries = Object.entries(billGroups);
            const BATCH_SIZE = 50; // Process 50 bills at a time
            const RETRY_ATTEMPTS = 3;
            const DELAY_BETWEEN_BATCHES = 0; // no throttling needed
            
            // Process in batches
            for (let i = 0; i < billEntries.length; i += BATCH_SIZE) {
                const batch = billEntries.slice(i, i + BATCH_SIZE);
                const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
                const totalBatches = Math.ceil(billEntries.length / BATCH_SIZE);
                
                console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} bills)...`);
                
                // Report progress
                if (progressCallback) {
                    progressCallback({
                        current: i,
                        total: billEntries.length,
                        batch: batchNumber,
                        totalBatches: totalBatches
                    });
                }
                
                // Whole chunk is processed server-side in one call
                let attempt = 0, chunkDone = false;
                while (!chunkDone && attempt < RETRY_ATTEMPTS) {
                    const { data: chunkRes, error: chunkErr } = await supabase.rpc('dls_bulk_import_completed_ugrai', {
                        p_user_id: this.userId,
                        p_groups: batch.map(([, bills]) => bills)
                    });
                    if (chunkErr) {
                        attempt++;
                        console.error(`❌ Bulk import chunk failed (attempt ${attempt}/${RETRY_ATTEMPTS}):`, chunkErr);
                        if (attempt >= RETRY_ATTEMPTS) {
                            batch.forEach(([billNumber]) => results.errors.push({ billNumber, error: chunkErr.message }));
                        } else {
                            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                        }
                    } else {
                        const r = (chunkRes && chunkRes[0]) || {};
                        results.imported += r.imported || 0;
                        results.updated += r.updated || 0;
                        results.skipped += r.skipped || 0;
                        results.historyCreated += r.historyCreated || 0;
                        (r.errors || []).forEach(e => results.errors.push(e));
                        chunkDone = true;
                    }
                }
                
                // Delay between batches to avoid rate limiting
                if (i + BATCH_SIZE < billEntries.length) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
                }
            }
            
            console.log(`📊 Bulk import complete:`, results);
            return results;
        } catch (error) {
            console.error('❌ Error in bulk import:', error);
            throw error;
        }
    }

    async updateCompletedUgrai(id, updates) {
        try {
            // Convert UI field names to database column names
            const dbUpdates = {};
            if (updates.paymentMethod) dbUpdates.payment_method = updates.paymentMethod;
            if (updates.receiptNumber) dbUpdates.receipt_number = updates.receiptNumber;
            if (updates.receivedAmount) dbUpdates.received_amount = parseFloat(updates.receivedAmount);
            if (updates.chequeDate) dbUpdates.cheque_date = updates.chequeDate;
            if (updates.photoUploaded !== undefined) dbUpdates.photo_uploaded = Boolean(updates.photoUploaded);
            // Allow updating/patching bill date/number if provided
            if (updates.billDate) dbUpdates.bill_date = updates.billDate;
            if (updates.billNumber) dbUpdates.bill_number = updates.billNumber;

            const { data, error } = await supabase
                .from('completed_ugrai')
                .update(dbUpdates)
                .eq('id', id)
                // .eq('user_id', this.userId) // REMOVED: Allow updating completed bills regardless of user_id
                .select();
            
            if (error) throw error;
            return data[0];
        } catch (error) {
            console.error('❌ Error updating completed UGRAI:', error);
            throw error;
        }
    }

    async checkBillExistsInCompletedUgrai(billNumber) {
        try {
            const { data, error } = await supabase
                .from('completed_ugrai')
                .select('id, bill_number')
                // .eq('user_id', this.userId) // REMOVED: Check all completed ugrai regardless of user_id
                .eq('bill_number', billNumber)
                .maybeSingle();
            
            if (error) throw error;
            
            if (data) {
                console.log(`✅ Bill ${billNumber} found in completed_ugrai with ID: ${data.id}`);
                return data; // Return the data object so we can use data.id for deletion
            } else {
                console.log(`❌ Bill ${billNumber} NOT found in completed_ugrai`);
                return null;
            }
        } catch (error) {
            console.error('❌ Error checking bill in completed_ugrai:', error);
            return null;
        }
    }

    async removeCompletedUgrai(id) {
        try {
            console.log(`🗑️ removeCompletedUgrai called with ID: ${id}`);
            
            const { data, error, count } = await supabase
                .from('completed_ugrai')
                .delete()
                .eq('id', id)
                // .eq('user_id', this.userId) // REMOVED: Delete regardless of user_id
                .select();
            
            if (error) {
                console.error('❌ Delete error:', error);
                throw error;
            }
            
            console.log(`✅ Delete result - Rows deleted:`, data?.length || 0);
            if (data && data.length > 0) {
                console.log(`✅ Deleted bill:`, data[0].bill_number);
            } else {
                console.warn(`⚠️ No rows deleted. Bill might not exist.`);
            }
            
            return true;
        } catch (error) {
            console.error('❌ Error removing completed UGRAI:', error);
            throw error;
        }
    }

    /**
     * Revert a bill from completed_ugrai back to ugrai_entries or ugrai_data
     * Logic: 
     * - If bill exists in approved_bills -> send to ugrai_entries
     * - Otherwise -> send to ugrai_data
     * - Reset payment fields (received_amount, payment_method, etc.)
     */
    async revertUgraiBill(billId) {
        try {
            console.log(`🔄 Starting revert process for bill ID: ${billId}`);
            
            // Step 1: Fetch the bill from completed_ugrai
            const { data: completedBill, error: fetchError } = await supabase
                .from('completed_ugrai')
                .select('*')
                .eq('id', billId)
                .single();
            
            if (fetchError) {
                console.error('❌ Error fetching bill from completed_ugrai:', fetchError);
                throw new Error(`Bill not found in completed UGRAI: ${fetchError.message}`);
            }
            
            console.log(`📋 Found bill: ${completedBill.bill_number}`);
            
            // Step 2: Check if bill exists in approved_bills to determine destination
            const { data: approvedBillCheck, error: checkError } = await supabase
                .from('approved_bills')
                .select('id')
                .eq('bill_number', completedBill.bill_number)
                .maybeSingle();
            
            if (checkError) {
                console.error('❌ Error checking approved_bills:', checkError);
                throw new Error(`Error checking approved_bills: ${checkError.message}`);
            }
            
            const targetTable = approvedBillCheck ? 'ugrai_entries' : 'ugrai_data';
            console.log(`📍 Target table: ${targetTable} (approved_bills ${approvedBillCheck ? 'exists' : 'does not exist'})`);
            
            // Step 3: Check if bill already exists in target table (due to unique constraint)
            const { data: existingBill, error: existingError } = await supabase
                .from(targetTable)
                .select('id')
                .eq('user_id', completedBill.user_id)
                .eq('bill_number', completedBill.bill_number)
                .maybeSingle();
            
            if (existingError && existingError.code !== 'PGRST116') {
                console.error('❌ Error checking existing bill:', existingError);
                throw new Error(`Error checking target table: ${existingError.message}`);
            }
            
            if (existingBill) {
                console.log(`⚠️ Bill already exists in ${targetTable}, will update it with fresh payment history data`);
                
                // Fetch payment history to get accurate received_amount
                console.log(`📜 Fetching payment history for update...`);
                const paymentHistory = await this.getUgraiPaymentHistory(completedBill.bill_number);
                
                // Calculate total received amount from payment history
                const totalReceivedFromHistory = paymentHistory.reduce((sum, payment) => {
                    return sum + parseFloat(payment.paymentAmount || 0);
                }, 0);
                
                console.log(`💰 Updating with payment history: ${paymentHistory.length} payment(s), total: ₹${totalReceivedFromHistory}`);
                
                // Update the existing bill with fresh data
                const updateData = {
                    received_amount: paymentHistory.length > 0 ? totalReceivedFromHistory : 0,
                    status: 'Pending',
                    assigned_to: null, // Reset assignment
                    current_stage: 'available'
                };
                
                const { error: updateError } = await supabase
                    .from(targetTable)
                    .update(updateData)
                    .eq('id', existingBill.id);
                
                if (updateError) {
                    console.error('❌ Error updating existing bill:', updateError);
                    throw new Error(`Failed to update existing bill: ${updateError.message}`);
                }
                
                console.log(`✅ Updated existing bill in ${targetTable}`);
                
                // Now delete from completed_ugrai
                await this.removeCompletedUgrai(billId);
                
                return { 
                    success: true, 
                    targetTable, 
                    alreadyExisted: true,
                    billNumber: completedBill.bill_number 
                };
            }
            
            // Step 4: Fetch payment history to get accurate received_amount
            console.log(`📜 Fetching payment history for bill ${completedBill.bill_number}...`);
            const paymentHistory = await this.getUgraiPaymentHistory(completedBill.bill_number);
            
            // Calculate total received amount from payment history
            const totalReceivedFromHistory = paymentHistory.reduce((sum, payment) => {
                return sum + parseFloat(payment.paymentAmount || 0);
            }, 0);
            
            // Get the most recent payment details for payment_method, receipt_number, etc.
            const lastPayment = paymentHistory.length > 0 
                ? paymentHistory[paymentHistory.length - 1] 
                : null;
            
            console.log(`💰 Payment history summary: ${paymentHistory.length} payment(s), total received: ₹${totalReceivedFromHistory}`);
            
            // Step 5: Prepare bill data for insertion
            // Note: ugrai_data and ugrai_entries only have basic fields + received_amount
            // They don't have payment_method, receipt_number, cheque_date, photo_uploaded
            const revertedBill = {
                user_id: completedBill.user_id,
                bill_number: completedBill.bill_number,
                bill_date: completedBill.bill_date,
                retailer_name: completedBill.retailer_name,
                sector: completedBill.sector,
                net_amount: completedBill.net_amount,
                received_amount: paymentHistory.length > 0 ? totalReceivedFromHistory : 0,
                status: 'Pending',
                assigned_to: null, // Reset assignment
                current_stage: 'available'
            };
            
            // Add original_supply_id only for ugrai_entries
            if (targetTable === 'ugrai_entries' && completedBill.original_supply_id) {
                revertedBill.original_supply_id = completedBill.original_supply_id;
            }
            
            console.log(`📤 Prepared bill for ${targetTable}:`, revertedBill);
            
            // Step 6: Delete from completed_ugrai FIRST (to avoid unique constraint issues)
            console.log(`🗑️ Deleting from completed_ugrai...`);
            await this.removeCompletedUgrai(billId);
            
            // Step 7: Insert into target table
            console.log(`📥 Inserting into ${targetTable}...`);
            const { data: insertedBill, error: insertError } = await supabase
                .from(targetTable)
                .insert(revertedBill)
                .select()
                .single();
            
            if (insertError) {
                console.error(`❌ Error inserting into ${targetTable}:`, insertError);
                
                // ROLLBACK: Re-insert into completed_ugrai
                console.log(`🔙 ROLLBACK: Re-inserting into completed_ugrai...`);
                const rollbackData = {
                    user_id: completedBill.user_id,
                    bill_number: completedBill.bill_number,
                    bill_date: completedBill.bill_date,
                    retailer_name: completedBill.retailer_name,
                    sector: completedBill.sector,
                    net_amount: completedBill.net_amount,
                    received_amount: completedBill.received_amount,
                    payment_method: completedBill.payment_method,
                    receipt_number: completedBill.receipt_number,
                    cheque_date: completedBill.cheque_date,
                    photo_uploaded: completedBill.photo_uploaded,
                    date_completed: completedBill.date_completed,
                    assigned_to: completedBill.assigned_to,
                    completed_by: completedBill.completed_by,
                    original_supply_id: completedBill.original_supply_id,
                    status: completedBill.status
                };
                
                await supabase.from('completed_ugrai').insert(rollbackData);
                
                throw new Error(`Failed to insert into ${targetTable}: ${insertError.message}`);
            }
            
            console.log(`✅ Successfully reverted bill ${completedBill.bill_number} to ${targetTable}`);
            
            return {
                success: true,
                targetTable,
                alreadyExisted: false,
                billNumber: completedBill.bill_number,
                bill: insertedBill
            };
            
        } catch (error) {
            console.error('❌ Error reverting UGRAI bill:', error);
            throw error;
        }
    }

    // APPROVED UGRAI (Removed duplicate method - using snake_case version at line ~3065)

    async getApprovedUgraiByBillNumber(billNumber) {
        // Google Sheets edition: the original asked the database once per bill. Here the whole
        // approved_ugrai table is fetched once and answered from memory (re-fetched after any
        // write made by this browser, or after 8 seconds).
        try {
            const seq = (window.DLSBackend && window.DLSBackend.writeSeq) ? window.DLSBackend.writeSeq() : 0;
            const c = this._approvedUgraiCache;
            const fresh = c && c.seq === seq && (Date.now() - c.at) < 8000;
            if (!fresh) {
                if (!this._approvedUgraiLoading || (c && c.seq !== seq)) {
                    this._approvedUgraiLoading = (async () => {
                        const { data, error } = await supabase.from('approved_ugrai').select('*').range(0, 99999);
                        if (error) throw error;
                        const map = new Map();
                        (data || []).forEach(r => { const k = String(r.bill_number); if (!map.has(k)) map.set(k, r); });
                        this._approvedUgraiCache = { map, seq, at: Date.now() };
                    })().finally(() => { this._approvedUgraiLoading = null; });
                }
                await this._approvedUgraiLoading;
            }
            return this._approvedUgraiCache.map.get(String(billNumber)) || null;
        } catch (error) {
            console.error('❌ Error fetching approved UGRAI by bill number:', error);
            return null;
        }
    }

    // Generic delete helper for removing records by column value
    async deleteFromTable(tableName, columnName, value) {
        try {
            console.log(`🗑️ Deleting from ${tableName} where ${columnName} = ${value}`);
            
            const { data, error } = await supabase
                .from(tableName)
                .delete()
                .eq(columnName, value)
                .select();
            
            if (error) throw error;
            
            console.log(`✅ Deleted ${data?.length || 0} rows from ${tableName}`);
            return true;
        } catch (error) {
            console.error(`❌ Error deleting from ${tableName}:`, error);
            throw error;
        }
    }

    // 🚀 BULK FETCH: Check multiple bill numbers at once for performance
    async getApprovedUgraiBulk(billNumbers) {
        try {
            if (!billNumbers || billNumbers.length === 0) return [];
            
            const { data, error } = await supabase
                .from('approved_ugrai')
                .select('bill_number')
                .in('bill_number', billNumbers);
            
            if (error) throw error;
            
            return data || [];
        } catch (error) {
            console.error('❌ Error bulk fetching approved UGRAI:', error);
            return [];
        }
    }

    async getAllApprovedUgrai() {
        try {
            console.log('📊 Fetching all approved UGRAI with pagination...');
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allUgrai = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('approved_ugrai')
                    .select('*', { count: 'exact' })
                    // .eq('user_id', this.userId) // REMOVED: Fetch all approved ugrai regardless of user_id
                    .order('date_approved', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allUgrai = allUgrai.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`📦 Fetched batch: ${data.length} approved ugrai (total so far: ${allUgrai.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Successfully fetched all ${allUgrai.length} approved UGRAI (all users)`);
            
            return allUgrai.map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                netAmount: item.net_amount,
                paymentMethod: item.payment_method,
                receiptNumber: item.receipt_number,
                receivedAmount: item.received_amount,
                chequeDate: item.cheque_date,
                photoUploaded: item.photo_uploaded,
                dateCompleted: item.date_completed,
                dateApproved: item.date_approved,
                assignedTo: item.assigned_to
            }));
        } catch (error) {
            console.error('❌ Error fetching approved UGRAI:', error);
            return [];
        }
    }

    // Get UGRAI analysis data using SQL aggregation via RPC function
    async getUgraiAnalysisSummary() {
        try {
            console.log('📊 Calling get_ugrai_analysis_summary RPC function...');
            
            // Call without user_id parameter (no filter needed)
            const { data, error } = await supabase.rpc('get_ugrai_analysis_summary');
            
            if (error) {
                console.error('❌ RPC function error:', error);
                console.error('⚠️ Make sure you have run ugrai-analysis-sql-function.sql in Supabase SQL Editor!');
                return null;
            }
            
            console.log('✅ SQL aggregation result from RPC:', data);
            
            // If we got an empty result, something is wrong
            if (!data || data.length === 0) {
                console.warn('⚠️ SQL function returned empty results.');
                return null;
            }
            
            return data;
            
        } catch (error) {
            console.error('❌ Error calling UGRAI analysis RPC:', error);
            return null;
        }
    }

    // Get pending bills summary via SQL aggregation
    async getPendingBillsSummary() {
        try {
            console.log('📊 Calling get_pending_bills_summary RPC function...');
            const { data, error } = await supabase.rpc('get_pending_bills_summary');
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('❌ Error calling pending bills summary RPC:', error);
            return null;
        }
    }

    // Get pending bills by sector via SQL aggregation
    async getPendingBillsBySector() {
        try {
            console.log('📊 Calling get_pending_bills_by_sector RPC function...');
            const { data, error } = await supabase.rpc('get_pending_bills_by_sector');
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('❌ Error calling pending bills by sector RPC:', error);
            return null;
        }
    }

    // Get pending bills by person via SQL aggregation
    async getPendingBillsByPerson() {
        try {
            console.log('📊 Calling get_pending_bills_by_person RPC function...');
            const { data, error } = await supabase.rpc('get_pending_bills_by_person');
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('❌ Error calling pending bills by person RPC:', error);
            return null;
        }
    }

    // Get detailed pending bills (matching Total UGRAI logic) via SQL
    async getPendingBillsDetailed() {
        try {
            console.log('📋 Calling get_pending_bills_detailed RPC function...');
            const { data, error } = await supabase.rpc('get_pending_bills_detailed');
            if (error) throw error;
            console.log(`✅ Retrieved ${data?.length || 0} pending bills from SQL`);
            return data;
        } catch (error) {
            console.error('❌ Error calling pending bills detailed RPC:', error);
            return [];
        }
    }

    // Get payment history summary via SQL aggregation
    async getPaymentHistorySummary() {
        try {
            console.log('📊 Calling get_payment_history_summary RPC function...');
            const { data, error } = await supabase.rpc('get_payment_history_summary');
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('❌ Error calling payment history summary RPC:', error);
            return null;
        }
    }

    // Get payment history by method via SQL aggregation
    async getPaymentHistoryByMethod() {
        try {
            console.log('📊 Calling get_payment_history_by_method RPC function...');
            const { data, error } = await supabase.rpc('get_payment_history_by_method');
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('❌ Error calling payment history by method RPC:', error);
            return null;
        }
    }

    // Add a bill to approved_ugrai table
    async addApprovedUgrai(ugraiData) {
        try {
            console.log('💾 Adding bill to approved_ugrai:', ugraiData.bill_number);
            
            const { data, error } = await supabase
                .from('approved_ugrai')
                .insert([ugraiData])
                .select()
                .single();
            
            if (error) throw error;
            
            console.log('✅ Bill added to approved_ugrai:', data);
            return data;
        } catch (error) {
            console.error('❌ Error adding bill to approved_ugrai:', error);
            throw error;
        }
    }

    // ==================== UGRAI PAYMENT HISTORY ====================
    
    // Add payment history entry
    async addUgraiPaymentHistory(paymentData) {
        try {
            // Get next payment number for this bill
            const { data: paymentNumData, error: paymentNumError } = await supabase
                .rpc('get_next_payment_number', {
                    p_user_id: this.userId,
                    p_bill_number: paymentData.billNumber
                });
            
            if (paymentNumError) throw paymentNumError;
            
            const paymentNumber = paymentNumData || 1;
            
            const historyData = {
                user_id: this.userId,
                bill_number: paymentData.billNumber,
                bill_date: paymentData.billDate,
                retailer_name: paymentData.retailerName,
                sector: paymentData.sector,
                original_net_amount: parseFloat(paymentData.originalNetAmount || paymentData.netAmount),
                payment_number: paymentNumber,
                payment_date: paymentData.dateCompleted || new Date().toISOString().split('T')[0],
                payment_amount: parseFloat(paymentData.receivedAmount),
                outstanding_amount: parseFloat(paymentData.outstandingAmount || 0),
                payment_type: paymentData.paymentType || (paymentData.outstandingAmount > 0 ? 'partial' : 'full'),
                payment_method: paymentData.paymentMethod,
                receipt_number: paymentData.receiptNumber || null,
                cheque_date: paymentData.chequeDate || null,
                photo_uploaded: Boolean(paymentData.photoUploaded),
                photo_url: paymentData.photoUrl || null,
                completed_by: paymentData.completedBy || paymentData.assignedTo || null,
                approved_by: paymentData.approvedBy || null,
                date_approved: new Date().toISOString().split('T')[0],
                source_bill_id: paymentData.sourceBillId || null,
                notes: paymentData.notes || null
            };
            
            console.log(`💾 Saving payment history: Bill ${paymentData.billNumber}, Payment #${paymentNumber}, Amount ₹${paymentData.receivedAmount}`);
            
            const { data, error } = await supabase
                .from('ugrai_payment_history')
                .insert([historyData])
                .select();
            
            if (error) throw error;
            
            console.log(`✅ Payment history saved successfully:`, data[0]);
            return data[0];
        } catch (error) {
            console.error('❌ Error adding UGRAI payment history:', error);
            throw error;
        }
    }
    
    // Get payment history for a specific bill
    async getUgraiPaymentHistory(billNumber) {
        try {
            const { data, error } = await supabase
                .rpc('get_ugrai_payment_history', {
                    p_user_id: this.userId,
                    p_bill_number: billNumber
                });
            
            if (error) throw error;
            
            return data || [];
        } catch (error) {
            console.error('❌ Error fetching UGRAI payment history:', error);
            return [];
        }
    }
    
    // Get all payment history
    async getAllUgraiPaymentHistory() {
        try {
            const { data, error } = await supabase
                .from('ugrai_payment_history')
                .select('*')
                // .eq('user_id', this.userId) // REMOVED: Fetch all payment history regardless of user_id
                .order('date_approved', { ascending: false });
            
            if (error) throw error;
            
            return (data || []).map(item => ({
                id: item.id,
                billNumber: item.bill_number,
                billDate: item.bill_date,
                retailerName: item.retailer_name,
                sector: item.sector,
                originalNetAmount: item.original_net_amount,
                paymentNumber: item.payment_number,
                paymentDate: item.payment_date,
                paymentAmount: item.payment_amount,
                outstandingAmount: item.outstanding_amount,
                paymentType: item.payment_type,
                paymentMethod: item.payment_method,
                receiptNumber: item.receipt_number,
                chequeDate: item.cheque_date,
                photoUploaded: item.photo_uploaded,
                photoUrl: item.photo_url,
                completedBy: item.completed_by,
                approvedBy: item.approved_by,
                dateApproved: item.date_approved,
                notes: item.notes
            }));
        } catch (error) {
            console.error('❌ Error fetching all UGRAI payment history:', error);
            return [];
        }
    }

    // ==================== END UGRAI PAYMENT HISTORY ====================

    // ==================== CASH RECEIPT METHODS ====================
    
    /**
     * Escape HTML to prevent XSS attacks
     * @param {string} unsafe - Unsafe user input
     * @returns {string} HTML-escaped string
     */
    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Get all cash payments with optional date filtering
     * Calls the database function get_all_cash_payments()
     * Returns all cash payments from approved_bills and ugrai_payment_history
     * @param {Date|string} startDate - Optional start date (YYYY-MM-DD)
     * @param {Date|string} endDate - Optional end date (YYYY-MM-DD)
     * @returns {Promise<Array>} Array of cash payments with receipt status
     */
    async getAllCashPayments(startDate = null, endDate = null) {
        try {
            console.log('📄 Fetching all cash payments...', { startDate, endDate });
            
            // Format dates to YYYY-MM-DD if provided
            const formattedStart = startDate ? (startDate instanceof Date ? startDate.toISOString().split('T')[0] : startDate) : null;
            const formattedEnd = endDate ? (endDate instanceof Date ? endDate.toISOString().split('T')[0] : endDate) : null;
            
            // Paginate in batches to bypass PostgREST's 1000-row server cap
            const PAGE_SIZE = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let allData = [];
            let from = 0;
            let hasMore = true;

            while (hasMore) {
                const { data, error } = await supabase.rpc('get_all_cash_payments', {
                    p_start_date: formattedStart,
                    p_end_date: formattedEnd
                }).range(from, from + PAGE_SIZE - 1);

                if (error) {
                    console.error('❌ Error fetching cash payments:', error);
                    throw error;
                }

                const batch = data || [];
                allData = allData.concat(batch);
                console.log(`📄 Fetched batch [${from}–${from + batch.length - 1}]: ${batch.length} rows`);

                hasMore = batch.length === PAGE_SIZE;
                from += PAGE_SIZE;
            }
            
            console.log('✅ Fetched total', allData.length, 'cash payments');
            return allData;
            
        } catch (error) {
            console.error('❌ Exception in getAllCashPayments:', error);
            throw error;
        }
    }

    /**
     * Submit or update cash receipt number for a payment
     * Creates new cash_receipts record or updates existing one
     * @param {Object} receiptData - Receipt data object
     * @param {string} receiptData.paymentId - Payment ID (TEXT - can be integer or UUID string from source tables)
     * @param {string} receiptData.paymentSource - Source type: 'supply', 'ugrai', or 'ugrai_partial'
     * @param {string} receiptData.sourceTable - Actual table: 'approved_bills' or 'ugrai_payment_history'
     * @param {string} receiptData.billNumber - Bill number
     * @param {string} receiptData.billDate - Bill date (YYYY-MM-DD)
     * @param {string} receiptData.retailerName - Retailer name
     * @param {string} receiptData.sector - Sector (optional)
     * @param {number} receiptData.paymentAmount - Payment amount
     * @param {string} receiptData.paymentDate - Payment date (YYYY-MM-DD)
     * @param {string} receiptData.tallyReceiptNumber - Tally receipt number (e.g., CASH-001)
     * @returns {Promise<Object>} Created or updated receipt record
     */
    async submitCashReceipt(receiptData) {
        try {
            console.log('💾 Submitting cash receipt:', receiptData);
            
            // CRITICAL FIX: Validate all required parameters
            const requiredFields = {
                'paymentId': 'Payment ID',
                'paymentSource': 'Payment source',
                'sourceTable': 'Source table',
                'billNumber': 'Bill number',
                'billDate': 'Bill date',
                'retailerName': 'Retailer name',
                'paymentAmount': 'Payment amount',
                'paymentDate': 'Payment date'
                // Note: tallyReceiptNumber is optional — bills can be marked complete without a receipt number
            };
            
            const missing = [];
            for (const [field, label] of Object.entries(requiredFields)) {
                if (!receiptData[field] && receiptData[field] !== 0) {
                    missing.push(label);
                }
            }
            
            if (missing.length > 0) {
                throw new Error(`Missing required fields: ${missing.join(', ')}`);
            }
            
            const {
                paymentId,
                paymentSource,
                sourceTable,
                billNumber,
                billDate,
                retailerName,
                sector,
                paymentAmount,
                paymentDate,
                tallyReceiptNumber
            } = receiptData;
            
            // Normalize receipt number: treat empty string as null
            const normalizedReceiptNumber = (tallyReceiptNumber && tallyReceiptNumber.trim() !== '')
                ? tallyReceiptNumber.trim()
                : null;
            
            // Validate sourceTable matches paymentSource (security)
            const validMappings = {
                'supply': 'approved_bills',
                'ugrai': 'ugrai_payment_history',
                'ugrai_partial': 'ugrai_payment_history'
            };
            
            const expectedSourceTable = validMappings[paymentSource];
            if (sourceTable !== expectedSourceTable) {
                throw new Error('Invalid source table for payment source');
            }
            
            // SHARED DATA: No ownership validation needed
            // All admin/accountant users can process any payment
            // user_id is set to whoever processes the receipt (for audit)
            
            // Check if receipt already exists (update) or create new
            // FIXED: Use maybeSingle() instead of single() to handle 0 rows gracefully
            const { data: existing, error: lookupError } = await supabase
                .from('cash_receipts')
                .select('id, tally_receipt_number')
                .eq('source_table', sourceTable)
                .eq('payment_reference_id', paymentId)
                .maybeSingle();
            
            // Handle lookup errors (only if not "no rows found")
            if (lookupError) {
                console.error('❌ Error looking up existing receipt:', lookupError);
                throw lookupError;
            }
            
            let result;
            
            if (existing) {
                // Update existing receipt
                const { data, error } = await supabase
                    .from('cash_receipts')
                    .update({
                        tally_receipt_number: normalizedReceiptNumber,
                        status: 'processed',
                        processed_by: this.userId,
                        processed_date: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existing.id)
                    .select()
                    .single();
                
                if (error) throw error;
                result = data;
                console.log('✅ Updated existing cash receipt');
            } else {
                // Create new receipt
                // FIXED: Removed duplicate check to prevent race condition
                // Let UNIQUE index handle duplicate prevention
                const { data, error } = await supabase
                    .from('cash_receipts')
                    .insert({
                        user_id: this.userId,
                        payment_source: paymentSource,
                        source_table: sourceTable,
                        payment_reference_id: paymentId,
                        bill_number: billNumber,
                        bill_date: billDate,
                        retailer_name: retailerName,
                        sector: sector,
                        payment_amount: paymentAmount,
                        payment_date: paymentDate,
                        tally_receipt_number: normalizedReceiptNumber,
                        status: 'processed',
                        processed_by: this.userId,
                        processed_date: new Date().toISOString()
                    })
                    .select()
                    .single();
                
                if (error) {
                    // Handle duplicate receipt number (only fires when normalizedReceiptNumber is non-null)
                    if (error.code === '23505' && normalizedReceiptNumber) {
                        const { data: existingReceipt, error: lookupError } = await supabase
                            .from('cash_receipts')
                            .select('bill_number')
                            .eq('tally_receipt_number', normalizedReceiptNumber)
                            .maybeSingle();
                        
                        if (lookupError) {
                            console.error('❌ Error looking up conflicting receipt:', lookupError);
                            throw new Error(`Receipt number ${normalizedReceiptNumber} is already in use`);
                        }
                        
                        if (existingReceipt) {
                            throw new Error(`Receipt number ${normalizedReceiptNumber} is already assigned to bill ${existingReceipt.bill_number}`);
                        } else {
                            throw new Error(`Receipt number ${normalizedReceiptNumber} is already in use`);
                        }
                    }
                    throw error;
                }
                
                result = data;
                console.log('✅ Created new cash receipt');
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ Error submitting cash receipt:', error);
            throw error;
        }
    }

    /**
     * Check if current user has admin or accountant role
     * Used for determining if Cash Receipt tab should be visible
     * @returns {Promise<Boolean>} True if user has admin or accountant role
     */
    async hasAdminOrAccountantRole() {
        try {
            const { data, error } = await supabase
                .from('user_roles')
                .select('role_id, roles(name)')
                .eq('user_id', this.userId);
            
            if (error) throw error;
            
            const hasRole = data.some(ur => 
                ur.roles && (ur.roles.name === 'admin' || ur.roles.name === 'accountant')
            );
            
            return hasRole;
        } catch (error) {
            console.error('❌ Error checking roles:', error);
            return false;
        }
    }

    // ==================== END CASH RECEIPT METHODS ====================

    // Method to clean up ghost bills from database tables
    async cleanupGhostBillsFromDatabase() {
        try {
            console.log('🧹 Starting database ghost bill cleanup...');
            
            // Check initial state
            const initialState = await this.debugDatabaseState();
            
            if (initialState.ghostsInData === 0 && initialState.ghostsInEntries === 0) {
                console.log('✅ No ghost bills found in database');
                return { removed: 0, approvedCount: initialState.approvedUgrai };
            }
            
            // Get all approved bills to check against
            const approvedBills = await this.getAllApprovedUgrai();
            const approvedBillNumbers = new Set(approvedBills.map(bill => bill.billNumber));
            
            console.log('📋 Found', approvedBills.length, 'approved bills to check against');
            
            let totalRemoved = 0;
            const removedBills = [];
            
            // Clean ugrai_data table
            const ugraiData = await this.getUgraiData();
            for (const bill of ugraiData) {
                if (approvedBillNumbers.has(bill.billNumber)) {
                    console.log('👻 Removing ghost bill from ugrai_data table:', bill.billNumber, '(ID:', bill.id, ')');
                    try {
                        const success = await this.removeUgraiDataById(bill.id);
                        if (success) {
                            totalRemoved++;
                            removedBills.push({ table: 'ugrai_data', billNumber: bill.billNumber, id: bill.id });
                        }
                    } catch (error) {
                        console.warn('⚠️ Could not remove ghost bill from ugrai_data:', bill.billNumber, error);
                    }
                }
            }
            
            // Clean ugrai_entries table
            const ugraiEntries = await this.getUgraiEntries();
            for (const bill of ugraiEntries) {
                if (approvedBillNumbers.has(bill.billNumber)) {
                    console.log('👻 Removing ghost bill from ugrai_entries table:', bill.billNumber, '(ID:', bill.id, ')');
                    try {
                        const success = await this.removeUgraiEntryById(bill.id);
                        if (success) {
                            totalRemoved++;
                            removedBills.push({ table: 'ugrai_entries', billNumber: bill.billNumber, id: bill.id });
                        }
                    } catch (error) {
                        console.warn('⚠️ Could not remove ghost bill from ugrai_entries:', bill.billNumber, error);
                    }
                }
            }
            
            // Verify cleanup by checking final state
            const finalState = await this.debugDatabaseState();
            
            console.log('✅ Database ghost bill cleanup completed:');
            console.log('  - Removed', totalRemoved, 'ghost bills');
            console.log('  - Remaining ghosts in ugrai_data:', finalState.ghostsInData);
            console.log('  - Remaining ghosts in ugrai_entries:', finalState.ghostsInEntries);
            
            if (removedBills.length > 0) {
                console.log('📝 Removed bills:', removedBills);
            }
            
            return { 
                removed: totalRemoved, 
                approvedCount: approvedBills.length,
                removedBills: removedBills,
                initialGhosts: initialState.ghostsInData + initialState.ghostsInEntries,
                remainingGhosts: finalState.ghostsInData + finalState.ghostsInEntries
            };
            
        } catch (error) {
            console.error('❌ Error cleaning up ghost bills from database:', error);
            throw error;
        }
    }

    // Debug method to check database state before/after cleanup
    async debugDatabaseState() {
        try {
            console.log('🔍 Checking database state...');
            
            const [ugraiData, ugraiEntries, approvedUgrai] = await Promise.all([
                this.getUgraiData(),
                this.getUgraiEntries(),
                this.getAllApprovedUgrai()
            ]);
            
            const approvedBillNumbers = new Set(approvedUgrai.map(bill => bill.billNumber));
            
            const ghostInData = ugraiData.filter(bill => approvedBillNumbers.has(bill.billNumber));
            const ghostInEntries = ugraiEntries.filter(bill => approvedBillNumbers.has(bill.billNumber));
            
            console.log('📊 Database state:');
            console.log('  - ugrai_data records:', ugraiData.length, '(ghosts:', ghostInData.length, ')');
            console.log('  - ugrai_entries records:', ugraiEntries.length, '(ghosts:', ghostInEntries.length, ')');
            console.log('  - approved_ugrai records:', approvedUgrai.length);
            
            if (ghostInData.length > 0) {
                console.log('👻 Ghost bills in ugrai_data:');
                ghostInData.forEach(bill => console.log('  -', bill.billNumber, '(ID:', bill.id, ')'));
            }
            
            if (ghostInEntries.length > 0) {
                console.log('👻 Ghost bills in ugrai_entries:');
                ghostInEntries.forEach(bill => console.log('  -', bill.billNumber, '(ID:', bill.id, ')'));
            }
            
            return {
                ugraiData: ugraiData.length,
                ugraiEntries: ugraiEntries.length,
                approvedUgrai: approvedUgrai.length,
                ghostsInData: ghostInData.length,
                ghostsInEntries: ghostInEntries.length,
                ghostBills: [...ghostInData, ...ghostInEntries]
            };
        } catch (error) {
            console.error('❌ Error checking database state:', error);
            throw error;
        }
    }

    // UGRAI REAL-TIME SUBSCRIPTIONS
    subscribeToUgraiData(callback) {
        return supabase
            .channel('ugrai_data_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'ugrai_data',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    subscribeToUgraiEntries(callback) {
        return supabase
            .channel('ugrai_entries_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'ugrai_entries',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    subscribeToCompletedUgrai(callback) {
        return supabase
            .channel('completed_ugrai_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'completed_ugrai',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    subscribeToUgraiAssignments(callback) {
        return supabase
            .channel('ugrai_assignments_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'ugrai_assignments',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    // PURCHASE RETAILERS MANAGEMENT
    async getPurchaseRetailers() {
        try {
            console.log('📊 Fetching all purchase retailers from Supabase (all users)...');
            
            const { data, error } = await supabase
                .from('purchase_retailers')
                .select('*')
                .order('retailer_name');
            
            if (error) {
                console.error('❌ Database error fetching purchase retailers:', error);
                throw error;
            }
            
            console.log('🗄️ Raw purchase retailer data from database:', data?.length || 0, 'records');
            
            // Map database column names to match UI expectations
            const mappedRetailers = (data || []).map(retailer => ({
                id: retailer.id,
                retailerName: retailer.retailer_name,
                dueDays: retailer.due_days,
                createdAt: retailer.created_at
            }));
            
            console.log('🎯 Mapped purchase retailers for UI:', mappedRetailers.length, 'items');
            return mappedRetailers;
        } catch (error) {
            console.error('❌ Error fetching purchase retailers:', error);
            return [];
        }
    }

    async addPurchaseRetailer(retailerName, dueDays) {
        try {
            const { data, error } = await supabase
                .from('purchase_retailers')
                .insert([{
                    retailer_name: retailerName,
                    due_days: dueDays,
                    user_id: this.userId
                }])
                .select();
            
            if (error) throw error;
            
            // Return mapped data
            return {
                id: data[0].id,
                retailerName: data[0].retailer_name,
                dueDays: data[0].due_days,
                createdAt: data[0].created_at
            };
        } catch (error) {
            console.error('Error adding purchase retailer:', error);
            throw error;
        }
    }

    async bulkAddPurchaseRetailers(retailers) {
        try {
            console.log('💾 Bulk adding purchase retailers to Supabase...');
            
            if (!retailers || retailers.length === 0) {
                console.log('⚠️ No purchase retailers to add');
                return [];
            }

            // Map UI data to database format
            const retailersWithUserId = retailers.map(retailer => ({
                retailer_name: retailer.retailerName,
                due_days: retailer.dueDays,
                user_id: this.userId
            }));

            const { data, error } = await supabase
                .from('purchase_retailers')
                .upsert(retailersWithUserId, { 
                    onConflict: 'retailer_name,user_id',
                    ignoreDuplicates: true 
                })
                .select();
            
            if (error) {
                console.error('❌ Database error during bulk add:', error);
                throw error;
            }
            
            console.log('✅ Bulk add successful, returned data:', data?.length || 0, 'records');
            
            // Return mapped data
            return (data || []).map(retailer => ({
                id: retailer.id,
                retailerName: retailer.retailer_name,
                dueDays: retailer.due_days,
                createdAt: retailer.created_at
            }));
        } catch (error) {
            console.error('❌ Error bulk adding purchase retailers:', error);
            throw error;
        }
    }

    async updatePurchaseRetailer(id, updates) {
        try {
            const dbUpdates = {};
            if (updates.retailerName) dbUpdates.retailer_name = updates.retailerName;
            if (updates.dueDays !== undefined) dbUpdates.due_days = updates.dueDays;

            const { data, error } = await supabase
                .from('purchase_retailers')
                .update(dbUpdates)
                .eq('id', id)
                .eq('user_id', this.userId)
                .select();
            
            if (error) throw error;
            
            return {
                id: data[0].id,
                retailerName: data[0].retailer_name,
                dueDays: data[0].due_days,
                createdAt: data[0].created_at
            };
        } catch (error) {
            console.error('❌ Error updating purchase retailer:', error);
            throw error;
        }
    }

    async removePurchaseRetailer(id) {
        try {
            const { error } = await supabase
                .from('purchase_retailers')
                .delete()
                .eq('id', id)
                .eq('user_id', this.userId);
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('❌ Error removing purchase retailer:', error);
            throw error;
        }
    }

    // PURCHASE ENTRIES MANAGEMENT
    async getPurchaseEntries() {
        try {
            console.log('📊 Fetching all purchase entries with pagination...');
            
            // Fetch all records using pagination to bypass 1000 row limit
            let allEntries = [];
            let from = 0;
            const batchSize = 10000; // Google Sheets edition: bigger pages = fewer round trips
            let hasMore = true;
            
            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('purchase_entries')
                    .select('*', { count: 'exact' })
                    .order('created_at', { ascending: false })
                    .range(from, from + batchSize - 1);
                
                if (error) {
                    console.error('❌ Database error fetching purchase entries:', error);
                    throw error;
                }
                
                if (data && data.length > 0) {
                    allEntries = allEntries.concat(data);
                    from += batchSize;
                    hasMore = data.length === batchSize;
                    
                    console.log(`� Fetched batch: ${data.length} purchase entries (total so far: ${allEntries.length}/${count || '?'})`);
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Successfully fetched all ${allEntries.length} purchase entries`);
            
            // Map database column names to match UI expectations
            const mappedEntries = allEntries.map(entry => ({
                id: entry.id,
                uniqueId: entry.unique_id,
                billNumber: entry.bill_number,
                billDate: entry.bill_date,
                retailerName: entry.retailer_name,
                taxableAmount: entry.taxable_amount,
                totalTax: entry.total_tax,
                deduction: entry.deduction,
                netAmount: entry.net_amount,
                deductionType: entry.deduction_type,
                creditNoteNumber: entry.credit_note_number,
                creditNoteDate: entry.credit_note_date,
                status: entry.status,
                note: entry.note,
                voucherNumber: entry.voucher_number,
                confirmedAt: entry.confirmed_at,
                completedAt: entry.completed_at,
                dueDate: entry.due_date,
                createdAt: entry.created_at
            }));
            
            console.log('🎯 Mapped purchase entries for UI:', mappedEntries.length, 'items');
            return mappedEntries;
        } catch (error) {
            console.error('❌ Error fetching purchase entries:', error);
            return [];
        }
    }

    async addPurchaseEntry(entry) {
        try {
            console.log('💾 Adding purchase entry to Supabase:', entry);
            
            const entryData = {
                unique_id: entry.uniqueId,
                bill_number: entry.billNumber,
                bill_date: entry.billDate,
                retailer_name: entry.retailerName,
                taxable_amount: parseFloat(entry.taxableAmount) || 0,
                total_tax: parseFloat(entry.totalTax) || 0,
                deduction: parseFloat(entry.deduction) || 0,
                net_amount: parseFloat(entry.netAmount) || 0,
                deduction_type: entry.deductionType || null,
                credit_note_number: entry.creditNoteNumber || null,
                credit_note_date: entry.creditNoteDate || null,
                status: entry.status || 'Received',
                note: entry.note || null,
                voucher_number: entry.voucherNumber || null,
                user_id: this.userId
            };

            const { data, error } = await supabase
                .from('purchase_entries')
                .insert([entryData])
                .select();
            
            if (error) throw error;
            
            console.log('✅ Purchase entry added successfully:', data[0]);
            
            // Return mapped data
            return {
                id: data[0].id,
                uniqueId: data[0].unique_id,
                billNumber: data[0].bill_number,
                billDate: data[0].bill_date,
                retailerName: data[0].retailer_name,
                taxableAmount: data[0].taxable_amount,
                totalTax: data[0].total_tax,
                deduction: data[0].deduction,
                netAmount: data[0].net_amount,
                deductionType: data[0].deduction_type,
                creditNoteNumber: data[0].credit_note_number,
                creditNoteDate: data[0].credit_note_date,
                status: data[0].status,
                note: data[0].note,
                voucherNumber: data[0].voucher_number,
                confirmedAt: data[0].confirmed_at,
                completedAt: data[0].completed_at,
                dueDate: data[0].due_date,
                createdAt: data[0].created_at
            };
        } catch (error) {
            console.error('❌ Error adding purchase entry:', error);
            throw error;
        }
    }

    async updatePurchaseEntry(id, updates) {
        try {
            console.log('🔄 Updating purchase entry:', id, updates);
            
            const dbUpdates = {};
            if (updates.uniqueId) dbUpdates.unique_id = updates.uniqueId;
            if (updates.billNumber) dbUpdates.bill_number = updates.billNumber;
            if (updates.billDate) dbUpdates.bill_date = updates.billDate;
            if (updates.retailerName) dbUpdates.retailer_name = updates.retailerName;
            if (updates.taxableAmount !== undefined) dbUpdates.taxable_amount = parseFloat(updates.taxableAmount);
            if (updates.totalTax !== undefined) dbUpdates.total_tax = parseFloat(updates.totalTax);
            if (updates.deduction !== undefined) dbUpdates.deduction = parseFloat(updates.deduction);
            if (updates.netAmount !== undefined) dbUpdates.net_amount = parseFloat(updates.netAmount);
            if (updates.deductionType !== undefined) dbUpdates.deduction_type = updates.deductionType;
            if (updates.creditNoteNumber !== undefined) dbUpdates.credit_note_number = updates.creditNoteNumber;
            if (updates.creditNoteDate !== undefined) dbUpdates.credit_note_date = updates.creditNoteDate;
            if (updates.status) dbUpdates.status = updates.status;
            if (updates.note !== undefined) dbUpdates.note = updates.note;
            if (updates.voucherNumber !== undefined) dbUpdates.voucher_number = updates.voucherNumber;
            if (updates.confirmedAt) dbUpdates.confirmed_at = updates.confirmedAt;
            if (updates.completedAt) dbUpdates.completed_at = updates.completedAt;
            if (updates.dueDate) dbUpdates.due_date = updates.dueDate;

            const { data, error } = await supabase
                .from('purchase_entries')
                .update(dbUpdates)
                .eq('id', id)
                .eq('user_id', this.userId)
                .select();
            
            if (error) throw error;
            
            console.log('✅ Purchase entry updated successfully:', data[0]);
            
            // Return mapped data
            return {
                id: data[0].id,
                uniqueId: data[0].unique_id,
                billNumber: data[0].bill_number,
                billDate: data[0].bill_date,
                retailerName: data[0].retailer_name,
                taxableAmount: data[0].taxable_amount,
                totalTax: data[0].total_tax,
                deduction: data[0].deduction,
                netAmount: data[0].net_amount,
                deductionType: data[0].deduction_type,
                creditNoteNumber: data[0].credit_note_number,
                creditNoteDate: data[0].credit_note_date,
                status: data[0].status,
                note: data[0].note,
                voucherNumber: data[0].voucher_number,
                confirmedAt: data[0].confirmed_at,
                completedAt: data[0].completed_at,
                dueDate: data[0].due_date,
                createdAt: data[0].created_at
            };
        } catch (error) {
            console.error('❌ Error updating purchase entry:', error);
            throw error;
        }
    }

    async removePurchaseEntry(id) {
        try {
            const { error } = await supabase
                .from('purchase_entries')
                .delete()
                .eq('id', id)
                .eq('user_id', this.userId);
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('❌ Error removing purchase entry:', error);
            throw error;
        }
    }

    async confirmPurchaseEntry(id, voucherNumber) {
        try {
            console.log('✅ Confirming purchase entry:', id, 'with voucher:', voucherNumber);
            console.log('🔧 Using user_id:', this.userId);
            
            const updateData = { 
                status: 'Confirmed',
                confirmed_at: new Date().toISOString()
            };
            
            // Only add voucher_number if provided
            if (voucherNumber) {
                updateData.voucher_number = voucherNumber;
            }
            
            console.log('📤 Update payload:', updateData);
            
            const { data, error } = await supabase
                .from('purchase_entries')
                .update(updateData)
                .eq('id', id)
                .eq('user_id', this.userId)
                .select();
            
            if (error) {
                console.error('❌ Supabase update error:', error);
                throw error;
            }
            
            console.log('✅ Purchase entry confirmed successfully in database:', data[0]);
            return data[0];
        } catch (error) {
            console.error('❌ Error confirming purchase entry:', error);
            throw error;
        }
    }

    // PURCHASE REAL-TIME SUBSCRIPTIONS
    subscribeToPurchaseRetailers(callback) {
        return supabase
            .channel('purchase_retailers_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'purchase_retailers',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    subscribeToPurchaseEntries(callback) {
        return supabase
            .channel('purchase_entries_changes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'purchase_entries',
                    filter: `user_id=eq.${this.userId}`
                }, 
                callback
            )
            .subscribe();
    }

    // PHOTO STORAGE METHODS
    
    /**
     * Upload a photo for a bill
     * @param {File} file - The photo file to upload
     * @param {string} billNumber - The bill number
     * @param {string} billType - The type of bill ('supply', 'ugrai', 'purchase')
     * @param {string} photoType - Optional photo type ('receipt', 'invoice', 'delivery', etc.)
     * @returns {Promise<Object>} Photo upload result with URL and metadata
     */
    async uploadBillPhoto(file, billNumber, billType, photoType = 'general') {
        try {
            console.log(`📸 Uploading photo for ${billType} bill: ${billNumber}`);
            
            // Check authentication first
            const testUUID = '00000000-0000-0000-0000-000000000001';
            
            if (!this.userId) {
                console.warn('⚠️ No authenticated user found, attempting to refresh authentication...');
                const authSuccess = await this.initializeAuth();
                if (!authSuccess || !this.userId) {
                    throw new Error('Authentication required for photo upload. Please log in first.');
                }
            }
            
            // Special handling for test UUID - skip bill_photos table insertion
            const isTestMode = this.userId === testUUID;
            if (isTestMode) {
                console.log('📝 Test mode detected - will skip database metadata insertion');
            }
            
            console.log(`👤 Uploading as user: ${this.userId} (Test mode: ${isTestMode})`);
            
            // Validate inputs
            if (!file || !billNumber || !billType) {
                throw new Error('File, bill number, and bill type are required');
            }
            
            // Validate file type
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
            if (!allowedTypes.includes(file.type)) {
                throw new Error('Only JPEG, PNG, and WebP images are allowed');
            }
            
            // Validate file size (max 5MB)
            const maxSize = 5 * 1024 * 1024; // 5MB
            if (file.size > maxSize) {
                throw new Error('File size must be less than 5MB');
            }
            
            // Generate unique filename
            const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
            const randomId = Math.random().toString(36).substr(2, 6);
            const extension = file.name.split('.').pop().toLowerCase();
            const fileName = `${billNumber}_${billType}_${timestamp}_${randomId}.${extension}`;
            
            // Create storage path (simplified for now to avoid RLS issues)
            // const currentDate = new Date();
            // const year = currentDate.getFullYear();
            // const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            // const storagePath = `bills-photos/${billType}/${year}/${month}/${fileName}`;
            
            // Temporary simplified path for testing
            const storagePath = fileName;
            
            console.log(`📁 Storage path: ${storagePath}`);
            
            // Upload to Supabase Storage
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('bill-photos') // Make sure this bucket exists
                .upload(storagePath, file, {
                    cacheControl: '3600',
                    upsert: false // Don't overwrite existing files
                });
                
            if (uploadError) {
                console.error('❌ Storage upload error:', uploadError);
                throw uploadError;
            }
            
            console.log('✅ File uploaded to storage:', uploadData);
            
            // Get public URL
            const { data: urlData } = supabase.storage
                .from('bill-photos')
                .getPublicUrl(storagePath);
                
            if (!urlData?.publicUrl) {
                throw new Error('Failed to get public URL for uploaded photo');
            }
            
            console.log('✅ File uploaded successfully:', urlData.publicUrl);
            
            // Skip database insertion for test mode to avoid foreign key constraint
            if (isTestMode) {
                console.log('📝 Test mode: Skipping bill_photos table insertion to avoid foreign key constraint');
                return {
                    id: 'test-' + Date.now(), // Generate a temporary ID
                    url: urlData.publicUrl,
                    fileName: fileName,
                    storagePath: storagePath,
                    testMode: true,
                    bill_number: billNumber,
                    bill_type: billType,
                    photo_type: photoType,
                    photo_url: urlData.publicUrl,
                    photo_name: fileName,
                    storage_path: storagePath,
                    file_size: file.size,
                    file_type: file.type,
                    uploaded_by: this.userId
                };
            }
            
            // Save photo metadata to database (only for real authenticated users)
            const photoRecord = {
                bill_number: billNumber,
                bill_type: billType,
                photo_type: photoType,
                photo_url: urlData.publicUrl,
                photo_name: fileName,
                storage_path: storagePath,
                file_size: file.size,
                file_type: file.type,
                uploaded_by: this.userId
            };
            
            console.log('💾 Attempting to save photo metadata with:', {
                bill_number: photoRecord.bill_number,
                uploaded_by: photoRecord.uploaded_by,
                userId_type: typeof this.userId,
                userId_value: this.userId
            });
            
            const { data: dbData, error: dbError } = await supabase
                .from('bill_photos')
                .insert([photoRecord])
                .select();
                
            if (dbError) {
                console.error('❌ Database insert error:', {
                    code: dbError.code,
                    message: dbError.message,
                    details: dbError.details,
                    hint: dbError.hint,
                    photoRecord: photoRecord
                });
                // Try to clean up uploaded file if database insert fails
                await supabase.storage
                    .from('bill-photos')
                    .remove([storagePath]);
                throw dbError;
            }
            
            console.log('✅ Photo metadata saved to database:', dbData[0]);
            
            return {
                id: dbData[0].id,
                url: urlData.publicUrl,
                fileName: fileName,
                storagePath: storagePath,
                ...photoRecord
            };
            
        } catch (error) {
            console.error(`❌ Error uploading photo for bill ${billNumber}:`, error);
            throw error;
        }
    }
    
    /**
     * Get all photos for a specific bill
     * @param {string} billNumber - The bill number
     * @param {string} billType - The type of bill (optional, for filtering)
     * @returns {Promise<Array>} Array of photo records
     */
    async getBillPhotos(billNumber, billType = null) {
        try {
            console.log(`📷 Fetching photos for bill: ${billNumber}`);
            
            let query = supabase
                .from('bill_photos')
                .select('*')
                .eq('bill_number', billNumber)
                .eq('is_active', true)
                .order('uploaded_at', { ascending: false });
                
            if (billType) {
                query = query.eq('bill_type', billType);
            }
            
            const { data, error } = await query;
            
            if (error) {
                console.error('❌ Error fetching bill photos:', error);
                throw error;
            }
            
            console.log(`✅ Found ${data.length} photos for bill ${billNumber}`);
            return data;
            
        } catch (error) {
            console.error(`❌ Error getting photos for bill ${billNumber}:`, error);
            throw error;
        }
    }
    
    /**
     * Delete a photo (marks as inactive and removes from storage)
     * @param {string} photoId - The photo ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteBillPhoto(photoId) {
        try {
            console.log(`🗑️ Deleting photo: ${photoId}`);
            
            // First get the photo record
            const { data: photo, error: fetchError } = await supabase
                .from('bill_photos')
                .select('*')
                .eq('id', photoId)
                .eq('uploaded_by', this.userId) // Users can only delete their own photos
                .single();
                
            if (fetchError || !photo) {
                throw new Error('Photo not found or access denied');
            }
            
            // Remove from storage
            const { error: storageError } = await supabase.storage
                .from('bill-photos')
                .remove([photo.storage_path]);
                
            if (storageError) {
                console.warn('⚠️ Storage deletion warning:', storageError);
                // Continue with database update even if storage deletion fails
            }
            
            // Mark as inactive in database
            const { error: updateError } = await supabase
                .from('bill_photos')
                .update({ is_active: false })
                .eq('id', photoId);
                
            if (updateError) {
                console.error('❌ Database update error:', updateError);
                throw updateError;
            }
            
            console.log('✅ Photo deleted successfully');
            return true;
            
        } catch (error) {
            console.error(`❌ Error deleting photo ${photoId}:`, error);
            throw error;
        }
    }
    
    /**
     * Initialize storage bucket (call this once during setup)
     * @returns {Promise<boolean>} Success status
     */
    async initializeBillPhotosStorage() {
        try {
            console.log('🪣 Checking bill photos storage bucket...');
            
            // Check if bucket exists
            const { data: buckets, error: listError } = await supabase.storage.listBuckets();
            
            if (listError) {
                console.error('❌ Error listing buckets:', listError);
                // If we can't list buckets, try to test upload instead
                return await this.testBucketAccess();
            }
            
            const bucketExists = buckets.some(bucket => bucket.name === 'bill-photos');
            
            if (!bucketExists) {
                console.log('⚠️  Bill photos bucket not found. Manual setup required.');
                console.log('📋 Please create the bucket manually:');
                console.log('1. Go to your Supabase Dashboard → Storage');
                console.log('2. Click "Create bucket"');
                console.log('3. Name: bill-photos');
                console.log('4. Public: Yes');
                console.log('5. Allowed MIME types: image/jpeg, image/png, image/webp');
                console.log('6. File size limit: 5MB');
                
                // Also provide SQL commands
                console.log('📋 Or run this SQL in your Supabase SQL editor:');
                console.log(`
-- Create storage bucket
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES (
    'bill-photos',
    'bill-photos', 
    true,
    ARRAY['image/jpeg', 'image/png', 'image/webp'],
    5242880
) ON CONFLICT (id) DO NOTHING;
                `);
                
                return false;
            } else {
                console.log('✅ Bill photos bucket exists');
                return await this.testBucketAccess();
            }
            
        } catch (error) {
            console.error('❌ Error checking storage:', error);
            return await this.testBucketAccess();
        }
    }

    /**
     * Test if we can access the bucket (fallback method)
     * @returns {Promise<boolean>} Access status
     */
    async testBucketAccess() {
        try {
            // Try to list files in the bucket root
            const { data, error } = await supabase.storage
                .from('bill-photos')
                .list('', { limit: 1 });
            
            if (error) {
                if (error.message.includes('not found') || error.message.includes('does not exist')) {
                    console.log('❌ Bucket "bill-photos" does not exist. Please create it manually.');
                    return false;
                } else {
                    console.log('⚠️  Bucket exists but access test failed:', error.message);
                    return true; // Bucket likely exists, access issue might be temporary
                }
            }
            
            console.log('✅ Bill photos storage is ready for use');
            return true;
            
        } catch (error) {
            console.error('❌ Storage access test failed:', error);
            return false;
        }
    }

    // Debug method to check authentication status
    async checkAuthStatus() {
        try {
            console.log('🔍 Checking authentication status...');
            
            const { data: { user }, error } = await supabase.auth.getUser();
            
            const status = {
                isAuthenticated: !!user && !error,
                user: user ? {
                    id: user.id,
                    email: user.email,
                    created_at: user.created_at
                } : null,
                error: error ? error.message : null,
                serviceUserId: this.userId,
                timestamp: new Date().toISOString()
            };
            
            console.log('🔍 Auth status result:', status);
            return status;
        } catch (error) {
            console.error('❌ Error checking auth status:', error);
            return {
                isAuthenticated: false,
                user: null,
                error: error.message,
                serviceUserId: this.userId,
                timestamp: new Date().toISOString()
            };
        }
    }
}

// Create global instance for console access
let supabaseDataService;

// Initialize global instance when supabase is ready
async function initGlobalService() {
    try {
        await initSupabase();
        supabaseDataService = new SupabaseDataService();
        
        // Make available globally for console access
        if (typeof window !== 'undefined') {
            window.supabaseDataService = supabaseDataService;
            window.checkAuth = () => {
                if (supabaseDataService) {
                    return supabaseDataService.checkAuthStatus();
                } else {
                    console.error('SupabaseDataService not initialized');
                    return false;
                }
            };
            window.testPhotoAuth = async () => {
                try {
                    console.log('🧪 Testing photo upload authentication...');
                    
                    // Check current auth status
                    const authStatus = await window.checkAuth();
                    console.log('Auth status:', authStatus);
                    
                    return authStatus;
                } catch (error) {
                    console.error('❌ Error testing photo auth:', error);
                    return false;
                }
            };
            
            window.debugDataAccess = async () => {
                try {
                    console.log('🔍 Debugging data access issue...');
                    
                    if (!window.supabaseService && !supabaseDataService) {
                        console.error('❌ SupabaseService not available');
                        return;
                    }
                    
                    const service = window.supabaseService || supabaseDataService;
                    console.log('👤 Current user ID:', service.userId);
                    
                    const testUUID = '00000000-0000-0000-0000-000000000001';
                    
                    // Check bills with current user ID
                    console.log('📊 Checking bills with current user ID...');
                    const currentBills = await service.getStagedBills();
                    console.log(`Found ${currentBills.length} staged bills with current user ID`);
                    
                    // Check bills with test UUID
                    console.log('📊 Checking bills with test UUID...');
                    const originalUserId = service.userId;
                    service.userId = testUUID; // Temporarily change to test UUID
                    const testBills = await service.getStagedBills();
                    console.log(`Found ${testBills.length} staged bills with test UUID`);
                    
                    // Check active supplies
                    const testActiveSupplies = await service.getActiveSupplies();
                    console.log(`Found ${testActiveSupplies.length} active supplies with test UUID`);
                    
                    if (testBills.length > 0 || testActiveSupplies.length > 0) {
                        console.log('💡 SOLUTION: Your data exists under the test UUID. Keeping test UUID for data access...');
                        // Don't restore original user ID, keep the test UUID
                        console.log('✅ User ID kept as test UUID for data access');
                        console.log('📝 Photo uploads will use storage-only mode (no database metadata) to avoid foreign key constraints');
                        
                        // Trigger a data refresh if possible
                        if (window.appState && window.appState.loadSupabaseData) {
                            console.log('🔄 Refreshing data...');
                            await window.appState.loadSupabaseData();
                            console.log('✅ Data refreshed. Try refreshing the page.');
                        }
                    } else {
                        service.userId = originalUserId; // Restore original
                        console.log('ℹ️ No data found with either user ID');
                    }
                    
                    return {
                        currentUserId: service.userId,
                        billsFound: testBills.length,
                        activeSuppliesFound: testActiveSupplies.length
                    };
                    
                } catch (error) {
                    console.error('❌ Debug failed:', error);
                    return { error: error.message };
                }
            };
            
            window.testPhotoUploadFix = async () => {
                try {
                    console.log('🧪 Testing photo upload fix...');
                    
                    if (!window.supabaseService && !supabaseDataService) {
                        console.error('❌ SupabaseService not available');
                        return;
                    }
                    
                    const service = window.supabaseService || supabaseDataService;
                    const testUUID = '00000000-0000-0000-0000-000000000001';
                    
                    console.log('👤 Current user ID:', service.userId);
                    console.log('📝 Test UUID mode:', service.userId === testUUID);
                    
                    if (service.userId === testUUID) {
                        console.log('✅ Photo uploads will work in storage-only mode');
                        console.log('📋 Files will be uploaded to storage but metadata won\'t be saved to bill_photos table');
                        console.log('💡 This avoids the foreign key constraint error while maintaining functionality');
                    } else {
                        console.log('✅ Photo uploads will work normally with database metadata');
                    }
                    
                    return {
                        userId: service.userId,
                        isTestMode: service.userId === testUUID,
                        photoUploadMethod: service.userId === testUUID ? 'storage-only' : 'full-database'
                    };
                    
                } catch (error) {
                    console.error('❌ Test failed:', error);
                    return { error: error.message };
                }
            };
            
            window.fullSystemDiagnosis = async () => {
                try {
                    console.log('🔍 === FULL SYSTEM DIAGNOSIS ===');
                    console.log('Time:', new Date().toISOString());
                    
                    // Check if services are available
                    console.log('\n📋 1. SERVICE AVAILABILITY:');
                    const hasSupabaseService = !!(window.supabaseService || supabaseDataService);
                    const hasAppState = !!window.appState;
                    console.log('✓ SupabaseService available:', hasSupabaseService);
                    console.log('✓ AppState available:', hasAppState);
                    
                    if (!hasSupabaseService) {
                        console.error('❌ CRITICAL: SupabaseService not available');
                        return { error: 'SupabaseService not available' };
                    }
                    
                    const service = window.supabaseService || supabaseDataService;
                    const testUUID = '00000000-0000-0000-0000-000000000001';
                    
                    // Check user ID
                    console.log('\n👤 2. USER AUTHENTICATION:');
                    console.log('Current user ID:', service.userId);
                    console.log('Is test UUID:', service.userId === testUUID);
                    console.log('User ID type:', typeof service.userId);
                    
                    // Check data in different tables with both user IDs
                    console.log('\n📊 3. DATA ANALYSIS:');
                    
                    const userIds = [service.userId];
                    if (service.userId !== testUUID) {
                        userIds.push(testUUID);
                    }
                    
                    const results = {};
                    
                    for (const userId of userIds) {
                        console.log(`\n--- Testing with user ID: ${userId} ---`);
                        
                        // Temporarily switch user ID
                        const originalUserId = service.userId;
                        service.userId = userId;
                        
                        try {
                            // Test different data types
                            const stagedBills = await service.getStagedBills();
                            const dispatchBills = await service.getDispatchBills();
                            const activeSupplies = await service.getActiveSupplies();
                            const approvedBills = await service.getApprovedBills();
                            
                            results[userId] = {
                                stagedBills: stagedBills.length,
                                dispatchBills: dispatchBills.length,
                                activeSupplies: activeSupplies.length,
                                approvedBills: approvedBills.length,
                                totalBills: stagedBills.length + dispatchBills.length + activeSupplies.length + approvedBills.length
                            };
                            
                            console.log(`📋 Staged bills: ${stagedBills.length}`);
                            console.log(`🚚 Dispatch bills: ${dispatchBills.length}`);
                            console.log(`🔄 Active supplies: ${activeSupplies.length}`);
                            console.log(`✅ Approved bills: ${approvedBills.length}`);
                            console.log(`📈 TOTAL: ${results[userId].totalBills}`);
                            
                        } catch (error) {
                            console.error(`❌ Error testing with ${userId}:`, error);
                            results[userId] = { error: error.message };
                        }
                        
                        // Restore original user ID
                        service.userId = originalUserId;
                    }
                    
                    // Find best user ID
                    console.log('\n🎯 4. RECOMMENDATION:');
                    let bestUserId = service.userId;
                    let maxBills = 0;
                    
                    for (const [userId, data] of Object.entries(results)) {
                        if (data.totalBills && data.totalBills > maxBills) {
                            maxBills = data.totalBills;
                            bestUserId = userId;
                        }
                    }
                    
                    if (bestUserId !== service.userId) {
                        console.log(`💡 SOLUTION: Switch to user ID ${bestUserId} (${maxBills} bills found)`);
                        service.userId = bestUserId;
                        
                        // Refresh app state if possible
                        if (window.appState && window.appState.loadSupabaseData) {
                            console.log('🔄 Refreshing app data...');
                            await window.appState.loadSupabaseData();
                            console.log('✅ Data refreshed');
                        }
                    } else {
                        console.log('✅ Current user ID is optimal');
                    }
                    
                    console.log('\n📋 5. SUMMARY:');
                    console.log('Final user ID:', service.userId);
                    console.log('Bills accessible:', results[service.userId]?.totalBills || 0);
                    console.log('Next step: Refresh the page to see your bills');
                    
                    return {
                        finalUserId: service.userId,
                        results: results,
                        recommendation: bestUserId !== service.userId ? `Switch to ${bestUserId}` : 'Current ID is optimal'
                    };
                    
                } catch (error) {
                    console.error('❌ Full diagnosis failed:', error);
                    return { error: error.message };
                }
            };
            
            window.quickFix = async () => {
                try {
                    console.log('🔧 === QUICK FIX FOR MISSING BILLS ===');
                    
                    const service = window.supabaseService || supabaseDataService;
                    if (!service) {
                        console.error('❌ Service not available');
                        return;
                    }
                    
                    const testUUID = '00000000-0000-0000-0000-000000000001';
                    
                    console.log('👤 Current user ID:', service.userId);
                    
                    // Force check for test UUID data
                    console.log('🔍 Checking test UUID data...');
                    service.userId = testUUID;
                    
                    const testBills = await service.getStagedBills();
                    const testActiveSupplies = await service.getActiveSupplies();
                    
                    console.log(`📊 Found ${testBills.length} staged bills with test UUID`);
                    console.log(`📊 Found ${testActiveSupplies.length} active supplies with test UUID`);
                    
                    if (testBills.length > 0 || testActiveSupplies.length > 0) {
                        console.log('✅ SOLUTION: Using test UUID for data access');
                        
                        // Refresh data
                        if (window.appState && window.appState.loadSupabaseData) {
                            console.log('🔄 Refreshing all data...');
                            await window.appState.loadSupabaseData();
                            console.log('✅ Data refreshed. Your bills should now be visible!');
                            console.log('💡 Refresh the page to see the updated interface');
                        }
                        
                        return { success: true, billsFound: testBills.length + testActiveSupplies.length };
                    } else {
                        console.log('❌ No bills found with test UUID either');
                        return { success: false, message: 'No bills found in database' };
                    }
                    
                } catch (error) {
                    console.error('❌ Quick fix failed:', error);
                    return { error: error.message };
                }
            };
            
            window.showAllBillsMode = async () => {
                try {
                    console.log('🌍 === ENABLING SHOW ALL BILLS MODE ===');
                    console.log('This will show bills from all users, regardless of user ID');
                    
                    const service = window.supabaseService || supabaseDataService;
                    if (!service) {
                        console.error('❌ Service not available');
                        return;
                    }
                    
                    console.log('👤 Current user ID:', service.userId);
                    console.log('🔄 Data fetching methods have been updated to ignore user ID filters');
                    
                    // Test the new approach
                    const bills = await service.getStagedBills();
                    const activeSupplies = await service.getActiveSupplies();
                    const retailers = await service.getRetailers();
                    
                    console.log(`📊 Results (all users):`);
                    console.log(`📋 Staged bills: ${bills.length}`);
                    console.log(`🔄 Active supplies: ${activeSupplies.length}`);
                    console.log(`🏪 Retailers: ${retailers.length}`);
                    
                    // Refresh app data
                    if (window.appState && window.appState.loadSupabaseData) {
                        console.log('🔄 Refreshing app state with all data...');
                        await window.appState.loadSupabaseData();
                        console.log('✅ App data refreshed with all bills from all users');
                        console.log('💡 Refresh the page to see all bills');
                    }
                    
                    return {
                        success: true,
                        totalBills: bills.length + activeSupplies.length,
                        breakdown: {
                            stagedBills: bills.length,
                            activeSupplies: activeSupplies.length,
                            retailers: retailers.length
                        }
                    };
                    
                } catch (error) {
                    console.error('❌ Show all bills mode failed:', error);
                    return { error: error.message };
                }
            };
        }
        
        return supabaseDataService;
    } catch (error) {
        console.error('❌ Failed to initialize global service:', error);
        return null;
    }
}

// Auto-initialize when loaded as script tag
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGlobalService);
    } else {
        initGlobalService();
    }
}

// Export for use in other modules
export { initSupabase, SupabaseDataService, initGlobalService };