# UGRAI SECTION - Complete Data Flow Guide

## Overview
The UGRAI section manages the collection and tracking of outstanding credit amounts from retailers. It handles both uploaded UGRAI data and credit bills from the Supply section, with person-wise assignment and completion tracking.

## Data Structures & Storage

### Primary Data Arrays
- `ugraiData`: Master UGRAI data from Excel uploads
- `ugraiEntries`: UGRAI entries created from credit bills
- `completedUgrai`: Finished UGRAI entries awaiting approval
- `approvedUgrai`: Final approved UGRAI entries
- `persons`: List of assignable personnel
- `ugraiAssignments`: Sector-to-person mapping

### Core Data Models
```javascript
// UGRAI Bill Object
{
    id: "UG-{billNumber}",
    billNumber: "string",
    billDate: "YYYY-MM-DD",
    retailerName: "string", 
    sector: "string",
    netAmount: number,
    status: "Pending|Completed|Approved",
    assignedTo: "person_name",
    paymentMethod: "Cash|UPI|Cheque|NEFT",
    receiptNumber: "string",
    receivedAmount: number,
    chequeDate: "YYYY-MM-DD",
    photoUploaded: boolean,
    dateCompleted: "YYYY-MM-DD"
}
```

## Complete Data Flow

### Phase 1: Ugrai Base File Management

#### Input Sources

##### A. Direct UGRAI Data Upload
```javascript
// Expected Excel columns (case-insensitive)
const UGRAI_COLUMNS = {
    billNumber: 'bill number',
    billDate: 'bill date',
    retailerName: 'retailer name', 
    sector: 'sector',
    netAmount: 'net amount'
};
```

**Processing Steps:**
1. **File Validation** → Check .xlsx/.xls format
2. **Column Detection** → Exact header matching
3. **Data Extraction** → Row-by-row processing
4. **ID Generation** → Create unique IDs (`UG-{billNumber}`)
5. **Date Formatting** → Standardize date format
6. **Storage** → Replace existing `ugraiData` array
7. **UI Refresh** → Update all dependent tables

##### B. UGRAI from Credit Bills
**Data Source:** Approved credit bills from Supply section
**Filter Criteria:** `deliveryMethod === 'Credit'`

**Automatic Processing:**
1. **Credit Detection** → Filter approved bills
2. **Data Transformation** → Convert to UGRAI format
3. **ID Assignment** → Generate UGRAI-specific IDs
4. **Status Setting** → Mark as "Pending"
5. **Display** → Show in "Credit Bills Available" table

#### Data Filtering & Search
**Filter Options:**
- Retailer Name (partial match, case-insensitive)
- Bill Number (partial match, case-insensitive)
- Real-time filtering as user types

### Phase 2: UGRAI Issue (Assignment System)

#### Sector Analysis & Totals
**Calculation Logic:**
```javascript
// Sector totals calculation
sectorTotals = {
    [sectorName]: {
        billCount: number,
        totalAmount: number,
        totalDueAmount: number  // Bills > 15 days old
    }
}

// Due amount calculation
const billDate = new Date(bill.billDate);
const dueDate = new Date(billDate);
dueDate.setDate(billDate.getDate() + 15);
const isDue = dueDate <= today;
```

**Data Sources Combined:**
- `ugraiData` (uploaded data)
- `ugraiEntries` (from credit bills)
- Real-time aggregation by sector

#### Person Assignment System
**Default Personnel:** `['Mohan', 'Suresh', 'Rahul']`

**Assignment Process:**
1. **Sector Display** → Show sector totals table
2. **Person Selection** → Dropdown per sector
3. **Assignment Storage** → Save in `ugraiAssignments` object
4. **Bulk Operations** → "Clear All Assignments" functionality

**Assignment Data Structure:**
```javascript
ugraiAssignments = {
    "Retail": "Mohan",
    "Wholesale": "Suresh", 
    "Electronics": "Rahul"
}
```

### Phase 3: UGRAI in Progress

#### Assigned Bills Display
**Data Source:** All UGRAI bills where sector has assigned person
**Display Format:** Bill-wise breakdown with assignment details

**Table Columns:**
- Bill Number, Date, Retailer Name, Sector
- Net Amount, Assigned Person
- **Action Button:** "UGRAI Done" for completion

#### UGRAI Completion Process
**UGRAI Done Modal Fields:**

##### Payment Method Options
1. **Cash**
   - Receipt Number (required)
   - Received Amount (required, ≤ net amount)
   - Photo Upload (required)

2. **UPI** 
   - Receipt Number (required)
   - Received Amount (required, ≤ net amount)
   - Photo Upload (required)

3. **Cheque**
   - Receipt Number (required)
   - Received Amount (required, ≤ net amount)
   - Cheque Date (required)
   - Photo Upload (required)

4. **NEFT**
   - Received Amount (required, ≤ net amount)
   - No additional fields required

#### Validation Rules
```javascript
// Required field validation by payment method
if (['Cash', 'UPI', 'Cheque'].includes(paymentMethod)) {
    required: [receiptNumber, receivedAmount, photo]
}

if (paymentMethod === 'Cheque') {
    required: [...previous, chequeDate]
}

// Amount validation
if (receivedAmount > netAmount) {
    error: "Amount exceeds maximum allowed"
}
```

