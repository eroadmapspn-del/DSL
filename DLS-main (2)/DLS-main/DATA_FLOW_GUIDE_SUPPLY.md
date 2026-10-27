# SUPPLY SECTION - Complete Data Flow Guide

## Overview
The Supply section handles the complete lifecycle of supply orders from initial data entry through final approval and Google Sheets integration.

## Data Structures & Storage

### Primary Data Arrays
- `temporaryBills`: Staged bills awaiting submission
- `bills`: Approved bills ready for dispatch
- `activeSupplies`: Bills currently in supply process
- `approvedBills`: Final approved bills (sent to Google Sheets)
- `retailers`: Master retailer database
- `editedBills`: Bills that have been edited

### Data Storage Modes
- **Mock Mode**: In-memory storage with localStorage persistence
- **Firebase Mode**: Real-time Firestore database with automatic sync

## Complete Data Flow

### Phase 1: Base File Management (Retailer Data)

#### Input Sources
1. **Manual Addition**: Individual retailer entry via modal
2. **Excel Upload**: Bulk retailer import via file upload

#### Data Processing
```javascript
// Expected Excel columns (case-insensitive)
const RETAILER_COLUMNS = {
    retailerName: 'retailer name',
    sector: 'sector'
};
```

#### Data Flow Steps
1. **File Upload** → `retailer-base-file-upload` event
2. **Validation** → Check for required columns
3. **Processing** → Extract retailer data, remove duplicates
4. **Storage** → Save to `appState.data.retailers`
5. **UI Update** → Refresh retailer dropdown and table display

#### Error Handling
- Invalid file format validation
- Missing column detection
- Duplicate retailer prevention
- File size and corruption checks

### Phase 2: Upload Supply Data

#### Input Methods

##### A. File Upload (Nivea/Loreal)
```javascript
// Expected Excel columns
const SUPPLY_COLUMNS = {
    billNumber: 'bill number',
    billDate: 'bill date', 
    retailerName: 'retailer name',
    netAmount: 'net amount'
};
```

**Processing Logic:**
1. **File Validation** → Check .xlsx/.xls format
2. **Column Detection** → Find exact column matches
3. **Brand Detection** → Auto-detect based on bill number prefix
   - `L*` → Loreal
   - `N*` → Nivea
   - Other → N/A
4. **Retailer Matching** → Cross-reference with retailer database
5. **Data Transformation** → Create standardized bill objects
6. **Staging** → Add to `temporaryBills` array

##### B. Manual Entry
**Form Fields:**
- Brand: Dropdown (Nivea/Loreal)
- Retailer Name: Dropdown (from retailer database)
- Bill Number: Auto-generated for cash bills (`Cash-XXXX`)
- Bill Date: Date picker
- Net Amount: Numeric input

**Validation Rules:**
- All fields required
- Bill number uniqueness check
- Duplicate prevention across staged and existing bills

##### C. Edited Bills
**Source:** Bills previously marked as "Edited" in the approval process
**Process:** Allow modification of net amount and re-stage

#### Staging Area Management
- **Select All** functionality for bulk operations
- **Individual removal** from staging
- **Bulk submission** to dispatch queue
- **Real-time duplicate detection**

### Phase 3: Bills to Dispatch

#### Data Source
Bills moved from staging (`temporaryBills`) to dispatch queue (`bills`)

#### Supply Assignment
- **Supply Through** dropdown options:
  - Mohan
  - Supply
- Assignment affects tracking and responsibility

#### Dispatch Operations
1. **Selection** → Checkbox-based multi-select
2. **Supply Method Assignment** → Choose delivery person/method
3. **Submission** → Move to active supplies with "In Progress" status
4. **Move Back** → Return bills to staging if needed

### Phase 4: Supplies in Progress

#### Data Source
Active supplies with status "In Progress"

#### Supply Completion Process
**Supply Done Modal Fields:**

