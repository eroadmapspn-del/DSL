# Supply In Progress Duplicates - Issue Analysis & Fix

## Problem Identified

Duplicate bills were appearing in the "Supply In Progress" tab due to missing database constraints that allowed the same bill to be inserted multiple times into the `active_supplies` table.

## Root Cause

### Database Schema Issue
The `active_supplies` table was missing a unique constraint on bills, allowing duplicate entries:
- No constraint on `bill_number` + `user_id` + `status` combination
- Same bill could be inserted multiple times if dispatch button was clicked multiple times
- Network retries or race conditions could cause duplicates

### Code Issue
The JavaScript code was using simple `.insert()` operations without checking for existing records:
- Location: `supabase-service.js` methods:
  - `moveToActiveSupplies()` (line ~894-968)
  - `moveToActiveSuppliesWithAssignments()` (line ~972-1046)

**Why not upsert?** Initial consideration was to use upsert, but this would cause **data loss**:
- Upsert would overwrite existing records with incomplete data
- Would destroy: `payment_method`, `received_amount`, `cheque_date`, `photo_url`, `completion_date`
- Critical risk when bills are accidentally re-dispatched or moved back and forth

## Solution Applied

### 1. Database Fix
Created SQL script: [fix-active-supplies-duplicates.sql](fix-active-supplies-duplicates.sql)

**Steps:**
1. Identify and analyze duplicate records
2. Remove duplicates (keeping the most recent record)
3. Add unique constraint: `UNIQUE (bill_number, user_id, status)`
4. Add performance index

**To apply the fix, run:**
```sql
-- Execute the SQL script in Supabase SQL Editor
-- This will clean up existing duplicates and prevent future ones
```

### 2. Code Fix
Updated `supabase-service.js` to use **check-then-insert** pattern instead of direct `.insert()`:

**Changes Made:**
- Both `moveToActiveSupplies()` and `moveToActiveSuppliesWithAssignments()` now check for existing records first
- New logic flow:
  1. Query for existing bills with same `bill_number`, `user_id`, and `status='in_progress'`
  2. Filter out any bills that already exist
  3. Only insert new bills that don't already exist
  4. Skip insert entirely if all bills already exist
  
- **Benefits**:
  - ✅ No data loss - never overwrites existing records with completion data
  - ✅ Works with or without the unique constraint
  - ✅ Graceful handling when bills already dispatched
  - ✅ Logs warnings for visibility
  
- **Why not upsert?** Initial approach used upsert but would have overwritten partial payment and completion data, causing data loss

## How to Deploy the Fix

### Step 1: Run Database Migration
1. Open Supabase SQL Editor
2. Copy and execute the contents of [fix-active-supplies-duplicates.sql](fix-active-supplies-duplicates.sql)
3. Verify no duplicates remain by running the verification queries at the end

### Step 2: Deploy Code Changes
The code changes in [supabase-service.js](supabase-service.js) have been applied and will:
- Check for existing records before inserting
- Filter out bills that already exist with `in_progress` status
- Only insert truly new records
- Log warnings when duplicates are detected
- Prevent data loss by never overwriting existing completion data

**Implementation Details:**
```javascript
// 1. Query for existing records
const { data: existingRecords } = await supabase
    .from('active_supplies')
    .select('bill_number, id')
    .in('bill_number', activeSupplies.map(s => s.bill_number))
    .eq('user_id', this.userId)
    .eq('status', 'in_progress');

// 2. Filter out existing bills
const newSupplies = activeSupplies.filter(
    supply => !existingRecords.some(existing => existing.bill_number === supply.bill_number)
);

// 3. Only insert new bills
if (newSupplies.length > 0) {
    await supabase.from('active_supplies').insert(newSupplies);
}
```

### Step 3: Verify the Fix
1. Clear your browser cache and reload the application
2. Navigate to Supply → Supplies in Progress
3. Verify no duplicate bills appear
4. Test dispatching bills to confirm no new duplicates are created

## Diagnostic Tools

### Check for Duplicates
Use [check-active-supplies-duplicates.sql](check-active-supplies-duplicates.sql) to identify any remaining duplicates:
```sql
-- Run queries from this file to analyze the current state
```

## Prevention

The fix includes:
✅ **Database constraint** to physically prevent duplicates at the database level  
✅ **Check-then-insert logic** in code to avoid inserting duplicates without data loss risk  
✅ **Pre-query validation** to filter existing records before insert  
✅ **Index** for better query performance when checking for duplicates  
✅ **Warning logs** when duplicate attempts are detected

**Key Design Decision**: Used check-then-insert instead of upsert to prevent accidental data loss from overwriting completion records (payment method, received amount, photos, etc.)  

## Testing Checklist

After deploying:
- [ ] Existing duplicates are removed
- [ ] Unique constraint is in place
- [ ] Can dispatch bills without errors
- [ ] No duplicates appear in Supplies in Progress
- [ ] Multi-clicking dispatch button doesn't create duplicates
- [ ] Network retry scenarios handled correctly

## Impact

- **Immediate**: Removes all existing duplicate entries
- **Prevention**: Physically impossible to create duplicates with unique constraint
- **Performance**: Better query performance with new index
- **User Experience**: Clean, duplicate-free Supply In Progress view

## Files Modified

1. **Created**: `fix-active-supplies-duplicates.sql` - Database migration script
2. **Created**: `check-active-supplies-duplicates.sql` - Diagnostic queries
3. **Modified**: `supabase-service.js` - Updated insert logic to use check-then-insert pattern

## Notes

- The unique constraint is **recommended** but not strictly required - the code works without it
- The constraint serves as a safety net at the database level
- The unique constraint is on `(bill_number, user_id, status)` which allows:
  - Same bill to exist with different statuses (e.g., in_progress vs delivered)
  - Different users to work on the same bill number
  - But prevents the same user from having duplicate in_progress records for the same bill
- The check-then-insert pattern prevents data loss that would occur with upsert
- Bills that are accidentally re-dispatched will be caught and logged but not duplicated
