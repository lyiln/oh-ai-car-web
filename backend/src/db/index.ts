import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import {
  migration001, migration002, migration003, migration004, migration005,
  migration006, migration007, migration008, migration009, migration010,
  migration011, migration012, migration012AiAgents, migration013ViolationReviewDisposition,
  migration013WhitelistPhoneSms,
  migration014, migration015, migration016,
  migration017, migration018, migration019, migration020, migration021, migration022,
} from './schema.js';

export class Database {
  readonly pool: Pool;
  constructor(connectionString: string) { this.pool = new Pool({ connectionString }); }
  query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) { return this.pool.query<T>(text, params); }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
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
        { version: '011-patrol-event-details', sql: migration011 },
        { version: '012-patrol-rule-snapshots', sql: migration012 },
        { version: '012-ai-agents', sql: migration012AiAgents },
        { version: '013-violation-review-disposition', sql: migration013ViolationReviewDisposition },
        { version: '013-whitelist-phone-sms', sql: migration013WhitelistPhoneSms },
        { version: '014-wxpusher-uid', sql: migration014 },
        { version: '015-drop-phone-aliyun', sql: migration015 },
        { version: '016-auth-otp-attempt-limit', sql: migration016 },
        { version: '017-floor-map-pose', sql: migration017 },
        { version: '018-patrol-routes-code', sql: migration018 },
        { version: '019-goto-goals', sql: migration019 },
        { version: '020-vehicle-nav-state', sql: migration020 },
        { version: '021-persistent-control-sessions', sql: migration021 },
        { version: '022-twenty-minute-control-leases', sql: migration022 },
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