##### Status Options
1. **Delivered**
   - Payment Method: Cash, Credit, UPI, Cheque
   - Receipt Number (required for Cash/UPI/Cheque)
   - Received Amount (with validation against net amount)
   - Cheque Date (required for Cheque)
   - Photo Upload (required for non-Credit)

2. **Cancelled**
   - No additional fields required
   - Reason tracking for audit

3. **Edited**
   - New amount entry
   - Requires subsequent approval

#### Field Validation Rules
```javascript
// Amount validation
if (receivedAmount > netAmount) {
    error: "Amount exceeds maximum allowed"
}

// Required field validation by payment method
Cash/UPI/Cheque: receiptNumber + receivedAmount + photo
Cheque: + chequeDate
Credit: photo only
```

#### Status Transitions
- In Progress → Delivered/Cancelled/Edited
- All completed statuses → Pending Approval

### Phase 5: Supply Management (Approval System)

#### Data Source
Active supplies with completed status awaiting approval

#### Summary Dashboard
**Real-time Metrics:**
- Total Bills Pending Approval
- Total Amount Pending
- Breakdown by Payment Method:
  - Cash (count + amount)
  - Credit (count + amount) 
  - UPI (count + amount)
  - Cheque (count + amount)
  - Cancelled (count + amount)
  - Edited (count + amount)

#### Approval Interface
**Bill Details Display:**
- Bill Number, Date, Retailer, Sector
- Net Amount vs Received Amount
- Payment method and status
- Photo attachment indicator

**Actions Available:**
1. **Individual Edit** → Reopen supply completion modal
2. **Individual Approve** → Send single bill to Google Sheets
3. **Bulk Select & Approve** → Process multiple bills simultaneously

#### Approval Processing
```javascript
// Approval workflow
1. Bill validation and final checks
2. Special handling for edited bills:
   - Add to editedBills collection
   - Flag for special processing
3. Google Sheets integration (mock in demo)
4. Remove from activeSupplies
5. Add to approvedBills for audit trail
6. UI notification and refresh
```

## Integration Points

### External Systems
1. **Google Sheets** → Final approved data export
2. **Excel Import/Export** → Data interchange format
3. **File Storage** → Photo attachments for payment proof

### Internal Integrations
1. **UGRAI Section** → Credit bills feed into UGRAI processing
2. **Purchase Section** → Separate accounting workflow
3. **User Management** → Multi-user assignment and tracking

## Error Handling & Edge Cases

### File Upload Errors
- Corrupted file detection
- Missing/incorrect headers
- Empty files
- Large file size limits

### Data Validation Errors
- Duplicate bill numbers
- Invalid date formats
- Negative amounts
- Missing retailer matches

### Business Logic Errors
- Amount exceeding limits
- Invalid status transitions
- Missing required fields
- Network/database failures

### Recovery Mechanisms
- Automatic retry for failed operations
- Data validation at each stage
- User feedback for all error conditions
- Rollback capabilities for failed transactions

## Performance Optimizations

### Data Loading
- Lazy loading of large datasets
- Pagination for large bill lists
- Efficient filtering and search

### UI Responsiveness
- Debounced search inputs
- Optimistic UI updates
- Background processing for bulk operations
- Progress indicators for long operations

### Memory Management
- Cleanup of temporary data
- Efficient data structures
- Minimal DOM manipulation

## Security & Data Integrity

### Access Control
- User-based data isolation
- Session management
- Permission-based feature access

### Data Validation
- Server-side validation mirrors
- Input sanitization
- SQL injection prevention
- XSS protection

### Audit Trail
- All operations logged
- User action tracking
- Data change history
- Error logging and monitoring

## Maintenance & Monitoring

### Health Checks
- Database connectivity
- File upload functionality
- External API availability
- Data consistency checks

### Performance Monitoring
- Query performance tracking
- File processing times
- User action response times
- Error rate monitoring

### Data Backup & Recovery
- Regular automated backups
- Point-in-time recovery
- Data export capabilities
- Disaster recovery procedures