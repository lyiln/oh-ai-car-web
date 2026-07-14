import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011, migration012, migration013, migration014, migration015 } from './schema.js';

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
    await this.pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
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
      { version: '011-patrol-event-details', sql: migration011 },
      { version: '012-ai-agents', sql: migration012 },
      { version: '013-whitelist-phone-sms', sql: migration013 },
      { version: '014-wxpusher-uid', sql: migration014 },
      { version: '015-drop-phone-aliyun', sql: migration015 },
    ]) {
      const applied = await this.pool.query<{ version: string }>('SELECT version FROM schema_migrations WHERE version=$1', [migration.version]);
      if (applied.rowCount) continue;
      await this.pool.query(migration.sql);
      await this.pool.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [migration.version]);
    }
  }
  close(): Promise<void> { return this.pool.end(); }
}
