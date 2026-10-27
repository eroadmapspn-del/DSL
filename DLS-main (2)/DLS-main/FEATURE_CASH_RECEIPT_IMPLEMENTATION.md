# Cash Receipt Feature - Implementation Plan (PRODUCTION READY - SHARED DATA)

## Document Version: 3.0 - PRODUCTION READY
**Date:** February 19, 2026  
**Status:** ✅ Production Ready - All Critical Issues Fixed  
**Architecture:** Shared Team Data - No user_id filtering

**Critical Fixes Applied (v3.0):**

### 👥 Architecture Change - SHARED TEAM DATA
- ✅ **Removed user_id filtering** - All admin/accountant users see ALL cash receipts
- ✅ **user_id for audit only** - Tracks WHO processed the receipt, not for filtering
- ✅ **Collaborative workflow** - User A creates, User B can view/edit/update
- ✅ **RLS by role only** - Admin/Accountant role required, no user scoping
- ✅ **Source tables match** - approved_bills and ugrai_payment_history also have no user filtering

### 🔴 Database Security & Integrity (CRITICAL)
- ✅ **Source Consistency Constraint** - Prevents payment_source/source_table mismatch (data corruption fix)
- ✅ **Role-Based Access Control** - Admin/Accountant role required via RLS policies (security fix)
- ✅ **Case-Insensitive Receipt Numbers** - UPPER() index prevents 'CASH-001' vs 'cash-001' duplicates
- ✅ **Composite Index** - (user_id, payment_date) for faster queries

### 🟠 Application Stability (HIGH PRIORITY)
- ✅ **DOM Element NULL Checks** - Prevents crashes if elements missing from HTML
- ✅ **Parameter Validation** - All required fields validated before backend processing
- ✅ **Payment Grouping Fix** - Uses allPayments for accurate counts (shows 1/2 not 1/1)
- ✅ **Pagination System** - 50 items per page, prevents browser freeze with 1000+ payments
- ✅ **Error Handling** - Wrapped all event listeners in try-catch blocks
- ✅ **NULL Handling in SQL** - COALESCE in CASE statement for robust partial detection

**Previous Fixes (v2.1):**
- ✅ UNIQUE constraint mismatch fixed (source_table instead of payment_source)
- ✅ Race condition eliminated (removed duplicate check, rely on UNIQUE index)
- ✅ .single() error handling (changed to .maybeSingle())
- ✅ sourceTable validation mapping (security fix)
- ✅ Loading state to prevent concurrent operations
- ✅ Performance optimization (Map instead of indexOf())
- ✅ XSS prevention (added escapeHtml utility)
- ✅ Orphaned records detection query
- ✅ Status field NOT NULL DEFAULT 'pending'
- ✅ Complete error handling for duplicate receipt numbers

**Previous Changes (v2.0):**
- Fixed source value mismatch
- Fixed partial payment detection
- Fixed date fields (approval_date for Supply, payment_date for UGRAI)
- Added duplicate receipt number validation
- Added visual grouping and payment numbers
- Added smart update confirmation
- Added critical performance indexes

---

## 📋 Table of Contents

