# Bug Report: UGRAI Payment History Miscalculation

## Issue Summary
When a bill receives **multiple partial payments**, the **outstanding amount is recalculated from the original bill amount** instead of from the **previous outstanding balance**, causing incorrect tracking.

## Example: LCBL000262502759
**Original Amount:** ₹151,184

### What Happened:
| Payment | Date | Amount | Recorded Outstanding | Status |
|---------|------|--------|---------------------|--------|
| 1 | Nov 26 | ₹50,000 | ₹101,184 | ✅ CORRECT |
| 2 | Nov 30 | ₹100,000 | ₹51,184 | ❌ WRONG |

### What Should Have Happened:
| Payment | Date | Amount | Correct Outstanding | Calculation |
|---------|------|--------|-------------------|-------------|
| 1 | Nov 26 | ₹50,000 | ₹101,184 | 151,184 - 50,000 |
| 2 | Nov 30 | ₹100,000 | **₹1,184** | 101,184 - 100,000 |

**Error:** Payment 2 calculated outstanding as `151,184 - 100,000 = 51,184` instead of `101,184 - 100,000 = 1,184`

## Root Cause

### Location: `scripts.js` - `approveUgraiBillsBatch()` (Line ~5160)

```javascript
// ❌ CURRENT CODE (BUGGY):
const receivedAmount = parseFloat(bill.receivedAmount || bill.netAmount || 0);
const netAmount = parseFloat(bill.netAmount || 0);
const isPartialPayment = receivedAmount < netAmount;
const outstandingAmount = netAmount - receivedAmount;  // ⚠️ BUG HERE!
```

**Problem:** The code calculates outstanding as `originalAmount - currentPayment` without considering **previous payments**.

### The Bug Flow:
1. **First Payment (₹50,000):**
   - `netAmount = 151,184` (from bill)
   - `receivedAmount = 50,000` (current payment)
   - `outstandingAmount = 151,184 - 50,000 = 101,184` ✅ CORRECT

2. **Second Payment (₹100,000):**
   - Bill is re-processed from `ugrai_data`
   - `netAmount = 151,184` (still shows original amount!)
   - `receivedAmount = 100,000` (current payment only)
   - `outstandingAmount = 151,184 - 100,000 = 51,184` ❌ WRONG!
   - Should be: `101,184 - 100,000 = 1,184`

## Why It Happens

When a partial payment is approved:
1. Bill is added back to `ugrai_data` with `netAmount = 151,184` (original)
2. User processes second payment
3. Code reads `netAmount` from bill (still 151,184)
4. Calculates `outstanding = 151,184 - 100,000` (ignoring first payment!)

The `netAmount` field in `ugrai_data` should represent the **remaining balance**, not the original amount, OR the code should fetch **cumulative payments** from payment history.

## Impact

### Data Integrity Issues:
- ❌ Incorrect outstanding amounts in payment history
- ❌ Bills appear to have more outstanding than actual
- ❌ Difficult to track true payment status
- ❌ Reports will show wrong outstanding balances

### Business Impact:
- Accounting discrepancies
- Confusion about which bills are fully paid
- Potential duplicate payment requests
- Incorrect financial reporting

## Affected Bills

Run `diagnose-ugrai-payment-miscalculation.sql` to find all affected bills. The pattern:
- Bills with 2+ payments in `ugrai_payment_history`
- Where payment 2+ has `outstanding = original_amount - current_payment` instead of `previous_outstanding - current_payment`

## Solution Options

### Option 1: Fix Forward (Preferred)
Calculate outstanding from **previous payment history**, not from bill's netAmount:

```javascript
// ✅ CORRECTED CODE:
// Get previous payments from payment history
const previousPayments = await this.supabaseService.getUgraiPaymentHistory(bill.billNumber);
const totalPreviousPaid = previousPayments.reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0);

const originalNetAmount = parseFloat(bill.originalNetAmount || bill.netAmount || 0);
const currentPayment = parseFloat(bill.receivedAmount || 0);
const totalPaid = totalPreviousPaid + currentPayment;
const outstandingAmount = originalNetAmount - totalPaid;
const isPartialPayment = outstandingAmount > 0;
```

### Option 2: Track Outstanding in ugrai_data
Update `ugrai_data.netAmount` to represent **remaining balance**:

```javascript
// When adding back to ugrai_data after partial payment:
const updatedBill = {
    billNumber: bill.billNumber,
    originalNetAmount: originalNetAmount,  // NEW: Keep original
    netAmount: outstandingAmount,          // UPDATED: Show remaining
    receivedAmount: currentPayment,
    totalPaid: totalPreviousPaid + currentPayment,  // NEW: Track cumulative
    status: 'Pending'
};
```

### Option 3: Hybrid Approach (Most Robust)
1. Store `original_net_amount` separately (never changes)
2. Store `outstanding_amount` in bill record
3. Always verify against payment history before calculating

## Fix Script

Create SQL script to recalculate all miscalculated outstanding amounts:

```sql
-- Fix outstanding amounts based on cumulative payments
WITH payment_totals AS (
    SELECT 
        bill_number,
        original_net_amount,
        SUM(payment_amount) as total_paid,
        original_net_amount - SUM(payment_amount) as correct_outstanding
    FROM ugrai_payment_history
    GROUP BY bill_number, original_net_amount
)
UPDATE ugrai_payment_history uph
SET outstanding_amount = pt.correct_outstanding
FROM payment_totals pt
WHERE uph.bill_number = pt.bill_number
  AND uph.payment_number = (
      SELECT MAX(payment_number) 
      FROM ugrai_payment_history 
      WHERE bill_number = uph.bill_number
  );
```

## Recommended Actions

1. ✅ Run diagnostic script to identify all affected bills
2. ✅ Create backup of `ugrai_payment_history` table
3. ✅ Implement Option 1 fix in code (fetch payment history)
4. ✅ Run correction script to fix existing data
5. ✅ Add validation to prevent future occurrences
6. ✅ Add unit tests for multi-payment scenarios

## Testing Checklist

After fix implementation:
- [ ] Single payment: Outstanding calculated correctly
- [ ] Two payments: Second payment uses previous outstanding
- [ ] Three+ payments: Each payment compounds correctly
- [ ] Full payment on last: Outstanding becomes 0
- [ ] Overpayment: Outstanding becomes negative or triggers validation
- [ ] Payment history query: Returns cumulative totals
- [ ] Bill re-opened after partial: Shows correct remaining balance

## Prevention

### Add Validation:
```javascript
// Before saving payment history
if (paymentNumber > 1) {
    const previousPayments = await getPaymentHistory(billNumber);
    const expectedOutstanding = originalAmount - sumAllPayments(previousPayments);
    
    if (Math.abs(calculatedOutstanding - expectedOutstanding) > 0.01) {
        throw new Error(`Outstanding calculation mismatch: 
            Expected ${expectedOutstanding}, got ${calculatedOutstanding}`);
    }
}
```

### Add Database Constraint:
```sql
-- Ensure outstanding = original - cumulative paid
CREATE OR REPLACE FUNCTION validate_ugrai_outstanding()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.outstanding_amount != NEW.original_net_amount - 
       (SELECT COALESCE(SUM(payment_amount), 0) 
        FROM ugrai_payment_history 
        WHERE bill_number = NEW.bill_number) THEN
        RAISE EXCEPTION 'Outstanding amount mismatch';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## Files Affected
- `scripts.js` - `approveUgraiBillsBatch()` (line 5117)
- `scripts.js` - `approveUgraiBill()` (line 5314)
- `supabase-service.js` - May need `getUgraiPaymentHistory()` method
