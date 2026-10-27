# Database Schema & SQL Files for BeautyBasket by DLS

This directory contains the database structure, initial seed data, and stored procedures for the DLS Backend.

## Files
1. `01_schema.sql` - Complete PostgreSQL DDL for all 17 tables (retailers, bills, active_supplies, approved_bills, edited_bills, ugrai_*, cash_receipts, bill_photos, roles, user_profiles, user_roles, audit_logs).
2. `02_roles_and_permissions.sql` - Initial seed data for system roles (`admin`, `supply_manager`, `ugrai_manager`, `accountant`, `viewer`) and granular section permissions.
3. `03_rpc_functions.sql` - Stored procedures for RBAC, statistics, and analysis functions.

## When you are ready to connect your database:
1. Open `.env` in the backend root directory.
2. Set:
   ```env
   USE_DATABASE=true
   DATABASE_URL=postgresql://<username>:<password>@<host>:<port>/<database_name>
   ```
3. Run the SQL files in your database:
   ```bash
   psql -d <database_name> -f sql/01_schema.sql
   psql -d <database_name> -f sql/02_roles_and_permissions.sql
   psql -d <database_name> -f sql/03_rpc_functions.sql
   ```
4. If you have your own custom connector or SQL file, you can place it in this folder or replace `src/db/connection.ts`.
