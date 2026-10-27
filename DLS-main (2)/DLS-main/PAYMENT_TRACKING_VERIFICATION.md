# Payment Tracking Verification Report

## Date: February 19, 2026

## Summary

After thorough investigation of the codebase, here's how payments are actually tracked across the system:

---

## ✅ Payment Tables in the System

### 1. **Supply Payments** → `approved_bills` table

**Location:** `supabase-schema.sql`

```sql
CREATE TABLE IF NOT EXISTS approved_bills (
    id SERIAL PRIMARY KEY,
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    net_amount DECIMAL(10,2) NOT NULL,
    received_amount DECIMAL(10,2),
    payment_method VARCHAR(50),        -- Cash, Credit, UPI, Cheque
    receipt_number VARCHAR(100),
    cheque_date DATE,
    photo_url TEXT,
    approval_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id VARCHAR(100),
    ...
);
```

**How it works:**
- Supply bills move from `bills` → `active_supplies` → `approved_bills`
- Final approved supply bills (including payments) stored in `approved_bills`
- **NO separate payment history table for Supply**
- Each row represents ONE final payment/approval

**Code Reference:** `supabase-service.js` - `approveSupplies()` function (line 1160)

---

### 2. **UGRAI Payments** → Multiple tables with history tracking

#### Table A: `completed_ugrai`
**Location:** `supabase-ugrai-tables.sql`

```sql
CREATE TABLE completed_ugrai (
    id UUID PRIMARY KEY,
    bill_number TEXT NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    received_amount DECIMAL(10,2) NOT NULL,
    payment_method TEXT,
    receipt_number TEXT,
    date_completed DATE NOT NULL,
    ...
);
```

**Purpose:** Worker completes UGRAI bills here (before manager approval)

#### Table B: `approved_ugrai`
**Location:** `supabase-ugrai-tables.sql`

```sql
CREATE TABLE approved_ugrai (
    id UUID PRIMARY KEY,
    bill_number TEXT NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    received_amount DECIMAL(10,2) NOT NULL,
    payment_method TEXT,
    receipt_number TEXT,
    date_approved DATE NOT NULL,
    ...
);
```

**Purpose:** Manager-approved UGRAI bills (final state)

#### Table C: `ugrai_payment_history` ⭐ **THE KEY TABLE**
**Location:** `supabase-ugrai-payment-history.sql`

```sql
CREATE TABLE ugrai_payment_history (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    
    -- Bill identification
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT NOT NULL,
    original_net_amount DECIMAL(10,2) NOT NULL,
    
    -- Payment details
    payment_number INTEGER NOT NULL,        -- 1st, 2nd, 3rd payment
    payment_date DATE NOT NULL,
    payment_amount DECIMAL(10,2) NOT NULL,
    outstanding_amount DECIMAL(10,2) NOT NULL,
    payment_type TEXT NOT NULL,             -- 'partial' or 'full'
    
    -- Payment method details
    payment_method TEXT NOT NULL,           -- Cash, UPI, Cheque, NEFT
    receipt_number TEXT,
    cheque_date DATE,
    
    -- Tracking
    completed_by TEXT,
    approved_by TEXT,
    date_approved DATE NOT NULL,
    ...
);
```

**Purpose:** 
- Tracks EVERY payment made for UGRAI bills
- Supports partial payments (multiple payments for same bill)
- Historical audit trail
- **ONLY for UGRAI bills, NOT for Supply bills**

**How it works:**
1. Worker completes UGRAI bill → saved to `completed_ugrai`
2. Manager approves → creates entry in `ugrai_payment_history`
3. If full payment → also moves to `approved_ugrai`
4. If partial payment → stays in `ugrai_data` with updated amount, but history is preserved

**Code Reference:** 
- `supabase-service.js` - `addUgraiPaymentHistory()` function (line 3827)
- Called from `scripts.js` during UGRAI approval (line 5225, 5485)

---

## 🔍 Key Findings

### ❌ **INCORRECT ASSUMPTION in Cash Receipt Plan:**

The original implementation plan stated:
> "Which payment sources should be included:
> - approved_bills (Supply) ✅
> - approved_ugrai (UGRAI) ✅
> - ugrai_payment_history ✅"

### ✅ **CORRECT REALITY:**

**`ugrai_payment_history` does NOT contain Supply payments.**

It ONLY contains UGRAI payment history entries. Supply payments are stored ONLY in `approved_bills` and do NOT have a separate payment history tracking system.

---

## 📊 Actual Payment Data Structure

### Supply Payments
```
Source: approved_bills ONLY

Example row:
{
  bill_number: "S12345",
  payment_method: "Cash",
  received_amount: 10000,
  approval_date: "2025-10-15",
  retailer_name: "ABC Store"
}
```

**One row = One complete bill payment**  
No history of partial payments tracked for Supply bills.

---

### UGRAI Payments

#### Scenario 1: Full Payment (Single Transaction)
```
completed_ugrai: 1 row  
approved_ugrai: 1 row  
ugrai_payment_history: 1 row
```

**ugrai_payment_history entry:**
```json
{
  "bill_number": "L4752",
  "payment_number": 1,
  "payment_amount": 10000,
  "outstanding_amount": 0,
  "payment_type": "full",
  "payment_method": "Cash"
}
```

#### Scenario 2: Partial Payments (Multiple Transactions)
```
Bill: L4752 (₹10,000)
Payment 1: ₹6,000 (partial)
Payment 2: ₹4,000 (full)

ugrai_payment_history: 2 rows
```

