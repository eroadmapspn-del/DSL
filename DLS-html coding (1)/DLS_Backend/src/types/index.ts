export interface UserProfile {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  department: string;
  is_active: boolean;
  last_login?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserAccount {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  profile?: UserProfile;
  roles?: string[];
}

export interface Role {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  permissions: string[];
  is_system_role?: boolean;
  user_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
  assigned_by?: string | null;
  assigned_at?: string;
  role_name?: string;
}

export interface Permission {
  id: string;
  name: string;
  description: string;
  section_id?: string;
  section_name?: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_email?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: any;
  old_values?: any;
  new_values?: any;
  ip_address?: string | null;
  created_at: string;
}

export interface Bill {
  id: number;
  bill_number: string;
  bill_date: string;
  retailer_name: string;
  net_amount: number;
  brand?: string | null;
  sector?: string | null;
  status?: string | null;
  supply_through?: string | null;
  user_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ActiveSupply {
  id: number;
  bill_id?: number | null;
  bill_number: string;
  bill_date?: string | null;
  retailer_name: string;
  sector?: string | null;
  net_amount: number;
  brand?: string | null;
  supply_through?: string | null;
  status?: string | null;
  payment_method?: string | null;
  receipt_number?: string | null;
  received_amount?: number | null;
  cheque_date?: string | null;
  photo_url?: string | null;
  completion_date?: string | null;
  user_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ApprovedBill {
  id: number;
  original_bill_id?: number | null;
  bill_number: string;
  bill_date: string;
  retailer_name: string;
  sector?: string | null;
  net_amount: number;
  received_amount?: number | null;
  brand?: string | null;
  supply_through?: string | null;
  payment_method?: string | null;
  receipt_number?: string | null;
  cheque_date?: string | null;
  photo_url?: string | null;
  status?: string | null;
  approval_date?: string | null;
  user_id?: string | null;
  created_at?: string;
}

export interface EditedBill {
  id: number;
  original_bill_id?: number | null;
  bill_number: string;
  original_amount: number;
  edited_amount: number;
  retailer_name: string;
  sector?: string | null;
  brand?: string | null;
  edit_reason?: string | null;
  edited_date?: string | null;
  user_id?: string | null;
  bill_date?: string | null;
}

export interface UgraiData {
  id: string;
  user_id: string;
  bill_number: string;
  bill_date: string;
  retailer_name: string;
  sector: string;
  net_amount: number;
  status: 'Pending' | 'Completed' | 'Approved' | string;
  assigned_to?: string | null;
  current_stage?: 'available' | 'in_progress' | 'completed' | 'approved' | string;
  received_amount: number;
  created_at?: string;
  updated_at?: string;
}

export interface CashReceipt {
  id: string;
  user_id: string;
  payment_source: 'supply' | 'ugrai' | 'ugrai_partial' | string;
  payment_reference_id: string;
  source_table: 'approved_bills' | 'ugrai_payment_history' | string;
  bill_number: string;
  bill_date: string;
  retailer_name: string;
  sector?: string | null;
  payment_amount: number;
  payment_date: string;
  tally_receipt_number?: string | null;
  status: 'pending' | 'processed' | string;
  processed_by?: string | null;
  processed_date?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  full_name: string;
  department: string;
  roles: string[];
  permissions: string[];
  isAdmin: boolean;
}