#### Status Transitions
- Pending → Completed (via UGRAI Done)
- Completed → Approved (via management approval)

### Phase 4: UGRAI Management (Approval System)

#### Summary Dashboard
**Real-time Metrics Calculation:**
```javascript
// Calculate totals from completedUgrai array
const totalBills = completedUgrai.length;
const totalAmount = sum(receivedAmount || netAmount);

// Payment method breakdown
const methodTotals = {
    'Cash': { count: 0, amount: 0 },
    'UPI': { count: 0, amount: 0 },
    'Cheque': { count: 0, amount: 0 },
    'NEFT': { count: 0, amount: 0 }
};
```

**Dashboard Cards:**
- Combined Total (Bills + Amount)
- Cash, UPI, Cheque, NEFT breakdowns
- Interactive filtering by payment method

#### Approval Interface
**Data Source:** `completedUgrai` array (bills marked as completed)

**Table Display:**
- Full bill details with payment information
- Received amount vs net amount comparison
- Payment method and completion status

**Available Actions:**
1. **Individual Edit** → Reopen completion modal with existing data
2. **Individual Approve** → Send to Google Sheets, move to approved
3. **Bulk Select & Approve** → Process multiple bills simultaneously

#### Edit Mode Functionality
**Pre-population Logic:**
```javascript
// Edit mode detection
const isEditMode = confirmButton.textContent === 'Save';

// Form pre-population
if (isEditMode) {
    populateFields(existingBillData);
    showPhotoPreview(existingPhoto);
    changeButtonText('Save');
}
```

**Update Process:**
1. **Form Validation** → Same rules as new entry
2. **Data Update** → Modify existing completedUgrai entry
3. **UI Refresh** → Update all dependent displays
4. **No Status Change** → Remains in completed status

#### Approval Processing
```javascript
// Approval workflow
function approveUgraiBill(billId) {
    1. Find bill in completedUgrai array
    2. Remove from completedUgrai
    3. Add to approvedUgrai (audit trail)
    4. Send to Google Sheets (mock implementation)
    5. Update UI and show confirmation
    6. Refresh all dashboards
}
```

## Data Integration Points

### Supply Section Integration
**Credit Bill Flow:**
1. Supply bills marked as "Credit" delivery method
2. Automatic inclusion in UGRAI base file view
3. Option to convert to UGRAI entries
4. Maintains traceability to original supply bill

### External Integrations
1. **Excel Import/Export** → Bulk data operations
2. **Google Sheets** → Final approved data destination
3. **File Storage** → Payment proof photos
4. **Reporting Systems** → Data export for analysis

## Advanced Features

### Due Amount Tracking
**Business Rule:** Bills become "due" after 15 days from bill date
**Implementation:**
```javascript
const billDate = new Date(item.billDate);
const dueDate = new Date(billDate);
dueDate.setDate(billDate.getDate() + 15);
const isDue = dueDate <= today;
```

### Sector-wise Management
- Automatic grouping by retailer sector
- Assignable to different personnel
- Individual sector performance tracking
- Bulk assignment and clearing options

### Photo Management
- Required for Cash, UPI, and Cheque payments
- Preview functionality in edit mode
- Placeholder system for missing photos
- File validation and size limits

### Filter & Search Capabilities
- Real-time retailer name filtering
- Bill number search
- Payment method filtering
- Date range filtering (future enhancement)

## Error Handling & Validation

### File Upload Validation
- Excel format verification (.xlsx/.xls only)
- Required column presence checking
- Data type validation for amounts and dates
- Empty file detection

### Business Logic Validation
- Amount range checking (received ≤ net)
- Required field enforcement by payment method
- Duplicate bill number prevention
- Date format standardization

### Data Consistency Checks
- Assignment verification before completion
- Status transition validation
- Cross-reference with original supply bills
- Approval prerequisite checking

## Performance Optimizations

### Data Loading Strategies
- Lazy loading for large UGRAI datasets
- Efficient sector aggregation algorithms
- Optimized filtering and search operations
- Minimal DOM updates for large tables

### Memory Management
- Efficient data structure usage
- Cleanup of temporary variables
- Event listener management
- File processing optimization

## Security & Audit Trail

### Data Protection
- User-based data isolation
- Secure file upload handling
- Input sanitization and validation
- Photo storage security

### Audit Capabilities
- All assignment changes logged
- Completion timestamps recorded
- Approval audit trail maintained
- User action tracking

### Data Integrity
- Referential integrity with supply bills
- Amount calculation verification
- Status transition validation
- Backup and recovery procedures

## Reporting & Analytics

### Management Reports
- Sector-wise performance metrics
- Person-wise collection statistics
- Due amount aging analysis
- Payment method distribution

### Export Capabilities
- Excel export of UGRAI data
- PDF reports for management
- CSV exports for external systems
- Google Sheets integration for real-time access

## Maintenance & Monitoring

### System Health Checks
- Data consistency validation
- File processing monitoring
- Integration point verification
- Performance metric tracking

### Error Monitoring
- File upload failure tracking
- Data validation error logging
- Integration failure alerts
- User error reporting

### Data Backup & Recovery
- Regular data exports
- Point-in-time recovery capabilities
- Data migration tools
- Disaster recovery procedures