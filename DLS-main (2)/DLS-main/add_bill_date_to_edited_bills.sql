-- Add bill_date column to edited_bills table
ALTER TABLE public.edited_bills 
ADD COLUMN IF NOT EXISTS bill_date DATE NULL;

-- Add comment to the column
COMMENT ON COLUMN public.edited_bills.bill_date IS 'The original bill date from the supply bill';
