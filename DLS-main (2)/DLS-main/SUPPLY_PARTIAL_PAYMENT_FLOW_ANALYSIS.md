# Supply Partial Payment Flow - Complete Analysis

## Date: February 19, 2026

---

## 🎯 Question Answered:
**"What happens from supply in progress when someone makes a partial payment in the form, how is the bill processed and where does it go?"**

---

## 📋 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│           SUPPLY IN PROGRESS (active_supplies)           │
│   Bill: S12345 | Net Amount: ₹10,000                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Worker completes supply
                     │ Opens "Complete Supply" modal
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│               COMPLETE SUPPLY MODAL FORM                 │
│                                                          │
│  Status: Delivered ✓                                     │
│  Method: Cash ✓                                          │
│  Receipt No: R12345                                      │
│  Received Amount: ₹6,000  ← PARTIAL! (< ₹10,000)        │
│  Photo: [uploaded]                                       │
│                                                          │
│                    [Confirm Button]                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Form submits
                     │ Calls: appState.updateSupplyStatus()
                     │ Which calls: supabaseService.completeSupply()
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│         UPDATE IN active_supplies TABLE                  │
│                                                          │
│  SET status = 'Delivered'                                │
│  SET payment_method = 'Cash'                             │
│  SET receipt_number = 'R12345'                           │
│  SET received_amount = 6000  ← Stored as partial amount │
│  SET photo_url = '<url>'                                 │
│  SET completion_date = NOW()                             │
│                                                          │
│  Bill remains in active_supplies, status = 'Delivered'   │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Bill now visible in "Supply Management"
                     │ (Bills for Approval section)
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│        SUPPLY MANAGEMENT - BILLS FOR APPROVAL            │
│                                                          │
│  Shows bills where status IN ('delivered', 'cancelled',  │
│  'edited')                                               │
│                                                          │
│  Bill S12345 appears here:                               │
│  - Bill Number: S12345                                   │
│  - Amount: ₹10,000 (net amount)                          │
│  - Received: ₹6,000 (partial)                            │
│  - Status: Delivered                                     │
│  - Method: Cash                                          │
│                                                          │
│              [Approve Selected Bills]                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Manager approves
                     │ Calls: supabaseService.approveSupplies([id])
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              APPROVAL PROCESS ANALYSIS                   │
│                                                          │
│  Code checks:                                            │
│    netAmount = 10000                                     │
│    receivedAmount = 6000                                 │
│    isPartialPayment = (6000 > 0 && 6000 < 10000)        │
│    → TRUE ✓                                              │
│                                                          │
│  Since isPartialPayment = TRUE:                          │
│    outstandingAmount = 10000 - 6000 = 4000               │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ TWO THINGS HAPPEN:
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌──────────────────┐    ┌──────────────────────────┐
│  approved_bills  │    │    ugrai_entries         │
│  (ALWAYS)        │    │    (FOR PARTIAL ONLY)    │
└──────────────────┘    └──────────────────────────┘

```

---

## 🔍 Detailed Step-by-Step Breakdown

### Step 1: Worker Completes Supply with Partial Payment

**Form Data:**
```javascript
{
  billNumber: "S12345",
  status: "Delivered",
  deliveryMethod: "Cash",
  receiptNumber: "R12345",
  receivedAmount: 6000,  // Less than netAmount (10000)
  photoUrl: "https://..."
}
```

**Database Update (active_supplies):**
```sql
UPDATE active_supplies
SET 
  status = 'Delivered',
  payment_method = 'Cash',
  receipt_number = 'R12345',
  received_amount = 6000,  -- Partial amount stored here
  photo_url = 'https://...',
  completion_date = NOW()
WHERE id = <supply_id>;
```

**Result:** Bill stays in `active_supplies` table with status = 'Delivered'

**Code Reference:** `supabase-service.js`, line 1100-1140, `completeSupply()` function

---

### Step 2: Bill Appears in Supply Management (Approval Queue)

**Query:**
```sql
SELECT * FROM active_supplies
WHERE status IN ('delivered', 'cancelled', 'edited')
ORDER BY completion_date DESC;
```

**What Manager Sees:**
- Bill Number: S12345
- Net Amount: ₹10,000 (original bill amount)
- Received Amount: ₹6,000 (what was actually received)
- Status: Delivered
- Method: Cash

**Code Reference:** `supabase-service.js`, line 1143-1157, `getSuppliesForApproval()` function

---

### Step 3: Manager Approves → Dual Action Triggered

**Approval Code Logic:**
```javascript
// From supabase-service.js, approveSupplies() function (line 1160-1320)

