-- Fix Retailers Table: Global Unique Constraint + Cleanup Duplicates
-- Run this in Supabase SQL Editor

BEGIN;

-- Step 1: Backup existing retailers table
CREATE TEMP TABLE retailers_backup AS 
SELECT * FROM retailers;

SELECT '✅ Backup created' as step, COUNT(*) as total_records FROM retailers_backup;

-- Step 2: Identify and preview duplicates
SELECT 
    'Duplicates to be cleaned:' as step,
    retailer_name,
    COUNT(*) as duplicate_count,
    STRING_AGG(DISTINCT sector, ', ') as all_sectors,
    STRING_AGG(DISTINCT user_id, ', ') as all_user_ids
FROM retailers
GROUP BY retailer_name
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- Step 3: Delete rows with "Unassigned" sector where a better sector exists
DELETE FROM retailers r1
WHERE r1.sector = 'Unassigned'
AND EXISTS (
    SELECT 1 FROM retailers r2
    WHERE LOWER(TRIM(r2.retailer_name)) = LOWER(TRIM(r1.retailer_name))
    AND r2.sector != 'Unassigned'
    AND r2.id != r1.id
);

SELECT '✅ Deleted Unassigned duplicates' as step;

-- Step 4: For remaining duplicates with different sectors, keep the first one (oldest)
DELETE FROM retailers r1
WHERE r1.id NOT IN (
    SELECT MIN(id)
    FROM retailers
    GROUP BY LOWER(TRIM(retailer_name))
);

SELECT '✅ Kept oldest record for each retailer' as step;

-- Step 5: Update any remaining "Unassigned" sectors to empty string for visibility
UPDATE retailers
SET sector = 'N/A'
WHERE sector = 'Unassigned';

SELECT '✅ Updated remaining Unassigned to N/A' as step;

-- Step 6: Drop old unique constraint
ALTER TABLE retailers 
DROP CONSTRAINT IF EXISTS retailers_retailer_name_user_id_key;

SELECT '✅ Dropped old constraint (retailer_name, user_id)' as step;

-- Step 7: Add new global unique constraint on retailer_name only
-- First drop it if it already exists
ALTER TABLE retailers 
DROP CONSTRAINT IF EXISTS retailers_retailer_name_key;

ALTER TABLE retailers 
ADD CONSTRAINT retailers_retailer_name_key UNIQUE (retailer_name);

SELECT '✅ Added new constraint: UNIQUE(retailer_name)' as step;

-- Step 8: Create index on retailer_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_retailers_name_lower 
ON retailers (LOWER(TRIM(retailer_name)));

SELECT '✅ Created index on LOWER(TRIM(retailer_name))' as step;

-- Step 9: Verify final state
SELECT 
    '✅ Final verification:' as step,
    COUNT(*) as total_retailers,
    COUNT(DISTINCT retailer_name) as unique_retailer_names,
    SUM(CASE WHEN sector = 'N/A' THEN 1 ELSE 0 END) as retailers_needing_sector
FROM retailers;

-- Step 10: Show remaining retailers with N/A sector
SELECT 
    'Retailers needing sector assignment:' as note,
    retailer_name,
    sector,
    user_id,
    created_at
FROM retailers
WHERE sector = 'N/A'
ORDER BY retailer_name;

-- Step 11: Sync sectors from retailers to all bill tables
-- Update bills where sector is "Unassigned" or doesn't match retailer's current sector

-- Update bills (includes staged, dispatched, etc.)
UPDATE bills b
SET sector = r.sector
FROM retailers r
WHERE LOWER(TRIM(b.retailer_name)) = LOWER(TRIM(r.retailer_name))
AND (b.sector = 'Unassigned' OR b.sector IS NULL OR b.sector = 'N/A');

SELECT '✅ Updated bills sectors' as step;

-- Update active_supplies
UPDATE active_supplies a
SET sector = r.sector
FROM retailers r
WHERE LOWER(TRIM(a.retailer_name)) = LOWER(TRIM(r.retailer_name))
AND (a.sector = 'Unassigned' OR a.sector IS NULL OR a.sector = 'N/A');

SELECT '✅ Updated active_supplies sectors' as step;

-- Update approved_bills
UPDATE approved_bills ab
SET sector = r.sector
FROM retailers r
WHERE LOWER(TRIM(ab.retailer_name)) = LOWER(TRIM(r.retailer_name))
AND (ab.sector = 'Unassigned' OR ab.sector IS NULL OR ab.sector = 'N/A');

SELECT '✅ Updated approved_bills sectors' as step;