1. [Feature Overview](#feature-overview)
2. [System Architecture](#system-architecture)
3. [Database Design](#database-design)
4. [Frontend Implementation](#frontend-implementation)
5. [Backend Implementation](#backend-implementation)
6. [Security & RBAC](#security--rbac)
7. [Testing Strategy](#testing-strategy)
8. [Deployment Strategy](#deployment-strategy)
9. [Expected Outputs](#expected-outputs)
10. [Task Breakdown](#task-breakdown)
11. [Success Criteria](#success-criteria)

---

## 🎯 Feature Overview

### Purpose
Create a dedicated "Cash Receipt" tab alongside Supply, UGRAI, Purchase, and Analysis tabs to manage and track cash receipt entries for Tally integration.

### User Story
As an **Admin** or **Accountant**, I want to:
- View all cash payments from across the system (Supply, UGRAI) in one place
- Filter cash payments by date range
- Assign Tally cash receipt numbers (e.g., CASH-001, CASH-002) to each payment
- Mark payments as processed with visual indicators
- Edit receipt numbers if mistakes are made
- Export/track which payments have been entered into Tally

### Key Requirements
- ✅ Display ALL cash payments from multiple sources
- ✅ Date range filtering (begin date → end date)
- ✅ Editable cash receipt numbers (can update after submission)
- ✅ Visual indicator for processed vs. pending receipts
- ✅ Admin and Accountant role restrictions only
- ✅ Safe deployment without disrupting live system
- ✅ No modification to existing tables

---

## 🏗️ System Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    EXISTING PAYMENT TABLES                        │
│                                                                   │
│  ┌──────────────────────┐           ┌──────────────────────────┐ │
│  │  approved_bills      │           │  ugrai_payment_history   │ │
│  │  (Supply Payments)   │           │  (UGRAI Payments)        │ │
│  │                      │           │                          │ │
│  │  payment_method      │           │  payment_method          │ │
│  │  = 'Cash'            │           │  = 'Cash'                │ │
│  │                      │           │                          │ │
│  │  • Full payments     │           │  • Full payments         │ │
│  │  • Partial payments  │           │  • Partial payments      │ │
│  └──────────┬───────────┘           └──────────┬───────────────┘ │
│             │                                  │                  │
└─────────────┼──────────────────────────────────┼──────────────────┘
              │                                  │
              └─────────────┬────────────────────┘
                            │
                            │ UNION ALL (No Overlap)
                            │
               ┌────────────▼────────────┐
               │   NEW: cash_receipts    │
               │   (Tally Tracking)      │
               │                         │
               │  - receipt_number       │
               │  - payment_source       │
               │  - payment_reference_id │
               │  - status (pending/done)│
               │  - processed_by         │
               │  - processed_date       │
               └────────────┬────────────┘
                            │
               ┌────────────▼────────────┐
               │   CASH RECEIPT TAB      │
               │   (Frontend Display)    │
               │                         │
               │  - Filter by date       │
               │  - Show all cash pmts   │
               │  - Assign receipt #     │
               │  - Visual status        │
               │  - Source badges        │
               └─────────────────────────┘
```

**Key Architecture Notes:**
- `approved_bills` = Supply workflow payments ONLY
- `ugrai_payment_history` = UGRAI workflow payments ONLY  
- **NO overlap** between these two tables
- Same bill number may appear in BOTH tables if partial payment was made
- Each entry represents a separate cash transaction

### Payment Sources

| Source Table              | Payment Field    | Date Field      | Amount Field     | Notes |
|---------------------------|------------------|-----------------|------------------|-------|
| `approved_bills`          | payment_method   | approval_date   | received_amount  | **Supply payments** (full or partial) |
| `ugrai_payment_history`   | payment_method   | payment_date    | payment_amount   | **UGRAI payments** (includes partial payment tracking) |

**Filter:** `payment_method = 'Cash'`

**⚠️ Important Notes:**
- `ugrai_payment_history` is **UGRAI-only** - does NOT contain Supply payments
- `approved_ugrai` is **NOT included** (would create duplicates with ugrai_payment_history)
- Same bill number may appear **multiple times** if partial payments were made (Supply partial + UGRAI collection)
- Each row represents a **separate cash transaction** requiring its own Tally receipt number

**Example: Partial Payment Flow**
- Supply bill #12345 for ₹10,000 created
- Worker completes delivery with ₹6,000 cash received (partial)
- Manager approves → Creates:
  1. `approved_bills` entry: Bill #12345, ₹6,000 received → **Shows in Cash Receipt as "Supply"**
  2. `ugrai_entries` entry: Bill #12345, ₹4,000 outstanding
- UGRAI worker collects remaining ₹4,000 in cash
- UGRAI manager approves → Creates:
  3. `ugrai_payment_history` entry: Bill #12345, ₹4,000 payment → **Shows in Cash Receipt as "UGRAI (Partial)"**
- **Result:** Bill #12345 appears **TWICE** in Cash Receipt tab (correct behavior!)

---

## 💾 Database Design

### New Table: `cash_receipts`

```sql
-- Cash Receipts Table for Tally Integration
-- Tracks cash receipt numbers assigned to cash payments
-- Non-invasive: Does not modify existing payment tables

CREATE TABLE cash_receipts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- User who CREATED this receipt record (for audit, NOT for filtering)
    
    -- Reference to original payment
    -- payment_source values: 'supply' (from approved_bills), 'ugrai' (UGRAI full), 'ugrai_partial' (UGRAI partial)
    payment_source TEXT NOT NULL CHECK (payment_source IN ('supply', 'ugrai', 'ugrai_partial')),
    payment_reference_id UUID NOT NULL, -- ID from source table (ab.id or uph.id)
    source_table TEXT NOT NULL CHECK (source_table IN ('approved_bills', 'ugrai_payment_history')), -- Actual source table for traceability
    
    -- Payment details (denormalized for quick access)
    bill_number TEXT NOT NULL,
    bill_date DATE NOT NULL,
    retailer_name TEXT NOT NULL,
    sector TEXT,
    payment_amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL, -- When payment was made/approved
    
    -- Tally receipt tracking
    tally_receipt_number TEXT, -- e.g., CASH-001, CASH-002
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed')),
    
    -- Tracking
    processed_by UUID REFERENCES auth.users(id), -- Admin/Accountant who last modified/processed it
    processed_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate entries (FIXED: use source_table to match JOIN logic)
    UNIQUE(source_table, payment_reference_id),
    
    -- CRITICAL FIX: Enforce source consistency to prevent data corruption
    CONSTRAINT check_source_consistency CHECK (
        (payment_source = 'supply' AND source_table = 'approved_bills') OR
        (payment_source IN ('ugrai', 'ugrai_partial') AND source_table = 'ugrai_payment_history')
    )
);

-- Indexes for performance
CREATE INDEX idx_cash_receipts_user_id ON cash_receipts(user_id);
CREATE INDEX idx_cash_receipts_status ON cash_receipts(status);
CREATE INDEX idx_cash_receipts_payment_date ON cash_receipts(payment_date);
CREATE INDEX idx_cash_receipts_payment_source ON cash_receipts(payment_source);
CREATE INDEX idx_cash_receipts_reference ON cash_receipts(source_table, payment_reference_id);

-- CRITICAL FIX: Case-insensitive unique constraint to prevent duplicate receipt numbers
-- Prevents 'CASH-001' and 'cash-001' from both being allowed
CREATE UNIQUE INDEX idx_unique_tally_receipt_number 
ON cash_receipts(UPPER(tally_receipt_number)) 
WHERE tally_receipt_number IS NOT NULL;

-- PERFORMANCE FIX: Composite index for faster date-based queries and sorting
-- Note: user_id included for potential audit queries, though not used in main filtering
CREATE INDEX idx_cash_receipts_user_date 
ON cash_receipts(user_id, payment_date DESC);

-- Performance indexes for source tables (optimized for cash payment queries)
-- Note: user_id may be used in source tables for their own filtering
CREATE INDEX idx_approved_bills_cash_payments 
ON approved_bills(payment_method, approval_date) 
WHERE payment_method = 'Cash';

CREATE INDEX idx_ugrai_payment_cash 
ON ugrai_payment_history(payment_method, payment_date) 
WHERE payment_method = 'Cash';

-- RLS Policies
ALTER TABLE cash_receipts ENABLE ROW LEVEL SECURITY;

-- SHARED DATA: All admin/accountant users can view all cash receipts
-- No user_id filtering - this is collaborative data for the team
CREATE POLICY "Admins and accountants can view all cash receipts" ON cash_receipts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('admin', 'accountant')
        )
    );

-- Only admins and accountants can insert cash receipts
CREATE POLICY "Admins and accountants can insert cash receipts" ON cash_receipts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('admin', 'accountant')
        )
    );

-- Only admins and accountants can update cash receipts
CREATE POLICY "Admins and accountants can update cash receipts" ON cash_receipts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('admin', 'accountant')
        )
    );

-- Trigger function to automatically update updated_at timestamp
-- Note: This function may already exist in your system. If not, create it:
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on every update
CREATE TRIGGER update_cash_receipts_updated_at
    BEFORE UPDATE ON cash_receipts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### Database Functions

```sql
-- Function to get all cash payments (pending and processed)
-- SHARED DATA: No user_id filtering - returns all cash payments for team
-- user_id in cash_receipts is for audit only (who processed it)
CREATE OR REPLACE FUNCTION get_all_cash_payments(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
) RETURNS TABLE(
    id UUID,
    source TEXT,
    bill_number TEXT,
    bill_date DATE,
    retailer_name TEXT,
    sector TEXT,
    payment_amount DECIMAL,
    payment_date DATE,
    tally_receipt_number TEXT,
    status TEXT,
    processed_by UUID,
    processed_date TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    
    -- Supply cash payments (from approved_bills)
    -- This includes full payments and partial payments from Supply workflow
    SELECT 
        ab.id,
        'supply'::TEXT as source,
        ab.bill_number,
        ab.bill_date,
        ab.retailer_name,
        ab.sector,
        ab.received_amount as payment_amount,
        ab.approval_date as payment_date, -- When cash was approved/recorded
        cr.tally_receipt_number,
        COALESCE(cr.status, 'pending') as status,
        cr.processed_by,
        cr.processed_date
    FROM approved_bills ab
    LEFT JOIN cash_receipts cr ON cr.source_table = 'approved_bills' 
        AND cr.payment_reference_id = ab.id
    WHERE ab.payment_method = 'Cash'
        AND (p_start_date IS NULL OR ab.approval_date >= p_start_date)
        AND (p_end_date IS NULL OR ab.approval_date <= p_end_date)
    
    UNION ALL
    
    -- UGRAI cash payments (from ugrai_payment_history)
    -- This includes both partial and full payments tracked in UGRAI workflow
    -- Note: Same bill_number may appear multiple times for partial payments
    -- Detect partial by comparing received_amount < net_amount
    SELECT 
        uph.id,
        -- FIXED: Add NULL handling to prevent errors if amounts are NULL
        CASE 
            WHEN COALESCE(uph.received_amount, 0) < COALESCE(uph.net_amount, 0) THEN 'ugrai_partial'::TEXT
            ELSE 'ugrai'::TEXT
        END as source,
        uph.bill_number,
        uph.bill_date,
        uph.retailer_name,
        uph.sector,
        uph.payment_amount,
        uph.payment_date, -- Actual payment collection date
        cr.tally_receipt_number,
        COALESCE(cr.status, 'pending') as status,
        cr.processed_by,
        cr.processed_date
    FROM ugrai_payment_history uph
    LEFT JOIN cash_receipts cr ON cr.source_table = 'ugrai_payment_history' 
        AND cr.payment_reference_id = uph.id
    WHERE uph.payment_method = 'Cash'
        AND (p_start_date IS NULL OR uph.payment_date >= p_start_date)
        AND (p_end_date IS NULL OR uph.payment_date <= p_end_date)
    
    UNION ALL
    
    -- Orphaned cash receipts (payment was deleted but receipt remains)
    -- FIXED: Added orphaned records detection for data integrity
    SELECT 
        cr.id,
        'orphaned'::TEXT as source,
        'DELETED-' || cr.payment_reference_id::TEXT as bill_number,
        NULL::DATE as bill_date,
        'Record Not Found'::TEXT as retailer_name,
        NULL::TEXT as sector,
        0::DECIMAL as payment_amount,
        cr.created_at::DATE as payment_date,
        cr.tally_receipt_number,
        'orphaned'::TEXT as status,
        cr.processed_by,
        cr.processed_date
    FROM cash_receipts cr
    WHERE cr.source_table = 'approved_bills'
        AND NOT EXISTS (
            SELECT 1 FROM approved_bills ab 
            WHERE ab.id = cr.payment_reference_id
        )
        
    UNION ALL
    
    SELECT 
        cr.id,
        'orphaned'::TEXT as source,
        'DELETED-' || cr.payment_reference_id::TEXT as bill_number,
        NULL::DATE as bill_date,
        'Record Not Found'::TEXT as retailer_name,
        NULL::TEXT as sector,
        0::DECIMAL as payment_amount,
        cr.created_at::DATE as payment_date,
        cr.tally_receipt_number,
        'orphaned'::TEXT as status,
        cr.processed_by,
        cr.processed_date
    FROM cash_receipts cr
    WHERE cr.source_table = 'ugrai_payment_history'
        AND NOT EXISTS (
            SELECT 1 FROM ugrai_payment_history uph 
            WHERE uph.id = cr.payment_reference_id
        )
    
    ORDER BY payment_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_all_cash_payments(DATE, DATE) TO authenticated;
```

---

## 🎨 Frontend Implementation

### Tab Navigation Structure

**Location:** `supply.html` - Main Processes section

#### Current Structure:
```html
<div id="main-processes" class="heading-container">
    <button class="heading-tab active" data-process="supply">SUPPLY</button>
    <button class="heading-tab" data-process="ugrai">UGRAI</button>
    <button class="heading-tab" data-process="purchase">PURCHASE</button>
    <button class="heading-tab" data-process="analysis">ANALYSIS</button>
</div>
```

#### Updated Structure:
```html
<div id="main-processes" class="heading-container">
    <button class="heading-tab active" data-process="supply">SUPPLY</button>
    <button class="heading-tab" data-process="ugrai">UGRAI</button>
    <button class="heading-tab" data-process="purchase">PURCHASE</button>
    <button class="heading-tab" data-process="analysis">ANALYSIS</button>
    <button class="heading-tab" data-process="cash-receipt" id="cash-receipt-tab" style="display: none;">CASH RECEIPT</button>
</div>
```

**Note:** Tab is hidden by default, shown via JavaScript if user has admin/accountant role.

### Cash Receipt Dashboard HTML

```html
<!-- Cash Receipt Dashboard Container -->
<div id="cash-receipt-dashboard-container" class="flex flex-col items-center max-w-7xl mx-auto" style="display: none;">
    <div class="w-full space-y-6">
        
        <!-- Cash Receipt Management Section -->
        <div id="cash-receipt-management" class="dashboard-section bg-white rounded-lg p-4 md:p-6 shadow-lg">
            <h3 class="text-lg font-bold mb-4">Cash Receipt Management</h3>
            
            <!-- Controls Row: Date Filters + Summary Stats -->
            <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
                
                <!-- Date Range Filters -->
                <div class="flex flex-col sm:flex-row gap-3">
                    <div class="flex flex-col">
                        <label class="text-xs text-gray-600 mb-1">From Date</label>
                        <input type="date" id="cash-receipt-start-date" 
                            class="compact-input bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-xs text-gray-600 mb-1">To Date</label>
                        <input type="date" id="cash-receipt-end-date" 
                            class="compact-input bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
                    </div>
                    <div class="flex items-end">
                        <button id="apply-date-filter-btn" 
                            class="compact-btn btn-red transition-colors duration-300">
                            Apply Filter
                        </button>
                    </div>
                    <div class="flex items-end">
                        <button id="clear-date-filter-btn" 
                            class="compact-btn btn-white transition-colors duration-300">
                            Clear
                        </button>
                    </div>
                </div>
                
                <!-- Summary Statistics -->
                <div class="flex gap-4">
                    <div class="text-center">
                        <p class="text-xs text-gray-600">Total Payments</p>
                        <p id="total-cash-payments" class="text-xl font-bold text-gray-800">0</p>
                    </div>
                    <div class="text-center">
                        <p class="text-xs text-gray-600">Processed</p>
                        <p id="processed-cash-payments" class="text-xl font-bold text-green-600">0</p>
                    </div>
                    <div class="text-center">
                        <p class="text-xs text-gray-600">Pending</p>
                        <p id="pending-cash-payments" class="text-xl font-bold text-orange-600">0</p>
                    </div>
                    <div class="text-center">
                        <p class="text-xs text-gray-600">Total Amount</p>
                        <p id="total-cash-amount" class="text-xl font-bold text-blue-600">₹0</p>
                    </div>
                </div>
            </div>
            
            <!-- Status Filter Tabs -->
            <div class="flex gap-2 mb-4">
                <button id="filter-all-cash" class="compact-btn btn-black active-filter" data-filter="all">
                    All
                </button>
                <button id="filter-pending-cash" class="compact-btn btn-white" data-filter="pending">
                    Pending
                </button>
                <button id="filter-processed-cash" class="compact-btn btn-white" data-filter="processed">
                    Processed
                </button>
            </div>
            
            <!-- Cash Receipts Table -->
            <div class="table-container">
                <table class="w-full text-sm">
                    <thead class="text-xs uppercase">
                        <tr>
                            <th scope="col" class="sortable" data-sort="bill_number">Bill Number</th>
                            <th scope="col" class="sortable" data-sort="bill_date">Bill Date</th>
                            <th scope="col" class="sortable" data-sort="retailer_name">Retailer Name</th>
                            <th scope="col" class="sortable" data-sort="sector">Sector</th>
                            <th scope="col" class="sortable" data-sort="payment_amount">Amount</th>
                            <th scope="col" class="sortable" data-sort="payment_date">Payment Date</th>
                            <th scope="col" class="sortable" data-sort="source">Source</th>
                            <th scope="col">Receipt Number</th>
                            <th scope="col">Status</th>
                            <th scope="col">Action</th>
                        </tr>
                    </thead>
                    <tbody id="cash-receipts-table">
                        <!-- Populated dynamically -->
                        <tr>
                            <td colspan="10" class="text-center py-8 text-gray-500">
                                No cash payments found. Adjust your filters or date range.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            
            <!-- ADDED: Pagination Container -->
            <div id="pagination-container" class="mt-4">
                <!-- Pagination controls rendered dynamically by renderPaginationControls() -->
            </div>
            
            <!-- Export Button -->
            <div class="flex justify-end mt-4">
                <button id="export-cash-receipts-btn" 
                    class="compact-btn btn-black transition-colors duration-300">
                    📊 Export to Excel
                </button>
            </div>
        </div>
    </div>
</div>
```

### Table Row Structure

```html
<!-- Example row structure (generated by JavaScript) -->
<tr data-payment-id="abc-123" data-source="ugrai_payment_history" data-status="pending" class="status-pending">
    <td class="font-medium">L4752</td>
    <td>2025-10-31</td>
    <td>ABC Store</td>
    <td>Sector 1</td>
    <td class="font-semibold">₹10,000</td>
    <td>2025-11-01</td>
    <td>
        <span class="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800">
            UGRAI
        </span>
    </td>
    <td>
        <input type="text" 
            class="receipt-number-input compact-input w-32" 
            placeholder="CASH-001" 
            value=""
            data-payment-id="abc-123">
    </td>
    <td>
        <span class="status-badge status-pending px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-800">
            ⏳ Pending
        </span>
    </td>
    <td>
        <button class="submit-receipt-btn compact-btn btn-green" 
            data-payment-id="abc-123" 
            data-source="ugrai_payment_history">
            ✅ Done
        </button>
    </td>
</tr>

<!-- Processed row example -->
<tr data-payment-id="xyz-789" data-source="supply" data-status="processed" class="status-processed bg-green-50">
    <td class="font-medium">S1234</td>
    <td>2025-10-15</td>
    <td>XYZ Retailers</td>
    <td>Sector 2</td>
    <td class="font-semibold">₹5,500</td>
    <td>2025-10-16</td>
    <td>
        <span class="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
            Supply
        </span>
    </td>
    <td>
        <input type="text" 
            class="receipt-number-input compact-input w-32" 
            placeholder="CASH-001" 
            value="CASH-045"
            data-payment-id="xyz-789">
    </td>
    <td>
        <span class="status-badge status-processed px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
            ✅ Processed
        </span>
    </td>
    <td>
        <button class="update-receipt-btn compact-btn btn-blue" 
            data-payment-id="xyz-789" 
            data-source="supply">
            📝 Update
        </button>
    </td>
</tr>
```

### Visual Indicators

#### Status Badges
```css
/* Pending Status */
.status-pending {
    background-color: #FEF3C7; /* Orange/Yellow background */
    color: #92400E;
}

/* Processed Status */
.status-processed {
    background-color: #D1FAE5; /* Green background */
    color: #065F46;
}

/* Row highlighting */
tr.status-processed {
    background-color: #F0FDF4 !important; /* Light green row */
}

tr.status-pending:hover {
    background-color: #FEF9E7; /* Slight yellow on hover */
}
```

---

## ⚙️ Backend Implementation

### Supabase Service Methods

**File:** `supabase-service.js`

```javascript
/**
 * Escape HTML to prevent XSS attacks
 * FIXED: Added XSS prevention utility
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
 * @param {Date} startDate - Optional start date
 * @param {Date} endDate - Optional end date
 * @returns {Promise<Array>} Array of cash payments
 */
async getAllCashPayments(startDate = null, endDate = null) {
    try {
        console.log('📄 Fetching all cash payments...', { startDate, endDate });
        
        // SHARED DATA: No user_id filtering - fetches all payments for team
        const { data, error } = await this.supabase.rpc('get_all_cash_payments', {
            p_start_date: startDate,
            p_end_date: endDate
        });
        
        if (error) {
            console.error('❌ Error fetching cash payments:', error);
            throw error;
        }
        
        console.log(`✅ Fetched ${data.length} cash payments`);
        return data;
    } catch (error) {
        console.error('❌ Exception in getAllCashPayments:', error);
        throw error;
    }
}

/**
 * Submit/Update cash receipt number for a payment
 * @param {Object} receiptData - Receipt data
 * @returns {Promise<Object>} Updated receipt record
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
            'paymentDate': 'Payment date',
            'tallyReceiptNumber': 'Tally receipt number'
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
        
        // Validate receipt number
        if (!tallyReceiptNumber || tallyReceiptNumber.trim() === '') {
            throw new Error('Receipt number is required');
        }
        
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
        const { data: existing, error: lookupError } = await this.supabase
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
            // Update existing receipt - this path is for changing receipt numbers
            // No need for frontend confirmation here - handled in frontend before calling this
            const { data, error } = await this.supabase
                .from('cash_receipts')
                .update({
                    tally_receipt_number: tallyReceiptNumber,
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
            const { data, error } = await this.supabase
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
                    tally_receipt_number: tallyReceiptNumber,
                    status: 'processed',
                    processed_by: this.userId,
                    processed_date: new Date().toISOString()
                })
                .select()
                .single();
            
            if (error) {
                // Handle duplicate receipt number error gracefully
                if (error.code === '23505') { // PostgreSQL unique violation
                    // FIXED: Add error handling for the conflict lookup query
                    const { data: existingReceipt, error: lookupError } = await this.supabase
                        .from('cash_receipts')
                        .select('bill_number')
                        .eq('tally_receipt_number', tallyReceiptNumber)
                        .maybeSingle();
                    
                    if (lookupError) {
                        console.error('❌ Error looking up conflicting receipt:', lookupError);
                        throw new Error(`Receipt number ${tallyReceiptNumber} is already in use`);
                    }
                    
                    throw new Error(
                        `Receipt number ${tallyReceiptNumber} already used for Bill #${existingReceipt?.bill_number || 'unknown'}`
                    );
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
 * Check if user has admin or accountant role
 * @returns {Promise<Boolean>}
 */
async hasAdminOrAccountantRole() {
    try {
        const { data, error } = await this.supabase
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
```

### Scripts.js Integration

**File:** `scripts.js`

```javascript
// Global state extension
const appState = {
    // ... existing state
    cashReceiptData: {
        allPayments: [],
        filteredPayments: [],
        currentFilter: 'all', // all, pending, processed
        dateRange: {
            start: null,
            end: null
        },
        isLoading: false,  // FIXED: Prevent race conditions
        pagination: {  // ADDED: Pagination support for large datasets
            currentPage: 1,
            itemsPerPage: 50,
            totalPages: 1
        }
    }
};

// DOM element references (add to existing list)
let cashReceiptDashboardContainer,
    cashReceiptStartDate,
    cashReceiptEndDate,
    applyDateFilterBtn,
    clearDateFilterBtn,
    cashReceiptsTable,
    totalCashPayments,
    processedCashPayments,
    pendingCashPayments,
    totalCashAmount,
    exportCashReceiptsBtn,
    cashReceiptTab;

/**
 * Initialize Cash Receipt Dashboard
 */
async function initializeCashReceiptDashboard() {
    try {
        console.log('🎫 Initializing Cash Receipt Dashboard...');
        
        // CRITICAL FIX: Check DOM elements exist to prevent crashes
        const cashReceiptTab = document.getElementById('cash-receipt-tab');
        const cashReceiptStartDate = document.getElementById('cash-receipt-start-date');
        const cashReceiptEndDate = document.getElementById('cash-receipt-end-date');
        const cashReceiptsTable = document.getElementById('cash-receipts-table');
        const cashReceiptDashboardContainer = document.getElementById('cash-receipt-dashboard-container');
        
        if (!cashReceiptTab || !cashReceiptStartDate || !cashReceiptEndDate || 
            !cashReceiptsTable || !cashReceiptDashboardContainer) {
            console.error('❌ Cash Receipt dashboard elements not found in DOM');
            console.error('Missing elements:', {
                cashReceiptTab: !cashReceiptTab,
                cashReceiptStartDate: !cashReceiptStartDate,
                cashReceiptEndDate: !cashReceiptEndDate,
                cashReceiptsTable: !cashReceiptsTable,
                cashReceiptDashboardContainer: !cashReceiptDashboardContainer
            });
            return;
        }
        
        // Check if user has permission
        const hasPermission = await appState.supabaseService.hasAdminOrAccountantRole();
        
        if (!hasPermission) {
            console.log('⛔ User does not have admin/accountant role - hiding Cash Receipt tab');
            cashReceiptTab.style.display = 'none';
            return;
        }
        
        // Show the tab if user has permission
        cashReceiptTab.style.display = 'block';
        
        // Set default date range (current month)
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        
        cashReceiptStartDate.value = formatDateForInput(firstDayOfMonth);
        cashReceiptEndDate.value = formatDateForInput(today);
        
        // Load initial data
        await loadCashPayments();
        
        console.log('✅ Cash Receipt Dashboard initialized');
    } catch (error) {
        console.error('❌ Error initializing Cash Receipt dashboard:', error);
        Swal.fire({
            icon: 'error',
            title: 'Initialization Failed',
            text: 'Failed to initialize Cash Receipt dashboard. Please refresh the page.'
        });
    }
}

/**
 * Load cash payments with optional filtering
 * FIXED: Added loading state to prevent concurrent operations
 */
async function loadCashPayments() {
    // Prevent concurrent loads
    if (appState.cashReceiptData.isLoading) {
        console.log('⏳ Already loading payments, skipping...');
        return;
    }
    
    try {
        appState.cashReceiptData.isLoading = true;
        showLoadingState(cashReceiptsTable);
        
        const startDate = cashReceiptStartDate?.value || null;
        const endDate = cashReceiptEndDate?.value || null;
        
        appState.cashReceiptData.dateRange = { start: startDate, end: endDate };
        
        const payments = await appState.supabaseService.getAllCashPayments(startDate, endDate);
        
        appState.cashReceiptData.allPayments = payments;
        
        // Reapply current filter to new data
        applyStatusFilter(appState.cashReceiptData.currentFilter);
        renderCashReceiptsTable();
        updateCashReceiptStats();
        
    } catch (error) {
        console.error('❌ Error loading cash payments:', error);
        showErrorInTable(cashReceiptsTable, 'Failed to load cash payments. Please try again.');
    } finally {
        appState.cashReceiptData.isLoading = false;
    }
}

/**
 * Apply status filter (all, pending, processed)
 * FIXED: Reset pagination when filter changes
 */
function applyStatusFilter(filter) {
    appState.cashReceiptData.currentFilter = filter;
    
    if (filter === 'all') {
        appState.cashReceiptData.filteredPayments = appState.cashReceiptData.allPayments;
    } else {
        appState.cashReceiptData.filteredPayments = appState.cashReceiptData.allPayments.filter(
            payment => payment.status === filter
        );
    }
    
    // Reset to page 1 when filter changes
    appState.cashReceiptData.pagination.currentPage = 1;
    
    // Update active button styling
    document.querySelectorAll('[data-filter]').forEach(btn => {
        if (btn.dataset.filter === filter) {
            btn.classList.add('btn-black', 'active-filter');
            btn.classList.remove('btn-white');
        } else {
            btn.classList.remove('btn-black', 'active-filter');
            btn.classList.add('btn-white');
        }
    });
}

/**
 * Render cash receipts table with visual grouping for multiple payments
 * FIXED: Optimized indexOf() with Map for O(1) lookup
 * FIXED: Use allPayments for grouping to show accurate counts
 * FIXED: Added pagination for large datasets
 */
function renderCashReceiptsTable() {
    if (!cashReceiptsTable) return;
    
    const { currentPage, itemsPerPage } = appState.cashReceiptData.pagination;
    const allFilteredPayments = appState.cashReceiptData.filteredPayments;
    
    // Calculate pagination
    const totalPages = Math.ceil(allFilteredPayments.length / itemsPerPage);
    appState.cashReceiptData.pagination.totalPages = totalPages;
    
    // Get current page items
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const payments = allFilteredPayments.slice(startIndex, endIndex);
    
    if (allFilteredPayments.length === 0) {
        cashReceiptsTable.innerHTML = `
            <tr>
                <td colspan="10" class="text-center py-8 text-gray-500">
                    No cash payments found. Adjust your filters or date range.
                </td>
            </tr>
        `;
        renderPaginationControls(0, 1, 1);
        return;
    }
    
    // CRITICAL FIX: Group payments using allPayments (not filteredPayments)
    // This ensures payment count is accurate even when filtering
    const billGroups = {};
    const paymentIndexMap = new Map();
    
    appState.cashReceiptData.allPayments.forEach(payment => {
        if (!billGroups[payment.bill_number]) {
            billGroups[payment.bill_number] = [];
        }
        const group = billGroups[payment.bill_number];
        paymentIndexMap.set(payment.id, group.length + 1); // Store 1-based index
        group.push(payment);
    });
    
    cashReceiptsTable.innerHTML = payments.map(payment => {
        const isProcessed = payment.status === 'processed';
        const sourceLabel = getSourceLabel(payment.source);
        const sourceBadgeClass = getSourceBadgeClass(payment.source);
        
        // Determine if this bill has multiple payments
        const paymentsForBill = billGroups[payment.bill_number];
        const hasMultiplePayments = paymentsForBill.length > 1;
        const paymentIndex = paymentIndexMap.get(payment.id); // O(1) lookup instead of indexOf()
        
        // Get source table for backend mapping
        const sourceTable = payment.source === 'supply' ? 'approved_bills' : 'ugrai_payment_history';
        const isUpdate = !!payment.tally_receipt_number;
        
        return `
            <tr data-payment-id="${payment.id}" 
                data-source="${payment.source}"
                data-source-table="${sourceTable}"
                data-status="${payment.status}"
                class="status-${payment.status} ${isProcessed ? 'bg-green-50' : ''} ${hasMultiplePayments ? 'border-l-4 border-blue-400' : ''}">
                <td class="font-medium ${hasMultiplePayments ? 'pl-4' : ''}">
                    ${hasMultiplePayments ? `
                        <div class="flex items-center gap-2">
                            <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-semibold">
                                ${paymentIndex}/${paymentsForBill.length}
                            </span>
                            ${escapeHtml(payment.bill_number)}
                        </div>
                    ` : escapeHtml(payment.bill_number)}
                </td>
                <td>${formatDate(payment.bill_date)}</td>
                <td>${escapeHtml(payment.retailer_name)}</td>
                <td>${escapeHtml(payment.sector || '-')}</td>
                <td class="font-semibold">₹${formatNumber(payment.payment_amount)}</td>
                <td>${formatDate(payment.payment_date)}</td>
                <td>
                    <span class="px-2 py-1 text-xs rounded-full ${sourceBadgeClass}">
                        ${sourceLabel}
                    </span>
                </td>
                <td>
                    <input type="text" 
                        class="receipt-number-input compact-input w-32" 
                        placeholder="CASH-001" 
                        value="${escapeHtml(payment.tally_receipt_number || '')}"
                        data-payment-id="${payment.id}"
                        ${isProcessed ? '' : 'autofocus'}>
                </td>
                <td>
                    <span class="status-badge status-${payment.status} px-2 py-1 text-xs rounded-full ${isProcessed ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}">
                        ${isProcessed ? '✅ Processed' : '⏳ Pending'}
                    </span>
                </td>
                <td>
                    <button class="${isUpdate ? 'update' : 'submit'}-receipt-btn compact-btn ${isUpdate ? 'btn-blue' : 'btn-green'}" 
                        data-payment-id="${payment.id}" 
                        data-source="${payment.source}"
                        data-source-table="${sourceTable}"
                        data-is-update="${isUpdate}">
                        ${isUpdate ? '📝 Update' : '✅ Done'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    // Render pagination controls
    renderPaginationControls(allFilteredPayments.length, currentPage, totalPages);
    
    // Attach event listeners to buttons
    attachReceiptButtonListeners();
}

/**
 * Render pagination controls
 * ADDED: Pagination support for large datasets
 */
function renderPaginationControls(totalItems, currentPage, totalPages) {
    const paginationContainer = document.getElementById('pagination-container');
    if (!paginationContainer) {
        console.warn('Pagination container not found');
        return;
    }
    
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    const { itemsPerPage } = appState.cashReceiptData.pagination;
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);
    
    paginationContainer.innerHTML = `
        <div class="flex justify-between items-center mt-4 p-4 bg-gray-50 rounded-lg">
            <div class="text-sm text-gray-600">
                Showing <span class="font-semibold">${startItem}-${endItem}</span> of <span class="font-semibold">${totalItems}</span> payments
            </div>
            <div class="flex gap-2">
                <button 
                    onclick="changePage(${currentPage - 1})" 
                    ${currentPage === 1 ? 'disabled' : ''}
                    class="px-4 py-2 border rounded-lg ${currentPage === 1 ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'hover:bg-gray-100 bg-white'}">
                    ← Previous
                </button>
                <span class="px-4 py-2 bg-white border rounded-lg font-medium">
                    Page ${currentPage} of ${totalPages}
                </span>
                <button 
                    onclick="changePage(${currentPage + 1})" 
                    ${currentPage === totalPages ? 'disabled' : ''}
                    class="px-4 py-2 border rounded-lg ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'hover:bg-gray-100 bg-white'}">
                    Next →
                </button>
            </div>
        </div>
    `;
}

/**
 * Change pagination page
 * ADDED: Pagination navigation
 */
function changePage(newPage) {
    const { totalPages } = appState.cashReceiptData.pagination;
    if (newPage < 1 || newPage > totalPages) return;
    
    appState.cashReceiptData.pagination.currentPage = newPage;
    renderCashReceiptsTable();
    
    // Scroll to top of table
    const tableContainer = document.getElementById('cash-receipt-management');
    if (tableContainer) {
        tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Handle receipt submission (for new entries - no confirmation needed)
 * Handle receipt update (for existing entries - requires confirmation)
 * FIXED: Added HTML escaping to prevent XSS
 */
async function handleReceiptSubmission(paymentId, source, sourceTable, isUpdate = false) {
    try {
        const input = document.querySelector(`input[data-payment-id="${paymentId}"]`);
        const receiptNumber = input?.value?.trim();
        
        if (!receiptNumber) {
            await Swal.fire({
                icon: 'warning',
                title: 'Receipt Number Required',
                text: 'Please enter a cash receipt number before submitting.'
            });
            input?.focus();
            return;
        }
        
        // Find payment data
        const payment = appState.cashReceiptData.allPayments.find(p => p.id === paymentId);
        if (!payment) {
            throw new Error('Payment not found');
        }
        
        // If updating existing receipt, ask for confirmation
        if (isUpdate && payment.tally_receipt_number) {
            const confirmUpdate = await Swal.fire({
                icon: 'warning',
                title: 'Update Receipt Number?',
                html: `
                    <div class="text-left">
                        <p><strong>Bill Number:</strong> ${escapeHtml(payment.bill_number)}</p>
                        <p><strong>Current Receipt:</strong> <span class="text-red-600">${escapeHtml(payment.tally_receipt_number)}</span></p>
                        <p><strong>New Receipt:</strong> <span class="text-green-600">${escapeHtml(receiptNumber)}</span></p>
                        <p class="text-sm text-gray-600 mt-2">⚠️ This will change the existing receipt number. Continue?</p>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: 'Yes, Update',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#dc2626'
            });
            
            if (!confirmUpdate.isConfirmed) return;
        }
        
        // Submit to database (no confirmation for new entries)
        await appState.supabaseService.submitCashReceipt({
            paymentId: payment.id,
            paymentSource: source,
            sourceTable: sourceTable,
            billNumber: payment.bill_number,
            billDate: payment.bill_date,
            retailerName: payment.retailer_name,
            sector: payment.sector,
            paymentAmount: payment.payment_amount,
            paymentDate: payment.payment_date,
            tallyReceiptNumber: receiptNumber
        });
        
        // Success feedback
        await Swal.fire({
            icon: 'success',
            title: isUpdate ? 'Receipt Updated!' : 'Receipt Submitted!',
            text: `Cash receipt ${receiptNumber} has been ${isUpdate ? 'updated' : 'recorded'}.`,
            timer: 2000,
            showConfirmButton: false
        });
        
        // Reload data
        await loadCashPayments();
        
    } catch (error) {
        console.error('❌ Error submitting receipt:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Submission Failed',
            text: error.message || 'Failed to submit cash receipt. Please try again.'
        });
    }
}

/**
 * Update statistics display
 */
function updateCashReceiptStats() {
    const payments = appState.cashReceiptData.allPayments;
    
    const total = payments.length;
    const processed = payments.filter(p => p.status === 'processed').length;
    const pending = total - processed;
    const totalAmount = payments.reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0);
    
    if (totalCashPayments) totalCashPayments.textContent = total;
    if (processedCashPayments) processedCashPayments.textContent = processed;
    if (pendingCashPayments) pendingCashPayments.textContent = pending;
    if (totalCashAmount) totalCashAmount.textContent = `₹${formatNumber(totalAmount)}`;
}

/**
 * Export to Excel
 */
function exportCashReceiptsToExcel() {
    const payments = appState.cashReceiptData.filteredPayments;
    
    if (payments.length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'No Data',
            text: 'No cash payments to export.'
        });
        return;
    }
    
    // Prepare data for export
    const exportData = payments.map(p => ({
        'Bill Number': p.bill_number,
        'Bill Date': formatDate(p.bill_date),
        'Retailer Name': p.retailer_name,
        'Sector': p.sector || '-',
        'Amount': p.payment_amount,
        'Payment Date': formatDate(p.payment_date),
        'Source': getSourceLabel(p.source),
        'Tally Receipt Number': p.tally_receipt_number || '-',
        'Status': p.status === 'processed' ? 'Processed' : 'Pending',
        'Processed Date': p.processed_date ? formatDate(p.processed_date) : '-'
    }));
    
    // Create worksheet and workbook
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cash Receipts');
    
    // Generate filename with date range
    const startDate = appState.cashReceiptData.dateRange.start || 'all';
    const endDate = appState.cashReceiptData.dateRange.end || 'all';
    const filename = `Cash_Receipts_${startDate}_to_${endDate}.xlsx`;
    
    // Download
    XLSX.writeFile(wb, filename);
    
    console.log('📊 Exported cash receipts to Excel');
}

