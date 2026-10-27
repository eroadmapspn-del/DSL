# PURCHASE SECTION - Complete Data Flow Guide

## Overview
The Purchase section manages the complete procurement lifecycle from retailer onboarding through payment completion. It handles purchase base file management, entry creation, accounting processes, payment tracking, and comprehensive purchase management with due date calculations.

## Data Structures & Storage

### Primary Data Arrays
- `purchaseRetailers`: Master retailer database with due days
- `purchaseEntries`: All purchase transactions across all statuses
- `purchaseManagement`: Due date calculations and payment tracking

### Core Data Models
```javascript
// Purchase Retailer Object
{
    id: "unique_id",
    retailerName: "string",
    dueDays: number  // Payment due days from bill date
}

// Purchase Entry Object
{
    id: "unique_id",
    uniqueId: "PUR-{timestamp}-{random}",
    billNumber: "string",
    billDate: "YYYY-MM-DD",
    retailerName: "string",
    taxableAmount: number,
    totalTax: number,
    deduction: number,
    netAmount: number,  // taxableAmount + totalTax - deduction
    deductionType: "Display|Salary|Credit Note|Scheme|General Adjustment",
    creditNoteNumber: "string",
    creditNoteDate: "YYYY-MM-DD", 
    status: "Received|Edit|Confirmed|Completed|Paid",
    note: "string",
    dueDate: "YYYY-MM-DD",  // calculated: billDate + retailer.dueDays
    chequeNumber: "string",
    chequeDate: "YYYY-MM-DD",
    createdAt: "ISO_timestamp",
    confirmedAt: "ISO_timestamp",
    completedAt: "ISO_timestamp",
    paidAt: "ISO_timestamp"
}
```

## Complete Data Flow

### Phase 1: Purchase Base File Management

#### Retailer Database Setup

##### Input Sources
1. **Manual Addition** → Individual retailer entry (future enhancement)
2. **Excel Upload** → Bulk retailer import with due days

##### Expected Excel Format
```javascript
// Required columns (case-insensitive)
const PURCHASE_BASE_COLUMNS = {
    retailerName: 'retailer name',
    dueDays: 'due days'
};
```

##### Processing Steps
1. **File Validation** → Check .xlsx/.xls format
2. **Column Detection** → Find exact header matches
3. **Data Extraction** → Parse retailer name and due days
4. **Validation** → Ensure due days are numeric
5. **Storage** → Replace existing `purchaseRetailers` array
6. **UI Update** → Refresh retailer dropdown and display table

#### Retailer Management Features
- **Download** → Export current retailer list as CSV
- **View Toggle** → Show/hide retailer data table
- **Search Filter** → Real-time retailer name filtering
- **Due Days Display** → Show payment terms for each retailer

### Phase 2: Purchase Entry Creation

#### Entry Form Interface
**Modal-based Entry System** with the following fields:

##### Required Fields
- **Bill Number** → Unique identifier
- **Bill Date** → Date picker
- **Retailer Name** → Dropdown (from purchaseRetailers)
- **PreTax Amount** → Taxable amount
- **Tax** → Tax amount  
- **Net Amount** → Auto-calculated (PreTax + Tax - Deduction)
- **Status** → Received/Edit

##### Optional Fields
- **Deduction Type** → Dropdown selection
- **Deduction Amount** → Defaults to 0
- **Credit Note Number** → For credit note tracking
- **Credit Note Date** → Date picker
- **Note** → Required if status is "Edit"

##### Auto-Calculation Logic
```javascript
// Net amount calculation
netAmount = taxableAmount + totalTax - deduction;

// Unique ID generation
uniqueId = `PUR-${timestamp}-${randomNumber}`;
```

#### Entry Validation Rules
```javascript
// Required field validation
const requiredFields = [
    'billNumber', 'billDate', 'retailerName',
    'taxableAmount', 'totalTax', 'netAmount', 'status'
];

// Conditional validation
if (status === 'Edit') {
    note.required = true;
}

// Business logic validation
if (deduction > (taxableAmount + totalTax)) {
    error: "Deduction cannot exceed gross amount";
}
```

#### Entry Status Management  
- **Received** → Standard purchase entry
- **Edit** → Requires note, special handling needed

### Phase 3: Purchase Entry Management

#### Entry Display & Actions
**Data Source:** All `purchaseEntries` with status NOT in ['Confirmed', 'Completed', 'Paid']

**Available Actions:**
1. **Edit** → Reopen entry modal with existing data
2. **Confirm** → Move entry to "Confirmed" status

