# BeautyBasket by DLS - Node.js + TypeScript Backend

High-performance, modular Node.js & TypeScript backend replacing Supabase and Google Sheets for BeautyBasket by DLS. Includes complete Authentication, Role-Based Access Control (RBAC), Admin Dashboard, Supply/Delivery workflows, UGRAI recovery, Cash Receipts, and Reporting APIs.

## 🚀 Features
- **TypeScript & Express**: Strictly typed, modular architecture with scalable service/controller pattern.
- **Full Authentication**: Email & password authentication with JWT sessions, secure bcrypt hashing, password reset, and role injection.
- **Comprehensive Admin Dashboard**:
  - **User Management**: Create users with roles, update profiles, toggle active/inactive status, delete users.
  - **Role Management**: System roles (`admin`, `supply_manager`, `ugrai_manager`, `accountant`, `viewer`) and dynamic custom role creation/deletion.
  - **Granular Permissions Matrix**: Real-time permission granting/revoking per role across all application sections.
  - **Assignees System**: Query and manage supply and ugrai assignees.
  - **Audit Logging**: Real-time admin activity tracking.
  - **Dashboard Analytics**: Real-time counts for active users, pending bills, ugrai items, and cash receipts.
- **Workflows & RPC Support**: All 25 database stored procedures / RPC functions for supply management, ugrai recovery, and financial analysis.
- **Zero-Downtime Database Architecture**:
  - Built-in In-Memory store with initial seed data so you can run and test immediately!
  - Ready for PostgreSQL / custom connector when you provide the database connection string and SQL file.
- **Frontend Drop-In Client**: Seamlessly connects with existing HTML/JS frontend without breaking changes.

---

## 🛠️ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
The server will start on `http://localhost:5000`.

### 3. Build for Production
```bash
npm run build
npm start
```

---

## 🔑 Default Admin Account
- **Email**: `admin@beautybasket.com`
- **Password**: `admin123`

---

## 📡 API Endpoints Overview

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Log in with email & password, returns JWT session & user |
| `POST` | `/api/auth/register` | Register new user |
| `GET` | `/api/auth/session` | Get current user session & permissions |
| `POST` | `/api/auth/logout` | Sign out |
| `POST` | `/api/auth/reset-password` | Generate/send temporary password |
| `POST` | `/api/auth/change-password` | Update user password |

### Admin Dashboard (`/api/admin`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List all users with their roles and status |
| `POST` | `/api/admin/users` | Create new user with profile & role assignment |
| `PUT` | `/api/admin/users/:id` | Update user profile (name, department, etc.) |
| `DELETE` | `/api/admin/users/:id` | Delete user |
| `PATCH` | `/api/admin/users/:id/status` | Toggle user active / inactive |
| `PUT` | `/api/admin/users/:id/role` | Update user assigned role |
| `GET` | `/api/admin/roles` | List all roles with user count & permissions |
| `POST` | `/api/admin/roles` | Create custom role |
| `DELETE` | `/api/admin/roles/:id` | Delete non-system role |
| `GET` | `/api/admin/permissions` | Get all available system permissions |
| `POST` | `/api/admin/roles/:roleId/permissions` | Grant permission to role |
| `DELETE` | `/api/admin/roles/:roleId/permissions/:perm` | Revoke permission from role |
| `GET` | `/api/admin/stats` | Admin dashboard statistics |
| `GET` | `/api/admin/users/by-role/:roleName` | Get assignees for supply/ugrai by role |
| `GET` | `/api/admin/audit-logs` | Get activity audit logs |

### Data & RPC (`/api`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/rpc/:functionName` | Execute stored procedures / RPC functions |
| `GET` | `/api/data/:table` | Query table rows with filters, ordering, pagination |
| `POST` | `/api/data/:table` | Insert table row(s) |
| `PATCH` | `/api/data/:table` | Update table row(s) |
| `DELETE` | `/api/data/:table` | Delete table row(s) |
| `POST` | `/api/batch` | Execute batch operations |

---

## 🗄️ Database Integration

When you are ready to provide your database connector and SQL file:
1. Open `.env` and set:
   ```env
   USE_DATABASE=true
   DATABASE_URL=postgresql://user:password@localhost:5432/dls_beautybasket
   ```
2. The SQL scripts are located in `sql/`:
   - `01_schema.sql` (Tables)
   - `02_roles_and_permissions.sql` (Roles & Permissions)
   - `03_rpc_functions.sql` (Stored Procedures)
3. To plug in a custom connector, see `src/db/connection.ts`.