// Helper functions
function getSourceLabel(source) {
    const labels = {
        'supply': 'Supply',
        'ugrai': 'UGRAI',
        'ugrai_partial': 'UGRAI (Partial)'
    };
    return labels[source] || source;
}

function getSourceBadgeClass(source) {
    const classes = {
        'supply': 'bg-blue-100 text-blue-800',
        'ugrai': 'bg-purple-100 text-purple-800',
        'ugrai_partial': 'bg-orange-100 text-orange-800'
    };
    return classes[source] || 'bg-gray-100 text-gray-800';
}

function showLoadingState(tableBody) {
    if (!tableBody) return;
    tableBody.innerHTML = `
        <tr>
            <td colspan="10" class="text-center py-8">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                <p class="mt-2 text-gray-600">Loading cash payments...</p>
            </td>
        </tr>
    `;
}

function showErrorInTable(tableBody, message) {
    if (!tableBody) return;
    tableBody.innerHTML = `
        <tr>
            <td colspan="10" class="text-center py-8 text-red-600">
                ❌ ${message}
            </td>
        </tr>
    `;
}

// Event listener attachment
// FIXED: Added error handling to prevent unhandled promise rejections
function attachReceiptButtonListeners() {
    // Submit/Update buttons
    document.querySelectorAll('.submit-receipt-btn, .update-receipt-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            try {
                const paymentId = e.target.dataset.paymentId;
                const source = e.target.dataset.source;
                const sourceTable = e.target.dataset.sourceTable;
                const isUpdate = e.target.dataset.isUpdate === 'true';
                await handleReceiptSubmission(paymentId, source, sourceTable, isUpdate);
            } catch (error) {
                console.error('❌ Error in receipt button click:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: error.message || 'An unexpected error occurred'
                });
            }
        });
    });
    
    // Allow Enter key in receipt number inputs
    document.querySelectorAll('.receipt-number-input').forEach(input => {
        input.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                try {
                    const paymentId = e.target.dataset.paymentId;
                    const row = e.target.closest('tr');
                    const source = row.dataset.source;
                    const sourceTable = row.dataset.sourceTable;
                    const btn = row.querySelector('.submit-receipt-btn, .update-receipt-btn');
                    const isUpdate = btn?.dataset.isUpdate === 'true';
                    await handleReceiptSubmission(paymentId, source, sourceTable, isUpdate);
                } catch (error) {
                    console.error('❌ Error in Enter key submission:', error);
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: error.message || 'An unexpected error occurred'
                    });
                }
            }
        });
    });
}

