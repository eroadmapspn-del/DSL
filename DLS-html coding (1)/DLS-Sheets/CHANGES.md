# What changed compared with the Supabase version

**Not changed:** all screens, flows, permissions, sortable headers, reports, Excel import/export, calculations.

| File | Change |
|---|---|
| `sheets-client.js` (new) | Browser shim that speaks the same API the app already uses (`supabase.from(...).select/insert/update/delete/upsert`, `.rpc()`, `auth`, `storage`, realtime) but talks to the Apps Script. Same-moment calls are batched into one request. |
| `config.js` (new) | Web-app URL + poll interval. |
| `apps-script/Code.gs` (new) | The server: table engine, login/roles, all SQL functions re-implemented (analysis, pending bills, payment history, cash receipts, ugrai flow, etc.), photo upload to Drive, versioned polling for live updates. |
| `login.html`, `supply.html`, `admin.html`, `excel-to-csv-transformer-ugrai.html` | Supabase CDN script replaced by `config.js` + `sheets-client.js`; project keys removed. Reset-password wording updated. |
| `supabase-service.js` | Keys removed. Several row-by-row loops (ugrai upsert, completed-ugrai bulk import, sector backfill/sync, dispatch→supplies, approved-ugrai lookups) now use bulk calls – same results, far fewer round trips. Added small helper methods used by the app (`getClient`, `updateBill`, `updateUgraiEntries`, …). Page size 10 000. |
| `scripts.js` | Keys removed; start-up loads run in parallel; guards for empty analysis data; realtime handlers also react to the polling "sync" event; header text now says Google Sheets Mode. |
| `netlify.toml`, `build.js`, `tools/migrate-from-supabase.html` (new) | Hosting + optional data copy. |

Behavioural differences you may notice
* Login is e-mail + password against the **Credentials** sheet (no Supabase Auth e-mails). "Forgot password" e-mails a temporary password.
* Live updates arrive by polling every ~12 s instead of websockets.
* Responses take 1–3 s per action (Google Apps Script speed).
* Photos live in Google Drive instead of Supabase Storage.
