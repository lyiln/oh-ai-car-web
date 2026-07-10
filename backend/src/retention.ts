import type { Database } from './db/index.js';

export async function purgeExpiredData(db: Database): Promise<void> {
  await db.query("DELETE FROM telemetry_points WHERE occurred_at < now() - interval '90 days'");
  await db.query("DELETE FROM audit_logs WHERE created_at < now() - interval '1 year'");
  await db.query("UPDATE control_leases SET released_at=now(), release_reason='expired' WHERE released_at IS NULL AND expires_at<=now()");
}

export function startRetentionJob(db: Database): NodeJS.Timeout {
  void purgeExpiredData(db).catch((error) => console.error('Initial retention cleanup failed', error));
  const timer = setInterval(() => void purgeExpiredData(db).catch((error) => console.error('Retention cleanup failed', error)), 6 * 60 * 60_000);
  timer.unref();
  return timer;
}
