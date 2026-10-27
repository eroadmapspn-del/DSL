import { memoryStore } from '../db/index.js';
import { AdminService } from './admin.service.js';
import { AuthenticatedUser } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

export class RpcService {
  static async execute(fnName: string, args: any = {}, user?: AuthenticatedUser): Promise<any> {
    const callerId = user?.id || '00000000-0000-0000-0000-000000000001';

    switch (fnName) {
      // -----------------------------------------------------------------------
      // Admin & RBAC RPCs
      // -----------------------------------------------------------------------
      case 'get_user_permissions': {
        const targetId = args.user_uuid || args.user_id || callerId;
        const userRoles: string[] = [];
        for (const [_, ur] of memoryStore.userRoles.entries()) {
          if (ur.user_id === targetId) {
            const role = Array.from(memoryStore.roles.values()).find(r => r.id === ur.role_id || r.name === ur.role_name);
            if (role) userRoles.push(role.name);
          }
        }
        const userObj = memoryStore.users.get(targetId);
        if (userObj?.roles) {
          userObj.roles.forEach(r => { if (!userRoles.includes(r)) userRoles.push(r); });
        }

        const permissions = new Set<string>();
        for (const r of userRoles) {
          const roleObj = memoryStore.roles.get(r);
          if (roleObj?.permissions) {
            roleObj.permissions.forEach(p => permissions.add(p));
          }
        }
        return Array.from(permissions);
      }

      case 'get_user_roles_with_details': {
        const targetId = args.user_uuid || args.user_id || callerId;
        const details: any[] = [];
        for (const [_, ur] of memoryStore.userRoles.entries()) {
          if (ur.user_id === targetId) {
            const role = Array.from(memoryStore.roles.values()).find(r => r.id === ur.role_id || r.name === ur.role_name);
            if (role) {
              details.push({
                user_id: targetId,
                role_id: role.id,
                role_name: role.name,
                role_display_name: role.display_name || role.name,
                role_description: role.description,
                assigned_at: ur.assigned_at
              });
            }
          }
        }
        return details;
      }

      case 'get_all_users_with_roles': {
        return await AdminService.getAllUsersWithRoles();
      }

      case 'get_dashboard_stats': {
        return await AdminService.getDashboardStats();
      }

      case 'is_admin': {
        const targetId = args.user_uuid || args.user_id || callerId;
        const isAdm = Array.from(memoryStore.userRoles.values()).some(
          ur => ur.user_id === targetId && (ur.role_name === 'admin' || ur.role_id === 'role-admin')
        );
        return isAdm;
      }

      case 'check_user_permission': {
        const targetId = args.user_uuid || args.user_id || callerId;
        const permName = args.permission_name || args.permission;
        const perms: any = await this.execute('get_user_permissions', { user_uuid: targetId }, user);
        return Array.isArray(perms) && perms.includes(permName);
      }

      case 'log_admin_action': {
        return AdminService.logAdminAction({
          userId: callerId,
          action: args.action || 'CUSTOM_ACTION',
          resourceType: args.resource_type || args.table_name,
          resourceId: args.resource_id,
          details: args.details || args.new_values
        });
      }

      // -----------------------------------------------------------------------
      // Supply & Analysis RPCs
      // -----------------------------------------------------------------------
      case 'get_supply_analysis_summary': {
        const supplies = memoryStore.tables['active_supplies'] || [];
        const approved = memoryStore.tables['approved_bills'] || [];
        const totalBills = supplies.length + approved.length;
        const totalAmount = supplies.reduce((s: number, b: any) => s + (Number(b.net_amount) || 0), 0) +
                            approved.reduce((s: number, b: any) => s + (Number(b.net_amount) || 0), 0);
        const receivedAmount = approved.reduce((s: number, b: any) => s + (Number(b.received_amount) || 0), 0);

        return [{
          total_bills: totalBills,
          total_amount: totalAmount,
          delivered_bills: approved.length,
          delivered_amount: receivedAmount,
          pending_bills: supplies.length,
          pending_amount: totalAmount - receivedAmount
        }];
      }

      case 'get_ugrai_analysis_summary': {
        const ugrai = memoryStore.tables['ugrai_data'] || [];
        const totalAmount = ugrai.reduce((s: number, b: any) => s + (Number(b.net_amount) || 0), 0);
        const receivedAmount = ugrai.reduce((s: number, b: any) => s + (Number(b.received_amount) || 0), 0);
        const pending = ugrai.filter((b: any) => b.status === 'Pending');

        return [{
          total_bills: ugrai.length,
          total_amount: totalAmount,
          collected_amount: receivedAmount,
          pending_bills: pending.length,
          pending_amount: totalAmount - receivedAmount
        }];
      }

      case 'get_pending_bills_summary': {
        const supplies = memoryStore.tables['active_supplies'] || [];
        const ugrai = (memoryStore.tables['ugrai_data'] || []).filter((b: any) => b.status === 'Pending');
        const count = supplies.length + ugrai.length;
        const amount = supplies.reduce((s: number, b: any) => s + (Number(b.net_amount) || 0), 0) +
                       ugrai.reduce((s: number, b: any) => s + ((Number(b.net_amount) || 0) - (Number(b.received_amount) || 0)), 0);
        return [{
          total_pending_count: count,
          total_pending_amount: amount
        }];
      }

      case 'get_pending_bills_by_sector': {
        const supplies = memoryStore.tables['active_supplies'] || [];
        const ugrai = (memoryStore.tables['ugrai_data'] || []).filter((b: any) => b.status === 'Pending');
        const map = new Map<string, { sector: string; count: number; total_amount: number }>();

        const add = (sector: string, amount: number) => {
          const s = sector || 'Unassigned';
          const cur = map.get(s) || { sector: s, count: 0, total_amount: 0 };
          cur.count++;
          cur.total_amount += amount;
          map.set(s, cur);
        };

        supplies.forEach((b: any) => add(b.sector, Number(b.net_amount) || 0));
        ugrai.forEach((b: any) => add(b.sector, (Number(b.net_amount) || 0) - (Number(b.received_amount) || 0)));

        return Array.from(map.values());
      }

      case 'get_pending_bills_by_person': {
        const supplies = memoryStore.tables['active_supplies'] || [];
        const ugrai = (memoryStore.tables['ugrai_data'] || []).filter((b: any) => b.status === 'Pending');
        const map = new Map<string, { person: string; count: number; total_amount: number }>();

        const add = (person: string, amount: number) => {
          const p = person || 'Unassigned';
          const cur = map.get(p) || { person: p, count: 0, total_amount: 0 };
          cur.count++;
          cur.total_amount += amount;
          map.set(p, cur);
        };

        supplies.forEach((b: any) => add(b.supply_through, Number(b.net_amount) || 0));
        ugrai.forEach((b: any) => add(b.assigned_to, (Number(b.net_amount) || 0) - (Number(b.received_amount) || 0)));

        return Array.from(map.values());
      }

      case 'get_pending_bills_detailed': {
        const supplies = (memoryStore.tables['active_supplies'] || []).map((b: any) => ({
          ...b,
          type: 'Supply',
          due_amount: b.net_amount
        }));
        const ugrai = (memoryStore.tables['ugrai_data'] || []).filter((b: any) => b.status === 'Pending').map((b: any) => ({
          ...b,
          type: 'UGRAI',
          due_amount: (Number(b.net_amount) || 0) - (Number(b.received_amount) || 0)
        }));
        return [...supplies, ...ugrai];
      }

      case 'get_payment_history_summary': {
        const history = memoryStore.tables['ugrai_payment_history'] || [];
        const totalAmount = history.reduce((s: number, h: any) => s + (Number(h.payment_amount) || 0), 0);
        return [{
          total_payments: history.length,
          total_amount_collected: totalAmount
        }];
      }

      case 'get_payment_history_by_method': {
        const history = memoryStore.tables['ugrai_payment_history'] || [];
        const map = new Map<string, { payment_method: string; count: number; total_amount: number }>();

        history.forEach((h: any) => {
          const m = h.payment_method || 'Other';
          const cur = map.get(m) || { payment_method: m, count: 0, total_amount: 0 };
          cur.count++;
          cur.total_amount += Number(h.payment_amount) || 0;
          map.set(m, cur);
        });

        return Array.from(map.values());
      }

      case 'get_next_payment_number': {
        const billNumber = args.bill_number;
        const history = (memoryStore.tables['ugrai_payment_history'] || []).filter(
          (h: any) => h.bill_number === billNumber
        );
        const maxNum = history.reduce((max: number, h: any) => Math.max(max, Number(h.payment_number) || 0), 0);
        return maxNum + 1;
      }

      case 'get_ugrai_payment_history': {
        const billNumber = args.bill_number;
        const history = (memoryStore.tables['ugrai_payment_history'] || []).filter(
          (h: any) => !billNumber || h.bill_number === billNumber
        );
        return history.sort((a: any, b: any) => (Number(a.payment_number) || 0) - (Number(b.payment_number) || 0));
      }

      // -----------------------------------------------------------------------
      // Workflow RPCs (Move to in progress, complete, approve)
      // -----------------------------------------------------------------------
      case 'move_ugrai_to_in_progress': {
        const { bill_numbers, assigned_to } = args;
        const bills = Array.isArray(bill_numbers) ? bill_numbers : [bill_numbers];
        const ugraiTable = memoryStore.tables['ugrai_data'] || [];
        const updated: any[] = [];

        ugraiTable.forEach((row: any) => {
          if (bills.includes(row.bill_number)) {
            row.current_stage = 'in_progress';
            if (assigned_to) row.assigned_to = assigned_to;
            row.updated_at = new Date().toISOString();
            updated.push(row);
          }
        });
        return { success: true, updated_count: updated.length };
      }

      case 'complete_ugrai_bill': {
        const { bill_data } = args;
        const now = new Date().toISOString();
        const completedTable = memoryStore.tables['completed_ugrai'] || [];
        const ugraiTable = memoryStore.tables['ugrai_data'] || [];

        const record = {
          id: uuidv4(),
          ...bill_data,
          date_completed: now.split('T')[0],
          created_at: now,
          updated_at: now
        };
        completedTable.push(record);

        // Update ugrai_data status
        const item = ugraiTable.find((u: any) => u.bill_number === bill_data.bill_number);
        if (item) {
          item.status = 'Completed';
          item.current_stage = 'completed';
          item.received_amount = bill_data.received_amount;
          item.updated_at = now;
        }

        return { success: true, completed_id: record.id };
      }

      case 'approve_ugrai_bills': {
        const { bill_numbers } = args;
        const bills = Array.isArray(bill_numbers) ? bill_numbers : [bill_numbers];
        const completed = memoryStore.tables['completed_ugrai'] || [];
        const approved = memoryStore.tables['approved_ugrai'] || [];
        const now = new Date().toISOString();

        bills.forEach(bNum => {
          const idx = completed.findIndex((c: any) => c.bill_number === bNum);
          if (idx !== -1) {
            const comp = completed.splice(idx, 1)[0];
            approved.push({
              ...comp,
              date_approved: now.split('T')[0],
              approved_by: callerId,
              status: 'Approved',
              updated_at: now
            });
          }
        });
        return { success: true };
      }

      case 'revert_delivered_supply_to_in_progress': {
        const { bill_id, bill_number } = args;
        const approved = memoryStore.tables['approved_bills'] || [];
        const supplies = memoryStore.tables['active_supplies'] || [];

        const idx = approved.findIndex((b: any) => (bill_id && b.id === bill_id) || (bill_number && b.bill_number === bill_number));
        if (idx !== -1) {
          const bill = approved.splice(idx, 1)[0];
          supplies.push({
            ...bill,
            status: 'in_progress',
            completion_date: null,
            updated_at: new Date().toISOString()
          });
        }
        return { success: true };
      }

      case 'get_all_cash_payments': {
        const cashTable = memoryStore.tables['cash_receipts'] || [];
        return cashTable;
      }

      // -----------------------------------------------------------------------
      // Bulk Operations RPCs
      // -----------------------------------------------------------------------
      case 'dls_bulk_update': {
        const { p_table, p_updates } = args;
        const table = memoryStore.tables[p_table] || [];
        const updated: any[] = [];

        if (Array.isArray(p_updates)) {
          p_updates.forEach((item: any) => {
            const matchCol = item.match ? Object.keys(item.match)[0] : 'id';
            const matchVal = item.match ? item.match[matchCol] : item.id;
            const target = table.find((r: any) => r[matchCol] === matchVal);
            if (target && item.patch) {
              Object.assign(target, item.patch);
              target.updated_at = new Date().toISOString();
              updated.push(target);
            }
          });
        }
        return updated;
      }

      case 'dls_upsert_ugrai_data': {
        const { p_rows } = args;
        const table = memoryStore.tables['ugrai_data'] || [];
        const result: any[] = [];

        if (Array.isArray(p_rows)) {
          p_rows.forEach((row: any) => {
            const existing = table.find((r: any) => r.bill_number === row.bill_number);
            if (existing) {
              Object.assign(existing, row);
              existing.updated_at = new Date().toISOString();
              result.push(existing);
            } else {
              const newRow = {
                id: row.id || uuidv4(),
                ...row,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
              table.push(newRow);
              result.push(newRow);
            }
          });
        }
        return result;
      }

      case 'dls_bulk_import_completed_ugrai': {
        const { p_rows } = args;
        const table = memoryStore.tables['completed_ugrai'] || [];
        if (Array.isArray(p_rows)) {
          p_rows.forEach((r: any) => {
            table.push({
              id: r.id || uuidv4(),
              ...r,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          });
        }
        return { success: true, count: p_rows?.length || 0 };
      }

      default:
        throw { status: 404, message: `Could not find function public.${fnName} in the schema cache`, code: 'PGRST202' };
    }
  }
}
