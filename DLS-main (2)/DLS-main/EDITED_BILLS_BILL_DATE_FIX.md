# Fix: Bill Date Shows N/A in Edited Bills Section

## Problem

When marking a supply bill as "Edited" in Supply > In Progress, the bill date was showing as "N/A" in the Edited Bills section under Supply > Upload Supply Data.

## Root Cause

The `edited_bills` table in Supabase was missing the `bill_date` column, so when bills were moved to the edited bills section, the bill date information was lost.

## Solution Applied

### 1. Database Schema Update

Added `bill_date` column to the `edited_bills` table:

```sql
ALTER TABLE public.edited_bills
ADD COLUMN IF NOT EXISTS bill_date DATE NULL;

COMMENT ON COLUMN public.edited_bills.bill_date IS 'The original bill date from the supply bill';
```

**SQL File Location**: `/home/kiki/Downloads/DLS/add_bill_date_to_edited_bills.sql`

### 2. Code Changes

#### File: `supabase-service.js`

**Function: `addEditedBill()` (Line ~1584)**

- Added extraction of `bill_date` from the bill object
- Added `bill_date` field to the INSERT statement

```javascript
const billDate = bill.bill_date || bill.billDate || null;

// In the insert statement:
bill_date: billDate,
```

**Function: `getEditedBills()` (Line ~1681)**

- Added `billDate` mapping to return the bill date

```javascript
billDate: bill.bill_date,
```

## Steps to Apply

### Step 1: Run SQL Migration

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Run the SQL from `add_bill_date_to_edited_bills.sql`:

```sql
ALTER TABLE public.edited_bills
ADD COLUMN IF NOT EXISTS bill_date DATE NULL;
```

### Step 2: Test the Fix

1. Go to Supply > In Progress
2. Click "Supply Done" on any bill
3. Select "Edited" status
4. Submit the form
5. Go to Supply > Upload Supply Data
6. Select "Edited Bills" from dropdown
7. Verify that the Bill Date column now shows the correct date instead of "N/A"

## Files Modified

- ✅ `supabase-service.js` - Updated `addEditedBill()` and `getEditedBills()` functions
- ✅ `add_bill_date_to_edited_bills.sql` - SQL migration script (NEW)

## Testing Checklist

- [ ] SQL migration executed successfully in Supabase
- [ ] Bill date is saved when marking bill as Edited
- [ ] Bill date displays correctly in Edited Bills table
- [ ] Date format is correct (YYYY-MM-DD or formatted display)
- [ ] No errors in browser console
- [ ] Existing edited bills show "N/A" (expected, only new ones will have dates)

## Notes

- Existing edited bills in the database will still show "N/A" for bill date since they were created before this fix
- Only newly edited bills (after applying this fix) will have the bill date populated
- The bill_date column is nullable, so it won't break existing data
