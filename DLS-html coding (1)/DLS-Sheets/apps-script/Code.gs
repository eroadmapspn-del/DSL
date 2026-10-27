/**
 * ============================================================================
 *  BeautyBasket by DLS  –  Google Sheets backend  (Google Apps Script Web App)
 * ============================================================================
 *  This single file turns a Google Spreadsheet into the database + login
 *  server + photo storage for the DLS web app (hosted on Netlify).
 *
 *  HOW TO INSTALL (full guide in SETUP-GUIDE.md):
 *    1. Create a new Google Sheet.
 *    2. Extensions ▸ Apps Script ▸ delete the sample code ▸ paste this file.
 *    3. (Optional) Project Settings ▸ "Show appsscript.json" and paste the
 *       manifest from apps-script/appsscript.json.
 *    4. Run the function  setup()  once (▶) and accept the permissions.
 *       It creates every tab + the first admin login and shows you the
 *       password.
 *    5. Deploy ▸ New deployment ▸ type "Web app" ▸ Execute as: Me ▸
 *       Who has access: Anyone ▸ Deploy.  Copy the Web-app URL into
 *       config.js of the website.
 *
 *  SHEET TABS (all editable by hand, row 1 = column names – do not rename):
 *    Credentials  – logins: email, password, full_name, roles, is_active ...
 *    Roles        – role names and their permission lists
 *    <tables>     – retailers, bills, active_supplies, approved_bills, ...
 * ============================================================================
 */

var DLS_VERSION = '1.0.0';
var TOKEN_TTL_SEC = 12 * 60 * 60;          // login lasts 12 hours (auto-refreshed by the site)
var PW_ITERATIONS = 60;                    // password hashing rounds
var MAX_LOGIN_FAILS = 8;                   // per e-mail per 15 minutes
var PHOTO_FOLDER_NAME = 'DLS Bill Photos';

// ---------------------------------------------------------------------------
//  TABLE SCHEMA
//  column types:  t=text  i=integer  n=money(2 dp)  f=float  b=boolean
//                 d=date  ts=timestamp  j=json
//  id:  'serial' = 1,2,3...   'uuid' = random id
// ---------------------------------------------------------------------------
var NOW = '$now';
var TABLES = {
  retailers: {
    id: 'serial',
    cols: 'id:i,retailer_name:t,sector:t,user_id:t,created_at:ts,updated_at:ts',
    defaults: { user_id: 'default-user' },
    unique: [['retailer_name']]
  },
  bills: {
    id: 'serial',
    cols: 'id:i,bill_number:t,bill_date:d,retailer_name:t,net_amount:n,brand:t,sector:t,status:t,supply_through:t,user_id:t,created_at:ts,updated_at:ts',
    defaults: { status: 'staged', user_id: 'default-user' },
    unique: [['bill_number', 'user_id']]
  },
  active_supplies: {
    id: 'serial',
    cols: 'id:i,bill_id:i,bill_number:t,bill_date:d,retailer_name:t,sector:t,net_amount:n,brand:t,supply_through:t,status:t,payment_method:t,receipt_number:t,received_amount:n,cheque_date:d,photo_url:t,completion_date:ts,user_id:t,created_at:ts,updated_at:ts',
    defaults: { status: 'in_progress', user_id: 'default-user' },
    unique: [['bill_number', 'user_id', 'status']]
  },
  approved_bills: {
    id: 'serial',
    cols: 'id:i,original_bill_id:i,bill_number:t,bill_date:d,retailer_name:t,sector:t,net_amount:n,received_amount:n,brand:t,supply_through:t,payment_method:t,receipt_number:t,cheque_date:d,photo_url:t,status:t,approval_date:ts,user_id:t,created_at:ts',
    defaults: { user_id: 'default-user', approval_date: NOW }
  },
  edited_bills: {
    id: 'serial',
    cols: 'id:i,original_bill_id:i,bill_number:t,bill_date:d,original_amount:n,edited_amount:n,retailer_name:t,sector:t,brand:t,edit_reason:t,edited_date:ts,user_id:t',
    defaults: { user_id: 'default-user', edited_date: NOW }
  },
  ugrai_data: {
    id: 'uuid',
    cols: 'id:t,user_id:t,bill_number:t,bill_date:d,retailer_name:t,sector:t,net_amount:n,received_amount:n,status:t,assigned_to:t,current_stage:t,created_at:ts,updated_at:ts',
    defaults: { status: 'Pending', current_stage: 'available' },
    unique: [['user_id', 'bill_number']]
  },
  ugrai_entries: {
    id: 'uuid',
    cols: 'id:t,user_id:t,bill_number:t,bill_date:d,retailer_name:t,sector:t,net_amount:n,received_amount:n,status:t,assigned_to:t,original_supply_id:t,current_stage:t,created_at:ts,updated_at:ts',
    defaults: { status: 'Pending', current_stage: 'available', received_amount: 0 },
    unique: [['user_id', 'bill_number']]
  },
  ugrai_assignments: {
    id: 'uuid',
    cols: 'id:t,user_id:t,sector:t,assigned_to:t,created_at:ts,updated_at:ts',
    unique: [['user_id', 'sector']]
  },
  ugrai_in_progress: {
    id: 'uuid',
    cols: 'id:t,user_id:t,bill_number:t,bill_date:d,retailer_name:t,sector:t,net_amount:n,assigned_to:t,assigned_date:ts,source_table:t,source_id:t,created_at:ts,updated_at:ts',
    defaults: { assigned_date: NOW },
    unique: [['user_id', 'bill_number']]
  },
  ugrai_completed: {
    id: 'uuid',
    cols: 'id:t,user_id:t,bill_number:t,bill_date:d,retailer_name:t,sector:t,net_amount:n,assigned_to:t,payment_method:t,received_amount:n,receipt_number:t,cheque_date:d,payment_photo_url:t,completed_date:ts,source_table:t,source_id:t,in_progress_id:t,created_at:ts,updated_at:ts',
    defaults: { completed_date: NOW },
    unique: [['user_id', 'bill_number']]
  },
  completed_ugrai: {
    id: 'uuid',
    cols: 'id:t,user_id:t,bill_number:t,bill_date:d,retailer_name:t,sector:t,net_amount:n,status:t,assigned_to:t,payment_method:t,receipt_number:t,received_amount:n,cheque_date:d,photo_uploaded:b,photo_url:t,date_completed:d,completed_by:t,original_supply_id:t,source_table:t,source_id:t,created_at:ts,updated_at:ts',
    defaults: { status: 'Completed', photo_uploaded: false },
    unique: [['user_id', 'bill_number']]
  },
  approved_ugrai: {
    id: 'uuid',
    cols: 'id:t,user_id:t,bill_number:t,bill_date:d,retailer_name:t,sector:t,net_amount:n,status:t,assigned_to:t,payment_method:t,receipt_number:t,received_amount:n,cheque_date:d,photo_uploaded:b,photo_url:t,date_completed:d,date_approved:d,completed_by:t,approved_by:t,original_supply_id:t,created_at:ts,updated_at:ts',
    defaults: { status: 'Approved', photo_uploaded: false },
    unique: [['user_id', 'bill_number']]
  },
  ugrai_payment_history: {
    id: 'uuid',
    cols: 'id:t,user_id:t,bill_number:t,bill_date:d,retailer_name:t,sector:t,original_net_amount:n,payment_number:i,payment_date:d,payment_amount:n,outstanding_amount:n,payment_type:t,payment_method:t,receipt_number:t,cheque_date:d,photo_uploaded:b,photo_url:t,completed_by:t,approved_by:t,date_approved:d,source_bill_id:t,notes:t,created_at:ts,updated_at:ts',
    defaults: { photo_uploaded: false }
  },
  purchase_retailers: {
    id: 'uuid',
    cols: 'id:t,retailer_name:t,due_days:i,user_id:t,created_at:ts,updated_at:ts',
    defaults: { due_days: 0 },
    unique: [['retailer_name', 'user_id']]
  },
  purchase_entries: {
    id: 'uuid',
    cols: 'id:t,unique_id:t,bill_number:t,bill_date:d,retailer_name:t,taxable_amount:n,total_tax:n,deduction:n,net_amount:n,deduction_type:t,credit_note_number:t,credit_note_date:d,status:t,note:t,voucher_number:t,confirmed_at:ts,completed_at:ts,due_date:d,user_id:t,created_at:ts,updated_at:ts',
    defaults: { taxable_amount: 0, total_tax: 0, deduction: 0, net_amount: 0, status: 'Received' },
    unique: [['unique_id', 'user_id'], ['bill_number', 'user_id']]
  },
  bill_photos: {
    id: 'uuid',
    cols: 'id:t,bill_number:t,bill_type:t,photo_type:t,photo_url:t,photo_name:t,storage_path:t,file_size:i,file_type:t,uploaded_at:ts,uploaded_by:t,is_active:b,metadata:j',
    defaults: { photo_type: 'general', uploaded_at: NOW, is_active: true }
  },
  cash_receipts: {
    id: 'uuid',
    cols: 'id:t,user_id:t,payment_source:t,payment_reference_id:t,source_table:t,bill_number:t,bill_date:d,retailer_name:t,sector:t,payment_amount:n,payment_date:d,tally_receipt_number:t,status:t,processed_by:t,processed_date:ts,notes:t,created_at:ts,updated_at:ts',
    defaults: { status: 'pending' },
    unique: [['source_table', 'payment_reference_id']],
    uniqueUpper: [['tally_receipt_number']]
  },
  audit_logs: {
    id: 'uuid',
    cols: 'id:t,user_id:t,action:t,resource_type:t,resource_id:t,details:j,created_at:ts'
  }
};

// Sheets that hold the login system (not generic tables)
var SHEET_CREDENTIALS = 'Credentials';
var SHEET_ROLES = 'Roles';
var CRED_COLS = ['user_id', 'email', 'password', 'full_name', 'department', 'roles', 'is_active', 'last_login', 'created_at', 'password_hash', 'password_salt', 'notes'];
var ROLE_COLS = ['id', 'name', 'display_name', 'description', 'permissions', 'is_system_role', 'created_at', 'updated_at'];

// Every permission string used by the website
var ALL_PERMISSIONS = [
  'admin.dashboard.view', 'admin.users.create', 'admin.users.read', 'admin.users.update', 'admin.users.delete',
  'admin.roles.create', 'admin.roles.read', 'admin.roles.update', 'admin.roles.delete',
  'supply.base_file.view', 'supply.upload.view', 'supply.dispatch.view', 'supply.in_progress.view', 'supply.management.view',
  'ugrai.base_file.view', 'ugrai.total.view', 'ugrai.issue.view', 'ugrai.in_progress.view', 'ugrai.management.view',
  'purchase.base_file.view', 'purchase.entry.view', 'purchase.accounting.view', 'purchase.management.view', 'purchase.purchased.view',
  'analysis.supply.view', 'analysis.ugrai.view', 'analysis.purchase.view', 'analysis.pending_bills.view',
  'cash_receipt.view'
];

var DEFAULT_ROLES = [
  { name: 'admin', display_name: 'Administrator', description: 'Full system access including admin dashboard', permissions: ALL_PERMISSIONS },
  { name: 'supply_in_progress', display_name: 'Supply In Progress', description: 'View only supply in progress subsection', permissions: ['supply.in_progress.view'] },
  { name: 'ugrai_in_progress', display_name: 'Ugrai In Progress', description: 'View only ugrai in progress subsection', permissions: ['ugrai.in_progress.view'] },
  { name: 'accountant', display_name: 'Accountant', description: 'Access to accounting and purchase management', permissions: ['purchase.accounting.view', 'purchase.management.view', 'purchase.purchased.view', 'supply.management.view', 'ugrai.management.view', 'cash_receipt.view'] },
  { name: 'supply_manager', display_name: 'Supply Manager', description: 'Full access to all supply subsections', permissions: ['supply.base_file.view', 'supply.upload.view', 'supply.dispatch.view', 'supply.in_progress.view', 'supply.management.view'] },
  { name: 'ugrai_manager', display_name: 'Ugrai Manager', description: 'Full access to all ugrai subsections', permissions: ['ugrai.base_file.view', 'ugrai.total.view', 'ugrai.issue.view', 'ugrai.in_progress.view', 'ugrai.management.view'] },
  { name: 'viewer', display_name: 'Viewer', description: 'Limited read-only access', permissions: ['supply.in_progress.view', 'ugrai.in_progress.view', 'purchase.purchased.view'] }
];

// Foreign-key style embeds supported in .select('role_id, roles(name)')
var RELATIONS = {
  user_roles: { roles: { fk: 'role_id', table: 'roles' } }
};

// Tables that are views over other tables
var VIRTUAL = { user_profiles: true, user_roles: true, roles: true, approved_supplies: true };

// ---------------------------------------------------------------------------
//  Per-execution state (Apps Script starts a fresh JS context per request)
// ---------------------------------------------------------------------------
var RT = { ss: null, tables: {}, rbac: null, props: null, mutated: {} };

function resetRuntime_() { RT = { ss: null, tables: {}, rbac: null, props: null, mutated: {} }; }

function props_() { if (!RT.props) RT.props = PropertiesService.getScriptProperties(); return RT.props; }

function ss_() {
  if (RT.ss) return RT.ss;
  var id = props_().getProperty('SHEET_ID');
  if (id) { RT.ss = SpreadsheetApp.openById(id); }
  else { RT.ss = SpreadsheetApp.getActiveSpreadsheet(); if (RT.ss) props_().setProperty('SHEET_ID', RT.ss.getId()); }
  if (!RT.ss) throw dbErr_('Spreadsheet not found. Run setup() from the sheet-bound script.', 'GAS01');
  return RT.ss;
}

// ---------------------------------------------------------------------------
//  Small helpers
// ---------------------------------------------------------------------------
function dbErr_(message, code, details, hint, status) {
  var e = new Error(message);
  e.dls = { message: message, code: code || 'P0001', details: details || null, hint: hint || null, status: status || 400 };
  return e;
}

function isNil_(v) { return v === null || v === undefined; }
function nowIso_() { return new Date().toISOString(); }
function round2_(x) { return Math.round((Number(x) + 1e-9 * (x < 0 ? -1 : 1)) * 100) / 100; }
function uuid_() { return Utilities.getUuid(); }
function str_(v) { return isNil_(v) ? '' : String(v); }
function lower_(v) { return str_(v).toLowerCase(); }
function upperTrim_(v) { return str_(v).trim().toUpperCase(); }

