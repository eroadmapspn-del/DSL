# Credit Bills to UGRAI Transfer Function

## Overview
This SQL function transfers credit bills from `approved_bills` table to `ugrai_entries` table for collection tracking.

## What It Does

### Source Data
- **Table**: `approved_bills`
- **Filter**: `payment_method = 'Credit'` AND `status = 'approved'`

### Destination
- **Table**: `ugrai_entries`
- **Status**: Set to `'Pending'` (ready for assignment and collection)

### Column Mapping

| approved_bills | → | ugrai_entries | Notes |
|----------------|---|---------------|-------|
| user_id | → | user_id | Converted from VARCHAR to UUID |
| bill_number | → | bill_number | Primary identifier |
| bill_date | → | bill_date | Date preserved |
| retailer_name | → | retailer_name | Name preserved |
| sector | → | sector | Defaults to 'Unknown' if NULL |
| net_amount | → | net_amount | Amount to be collected |
| - | → | status | Set to 'Pending' |
| - | → | assigned_to | Set to NULL (assign later) |
| bill_number | → | original_supply_id | Tracks source bill |

### Important Business Rules

1. **Original Bills Preserved**: Credit bills remain in `approved_bills` with `status='approved'`
2. **Duplicate Prevention**: Skips bills already in `ugrai_entries` (by bill_number)
3. **User ID Handling**: Converts VARCHAR user_id to UUID format (or uses default test UUID)
4. **Status Flow**: Bills start as 'Pending' in UGRAI, ready for sector assignment

## Function Returns

```sql
{
    total_credit_bills: INTEGER,      -- Total credit bills found
    already_in_ugrai: INTEGER,        -- Bills already transferred
    newly_transferred: INTEGER,       -- Bills just transferred
    transfer_details: JSONB          -- Metadata about transfer
}
```

## Usage

### Run the Transfer
```sql
-- Execute in Supabase SQL Editor
SELECT * FROM transfer_credit_bills_to_ugrai();
```

### Expected Output
```
total_credit_bills | already_in_ugrai | newly_transferred | transfer_details
------------------+------------------+-------------------+-----------------
        15        |         0        |        15         | {...}
```

## Verification Queries

After running the function, verify results:

```sql
-- Check credit bills in approved_bills (should be unchanged)
SELECT COUNT(*), SUM(net_amount) as total_amount
FROM approved_bills
WHERE payment_method = 'Credit' AND status = 'approved';

-- Check new entries in ugrai_entries
SELECT COUNT(*), SUM(net_amount) as total_amount
FROM ugrai_entries
WHERE original_supply_id IS NOT NULL;

-- View sample transferred bills
SELECT 
    bill_number,
    retailer_name,
    sector,
    net_amount,
    status,
    assigned_to,
    original_supply_id
FROM ugrai_entries
WHERE original_supply_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

## Next Steps After Transfer

1. **Assign Sectors**: Use `ugrai_assignments` table to map sectors to persons
2. **Review Pending Bills**: Navigate to UGRAI section to see pending bills
3. **Start Collection**: Delivery persons can pick up bills from their assigned sectors
4. **Track Progress**: Bills move through: Pending → In Progress → Completed → Approved

## Re-running the Function

- **Safe to re-run**: Function checks for duplicates
- **Only new bills transferred**: Bills already in ugrai_entries are skipped
- **No data loss**: Original bills always preserved in approved_bills

## Files

- `transfer-credit-bills-to-ugrai.sql` - Main SQL function (this file)

## Testing Checklist

- [ ] Run function in Supabase SQL Editor
- [ ] Check return values (total, already exists, newly transferred)
- [ ] Verify ugrai_entries has new records
- [ ] Verify approved_bills unchanged (credit bills still there)
- [ ] Check UGRAI section in UI shows pending bills
- [ ] Verify sector assignments work correctly
- [ ] Test bill collection flow works end-to-end
