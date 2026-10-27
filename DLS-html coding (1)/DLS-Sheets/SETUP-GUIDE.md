# BeautyBasket by DLS – Google Sheets edition: setup guide

Your original project (Supabase) is untouched. This folder is a separate copy of the same
app whose database is a **Google Sheet**, with a small **Google Apps Script** acting as the server.
The website itself is static files hosted on **Netlify**.

```
Browser (Netlify site)  ──►  Apps Script web app  ──►  Google Sheet (data + logins)
                                      └────────────►  Google Drive folder "DLS Bill Photos"
```

## 1. Create the backend (about 10 minutes, once)

1. Open <https://sheets.new> and name the file e.g. **DLS Database**.
2. **Extensions ▸ Apps Script**. Delete the sample code, paste the whole of
   `apps-script/Code.gs`, and save.
3. *(Recommended)* Project Settings (gear) ▸ tick **Show "appsscript.json" manifest file**, then replace its
   contents with `apps-script/appsscript.json` (this pre-declares the permissions needed).
4. Pick the function **`setup`** in the toolbar and press **Run**. Accept the Google permission prompts
   ("Advanced ▸ Go to project (unsafe)" is normal for your own script).
5. Open **View ▸ Logs / Execution log** (or look at the pop-up in the sheet): it prints the
   **first admin e-mail and password – shown only once**. Write it down.
   The sheet now has one tab per table plus **Credentials**, **Roles** and **Permission Reference**.
6. **Deploy ▸ New deployment ▸ ⚙ ▸ Web app** → *Execute as*: **Me** → *Who has access*: **Anyone** → Deploy.
   Copy the **Web app URL** (ends in `/exec`).
   ("Anyone" only lets people reach the login door; every data call needs a valid login token.)

> After you change `Code.gs` later: **Deploy ▸ Manage deployments ▸ ✏ ▸ Version: New version ▸ Deploy**
> (the URL stays the same).

## 2. Put the website on Netlify

1. Open `config.js` and paste the Web app URL:
   `window.DLS_API_URL = 'https://script.google.com/macros/s/…/exec';`
   *(or, instead, add a Netlify environment variable `DLS_API_URL` – `build.js` writes config.js for you).*
2. Netlify ▸ **Add new site ▸ Deploy manually** and drag this whole folder in
   (or connect a Git repo; `netlify.toml` is already set up – no build settings needed).
3. Open the site → you land on the login page → log in with the admin e-mail/password from step 1.5.

## 3. Daily use

| Task | How |
|---|---|
| Add a user | Admin Dashboard ▸ **Add New User**, or in the sheet: **DLS Admin ▸ Add user…** |
| Give/change a password | Type it into the **password** cell of the user's row in *Credentials*. It is hashed and the cell is cleared automatically. (Or **DLS Admin ▸ Reset password of selected user row** – generates one.) |
| Change someone's role | Admin Dashboard ▸ Edit, or edit the **roles** cell (e.g. `supply_manager, accountant`) |
| Disable a login | Admin Dashboard ▸ Deactivate, or set **is_active** to FALSE |
| Create/edit roles & tab permissions | Admin Dashboard ▸ Role Management, or the **Roles** tab (**permissions** = comma list; see *Permission Reference* tab) |
| "Forgot password" on login page | E-mails a temporary password to the user (uses the owner's Gmail quota) |
| Look at / fix data directly | Every table is a normal tab. Row 1 = column names (don't rename). Editing by hand is safe; others see it within ~12 s |
| Photos | Stored in your Drive folder **DLS Bill Photos** (link-shareable, shown in the app) |

Passwords are never stored in readable form (salted, iterated SHA-256 hashes in `password_hash` / `password_salt`).
Never share the Credentials tab beyond the people who administer the system.

## 4. Migrating old data (optional)

1. In **Credentials**, set each person's `user_id` to their **old Supabase user id** (copy from Supabase ▸ Authentication)
   so that existing rows still belong to them. (The admin created by `setup()` can be changed the same way.)
2. Open `https://YOUR-SITE.netlify.app/tools/migrate-from-supabase.html`, enter the old project URL + anon key and an old
   admin login, plus the new admin login, press **Start**. It only reads Supabase and appends rows to the sheet.
3. Delete the `tools` folder from the site afterwards. Old photos keep their Supabase URLs.

## 5. Limits & tips

* Typical actions take 1–3 s (Apps Script is slower than a real database); big imports are sent in bulk to stay quick.
  Google caps a single script run at 6 minutes, far above what this app needs.
* Sheets hold up to 10 million cells. 20–30 thousand bills are fine; archive old years to another file if it ever gets sluggish.
* Writes are serialised with a lock, so two people saving at once is safe (one waits a moment).
* Changes by other people appear after the next poll (default 12 s; change `DLS_POLL_MS` in config.js).
* Don't insert/delete rows in the middle with formulas referencing them – the tabs are databases, keep them plain.
* Back up: **File ▸ Version history** in Sheets, or make a copy of the file regularly.
