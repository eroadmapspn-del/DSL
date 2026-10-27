# Edited Bills - Supply Analysis Update

## Summary
Added support for "Edited" status bills in the Supply Analysis dashboard. Edited bills are now included in totals, have their own card, and appear in the payment methods chart.

## Changes Made

### 1. SQL Function Updated (`supply-analysis-sql-function.sql`)
- **Added "edited" to business rule**: Edited bills now use `net_amount` (since they haven't been paid yet)
- **Updated CASE statement**: `WHEN ab.status IN ('cancelled', 'returned', 'edited') THEN ab.net_amount`
- **Updated comments**: Documented that edited bills are handled similarly to cancelled/returned

### 2. HTML UI Updated (`supply.html`)
- **Changed grid layout**: Changed from `lg:grid-cols-4` to `lg:grid-cols-5` to accommodate 5 cards
- **Added Edited Bills card**:
  - Yellow gradient background (`from-yellow-50 to-yellow-100`)
  - Pencil emoji icon (✏️)
  - Card ID: `supply-edited-amount`
  - Positioned after Credit card

### 3. JavaScript Processing Updated (`scripts.js`)

#### a. ALL_PAYMENT_METHODS Constant (Line 12301)
```javascript
// Before:
const ALL_PAYMENT_METHODS = ['Cash', 'Credit', 'UPI', 'Cheque', 'NEFT', 'Cancelled', 'Returned'];

// After:
const ALL_PAYMENT_METHODS = ['Cash', 'Credit', 'UPI', 'Cheque', 'NEFT', 'Edited', 'Cancelled', 'Returned'];
```

#### b. processSQLAggregation Function (Line 12531)
- **Added `editedAmount: 0`** to analysisData initialization
- **Updated status check**: `if (status === 'approved' || status === 'cancelled' || status === 'returned' || status === 'edited')`
- **Added edited bills handling**:
  ```javascript
  } else if (status === 'edited') {
      analysisData.paymentMethods['Edited'].count += count;
      analysisData.paymentMethods['Edited'].amount += amount;
      analysisData.editedAmount += amount;
  }
  ```
- **Updated console logging**: Now includes `editedAmount` in the totals log

#### c. updateSupplyAnalysisUI Function (Line 12958)
- **Added element reference**: `const editedAmountElement = document.getElementById('supply-edited-amount');`
- **Added UI update**:
  ```javascript
  if (editedAmountElement) {
      editedAmountElement.textContent = `₹${(data.editedAmount || 0).toLocaleString()}`;
  }
  ```

#### d. Payment Methods Chart (Line 13110)
- **No changes needed**: Chart automatically picks up "Edited" from `ALL_PAYMENT_METHODS` array
- Chart will display edited bills with a distinct color (emerald green, 7th color in the palette)

## How It Works Now

### Data Flow:
1. **SQL Aggregation**: `get_supply_analysis_summary()` returns rows including `status='edited'`
2. **JavaScript Processing**: 
   - Edited bills are counted in `totalBills`
   - Edited amounts are added to `totalAmount`
   - Edited bills get their own category in `paymentMethods['Edited']`
3. **UI Display**:
   - Total Bills count includes edited bills
   - Total Amount includes edited bills amount
   - Edited Bills card shows the specific amount for edited bills
   - Chart includes "Edited" as a separate bar

### Business Logic:
- **Edited bills use `net_amount`** because they haven't been paid yet (similar to cancelled/returned)
- **Edited bills are included in totals** to give complete overview of all bills in the system
- **Edited bills are visually distinct** with yellow card and separate chart bar

## Testing Checklist

After running the SQL update in Supabase:

1. ✅ Navigate to Analysis > Supply Analysis
2. ✅ Check that Total Bills includes edited bills
3. ✅ Check that Total Amount includes edited bills amount
4. ✅ Verify the "Edited Bills" yellow card shows the correct amount
5. ✅ Verify the chart shows "Edited" as a separate bar
6. ✅ Import some bills with status="edited" via the CSV transformer
7. ✅ Refresh Supply Analysis and verify edited bills appear
8. ✅ Check console logs show editedAmount in the totals

## Files Modified

1. `supply-analysis-sql-function.sql` - SQL aggregation function
2. `supply.html` - Added Edited Bills card (5-column grid)
3. `scripts.js` - Updated processing, UI update, and constants

## Next Steps

1. Run the updated `supply-analysis-sql-function.sql` in Supabase SQL Editor
2. Refresh the browser to load the new JavaScript
3. Test by importing bills with "edited" status via the Excel transformer
4. Verify all edited bills data appears correctly in the dashboard
