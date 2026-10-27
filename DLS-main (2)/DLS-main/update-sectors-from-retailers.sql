-- ============================================================================
-- UPDATE SECTORS FROM RETAILERS TABLE
-- Updates sector columns in all bill tables based on retailers table lookup
-- Uses fuzzy matching to handle name variations (spaces, case, etc.)
-- ============================================================================

-- STEP 1: Preview - Check retailers table data
SELECT 
    '📊 Retailers table summary' as check_type,
    COUNT(*) as total_retailers,
    COUNT(DISTINCT sector) as unique_sectors
FROM retailers;

-- Show sample retailers
SELECT 
    '📋 Sample retailers' as check_type,
    retailer_name,
    sector
FROM retailers
ORDER BY retailer_name
LIMIT 20;

-- STEP 2: Preview - Show matching statistics BEFORE update
SELECT 
    '🔍 Matching preview (approved_bills)' as check_type,
    COUNT(DISTINCT ab.retailer_name) as unique_retailers_in_bills,
    COUNT(DISTINCT r.retailer_name) as matches_found,
    COUNT(DISTINCT ab.retailer_name) - COUNT(DISTINCT r.retailer_name) as no_match_found
FROM approved_bills ab
LEFT JOIN retailers r ON TRIM(LOWER(ab.retailer_name)) = TRIM(LOWER(r.retailer_name))
WHERE ab.sector IS NULL OR ab.sector = 'Unknown';

-- STEP 3: Preview - Show retailers that WON'T match (for debugging)
SELECT 
    '⚠️ Bills with no retailer match (first 20)' as check_type,
    ab.retailer_name as bill_retailer_name,
    COUNT(*) as bill_count
FROM approved_bills ab
LEFT JOIN retailers r ON TRIM(LOWER(ab.retailer_name)) = TRIM(LOWER(r.retailer_name))
WHERE (ab.sector IS NULL OR ab.sector = 'Unknown')
  AND r.retailer_name IS NULL
GROUP BY ab.retailer_name
ORDER BY bill_count DESC
LIMIT 20;

-- ============================================================================
-- STEP 4: UPDATE approved_bills
-- ============================================================================
UPDATE approved_bills
SET 
    sector = r.sector
FROM retailers r
WHERE TRIM(LOWER(approved_bills.retailer_name)) = TRIM(LOWER(r.retailer_name))
  AND (approved_bills.sector IS NULL OR approved_bills.sector = 'Unknown' OR approved_bills.sector = '');

-- Show result
SELECT 
    '✅ approved_bills updated' as result,
    COUNT(*) as bills_with_sectors
FROM approved_bills
WHERE sector IS NOT NULL AND sector != 'Unknown' AND sector != '';

-- ============================================================================
-- STEP 5: UPDATE active_supplies
-- ============================================================================
UPDATE active_supplies
SET 
    sector = r.sector
FROM retailers r
WHERE TRIM(LOWER(active_supplies.retailer_name)) = TRIM(LOWER(r.retailer_name))
  AND (active_supplies.sector IS NULL OR active_supplies.sector = 'Unknown' OR active_supplies.sector = '');

-- Show result
SELECT 
    '✅ active_supplies updated' as result,
    COUNT(*) as supplies_with_sectors
FROM active_supplies
WHERE sector IS NOT NULL AND sector != 'Unknown' AND sector != '';

-- ============================================================================
-- STEP 6: UPDATE ugrai_data
-- ============================================================================
UPDATE ugrai_data
SET 
    sector = r.sector
FROM retailers r
WHERE TRIM(LOWER(ugrai_data.retailer_name)) = TRIM(LOWER(r.retailer_name))
  AND (ugrai_data.sector IS NULL OR ugrai_data.sector = 'Unknown' OR ugrai_data.sector = '');

-- Show result
SELECT 
    '✅ ugrai_data updated' as result,
    COUNT(*) as ugrai_with_sectors
FROM ugrai_data
WHERE sector IS NOT NULL AND sector != 'Unknown' AND sector != '';

-- ============================================================================
-- STEP 7: UPDATE ugrai_entries
-- ============================================================================
UPDATE ugrai_entries
SET 
    sector = r.sector
FROM retailers r
WHERE TRIM(LOWER(ugrai_entries.retailer_name)) = TRIM(LOWER(r.retailer_name))
  AND (ugrai_entries.sector IS NULL OR ugrai_entries.sector = 'Unknown' OR ugrai_entries.sector = '');

-- Show result
SELECT 
    '✅ ugrai_entries updated' as result,
    COUNT(*) as entries_with_sectors
FROM ugrai_entries
WHERE sector IS NOT NULL AND sector != 'Unknown' AND sector != '';

-- ============================================================================
-- STEP 8: VERIFICATION - Check overall results
-- ============================================================================
SELECT 
    '📊 Final sector distribution' as summary,
    'approved_bills' as table_name,
    COALESCE(sector, 'NULL') as sector_value,
    COUNT(*) as count
FROM approved_bills
GROUP BY sector
ORDER BY count DESC;

-- ============================================================================
-- STEP 9: Show retailers still without matches
-- ============================================================================
SELECT 
    '⚠️ Retailers still needing manual mapping' as final_check,
    ab.retailer_name,
    COUNT(*) as bill_count
FROM approved_bills ab
LEFT JOIN retailers r ON TRIM(LOWER(ab.retailer_name)) = TRIM(LOWER(r.retailer_name))
WHERE (ab.sector IS NULL OR ab.sector = 'Unknown' OR ab.sector = '')
  AND r.retailer_name IS NULL
GROUP BY ab.retailer_name
ORDER BY bill_count DESC
LIMIT 30;

-- ============================================================================
-- NOTES:
-- ============================================================================
-- ✅ This script uses TRIM(LOWER()) for case-insensitive matching
-- ✅ Updates all 4 tables: approved_bills, active_supplies, ugrai_data, ugrai_entries
-- ✅ Only updates bills where sector is NULL, 'Unknown', or empty
-- ✅ Preserves existing non-Unknown sectors
-- ✅ Updates timestamp for tracking
--
-- ⚠️ If retailers still don't match after this:
--    1. Check STEP 9 output for unmatched retailers
--    2. Add those retailers to the retailers table with correct names
--    3. Run this script again
--
-- 💡 To add missing retailers, use:
--    INSERT INTO retailers (retailer_name, sector, user_id)
--    VALUES ('EXACT NAME FROM BILLS', 'Sector Name', 'your-user-id');
-- ============================================================================

