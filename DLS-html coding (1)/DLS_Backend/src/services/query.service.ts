import { memoryStore, getDatabaseConnector } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedUser } from '../types/index.js';
import { RpcService } from './rpc.service.js';
import { ENV } from '../config/env.js';

export interface QueryFilter {
  col: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in';
  val: any;
}

export class QueryService {
  static getTableRows(tableName: string): any[] {
    const table = memoryStore.tables[tableName];
    if (!table) {
      memoryStore.tables[tableName] = [];
      return memoryStore.tables[tableName];
    }
    return table;
  }

  static matchesFilters(row: any, filters: QueryFilter[] = []): boolean {
    for (const f of filters) {
      const val = row[f.col];
      switch (f.op) {
        case 'eq':
          if (String(val) !== String(f.val)) return false;
          break;
        case 'neq':
          if (String(val) === String(f.val)) return false;
          break;
        case 'gt':
          if (Number(val) <= Number(f.val)) return false;
          break;
        case 'gte':
          if (Number(val) < Number(f.val)) return false;
          break;
        case 'lt':
          if (Number(val) >= Number(f.val)) return false;
          break;
        case 'lte':
          if (Number(val) > Number(f.val)) return false;
          break;
        case 'ilike':
        case 'like': {
          const pattern = String(f.val).replace(/%/g, '.*');
          const reg = new RegExp(`^${pattern}$`, 'i');
          if (!reg.test(String(val || ''))) return false;
          break;
        }
        case 'is':
          if (f.val === null && val !== null && val !== undefined) return false;
          if (f.val !== null && val !== f.val) return false;
          break;
        case 'in':
          if (!Array.isArray(f.val) || !f.val.includes(val)) return false;
          break;
      }
    }
    return true;
  }