function parseCols_(spec) {
  var names = [], types = {};
  spec.split(',').forEach(function (p) {
    var kv = p.split(':'); names.push(kv[0]); types[kv[0]] = kv[1];
  });
  return { names: names, types: types };
}

var SCHEMA_CACHE_ = {};
function schema_(name) {
  if (SCHEMA_CACHE_[name]) return SCHEMA_CACHE_[name];
  var t = TABLES[name];
  if (!t) return null;
  var c = parseCols_(t.cols);
  SCHEMA_CACHE_[name] = { name: name, id: t.id, names: c.names, types: c.types, defaults: t.defaults || {}, unique: t.unique || [], uniqueUpper: t.uniqueUpper || [] };
  return SCHEMA_CACHE_[name];
}

// ---- value conversion ------------------------------------------------------
function normDate_(v) {
  if (isNil_(v) || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw dbErr_('invalid input syntax for type date: "' + s + '"', '22007');
}

function normTs_(v) {
  if (isNil_(v) || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00.000Z';
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  throw dbErr_('invalid input syntax for type timestamp with time zone: "' + s + '"', '22007');
}

// JSON value from client -> value held in the in-memory row object
function coerceIn_(type, v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  switch (type) {
    case 'i': {
      if (v === '') return null;
      var n = Number(v);
      if (isNaN(n)) throw dbErr_('invalid input syntax for type integer: "' + v + '"', '22P02');
      return Math.trunc(n);
    }
    case 'n': {
      if (v === '') return null;
      var n2 = Number(v);
      if (isNaN(n2)) throw dbErr_('invalid input syntax for type numeric: "' + v + '"', '22P02');
      return round2_(n2);
    }
    case 'f': {
      if (v === '') return null;
      var n3 = Number(v);
      if (isNaN(n3)) throw dbErr_('invalid input syntax for type double precision: "' + v + '"', '22P02');
      return n3;
    }
    case 'b':
      if (v === true || v === false) return v;
      if (v === 'true' || v === 't' || v === 1 || v === '1') return true;
      if (v === 'false' || v === 'f' || v === 0 || v === '0') return false;
      if (v === '') return null;
      throw dbErr_('invalid input syntax for type boolean: "' + v + '"', '22P02');
    case 'd': return normDate_(v);
    case 'ts': return normTs_(v);
    case 'j': return (typeof v === 'string') ? tryJson_(v) : v;
    default:
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
  }
}

function tryJson_(s) { try { return JSON.parse(s); } catch (e) { return s; } }

// value in row object -> value written into a cell
function toCell_(type, v) {
  if (isNil_(v)) return '';
  switch (type) {
    case 'j': return typeof v === 'string' ? v : JSON.stringify(v);
    case 'b': return v === true || v === 'true';
    case 'i': case 'n': case 'f': return Number(v);
    default: return v;
  }
}

// cell value (from the sheet) -> value in row object
function fromCell_(type, c) {
  if (c === '' || isNil_(c)) return null;
  switch (type) {
    case 'i': { var n = Number(c); return isNaN(n) ? null : Math.trunc(n); }
    case 'n': { var m = Number(c); return isNaN(m) ? null : m; }
    case 'f': { var f = Number(c); return isNaN(f) ? null : f; }
    case 'b': return c === true || /^(true|t|1|yes)$/i.test(String(c));
    case 'd': try { return normDate_(c); } catch (e) { return String(c); }
    case 'ts': try { return normTs_(c); } catch (e2) { return String(c); }
    case 'j': return typeof c === 'string' ? tryJson_(c) : c;
    default:
      if (Object.prototype.toString.call(c) === '[object Date]') return c.toISOString();
      return String(c);
  }
}

function typeOfCol_(sch, col) { return (sch && sch.types[col]) || 't'; }

// ---------------------------------------------------------------------------
//  Extra system tables defined with the same schema format
// ---------------------------------------------------------------------------
TABLES.roles = {
  sheetName: SHEET_ROLES, id: 'uuid',
  cols: 'id:t,name:t,display_name:t,description:t,permissions:l,is_system_role:b,created_at:ts,updated_at:ts',
  defaults: { is_system_role: false }, unique: [['name']]
};
TABLES.credentials = {
  sheetName: SHEET_CREDENTIALS, id: null, internal: true,
  cols: 'user_id:t,email:t,password:t,full_name:t,department:t,roles:t,is_active:b,last_login:ts,created_at:ts,password_hash:t,password_salt:t,notes:t',
  defaults: { is_active: true }
};

// list type ('l'): array of strings stored as "a, b, c" in a cell
function parseList_(v) {
  if (isNil_(v) || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  var s = String(v).trim();
  if (s.charAt(0) === '[') { try { var a = JSON.parse(s); if (Array.isArray(a)) return a.map(String); } catch (e) {} }
  return s.split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}

// ---------------------------------------------------------------------------
//  Physical sheet table
// ---------------------------------------------------------------------------
var CACHED_SMALL_TABLES = { credentials: true, roles: true };

function Tbl(name) {
  this.name = name;
  this.sch = schema_(name);
  this.sheetName = (TABLES[name] && TABLES[name].sheetName) || name;
  this.rows = null;
  this.headers = null;
  this.dyn = {};
  this.virtual = false;
}

Tbl.prototype.typeOf = function (col) {
  var t = this.sch && this.sch.types[col];
  if (t) return t;
  return this.dyn[col] || 'auto';
};

Tbl.prototype.sheet = function () {
  var sh = ss_().getSheetByName(this.sheetName);
  if (!sh) sh = createDataSheet_(this.name);
  return sh;
};

Tbl.prototype.reset = function () { this.rows = null; };

function cellIn_(tbl, col, c) {
  var t = tbl.typeOf(col);
  if (t === 'auto') {
    if (c === '' || isNil_(c)) return null;
    if (Object.prototype.toString.call(c) === '[object Date]') return c.toISOString();
    return c;
  }
  if (t === 'l') return parseList_(c);
  return fromCell_(t, c);
}

function cellOut_(tbl, col, v) {
  var t = tbl.typeOf(col);
  if (t === 'l') return Array.isArray(v) ? v.join(', ') : (isNil_(v) ? '' : String(v));
  if (t === 'auto') {
    if (isNil_(v)) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }
  return toCell_(t, v);
}

Tbl.prototype.load = function () {
  if (this.rows) return this.rows;
  var cache = null, ck = 'tbl:' + this.name;
  if (CACHED_SMALL_TABLES[this.name]) {
    cache = CacheService.getScriptCache();
    var hit = cache.get(ck);
    if (hit) {
      try { var o = JSON.parse(hit); this.headers = o.h; this.rows = o.r; return this.rows; } catch (e) {}
    }
  }
  var sh = this.sheet();
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastCol < 1) { this.headers = []; this.rows = []; return this.rows; }
  var vals = sh.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  var headers = vals[0].map(function (h) { return String(h).trim(); });
  this.headers = headers;
  var rows = [];
  for (var r = 1; r < vals.length; r++) {
    var line = vals[r], blank = true, obj = {};
    for (var c = 0; c < headers.length; c++) {
      var h = headers[c];
      if (!h) continue;
      var cell = line[c];
      if (cell !== '' && !isNil_(cell)) blank = false;
      obj[h] = cellIn_(this, h, cell);
    }
    if (blank) continue;
    obj.__row = r + 1;
    rows.push(obj);
  }
  this.rows = rows;
  if (cache) {
    try {
      var js = JSON.stringify({ h: headers, r: rows });
      if (js.length < 90000) cache.put(ck, js, 120);
    } catch (e2) {}
  }
  return rows;
};

Tbl.prototype.ensureColumns = function (keys) {
  this.load();
  var sh = this.sheet(), added = false, self = this;
  keys.forEach(function (k) {
    if (k === '__row' || k.indexOf('__') === 0) return;
    if (self.headers.indexOf(k) < 0) {
      var colIdx = self.headers.length + 1;
      if (colIdx > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 5);
      sh.getRange(1, colIdx).setValue(k).setFontWeight('bold').setBackground('#e8eaed');
      var t = self.typeOf(k);
      if (t === 't' || t === 'd' || t === 'ts' || t === 'j' || t === 'l') sh.getRange(2, colIdx, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
      self.headers.push(k);
      added = true;
    }
  });
  return added;
};

function registerDyn_(tbl, obj) {
  Object.keys(obj).forEach(function (k) {
    if (k.indexOf('__') === 0) return;
    if (tbl.sch && tbl.sch.types[k]) return;
    if (tbl.dyn[k]) return;
    var v = obj[k];
    tbl.dyn[k] = (typeof v === 'number') ? 'f' : (typeof v === 'boolean') ? 'b' : 't';
  });
}

Tbl.prototype.rowToCells = function (obj) {
  var self = this;
  return this.headers.map(function (h) { return h ? cellOut_(self, h, obj[h]) : ''; });
};

Tbl.prototype.insertRows = function (objs) {
  if (!objs.length) return;
  var self = this;
  objs.forEach(function (o) { registerDyn_(self, o); });
  var keys = {};
  objs.forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
  this.ensureColumns(Object.keys(keys));
  var sh = this.sheet();
  var start = sh.getLastRow() + 1;
  if (start < 2) start = 2;
  var need = start + objs.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
  var data = objs.map(function (o) { return self.rowToCells(o); });
  sh.getRange(start, 1, data.length, this.headers.length).setValues(data);
  var r = start;
  objs.forEach(function (o) { o.__row = r++; });
  this.afterWrite();
};

Tbl.prototype.updateRows = function (objs) {
  if (!objs.length) return;
  var self = this;
  objs.forEach(function (o) { registerDyn_(self, o); });
  var keys = {};
  objs.forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
  this.ensureColumns(Object.keys(keys));
  var sh = this.sheet();
  var sorted = objs.slice().sort(function (a, b) { return a.__row - b.__row; });
  // contiguous runs
  var runs = [], cur = null;
  sorted.forEach(function (o) {
    if (cur && o.__row === cur.end + 1) { cur.items.push(o); cur.end = o.__row; }
    else { cur = { start: o.__row, end: o.__row, items: [o] }; runs.push(cur); }
  });
  var ncols = this.headers.length;
  if (runs.length <= 12) {
    runs.forEach(function (run) {
      var data = run.items.map(function (o) { return self.rowToCells(o); });
      sh.getRange(run.start, 1, data.length, ncols).setValues(data);
    });
  } else {
    // many scattered rows: rewrite the whole span in one call
    var minRow = sorted[0].__row, maxRow = sorted[sorted.length - 1].__row;
    var byRow = {};
    this.load().forEach(function (r) { byRow[r.__row] = r; });
    sorted.forEach(function (o) { byRow[o.__row] = o; });
    var span = [];
    for (var r = minRow; r <= maxRow; r++) span.push(byRow[r] ? self.rowToCells(byRow[r]) : self.headers.map(function () { return ''; }));
    sh.getRange(minRow, 1, span.length, ncols).setValues(span);
  }
  this.afterWrite();
};

Tbl.prototype.deleteRows = function (objs) {
  if (!objs.length) return;
  var sh = this.sheet(), self = this;
  var rowsToDel = objs.map(function (o) { return o.__row; }).sort(function (a, b) { return b - a; });
  if (rowsToDel.length <= 8) {
    rowsToDel.forEach(function (r) { sh.deleteRow(r); });
  } else {
    var gone = {};
    rowsToDel.forEach(function (r) { gone[r] = true; });
    var keep = this.load().filter(function (r) { return !gone[r.__row]; });
    var lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, this.headers.length).clearContent();
    if (keep.length) {
      var data = keep.map(function (o) { return self.rowToCells(o); });
      sh.getRange(2, 1, data.length, this.headers.length).setValues(data);
    }
  }
  this.afterWrite();
};

Tbl.prototype.afterWrite = function () {
  this.rows = null;
  RT.mutated[this.name] = true;
  if (CACHED_SMALL_TABLES[this.name]) {
    try { CacheService.getScriptCache().remove('tbl:' + this.name); } catch (e) {}
  }
};

// ---------------------------------------------------------------------------
//  Sheet creation
// ---------------------------------------------------------------------------
function createDataSheet_(name) {
  var ss = ss_();
  var t = TABLES[name];
  var sheetName = (t && t.sheetName) || name;
  var sh = ss.getSheetByName(sheetName);
  if (sh) return sh;
  sh = ss.insertSheet(sheetName);
  var sch = schema_(name);
  var names = sch ? sch.names : [];
  if (names.length) {
    sh.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight('bold').setBackground('#e8eaed');
    names.forEach(function (n, i) {
      var ty = sch.types[n];
      if (ty === 't' || ty === 'd' || ty === 'ts' || ty === 'j' || ty === 'l') sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------------------------------------------------------------------------
//  Table registry (physical + virtual)
// ---------------------------------------------------------------------------
function getTable_(name) {
  if (RT.tables[name]) return RT.tables[name];
  var t;
  if (name === 'user_profiles') t = new UserProfilesTbl();
  else if (name === 'user_roles') t = new UserRolesTbl();
  else if (name === 'approved_supplies') t = new ApprovedSuppliesTbl();
  else {
    t = new Tbl(name);
    if (!TABLES[name]) {
      // unknown table: allow only if a sheet with that name already exists
      var sh = ss_().getSheetByName(name);
      if (!sh) throw dbErr_('relation "public.' + name + '" does not exist', '42P01', null, null, 404);
    }
  }
  RT.tables[name] = t;
  return t;
}

// ---------------------------------------------------------------------------
//  Virtual table: approved_supplies  (read-only alias of approved_bills,
//  adds date_approved used by the "Today's bills" panel)
// ---------------------------------------------------------------------------
function ApprovedSuppliesTbl() {
  this.name = 'approved_supplies';
  this.base = getTable_('approved_bills');
  var b = this.base.sch;
  this.sch = { name: 'approved_supplies', id: 'serial', names: b.names.concat(['date_approved']), types: JSON.parse(JSON.stringify(b.types)), defaults: {}, unique: [], uniqueUpper: [] };
  this.sch.types.date_approved = 'ts';
  this.virtual = true; this.readOnly = true;
}
ApprovedSuppliesTbl.prototype.typeOf = function (c) { return this.sch.types[c] || 'auto'; };
ApprovedSuppliesTbl.prototype.load = function () {
  return this.base.load().map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; o.date_approved = r.approval_date; return o; });
};
ApprovedSuppliesTbl.prototype.insertRows = ApprovedSuppliesTbl.prototype.updateRows = ApprovedSuppliesTbl.prototype.deleteRows = function () {
  throw dbErr_('approved_supplies is read-only (use approved_bills)', '42809');
};
ApprovedSuppliesTbl.prototype.reset = function () { this.base.reset(); };

// ---------------------------------------------------------------------------
//  Virtual tables over the Credentials sheet: user_profiles + user_roles
// ---------------------------------------------------------------------------
function credTbl_() { return getTable_('credentials'); }
function rolesTbl_() { return getTable_('roles'); }

function UserProfilesTbl() {
  this.name = 'user_profiles';
  this.sch = parseSch_('user_profiles', 'id:t,user_id:t,full_name:t,email:t,department:t,is_active:b,last_login:ts,created_at:ts,updated_at:ts', { is_active: true }, [['user_id']]);
  this.virtual = true;
}
function parseSch_(name, spec, defaults, unique) {
  var c = parseCols_(spec);
  return { name: name, id: null, names: c.names, types: c.types, defaults: defaults || {}, unique: unique || [], uniqueUpper: [] };
}
UserProfilesTbl.prototype.typeOf = function (c) { return this.sch.types[c] || 'auto'; };
UserProfilesTbl.prototype.reset = function () { credTbl_().reset(); };
UserProfilesTbl.prototype.load = function () {
  return credTbl_().load().map(function (u) {
    return { id: u.user_id, user_id: u.user_id, full_name: u.full_name, email: u.email, department: u.department,
      is_active: u.is_active !== false, last_login: u.last_login, created_at: u.created_at, updated_at: u.created_at, __row: u.__row };
  });
};
UserProfilesTbl.prototype.insertRows = function (objs) {
  var ct = credTbl_(), users = ct.load();
  var toUpdate = [], toInsert = [];
  objs.forEach(function (o) {
    var existing = users.filter(function (u) { return (o.user_id && u.user_id === o.user_id) || (o.email && lower_(u.email) === lower_(o.email)); })[0];
    if (existing) {
      var copy = Object.assign({}, existing);
      ['full_name', 'email', 'department', 'is_active'].forEach(function (k) { if (!isNil_(o[k])) copy[k] = o[k]; });
      if (!copy.user_id && o.user_id) copy.user_id = o.user_id;
      toUpdate.push(copy);
      o.__row = existing.__row;
    } else {
      toInsert.push({ user_id: o.user_id || uuid_(), email: o.email, password: '', full_name: o.full_name || o.email, department: o.department || '',
        roles: '', is_active: o.is_active !== false, last_login: null, created_at: nowIso_() });
    }
  });
  if (toUpdate.length) ct.updateRows(toUpdate);
  if (toInsert.length) { ct.insertRows(toInsert); }
  rbacInvalidate_();
};
UserProfilesTbl.prototype.updateRows = function (objs) {
  var ct = credTbl_(), users = ct.load(), out = [];
  objs.forEach(function (o) {
    var u = users.filter(function (x) { return x.user_id === o.user_id; })[0];
    if (!u) return;
    var copy = Object.assign({}, u);
    ['full_name', 'email', 'department', 'is_active', 'last_login'].forEach(function (k) { if (o[k] !== undefined) copy[k] = o[k]; });
    out.push(copy);
  });
  if (out.length) ct.updateRows(out);
  rbacInvalidate_();
};
UserProfilesTbl.prototype.deleteRows = function (objs) {
  var ct = credTbl_(), users = ct.load();
  var del = [];
  objs.forEach(function (o) { var u = users.filter(function (x) { return x.user_id === o.user_id; })[0]; if (u) del.push(u); });
  if (del.length) ct.deleteRows(del);
  rbacInvalidate_();
};

function UserRolesTbl() {
  this.name = 'user_roles';
  this.sch = parseSch_('user_roles', 'id:t,user_id:t,role_id:t,assigned_by:t,assigned_at:ts', {}, [['user_id', 'role_id']]);
  this.virtual = true;
}
UserRolesTbl.prototype.typeOf = function (c) { return this.sch.types[c] || 'auto'; };
UserRolesTbl.prototype.reset = function () { credTbl_().reset(); rolesTbl_().reset(); };
UserRolesTbl.prototype.load = function () {
  var roles = rolesTbl_().load(), byName = {};
  roles.forEach(function (r) { byName[lower_(r.name)] = r; });
  var out = [];
  credTbl_().load().forEach(function (u) {
    parseList_(u.roles).forEach(function (rn) {
      var role = byName[lower_(rn)];
      if (!role) return;
      out.push({ id: u.user_id + ':' + role.id, user_id: u.user_id, role_id: role.id, assigned_by: null, assigned_at: u.created_at, __row: u.__row, __rolename: role.name });
    });
  });
  return out;
};
UserRolesTbl.prototype.insertRows = function (objs) {
  var ct = credTbl_(), users = ct.load(), roles = rolesTbl_().load();
  var changed = {};
  objs.forEach(function (o) {
    var u = users.filter(function (x) { return x.user_id === o.user_id; })[0];
    var role = roles.filter(function (r) { return r.id === o.role_id; })[0];
    if (!u) throw dbErr_('insert or update on table "user_roles" violates foreign key constraint "user_roles_user_id_fkey"', '23503', 'Key (user_id)=(' + o.user_id + ') is not present in table "users".');
    if (!role) throw dbErr_('insert or update on table "user_roles" violates foreign key constraint "user_roles_role_id_fkey"', '23503', 'Key (role_id)=(' + o.role_id + ') is not present in table "roles".');
    var list = parseList_(changed[u.user_id] ? changed[u.user_id].roles : u.roles);
    if (list.map(lower_).indexOf(lower_(role.name)) < 0) list.push(role.name);
    var copy = changed[u.user_id] || Object.assign({}, u);
    copy.roles = list.join(', ');
    changed[u.user_id] = copy;
    o.id = u.user_id + ':' + role.id;
  });
  var arr = Object.keys(changed).map(function (k) { return changed[k]; });
  if (arr.length) ct.updateRows(arr);
  rbacInvalidate_();
};
UserRolesTbl.prototype.updateRows = function (objs) {
  // changing role_id of an existing assignment
  var ct = credTbl_(), users = ct.load(), roles = rolesTbl_().load(), changed = {};
  objs.forEach(function (o) {
    var u = users.filter(function (x) { return x.user_id === o.user_id; })[0];
    var role = roles.filter(function (r) { return r.id === o.role_id; })[0];
    if (!u || !role) return;
    var copy = changed[u.user_id] || Object.assign({}, u);
    var list = parseList_(copy.roles).filter(function (n) { return lower_(n) !== lower_(o.__rolename); });
    if (list.map(lower_).indexOf(lower_(role.name)) < 0) list.push(role.name);
    copy.roles = list.join(', ');
    changed[u.user_id] = copy;
  });
  var arr = Object.keys(changed).map(function (k) { return changed[k]; });
  if (arr.length) ct.updateRows(arr);
  rbacInvalidate_();
};
UserRolesTbl.prototype.deleteRows = function (objs) {
  var ct = credTbl_(), users = ct.load(), changed = {};
  objs.forEach(function (o) {
    var u = users.filter(function (x) { return x.user_id === o.user_id; })[0];
    if (!u) return;
    var copy = changed[u.user_id] || Object.assign({}, u);
    copy.roles = parseList_(copy.roles).filter(function (n) { return lower_(n) !== lower_(o.__rolename); }).join(', ');
    changed[u.user_id] = copy;
  });
  var arr = Object.keys(changed).map(function (k) { return changed[k]; });
  if (arr.length) ct.updateRows(arr);
  rbacInvalidate_();
};

function rbacInvalidate_() {
  RT.rbac = null;
  try { CacheService.getScriptCache().remove('tbl:credentials'); CacheService.getScriptCache().remove('tbl:roles'); } catch (e) {}
}

// ===========================================================================
//  QUERY ENGINE  (PostgREST-compatible subset)
// ===========================================================================

function stripQuotes_(s) {
  s = String(s);
  if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') return s.slice(1, -1).replace(/\\"/g, '"');
  return s;
}

// split on commas that are not inside () or "..."
function splitTop_(s) {
  var out = [], depth = 0, inQ = false, cur = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '"' && s.charAt(i - 1) !== '\\') inQ = !inQ;
    if (!inQ) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---- filter value handling ---------------------------------------------------
function filterVal_(tbl, col, v) {
  if (isNil_(v)) return null;
  var t = tbl.typeOf(col);
  if (t === 'auto' || t === 'l') return v;
  try { return coerceIn_(t, v); } catch (e) { return v; }
}

function likeRe_(pat, ci) {
  var re = String(pat).replace(/[.*?+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp('^' + re + '$', ci ? 'i' : '');
}

// returns true/false (unknown -> false)
function evalCond_(tbl, row, f) {
  var col = f.c, op = f.o, a = row[col], v = f.v;
  if (col === '__rolename') a = row.__rolename;
  var res;
  switch (op) {
    case 'is': {
      var isNull = isNil_(a) || a === '';
      if (v === null || v === 'null' || v === undefined) res = isNull;
      else if (v === true || v === 'true') res = a === true;
      else if (v === false || v === 'false') res = a === false;
      else res = false;
      return f.n ? !res : res;
    }
    case 'in': {
      if (isNil_(a)) return false;
      var list = (Array.isArray(v) ? v : [v]).map(function (x) { return filterVal_(tbl, col, x); });
      res = list.some(function (x) { return looseEq_(a, x); });
      return f.n ? !res : res;
    }
    case 'like': case 'ilike': {
      if (isNil_(a)) return false;
      res = likeRe_(v, op === 'ilike').test(String(a));
      return f.n ? !res : res;
    }
    case 'contains': {
      if (isNil_(a)) return false;
      var arrA = Array.isArray(a) ? a : parseList_(a);
      var need = Array.isArray(v) ? v : [v];
      res = need.every(function (x) { return arrA.map(String).indexOf(String(x)) >= 0; });
      return f.n ? !res : res;
    }
    default: break;
  }
  if (isNil_(a) || isNil_(v)) return false; // SQL: comparisons with NULL are unknown
  var fv = filterVal_(tbl, col, v);
  var c;
  switch (op) {
    case 'eq': res = looseEq_(a, fv); break;
    case 'neq': res = !looseEq_(a, fv); break;
    case 'gt': c = cmpAny_(a, fv); res = c > 0; break;
    case 'gte': c = cmpAny_(a, fv); res = c >= 0; break;
    case 'lt': c = cmpAny_(a, fv); res = c < 0; break;
    case 'lte': c = cmpAny_(a, fv); res = c <= 0; break;
    default: throw dbErr_('unsupported filter operator "' + op + '"', 'PGRST100');
  }
  return f.n ? !res : res;
}

function looseEq_(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (typeof a === 'number' || typeof b === 'number') { var x = Number(a), y = Number(b); return !isNaN(x) && !isNaN(y) && Math.abs(x - y) < 1e-9; }
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  return String(a) === String(b);
}

function cmpAny_(a, b) {
  if (typeof a === 'number' || typeof b === 'number') { var x = Number(a), y = Number(b); return Math.abs(x - y) < 1e-9 ? 0 : (x < y ? -1 : 1); }
  if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  var s = String(a), t = String(b);
  return s < t ? -1 : (s > t ? 1 : 0);
}

// ---- "or=(a.eq.1,b.is.null)" / and(...) -------------------------------------
function parseLogic_(expr) {
  var s = String(expr).trim();
  if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') s = s.slice(1, -1);
  return splitTop_(s).map(function (item) {
    item = item.trim();
    var m = /^(not\.)?(and|or)\(([\s\S]*)\)$/.exec(item);
    if (m) return { o: m[2], children: parseLogic_(m[3]), n: !!m[1] };
    var parts = item.split('.');
    var col = parts.shift();
    var neg = false;
    if (parts[0] === 'not') { neg = true; parts.shift(); }
    var op = parts.shift();
    var val = parts.join('.');
    if (op === 'in') {
      var inner = val.replace(/^\(/, '').replace(/\)$/, '');
      val = splitTop_(inner).map(function (x) { return stripQuotes_(x.trim()); });
    } else if (op === 'is') {
      val = (val === 'null') ? null : (val === 'true' ? true : (val === 'false' ? false : val));
      if (val === null) val = 'null';
    } else {
      val = stripQuotes_(val);
      if (op === 'like' || op === 'ilike') val = val.replace(/\*/g, '%');
    }
    return { c: col, o: op, v: val, n: neg };
  });
}

function evalLogic_(tbl, row, node, mode) {
  // node: array of conditions combined by mode ('or'|'and')
  var list = Array.isArray(node) ? node : [node];
  var results = list.map(function (n) {
    if (n.children) {
      var r = evalLogic_(tbl, row, n.children, n.o);
      return n.n ? !r : r;
    }
    return evalCond_(tbl, row, n);
  });
  return mode === 'or' ? results.some(Boolean) : results.every(Boolean);
}

function compileFilters_(tbl, filters) {
  var conds = [];
  (filters || []).forEach(function (f) {
    if (f.o === 'or' || f.o === 'and') conds.push({ logic: parseLogic_(f.e), mode: f.o });
    else if (f.o === 'match') { Object.keys(f.v || {}).forEach(function (k) { conds.push({ c: k, o: 'eq', v: f.v[k], n: false }); }); }
    else conds.push({ c: f.c, o: f.o, v: f.v, n: !!f.n });
  });
  return conds;
}

function rowMatches_(tbl, row, conds) {
  for (var i = 0; i < conds.length; i++) {
    var c = conds[i];
    if (c.logic) { if (!evalLogic_(tbl, row, c.logic, c.mode)) return false; }
    else if (!evalCond_(tbl, row, c)) return false;
  }
  return true;
}

// ---- ordering ----------------------------------------------------------------
function sortRows_(tbl, rows, order) {
  if (!order || !order.length) return rows;
  var specs = order.map(function (o) {
    return { c: o.c, asc: o.asc !== false, nf: (o.nf === undefined || o.nf === null) ? (o.asc === false) : !!o.nf };
  });
  var idx = rows.map(function (r, i) { return { r: r, i: i }; });
  idx.sort(function (A, B) {
    for (var k = 0; k < specs.length; k++) {
      var s = specs[k], a = A.r[s.c], b = B.r[s.c];
      var an = isNil_(a) || a === '', bn = isNil_(b) || b === '';
      if (an && bn) continue;
      if (an) return s.nf ? -1 : 1;
      if (bn) return s.nf ? 1 : -1;
      var c;
      if (typeof a === 'number' && typeof b === 'number') c = a === b ? 0 : (a < b ? -1 : 1);
      else if (typeof a === 'boolean') c = (a ? 1 : 0) - (b ? 1 : 0);
      else {
        var sa = String(a), sb = String(b);
        var la = sa.toLowerCase(), lb = sb.toLowerCase();
        c = la < lb ? -1 : (la > lb ? 1 : (sa < sb ? -1 : (sa > sb ? 1 : 0)));
      }
      if (c !== 0) return s.asc ? c : -c;
    }
    return A.i - B.i;
  });
  return idx.map(function (x) { return x.r; });
}

// ---- select projection ---------------------------------------------------------
function parseSelect_(sel) {
  var out = { star: false, cols: [], embeds: [], count: false };
  var s = (sel === undefined || sel === null || sel === '') ? '*' : String(sel);
  splitTop_(s).forEach(function (raw) {
    var it = raw.trim();
    if (!it) return;
    if (it === '*') { out.star = true; return; }
    if (/^count\(\s*\*?\s*\)$/i.test(it)) { out.count = true; return; }
    var pi = it.indexOf('(');
    if (pi > 0) {
      var head = it.slice(0, pi), inner = it.slice(pi + 1, it.lastIndexOf(')'));
      var alias = null;
      if (head.indexOf(':') >= 0) { var ap = head.split(':'); alias = ap[0]; head = ap[1]; }
      head = head.replace(/!inner$/, '').replace(/!left$/, '').replace(/!.*$/, '').trim();
      out.embeds.push({ name: head, alias: alias || head, sub: parseSelect_(inner) });
      return;
    }
    var name = it.replace(/::\w+$/, ''), al = null;
    if (name.indexOf(':') >= 0) { var p = name.split(':'); al = p[0]; name = p[1]; }
    out.cols.push({ name: name.trim(), alias: (al || name).trim() });
  });
  return out;
}

function projectRows_(tableName, tbl, rows, sel) {
  var ps = (typeof sel === 'object' && sel && sel.cols) ? sel : parseSelect_(sel);
  var embedCache = {};
  var rels = RELATIONS[tableName] || {};
  ps.embeds.forEach(function (e) {
    var rel = rels[e.name];
    if (!rel) return;
    var tt = getTable_(rel.table), map = {};
    tt.load().forEach(function (r) { map[r.id] = r; });
    embedCache[e.name] = { rel: rel, map: map, tbl: tt };
  });
  var schNames = tbl.sch ? tbl.sch.names : [];
  return rows.map(function (r) {
    var o = {};
    if (ps.star) {
      schNames.forEach(function (n) { o[n] = isNil_(r[n]) ? null : r[n]; });
      Object.keys(r).forEach(function (k) { if (k.indexOf('__') !== 0 && !(k in o)) o[k] = isNil_(r[k]) ? null : r[k]; });
    }
    ps.cols.forEach(function (c) { o[c.alias] = isNil_(r[c.name]) ? null : r[c.name]; });
    ps.embeds.forEach(function (e) {
      var ec = embedCache[e.name];
      if (!ec) { o[e.alias] = null; return; }
      var target = ec.map[r[ec.rel.fk]];
      o[e.alias] = target ? projectRows_(ec.rel.table, ec.tbl, [target], e.sub)[0] : null;
    });
    return o;
  });
}

// ---- helpers for mutations -------------------------------------------------------
function applyDefault_(v) {
  if (v === NOW) return nowIso_();
  if (v && typeof v === 'object') return JSON.parse(JSON.stringify(v));
  return v;
}

function coerceRow_(tbl, vals) {
  var out = {};
  Object.keys(vals).forEach(function (k) {
    if (k.indexOf('__') === 0) return;
    var t = tbl.typeOf(k), v = vals[k];
    if (t === 'l') out[k] = isNil_(v) ? [] : parseList_(v);
    else if (t === 'auto') out[k] = (v && typeof v === 'object') ? JSON.stringify(v) : v;
    else out[k] = coerceIn_(t, v);
  });
  return out;
}

function uniqueKey_(sch, cols, row, upper) {
  var parts = [];
  for (var i = 0; i < cols.length; i++) {
    var v = row[cols[i]];
    if (isNil_(v) || v === '') return null; // NULLs are distinct
    parts.push(upper ? upperTrim_(v) : String(v));
  }
  return parts.join('\u0001');
}

function dupErr_(table, cols, row) {
  return dbErr_('duplicate key value violates unique constraint "' + table + '_' + cols.join('_') + '_key"', '23505',
    'Key (' + cols.join(', ') + ')=(' + cols.map(function (c) { return str_(row[c]); }).join(', ') + ') already exists.', null, 409);
}

function checkUnique_(tbl, newRows, existing, excludeRows) {
  var sch = tbl.sch;
  if (!sch) return;
  var groups = [];
  (sch.unique || []).forEach(function (u) { groups.push({ cols: u, upper: false }); });
  (sch.uniqueUpper || []).forEach(function (u) { groups.push({ cols: u, upper: true }); });
  if (!groups.length) return;
  var excl = {};
  (excludeRows || []).forEach(function (r) { excl[r.__row] = true; });
  groups.forEach(function (g) {
    var seen = {};
    existing.forEach(function (r) {
      if (r.__row !== undefined && excl[r.__row]) return;
      var k = uniqueKey_(sch, g.cols, r, g.upper);
      if (k !== null) seen[k] = true;
    });
    newRows.forEach(function (nr) {
      var k = uniqueKey_(sch, g.cols, nr, g.upper);
      if (k === null) return;
      if (seen[k]) throw dupErr_(tbl.name, g.cols, nr);
      seen[k] = true;
    });
  });
}

function nextSerial_(tbl, existing) {
  var max = 0;
  for (var i = 0; i < existing.length; i++) { var v = Number(existing[i].id); if (!isNaN(v) && v > max) max = v; }
  return max;
}

function buildNewRow_(tbl, vals, state) {
  var sch = tbl.sch, row = {};
  var d = sch.defaults || {};
  Object.keys(d).forEach(function (k) { row[k] = applyDefault_(d[k]); });
  var given = coerceRow_(tbl, vals);
  Object.keys(given).forEach(function (k) { if (given[k] !== undefined) row[k] = given[k]; });
  // PostgREST sends explicit nulls: a null overrides defaults only for nullable columns; we treat null as "use default" for NOT NULL style defaults
  Object.keys(d).forEach(function (k) {
    if (row[k] === null && vals[k] === null && (k === 'user_id' || k === 'status' || k === 'current_stage')) row[k] = applyDefault_(d[k]);
  });
  var now = nowIso_();
  if (sch.id === 'serial' && isNil_(row.id)) { state.maxId++; row.id = state.maxId; }
  else if (sch.id === 'serial') { var iv = Number(row.id); if (iv > state.maxId) state.maxId = iv; }
  if (sch.id === 'uuid' && isNil_(row.id)) row.id = uuid_();
  if (sch.names.indexOf('created_at') >= 0 && isNil_(row.created_at)) row.created_at = now;
  if (sch.names.indexOf('updated_at') >= 0 && isNil_(row.updated_at)) row.updated_at = now;
  return row;
}

function cleanOut_(rows) {
  return rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k.indexOf('__') !== 0) o[k] = r[k]; }); return o; });
}

// ---------------------------------------------------------------------------
//  Main entry for one query
// ---------------------------------------------------------------------------
function execQuery_(q) {
  var tableName = q.table;
  if (!tableName) throw dbErr_('table missing', 'PGRST100');
  if (TABLES[tableName] && TABLES[tableName].internal) throw dbErr_('permission denied for table ' + tableName, '42501', null, null, 403);
  var tbl = getTable_(tableName);
  var action = q.action || 'select';
  var conds = compileFilters_(tbl, q.filters);
  var result = { data: null, count: null };
  var wantRows = (action === 'select') || !!q.returning;
  var rows, matched;

  if (action === 'select') {
    var all = tbl.load();
    matched = conds.length ? all.filter(function (r) { return rowMatches_(tbl, r, conds); }) : all.slice();
    return finishSelect_(q, tableName, tbl, matched);
  }

  if (tbl.readOnly) throw dbErr_(tableName + ' is read-only', '42809');

  if (action === 'insert') {
    var vals = Array.isArray(q.values) ? q.values : [q.values];
    if (!vals.length) { result.data = wantRows ? [] : null; return finishMutation_(q, result, tableName, tbl, []); }
    var existing = tbl.load();
    var state = { maxId: tbl.sch.id === 'serial' ? nextSerial_(tbl, existing) : 0 };
    var newRows = vals.map(function (v) { return buildNewRow_(tbl, v || {}, state); });
    if (tableName !== 'user_profiles') checkUnique_(tbl, newRows, existing, []);
    tbl.insertRows(newRows);
    return finishMutation_(q, result, tableName, tbl, newRows);
  }

  if (action === 'update') {
    var all2 = tbl.load();
    matched = all2.filter(function (r) { return rowMatches_(tbl, r, conds); });
    if (!matched.length) return finishMutation_(q, result, tableName, tbl, []);
    var patch = coerceRow_(tbl, q.values || {});
    delete patch.id;
    var hasUpd = tbl.sch && tbl.sch.names.indexOf('updated_at') >= 0 && patch.updated_at === undefined && !tbl.virtual;
    var updated = matched.map(function (r) {
      var o = {};
      Object.keys(r).forEach(function (k) { o[k] = r[k]; });
      Object.keys(patch).forEach(function (k) { if (patch[k] !== undefined) o[k] = patch[k]; });
      if (hasUpd) o.updated_at = nowIso_();
      return o;
    });
    if (!tbl.virtual) {
      checkUnique_(tbl, updated, all2.filter(function (r) { return true; }), matched);
    }
    tbl.updateRows(updated);
    return finishMutation_(q, result, tableName, tbl, updated);
  }

  if (action === 'delete') {
    var all3 = tbl.load();
    matched = all3.filter(function (r) { return rowMatches_(tbl, r, conds); });
    if (matched.length) tbl.deleteRows(matched);
    return finishMutation_(q, result, tableName, tbl, matched);
  }

  if (action === 'upsert') {
    var uv = Array.isArray(q.values) ? q.values : [q.values];
    var existing2 = tbl.load();
    var conflict = q.onConflict ? String(q.onConflict).split(',').map(function (s) { return s.trim(); }) :
      ((tbl.sch.id && tbl.sch.names.indexOf('id') >= 0 && uv.length && uv[0] && uv[0].id !== undefined) ? ['id'] : (tbl.sch.unique[0] || ['id']));
    var state2 = { maxId: tbl.sch.id === 'serial' ? nextSerial_(tbl, existing2) : 0 };
    var index = {};
    existing2.forEach(function (r) { var k = uniqueKey_(tbl.sch, conflict, r, false); if (k !== null) index[k] = r; });
    var toInsert = [], toUpdate = [], touched = [], touchedKeys = {};
    uv.forEach(function (v) {
      v = v || {};
      var probe = coerceRow_(tbl, v);
      var k = uniqueKey_(tbl.sch, conflict, probe, false);
      var hit = (k !== null) ? (index[k] || null) : null;
      if (hit) {
        if (q.ignoreDuplicates) return;
        var o = {};
        Object.keys(hit).forEach(function (kk) { o[kk] = hit[kk]; });
        Object.keys(probe).forEach(function (kk) { if (probe[kk] !== undefined && kk !== 'id') o[kk] = probe[kk]; });
        if (tbl.sch.names.indexOf('updated_at') >= 0 && probe.updated_at === undefined) o.updated_at = nowIso_();
        // later duplicates within same batch update the same object
        if (touchedKeys[k]) { Object.keys(o).forEach(function (kk) { touchedKeys[k][kk] = o[kk]; }); return; }
        touchedKeys[k] = o;
        toUpdate.push(o); touched.push(o);
      } else {
        var nr = buildNewRow_(tbl, v, state2);
        if (k !== null) { if (touchedKeys[k]) { Object.keys(nr).forEach(function (kk) { if (kk !== 'id' && kk !== 'created_at') touchedKeys[k][kk] = nr[kk]; }); return; } touchedKeys[k] = nr; index[k] = nr; }
        toInsert.push(nr); touched.push(nr);
      }
    });
    if (toUpdate.length) {
      checkUnique_(tbl, toUpdate, existing2, toUpdate);
      tbl.updateRows(toUpdate);
    }
    if (toInsert.length) {
      var existing3 = toUpdate.length ? tbl.load() : existing2;
      checkUnique_(tbl, toInsert, existing3, []);
      tbl.insertRows(toInsert);
    }
    return finishMutation_(q, result, tableName, tbl, touched);
  }

  throw dbErr_('unknown action ' + action, 'PGRST100');
}

function finishSelect_(q, tableName, tbl, matched) {
  var ps = parseSelect_(q.columns);
  var total = matched.length;
  var result = { data: null, count: (q.count ? total : null) };
  if (ps.count && !ps.star && !ps.cols.length && !ps.embeds.length) {
    result.data = [{ count: total }];
    return result;
  }
  if (q.head) { result.data = null; return result; }
  var rows = sortRows_(tbl, matched, q.order);
  if (q.from !== undefined && q.from !== null) {
    var to = (q.to === undefined || q.to === null) ? rows.length - 1 : q.to;
    rows = rows.slice(q.from, to + 1);
  }
  if (q.limit !== undefined && q.limit !== null) rows = rows.slice(0, q.limit);
  var data = projectRows_(tableName, tbl, rows, ps);
  if (q.single) {
    if (data.length === 1) result.data = data[0];
    else if (data.length === 0 && q.single === 'maybe') result.data = null;
    else if (q.single === 'maybe' && data.length > 1) throw dbErr_('JSON object requested, multiple (or no) rows returned', 'PGRST116', 'The result contains ' + data.length + ' rows', null, 406);
    else throw dbErr_('JSON object requested, multiple (or no) rows returned', 'PGRST116', 'The result contains ' + data.length + ' rows', null, 406);
    return result;
  }
  result.data = data;
  return result;
}

function finishMutation_(q, result, tableName, tbl, rows) {
  if (q.returning) {
    var ps = parseSelect_(q.columns);
    var data = projectRows_(tableName, tbl, rows, ps);
    if (q.single) {
      if (data.length === 1) result.data = data[0];
      else if (data.length === 0 && q.single === 'maybe') result.data = null;
      else throw dbErr_('JSON object requested, multiple (or no) rows returned', 'PGRST116', 'The result contains ' + data.length + ' rows', null, 406);
    } else result.data = data;
  } else result.data = null;
  if (q.count) result.count = rows.length;
  return result;
}

// ===========================================================================
//  AUTHENTICATION  (e-mail + password kept in the Credentials sheet)
// ===========================================================================

function b64u_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function b64uStr_(s) { return b64u_(Utilities.newBlob(s).getBytes()); }
function b64uDecodeStr_(s) {
  var pad = s.length % 4 ? new Array(5 - (s.length % 4)).join('=') : '';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s + pad)).getDataAsString();
}