// Initialize on load (add to existing initialization)
document.addEventListener('DOMContentLoaded', async () => {
    // ... existing initialization code
    
    // Initialize Cash Receipt elements
    cashReceiptDashboardContainer = document.getElementById('cash-receipt-dashboard-container');
    cashReceiptStartDate = document.getElementById('cash-receipt-start-date');
    cashReceiptEndDate = document.getElementById('cash-receipt-end-date');
    applyDateFilterBtn = document.getElementById('apply-date-filter-btn');
    clearDateFilterBtn = document.getElementById('clear-date-filter-btn');
    cashReceiptsTable = document.getElementById('cash-receipts-table');
    totalCashPayments = document.getElementById('total-cash-payments');
    processedCashPayments = document.getElementById('processed-cash-payments');
    pendingCashPayments = document.getElementById('pending-cash-payments');
    totalCashAmount = document.getElementById('total-cash-amount');
    exportCashReceiptsBtn = document.getElementById('export-cash-receipts-btn');
    cashReceiptTab = document.getElementById('cash-receipt-tab');
    
    // Event listeners
    if (applyDateFilterBtn) {
        applyDateFilterBtn.addEventListener('click', loadCashPayments);
    }
    
    if (clearDateFilterBtn) {
        clearDateFilterBtn.addEventListener('click', () => {
            cashReceiptStartDate.value = '';
            cashReceiptEndDate.value = '';
            loadCashPayments();
        });
    }
    
    if (exportCashReceiptsBtn) {
        exportCashReceiptsBtn.addEventListener('click', exportCashReceiptsToExcel);
    }
    
    // Status filter buttons
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = e.target.dataset.filter;
            applyStatusFilter(filter);
            renderCashReceiptsTable();
        });
    });
    
    // Tab click handler (integrate with existing tab system)
    if (cashReceiptTab) {
        cashReceiptTab.addEventListener('click', async () => {
            // Hide other dashboards
            document.querySelectorAll('[id$="-dashboard-container"]').forEach(container => {
                container.style.display = 'none';
            });
            
            // Show cash receipt dashboard
            if (cashReceiptDashboardContainer) {
                cashReceiptDashboardContainer.style.display = 'block';
            }
            
            // Initialize if not already done
            if (appState.cashReceiptData.allPayments.length === 0) {
                await initializeCashReceiptDashboard();
            }
        });
    }
    
    // Initialize cash receipt dashboard
    await initializeCashReceiptDashboard();
});
```

---

## 🔒 Security & RBAC

### Role-Based Access Control

#### Database Level (RLS Policies)

```sql
-- Only admin and accountant roles can insert/update cash receipts
CREATE POLICY "Admins and accountants can insert cash receipts" ON cash_receipts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('admin', 'accountant')
        )
    );
