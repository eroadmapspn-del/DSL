import { Request, Response, NextFunction } from 'express';
import { QueryService, QueryFilter } from '../services/query.service.js';

export class QueryController {
  static async handleTableSelect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const table = req.params.table;
      const filters: QueryFilter[] = [];

      // Parse query params into filters
      for (const [key, val] of Object.entries(req.query)) {
        if (['select', 'order', 'limit', 'offset', 'token'].includes(key)) continue;

        if (typeof val === 'string') {
          if (val.startsWith('eq.')) {
            filters.push({ col: key, op: 'eq', val: val.substring(3) });
          } else if (val.startsWith('neq.')) {
            filters.push({ col: key, op: 'neq', val: val.substring(4) });
          } else if (val.startsWith('ilike.')) {
            filters.push({ col: key, op: 'ilike', val: val.substring(6) });
          } else if (val.startsWith('is.')) {
            const raw = val.substring(3);
            filters.push({ col: key, op: 'is', val: raw === 'null' ? null : raw });
          } else if (val.startsWith('in.(')) {
            const inner = val.substring(4, val.length - 1);
            filters.push({ col: key, op: 'in', val: inner.split(',').map(s => s.trim()) });
          } else {
            filters.push({ col: key, op: 'eq', val });
          }
        }
      }

      // Order
      let order: { col: string; ascending: boolean }[] | undefined;
      if (typeof req.query.order === 'string') {
        const parts = req.query.order.split('.');
        const col = parts[0];
        const asc = parts[1] !== 'desc';
        order = [{ col, ascending: asc }];
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

      const result = await QueryService.select(table, {
        filters,
        select: req.query.select as string,
        order,
        limit,
        offset
      });

      res.json({
        data: result.data,
        count: result.count,
        error: null
      });
    } catch (err) {
      next(err);
    }
  }

  static async handleTableInsert(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const table = req.params.table;
      const payload = req.body;
      const result = await QueryService.insert(table, payload);
      res.status(201).json({
        data: result.data,
        count: result.count,
        error: null
      });
    } catch (err) {
      next(err);
    }
  }

  static async handleTableUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const table = req.params.table;
      const patch = req.body;
      const filters: QueryFilter[] = [];

      for (const [key, val] of Object.entries(req.query)) {
        if (typeof val === 'string' && val.startsWith('eq.')) {
          filters.push({ col: key, op: 'eq', val: val.substring(3) });
        } else if (typeof val === 'string') {
          filters.push({ col: key, op: 'eq', val });
        }
      }

      const result = await QueryService.update(table, patch, filters);
      res.json({
        data: result.data,
        count: result.count,
        error: null
      });
    } catch (err) {
      next(err);
    }
  }

  static async handleTableDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const table = req.params.table;
      const filters: QueryFilter[] = [];

      for (const [key, val] of Object.entries(req.query)) {
        if (typeof val === 'string' && val.startsWith('eq.')) {
          filters.push({ col: key, op: 'eq', val: val.substring(3) });
        } else if (typeof val === 'string') {
          filters.push({ col: key, op: 'eq', val });
        }
      }

      const result = await QueryService.delete(table, filters);
      res.json({
        data: result.data,
        count: result.count,
        error: null
      });
    } catch (err) {
      next(err);
    }
  }

  static async handleBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ops = req.body.ops || (Array.isArray(req.body) ? req.body : [req.body]);
      const results = await QueryService.batch(ops, req.user);
      res.json({
        data: results,
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
}