-- Update edited_bills (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'edited_bills') THEN
        UPDATE edited_bills eb
        SET sector = r.sector
        FROM retailers r
        WHERE LOWER(TRIM(eb.retailer_name)) = LOWER(TRIM(r.retailer_name))
        AND (eb.sector = 'Unassigned' OR eb.sector IS NULL OR eb.sector = 'N/A');
        
        RAISE NOTICE '✅ Updated edited_bills sectors';
    END IF;
END $$;

-- Update ugrai_data
UPDATE ugrai_data ud
SET sector = r.sector
FROM retailers r
WHERE LOWER(TRIM(ud.retailer_name)) = LOWER(TRIM(r.retailer_name))
AND (ud.sector = 'Unassigned' OR ud.sector IS NULL OR ud.sector = 'N/A');

SELECT '✅ Updated ugrai_data sectors' as step;

-- Update ugrai_entries
UPDATE ugrai_entries ue
SET sector = r.sector
FROM retailers r
WHERE LOWER(TRIM(ue.retailer_name)) = LOWER(TRIM(r.retailer_name))
AND (ue.sector = 'Unassigned' OR ue.sector IS NULL OR ue.sector = 'N/A');

SELECT '✅ Updated ugrai_entries sectors' as step;

-- Update ugrai_in_progress (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ugrai_in_progress') THEN
        UPDATE ugrai_in_progress uip
        SET sector = r.sector
        FROM retailers r
        WHERE LOWER(TRIM(uip.retailer_name)) = LOWER(TRIM(r.retailer_name))
        AND (uip.sector = 'Unassigned' OR uip.sector IS NULL OR uip.sector = 'N/A');
        
        RAISE NOTICE '✅ Updated ugrai_in_progress sectors';
    END IF;
END $$;

-- Update completed_ugrai
UPDATE completed_ugrai cu
SET sector = r.sector
FROM retailers r
WHERE LOWER(TRIM(cu.retailer_name)) = LOWER(TRIM(r.retailer_name))
AND (cu.sector = 'Unassigned' OR cu.sector IS NULL OR cu.sector = 'N/A');

SELECT '✅ Updated completed_ugrai sectors' as step;

-- Update approved_ugrai
UPDATE approved_ugrai au
SET sector = r.sector
FROM retailers r
WHERE LOWER(TRIM(au.retailer_name)) = LOWER(TRIM(r.retailer_name))
AND (au.sector = 'Unassigned' OR au.sector IS NULL OR au.sector = 'N/A');

SELECT '✅ Updated approved_ugrai sectors' as step;

-- Update purchase_entries (if sector column exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'purchase_entries' 
        AND column_name = 'sector'
    ) THEN
        UPDATE purchase_entries pe
        SET sector = r.sector
        FROM retailers r
        WHERE LOWER(TRIM(pe.retailer_name)) = LOWER(TRIM(r.retailer_name))
        AND (pe.sector = 'Unassigned' OR pe.sector IS NULL OR pe.sector = 'N/A');
        
        RAISE NOTICE '✅ Updated purchase_entries sectors';
    ELSE
        RAISE NOTICE 'ℹ️ purchase_entries table does not have sector column - skipped';
    END IF;
END $$;

-- Step 12: Final verification - Show bills that still have Unassigned/N/A sectors
SELECT 
    '⚠️ Bills still with Unassigned/N/A sectors (retailer may not exist):' as warning,
    'bills' as table_name,
    COUNT(*) as count
FROM bills
WHERE sector IN ('Unassigned', 'N/A')

UNION ALL

SELECT 
    '⚠️ Bills still with Unassigned/N/A sectors (retailer may not exist):' as warning,
    'active_supplies' as table_name,
    COUNT(*) as count
FROM active_supplies
WHERE sector IN ('Unassigned', 'N/A')

UNION ALL

SELECT 
    '⚠️ Bills still with Unassigned/N/A sectors (retailer may not exist):' as warning,
    'ugrai_data' as table_name,
    COUNT(*) as count
FROM ugrai_data
WHERE sector IN ('Unassigned', 'N/A')

UNION ALL

SELECT 
    '⚠️ Bills still with Unassigned/N/A sectors (retailer may not exist):' as warning,
    'ugrai_entries' as table_name,
    COUNT(*) as count
FROM ugrai_entries
WHERE sector IN ('Unassigned', 'N/A');

COMMIT;

-- ============================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================
-- If something goes wrong, you can restore from backup:
-- 
-- BEGIN;
-- TRUNCATE retailers;
-- INSERT INTO retailers SELECT * FROM retailers_backup;
-- COMMIT;