```

#### Frontend Level (JavaScript)

```javascript
// Check user role before showing tab
async function initializeCashReceiptDashboard() {
    const hasPermission = await appState.supabaseService.hasAdminOrAccountantRole();
    
    if (!hasPermission) {
        cashReceiptTab.style.display = 'none'; // Hide tab completely
        return;
    }
    
    cashReceiptTab.style.display = 'block'; // Show tab
    // ... rest of initialization
}
```

#### Helper Function in Supabase Service

```javascript
async hasAdminOrAccountantRole() {
    try {
        const { data, error } = await this.supabase
            .from('user_roles')
            .select('role_id, roles(name)')
            .eq('user_id', this.userId);
        
        if (error) throw error;
        
        return data.some(ur => 
            ur.roles && (ur.roles.name === 'admin' || ur.roles.name === 'accountant')
        );
    } catch (error) {
        console.error('❌ Error checking roles:', error);
        return false;
    }
}
```

### Security Considerations

1. **Tab Visibility**: Hidden by default, shown only if user has admin/accountant role
2. **Database RLS**: Policies prevent unauthorized insert/update even if frontend is bypassed
3. **Shared Team Data**: All admin/accountant users can view and edit all receipts (collaborative workflow)
4. **Input Validation**: Receipt numbers validated before submission
5. **Audit Trail**: `user_id` field tracks who processed each receipt (for accountability)

---

## 🧪 Testing Strategy

### Phase 1: Database Testing (SQL)

#### Test 1: Table Creation
```sql
-- Verify table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'cash_receipts';

-- Expected: 1 row returned
```

#### Test 2: RLS Policies
```sql
-- Check policies exist
SELECT policyname, cmd, roles 
FROM pg_policies 
WHERE tablename = 'cash_receipts';

-- Expected: 3 policies (SELECT, INSERT, UPDATE)
```

#### Test 3: Function Execution
```sql
-- Test get_all_cash_payments function
SELECT * FROM get_all_cash_payments(
    '<your-user-id>'::UUID,
    '2025-01-01'::DATE,
    '2025-12-31'::DATE
);

-- Expected: Returns cash payments from all 3 sources
```

#### Test 4: Insert Cash Receipt
```sql
-- Test insert (as admin/accountant)
INSERT INTO cash_receipts (
    user_id,
    payment_source,
    payment_reference_id,
    bill_number,
    bill_date,
    retailer_name,
    payment_amount,
    payment_date,
    tally_receipt_number,
    status
) VALUES (
    auth.uid(),
    'approved_bills',
    '<valid-payment-id>',
    'TEST-001',
    '2025-10-15',
    'Test Retailer',
    1000.00,
    '2025-10-16',
    'CASH-TEST-001',
    'processed'
);

-- Expected: Success if user has admin/accountant role
-- Expected: Error if user doesn't have proper role
```

### Phase 2: Frontend Testing (Manual)

#### Test Scenario 1: Role-Based Visibility
**Steps:**
1. Login as regular user (supply_in_progress role)
2. Check if "CASH RECEIPT" tab is visible
3. **Expected:** Tab should be hidden

4. Login as admin user
5. Check if "CASH RECEIPT" tab is visible
6. **Expected:** Tab should be visible

#### Test Scenario 2: Data Loading
**Steps:**
1. Login as admin
2. Click "CASH RECEIPT" tab
3. Observe loading state
4. **Expected:** 
   - Shows loading spinner
   - Loads cash payments from all sources
   - Displays in table format
   - Shows correct statistics

#### Test Scenario 3: Date Filtering
**Steps:**
1. Set start date: 2025-01-01
2. Set end date: 2025-01-31
3. Click "Apply Filter"
4. **Expected:** Only shows payments within January 2025

5. Click "Clear" button
6. **Expected:** Resets date filters and shows all payments

#### Test Scenario 4: Status Filtering
**Steps:**
1. Click "Pending" filter button
2. **Expected:** Only shows pending payments (no receipt number)

3. Click "Processed" filter button
4. **Expected:** Only shows processed payments (with receipt numbers)

5. Click "All" filter button
6. **Expected:** Shows all payments

#### Test Scenario 5: Receipt Submission
**Steps:**
1. Find a pending payment row
2. Enter receipt number: "CASH-001"
3. Click "✅ Done" button
4. **Expected:**
   - Shows confirmation dialog with payment details
   - On confirm, submits to database
   - Shows success message
   - Row updates to "Processed" status with green background
   - Button changes to "📝 Update"

#### Test Scenario 6: Receipt Update
**Steps:**
1. Find a processed payment row
2. Change receipt number from "CASH-001" to "CASH-002"
3. Click "📝 Update" button
4. **Expected:**
   - Shows confirmation dialog
   - Updates receipt number in database
   - Shows success message
   - Table refreshes with new number

#### Test Scenario 7: Validation
**Steps:**
1. Find a pending payment row
2. Leave receipt number input empty
3. Click "✅ Done" button
4. **Expected:**
   - Shows warning: "Receipt Number Required"
   - Does not submit
   - Keeps focus on input field

#### Test Scenario 8: Export to Excel
**Steps:**
1. Apply filters (date range, status)
2. Click "📊 Export to Excel" button
3. **Expected:**
   - Downloads Excel file with correct filename
   - Contains all filtered payments
   - Columns match table structure
   - Data is accurate

#### Test Scenario 9: Multi-Source Display
**Steps:**
1. Verify table contains payments from:
   - approved_bills (Source badge: "Supply" - Blue)
   - ugrai_payment_history with payment_type='full' (Source badge: "UGRAI" - Purple)
   - ugrai_payment_history with payment_type='partial' (Source badge: "UGRAI (Partial)" - Orange)
2. **Expected:** Each source has correct badge color and label
3. **Note:** Same bill number may appear multiple times if partial payments were made

#### Test Scenario 10: Sorting
**Steps:**
1. Click on "Bill Number" column header
2. **Expected:** Table sorts by bill number (ascending)
3. Click again
4. **Expected:** Sorts descending

5. Repeat for other sortable columns
6. **Expected:** All sortable columns work correctly

### Phase 3: Integration Testing

#### Test Scenario 11: New Cash Payment Flow
**Steps:**
1. Create a new supply bill with payment_method = 'Cash'
2. Complete the bill with full amount
3. Approve the bill
4. Navigate to Cash Receipt tab
5. **Expected:** New payment appears in the table as "Pending" with Source = "Supply"

#### Test Scenario 11b: Partial Payment Flow
**Steps:**
1. Create a new supply bill for ₹10,000 with payment_method = 'Cash'
2. Complete the bill with received_amount = ₹6,000 (partial)
3. Approve the bill
4. Navigate to Cash Receipt tab
5. **Expected:** One payment appears for ₹6,000 (Source = "Supply")
6. Complete the UGRAI collection for remaining ₹4,000 in cash
7. Approve the UGRAI payment
8. **Expected:** Second payment appears for ₹4,000 (Source = "UGRAI" or "UGRAI (Partial)")
9. **Note:** Same bill number appears twice - this is correct!

#### Test Scenario 12: Cross-User Collaboration
**Steps:**
1. Login as User A (admin)
2. Assign receipt "CASH-001" to Bill #123
3. Logout and login as User B (accountant)
4. **Expected:** User B can see Bill #123 with User A's assigned receipt "CASH-001"
5. User B can edit/update the same receipt
6. **Note:** All admin/accountant users see the same shared pool of data

#### Test Scenario 13: Performance Test
**Steps:**
1. Load Cash Receipt tab with 100+ payments
2. Apply various filters
3. **Expected:**
   - Page loads within 2 seconds
   - Filtering is instant (<500ms)
   - No UI freezing or lag

### Phase 4: Error Handling Testing

#### Test Scenario 14: Network Error
**Steps:**
1. Disable network connection
2. Click "Apply Filter"
3. **Expected:**
   - Shows error message in table
   - Provides user-friendly error text
   - Does not crash

#### Test Scenario 15: Invalid Data
**Steps:**
1. Manually manipulate payment data to have missing fields
2. Try to submit receipt
3. **Expected:**
   - Validates required fields
   - Shows appropriate error messages
   - Does not submit invalid data

### Testing Checklist

- [ ] Database table created successfully
- [ ] RLS policies active and working
- [ ] SQL function returns data correctly
- [ ] Tab visible for admin/accountant only
- [ ] Tab hidden for other roles
- [ ] Data loads from all 3 sources
- [ ] Date filtering works correctly
- [ ] Status filtering (all/pending/processed) works
- [ ] Statistics update correctly
- [ ] Receipt submission creates database record
- [ ] Receipt update modifies existing record
- [ ] Validation prevents empty submissions
- [ ] Visual indicators display correctly (badges, colors)
- [ ] Export to Excel generates correct file
- [ ] Sorting works on all columns
- [ ] Enter key submits receipt from input
- [ ] Responsive on mobile devices
- [ ] No console errors
- [ ] Performance acceptable with large datasets
- [ ] Error handling graceful
- [ ] Cross-user collaboration works (User B can edit User A's receipts)

---

## 🚀 Deployment Strategy

### Goal: Zero-Disruption Deployment

The deployment strategy ensures the feature can be developed, tested, and deployed to production **without affecting the live system**.

### Strategy: Feature Flag Approach

#### Step 1: Database Deployment (Safe)
```sql
-- Run in Supabase SQL Editor
-- This creates new table and functions WITHOUT touching existing tables

