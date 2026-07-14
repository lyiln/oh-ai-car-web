import type { Database } from '../../db/index.js';
import type { ToolContext } from '../types.js';

function iso(value: Date | null | undefined): string | null {
  return value ? (value instanceof Date ? value.toISOString() : String(value)) : null;
}

export async function queryPatrolTasksByDate(db: Database, ctx: ToolContext, date: string, deviceId?: string) {
  const result = await db.query<{
    id: string;
    vehicle_id: string;
    status: string;
    shift: string;
    started_at: Date | null;
    finished_at: Date | null;
    device_name: string;
    route_name: string | null;
  }>(
    `SELECT t.id, t.vehicle_id, t.status, t.shift, t.started_at, t.finished_at,
            v.name AS device_name, r.name AS route_name
     FROM patrol_tasks t
     JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN patrol_routes r ON r.id = t.route_id
     WHERE t.started_at::date = $1::date
       AND ($2::uuid IS NULL OR t.vehicle_id = $2)
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = t.vehicle_id AND vm.user_id = $3
       ))
     ORDER BY t.started_at DESC
     LIMIT 50`,
    [date, deviceId ?? null, ctx.memberId],
  );
  return {
    date,
    count: result.rows.length,
    tasks: result.rows.map((row) => ({
      id: row.id,
      deviceId: row.vehicle_id,
      deviceName: row.device_name,
      routeName: row.route_name,
      status: row.status,
      shift: row.shift,
      startedAt: iso(row.started_at),
      finishedAt: iso(row.finished_at),
    })),
  };
}

export async function queryPatrolReport(db: Database, ctx: ToolContext, taskId: string) {
  const task = await db.query<{
    id: string;
    vehicle_id: string;
    status: string;
    device_name: string;
    route_name: string | null;
    started_at: Date | null;
    finished_at: Date | null;
  }>(
    `SELECT t.id, t.vehicle_id, t.status, v.name AS device_name, r.name AS route_name,
            t.started_at, t.finished_at
     FROM patrol_tasks t
     JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN patrol_routes r ON r.id = t.route_id
     WHERE t.id = $1
       AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = t.vehicle_id AND vm.user_id = $2
       ))`,
    [taskId, ctx.memberId],
  );
  if (!task.rows[0]) {
    return { found: false, message: '未找到该巡检任务或无权访问。' };
  }
  const report = await db.query<{
    id: string;
    stats: Record<string, unknown>;
    created_at: Date;
  }>('SELECT id, stats, created_at FROM patrol_reports WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1', [taskId]);

  const observationStats = await db.query<{ classification: string; count: number; no_parking: number }>(
    `SELECT classification, count(*)::int AS count,
            count(*) FILTER (WHERE no_parking)::int AS no_parking
     FROM plate_observations WHERE task_id=$1 GROUP BY classification`,
    [taskId],
  );
  const counts = Object.fromEntries(observationStats.rows.map((row) => [row.classification, row.count]));
  const noParking = observationStats.rows.reduce((sum, row) => sum + row.no_parking, 0);

  return {
    found: true,
    task: {
      id: task.rows[0].id,
      deviceName: task.rows[0].device_name,
      routeName: task.rows[0].route_name,
      status: task.rows[0].status,
      startedAt: iso(task.rows[0].started_at),
      finishedAt: iso(task.rows[0].finished_at),
    },
    reportId: report.rows[0]?.id ?? null,
    reportCreatedAt: iso(report.rows[0]?.created_at ?? null),
    stats: report.rows[0]?.stats ?? {
      registeredPrivate: counts.registered_private ?? 0,
      visitorCount: counts.visitor ?? 0,
      suspectedExternal: counts.suspected_external ?? 0,
      pendingReview: counts.pending_review ?? 0,
      noParkingCount: noParking,
    },
  };
}

export async function queryDashboardSummary(db: Database, ctx: ToolContext) {
  const onlineDevices = await db.query<{ c: number }>(`
    SELECT count(*)::int AS c FROM vehicles v
    WHERE v.archived=false AND (
      v.last_seen_at > now() - interval '2 minutes'
      OR EXISTS (
        SELECT 1 FROM telemetry_points t
        WHERE t.vehicle_id=v.id AND t.occurred_at > now() - interval '2 minutes'
      )
    ) AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=v.id AND vm.user_id=$1))`, [ctx.memberId]);
  const todayPatrols = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM patrol_tasks t WHERE started_at >= date_trunc('day', now())
     AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=t.vehicle_id AND vm.user_id=$1))`, [ctx.memberId],
  );
  const pendingReviews = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM reviews r JOIN patrol_events e ON e.id=r.event_id JOIN patrol_tasks t ON t.id=e.task_id
     WHERE r.status='pending' AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=t.vehicle_id AND vm.user_id=$1))`, [ctx.memberId],
  );
  const violations = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM violations v WHERE disposition='pending'
     AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id=v.vehicle_id AND vm.user_id=$1))`, [ctx.memberId],
  );
  return {
    onlineDevices: onlineDevices.rows[0]?.c ?? 0,
    todayPatrols: todayPatrols.rows[0]?.c ?? 0,
    pendingReviews: pendingReviews.rows[0]?.c ?? 0,
    pendingViolations: violations.rows[0]?.c ?? 0,
  };
}