  static async select(tableName: string, options: {
    filters?: QueryFilter[];
    select?: string;
    order?: { col: string; ascending: boolean }[];
    limit?: number;
    offset?: number;
    count?: 'exact' | 'planned' | 'estimated';
  }) {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        let sql = `SELECT * FROM "${tableName}"`;
        const params: any[] = [];
        const whereClauses: string[] = [];

        (options.filters || []).forEach(f => {
          if (f.op === 'is') {
            whereClauses.push(`"${f.col}" IS NULL`);
          } else if (f.op === 'in' && Array.isArray(f.val)) {
            const placeholders = f.val.map((v: any) => {
              params.push(v);
              return `$${params.length}`;
            }).join(',');
            whereClauses.push(`"${f.col}" IN (${placeholders})`);
          } else {
            params.push(f.val);
            const idx = params.length;
            const opSymbol = f.op === 'eq' ? '=' : f.op === 'neq' ? '!=' : f.op === 'gt' ? '>' : f.op === 'gte' ? '>=' : f.op === 'lt' ? '<' : f.op === 'lte' ? '<=' : f.op === 'ilike' ? 'ILIKE' : '=';
            whereClauses.push(`"${f.col}" ${opSymbol} $${idx}`);
          }
        });

        if (whereClauses.length > 0) {
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }

        if (options.order && options.order.length > 0) {
          const orderParts = options.order.map(o => `"${o.col}" ${o.ascending ? 'ASC' : 'DESC'}`);
          sql += ' ORDER BY ' + orderParts.join(', ');
        }

        if (options.limit) {
          params.push(options.limit);
          sql += ` LIMIT $${params.length}`;
        }
        if (options.offset) {
          params.push(options.offset);
          sql += ` OFFSET $${params.length}`;
        }

        const res = await db.query(sql, params);
        return { data: res.rows, count: res.rowCount };
      } catch (err) {
        console.error(`PostgreSQL select error on "${tableName}", using memory:`, err);
      }
    }

    // Special handling for auth / rbac virtual tables
    if (tableName === 'roles') {
      let rows = Array.from(memoryStore.roles.values());
      if (options.filters) rows = rows.filter(r => this.matchesFilters(r, options.filters));
      return { data: rows, count: rows.length };
    }
    if (tableName === 'user_profiles') {
      let rows = Array.from(memoryStore.userProfiles.values());
      if (options.filters) rows = rows.filter(r => this.matchesFilters(r, options.filters));
      return { data: rows, count: rows.length };
    }
    if (tableName === 'user_roles') {
      let rows = Array.from(memoryStore.userRoles.values());
      if (options.filters) rows = rows.filter(r => this.matchesFilters(r, options.filters));
      return { data: rows, count: rows.length };
    }
    if (tableName === 'audit_logs') {
      let rows = memoryStore.auditLogs;
      if (options.filters) rows = rows.filter(r => this.matchesFilters(r, options.filters));
      return { data: rows, count: rows.length };
    }

    const rows = this.getTableRows(tableName);
    let matched = rows.filter(r => this.matchesFilters(r, options.filters));
    const totalCount = matched.length;

    if (options.order && options.order.length > 0) {
      matched.sort((a, b) => {
        for (const o of options.order!) {
          const av = a[o.col];
          const bv = b[o.col];
          if (av === bv) continue;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          const cmp = av < bv ? -1 : 1;
          return o.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }

    const offset = options.offset || 0;
    const limit = options.limit ? options.limit : matched.length;
    const paginated = matched.slice(offset, offset + limit);

    return {
      data: paginated,
      count: totalCount
    };
  }

  static async insert(tableName: string, payload: any | any[]) {
    const rows = Array.isArray(payload) ? payload : [payload];
    const inserted: any[] = [];
    const now = new Date().toISOString();

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        for (const r of rows) {
          const cols = Object.keys(r);
          if (cols.length > 0) {
            const colNames = cols.map(c => `"${c}"`).join(', ');
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            const values = cols.map(c => r[c]);
            const sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders}) RETURNING *`;
            const res = await db.query(sql, values);
            if (res.rows && res.rows[0]) inserted.push(res.rows[0]);
          }
        }
        if (inserted.length > 0) {
          return { data: inserted, count: inserted.length };
        }
      } catch (err) {
        console.error(`PostgreSQL insert error on "${tableName}":`, err);
      }
    }

    const table = this.getTableRows(tableName);
    for (const r of rows) {
      const id = r.id !== undefined ? r.id : (typeof r.id === 'string' ? uuidv4() : table.length + 1);
      const newRow = {
        ...r,
        id,
        created_at: r.created_at || now,
        updated_at: r.updated_at || now
      };
      table.push(newRow);
      inserted.push(newRow);
    }

    return { data: inserted, count: inserted.length };
  }

  static async update(tableName: string, patch: any, filters: QueryFilter[]) {
    const updated: any[] = [];
    const now = new Date().toISOString();

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const patchCols = Object.keys(patch);
        if (patchCols.length > 0) {
          const params: any[] = [];
          const setClauses = patchCols.map(c => {
            params.push(patch[c]);
            return `"${c}" = $${params.length}`;
          });

          const whereClauses: string[] = [];
          filters.forEach(f => {
            params.push(f.val);
            const opSymbol = f.op === 'ilike' || f.op === 'like' ? 'ILIKE' : '=';
            whereClauses.push(`"${f.col}" ${opSymbol} $${params.length}`);
          });

          let sql = `UPDATE "${tableName}" SET ${setClauses.join(', ')}`;
          if (whereClauses.length > 0) {
            sql += ' WHERE ' + whereClauses.join(' AND ');
          }
          sql += ' RETURNING *';
          const res = await db.query(sql, params);
          return { data: res.rows, count: res.rowCount };
        }
      } catch (err) {
        console.error(`PostgreSQL update error on "${tableName}":`, err);
      }
    }

    const table = this.getTableRows(tableName);
    for (const row of table) {
      if (this.matchesFilters(row, filters)) {
        Object.assign(row, patch, { updated_at: now });
        updated.push(row);
      }
    }

    return { data: updated, count: updated.length };
  }

  static async delete(tableName: string, filters: QueryFilter[]) {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const params: any[] = [];
        const whereClauses: string[] = [];
        filters.forEach(f => {
          params.push(f.val);
          const opSymbol = f.op === 'ilike' || f.op === 'like' ? 'ILIKE' : '=';
          whereClauses.push(`"${f.col}" ${opSymbol} $${params.length}`);
        });

        let sql = `DELETE FROM "${tableName}"`;
        if (whereClauses.length > 0) {
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }
        sql += ' RETURNING *';
        const res = await db.query(sql, params);
        return { data: res.rows, count: res.rowCount };
      } catch (err) {
        console.error(`PostgreSQL delete error on "${tableName}":`, err);
      }
    }

    const table = this.getTableRows(tableName);
    const deleted: any[] = [];
    for (let i = table.length - 1; i >= 0; i--) {
      if (this.matchesFilters(table[i], filters)) {
        const removed = table.splice(i, 1)[0];
        deleted.push(removed);
      }
    }

    return { data: deleted, count: deleted.length };
  }

  static async upsert(tableName: string, rows: any[], onConflict?: string) {
    const conflictCol = onConflict || 'id';
    const result: any[] = [];
    const table = this.getTableRows(tableName);
    const now = new Date().toISOString();

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        for (const r of rows) {
          const cols = Object.keys(r);
          if (cols.length > 0) {
            const colNames = cols.map(c => `"${c}"`).join(', ');
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            const updateCols = cols.filter(c => c !== conflictCol && c !== 'id' && c !== 'created_at');
            const updateSet = updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');
            const values = cols.map(c => r[c]);
            let sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`;
            if (updateSet.length > 0) {
              sql += ` ON CONFLICT ("${conflictCol}") DO UPDATE SET ${updateSet}, "updated_at" = NOW()`;
            } else {
              sql += ` ON CONFLICT ("${conflictCol}") DO NOTHING`;
            }
            sql += ` RETURNING *`;
            const res = await db.query(sql, values);
            if (res.rows && res.rows[0]) {
              result.push(res.rows[0]);
            }
          }
        }
        if (result.length > 0) {
          return { data: result, count: result.length };
        }
      } catch (err) {
        console.error(`PostgreSQL upsert error on "${tableName}":`, err);
      }
    }

    for (const r of rows) {
      const matchVal = r[conflictCol];
      const existing = table.find((item: any) => item[conflictCol] === matchVal);
      if (existing) {
        Object.assign(existing, r, { updated_at: now });
        result.push(existing);
      } else {
        const id = r.id !== undefined ? r.id : (typeof r.id === 'string' ? uuidv4() : table.length + 1);
        const newRow = { ...r, id, created_at: now, updated_at: now };
        table.push(newRow);
        result.push(newRow);
      }
    }

    return { data: result, count: result.length };
  }

  static async batch(ops: any[], user?: AuthenticatedUser) {
    const results: any[] = [];
    for (const op of ops) {
      try {
        if (op.op === 'rpc') {
          const res = await RpcService.execute(op.fn, op.args, user);
          results.push({ data: res, count: null, error: null });
        } else if (op.op === 'query') {
          const action = op.action || 'select';
          if (action === 'select') {
            const res = await this.select(op.table, {
              filters: op.filters,
              order: op.order,
              limit: op.limit,
              offset: op.offset
            });
            results.push({ ...res, error: null });
          } else if (action === 'insert') {
            const res = await this.insert(op.table, op.values);
            results.push({ ...res, error: null });
          } else if (action === 'update') {
            const res = await this.update(op.table, op.values, op.filters || []);
            results.push({ ...res, error: null });
          } else if (action === 'delete') {
            const res = await this.delete(op.table, op.filters || []);
            results.push({ ...res, error: null });
          } else if (action === 'upsert') {
            const res = await this.upsert(op.table, op.values, op.onConflict);
            results.push({ ...res, error: null });
          }
        } else {
          results.push({ data: null, count: null, error: null });
        }
      } catch (err: any) {
        results.push({ data: null, error: { message: err.message || String(err), code: err.code || 'ERR' } });
      }
    }
    return results;
  }
}
