-- Check for case sensitivity or whitespace issues in status field
SELECT 
    status,
    LENGTH(status) as status_length,
    ASCII(SUBSTRING(status, 1, 1)) as first_char_ascii,
    COUNT(*) as count
FROM public.approved_bills
GROUP BY status, LENGTH(status)
ORDER BY count DESC;