**Payment History Entries:**
```json
[
  {
    "bill_number": "L4752",
    "payment_number": 1,
    "payment_amount": 6000,
    "outstanding_amount": 4000,
    "payment_type": "partial",
    "payment_method": "Cash",
    "date_approved": "2025-10-01"
  },
  {
    "bill_number": "L4752",
    "payment_number": 2,
    "payment_amount": 4000,
    "outstanding_amount": 0,
    "payment_type": "full",
    "payment_method": "Cash",
    "date_approved": "2025-10-15"
  }
]
```

---

## 🔧 Impact on Cash Receipt Feature

### Required Changes:

#### 1. **Data Sources** (CORRECTED)

| Source Table              | When Used                    | Payment Field    | Notes |
|---------------------------|------------------------------|------------------|-------|
| `approved_bills`          | ALL Supply cash payments     | payment_method   | One row per bill |
| `approved_ugrai`          | UGRAI full payments only     | payment_method   | Final approved bills |
| `ugrai_payment_history`   | ALL UGRAI payments (incl. partial) | payment_method | Most comprehensive for UGRAI |

#### 2. **Best Practice Data Source Selection**

**Option A (Recommended): Query ugrai_payment_history + approved_bills**
- ✅ Gets ALL UGRAI payments (full + partial)
- ✅ Gets ALL Supply payments
- ✅ No duplicates (these tables don't overlap)
- ⚠️ May show multiple entries for same UGRAI bill (if partial payments)

**Option B: Query approved_ugrai + approved_bills**
- ✅ Gets final UGRAI bills only
- ✅ Gets ALL Supply payments
- ⚠️ Misses partial payment history
- ⚠️ Underreports total cash transactions

**Recommendation:** Use Option A (ugrai_payment_history + approved_bills)

---

## 📝 SQL Function Update for Cash Receipts

### Current Function in Implementation Plan:
```sql
-- NEEDS CORRECTION: This is correct structure but needs clarification
SELECT ... FROM approved_bills ...
UNION ALL
SELECT ... FROM approved_ugrai ...      -- ⚠️ Optional, may create confusion
UNION ALL
SELECT ... FROM ugrai_payment_history ... -- ✅ UGRAI only
```

### Recommended Function:
```sql
CREATE OR REPLACE FUNCTION get_all_cash_payments(
    p_user_id UUID,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
) RETURNS TABLE(...) AS $$
BEGIN
    RETURN QUERY
    
    -- Supply cash payments (from approved_bills)
    SELECT 
        ab.id,
        'supply'::TEXT as source,
        ab.bill_number,
        ab.bill_date,
        ab.retailer_name,
        ab.sector,
        ab.received_amount as payment_amount,
        ab.approval_date::DATE as payment_date,
        -- ... other fields
    FROM approved_bills ab
    WHERE ab.user_id::TEXT = p_user_id::TEXT
        AND ab.payment_method = 'Cash'
        AND (p_start_date IS NULL OR ab.approval_date >= p_start_date)
        AND (p_end_date IS NULL OR ab.approval_date <= p_end_date)
    
    UNION ALL
    
    -- UGRAI cash payments (from ugrai_payment_history)
    -- This includes both partial and full payments
    SELECT 
        uph.id,
        CASE 
            WHEN uph.payment_type = 'partial' THEN 'ugrai_partial'::TEXT
            ELSE 'ugrai'::TEXT
        END as source,
        uph.bill_number,
        uph.bill_date,
        uph.retailer_name,
        uph.sector,
        uph.payment_amount,
        uph.date_approved as payment_date,
        -- ... other fields
    FROM ugrai_payment_history uph
    WHERE uph.user_id = p_user_id
        AND uph.payment_method = 'Cash'
        AND (p_start_date IS NULL OR uph.date_approved >= p_start_date)
        AND (p_end_date IS NULL OR uph.date_approved <= p_end_date)
    
    ORDER BY payment_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 🎯 Key Recommendations

### 1. **Update Cash Receipt Implementation Plan**
- Remove `approved_ugrai` from data sources (creates duplicates)
- Keep `approved_bills` (Supply payments)
- Keep `ugrai_payment_history` (UGRAI payments - all types)
- Update SQL function accordingly

### 2. **Source Badge Labels**
When displaying in the UI:
- `approved_bills` → Badge: "Supply" (blue)
- `ugrai_payment_history` where `payment_type = 'full'` → Badge: "UGRAI" (purple)
- `ugrai_payment_history` where `payment_type = 'partial'` → Badge: "UGRAI (Partial)" (orange)

### 3. **Cash Receipt Number Assignment**
For bills with multiple partial payments (UGRAI):
- Option A: Assign different receipt numbers to each payment
- Option B: Assign same receipt number to all payments of same bill
- **Recommendation:** Option A (each payment = unique receipt)

### 4. **Potential Confusion for Users**
UGRAI bills with partial payments will show multiple rows:
```
Bill L4752 - Payment 1 - ₹6,000 - [CASH-001]
Bill L4752 - Payment 2 - ₹4,000 - [CASH-045]
```

This is CORRECT behavior (each transaction gets a Tally receipt number).

---

## ✅ Conclusion

**The original assumption was INCORRECT:**
- `ugrai_payment_history` is **exclusively for UGRAI** payments
- Supply payments have **NO payment history table**
- Supply payments are **single-entry only** in `approved_bills`

**Corrected Cash Receipt Sources:**
1. ✅ `approved_bills` → Supply cash payments
2. ✅ `ugrai_payment_history` → UGRAI cash payments (includes partial)
3. ❌ ~~`approved_ugrai`~~ → NOT needed (duplicates ugrai_payment_history)

**This verification ensures the Cash Receipt feature will:**
- Capture ALL cash transactions accurately
- Avoid duplicate entries
- Support UGRAI partial payment tracking
- Provide clear source identification

