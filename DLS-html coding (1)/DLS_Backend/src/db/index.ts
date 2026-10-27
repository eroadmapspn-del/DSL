import { getDatabaseConnector, IDatabaseConnector, setCustomDatabaseConnector } from './connection.js';
import { memoryStore, MemoryStore } from './memory-store.js';
import { ENV } from '../config/env.js';

export { getDatabaseConnector, setCustomDatabaseConnector, memoryStore, MemoryStore };

export async function executeQuery<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
  if (ENV.USE_DATABASE) {
    const connector = getDatabaseConnector();
    return await connector.query<T>(sql, params);
  }

  // When database is not enabled yet, use in-memory store
  return {
    rows: [],
    rowCount: 0
  };
}
