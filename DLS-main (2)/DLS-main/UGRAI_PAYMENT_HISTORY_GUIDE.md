# UGRAI Payment History System

## Overview

Tracks all UGRAI payments including partial payments to ensure no payment data is lost.

## Database Setup

### 1. Run SQL Script

```bash
# Execute in Supabase SQL Editor
supabase-ugrai-payment-history.sql
```

This creates:

- ✅ `ugrai_payment_history` table
- ✅ Indexes for performance
- ✅ RLS policies
- ✅ SQL functions: `get_ugrai_payment_history()`, `get_next_payment_number()`

## How It Works

### Full Payment Flow (No History Issues)

```
Bill L4752: ₹10,000
Worker completes: ₹10,000 (full)
Manager approves:
  → Payment history created ✅
  → Bill goes to approved_ugrai ✅
  → History shows: Payment 1 of 1 (full)
```

### Partial Payment Flow (History Preserved!)

```
Bill L4752: ₹10,000

Payment 1:
  Worker completes: ₹6,000 (partial)
  Manager approves:
    → Payment history created ✅
      - Payment #1: ₹6,000
      - Outstanding: ₹4,000
      - Type: partial
    → Bill goes BACK to ugrai_data with ₹4,000
    → Removed from completed_ugrai

Payment 2:
  Worker completes: ₹4,000 (full)
  Manager approves:
    → Payment history created ✅
      - Payment #2: ₹4,000
      - Outstanding: ₹0
      - Type: full
    → Bill goes to approved_ugrai ✅

Final Result:
  - approved_ugrai: 1 entry (₹4,000 - last payment only)
  - ugrai_payment_history: 2 entries
    - Payment 1: ₹6,000 partial
    - Payment 2: ₹4,000 full
  - Total received: ₹10,000 ✅
```

## CSV Import with Duplicates

### Problem Before

```csv
Bill Number, Net Amount, Received Amount
L4752, 10000, 6000
L4752, 10000, 4000
```

**Error:** `duplicate key value violates unique constraint`

### Solution Now

```javascript
// Using bulkImportCompletedUgrai()
// Automatically:
1. Groups duplicate bills
2. Creates payment history for EACH payment
3. Sums received amounts
4. Inserts/updates ONCE in completed_ugrai
```

**Result:**

- `completed_ugrai`: 1 row (L4752, received: ₹10,000)
- `ugrai_payment_history`: 2 rows
  - Payment 1: ₹6,000
  - Payment 2: ₹4,000

## API Methods

### Supabase Service Methods

#### Save Payment History

```javascript
await appState.supabaseService.addUgraiPaymentHistory({
  billNumber: "L4752",
  billDate: "2025-10-31",
  retailerName: "ABC Store",
  sector: "Sector 1",
  originalNetAmount: 10000,
  receivedAmount: 6000,
  outstandingAmount: 4000,
  paymentType: "partial", // or 'full'
  paymentMethod: "Cash",
  receiptNumber: "R123",
  dateCompleted: "2025-10-31",
  completedBy: "John",
  approvedBy: "Manager",
  notes: "First partial payment",
});
```

#### Get Payment History for a Bill

```javascript
const history = await appState.supabaseService.getUgraiPaymentHistory("L4752");
// Returns array of all payments for this bill
// [
//   { paymentNumber: 1, paymentAmount: 6000, ... },
//   { paymentNumber: 2, paymentAmount: 4000, ... }
// ]
```

#### Bulk Import with Duplicate Handling

```javascript
const results = await appState.supabaseService.bulkImportCompletedUgrai([
    { billNumber: 'L4752', receivedAmount: 6000, ... },
    { billNumber: 'L4752', receivedAmount: 4000, ... }, // Duplicate!
    { billNumber: 'L5000', receivedAmount: 5000, ... }
]);

// Results:
// {
//   imported: 2,          // New bills inserted
//   updated: 0,           // Existing bills updated
//   historyCreated: 2,    // Payment history entries
//   errors: []            // Any errors
// }
```

## Payment History Table Schema

```sql
CREATE TABLE ugrai_payment_history (
    id UUID PRIMARY KEY,
    user_id UUID,

    -- Bill info
    bill_number TEXT,
    bill_date DATE,
    retailer_name TEXT,
    sector TEXT,
    original_net_amount DECIMAL,

    -- This payment
    payment_number INTEGER,      -- 1st, 2nd, 3rd...
    payment_date DATE,
    payment_amount DECIMAL,
    outstanding_amount DECIMAL,
    payment_type TEXT,           -- 'partial' or 'full'

    -- Payment details
    payment_method TEXT,
    receipt_number TEXT,
    cheque_date DATE,
    photo_uploaded BOOLEAN,
    photo_url TEXT,

    -- Tracking
    completed_by TEXT,
    approved_by TEXT,
    date_approved DATE,
    notes TEXT,

    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

## When Payment History is Created

### Automatic Creation

✅ **Every time a bill is approved** (in `scripts.js` approveUgraiBill):

```javascript
// BEFORE removing from completed_ugrai
await this.supabaseService.addUgraiPaymentHistory({...});

// THEN handle partial/full logic
if (isPartialPayment) {
    // Send back to ugrai_data
} else {
    // Send to approved_ugrai
}
```

✅ **During CSV import** (in `supabaseService.bulkImportCompletedUgrai`):

```javascript
// For each duplicate payment found in CSV
await this.addUgraiPaymentHistory({...});
```

### Manual Creation

You can also manually create history entries:

```javascript
await appState.supabaseService.addUgraiPaymentHistory({...});
```

## Querying Payment History

### Get all payments for a bill

```sql
SELECT * FROM ugrai_payment_history
WHERE user_id = 'xxx' AND bill_number = 'L4752'
ORDER BY payment_number;
```

### Get total received for a bill

```sql
SELECT bill_number, SUM(payment_amount) as total_received
FROM ugrai_payment_history
WHERE user_id = 'xxx' AND bill_number = 'L4752'
GROUP BY bill_number;
```

### Get all partial payments

```sql
SELECT * FROM ugrai_payment_history
WHERE user_id = 'xxx' AND payment_type = 'partial'
ORDER BY date_approved DESC;
```

## Benefits

1. ✅ **No Data Loss**: Every payment is recorded
2. ✅ **Full Audit Trail**: See complete payment history
3. ✅ **Duplicate Handling**: CSV imports automatically handle duplicates
4. ✅ **Payment Sequence**: Know which was 1st, 2nd, 3rd payment
5. ✅ **Outstanding Tracking**: See remaining balance after each payment
6. ✅ **Unique Constraint Safe**: Only final state in completed_ugrai, history in separate table

## Migration Notes

### For Existing Data

If you have existing bills in `completed_ugrai` that were partial payments, you can create history entries manually:

```sql
-- Example: Create history for existing bills
INSERT INTO ugrai_payment_history (
    user_id, bill_number, bill_date, retailer_name, sector,
    original_net_amount, payment_number, payment_date,
    payment_amount, outstanding_amount, payment_type,
    payment_method, receipt_number, date_approved
)
SELECT
    user_id, bill_number, bill_date, retailer_name, sector,
    net_amount, 1, date_completed,
    received_amount, 0, 'full',
    payment_method, receipt_number, date_approved
FROM approved_ugrai
WHERE user_id = 'your-user-id';
```

## Future Enhancements

Potential additions:

- UI to view payment history in UGRAI Analysis
- Payment timeline visualization
- Export payment history to Excel
- Dashboard showing partial vs full payments statistics
