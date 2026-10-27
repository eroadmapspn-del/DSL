import { Pool, QueryResult } from 'pg';
import { ENV } from '../config/env.js';

export interface IDatabaseConnector {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
  getClient(): Promise<any>;
  close(): Promise<void>;
}

class PostgresConnector implements IDatabaseConnector {
  private pool: Pool | null = null;

  constructor() {
    if (ENV.USE_DATABASE) {
      try {
        this.pool = new Pool({
          connectionString: ENV.DATABASE_URL,
        });
        console.log('📦 PostgreSQL Connection Pool initialized.');
      } catch (err) {
        console.error('❌ Failed to initialize PostgreSQL pool:', err);
      }
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (!this.pool) {
      throw new Error('Database pool is not initialized. Check USE_DATABASE and DATABASE_URL in .env');
    }
    const result: QueryResult<any> = await this.pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
    };
  }

  async getClient() {
    if (!this.pool) {
      throw new Error('Database pool is not initialized.');
    }
    return await this.pool.connect();
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

// Global active database connector instance
// You can replace or plug in your custom database connector here when provided
let activeConnector: IDatabaseConnector = new PostgresConnector();

export function setCustomDatabaseConnector(connector: IDatabaseConnector) {
  console.log('🔄 Swapping active database connector with custom user connector...');
  activeConnector = connector;
}

export function getDatabaseConnector(): IDatabaseConnector {
  return activeConnector;
}