const netAmount = parseFloat(supply.net_amount || 0);         // 10000
const receivedAmount = parseFloat(supply.received_amount || 0); // 6000
const isPartialPayment = receivedAmount > 0 && receivedAmount < netAmount;
// isPartialPayment = true

if (isPartialPayment) {
    const outstandingAmount = netAmount - receivedAmount;  // 4000
    
    // Create UGRAI entry for outstanding amount
    ugraiEntriesToCreate.push({
        bill_number: 'S12345',
        bill_date: supply.bill_date,
        retailer_name: supply.retailer_name,
        sector: supply.sector,
        net_amount: 4000,  // ← Outstanding amount!
        received_amount: 6000,  // ← Amount already received
        status: 'Pending',
        assigned_to: null,
        original_supply_id: supply.id,
        current_stage: 'available',
        user_id: this.userId
    });
}
```

---

### Step 4A: Always Created - approved_bills Entry

**Regardless of partial payment, bill ALWAYS goes to approved_bills:**

```sql
INSERT INTO approved_bills (
    original_bill_id,
    bill_number,
    bill_date,
    retailer_name,
    sector,
    net_amount,
    received_amount,  -- 6000 (partial)
    brand,
    supply_through,
    payment_method,   -- Cash
    receipt_number,   -- R12345
    cheque_date,
    photo_url,
    status,          -- Delivered
    user_id,
    approval_date    -- NOW()
) VALUES (...);
```

**Key Point:** 
- `net_amount` = 10,000 (original bill amount)
- `received_amount` = 6,000 (what was actually paid)
- This creates a record showing partial payment was made

**Code Reference:** `supabase-service.js`, line 1204-1231

---

### Step 4B: Conditionally Created - ugrai_entries Entry (PARTIAL ONLY)

**ONLY if `isPartialPayment = true`, creates UGRAI entry:**

```sql
INSERT INTO ugrai_entries (
    bill_number,       -- S12345 (same bill number!)
    bill_date,
    retailer_name,
    sector,
    net_amount,        -- 4000 (OUTSTANDING amount, not original!)
    received_amount,   -- 6000 (amount already received from supply)
    status,           -- 'Pending'
    assigned_to,      -- NULL
    original_supply_id, -- Links back to original supply
    current_stage,    -- 'available'
    user_id
) VALUES (...);
```

**Key Point:** 
- `net_amount` in UGRAI = Outstanding amount ONLY (₹4,000)
- `received_amount` in UGRAI = What was already received in Supply (₹6,000)
- This tracks that ₹4,000 still needs to be collected

**Code Reference:** `supabase-service.js`, line 1247-1284

---

### Step 5: Bill Removed from active_supplies

**After both inserts complete:**

```sql
DELETE FROM active_supplies
WHERE id IN (<supply_ids>);
```

**Result:** Bill is removed from Supply in-progress queue

**Code Reference:** `supabase-service.js`, line 1305-1309

---

## 📊 Final State Summary

### For Partial Payment (₹6,000 received of ₹10,000):

| Table | Records | Details |
|-------|---------|---------|
| **active_supplies** | 0 (deleted) | Bill removed after approval |
| **approved_bills** | 1 record | Shows original bill ₹10,000, received ₹6,000 |
| **ugrai_entries** | 1 record | Shows outstanding ₹4,000 to collect |
| **ugrai_payment_history** | 0 (not yet) | Will be created when UGRAI payment made |

### Example Data:

**approved_bills:**
```json
{
  "bill_number": "S12345",
  "net_amount": 10000,
  "received_amount": 6000,
  "payment_method": "Cash",
  "receipt_number": "R12345",
  "status": "Delivered",
  "approval_date": "2025-11-01"
}
```

**ugrai_entries:**
```json
{
  "bill_number": "S12345",
  "net_amount": 4000,  // Outstanding amount
  "received_amount": 6000,  // Already received in supply
  "status": "Pending",
  "current_stage": "available",
  "original_supply_id": "<supply_id>"
}
```

---

## 🔄 What Happens Next?

### The UGRAI worker now sees this bill:

1. **UGRAI Section → Available Bills**
   - Bill S12345 appears
   - Shows ₹4,000 outstanding
   - Notes show ₹6,000 already received

2. **Worker completes collection:**
   - Collects remaining ₹4,000
   - Marks as completed in UGRAI

3. **Manager approves UGRAI:**
   - Creates entry in `ugrai_payment_history` (payment #1)
   - Moves to `approved_ugrai` table
   - Payment history tracks the ₹4,000 payment

4. **Total payment tracking:**
   - Supply payment: ₹6,000 (in `approved_bills`)
   - UGRAI payment: ₹4,000 (in `ugrai_payment_history`)
   - Total collected: ₹10,000 ✓

---

## ⚠️ Important Differences vs Full Payment

### Full Payment (₹10,000 received of ₹10,000):

```
active_supplies → approved_bills ONLY
                  (NO ugrai_entries created)
