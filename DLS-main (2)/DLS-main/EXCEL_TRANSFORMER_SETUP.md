# Excel Transformer - Dual Route Setup

## Overview

The Excel transformer now automatically routes bills based on their Status column:

- **Status = "Edited"** → Direct insertion to `edited_bills` table in Supabase
- **Status = "Delivered"** → CSV for `approved_bills` table (status mapped to "approved")
- **Status = "Cancelled/Returned"** → CSV for `approved_bills` table (status preserved)

## Setup Instructions

### Step 1: Configure Supabase Credentials

Open `excel-to-csv-transformer.html` and update these lines (around line 254-256):

```javascript
const SUPABASE_URL = "YOUR_SUPABASE_URL"; // Replace with your Supabase URL
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // Replace with your Supabase anon key
const USER_ID = "default-user"; // Replace with actual user ID if needed
```

**To find your credentials:**

1. Go to Supabase Dashboard
2. Select your project
3. Go to Settings → API
4. Copy "Project URL" → Use as `SUPABASE_URL`
5. Copy "anon public" key → Use as `SUPABASE_ANON_KEY`

### Step 2: Ensure Database Schema is Updated

Make sure you've run the SQL migration to add `bill_date` to `edited_bills`:

```sql
ALTER TABLE public.edited_bills
ADD COLUMN IF NOT EXISTS bill_date DATE NULL;
```

### Step 3: Test the Transformer

1. Open `excel-to-csv-transformer.html` in your browser
2. Upload an Excel file with bills
3. Check the browser console for initialization message:
   - ✅ "Supabase client initialized" = Good!
   - ⚠️ "Supabase credentials not configured" = Need to update credentials

## How It Works

### Excel File Requirements

Your Excel file should have these columns:

- **Status** (Required) - Values: "Delivered", "Edited", "Cancelled", "Returned"
- **Bill Number** (Required)
- **Bill Date** (Required)
- **Retailer Name** (Required)
- **Net Amount** (Required)
- **Sector** (Optional)
- **Delivery Method** (For non-edited bills)
- **Cash Received, Cheque Amount, UPI Amount** (For non-edited bills)
- Other payment-related columns...

### Processing Logic

1. **Transformer reads Excel file**
2. **For each row:**
   - If Status = "Edited" → Create edited bill record
   - Else → Create approved bill record
3. **After processing:**
   - Edited bills → Insert to Supabase `edited_bills` table (batch insertion)
   - Other bills → Add to CSV for download

### Output

**If Supabase is configured:**

- Statistics show: Total, Edited Bills (DB), CSV Records
- Edited bills are automatically inserted
- Download CSV for remaining bills
- Success message shows count of each category

**If Supabase is NOT configured:**

- Warning message displayed
- ALL bills (including edited) are included in CSV
- You'll need to manually separate and import edited bills

## Edited Bills Data Structure

When bills are inserted to `edited_bills` table:

```javascript
{
    bill_number: "BILL-123",
    bill_date: "2024-11-03",
    original_amount: 1000.00,
    edited_amount: 1000.00,  // Initially same as original
    retailer_name: "ABC Store",
    sector: "North",
    brand: "Loreal",
    edit_reason: "Imported from Excel with Edited status",
    user_id: "default-user"
}
```

## Batch Insertion

- Edited bills are inserted in batches of 50
- 200ms delay between batches to prevent timeout
- Error handling for each batch
- Console logs show progress

## Troubleshooting

### "Supabase credentials not configured"

- Update SUPABASE_URL and SUPABASE_ANON_KEY in the HTML file
- Refresh the page

### Edited bills not inserting

- Check browser console for errors
- Verify Supabase credentials are correct
- Check if `edited_bills` table has `bill_date` column
- Verify user has INSERT permission on `edited_bills` table

### Some bills failed to insert

- Check console for specific error messages
- Common issues:
  - Missing required fields (bill_number, retailer_name)
  - Invalid date format
  - Constraint violations (duplicate bill numbers)

### CSV includes edited bills

- This happens when Supabase is not configured
- Either configure Supabase or manually filter edited bills from CSV

## Testing Checklist

- [ ] Supabase credentials configured
- [ ] `bill_date` column added to `edited_bills` table
- [ ] Browser console shows "Supabase client initialized"
- [ ] Upload Excel with mixed status values
- [ ] Verify edited bills inserted to database
- [ ] Verify other bills in CSV download
- [ ] Check statistics display correctly
- [ ] Verify no errors in console

## Benefits

1. **Automated workflow** - No manual sorting needed
2. **Immediate insertion** - Edited bills go straight to database
3. **Error handling** - Detailed error messages and retry logic
4. **Batch processing** - Handles large datasets efficiently
5. **Fallback mode** - Works without Supabase (all to CSV)