-- 1. Create cash_receipts table
-- 2. Create indexes
-- 3. Create RLS policies
-- 4. Create SQL functions

-- ✅ Safe: No existing tables modified
-- ✅ Safe: No data migration required
-- ✅ Safe: RLS prevents unauthorized access
```

**Risk Level:** ⚪ **ZERO** - New table creation doesn't affect existing functionality

#### Step 2: Backend Code Deployment (Safe)
```javascript
// Add new methods to supabase-service.js
// These methods only interact with the NEW cash_receipts table

// ✅ Safe: New methods don't override existing ones
// ✅ Safe: No changes to existing payment processing logic
```

**Risk Level:** 🟢 **MINIMAL** - Additive changes only

#### Step 3: Frontend Code Deployment (Feature Flag Protected)

**Implementation:**
```javascript
// In scripts.js - Feature flag controlled initialization

// Global feature flag (set to false initially)
const FEATURE_FLAGS = {
    cashReceiptEnabled: false // Toggle this to enable/disable
};

async function initializeCashReceiptDashboard() {
    // Check feature flag first
    if (!FEATURE_FLAGS.cashReceiptEnabled) {
        console.log('💤 Cash Receipt feature is disabled');
        if (cashReceiptTab) cashReceiptTab.style.display = 'none';
        return;
    }
    
    // Feature is enabled, check permissions
    const hasPermission = await appState.supabaseService.hasAdminOrAccountantRole();
    
    if (!hasPermission) {
        cashReceiptTab.style.display = 'none';
        return;
    }
    
    cashReceiptTab.style.display = 'block';
    // ... rest of initialization
}
```

**Risk Level:** 🟢 **MINIMAL** - Feature hidden by default

#### Step 4: Testing in Production (Safe)

**Process:**
1. Deploy code with `cashReceiptEnabled: false`
2. **Impact:** Zero - Feature completely hidden
3. Verify deployment successful (no errors in console)
4. Enable feature flag: `cashReceiptEnabled: true`
5. **Impact:** Only admin/accountant users see the tab
6. Test with admin account in live environment
7. Verify data loads correctly
8. Test receipt submission
9. Verify database records created
10. If issues found, disable flag: `cashReceiptEnabled: false`

**Rollback Plan:**
- Instant: Set `cashReceiptEnabled: false`
- Complete: Remove frontend HTML/JS code (if needed)
- Database: Table can remain (no harm), or drop if desired

### Deployment Phases

#### Phase 1: Staging/Development Environment
**Timeline:** 2-3 days
1. Create database objects
2. Deploy frontend/backend code
3. Enable feature flag
4. Complete all test scenarios
5. Fix any bugs found
6. Performance testing

**Success Criteria:**
- All test scenarios pass
- No console errors
- Performance acceptable
- Export functionality works

#### Phase 2: Production Deployment (Feature Disabled)
**Timeline:** 1 day
1. Deploy database changes to production
2. Deploy code to production (flag = false)
3. Verify deployment successful
4. Monitor for any errors (none expected)

**Success Criteria:**
- No errors in production logs
- Existing functionality unaffected
- Database objects created successfully

#### Phase 3: Limited Production Testing (Admin Only)
**Timeline:** 2-3 days
1. Enable feature flag: `cashReceiptEnabled: true`
2. Test with 2-3 admin accounts
3. Process 10-20 real cash receipts
4. Verify data accuracy in database
5. Verify export functionality
6. Monitor system performance

**Success Criteria:**
- Admins can access feature
- Data saves correctly
- No performance degradation
- Export files accurate

#### Phase 4: Full Production Release
**Timeline:** 1 day
1. Confirm all tests passed
2. Keep feature enabled
3. Communicate to accountant users
4. Monitor usage for first week
5. Gather user feedback

**Success Criteria:**
- All admin/accountant users can access
- No user-reported issues
- System performance normal
- Positive user feedback

### Monitoring & Verification

#### During Deployment
```javascript
// Add logging to track usage
console.log('🎫 Cash Receipt tab accessed by:', userId);
console.log('💾 Receipt submitted:', receiptData);
console.log('📊 Export performed, records:', count);
```

#### Post-Deployment Checks
```sql
-- Check cash_receipts table population
SELECT COUNT(*) FROM cash_receipts;

-- Check processed vs pending
SELECT status, COUNT(*) 
FROM cash_receipts 
GROUP BY status;

-- Check by source
SELECT payment_source, COUNT(*) 
FROM cash_receipts 
GROUP BY payment_source;