**Edit Functionality:**
```javascript
// Edit mode detection
const isUpdate = submitButton.textContent === 'Update';

// Form pre-population
function editPurchaseEntry(entryId) {
    1. Find entry in purchaseEntries array
    2. Populate all form fields with existing data
    3. Change submit button text to "Update"
    4. Show conditional fields based on status
    5. Enable form validation
}
```

#### Confirmation Process
```javascript
// Confirmation workflow
function confirmPurchaseEntry(entryId) {
    1. Show SweetAlert confirmation dialog
    2. Update entry status to "Confirmed" 
    3. Set confirmedAt timestamp
    4. Move to "Purchase Received" section
    5. Update UI and refresh tables
}
```

### Phase 4: Purchase Received (Accounting)

#### Data Source
Purchase entries with status "Confirmed"

#### Accounting Process
**Purpose:** Mark entries as ready for accounting/bookkeeping

**Table Display:**
- All confirmed purchase details
- **Action:** "A/c Entry Done" button per entry

**Accounting Completion:**
```javascript
function completeAccountEntryProcess(entryId) {
    1. Show confirmation dialog
    2. Update status from "Confirmed" to "Completed"
    3. Set completedAt timestamp  
    4. Calculate due date: billDate + retailer.dueDays
    5. Move to "Purchase Management" section
    6. Update UI displays
}
```

### Phase 5: Purchase Management

#### Data Source & Display
**Entries Shown:** Status = "Completed" OR "Confirmed"
- **Confirmed entries:** Show accounting pending icon (⏳)
- **Completed entries:** Show accounting done icon (✓), enable payment fields

#### Due Date Management System

##### Due Date Calculation
```javascript
// Automatic due date calculation
const billDate = new Date(entry.billDate);
const retailer = purchaseRetailers.find(r => r.retailerName === entry.retailerName);
const dueDays = retailer ? retailer.dueDays : 30; // Default 30 days
const dueDate = new Date(billDate);
dueDate.setDate(billDate.getDate() + dueDays);
entry.dueDate = dueDate.toISOString().split('T')[0];
```

##### Summary Cards System
1. **Total Due Amount Card**
   - Sum of all "Completed" entries (excludes "Confirmed")
   - Click to show all entries
   
2. **Day-wise Due Cards**
   - Group by due date
   - Show amount and bill count per date
   - Scrollable horizontal layout
   - Sorted by nearest due date first
   - Click to filter table by specific date

##### Interactive Filtering
```javascript
// Day-wise card filtering
function filterPurchaseManagementTable(dueDate) {
    if (dueDate === null) {
        // Show all entries (Total Due Amount card clicked)
        showAllRows();
    } else {
        // Filter by specific due date
        hideRowsNotMatchingDueDate(dueDate);
    }
}
```

#### Payment Processing System

##### Cheque Management
**For Completed Entries Only:**
- **Cheque Number** → Editable input field
- **Cheque Date** → Date picker (defaults to due date)
- **Auto-save** → Changes saved on input blur

##### Payment Completion
**Process Flow:**
```javascript
function markPaymentDone(entryId) {
    1. Validate cheque number is entered
    2. Show confirmation dialog
    3. Update status from "Completed" to "Paid"
    4. Set paidAt timestamp
    5. Preserve cheque details
    6. Move to "Purchased" section
    7. Update all summary displays
}
```

### Phase 6: Purchased (Completed Payments)

#### Data Source
Purchase entries with status "Paid"

#### Payment Summary System

##### Total Payment Display
- **Total Payment Made Card** → Sum of all paid entries
- **Month-wise Payment Cards** → Grouped by payment month
  ```javascript
  // Month grouping logic
  const paymentDate = new Date(entry.paidAt);
  const monthKey = `${year}-${month.padStart(2, '0')}`;
  const monthName = paymentDate.toLocaleDateString('en-IN', { 
      month: 'short', 
      year: 'numeric' 
  });
  ```

##### Interactive Payment Analysis
- **Total Card Click** → Show all paid entries
- **Month Card Click** → Filter by specific month
- **Visual Feedback** → Active card highlighting

#### Purchased Table Display
**Columns:**
- Bill Number, Date, Retailer Name
- Net Amount, Cheque Number, Cheque Date  
- **Payment Date** → From paidAt timestamp

##### Advanced Filtering
- **Retailer Filter** → Real-time search by retailer name
- **Date Filter** → Filter by specific bill date
- **Month Filter** → From month card interactions
- **Combined Filtering** → Multiple filters work together

#### Retailer Payment History
```javascript
// Payment details view (future enhancement)
function viewPurchaseDetails(retailerName) {
    1. Filter paid entries by retailer
    2. Calculate total payments made
    3. Show detailed payment history
    4. Display in modal/popup format
}
```

