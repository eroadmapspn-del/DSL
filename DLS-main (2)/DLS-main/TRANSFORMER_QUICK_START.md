# Quick Start - Dual Route Excel Transformer

## 🚀 Quick Setup (2 minutes)

### 1. Update Credentials

Open `excel-to-csv-transformer.html`, find line 254-256, replace:

```javascript
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
```

### 2. Run SQL Migration

In Supabase SQL Editor:

```sql
ALTER TABLE public.edited_bills
ADD COLUMN IF NOT EXISTS bill_date DATE NULL;
```

### 3. Test

- Open `excel-to-csv-transformer.html` in browser
- Upload Excel file
- Watch magic happen! ✨

## 📊 What Happens

```
Excel File Upload
       ↓
  [Transformer]
       ↓
   ┌──────┴──────┐
   ↓             ↓
Status:        Status:
"Edited"       Others
   ↓             ↓
Database    CSV File
(edited_    (approved_
 bills)       bills)
```

## 💡 Status Mapping

| Excel Status | Destination | Final Status |
| ------------ | ----------- | ------------ |
| Edited       | Database    | N/A          |
| Delivered    | CSV         | approved     |
| Cancelled    | CSV         | cancelled    |
| Returned     | CSV         | returned     |

## 📈 Statistics Display

After processing, you'll see:

- **Total Records** - All bills processed
- **Edited Bills (DB)** - Inserted to database (yellow)
- **CSV Records** - Available for download (green)
- Payment method counts (Cash/Cheque/UPI/Credit/NEFT)

## ✅ Success Indicators

**With Supabase configured:**

```
✅ Successfully processed 100 records!
   (25 edited bills inserted to database, 75 in CSV)
```

**Without Supabase:**

```
⚠️ Warning: 25 edited bills found but Supabase not configured.
   They will be included in CSV.
```

## 🔍 Console Messages

Open browser DevTools (F12) → Console to see:

- ✅ Supabase client initialized
- 📝 First valid row details
- ✅ Inserted batch 1: 50 edited bills
- ✅ Successfully inserted all X edited bills

## ⚠️ Troubleshooting One-Liners

| Problem                               | Solution                                  |
| ------------------------------------- | ----------------------------------------- |
| "Supabase credentials not configured" | Update SUPABASE_URL and SUPABASE_ANON_KEY |
| Edited bills in CSV                   | Configure Supabase credentials            |
| "Error initializing Supabase"         | Check credentials are correct             |
| Some bills failed                     | Check console for specific errors         |
| No CSV to download                    | All bills were edited status              |

## 📝 Example Excel Row

| Status    | Bill Number | Bill Date  | Retailer Name | Net Amount |
| --------- | ----------- | ---------- | ------------- | ---------- |
| Edited    | LCBL-001    | 2024-11-01 | ABC Store     | 1000       |
| Delivered | LCBL-002    | 2024-11-01 | XYZ Shop      | 2000       |

**Result:**

- LCBL-001 → Inserted to `edited_bills` table
- LCBL-002 → Included in CSV download

## 🎯 Best Practices

1. **Always check console** after upload
2. **Verify statistics** match your expectations
3. **Test with small file** first (10-20 rows)
4. **Keep Supabase tab open** to verify insertions
5. **Download CSV immediately** after processing

## 🆘 Need Help?

Check the console first! Most issues show detailed error messages there.
