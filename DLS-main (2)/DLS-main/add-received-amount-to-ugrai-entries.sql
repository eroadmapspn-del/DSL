-- Add received_amount column to ugrai_entries table
-- This is needed to properly track partial payments when bills move from supply management to UGRAI

-- Step 1: Add the column (defaults to 0 for existing records)
ALTER TABLE ugrai_entries
ADD COLUMN IF NOT EXISTS received_amount DECIMAL(10,2) DEFAULT 0 NOT NULL;

-- Step 2: Add a comment to document the field
COMMENT ON COLUMN ugrai_entries.received_amount IS 
'Amount already received for partial payment bills. For credit bills this is 0. For partial payments, this stores the amount paid so far.';

-- Verification: Check the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'ugrai_entries' 
AND column_name = 'received_amount';

-- Example of how data should look:
-- Original bill: ₹78,413
-- Partial payment: ₹30,000
-- In ugrai_entries:
--   net_amount: 48,413 (outstanding)
--   received_amount: 30,000 (already paid)