function secret_() {
  var p = props_(), s = p.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid(); p.setProperty('TOKEN_SECRET', s); }
  return s;
}

function signToken_(payload) {
  var body = b64uStr_(JSON.stringify(payload));
  var sig = b64u_(Utilities.computeHmacSha256Signature(body, secret_()));
  return body + '.' + sig;
}

function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function verifyToken_(tok) {
  if (!tok || typeof tok !== 'string') return null;
  var parts = tok.split('.');
  if (parts.length !== 2) return null;
  var expect = b64u_(Utilities.computeHmacSha256Signature(parts[0], secret_()));
  if (!safeEq_(expect, parts[1])) return null;
  var p;
  try { p = JSON.parse(b64uDecodeStr_(parts[0])); } catch (e) { return null; }
  if (!p || !p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
  return p;
}

function hashPw_(pw, salt) {
  var h = salt + '|' + pw;
  for (var i = 0; i < PW_ITERATIONS; i++) {
    h = b64u_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt + '|' + pw));
  }
  return h;
}

function genPassword_(len) {
  var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < (len || 10); i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function setPassword_(userRow, pw) {
  var salt = Utilities.getUuid().replace(/-/g, '');
  userRow.password_salt = salt;
  userRow.password_hash = hashPw_(pw, salt);
  userRow.password = '';
  return userRow;
}

// Fill in blanks typed by hand into Credentials / Roles (ids, plain passwords, dates)
function normalizeSheets_() {
  var ct = credTbl_(), users = ct.load(), changed = [];
  users.forEach(function (u) {
    var o = null;
    function touch() { if (!o) o = Object.assign({}, u); return o; }
    if (!u.user_id) touch().user_id = uuid_();
    if (!u.created_at) touch().created_at = nowIso_();
    if (u.email && u.email !== String(u.email).trim()) touch().email = String(u.email).trim();
    if (u.password !== null && u.password !== undefined && String(u.password) !== '') {
      setPassword_(touch(), String(u.password));
    }
    if (o) changed.push(o);
  });
  if (changed.length) { ct.updateRows(changed); rbacInvalidate_(); }
  var rt = rolesTbl_(), roles = rt.load(), rch = [];
  roles.forEach(function (r) {
    var o = null;
    function touch() { if (!o) o = Object.assign({}, r); return o; }
    if (!r.id) touch().id = uuid_();
    if (!r.created_at) touch().created_at = nowIso_();
    if (!r.display_name && r.name) touch().display_name = r.name;
    if (o) rch.push(o);
  });
  if (rch.length) { rt.updateRows(rch); rbacInvalidate_(); }
}

function findUserByEmail_(email) {
  var e = lower_(email).trim();
  if (!e) return null;
  var users = credTbl_().load();
  for (var i = 0; i < users.length; i++) if (lower_(users[i].email).trim() === e) return users[i];
  return null;
}

function findUserById_(id) {
  var users = credTbl_().load();
  for (var i = 0; i < users.length; i++) if (users[i].user_id === id) return users[i];
  return null;
}

function userObj_(u) {
  return {
    id: u.user_id, aud: 'authenticated', role: 'authenticated', email: u.email,
    created_at: u.created_at, app_metadata: { provider: 'email' },
    user_metadata: { full_name: u.full_name || '', department: u.department || '' }
  };
}

function sessionFor_(u) {
  var exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  var tok = signToken_({ uid: u.user_id, email: u.email, exp: exp, pv: String(u.password_hash || '').slice(0, 8) });
  return { access_token: tok, refresh_token: tok, token_type: 'bearer', expires_in: TOKEN_TTL_SEC, expires_at: exp, user: userObj_(u) };
}

function authErr_(msg, status, code) { return dbErr_(msg, code || 'AUTH', null, null, status || 400); }

function authSignIn_(email, password) {
  email = lower_(email).trim();
  if (!email || !password) throw authErr_('Email and password are required', 400, 'invalid_credentials');
  var cache = CacheService.getScriptCache(), fk = 'lf:' + email;
  var fails = Number(cache.get(fk) || 0);
  if (fails >= MAX_LOGIN_FAILS) throw authErr_('Too many failed attempts. Please wait 15 minutes and try again.', 429, 'over_request_rate_limit');
  normalizeSheets_();
  var u = findUserByEmail_(email);
  var ok = false;
  if (u && u.password_hash && u.password_salt) ok = safeEq_(hashPw_(String(password), u.password_salt), u.password_hash);
  if (!ok) {
    cache.put(fk, String(fails + 1), 900);
    throw authErr_('Invalid login credentials', 400, 'invalid_credentials');
  }
  if (u.is_active === false) throw authErr_('This account has been disabled. Contact the administrator.', 403, 'user_banned');
  cache.remove(fk);
  var upd = Object.assign({}, u);
  upd.last_login = nowIso_();
  credTbl_().updateRows([upd]);
  return { session: sessionFor_(u), user: userObj_(u) };
}

// returns credential row of the signed-in caller or throws 401
function authUser_(token) {
  var p = verifyToken_(token);
  if (!p) throw authErr_('Invalid or expired session. Please log in again.', 401, 'bad_jwt');
  var u = findUserById_(p.uid);
  if (!u || u.is_active === false) throw authErr_('Account not found or disabled.', 401, 'bad_jwt');
  if (String(u.password_hash || '').slice(0, 8) !== (p.pv || '')) throw authErr_('Password changed. Please log in again.', 401, 'bad_jwt');
  return u;
}

function authRefresh_(token) {
  var u = authUser_(token);
  return { session: sessionFor_(u), user: userObj_(u) };
}

function authSignUp_(caller, a) {
  requireAdmin_(caller);
  var email = lower_(a.email).trim();
  if (!email) throw authErr_('Email is required', 400, 'validation_failed');
  if (findUserByEmail_(email)) throw authErr_('User already registered', 422, 'user_already_exists');
  var pw = a.password ? String(a.password) : genPassword_(10);
  if (pw.length < 6) throw authErr_('Password should be at least 6 characters', 422, 'weak_password');
  var md = (a.options && a.options.data) || {};
  var row = { user_id: uuid_(), email: email, password: '', full_name: md.full_name || email, department: md.department || '', roles: '', is_active: true, last_login: null, created_at: nowIso_() };
  setPassword_(row, pw);
  credTbl_().insertRows([row]);
  rbacInvalidate_();
  return { user: userObj_(row), session: null };
}

function authUpdateSelf_(caller, a) {
  var row = Object.assign({}, caller);
  if (a.password) {
    if (String(a.password).length < 6) throw authErr_('Password should be at least 6 characters', 422, 'weak_password');
    setPassword_(row, String(a.password));
  }
  if (a.data && a.data.full_name) row.full_name = a.data.full_name;
  credTbl_().updateRows([row]);
  rbacInvalidate_();
  return { user: userObj_(row), session: a.password ? sessionFor_(row) : null };
}

function authReset_(email) {
  email = lower_(email).trim();
  var cache = CacheService.getScriptCache(), rk = 'rs:' + email;
  if (cache.get(rk)) return { ok: true };
  cache.put(rk, '1', 120);
  var u = findUserByEmail_(email);
  if (!u || u.is_active === false) return { ok: true }; // do not reveal whether the account exists
  var tmp = genPassword_(10), row = Object.assign({}, u);
  setPassword_(row, tmp);
  credTbl_().updateRows([row]);
  rbacInvalidate_();
  try {
    MailApp.sendEmail({
      to: u.email,
      subject: 'BeautyBasket by DLS – your temporary password',
      htmlBody: '<p>Hello ' + (u.full_name || '') + ',</p><p>A password reset was requested for your DLS account.</p>' +
        '<p>Your temporary password is: <b>' + tmp + '</b></p><p>Please sign in with it. Ask the administrator if you want a different password.</p>'
    });
  } catch (e) { /* mail quota or scope problem: administrator can set the password in the Credentials sheet */ }
  return { ok: true };
}

// ===========================================================================
//  RBAC  (roles + permissions from the Credentials / Roles sheets)
// ===========================================================================
function getRbac_() {
  if (RT.rbac) return RT.rbac;
  var roles = rolesTbl_().load(), byName = {}, byId = {};
  roles.forEach(function (r) { byName[lower_(r.name)] = r; byId[r.id] = r; });
  var users = {};
  credTbl_().load().forEach(function (u) {
    var rl = [], perms = {};
    parseList_(u.roles).forEach(function (rn) {
      var r = byName[lower_(rn)];
      if (!r) return;
      rl.push({ role_name: r.name, display_name: r.display_name || r.name, permissions: parseList_(r.permissions), role_id: r.id });
      parseList_(r.permissions).forEach(function (p) { perms[p] = true; });
    });
    users[u.user_id] = { roles: rl, perms: Object.keys(perms).sort(), isAdmin: rl.some(function (x) { return lower_(x.role_name) === 'admin'; }) };
  });
  RT.rbac = { users: users, roles: roles };
  return RT.rbac;
}

function isAdmin_(uid) { var u = getRbac_().users[uid]; return !!(u && u.isAdmin); }
function requireAdmin_(caller) {
  if (!caller || !isAdmin_(caller.user_id)) throw dbErr_('Administrator access required', '42501', null, null, 403);
}

// who may touch what through the generic table API
function authorizeQuery_(q, caller) {
  var t = q.table, a = q.action || 'select';
  if (t === 'roles' || t === 'user_roles') {
    if (a !== 'select') requireAdmin_(caller);
    return;
  }
  if (t === 'user_profiles') {
    if (a === 'select') return;
    if (a === 'update' && !isAdmin_(caller.user_id)) {
      var onlySelf = (q.filters || []).some(function (f) { return f.o === 'eq' && f.c === 'user_id' && f.v === caller.user_id; });
      if (!onlySelf) throw dbErr_('Insufficient permissions to update user profile', '42501', null, null, 403);
      // a non-admin may not (de)activate themselves
      if (q.values && 'is_active' in q.values) delete q.values.is_active;
      return;
    }
    requireAdmin_(caller);
  }
}

// ===========================================================================
//  RPC  (re-implementation of the Postgres functions used by the website)
// ===========================================================================
var RPC = {};

function rows_(name) { return getTable_(name).load(); }

function sumN_(arr, fn) {
  var s = 0, any = false;
  for (var i = 0; i < arr.length; i++) { var v = fn(arr[i]); if (v !== null && v !== undefined && v !== '' && !isNaN(Number(v))) { s += Number(v); any = true; } }
  return any ? round2_(s) : null;
}

function cmpNullsLast_(a, b) {
  var an = isNil_(a), bn = isNil_(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
}

function groupBy_(rows, keyFns) {
  var map = {}, order = [];
  rows.forEach(function (r) {
    var keys = keyFns.map(function (f) { return f(r); });
    var k = JSON.stringify(keys);
    if (!map[k]) { map[k] = { keys: keys, rows: [] }; order.push(k); }
    map[k].rows.push(r);
  });
  return order.map(function (k) { return map[k]; });
}

// ---- analysis --------------------------------------------------------------
RPC.get_supply_analysis_summary = function () {
  var g = groupBy_(rows_('approved_bills'), [function (r) { return r.status; }, function (r) { return r.payment_method; }]);
  g.sort(function (a, b) { return cmpNullsLast_(a.keys[0], b.keys[0]) || cmpNullsLast_(a.keys[1], b.keys[1]); });
  return g.map(function (x) {
    return {
      status: x.keys[0], payment_method: x.keys[1], total_bills: x.rows.length,
      total_amount: sumN_(x.rows, function (r) {
        if (['cancelled', 'returned', 'edited'].indexOf(r.status) >= 0) return r.net_amount;
        if (r.payment_method === 'Credit') return r.net_amount;
        return r.received_amount;
      })
    };
  });
};

RPC.get_ugrai_analysis_summary = function () {
  var g = groupBy_(rows_('approved_ugrai'), [function (r) { return r.payment_method; }]);
  g.sort(function (a, b) { return cmpNullsLast_(a.keys[0], b.keys[0]); });
  return g.map(function (x) { return { payment_method: x.keys[0], total_bills: x.rows.length, total_net_amount: sumN_(x.rows, function (r) { return r.net_amount; }) }; });
};

// ---- pending bills -----------------------------------------------------------
function pendingCombined_() {
  var comp = {}, appr = {};
  rows_('completed_ugrai').forEach(function (r) { comp[str_(r.bill_number)] = true; });
  rows_('approved_ugrai').forEach(function (r) { appr[str_(r.bill_number)] = true; });
  var out = [];
  ['ugrai_data', 'ugrai_entries'].forEach(function (t) {
    rows_(t).forEach(function (r) {
      if (!(Number(r.net_amount) > 0.01)) return;
      if (comp[str_(r.bill_number)] || appr[str_(r.bill_number)]) return;
      out.push({ src: t, r: r });
    });
  });
  return out;
}

RPC.get_pending_bills_summary = function () {
  var list = pendingCombined_();
  return ['ugrai_data', 'ugrai_entries'].map(function (t) {
    var sub = list.filter(function (x) { return x.src === t; });
    return { source_table: t, total_bills: sub.length, total_amount: sumN_(sub, function (x) { return x.r.net_amount; }) };
  });
};

RPC.get_pending_bills_by_sector = function () {
  var g = groupBy_(pendingCombined_(), [function (x) { return x.r.sector; }]);
  var out = g.map(function (x) { return { sector: isNil_(x.keys[0]) ? 'Unknown' : x.keys[0], total_bills: x.rows.length, total_amount: sumN_(x.rows, function (y) { return y.r.net_amount; }) }; });
  return stableSortDesc_(out, 'total_bills');
};

RPC.get_pending_bills_by_person = function () {
  var assign = {};
  rows_('ugrai_assignments').forEach(function (a) { assign[str_(a.user_id) + '\u0001' + str_(a.sector)] = a.assigned_to; });
  var g = groupBy_(pendingCombined_(), [function (x) { var v = assign[str_(x.r.user_id) + '\u0001' + str_(x.r.sector)]; return isNil_(v) ? null : v; }]);
  var out = g.map(function (x) { return { assigned_to: isNil_(x.keys[0]) ? 'Unassigned' : x.keys[0], total_bills: x.rows.length, total_amount: sumN_(x.rows, function (y) { return y.r.net_amount; }) }; });
  return stableSortDesc_(out, 'total_bills');
};

function stableSortDesc_(arr, key) {
  return arr.map(function (v, i) { return { v: v, i: i }; }).sort(function (a, b) { return (b.v[key] - a.v[key]) || (a.i - b.i); }).map(function (x) { return x.v; });
}

RPC.get_pending_bills_detailed = function () {
  var excl = {};
  rows_('completed_ugrai').forEach(function (r) { excl[upperTrim_(r.bill_number)] = true; });
  rows_('approved_ugrai').forEach(function (r) { excl[upperTrim_(r.bill_number)] = true; });
  var pay = {};
  rows_('ugrai_payment_history').forEach(function (r) { var k = upperTrim_(r.bill_number); pay[k] = (pay[k] || 0) + (Number(r.payment_amount) || 0); });
  var out = [];
  ['ugrai_data', 'ugrai_entries'].forEach(function (t) {
    rows_(t).forEach(function (r) {
      var k = upperTrim_(r.bill_number);
      if (excl[k]) return;
      var net = Number(r.net_amount);
      if (!(net > 0.01)) return;
      var recv = Number(r.received_amount) || 0, ph = pay[k] || 0;
      var tot = Math.max(recv, ph);
      out.push({
        id: r.id, bill_number: r.bill_number, bill_date: r.bill_date, retailer_name: r.retailer_name, sector: r.sector,
        net_amount: net, bill_received_amount: recv, payment_history_received: round2_(ph), total_received: round2_(tot),
        due_amount: round2_(net - tot), source_table: t, assigned_to: isNil_(r.assigned_to) ? null : r.assigned_to,
        current_stage: isNil_(r.current_stage) ? null : r.current_stage
      });
    });
  });
  // ORDER BY bill_date DESC  (NULLs first, like Postgres)
  return out.map(function (v, i) { return { v: v, i: i }; }).sort(function (a, b) {
    var x = a.v.bill_date, y = b.v.bill_date;
    if (isNil_(x) && isNil_(y)) return a.i - b.i;
    if (isNil_(x)) return -1;
    if (isNil_(y)) return 1;
    return x < y ? 1 : (x > y ? -1 : a.i - b.i);
  }).map(function (x) { return x.v; });
};

RPC.get_payment_history_summary = function () {
  var g = groupBy_(rows_('ugrai_payment_history'), [function (r) { return r.payment_method; }, function (r) { return r.payment_type; }]);
  g.sort(function (a, b) { return cmpNullsLast_(a.keys[0], b.keys[0]) || cmpNullsLast_(a.keys[1], b.keys[1]); });
  return g.map(function (x) {
    return { payment_method: x.keys[0], payment_type: x.keys[1], total_payments: x.rows.length,
      total_amount_collected: sumN_(x.rows, function (r) { return r.payment_amount; }), total_outstanding: sumN_(x.rows, function (r) { return r.outstanding_amount; }) };
  });
};

RPC.get_payment_history_by_method = function () {
  var g = groupBy_(rows_('ugrai_payment_history'), [function (r) { return r.payment_method; }]);
  g.sort(function (a, b) { return cmpNullsLast_(a.keys[0], b.keys[0]); });
  return g.map(function (x) { return { payment_method: x.keys[0], total_payments: x.rows.length, total_amount_collected: sumN_(x.rows, function (r) { return r.payment_amount; }) }; });
};

// ---- payment numbers / history -------------------------------------------------
RPC.get_next_payment_number = function (a) {
  var bn = a.p_bill_number, max = 0;
  rows_('ugrai_payment_history').forEach(function (r) { if (str_(r.bill_number) === str_(bn) && Number(r.payment_number) > max) max = Number(r.payment_number); });
  return max + 1;
};

RPC.get_ugrai_payment_history = function (a) {
  var out = rows_('ugrai_payment_history').filter(function (r) { return str_(r.user_id) === str_(a.p_user_id) && str_(r.bill_number) === str_(a.p_bill_number); });
  out.sort(function (x, y) { return (Number(x.payment_number) || 0) - (Number(y.payment_number) || 0); });
  return out.map(function (h) {
    return { payment_number: h.payment_number, payment_date: h.payment_date, payment_amount: h.payment_amount, outstanding_amount: h.outstanding_amount,
      payment_type: h.payment_type, payment_method: h.payment_method, receipt_number: h.receipt_number, completed_by: h.completed_by,
      approved_by: h.approved_by, date_approved: h.date_approved };
  });
};

// ---- UGRAI flow ---------------------------------------------------------------------
RPC.move_ugrai_to_in_progress = function (a) {
  var src = a.p_source_table;
  if (src !== 'ugrai_data' && src !== 'ugrai_entries') throw dbErr_('Invalid source table: ' + src, 'P0001');
  var ids = {};
  (a.p_source_ids || []).forEach(function (i) { ids[String(i)] = true; });
  var vals = [], moved = 0;
  rows_(src).forEach(function (r) {
    if (str_(r.user_id) !== str_(a.p_user_id) || !ids[String(r.id)]) return;
    var stage = r.current_stage;
    if (!(isNil_(stage) || stage === '' || stage === 'available')) return;
    moved++;
    vals.push({ user_id: a.p_user_id, bill_number: r.bill_number, bill_date: r.bill_date, retailer_name: r.retailer_name, sector: r.sector,
      net_amount: r.net_amount, assigned_to: a.p_assigned_to, source_table: src, source_id: r.id });
  });
  if (vals.length) execQuery_({ table: 'ugrai_in_progress', action: 'upsert', values: vals, onConflict: 'user_id,bill_number', ignoreDuplicates: true });
  return [{ moved_count: moved }];
};

RPC.complete_ugrai_bill = function (a) {
  var ip = rows_('ugrai_in_progress').filter(function (r) { return str_(r.user_id) === str_(a.p_user_id) && str_(r.bill_number) === str_(a.p_bill_number); })[0];
  if (!ip) throw dbErr_('Bill ' + a.p_bill_number + ' not found in progress', 'P0001');
  var ins = execQuery_({ table: 'ugrai_completed', action: 'insert', returning: true, columns: 'id', values: {
    user_id: a.p_user_id, bill_number: ip.bill_number, bill_date: ip.bill_date, retailer_name: ip.retailer_name, sector: ip.sector, net_amount: ip.net_amount,
    assigned_to: ip.assigned_to, payment_method: a.p_payment_method, received_amount: a.p_received_amount, receipt_number: a.p_receipt_number || null,
    cheque_date: a.p_cheque_date || null, payment_photo_url: a.p_payment_photo_url || null, source_table: ip.source_table, source_id: ip.source_id, in_progress_id: ip.id } });
  execQuery_({ table: 'ugrai_in_progress', action: 'delete', filters: [{ c: 'user_id', o: 'eq', v: a.p_user_id }, { c: 'bill_number', o: 'eq', v: a.p_bill_number }] });
  if (ip.source_table && ip.source_id) execQuery_({ table: ip.source_table, action: 'delete', filters: [{ c: 'user_id', o: 'eq', v: a.p_user_id }, { c: 'id', o: 'eq', v: ip.source_id }] });
  return [{ completed_id: ins.data[0].id }];
};

RPC.approve_ugrai_bills = function (a) {
  var want = {};
  (a.p_bill_numbers || []).forEach(function (b) { want[str_(b)] = true; });
  var n = 0;
  rows_('ugrai_completed').forEach(function (r) {
    if (str_(r.user_id) !== str_(a.p_user_id) || !want[str_(r.bill_number)]) return;
    if (r.source_table && r.source_id) execQuery_({ table: r.source_table, action: 'delete', filters: [{ c: 'user_id', o: 'eq', v: a.p_user_id }, { c: 'id', o: 'eq', v: r.source_id }] });
    execQuery_({ table: 'ugrai_completed', action: 'update', values: { updated_at: nowIso_() }, filters: [{ c: 'user_id', o: 'eq', v: a.p_user_id }, { c: 'id', o: 'eq', v: r.id }] });
    n++;
  });
  return [{ approved_count: n }];
};

// ---- supply ------------------------------------------------------------------------------
RPC.revert_delivered_supply_to_in_progress = function (a) {
  var bn = str_(a.p_bill_number);
  var list = rows_('active_supplies').filter(function (r) { return str_(r.bill_number) === bn; });
  if (!list.length) return [{ success: false, message: 'Bill not found in active supplies: ' + bn, reverted_bill_id: null }];
  var row = list.filter(function (r) { return lower_(r.status) === 'delivered'; })[0];
  if (!row) return [{ success: false, message: 'Bill is not in Delivered status. Current status: ' + list[0].status, reverted_bill_id: list[0].id }];
  execQuery_({ table: 'active_supplies', action: 'update', filters: [{ c: 'id', o: 'eq', v: row.id }],
    values: { status: 'in_progress', completion_date: null, payment_method: null, receipt_number: null, received_amount: null, cheque_date: null, updated_at: nowIso_() } });
  return [{ success: true, message: 'Bill ' + bn + ' reverted to in_progress successfully', reverted_bill_id: row.id }];
};

// ---- cash receipts ----------------------------------------------------------------------------
RPC.get_all_cash_payments = function (a) {
  var s = a.p_start_date ? String(a.p_start_date).slice(0, 10) + 'T00:00:00.000Z' : null;
  var e = a.p_end_date ? String(a.p_end_date).slice(0, 10) + 'T00:00:00.000Z' : null;
  var sd = a.p_start_date ? String(a.p_start_date).slice(0, 10) : null;
  var ed = a.p_end_date ? String(a.p_end_date).slice(0, 10) : null;
  var crs = rows_('cash_receipts'), byAb = {}, byPh = {}, abIds = {}, phIds = {};
  crs.forEach(function (c) {
    if (c.source_table === 'approved_bills') byAb[str_(c.payment_reference_id)] = c;
    if (c.source_table === 'ugrai_payment_history') byPh[str_(c.payment_reference_id)] = c;
  });
  var out = [];
  rows_('approved_bills').forEach(function (ab) {
    abIds[str_(ab.id)] = true;
    if (ab.payment_method !== 'Cash' || !(Number(ab.received_amount) > 0)) return;
    var ts = ab.approval_date;
    if (s && !(ts && ts >= s)) return;
    if (e && !(ts && ts <= e)) return;
    var cr = byAb[str_(ab.id)];
    out.push({ id: str_(ab.id), source: 'supply', bill_number: ab.bill_number, bill_date: ab.bill_date, retailer_name: ab.retailer_name, sector: ab.sector,
      payment_amount: ab.received_amount, payment_date: ts ? String(ts).slice(0, 10) : null, tally_receipt_number: cr ? cr.tally_receipt_number : null,
      status: cr && cr.status ? cr.status : 'pending', processed_by: cr ? cr.processed_by : null, processed_date: cr ? cr.processed_date : null });
  });
  rows_('ugrai_payment_history').forEach(function (u) {
    phIds[str_(u.id)] = true;
    if (u.payment_method !== 'Cash') return;
    if (sd && !(u.payment_date && u.payment_date >= sd)) return;
    if (ed && !(u.payment_date && u.payment_date <= ed)) return;
    var cr = byPh[str_(u.id)];
    out.push({ id: str_(u.id), source: (Number(u.outstanding_amount) || 0) > 0 ? 'ugrai_partial' : 'ugrai', bill_number: u.bill_number, bill_date: u.bill_date,
      retailer_name: u.retailer_name, sector: u.sector, payment_amount: u.payment_amount, payment_date: u.payment_date, tally_receipt_number: cr ? cr.tally_receipt_number : null,
      status: cr && cr.status ? cr.status : 'pending', processed_by: cr ? cr.processed_by : null, processed_date: cr ? cr.processed_date : null });
  });
  crs.forEach(function (c) {
    var orphan = (c.source_table === 'approved_bills' && !abIds[str_(c.payment_reference_id)]) || (c.source_table === 'ugrai_payment_history' && !phIds[str_(c.payment_reference_id)]);
    if (!orphan) return;
    out.push({ id: str_(c.id), source: c.payment_source, bill_number: c.bill_number, bill_date: c.bill_date, retailer_name: c.retailer_name, sector: c.sector,
      payment_amount: c.payment_amount, payment_date: c.created_at ? String(c.created_at).slice(0, 10) : null, tally_receipt_number: c.tally_receipt_number,
      status: c.status, processed_by: c.processed_by, processed_date: c.processed_date });
  });
  return out.map(function (v, i) { return { v: v, i: i }; }).sort(function (a, b) {
    var x = a.v.payment_date, y = b.v.payment_date;
    if (isNil_(x) && isNil_(y)) return a.i - b.i;
    if (isNil_(x)) return -1;
    if (isNil_(y)) return 1;
    return x < y ? 1 : (x > y ? -1 : a.i - b.i);
  }).map(function (x) { return x.v; });
};

// ---- RBAC / admin ------------------------------------------------------------------------------
function targetUid_(a, ctx) {
  var u = a && (a.user_uuid || a.target_user_id || a.user_id);
  if (u && (u === ctx.caller.user_id || isAdmin_(ctx.caller.user_id))) return u;
  return ctx.caller.user_id;
}

RPC.get_user_permissions = function (a, ctx) {
  var r = getRbac_().users[targetUid_(a, ctx)];
  return r ? r.perms : [];
};

RPC.get_user_roles_with_details = function (a, ctx) {
  var r = getRbac_().users[targetUid_(a, ctx)];
  return r ? r.roles.map(function (x) { return { role_name: x.role_name, display_name: x.display_name, permissions: x.permissions }; }) : [];
};

RPC.is_admin = function (a, ctx) { return isAdmin_(targetUid_(a, ctx)); };

RPC.check_user_permission = function (a, ctx) {
  var p = a && (a.permission_name || a.permission || a.p_permission || a[Object.keys(a)[0]]);
  var r = getRbac_().users[ctx.caller.user_id];
  return !!(r && r.perms.indexOf(p) >= 0);
};

RPC.get_all_users_with_roles = function (a, ctx) {
  normalizeSheets_();
  var rb = getRbac_();
  var users = credTbl_().load().slice();
  users.sort(function (x, y) { return String(y.created_at || '') < String(x.created_at || '') ? -1 : (String(y.created_at || '') > String(x.created_at || '') ? 1 : 0); });
  var roleById = {};
  rb.roles.forEach(function (r) { roleById[lower_(r.name)] = r; });
  return users.map(function (u) {
    return { id: u.user_id, email: u.email, full_name: u.full_name, department: u.department, is_active: u.is_active !== false, created_at: u.created_at,
      roles: parseList_(u.roles).map(function (n) { var r = roleById[lower_(n)]; return r ? { id: r.id, name: r.name, display_name: r.display_name } : null; }).filter(Boolean) };
  });
};

RPC.get_dashboard_stats = function () {
  var users = credTbl_().load(), rb = getRbac_();
  var admins = users.filter(function (u) { var r = rb.users[u.user_id]; return r && r.isAdmin; }).length;
  return [{ total_users: users.length, active_users: users.filter(function (u) { return u.is_active !== false; }).length, total_roles: rb.roles.length, admin_users: admins }];
};

RPC.log_admin_action = function (a, ctx) {
  execQuery_({ table: 'audit_logs', action: 'insert', values: { user_id: ctx.caller.user_id, action: a.p_action || a.action, resource_type: a.p_resource_type || a.resource_type,
    resource_id: a.p_resource_id || a.resource_id, details: a.p_details || a.details || null } });
  return null;
};

function execRpc_(name, args, ctx) {
  var fn = RPC[name];
  if (!fn) throw dbErr_('Could not find the function public.' + name + ' in the schema cache', 'PGRST202', null, null, 404);
  var data = fn(args || {}, ctx);
  var res = { data: data, count: null };
  if (ctx.range && Array.isArray(data)) { res.data = data.slice(ctx.range[0], ctx.range[1] + 1); }
  return res;
}

// ===========================================================================
//  BULK RPCs  (used by the Google-Sheets edition of the website to replace
//  one-row-at-a-time loops, which would be far too slow over the network)
// ===========================================================================

// p_table: table name,  p_updates: [{ id: 5, patch: {...} }  or  { match: {col: val}, patch: {...} }]
// returns the updated rows (array)
RPC.dls_bulk_update = function (a) {
  var name = a.p_table;
  if (!TABLES[name] || TABLES[name].internal) throw dbErr_('table not allowed: ' + name, '42501', null, null, 403);
  var tbl = getTable_(name), rows = tbl.load();
  var byId = {};
  rows.forEach(function (r) { byId[String(r.id)] = r; });
  var changed = {}, order = [];
  (a.p_updates || []).forEach(function (u) {
    var targets = [];
    if (u.id !== undefined && u.id !== null) { var r = changed[String(u.id)] || byId[String(u.id)]; if (r) targets = [r]; }
    else if (u.match) {
      var keys = Object.keys(u.match);
      targets = rows.filter(function (r2) { return keys.every(function (k) { return looseEq_(r2[k], u.match[k]) && !isNil_(r2[k]); }); });
    }
    var patch = coerceRow_(tbl, u.patch || {});
    delete patch.id;
    targets.forEach(function (t) {
      var o = changed[String(t.id)];
      if (!o) { o = {}; Object.keys(t).forEach(function (k) { o[k] = t[k]; }); changed[String(t.id)] = o; order.push(String(t.id)); }
      Object.keys(patch).forEach(function (k) { if (patch[k] !== undefined) o[k] = patch[k]; });
      if (tbl.sch.names.indexOf('updated_at') >= 0 && patch.updated_at === undefined) o.updated_at = nowIso_();
    });
  });
  var upd = order.map(function (k) { return changed[k]; });
  if (upd.length) {
    checkUnique_(tbl, upd, rows, upd);
    tbl.updateRows(upd);
  }
  return cleanOut_(upd);
};

// Same behaviour as SupabaseDataService.addUgraiData() but for the whole list at once.
RPC.dls_upsert_ugrai_data = function (a) {
  var tbl = getTable_('ugrai_data'), rows = tbl.load();
  var byBill = {};
  rows.forEach(function (r) { var k = str_(r.bill_number); (byBill[k] = byBill[k] || []).push({ row: r, obj: null }); });
  var updated = {}, deleted = {}, inserted = [], results = [];
  var state = { maxId: 0 };
  (a.p_items || []).forEach(function (item) {
    var bn = str_(item.bill_number);
    var group = byBill[bn] || [];
    if (group.length) {
      var target = group.filter(function (g) { return str_(g.row.user_id) === str_(item.user_id); })[0] || group[0];
      var cur = target.obj || (target.obj = Object.assign({}, target.row));
      var fields = {
        received_amount: isNil_(item.received_amount) ? null : round2_(item.received_amount),
        status: item.status || 'Pending',
        assigned_to: item.assigned_to || cur.assigned_to || null
      };
      if (Number(item.net_amount) >= Number(cur.net_amount)) fields.net_amount = round2_(item.net_amount);
      Object.keys(fields).forEach(function (k) { cur[k] = fields[k]; });
      cur.updated_at = nowIso_();
      if (cur.__row) updated[cur.__row] = cur;
      results.push(cur);
      if (group.length > 1) {
        group.forEach(function (g) { if (g !== target && g.row.__row) deleted[g.row.__row] = g.row; });
        byBill[bn] = [target];
      }
    } else {
      var nr = buildNewRow_(tbl, item, state);
      inserted.push(nr);
      byBill[bn] = [{ row: nr, obj: nr }];
      results.push(nr);
    }
  });
  var delRows = Object.keys(deleted).map(function (k) { return deleted[k]; });
  var updRows = Object.keys(updated).map(function (k) { return updated[k]; }).filter(function (o) { return !deleted[o.__row]; });
  if (updRows.length) tbl.updateRows(updRows);
  if (delRows.length) tbl.deleteRows(delRows);
  // row numbers shift after deletes, so insert last (insertRows appends)
  if (inserted.length) tbl.insertRows(inserted);
  return cleanOut_(results);
};

// Same behaviour as SupabaseDataService.bulkImportCompletedUgrai() for one chunk.
// p_groups: [[ completion, completion, ... ], ...]   (one inner array per bill number)
RPC.dls_bulk_import_completed_ugrai = function (a) {
  var uid = a.p_user_id;
  var comp = getTable_('completed_ugrai'), hist = getTable_('ugrai_payment_history');
  var compRows = comp.load(), histRows = hist.load();
  var existingByBill = {};
  compRows.forEach(function (r) { var k = str_(r.bill_number); existingByBill[k] = (existingByBill[k] || 0) + 1; });
  var maxPay = {};
  histRows.forEach(function (r) { var k = str_(r.bill_number); var n = Number(r.payment_number) || 0; if (n > (maxPay[k] || 0)) maxPay[k] = n; });
  var userBill = {};
  compRows.forEach(function (r) { userBill[str_(r.user_id) + '\u0001' + str_(r.bill_number)] = true; });
  var today = nowIso_().slice(0, 10);
  var results = { imported: 0, updated: 0, skipped: 0, historyCreated: 0, errors: [] };
  var newComp = [], newHist = [], st = { maxId: 0 };

  function histFor(b, netAmount, outstanding, notes) {
    var bn = str_(b.billNumber);
    var pn = (maxPay[bn] || 0) + 1; maxPay[bn] = pn;
    return buildNewRow_(hist, {
      user_id: uid, bill_number: b.billNumber, bill_date: b.billDate, retailer_name: b.retailerName, sector: b.sector,
      original_net_amount: parseFloat(netAmount), payment_number: pn,
      payment_date: b.dateCompleted || today, payment_amount: parseFloat(b.receivedAmount), outstanding_amount: parseFloat(outstanding || 0),
      payment_type: outstanding > 0 ? 'partial' : 'full', payment_method: b.paymentMethod, receipt_number: b.receiptNumber || null,
      cheque_date: b.chequeDate || null, photo_uploaded: Boolean(b.photoUploaded), photo_url: b.photoUrl || null,
      completed_by: b.completedBy || b.assignedTo || null, approved_by: null, date_approved: today, source_bill_id: null, notes: notes
    }, st);
  }
  function compFor(c) {
    return buildNewRow_(comp, {
      bill_number: c.billNumber, bill_date: c.billDate, retailer_name: c.retailerName, sector: c.sector, net_amount: parseFloat(c.netAmount),
      payment_method: c.paymentMethod, receipt_number: c.receiptNumber || null, received_amount: parseFloat(c.receivedAmount),
      cheque_date: c.chequeDate || null, photo_uploaded: Boolean(c.photoUploaded), date_completed: c.dateCompleted || today,
      assigned_to: c.assignedTo, user_id: uid
    }, st);
  }

  (a.p_groups || []).forEach(function (bills) {
    if (!bills || !bills.length) return;
    var bn = bills[0].billNumber, k = str_(bn);
    try {
      if (existingByBill[k] === 1) { results.skipped++; return; }
      if (userBill[str_(uid) + '\u0001' + k]) throw dupErr_('completed_ugrai', ['user_id', 'bill_number'], { user_id: uid, bill_number: bn });
      var hs = [], cr;
      if (bills.length > 1) {
        var total = bills.reduce(function (s, b) { return s + parseFloat(b.receivedAmount || 0); }, 0);
        var net = parseFloat(bills[0].netAmount || 0);
        for (var j = 0; j < bills.length; j++) {
          var out = net - bills.slice(0, j + 1).reduce(function (s, b) { return s + parseFloat(b.receivedAmount || 0); }, 0);
          hs.push(histFor(bills[j], net, out, 'CSV Import - Payment ' + (j + 1) + ' of ' + bills.length));
        }
        var fin = Object.assign({}, bills[bills.length - 1]); fin.receivedAmount = total;
        cr = compFor(fin);
      } else {
        cr = compFor(bills[0]);
      }
      hs.forEach(function (h) { newHist.push(h); results.historyCreated++; });
      newComp.push(cr);
      userBill[str_(uid) + '\u0001' + k] = true;
      existingByBill[k] = 1;
      results.imported++;
    } catch (e) {
      results.errors.push({ billNumber: bn, error: (e && e.message) || String(e) });
    }
  });
  if (newHist.length) hist.insertRows(newHist);
  if (newComp.length) comp.insertRows(newComp);
  return [results];
};

// ===========================================================================
//  STORAGE  (bill photos -> Google Drive folder "DLS Bill Photos")
// ===========================================================================
function photoFolder_() {
  var p = props_(), id = p.getProperty('PHOTO_FOLDER_ID'), f = null;
  if (id) { try { f = DriveApp.getFolderById(id); f.getName(); } catch (e) { f = null; } }
  if (!f) {
    var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
    f = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
    p.setProperty('PHOTO_FOLDER_ID', f.getId());
  }
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {}
  return f;
}

function photoUrl_(id) { return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w2000'; }

function storageUpload_(a) {
  if (!a.path || !a.base64) throw dbErr_('path and file data are required', 'STORAGE', null, null, 400);
  var folder = photoFolder_();
  var name = String(a.path);
  var it = folder.getFilesByName(name);
  while (it.hasNext()) {
    var old = it.next();
    if (!a.upsert) throw dbErr_('The resource already exists', 'Duplicate', null, null, 409);
    old.setTrashed(true);
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.contentType || 'application/octet-stream', name);
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { data: { path: name, id: file.getId(), fullPath: name, url: photoUrl_(file.getId()) }, count: null };
}

function storageRemove_(a) {
  var folder = photoFolder_(), out = [];
  (a.paths || []).forEach(function (p) {
    var it = folder.getFilesByName(String(p));
    while (it.hasNext()) { var f = it.next(); f.setTrashed(true); out.push({ name: p }); }
  });
  return { data: out, count: null };
}

function storageList_(a) {
  var folder = photoFolder_(), out = [], it = folder.getFiles(), prefix = a.prefix ? String(a.prefix) : '';
  while (it.hasNext() && out.length < (a.limit || 100)) {
    var f = it.next();
    if (prefix && f.getName().indexOf(prefix) !== 0) continue;
    out.push({ name: f.getName(), id: f.getId(), created_at: f.getDateCreated().toISOString(), updated_at: f.getLastUpdated().toISOString(), metadata: { size: f.getSize(), mimetype: f.getMimeType() } });
  }
  return { data: out, count: null };
}

function storageUrl_(a) {
  var folder = photoFolder_(), it = folder.getFilesByName(String(a.path));
  if (!it.hasNext()) throw dbErr_('Object not found', 'STORAGE', null, null, 404);
  return { data: { publicUrl: photoUrl_(it.next().getId()) }, count: null };
}

// ===========================================================================
//  REALTIME-STYLE POLLING (table version counters)
// ===========================================================================
function bumpVersions_() {
  var names = Object.keys(RT.mutated);
  if (!names.length) return null;
  var p = props_(), cur = p.getProperties(), upd = {}, bumped = {};
  names.forEach(function (n) {
    var nv = (Number(cur['v_' + n]) || 0) + 1;
    upd['v_' + n] = String(nv);
    bumped[n] = nv;
    if (n === 'credentials') { bumped.user_profiles = nv; bumped.user_roles = nv; }
    if (n === 'approved_bills') bumped.approved_supplies = nv;
  });
  p.setProperties(upd);
  RT.mutated = {};
  return bumped;
}

function pollVersions_(tables) {
  var cur = props_().getProperties(), out = {};
  (tables || []).forEach(function (t) {
    var key = t;
    if (t === 'user_profiles' || t === 'user_roles') key = 'credentials';
    if (t === 'approved_supplies') key = 'approved_bills';
    out[t] = Number(cur['v_' + key]) || 0;
  });
  return out;
}

// ===========================================================================
//  REQUEST ROUTER
// ===========================================================================
var PUBLIC_OPS = { 'auth.signIn': true, 'auth.reset': true, 'ping': true };

function isWriteOp_(o) {
  switch (o.op) {
    case 'query': return (o.action || 'select') !== 'select';
    case 'rpc': {
      var n = String(o.fn || '');
      if (n === 'get_all_users_with_roles') return true;
      return !(n.indexOf('get_') === 0 || n === 'is_admin' || n === 'check_user_permission');
    }
    case 'auth.signIn': case 'auth.signUp': case 'auth.update': case 'auth.reset': return true;
    default: return false;
  }
}

function runOp_(o, caller) {
  switch (o.op) {
    case 'ping': return { data: { ok: true, version: DLS_VERSION, time: nowIso_() }, count: null };
    case 'query': {
      authorizeQuery_(o, caller);
      return execQuery_(o);
    }
    case 'rpc': return execRpc_(o.fn, o.args, { caller: caller, range: o.range || null });
    case 'poll': return { data: { versions: pollVersions_(o.tables) }, count: null };
    case 'storage.upload': return storageUpload_(o);
    case 'storage.remove': return storageRemove_(o);
    case 'storage.list': return storageList_(o);
    case 'storage.url': return storageUrl_(o);
    case 'auth.getUser': return { data: { user: userObj_(caller) }, count: null };
    case 'auth.signUp': return { data: authSignUp_(caller, o), count: null };
    case 'auth.update': return { data: authUpdateSelf_(caller, o), count: null };
    case 'auth.signOut': return { data: { ok: true }, count: null };
    default: throw dbErr_('Unknown operation: ' + o.op, 'GAS02');
  }
}

function errPayload_(e) {
  if (e && e.dls) return e.dls;
  return { message: String(e && e.message ? e.message : e), code: 'GAS_ERR', details: null, hint: null, status: 500 };
}

function handle_(req) {
  resetRuntime_();
  var ops = req.op === 'batch' ? (req.ops || []) : [req];
  var needLock = ops.some(isWriteOp_);
  var lock = null;
  if (needLock) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(28000)) return { error: { message: 'The server is busy. Please try again in a moment.', code: 'BUSY', status: 503 } };
  }
  try {
    var results = [];
    var caller = null, authFail = null;
    var needAuth = ops.some(function (o) { return !PUBLIC_OPS[o.op]; });
    if (needAuth) {
      try { caller = authUser_(req.token); } catch (e) { authFail = errPayload_(e); }
    }
    ops.forEach(function (o) {
      try {
        if (o.op === 'auth.signIn') { results.push({ data: authSignIn_(o.email, o.password), count: null }); return; }
        if (o.op === 'auth.reset') { results.push({ data: authReset_(o.email), count: null }); return; }
        if (o.op === 'auth.refresh') { results.push({ data: authRefresh_(req.token), count: null }); return; }
        if (!PUBLIC_OPS[o.op] && !caller) { results.push({ error: authFail || { message: 'Not signed in', code: 'bad_jwt', status: 401 } }); return; }
        results.push(runOp_(o, caller));
      } catch (e2) {
        results.push({ error: errPayload_(e2) });
      }
    });
    var bumped = bumpVersions_();
    if (lock) SpreadsheetApp.flush();
    if (req.op === 'batch') { var outB = { results: results }; if (bumped) outB.bumped = bumped; return outB; }
    var single = results[0];
    if (bumped && single && typeof single === 'object') single.bumped = bumped;
    return single;
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e3) {} }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var out;
  try {
    var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var req = JSON.parse(body);
    out = handle_(req);
  } catch (err) {
    out = { error: errPayload_(err) };
  }
  return json_(out);
}