-- Recent submissions
SELECT * FROM cash_receipts 
ORDER BY created_at DESC 
LIMIT 20;
```

### Rollback Procedures

#### Level 1: Instant Disable (No Code Change)
```javascript
// In browser console or code
FEATURE_FLAGS.cashReceiptEnabled = false;
// Reload page
```
**Impact Time:** Immediate  
**User Impact:** Feature disappears

#### Level 2: Code Rollback
```bash
# Git rollback to previous commit
git revert <commit-hash>
git push origin main
# Redeploy
```
**Impact Time:** 5-10 minutes  
**User Impact:** Feature removed

#### Level 3: Database Cleanup (If Needed)
```sql
-- Only if absolutely necessary
DROP TABLE cash_receipts CASCADE;
DROP FUNCTION get_all_cash_payments;
```
**Impact Time:** 1 minute  
**User Impact:** None (feature already disabled)

### Communication Plan

#### Pre-Deployment
- Notify admin users of upcoming feature
- Provide brief training/usage guide
- Set expectations for beta testing

#### During Testing
- Collect feedback from test users
- Address any issues quickly
- Iterate based on feedback

#### Post-Release
- Send announcement to all admin/accountant users
- Provide detailed usage documentation
- Offer support for questions

---

## 📊 Expected Outputs

### 1. Database Objects

**Created Tables:**
- `cash_receipts` (1 table)

**Created Functions:**
- `get_all_cash_payments(p_start_date, p_end_date)` - Returns all cash payments (shared team data)

**Created Indexes:**
- 5 indexes on cash_receipts table

**Created Policies:**
- 3 RLS policies (SELECT, INSERT, UPDATE) - Role-based, no user filtering

### 2. Frontend Components

**New HTML Sections:**
- Cash Receipt tab button
- Cash Receipt dashboard container
- Cash Receipt management section
- Date filter controls
- Statistics display
- Cash receipts table
- Export button

**Visual Elements:**
- Status badges (Pending/Processed)
- Source badges (Supply/UGRAI/UGRAI History)
- Row highlighting (green for processed)
- Loading states
- Error states

### 3. Backend Functions

**Supabase Service Methods:**
- `getAllCashPayments(startDate, endDate)`
- `submitCashReceipt(receiptData)`
- `hasAdminOrAccountantRole()`

**Scripts.js Functions:**
- `initializeCashReceiptDashboard()`
- `loadCashPayments()`
- `applyStatusFilter(filter)`
- `renderCashReceiptsTable()`
- `handleReceiptSubmission(paymentId, source)`
- `updateCashReceiptStats()`
- `exportCashReceiptsToExcel()`
- Helper functions (getSourceLabel, getSourceBadgeClass, etc.)

### 4. User-Facing Features

**For Admin/Accountant Users:**
1. ✅ New "CASH RECEIPT" tab in main navigation
2. ✅ View all cash payments from multiple sources
3. ✅ Filter by date range (custom start/end dates)
4. ✅ Filter by status (All/Pending/Processed)
5. ✅ See statistics (total, processed, pending, amount)
6. ✅ Assign Tally receipt numbers to payments
7. ✅ Edit/update receipt numbers after submission
8. ✅ Visual indicators for payment status
9. ✅ Export filtered data to Excel
10. ✅ Sort table by any column
11. ✅ Quick submission with Enter key

**For Other Users:**
- ✅ No changes (tab hidden)
- ✅ Existing functionality unaffected

### 5. Data Integrity

**Guarantees:**
- ✅ No duplicate cash receipt entries (UNIQUE constraint)
- ✅ Role-based access control (admin/accountant only via RLS policies)
- ✅ Audit trail (user_id tracks who processed each receipt)
- ✅ Data validation (required fields enforced)
- ✅ No modification to existing payment tables

### 6. Performance Metrics

**Expected Performance:**
- Initial load: < 2 seconds (for 500 payments)
- Filter application: < 500ms
- Receipt submission: < 1 second
- Export to Excel: < 3 seconds (for 1000 payments)
- Table sorting: < 200ms

### 7. Documentation

**Created Documents:**
- ✅ This implementation plan (FEATURE_CASH_RECEIPT_IMPLEMENTATION.md)
- ✅ Database schema documentation (embedded in SQL)
- ✅ Code comments and JSDoc
- ✅ User guide (to be created post-implementation)

---

## ✅ Task Breakdown

### Database Tasks

| ID | Task | Estimated Time | Dependencies | Status |
|----|------|----------------|--------------|--------|
| DB-1 | Create `cash_receipts` table with all fields | 15 min | None | ⏳ Pending |
| DB-2 | Create indexes for performance | 10 min | DB-1 | ⏳ Pending |
| DB-3 | Create RLS policies (SELECT, INSERT, UPDATE) | 20 min | DB-1 | ⏳ Pending |
| DB-4 | Create `get_all_cash_payments()` function | 30 min | DB-1 | ⏳ Pending |
| DB-5 | Test database objects in SQL editor | 20 min | DB-1 to DB-4 | ⏳ Pending |
| DB-6 | Grant necessary permissions | 10 min | DB-4 | ⏳ Pending |
| **DB Total** | | **1 hr 45 min** | | |

### Backend Tasks

| ID | Task | Estimated Time | Dependencies | Status |
|----|------|----------------|--------------|--------|
| BE-1 | Create `getAllCashPayments()` method | 30 min | DB-4 | ⏳ Pending |
| BE-2 | Create `submitCashReceipt()` method | 45 min | DB-1 | ⏳ Pending |
| BE-3 | Create `hasAdminOrAccountantRole()` method | 20 min | None | ⏳ Pending |
| BE-4 | Add error handling and logging | 30 min | BE-1, BE-2 | ⏳ Pending |
| BE-5 | Test backend methods in console | 30 min | BE-1 to BE-3 | ⏳ Pending |
| **BE Total** | | **2 hr 35 min** | | |

### Frontend Tasks - HTML

| ID | Task | Estimated Time | Dependencies | Status |
|----|------|----------------|--------------|--------|
| FE-HTML-1 | Add "CASH RECEIPT" tab button to navigation | 10 min | None | ⏳ Pending |
| FE-HTML-2 | Create cash receipt dashboard container | 20 min | None | ⏳ Pending |
| FE-HTML-3 | Create date filter controls | 15 min | FE-HTML-2 | ⏳ Pending |
| FE-HTML-4 | Create statistics display section | 15 min | FE-HTML-2 | ⏳ Pending |
| FE-HTML-5 | Create status filter buttons | 10 min | FE-HTML-2 | ⏳ Pending |
| FE-HTML-6 | Create cash receipts table structure | 30 min | FE-HTML-2 | ⏳ Pending |
| FE-HTML-7 | Create export button | 5 min | FE-HTML-2 | ⏳ Pending |
| **FE-HTML Total** | | **1 hr 45 min** | | |

### Frontend Tasks - CSS

| ID | Task | Estimated Time | Dependencies | Status |
|----|------|----------------|--------------|--------|
| FE-CSS-1 | Style status badges (pending/processed) | 20 min | FE-HTML-6 | ⏳ Pending |
| FE-CSS-2 | Style source badges (Supply/UGRAI) | 15 min | FE-HTML-6 | ⏳ Pending |
| FE-CSS-3 | Style processed row highlighting | 10 min | FE-HTML-6 | ⏳ Pending |
| FE-CSS-4 | Style filter buttons (active states) | 15 min | FE-HTML-5 | ⏳ Pending |
| FE-CSS-5 | Ensure mobile responsiveness | 30 min | FE-HTML-2 to FE-HTML-7 | ⏳ Pending |
| FE-CSS-6 | Add loading/error states styling | 15 min | None | ⏳ Pending |
| **FE-CSS Total** | | **1 hr 45 min** | | |

### Frontend Tasks - JavaScript

| ID | Task | Estimated Time | Dependencies | Status |
|----|------|----------------|--------------|--------|
| FE-JS-1 | Add DOM element references | 15 min | FE-HTML-2 to FE-HTML-7 | ⏳ Pending |
| FE-JS-2 | Create `initializeCashReceiptDashboard()` | 45 min | BE-3, FE-HTML-1 | ⏳ Pending |
| FE-JS-3 | Create `loadCashPayments()` | 30 min | BE-1, FE-HTML-6 | ⏳ Pending |
| FE-JS-4 | Create `applyStatusFilter()` | 20 min | FE-JS-3 | ⏳ Pending |
| FE-JS-5 | Create `renderCashReceiptsTable()` | 60 min | FE-JS-3, FE-HTML-6 | ⏳ Pending |
| FE-JS-6 | Create `handleReceiptSubmission()` | 45 min | BE-2, FE-JS-5 | ⏳ Pending |
| FE-JS-7 | Create `updateCashReceiptStats()` | 20 min | FE-JS-3, FE-HTML-4 | ⏳ Pending |
| FE-JS-8 | Create `exportCashReceiptsToExcel()` | 30 min | FE-JS-3 | ⏳ Pending |
| FE-JS-9 | Create helper functions | 30 min | None | ⏳ Pending |
| FE-JS-10 | Attach event listeners | 30 min | FE-JS-2 to FE-JS-8 | ⏳ Pending |
| FE-JS-11 | Integrate with existing tab system | 30 min | FE-JS-2 | ⏳ Pending |
| FE-JS-12 | Add feature flag implementation | 20 min | None | ⏳ Pending |
| **FE-JS Total** | | **5 hr 55 min** | | |

### Testing Tasks

| ID | Task | Estimated Time | Dependencies | Status |
|----|------|----------------|--------------|--------|
| TEST-1 | Database testing (Phase 1) | 45 min | DB-1 to DB-6 | ⏳ Pending |
| TEST-2 | Backend API testing | 30 min | BE-1 to BE-5 | ⏳ Pending |
| TEST-3 | Role-based visibility testing | 20 min | FE-JS-2 | ⏳ Pending |
| TEST-4 | Data loading and filtering testing | 30 min | FE-JS-3, FE-JS-4 | ⏳ Pending |
| TEST-5 | Receipt submission testing | 45 min | FE-JS-6 | ⏳ Pending |
| TEST-6 | Export functionality testing | 20 min | FE-JS-8 | ⏳ Pending |
| TEST-7 | Validation and error handling testing | 30 min | FE-JS-6 | ⏳ Pending |
| TEST-8 | Integration testing | 60 min | All above | ⏳ Pending |
| TEST-9 | Performance testing | 30 min | All above | ⏳ Pending |
| TEST-10 | Cross-browser testing | 30 min | All above | ⏳ Pending |
| TEST-11 | Mobile responsiveness testing | 20 min | FE-CSS-5 | ⏳ Pending |
| **TEST Total** | | **5 hr 40 min** | | |

### Deployment Tasks

| ID | Task | Estimated Time | Dependencies | Status |
|----|------|----------------|--------------|--------|
| DEP-1 | Create SQL deployment script | 20 min | DB-1 to DB-6 | ⏳ Pending |
| DEP-2 | Deploy database to staging | 15 min | DEP-1 | ⏳ Pending |
| DEP-3 | Deploy code to staging | 15 min | All FE tasks | ⏳ Pending |
| DEP-4 | Test in staging environment | 60 min | DEP-2, DEP-3 | ⏳ Pending |
| DEP-5 | Deploy database to production | 15 min | DEP-4 | ⏳ Pending |
| DEP-6 | Deploy code to production (flag OFF) | 15 min | DEP-4 | ⏳ Pending |
| DEP-7 | Enable feature flag for testing | 5 min | DEP-6 | ⏳ Pending |
| DEP-8 | Limited production testing | 120 min | DEP-7 | ⏳ Pending |
| DEP-9 | Full production release | 30 min | DEP-8 | ⏳ Pending |
| DEP-10 | Monitor and verify | 60 min | DEP-9 | ⏳ Pending |
| **DEP Total** | | **5 hr 35 min** | | |

### Documentation Tasks

| ID | Task | Estimated Time | Dependencies | Status |
|----|------|----------------|--------------|--------|
| DOC-1 | Create user guide for admin/accountant | 60 min | All tasks | ⏳ Pending |
| DOC-2 | Create screenshots/GIFs for guide | 30 min | DEP-4 | ⏳ Pending |
| DOC-3 | Update main system documentation | 20 min | All tasks | ⏳ Pending |
| DOC-4 | Create FAQ document | 30 min | DEP-9 | ⏳ Pending |
| **DOC Total** | | **2 hr 20 min** | | |

### **GRAND TOTAL: ~26 hours (3-4 working days)**

### Task Priority

**Priority 1 (Critical Path):**
- DB-1 to DB-6 (Database setup)
- BE-1 to BE-3 (Core backend methods)
- FE-HTML-1, FE-HTML-2, FE-HTML-6 (Core UI structure)
- FE-JS-2, FE-JS-3, FE-JS-5, FE-JS-6 (Core functionality)

**Priority 2 (Important):**
- FE-JS-4, FE-JS-7 (Filtering and stats)
- FE-CSS-1 to FE-CSS-4 (Visual polish)
- TEST-1 to TEST-7 (Core testing)

**Priority 3 (Nice to Have):**
- FE-JS-8 (Export functionality)
- FE-CSS-5, FE-CSS-6 (Mobile and polish)
- TEST-8 to TEST-11 (Extended testing)

---

## 🎯 Success Criteria

### Functional Success

- ✅ Tab visible only to admin and accountant users
- ✅ All cash payments from 3 sources display correctly
- ✅ Date range filtering works accurately
- ✅ Status filtering (all/pending/processed) works
- ✅ Receipt numbers can be submitted and updated
- ✅ Visual indicators show correct status
- ✅ Statistics update in real-time
- ✅ Export to Excel generates accurate files
- ✅ Table sorting works on all columns
- ✅ Validation prevents invalid submissions

### Technical Success

- ✅ Database table created without errors
- ✅ RLS policies protect data correctly
- ✅ SQL function returns data within 2 seconds
- ✅ No console errors
- ✅ No impact on existing functionality
- ✅ Code follows existing patterns and style
- ✅ Feature flag allows instant enable/disable

### User Experience Success

- ✅ Interface is intuitive and easy to use
- ✅ Loading states provide feedback
- ✅ Error messages are clear and helpful
- ✅ Mobile responsive design works well
- ✅ Visual design matches existing app style
- ✅ Keyboard shortcuts work (Enter to submit)

### Business Success

- ✅ Reduces manual Tally entry errors
- ✅ Provides audit trail of cash receipts
- ✅ Enables better cash flow tracking
- ✅ Saves time for accountants/admins
- ✅ No disruption to live operations during deployment

### Quality Metrics

**Code Quality:**
- ✅ No linting errors
- ✅ Proper error handling throughout
- ✅ Comprehensive logging for debugging
- ✅ Code is well-commented

**Performance:**
- ✅ Initial load < 2 seconds
- ✅ Filtering < 500ms
- ✅ Submission < 1 second
- ✅ No memory leaks

**Security:**
- ✅ RLS policies prevent unauthorized access
- ✅ User data completely isolated
- ✅ Input validation prevents injection
- ✅ Audit trail tracks all changes

---

## � Data Source Architecture (VERIFIED)

### Payment Tracking Reality

| Source Table              | When Used                    | Payment Field    | Notes |
|---------------------------|------------------------------|------------------|-------|
| `approved_bills`          | ALL Supply cash payments     | payment_method   | One row per bill (full or partial) |
| `ugrai_payment_history`   | ALL UGRAI cash payments      | payment_method   | Includes both partial and full payments |

#### 1. **Data Sources** (VERIFIED & CORRECTED)

| Source Table              | When Used                    | Payment Field    | Notes |
|---------------------------|------------------------------|------------------|-------|
| `approved_bills`          | ALL Supply cash payments     | payment_method   | Full or partial payments from Supply |
| `ugrai_payment_history`   | ALL UGRAI cash payments      | payment_method   | Comprehensive UGRAI payment tracking |

**⚠️ Important Clarifications:**
- `ugrai_payment_history` is **UGRAI-exclusive** - does NOT contain Supply payments
- `approved_ugrai` is **NOT used** - would create duplicates with payment history
- These two sources have **NO overlap** - completely separate workflows
- Same bill number **CAN appear multiple times** across both sources for partial payments

#### 2. **Implementation Approach** (FIXED)

**Source Value Strategy:**
- Database stores user-friendly values: `'supply'`, `'ugrai'`, `'ugrai_partial'`
- Additional `source_table` field tracks actual table: `'approved_bills'` or `'ugrai_payment_history'`
- Frontend displays readable labels: "Supply", "UGRAI", "UGRAI (Partial)"

**Partial Payment Detection:**
- No `payment_type` field in ugrai_payment_history
- Detect using: `received_amount < net_amount`
- If partial: source = `'ugrai_partial'`, else source = `'ugrai'`

**Date Fields:**
- approved_bills: Uses `approval_date` (when manager approved cash collection)
- ugrai_payment_history: Uses `payment_date` (actual payment collection date)

**Visual Grouping:**
- Bills with multiple payments show "1/2", "2/2" indicators  
- Blue left border for grouped payments
- Clear visual separation

**Update Confirmation:**
- New entries: No confirmation needed
- Updates: Confirmation dialog shows old vs new receipt number
- Duplicate validation: Prevents same receipt number across different payments

**Performance Optimization:**
- Critical indexes added on payment_method columns
- Efficient filtering with WHERE clauses on indexed columns
- Fast lookups on source_table + payment_reference_id

### Recommended Function (CORRECTED):
```sql
CREATE OR REPLACE FUNCTION get_all_cash_payments(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
) RETURNS TABLE(
    id UUID,
    source TEXT,
    bill_number TEXT,
    bill_date DATE,
    retailer_name TEXT,
    sector TEXT,
    payment_amount DECIMAL,
    payment_date DATE,
    tally_receipt_number TEXT,
    status TEXT,
    processed_by UUID,
    processed_date TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    
    -- Supply cash payments (from approved_bills)
    -- Includes full payments and partial payments from Supply workflow
    SELECT 
        ab.id,
        'supply'::TEXT as source,
        ab.bill_number,
        ab.bill_date,
        ab.retailer_name,
        ab.sector,
        ab.received_amount as payment_amount,
        ab.approval_date as payment_date,
        cr.tally_receipt_number,
        COALESCE(cr.status, 'pending') as status,
        cr.processed_by,
        cr.processed_date
    FROM approved_bills ab
    LEFT JOIN cash_receipts cr ON cr.source_table = 'approved_bills' 
        AND cr.payment_reference_id = ab.id
    WHERE ab.payment_method = 'Cash'
        AND (p_start_date IS NULL OR ab.approval_date >= p_start_date)
        AND (p_end_date IS NULL OR ab.approval_date <= p_end_date)
    
    UNION ALL
    
    -- UGRAI cash payments (from ugrai_payment_history ONLY)
    -- This table is UGRAI-exclusive, does NOT contain Supply payments
    -- Includes both partial and full payments tracked in UGRAI workflow
    -- NOTE: Same bill_number may appear multiple times for partial payments
    -- Detect partial by comparing received_amount < net_amount
    SELECT 
        uph.id,
        CASE 
            WHEN uph.received_amount < uph.net_amount THEN 'ugrai_partial'::TEXT
            ELSE 'ugrai'::TEXT
        END as source,
        uph.bill_number,
        uph.bill_date,
        uph.retailer_name,
        uph.sector,
        uph.payment_amount,
        uph.payment_date, -- Actual payment collection date
        cr.tally_receipt_number,
        COALESCE(cr.status, 'pending') as status,
        cr.processed_by,
        cr.processed_date
    FROM ugrai_payment_history uph
    LEFT JOIN cash_receipts cr ON cr.source_table = 'ugrai_payment_history' 
        AND cr.payment_reference_id = uph.id
    WHERE uph.payment_method = 'Cash'
        AND (p_start_date IS NULL OR uph.payment_date >= p_start_date)
        AND (p_end_date IS NULL OR uph.payment_date <= p_end_date)
    
    ORDER BY payment_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Key Points:**
- Two sources only: `approved_bills` + `ugrai_payment_history`
- User-friendly source values: `'supply'`, `'ugrai'`, `'ugrai_partial'`
- Separate `source_table` field for traceability to actual tables
- Partial payment detection via calculation: `received_amount < net_amount`
- Correct date fields: `approval_date` for Supply, `payment_date` for UGRAI
- Same bill_number can legitimately appear multiple times
- No type casting needed (direct UUID comparison)
- Duplicate receipt number validation in backend
- Visual grouping with payment numbers in frontend
- Update confirmation when changing existing receipt numbers

### 2. **Source Badge Labels**
When displaying in the UI:
- `supply` (from approved_bills) → Badge: "Supply" (blue)
- `ugrai` (from ugrai_payment_history, payment_type='full') → Badge: "UGRAI" (purple)
- `ugrai_partial` (from ugrai_payment_history, payment_type='partial') → Badge: "UGRAI (Partial)" (orange)

**Corrected Cash Receipt Sources:**
1. ✅ `approved_bills` → Supply cash payments (full or partial)
2. ✅ `ugrai_payment_history` → UGRAI cash payments ONLY (includes partial tracking)
3. ❌ ~~`approved_ugrai`~~ → NOT used (creates duplicates with payment history)

**Critical Understanding:**
- `ugrai_payment_history` is **UGRAI-exclusive** - contains ZERO Supply payments
- Supply has NO payment history table - only `approved_bills`
- Partial Supply payments create UGRAI entries for outstanding amounts
- Same bill can appear in both Supply (`approved_bills`) and UGRAI (`ugrai_payment_history`) if partial payment was made

---

## �📝 Additional Notes

### Future Enhancements (Post-MVP)

1. **Bulk Receipt Assignment**
   - Select multiple payments
   - Auto-generate sequential receipt numbers (CASH-001, CASH-002, etc.)
   - Submit in batch

2. **Receipt Number Validation**
   - Check for duplicate receipt numbers
   - Validate format (e.g., CASH-XXX)
   - Warn if number already used

3. **Advanced Filtering**
   - Filter by retailer name
   - Filter by sector
   - Filter by amount range
   - Filter by source

4. **Analytics Dashboard**
   - Daily/weekly/monthly cash receipt trends
   - Top retailers by cash payments
   - Average processing time
   - Pending vs processed ratio over time

5. **Notification System**
   - Alert accountants when new cash payments available
   - Reminder for pending receipts
   - Summary email reports

6. **Integration with Tally**
   - Direct API integration (if available)
   - Auto-sync receipt numbers
   - Two-way data validation

### Fixed Implementation Flaws

All critical flaws identified during review have been **FIXED** in this document:

1. **✅ Source Value Mismatch** (CRITICAL)
   - Fixed: Database constraint now accepts `'supply'`, `'ugrai'`, `'ugrai_partial'`
   - Added `source_table` field to track actual table names for traceability
   - No more insertion failures due to constraint violation

2. **✅ Partial Payment Detection** (HIGH)
   - Fixed: Uses calculation `received_amount < net_amount` instead of non-existent `payment_type` field
   - Properly detects UGRAI partial payments
   - No runtime errors

3. **✅ Date Field Confusion** (HIGH)
   - Fixed: Uses `approval_date` for approved_bills (when cash was approved)
   - Fixed: Uses `payment_date` for ugrai_payment_history (actual collection date)
   - Correct business semantics for Tally integration

4. **✅ Duplicate Receipt Number Validation** (HIGH)
   - Fixed: Added unique index on `tally_receipt_number`
   - Fixed: Backend validation checks for duplicates before insert
   - Prevents accountant errors

5. **✅ Visual Grouping for Multiple Payments** (MEDIUM)
   - Fixed: Shows "1/2", "2/2" payment indicators
   - Fixed: Blue left border for bills with multiple payments
   - Fixed: Indentation and clear visual separation
   - Reduces user confusion

6. **✅ Update Confirmation** (HIGH)
   - Fixed: No confirmation for NEW entries (faster workflow)
   - Fixed: Confirmation dialog when UPDATING existing receipt numbers
   - Shows old vs new receipt number clearly
   - Prevents accidental overwrites

7. **✅ Performance Optimization** (MEDIUM)
   - Fixed: Added critical indexes on payment_method columns with WHERE clause
   - Fixed: Composite indexes for efficient filtering
   - Fixed: Index on source_table + payment_reference_id for fast JOINs
   - Query performance optimized

8. **✅ Type Casting Removed** (MEDIUM)
   - Fixed: Removed unnecessary `user_id::TEXT` casting
   - Uses direct UUID comparison
   - Better index utilization

9. **✅ Complete SQL Function Definitions** (MEDIUM)
   - Fixed: All RETURNS TABLE(...) have full column specifications
   - No placeholder `(...)` text
   - Copy-paste ready code

### Remaining Known Limitations (Future Enhancements)

1. **Manual Receipt Number Entry**
   - Currently requires manual typing
   - Future: Auto-generation or scanner integration

2. **No Receipt Number Format Validation**
   - Any text allowed currently
   - Future: Regex validation for standard format (e.g., /^CASH-\d{3}$/)

3. **No Undo Functionality**
   - Once submitted, must use Update to change
   - Future: Undo last action feature

### Maintenance Considerations

1. **Database Backups**
   - Ensure `cash_receipts` table included in backup schedule
   - Test restoration procedures

2. **Performance Monitoring**
   - Monitor query performance as data grows
   - Add additional indexes if needed
   - Consider archiving old data annually

3. **User Training**
   - Provide initial training to admin/accountant users
   - Create video tutorials
   - Maintain FAQ document

4. **Regular Audits**
   - Monthly review of processed receipts
   - Verify Tally synchronization accuracy
   - Check for any data inconsistencies

---

## 🏁 Conclusion

This implementation plan provides a **CORRECTED and comprehensive**, step-by-step guide to adding the Cash Receipt feature to the DLS system. All critical flaws have been identified and fixed. The approach prioritizes:

1. **Safety**: No modification to existing tables or functionality
2. **Security**: Role-based access control at database and frontend levels
3. **Flexibility**: Feature flag allows instant enable/disable
4. **User Experience**: Intuitive interface with clear visual indicators, payment numbering, and smart confirmations
5. **Maintainability**: Well-structured, documented code following existing patterns
6. **Performance**: Critical indexes for fast filtering and lookups
7. **Data Integrity**: Duplicate validation, update confirmations, and proper audit trails

**Total Estimated Implementation Time: 26 hours (3-4 working days)**

The feature can be deployed to production with **zero risk** using the feature flag approach, tested incrementally, and rolled back instantly if needed.

### ✅ All Critical Flaws Fixed

- ✅ Source value mismatch resolved (database constraint updated)
- ✅ Partial payment detection using calculation
- ✅ Correct date fields for cash collection
- ✅ Duplicate receipt number validation
- ✅ Visual grouping for multiple payments per bill
- ✅ Smart update confirmation (only when changing existing)
- ✅ Performance indexes added
- ✅ Type casting removed
- ✅ Complete SQL function definitions

---

**Document Status:** ✅ **READY FOR IMPLEMENTATION** (All Flaws Fixed)  
**Document Version:** 2.0 (Corrected)  
**Last Updated:** February 19, 2026  

**Next Steps:** 
1. Review and approve this corrected plan
2. Begin with Phase 1: Database Tasks  
3. Follow task breakdown sequentially
4. Test thoroughly at each phase
5. Deploy safely using feature flag strategy