## Advanced Features

### Automatic Calculations

#### Net Amount Formula
```javascript
netAmount = taxableAmount + totalTax - deduction;
// Real-time calculation on form input changes
```

#### Due Date Intelligence
- **Retailer-specific** → Uses retailer's configured due days
- **Default Fallback** → 30 days if retailer not found
- **Business Day Awareness** → Future enhancement

### Status State Machine
```
Received/Edit → Confirmed → Completed → Paid
     ↑              ↑           ↑
   (Edit)       (Confirm)  (A/c Done)  (Payment Done)
```

### Data Integrity Features

#### Unique ID Generation
- **Format:** `PUR-{timestamp}-{random}`
- **Collision Prevention** → Timestamp + random number
- **Traceability** → Unique across all entries

#### Entry Validation
- **Required Fields** → Enforced at submission
- **Business Rules** → Amount validations
- **Status Transitions** → Controlled workflow
- **Data Consistency** → Cross-validation with retailers

## Integration Points

### Internal System Integration
1. **User Management** → Multi-user access control
2. **Audit Trail** → All changes logged with timestamps
3. **Reporting** → Data feeds for analytics
4. **Export Systems** → Excel/CSV export capabilities

### External System Integration
1. **Accounting Software** → API integration potential
2. **Banking Systems** → Cheque management integration
3. **ERP Systems** → Purchase order matching
4. **Tax Systems** → GST/VAT integration

## Error Handling & Validation

### Form Validation
```javascript
// Real-time validation
- Required field highlighting
- Amount range checking  
- Date format validation
- Duplicate bill number detection
```

### Business Logic Validation
```javascript
// Status transition validation
function validateStatusTransition(fromStatus, toStatus) {
    const validTransitions = {
        'Received': ['Confirmed'],
        'Edit': ['Confirmed'],
        'Confirmed': ['Completed'],
        'Completed': ['Paid']
    };
    return validTransitions[fromStatus].includes(toStatus);
}
```

### Error Recovery
- **Form State Preservation** → Save draft data
- **Transaction Rollback** → Undo failed operations
- **User Notification** → Clear error messages
- **Retry Mechanisms** → Automatic retry for network failures

## Performance Optimizations

### Data Management
- **Efficient Filtering** → Client-side filtering for responsiveness
- **Lazy Loading** → Load data as needed
- **Memory Management** → Cleanup unused objects
- **Caching Strategy** → Cache frequent calculations

### UI Performance  
- **Virtual Scrolling** → Handle large datasets
- **Debounced Search** → Prevent excessive filtering
- **Optimistic Updates** → Immediate UI feedback
- **Progressive Loading** → Show data as it loads

## Security & Compliance

### Data Protection
- **Input Sanitization** → Prevent injection attacks
- **Access Control** → Role-based permissions
- **Audit Logging** → All operations tracked
- **Data Encryption** → Sensitive data protection

### Financial Compliance
- **Amount Validation** → Prevent negative amounts
- **Date Validation** → Prevent future dating
- **Approval Workflow** → Segregation of duties
- **Audit Trail** → Complete transaction history

## Reporting & Analytics

### Management Reports
- **Outstanding Payments** → Due date analysis
- **Payment Performance** → Retailer-wise metrics
- **Cash Flow Analysis** → Monthly payment trends
- **Aging Reports** → Overdue payment tracking

### Export Capabilities
- **Excel Export** → Full data export
- **PDF Reports** → Formatted management reports  
- **CSV Export** → Data interchange format
- **API Access** → Real-time data integration

## Maintenance & Monitoring

### System Health
- **Data Consistency Checks** → Regular validation
- **Performance Monitoring** → Response time tracking
- **Error Rate Monitoring** → System reliability metrics
- **User Activity Tracking** → Usage analytics

### Data Backup & Recovery
- **Automated Backups** → Regular data protection
- **Point-in-time Recovery** → Transaction-specific recovery
- **Data Migration Tools** → System upgrade support
- **Disaster Recovery** → Business continuity planning

## Future Enhancements

### Planned Features
1. **Bulk Import** → Excel-based purchase entry import
2. **Payment Approval Workflow** → Multi-level approvals
3. **Integration APIs** → External system connectivity
4. **Advanced Reporting** → Custom report builder
5. **Mobile Interface** → Responsive design improvements
6. **Automated Reminders** → Due date notifications
7. **Payment Gateway Integration** → Online payment processing
8. **Document Management** → Bill/invoice attachment system