function doGet(e) {
  var configured = false;
  try { configured = !!(props_().getProperty('SHEET_ID') || SpreadsheetApp.getActiveSpreadsheet()); } catch (x) {}
  return json_({ ok: true, app: 'BeautyBasket by DLS – Google Sheets backend', version: DLS_VERSION, configured: configured, time: nowIso_() });
}

// ===========================================================================
//  SETUP + SHEET MENU
// ===========================================================================
function ensureCredentialSheets_() {
  var ss = ss_();
  var cs = ss.getSheetByName(SHEET_CREDENTIALS);
  if (!cs) {
    cs = ss.insertSheet(SHEET_CREDENTIALS, 0);
    cs.getRange(1, 1, 1, CRED_COLS.length).setValues([CRED_COLS]).setFontWeight('bold').setBackground('#fde68a');
    cs.setFrozenRows(1);
    CRED_COLS.forEach(function (c, i) {
      if (c !== 'is_active') cs.getRange(2, i + 1, Math.max(cs.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
    cs.getRange(1, 3).setNote('Type a NEW password here. It is converted to a secure hash the next time the user logs in (or when you press Enter) and this cell is cleared.');
    cs.getRange(1, 6).setNote('Comma separated role names from the Roles tab, e.g.  admin   or   supply_manager, accountant');
    cs.getRange(1, 7).setNote('TRUE = can log in, FALSE = blocked');
    cs.setColumnWidths(1, CRED_COLS.length, 150);
  }
  var rs = ss.getSheetByName(SHEET_ROLES);
  if (!rs) {
    rs = ss.insertSheet(SHEET_ROLES, 1);
    rs.getRange(1, 1, 1, ROLE_COLS.length).setValues([ROLE_COLS]).setFontWeight('bold').setBackground('#bbf7d0');
    rs.setFrozenRows(1);
    ROLE_COLS.forEach(function (c, i) {
      if (c !== 'is_system_role') rs.getRange(2, i + 1, Math.max(rs.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
    rs.getRange(1, 5).setNote('Comma separated permission names. See the "Permission Reference" tab for the full list.');
    rs.setColumnWidth(5, 600);
  }
  return { cs: cs, rs: rs };
}

function seedRoles_() {
  var rt = rolesTbl_(), existing = rt.load(), have = {};
  existing.forEach(function (r) { have[lower_(r.name)] = true; });
  var add = [];
  DEFAULT_ROLES.forEach(function (d) {
    if (have[lower_(d.name)]) return;
    add.push({ id: uuid_(), name: d.name, display_name: d.display_name, description: d.description, permissions: d.permissions.slice(), is_system_role: true, created_at: nowIso_(), updated_at: nowIso_() });
  });
  if (add.length) rt.insertRows(add);
  return add.length;
}

function writeReferenceSheet_() {
  var ss = ss_(), sh = ss.getSheetByName('Permission Reference');
  if (!sh) sh = ss.insertSheet('Permission Reference');
  sh.clear();
  var rows = [['Permission', 'What it unlocks']];
  var desc = {
    'admin.dashboard.view': 'Admin page', 'admin.users.create': 'Create users', 'admin.users.read': 'See users', 'admin.users.update': 'Edit users', 'admin.users.delete': 'Delete users',
    'admin.roles.create': 'Create roles', 'admin.roles.read': 'See roles', 'admin.roles.update': 'Edit roles', 'admin.roles.delete': 'Delete roles',
    'supply.base_file.view': 'Supply ▸ Base File', 'supply.upload.view': 'Supply ▸ Upload', 'supply.dispatch.view': 'Supply ▸ Dispatch', 'supply.in_progress.view': 'Supply ▸ In Progress', 'supply.management.view': 'Supply ▸ Management',
    'ugrai.base_file.view': 'Ugrai ▸ Base File', 'ugrai.total.view': 'Ugrai ▸ Total Ugrai', 'ugrai.issue.view': 'Ugrai ▸ Issue', 'ugrai.in_progress.view': 'Ugrai ▸ In Progress', 'ugrai.management.view': 'Ugrai ▸ Management',
    'purchase.base_file.view': 'Purchase ▸ Base File', 'purchase.entry.view': 'Purchase ▸ Entry', 'purchase.accounting.view': 'Purchase ▸ Accounting', 'purchase.management.view': 'Purchase ▸ Management', 'purchase.purchased.view': 'Purchase ▸ Purchased',
    'analysis.supply.view': 'Analysis ▸ Supply', 'analysis.ugrai.view': 'Analysis ▸ Ugrai', 'analysis.purchase.view': 'Analysis ▸ Purchase', 'analysis.pending_bills.view': 'Analysis ▸ Pending Bills',
    'cash_receipt.view': 'Cash Receipt tab'
  };
  ALL_PERMISSIONS.forEach(function (p) { rows.push([p, desc[p] || '']); });
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#e8eaed');
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 320);
}

/** RUN THIS ONCE.  Creates every tab and the first administrator. */
function setup() {
  resetRuntime_();
  var ss = ss_();
  props_().setProperty('SHEET_ID', ss.getId());
  secret_();
  ensureCredentialSheets_();
  Object.keys(TABLES).forEach(function (n) { if (!TABLES[n].internal && n !== 'roles') createDataSheet_(n); });
  var seeded = seedRoles_();
  writeReferenceSheet_();
  photoFolder_();
  var msg = 'Tabs created. Roles added: ' + seeded + '.';
  var users = credTbl_().load();
  var hasAdmin = users.some(function (u) { var r = getRbac_().users[u.user_id]; return r && r.isAdmin; });
  var pw = null, email = '';
  if (!hasAdmin) {
    try { email = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail(); } catch (e) {}
    if (!email) email = 'admin@example.com';
    var existing = findUserByEmail_(email);
    pw = genPassword_(10);
    if (existing) {
      var row = Object.assign({}, existing); row.roles = 'admin'; row.is_active = true; setPassword_(row, pw);
      credTbl_().updateRows([row]);
    } else {
      var nu = { user_id: uuid_(), email: email, password: '', full_name: 'Administrator', department: 'Admin', roles: 'admin', is_active: true, last_login: null, created_at: nowIso_() };
      setPassword_(nu, pw);
      credTbl_().insertRows([nu]);
    }
    rbacInvalidate_();
    msg += '\n\nFIRST ADMIN LOGIN (shown only once – change it after logging in):\n  Email:    ' + email + '\n  Password: ' + pw;
  } else {
    msg += '\n\nAn administrator already exists – no new login was created.';
  }
  var sheetDefault = ss.getSheetByName('Sheet1');
  if (sheetDefault && ss.getSheets().length > 1 && sheetDefault.getLastRow() === 0) { try { ss.deleteSheet(sheetDefault); } catch (e2) {} }
  msg += '\n\nNEXT: Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('DLS setup complete', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e3) {}
  return msg;
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('DLS Admin')
      .addItem('Run setup (first time)', 'setup')
      .addItem('Add user…', 'menuAddUser')
      .addItem('Reset password of selected user row', 'menuResetPassword')
      .addItem('Apply typed passwords now', 'menuApplyPasswords')
      .addItem('Clear cache', 'menuClearCache')
      .addToUi();
  } catch (e) {}
}

function menuAddUser() {
  var ui = SpreadsheetApp.getUi();
  resetRuntime_();
  var em = ui.prompt('Add user', 'E-mail address of the new user:', ui.ButtonSet.OK_CANCEL);
  if (em.getSelectedButton() !== ui.Button.OK) return;
  var nm = ui.prompt('Add user', 'Full name:', ui.ButtonSet.OK_CANCEL);
  if (nm.getSelectedButton() !== ui.Button.OK) return;
  var rl = ui.prompt('Add user', 'Role name(s), comma separated (e.g. supply_manager):', ui.ButtonSet.OK_CANCEL);
  if (rl.getSelectedButton() !== ui.Button.OK) return;
  var email = em.getResponseText().trim().toLowerCase();
  if (!email) return;
  if (findUserByEmail_(email)) { ui.alert('That e-mail already exists.'); return; }
  var pw = genPassword_(10);
  var row = { user_id: uuid_(), email: email, password: '', full_name: nm.getResponseText().trim(), department: '', roles: rl.getResponseText().trim(), is_active: true, last_login: null, created_at: nowIso_() };
  setPassword_(row, pw);
  credTbl_().insertRows([row]);
  rbacInvalidate_();
  ui.alert('User created', 'Email: ' + email + '\nPassword: ' + pw + '\n\nGive this to the user (shown only once).', ui.ButtonSet.OK);
}

function menuResetPassword() {
  var ui = SpreadsheetApp.getUi(), sh = SpreadsheetApp.getActiveSheet();
  resetRuntime_();
  if (sh.getName() !== SHEET_CREDENTIALS) { ui.alert('Select a user row in the Credentials tab first.'); return; }
  var r = sh.getActiveCell().getRow();
  if (r < 2) { ui.alert('Select a user row (not the header).'); return; }
  var users = credTbl_().load().filter(function (u) { return u.__row === r; });
  if (!users.length) { ui.alert('That row has no user.'); return; }
  var pw = genPassword_(10), row = Object.assign({}, users[0]);
  setPassword_(row, pw);
  credTbl_().updateRows([row]);
  rbacInvalidate_();
  ui.alert('Password reset', 'New password for ' + row.email + ':\n' + pw, ui.ButtonSet.OK);
}

function menuApplyPasswords() {
  resetRuntime_();
  normalizeSheets_();
  try { SpreadsheetApp.getUi().alert('Done. Typed passwords were converted to secure hashes.'); } catch (e) {}
}

function menuClearCache() {
  var c = CacheService.getScriptCache();
  c.removeAll(['tbl:credentials', 'tbl:roles']);
  try { SpreadsheetApp.getUi().alert('Cache cleared.'); } catch (e) {}
}

// Simple trigger: when someone edits Credentials / Roles by hand, drop the cache
// and hash a freshly typed password straight away.
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), name = sh.getName();
    if (name !== SHEET_CREDENTIALS && name !== SHEET_ROLES) return;
    CacheService.getScriptCache().removeAll(['tbl:credentials', 'tbl:roles']);
    if (name === SHEET_CREDENTIALS) {
      resetRuntime_();
      var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      var pc = headers.indexOf('password') + 1;
      if (pc > 0 && e.range.getColumn() <= pc && e.range.getLastColumn() >= pc) {
        normalizeSheets_();
      }
    }
  } catch (err) { /* simple triggers must never throw */ }
}
