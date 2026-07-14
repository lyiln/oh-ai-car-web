import type { Database } from '../../db/index.js';
import type { DailyObservationRow, DailyReportStats, ToolContext } from '../types.js';

export async function queryDailyObservations(
  db: Database,
  ctx: ToolContext,
  date: string,
  deviceId?: string,
): Promise<{ observations: DailyObservationRow[]; violationCount: number; patrolTaskCount: number }> {
  const tasks = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM patrol_tasks t
     WHERE t.started_at::date = $1::date
       AND ($2::uuid IS NULL OR t.vehicle_id = $2)
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = t.vehicle_id AND vm.user_id = $3
       ))`,
    [date, deviceId ?? null, ctx.memberId],
  );
  const observations = await db.query<{
    plate: string | null;
    classification: string;
    confidence: number;
    no_parking: boolean;
    waypoint_name: string;
    occurred_at: Date;
    device_name: string;
    task_id: string;
    observation_count: number;
  }>(
    `SELECT po.plate, po.classification, po.confidence, po.no_parking,
            COALESCE(w.name, '未知航点') AS waypoint_name,
            po.occurred_at, v.name AS device_name, po.task_id, po.observation_count
     FROM plate_observations po
     JOIN patrol_tasks t ON t.id = po.task_id
     JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN patrol_waypoints w ON w.id = po.waypoint_id
     WHERE po.occurred_at::date = $1::date
       AND ($2::uuid IS NULL OR t.vehicle_id = $2)
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = t.vehicle_id AND vm.user_id = $3
       ))
     ORDER BY po.occurred_at DESC
     LIMIT 500`,
    [date, deviceId ?? null, ctx.memberId],
  );
  const violations = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM violations vio
     WHERE vio.occurred_at::date = $1::date
       AND ($2::uuid IS NULL OR vio.vehicle_id = $2)
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = vio.vehicle_id AND vm.user_id = $3
       ))`,
    [date, deviceId ?? null, ctx.memberId],
  );
  return {
    patrolTaskCount: tasks.rows[0]?.c ?? 0,
    violationCount: violations.rows[0]?.c ?? 0,
    observations: observations.rows.map((row) => ({
      plate: row.plate,
      classification: row.classification,
      confidence: row.confidence,
      noParking: row.no_parking,
      waypointName: row.waypoint_name,
      occurredAt: row.occurred_at.toISOString(),
      deviceName: row.device_name,
      taskId: row.task_id,
      observationCount: row.observation_count,
    })),
  };
}

export function buildDailyReportStats(
  date: string,
  data: { observations: DailyObservationRow[]; violationCount: number; patrolTaskCount: number },
): DailyReportStats {
  const intrusionPlates = new Set<string>();
  const illegalParkingPlates = new Set<string>();
  const pendingReviewPlates = new Set<string>();

  for (const obs of data.observations) {
    const plate = obs.plate?.trim() || '未知车牌';
    if (obs.classification === 'suspected_external') intrusionPlates.add(plate);
    if (obs.noParking) illegalParkingPlates.add(plate);
    if (obs.classification === 'pending_review') pendingReviewPlates.add(plate);
  }

  return {
    reportDate: date,
    patrolTaskCount: data.patrolTaskCount,
    observationCount: data.observations.length,
    violationCount: data.violationCount,
    intrusionCount: intrusionPlates.size,
    illegalParkingCount: illegalParkingPlates.size,
    pendingReviewCount: pendingReviewPlates.size,
    intrusionPlates: [...intrusionPlates],
    illegalParkingPlates: [...illegalParkingPlates],
    pendingReviewPlates: [...pendingReviewPlates],
  };
}

export function classifyObservationHighlight(obs: DailyObservationRow): string | null {
  const plate = obs.plate?.trim() || '未知车牌';
  if (obs.classification === 'suspected_external' && obs.noParking) {
    return `${plate}：闯入车且乱停（${obs.waypointName}）`;
  }
  if (obs.classification === 'suspected_external') {
    return `${plate}：闯入/外来车（${obs.waypointName}）`;
  }
  if (obs.noParking && obs.classification === 'registered_private') {
    return `${plate}：登记私家车乱停（${obs.waypointName}）`;
  }
  if (obs.noParking && obs.classification === 'visitor') {
    return `${plate}：访客乱停（${obs.waypointName}）`;
  }
  if (obs.noParking) {
    return `${plate}：违规停车（${obs.waypointName}）`;
  }
  if (obs.classification === 'pending_review') {
    return `${plate}：待人工复核（置信度 ${(obs.confidence * 100).toFixed(0)}%）`;
  }
  return null;
}
