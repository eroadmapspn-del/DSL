-- ============================================================================
-- DIAGNOSE SECTOR ISSUE
-- Run this to understand why "Fix Sectors" isn't working
-- ============================================================================

-- CHECK 1: Do we have ANY bills with actual sectors (not Unknown)?
SELECT 
    '1️⃣ Bills with valid sectors (source for learning)' as check_type,
    COUNT(*) as count,
    COUNT(DISTINCT sector) as unique_sectors,
    COUNT(DISTINCT retailer_name) as unique_retailers
FROM approved_bills
WHERE sector IS NOT NULL 
  AND sector != 'Unknown' 
  AND sector != '';

-- CHECK 2: Show sample of bills WITH sectors
SELECT 
    '2️⃣ Sample bills WITH sectors' as check_type,
    retailer_name,
    sector,
    COUNT(*) as bill_count
FROM approved_bills
WHERE sector IS NOT NULL 
  AND sector != 'Unknown' 
  AND sector != ''
GROUP BY retailer_name, sector
ORDER BY bill_count DESC
LIMIT 20;

-- CHECK 3: Count bills with Unknown/NULL sectors
SELECT 
    '3️⃣ Bills needing sector fix' as check_type,
    'approved_bills' as table_name,
    COUNT(*) as count
FROM approved_bills
WHERE sector IS NULL OR sector = 'Unknown' OR sector = ''
UNION ALL
SELECT 
    '3️⃣ Bills needing sector fix',
    'active_supplies',
    COUNT(*)
FROM active_supplies
WHERE sector IS NULL OR sector = 'Unknown' OR sector = ''
UNION ALL
SELECT 
    '3️⃣ Bills needing sector fix',
    'ugrai_data',
    COUNT(*)
FROM ugrai_data
WHERE sector IS NULL OR sector = 'Unknown' OR sector = ''
UNION ALL
SELECT 
    '3️⃣ Bills needing sector fix',
    'ugrai_entries',
    COUNT(*)
FROM ugrai_entries
WHERE sector IS NULL OR sector = 'Unknown' OR sector = '';

-- CHECK 4: Show sector distribution in approved_bills
SELECT 
    '4️⃣ Sector distribution in approved_bills' as check_type,
    COALESCE(sector, 'NULL') as sector_value,
    COUNT(*) as count,
    ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM approved_bills)), 2) as percentage
FROM approved_bills
GROUP BY sector
ORDER BY count DESC;

-- CHECK 5: Check if retailers table exists and has data
SELECT 
    '5️⃣ Retailers table check' as check_type,
    COUNT(*) as retailer_count,
    COUNT(DISTINCT sector) as sectors_in_retailers_table
FROM retailers
WHERE sector IS NOT NULL AND sector != '';

-- CHECK 6: Sample retailers from approved_bills with Unknown sectors
SELECT 
    '6️⃣ Sample retailers needing sectors' as check_type,
    retailer_name,
    COUNT(*) as bill_count
FROM approved_bills
WHERE sector IS NULL OR sector = 'Unknown' OR sector = ''
GROUP BY retailer_name
ORDER BY bill_count DESC
LIMIT 20;

-- ============================================================================
-- DIAGNOSIS SUMMARY
-- ============================================================================
-- If CHECK 1 shows count = 0:
--   ❌ Problem: NO bills have valid sectors to learn from
--   💡 Solution: Manually set sectors on some bills first
--
-- If CHECK 1 shows count > 0:
--   ✅ Good: We have bills with sectors to learn from
--   ⚠️ But: The "Fix Sectors" button should work
--   💡 Check: Browser console for errors
--
-- If CHECK 5 shows count = 0:
--   ⚠️ No retailers table or it's empty
--   💡 System will try to learn from approved_bills instead
-- ============================================================================
