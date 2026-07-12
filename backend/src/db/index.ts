import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010 } from './schema.js';

export class Database {
  readonly pool: Pool;
  constructor(connectionString: string) { this.pool = new Pool({ connectionString }); }
  query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) { return this.pool.query<T>(text, values); }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    const lockName = 'oh-ai-car-web:migrations';
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockName]);
      locked = true;
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      for (const migration of [
        { version: '001', sql: migration001 },
        { version: '002-patrol-inspection', sql: migration002 },
        { version: '003-patrol-stop-confirmation', sql: migration003 },
        { version: '004-platform-operations', sql: migration004 },
        { version: '005-patrol-snapshot-reviews', sql: migration005 },
        { version: '006-whitelist-live-version-locking', sql: migration006 },
        { version: '007-doorstep-response', sql: migration007 },
        { version: '008-doorstep-response-safety', sql: migration008 },
        { version: '009-global-whitelist', sql: migration009 },
        { version: '010-whitelist-entry-fields', sql: migration010 },
      ]) {
        await client.query('BEGIN');
        try {
          const applied = await client.query<{ version: string }>('SELECT version FROM schema_migrations WHERE version=$1', [migration.version]);
          if (!applied.rowCount) {
            await client.query(migration.sql);
            await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
      client.release();
    }
  }
  close(): Promise<void> { return this.pool.end(); }
}