```

**Code:**
```javascript
const isPartialPayment = receivedAmount > 0 && receivedAmount < netAmount;
// isPartialPayment = false for full payment

// UGRAI entry creation is skipped
if (isCredit || isPartialPayment) {
    // This block NOT executed for full cash payment
}
```

**Result:**
- ✅ `approved_bills`: 1 record (net_amount = received_amount = 10000)
- ❌ `ugrai_entries`: 0 records (no outstanding amount)

---

### Credit Bill (₹0 received, full credit):

```
active_supplies → approved_bills + ugrai_entries
                  (Outstanding = full amount)
```

**Code:**
```javascript
const isCredit = supply.payment_method === 'Credit';
// isCredit = true

const outstandingAmount = isCredit ? netAmount : (netAmount - receivedAmount);
// outstandingAmount = 10000 (full amount)
```

**Result:**
- ✅ `approved_bills`: 1 record (net_amount = 10000, received_amount = 0)
- ✅ `ugrai_entries`: 1 record (net_amount = 10000, for full collection)

---

## 🎯 Key Insights for Cash Receipt Feature

### Payment Tracking Reality:

#### **Partial Payment Bill S12345 (₹6K paid, ₹4K outstanding):**

**Cash Receipt should show:**
1. ✅ From `approved_bills`: 
   - Bill S12345
   - Payment: ₹6,000
   - Source: Supply
   - Payment Method: Cash
   - Date: approval_date

2. ✅ From `ugrai_payment_history` (after UGRAI collection):
   - Bill S12345
   - Payment: ₹4,000
   - Source: UGRAI
   - Payment Method: (whatever method used in UGRAI)
   - Date: date_approved

**This means the same bill number can appear TWICE in Cash Receipt tab if both payments were cash!**

---

## ✅ Conclusion

### What Happens with Partial Payment in Supply?

1. **Worker completes** → Bill updated in `active_supplies` with partial amount
2. **Manager approves** → TWO actions:
   - Creates record in `approved_bills` (showing ₹6K received)
   - Creates record in `ugrai_entries` (showing ₹4K outstanding)
3. **Bill removed** from `active_supplies`
4. **UGRAI workflow** handles collecting remaining ₹4K
5. **Both payments tracked** separately in their respective tables

### Critical Understanding:

**Supply does NOT have a payment history table like UGRAI.**

- `approved_bills` = Final approved supply bills (one record per approval)
- Partial payments create UGRAI entries for outstanding amounts
- The outstanding amount is tracked through UGRAI system
- UGRAI payments get recorded in `ugrai_payment_history`

**For Cash Receipt feature:**
- ✅ Include `approved_bills` for Supply payments (partial or full)
- ✅ Include `ugrai_payment_history` for UGRAI payments
- ⚠️ Same bill number may appear multiple times if Supply partial + UGRAI payment
- ✅ This is CORRECT behavior - each entry is a separate cash transaction

