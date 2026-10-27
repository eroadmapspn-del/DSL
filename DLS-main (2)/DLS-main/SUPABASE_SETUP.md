# Supabase Setup Instructions

## Step 1: Update Supabase Configuration

1. Open `supabase-service.js`
2. Replace the placeholder values in the `SUPABASE_CONFIG` object:

```javascript
const SUPABASE_CONFIG = {
    url: 'YOUR_SUPABASE_PROJECT_URL', // Replace with your actual Supabase project URL
    anonKey: 'YOUR_SUPABASE_ANON_KEY' // Replace with your actual Supabase anon key
};
```

### Finding Your Supabase Credentials:

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy the following values:
   - **Project URL** (e.g., `https://your-project-ref.supabase.co`)
   - **Anon/Public Key** (the `anon` key, not the `service_role` key)

## Step 2: Set Up Database Schema

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Create a new query
4. Copy and paste the entire contents of `supabase-schema.sql`
5. Click **Run** to execute the SQL

This will create all the necessary tables:
- `retailers`
- `bills` 
- `active_supplies`
- `approved_bills`
- `edited_bills`

## Step 3: Test the Connection

1. Update the credentials in `supabase-service.js`
2. Open your website
3. Check the browser console for messages:
   - ✅ "Supabase client initialized successfully" = Working
   - ❌ "Failed to initialize Supabase" = Check your credentials

## Step 4: Verify Data Flow

Test the complete supply workflow:

1. **Base File Management**: Upload retailer data via Excel or add manually
2. **Upload Supply Data**: Add bills via Excel upload or manual entry
3. **Bills to Dispatch**: Move staged bills to dispatch queue
4. **Supplies in Progress**: Assign and track supply completion
5. **Supply Management**: Approve completed supplies

## Database Structure

The Supabase implementation maps your existing data structure:

| Original Array | Supabase Table | Key Fields |
|---|---|---|
| `temporaryBills` | `bills` (status='staged') | bill_number, retailer_name, net_amount |
| `bills` | `bills` (status='dispatched') | supply_through, status |
| `activeSupplies` | `active_supplies` | payment_method, received_amount, status |
| `approvedBills` | `approved_bills` | approval_date, final status |
| `retailers` | `retailers` | retailer_name, sector |
| `editedBills` | `edited_bills` | original_amount, edited_amount |

## Real-time Features

The system includes real-time subscriptions that will automatically update the UI when:
- New retailers are added
- Bills are moved between stages
- Supply statuses are updated
- Bills are approved

## Troubleshooting

### Common Issues:

1. **"Failed to initialize Supabase"**
   - Check your project URL and anon key
   - Ensure your Supabase project is active
   - Verify network connectivity

2. **Data not loading**
   - Check browser console for errors
   - Verify database schema was created correctly
   - Ensure tables have proper permissions (RLS is enabled but not configured yet)

3. **Permission errors**
   - Currently using default user isolation
   - When authentication is added later, Row Level Security (RLS) policies will be implemented

### Fallback Behavior:

If Supabase connection fails, the system automatically falls back to mock mode with localStorage persistence, so your work won't be lost during development.

## Next Steps

Once basic functionality is working:
1. Implement user authentication
2. Add Row Level Security (RLS) policies
3. Set up file upload for photos
4. Add data export/backup features
5. Implement Google Sheets integration