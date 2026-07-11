import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { migration001, migration002, migration003 } from './schema.js';

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
    await this.pool.query(migration001);
    await this.pool.query("INSERT INTO schema_migrations (version) VALUES ('001') ON CONFLICT DO NOTHING");
    await this.pool.query(migration002);
    await this.pool.query("INSERT INTO schema_migrations (version) VALUES ('002-patrol-inspection') ON CONFLICT DO NOTHING");
    await this.pool.query(migration003);
    await this.pool.query("INSERT INTO schema_migrations (version) VALUES ('003-patrol-stop-confirmation') ON CONFLICT DO NOTHING");
  }
  close(): Promise<void> { return this.pool.end(); }
}
