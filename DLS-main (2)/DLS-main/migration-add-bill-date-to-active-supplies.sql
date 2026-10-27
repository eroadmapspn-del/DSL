-- Migration to add bill_date column to active_supplies table
-- Run this in your Supabase SQL Editor

-- Step 1: Add the bill_date column (allowing NULL temporarily)
ALTER TABLE active_supplies ADD COLUMN IF NOT EXISTS bill_date DATE;

-- Step 2: Update existing records to get bill_date from the bills table
UPDATE active_supplies 
SET bill_date = bills.bill_date 
FROM bills 
WHERE active_supplies.bill_id = bills.id 
AND active_supplies.bill_date IS NULL;

-- Step 3: Make the column NOT NULL (now that all records have values)
ALTER TABLE active_supplies ALTER COLUMN bill_date SET NOT NULL;

-- Verify the update worked
SELECT id, bill_number, bill_date, retailer_name 
FROM active_supplies 
LIMIT 10;