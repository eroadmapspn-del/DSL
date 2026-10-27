-- Add bill_date column to active_supplies table
ALTER TABLE active_supplies 
ADD COLUMN bill_date DATE;

-- Optional: Update existing records with bill_date from bills table
-- (This will populate existing active_supplies with their corresponding bill dates)
UPDATE active_supplies 
SET bill_date = bills.bill_date 
FROM bills 
WHERE active_supplies.bill_id = bills.id 
AND active_supplies.bill_date IS NULL;

-- Optional: Add a comment to document the column
COMMENT ON COLUMN active_supplies.bill_date IS 'Bill date copied from the original bill when moved to active supplies';