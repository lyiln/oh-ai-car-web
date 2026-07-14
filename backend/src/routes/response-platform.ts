import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { generateAdvice } from '../ai-advisor.js';
import type { Database } from '../db/index.js';
import { matchWhitelistPlate, type PlateMatchResult } from '../plate-match.js';
import { isWxPusherConfigured, sendWxPusherMessage, type WxPusherConfig } from '../notify/wxpusher.js';

type User = { id: string; role: 'admin' | 'operator' };
type Hub = { publishPatrol: (message: { vehicleId: string; [key: string]: unknown }) => void };

export interface ResponseRouteDeps {
  db: Database;
  requireUser: (request: FastifyRequest) => Promise<User>;
  requireAdmin: (request: FastifyRequest) => Promise<User>;
  canAccessVehicle: (user: User, vehicleId: string) => Promise<boolean>;
  deviceVehicle: (request: FastifyRequest) => Promise<string>;
  audit: (action: string, outcome: string, actorUserId?: string, vehicleId?: string, metadata?: Record<string, unknown>) => Promise<void>;
  hub: Hub;
  ai: { baseUrl?: string; apiKey?: string; model: string };
  wxPusher: WxPusherConfig;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`${field} is required`), { statusCode: 400 });
  return value.trim();
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Object.assign(new Error(`${field} is invalid`), { statusCode: 400 });
  return value;
}

const RESPONSE_SELECT = `
  SELECT rt.id, rt.observation_id AS "observationId", rt.violation_id AS "violationId",
    rt.source_patrol_task_id AS "sourcePatrolTaskId", rt.source_vehicle_id AS "sourceVehicleId",
    rt.assigned_vehicle_id AS "assignedVehicleId", rt.destination_id AS "destinationId",
    rt.plate, rt.owner_name AS "ownerName", rt.building, rt.status,
    rt.eligibility_reason AS "eligibilityReason", rt.ai_suggestion AS "aiSuggestion",
    rt.notification_text AS "notificationText", rt.arrival_evidence_url AS "arrivalEvidenceUrl",
    rt.failure_reason AS "failureReason", rt.created_at AS "createdAt", rt.confirmed_at AS "confirmedAt",
    rt.assigned_at AS "assignedAt", rt.navigation_started_at AS "navigationStartedAt",
    rt.arrived_at AS "arrivedAt", rt.completed_at AS "completedAt",
    rt.owner_wx_uid AS "ownerWxUid",
    rt.sms_status AS "smsStatus", rt.sms_error AS "smsError",
    rt.sms_sent_at AS "smsSentAt",
    d.display_name AS "destinationName", d.map_version AS "mapVersion", d.x, d.y, d.yaw,
    sv.name AS "sourceVehicleName", av.name AS "assignedVehicleName",
    po.evidence_image_url AS "evidenceUrl", po.confidence, pw.name AS waypoint
  FROM response_tasks rt
  JOIN resident_destinations d ON d.id=rt.destination_id
  JOIN vehicles sv ON sv.id=rt.source_vehicle_id
  LEFT JOIN vehicles av ON av.id=rt.assigned_vehicle_id
  JOIN plate_observations po ON po.id=rt.observation_id
  JOIN patrol_waypoints pw ON pw.id=po.waypoint_id
`;

export async function createResponseCandidate(
  db: Database,
  hub: Hub,
  input: {
    observationId: string;
    taskId: string;
    vehicleId: string;
    plate: string | null;
    /** Full whitelist plate resolved by exact/partial match; defaults to scanned plate. */
    matchedPlate?: string | null;
    plateMatch?: PlateMatchResult | null;
    confidence: number;
    noParking: boolean;
    evidenceUrl: string | null;
  },
): Promise<{ responseEligible: boolean; responseTaskId?: string; reason: string; ownerName?: string; building?: string; destinationId?: string }> {
  if (!input.noParking) return { responseEligible: false, reason: 'not_in_no_parking_roi' };
  if (!input.evidenceUrl) return { responseEligible: false, reason: 'evidence_required' };
  if (!input.plate || input.confidence < 0.75) return { responseEligible: false, reason: 'plate_review_required' };

  // Prefer the plateMatch from observation classification so doorstep follows the same rules
  // (exact + partial scan⊆whitelist + whitelist⊆scan). Recompute if not provided.
  let resolvedMatch: PlateMatchResult | null = input.plateMatch && input.plateMatch.category === 'private'
    ? input.plateMatch
    : null;
  if (!resolvedMatch) {
    const entries = await db.query<{ plate: string; category: 'private' | 'visitor' }>(
      `SELECT e.plate, e.category
       FROM patrol_tasks t JOIN whitelist_entries e ON e.whitelist_id=t.whitelist_id
       WHERE t.id=$1`,
      [input.taskId],
    );
    const recomputed = matchWhitelistPlate(input.plate, entries.rows);
    if (!recomputed || recomputed.category !== 'private') {
      return { responseEligible: false, reason: 'registered_private_vehicle_required' };
    }
    resolvedMatch = recomputed;
  }

  const lookupPlate = resolvedMatch.matchedPlate || input.matchedPlate || input.plate;
  const match = await db.query<{ owner_name: string; building: string; destination_id: string | null; wx_uid: string }>(
    `SELECT e.owner_name,e.building,e.destination_id,COALESCE(e.wx_uid,'') AS wx_uid
     FROM patrol_tasks t JOIN whitelist_entries e ON e.whitelist_id=t.whitelist_id
     WHERE t.id=$1 AND e.plate=$2 AND e.category='private' LIMIT 1`,
    [input.taskId, lookupPlate],
  );
  const entry = match.rows[0];
  if (!entry) return { responseEligible: false, reason: 'registered_private_vehicle_required' };
  let destinationId = entry.destination_id;
  if (!destinationId) {
    const destination = await db.query<{ id: string }>(
      'SELECT id FROM resident_destinations WHERE vehicle_id=$1 AND building=$2 AND resident_key=$3 AND active=true ORDER BY created_at DESC LIMIT 1',
      [input.vehicleId, entry.building, ''],
    );
    destinationId = destination.rows[0]?.id ?? null;
  }
  if (!destinationId) return { responseEligible: false, reason: 'resident_destination_required', ownerName: entry.owner_name, building: entry.building };
  const responseTaskId = randomUUID();
  const violationId = randomUUID();
  // Persist the resolved full plate so operators see the whitelist identity, not the OCR fragment.
  const plateForRecord = lookupPlate;
  const created = await db.transaction(async (client) => {
    const existing = await client.query<{ id: string; violation_id: string | null }>('SELECT id,violation_id FROM response_tasks WHERE observation_id=$1 FOR UPDATE', [input.observationId]);
    if (existing.rows[0]) return { id: existing.rows[0].id, violationId: existing.rows[0].violation_id, newlyCreated: false };
    const waypoint = await client.query<{ waypoint_id: string; name: string }>(
      'SELECT po.waypoint_id,pw.name FROM plate_observations po JOIN patrol_waypoints pw ON pw.id=po.waypoint_id WHERE po.id=$1',
      [input.observationId],
    );
    await client.query(
      `INSERT INTO violations (id,plate,violation_type,task_id,vehicle_id,waypoint,priority,disposition,evidence_url,occurred_at)
       SELECT $1,$2,'no_parking',$3,$4,$5,'high','pending',$6,occurred_at FROM plate_observations WHERE id=$7`,
      [violationId, plateForRecord, input.taskId, input.vehicleId, waypoint.rows[0]?.name ?? '', input.evidenceUrl, input.observationId],
    );
    await client.query(
      `INSERT INTO response_tasks
       (id,observation_id,violation_id,source_patrol_task_id,source_vehicle_id,destination_id,plate,owner_name,building,owner_wx_uid,status,eligibility_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_review','eligible_after_operator_confirmation')`,
      [responseTaskId, input.observationId, violationId, input.taskId, input.vehicleId, destinationId, plateForRecord, entry.owner_name, entry.building, entry.wx_uid],
    );
    return { id: responseTaskId, violationId, newlyCreated: true };
  });
  if (created.newlyCreated) {
    hub.publishPatrol({ type: 'response_status', responseTaskId: created.id, vehicleId: input.vehicleId, status: 'pending_review' });
    hub.publishPatrol({ type: 'violation_alert', violationId: created.violationId, vehicleId: input.vehicleId, plate: plateForRecord });
  }
  return { responseEligible: true, responseTaskId: created.id, reason: 'operator_confirmation_required', ownerName: entry.owner_name, building: entry.building, destinationId };
}

async function assignVehicle(db: Database, taskId: string): Promise<string> {
  return db.transaction(async (client) => {
    const task = await client.query<{ source_vehicle_id: string; map_version: string }>(
      `SELECT rt.source_vehicle_id,d.map_version FROM response_tasks rt JOIN resident_destinations d ON d.id=rt.destination_id
       WHERE rt.id=$1 AND rt.status='confirmed' FOR UPDATE`, [taskId],
    );
    if (!task.rows[0]) throw Object.assign(new Error('Response task is not assignable'), { statusCode: 409 });
    const candidates = await client.query<{ id: string }>(
      `SELECT v.id FROM vehicles v
       WHERE v.archived=false
         AND NOT EXISTS (SELECT 1 FROM response_tasks r WHERE r.assigned_vehicle_id=v.id AND r.status IN ('assigned','navigating','arrived','cancellation_requested'))
         AND NOT EXISTS (SELECT 1 FROM control_leases l WHERE l.vehicle_id=v.id AND l.released_at IS NULL AND l.expires_at>now())
         AND (v.id=$1 OR NOT EXISTS (SELECT 1 FROM patrol_tasks p WHERE p.vehicle_id=v.id AND p.status IN ('queued','running','cancellation_requested')))
         AND EXISTS (SELECT 1 FROM patrol_routes pr WHERE pr.vehicle_id=v.id AND pr.map_version=$2)
         AND (v.last_seen_at>now()-interval '2 minutes' OR EXISTS
           (SELECT 1 FROM telemetry_points online WHERE online.vehicle_id=v.id AND online.occurred_at>now()-interval '2 minutes'))
         AND (SELECT battery_pct FROM telemetry_points battery WHERE battery.vehicle_id=v.id ORDER BY occurred_at DESC LIMIT 1)>=20
       ORDER BY
         CASE WHEN v.id=$1 THEN 1 ELSE 0 END,
         CASE WHEN v.last_seen_at>now()-interval '2 minutes' THEN 0 ELSE 1 END,
         COALESCE((SELECT t.battery_pct FROM telemetry_points t WHERE t.vehicle_id=v.id ORDER BY t.occurred_at DESC LIMIT 1),-1) DESC,
         v.code
       FOR UPDATE OF v SKIP LOCKED LIMIT 1`,
      [task.rows[0].source_vehicle_id, task.rows[0].map_version],
    );
    const vehicleId = candidates.rows[0]?.id;
    if (!vehicleId) throw Object.assign(new Error('No safe response vehicle is available'), { statusCode: 409 });
    await client.query("UPDATE response_tasks SET assigned_vehicle_id=$1,status='assigned',assigned_at=now(),updated_at=now() WHERE id=$2", [vehicleId, taskId]);
    await client.query("INSERT INTO response_task_events (id,task_id,event_type,details) VALUES ($1,$2,'assigned',$3)", [randomUUID(), taskId, JSON.stringify({ vehicleId })]);
    return vehicleId;
  });
}

export type OwnerPushStatus = {
  status: 'sent' | 'failed' | 'skipped_no_uid' | 'skipped_not_configured';
  message: string;
  requestId?: string;
};

/** Exported for unit tests */
export async function notifyOwnerPush(
  db: Database,
  push: WxPusherConfig,
  input: { responseTaskId: string; plate: string; wxUid: string; location: string; content: string },
): Promise<OwnerPushStatus> {
  const wxUid = input.wxUid.trim();
  if (!wxUid) {
    await db.query(
      `UPDATE response_tasks SET sms_status='skipped_no_uid', sms_error='', updated_at=now() WHERE id=$1`,
      [input.responseTaskId],
    );
    await db.query(
      `INSERT INTO sms_notifications (id, response_task_id, plate, wx_uid, body, provider, status, error)
       VALUES ($1,$2,$3,'',$4,'wxpusher','skipped','no wx_uid on whitelist entry')`,
      [randomUUID(), input.responseTaskId, input.plate, input.content],
    );
    return { status: 'skipped_no_uid', message: '白名单未登记 WxPusher UID，已跳过推送' };
  }

  if (!isWxPusherConfigured(push)) {
    await db.query(
      `UPDATE response_tasks SET sms_status='skipped_not_configured', sms_error='WxPusher is not configured', updated_at=now() WHERE id=$1`,
      [input.responseTaskId],
    );
    await db.query(
      `INSERT INTO sms_notifications (id, response_task_id, plate, wx_uid, body, provider, status, error)
       VALUES ($1,$2,$3,$4,$5,'wxpusher','skipped','WxPusher is not configured')`,
      [randomUUID(), input.responseTaskId, input.plate, wxUid, input.content],
    );
    return { status: 'skipped_not_configured', message: '未配置 WxPusher，已跳过推送' };
  }

  const body = `【巡牌通乱停通知】\n车牌：${input.plate}\n位置：${input.location}\n${input.content}`;
  await db.query(`UPDATE response_tasks SET sms_status='queued', updated_at=now() WHERE id=$1`, [input.responseTaskId]);
  const result = await sendWxPusherMessage(push, {
    uid: wxUid,
    content: body,
    summary: `乱停通知 · ${input.plate}`,
  });

  if (result.ok) {
    await db.query(
      `UPDATE response_tasks SET sms_status='sent', sms_sent_at=now(), sms_error='', updated_at=now() WHERE id=$1`,
      [input.responseTaskId],
    );
    await db.query(
      `INSERT INTO sms_notifications (id, response_task_id, plate, wx_uid, body, provider, provider_request_id, status)
       VALUES ($1,$2,$3,$4,$5,'wxpusher',$6,'sent')`,
      [randomUUID(), input.responseTaskId, input.plate, wxUid, body, result.messageId ?? null],
    );
    return { status: 'sent', message: '车主 WxPusher 推送已发送', requestId: result.messageId };
  }

  const error = result.error ?? 'WxPusher send failed';
  await db.query(
    `UPDATE response_tasks SET sms_status='failed', sms_error=$2, updated_at=now() WHERE id=$1`,
    [input.responseTaskId, error],
  );
  await db.query(
    `INSERT INTO sms_notifications (id, response_task_id, plate, wx_uid, body, provider, provider_request_id, status, error)
     VALUES ($1,$2,$3,$4,$5,'wxpusher',$6,'failed',$7)`,
    [randomUUID(), input.responseTaskId, input.plate, wxUid, body, result.messageId ?? null, error],
  );
  return { status: 'failed', message: `推送失败：${error}`, requestId: result.messageId };
}

export function registerResponsePlatformRoutes(app: FastifyInstance, deps: ResponseRouteDeps): void {
  const { db, requireUser, requireAdmin, canAccessVehicle, deviceVehicle, audit, hub, ai, wxPusher } = deps;

  app.get('/api/resident-destinations', async (request) => {
    const user = await requireUser(request);
    const vehicleId = requiredString((request.query as { vehicleId?: string }).vehicleId, 'vehicleId');
    if (!await canAccessVehicle(user, vehicleId)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    const result = await db.query(
      `SELECT id,vehicle_id AS "vehicleId",building,resident_key AS "residentKey",display_name AS "displayName",
       map_version AS "mapVersion",x,y,yaw,active FROM resident_destinations WHERE vehicle_id=$1 ORDER BY building,resident_key`, [vehicleId],
    );
    return { destinations: result.rows };
  });

  app.post('/api/resident-destinations', async (request) => {
    const admin = await requireAdmin(request);
    const body = record(request.body);
    const vehicleId = requiredString(body?.vehicleId, 'vehicleId');
    const id = randomUUID();
    const building = requiredString(body?.building, 'building');
    const residentKey = typeof body?.residentKey === 'string' ? body.residentKey.trim() : '';
    const displayName = requiredString(body?.displayName, 'displayName');
    const mapVersion = requiredString(body?.mapVersion, 'mapVersion');
    const x = finite(body?.x, 'x'); const y = finite(body?.y, 'y'); const yaw = finite(body?.yaw, 'yaw');
    await db.query(
      `INSERT INTO resident_destinations (id,vehicle_id,building,resident_key,display_name,map_version,x,y,yaw,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, vehicleId, building, residentKey, displayName, mapVersion, x, y, yaw, admin.id],
    );
    await audit('resident_destination.create', 'success', admin.id, vehicleId, { destinationId: id });
    return { destination: { id, vehicleId, building, residentKey, displayName, mapVersion, x, y, yaw, active: true } };
  });

  app.put('/api/resident-destinations/:id', async (request) => {
    const admin = await requireAdmin(request); const id = (request.params as { id: string }).id; const body = record(request.body);
    const result = await db.query<{ vehicle_id: string }>(
      `UPDATE resident_destinations SET display_name=COALESCE($1,display_name),x=COALESCE($2,x),y=COALESCE($3,y),yaw=COALESCE($4,yaw),
       active=COALESCE($5,active),updated_at=now() WHERE id=$6 RETURNING vehicle_id`,
      [typeof body?.displayName === 'string' ? body.displayName.trim() : null, typeof body?.x === 'number' ? finite(body.x, 'x') : null,
        typeof body?.y === 'number' ? finite(body.y, 'y') : null, typeof body?.yaw === 'number' ? finite(body.yaw, 'yaw') : null,
        typeof body?.active === 'boolean' ? body.active : null, id],
    );
    if (!result.rows[0]) throw Object.assign(new Error('Destination not found'), { statusCode: 404 });
    await audit('resident_destination.update', 'success', admin.id, result.rows[0].vehicle_id, { destinationId: id });
    return { ok: true };
  });

  app.get('/api/response-tasks', async (request) => {
    const user = await requireUser(request);
    const status = (request.query as { status?: string }).status;
    const values: unknown[] = [user.role === 'admin' ? null : user.id];
    const statusSql = status ? 'AND rt.status=$2' : '';
    if (status) values.push(status);
    const result = await db.query(`${RESPONSE_SELECT}
      WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicle_members vm WHERE vm.user_id=$1 AND vm.vehicle_id IN (rt.source_vehicle_id,rt.assigned_vehicle_id)))
      ${statusSql} ORDER BY rt.created_at DESC LIMIT 200`, values);
    return { tasks: result.rows };
  });

  app.get('/api/response-tasks/:id', async (request) => {
    const user = await requireUser(request); const id = (request.params as { id: string }).id;
    const result = await db.query(`${RESPONSE_SELECT} WHERE rt.id=$1 AND ($2::uuid IS NULL OR EXISTS
      (SELECT 1 FROM vehicle_members vm WHERE vm.user_id=$2 AND vm.vehicle_id IN (rt.source_vehicle_id,rt.assigned_vehicle_id)))`, [id, user.role === 'admin' ? null : user.id]);
    if (!result.rows[0]) throw Object.assign(new Error('Response task not found'), { statusCode: 404 });
    const events = await db.query('SELECT id,event_type AS "eventType",details,created_at AS "createdAt" FROM response_task_events WHERE task_id=$1 ORDER BY created_at', [id]);
    return { task: result.rows[0], events: events.rows };
  });

  app.post('/api/response-tasks/:id/confirm', async (request) => {
    const user = await requireUser(request); const id = (request.params as { id: string }).id;
    const row = await db.query<{
      source_vehicle_id: string; plate: string; building: string; waypoint: string; confidence: number; owner_wx_uid: string;
    }>(
      `SELECT rt.source_vehicle_id,rt.plate,rt.building,pw.name AS waypoint,po.confidence,COALESCE(rt.owner_wx_uid,'') AS owner_wx_uid
       FROM response_tasks rt
       JOIN plate_observations po ON po.id=rt.observation_id JOIN patrol_waypoints pw ON pw.id=po.waypoint_id
       WHERE rt.id=$1 AND rt.status='pending_review'`, [id],
    );
    if (!row.rows[0]) throw Object.assign(new Error('Response task is not awaiting confirmation'), { statusCode: 409 });
    if (!await canAccessVehicle(user, row.rows[0].source_vehicle_id)) throw Object.assign(new Error('Vehicle access denied'), { statusCode: 403 });
    const advice = await generateAdvice({ plate: row.rows[0].plate, building: row.rows[0].building, waypoint: row.rows[0].waypoint, confidence: row.rows[0].confidence }, ai);
    const confirmed = await db.query("UPDATE response_tasks SET status='confirmed',confirmed_by_user_id=$1,confirmed_at=now(),ai_suggestion=$2,notification_text=$3,updated_at=now() WHERE id=$4 AND status='pending_review' RETURNING id", [user.id, advice.suggestion, advice.notification, id]);
    if (!confirmed.rowCount) throw Object.assign(new Error('Response task was already confirmed'), { statusCode: 409 });
    await audit('response.confirm', 'success', user.id, row.rows[0].source_vehicle_id, { responseTaskId: id, adviceSource: advice.source });
    hub.publishPatrol({ type: 'response_status', responseTaskId: id, vehicleId: row.rows[0].source_vehicle_id, status: 'confirmed' });

    const pushResult = await notifyOwnerPush(db, wxPusher, {
      responseTaskId: id,
      plate: row.rows[0].plate,
      wxUid: row.rows[0].owner_wx_uid,
      location: row.rows[0].waypoint,
      content: advice.notification,
    });

    try {
      const vehicleId = await assignVehicle(db, id);
      await audit('response.assign', 'success', user.id, vehicleId, { responseTaskId: id });
      hub.publishPatrol({ type: 'assignment_changed', responseTaskId: id, vehicleId, status: 'assigned' });
      return { ok: true, assignedVehicleId: vehicleId, assignmentPending: false, advice, push: pushResult };
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 409) throw error;
      await audit('response.assign', 'pending', user.id, row.rows[0].source_vehicle_id, { responseTaskId: id, reason: 'no_safe_vehicle' });
      return { ok: true, assignedVehicleId: null, assignmentPending: true, advice, push: pushResult };
    }
  });

  app.post('/api/response-tasks/:id/assign', async (request) => {
    const user = await requireUser(request); const id = (request.params as { id: string }).id;
    const task = await db.query<{ source_vehicle_id: string; assigned_vehicle_id: string | null; status: string }>('SELECT source_vehicle_id,assigned_vehicle_id,status FROM response_tasks WHERE id=$1', [id]);
    if (!task.rows[0] || !await canAccessVehicle(user, task.rows[0].source_vehicle_id)) throw Object.assign(new Error('Response task not found'), { statusCode: 404 });
    if (task.rows[0].status === 'assigned' && task.rows[0].assigned_vehicle_id) return { ok: true, assignedVehicleId: task.rows[0].assigned_vehicle_id, deduplicated: true };
    if (task.rows[0].status !== 'confirmed') throw Object.assign(new Error('Response task is not awaiting assignment'), { statusCode: 409 });
    let vehicleId: string;
    try {
      vehicleId = await assignVehicle(db, id);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 409) throw error;
      const assigned = await db.query<{ assigned_vehicle_id: string }>("SELECT assigned_vehicle_id FROM response_tasks WHERE id=$1 AND status='assigned'", [id]);
      if (!assigned.rows[0]?.assigned_vehicle_id) throw error;
      return { ok: true, assignedVehicleId: assigned.rows[0].assigned_vehicle_id, deduplicated: true };
    }
    await audit('response.assign', 'success', user.id, vehicleId, { responseTaskId: id, retry: true });
    hub.publishPatrol({ type: 'assignment_changed', responseTaskId: id, vehicleId, status: 'assigned' });
    return { ok: true, assignedVehicleId: vehicleId, deduplicated: false };
  });

  app.post('/api/response-tasks/:id/cancel', async (request) => {
    const user = await requireUser(request); const id = (request.params as { id: string }).id;
    const task = await db.query<{ source_vehicle_id: string; assigned_vehicle_id: string | null; status: string }>('SELECT source_vehicle_id,assigned_vehicle_id,status FROM response_tasks WHERE id=$1', [id]);
    if (!task.rows[0] || !await canAccessVehicle(user, task.rows[0].source_vehicle_id)) throw Object.assign(new Error('Response task not found'), { statusCode: 404 });
    if (task.rows[0].status === 'cancelled') return { ok: true, cancellationRequested: false, deduplicated: true };
    if (task.rows[0].status === 'cancellation_requested') return { ok: true, cancellationRequested: true, deduplicated: true };
    const immediate = ['pending_review', 'confirmed'].includes(task.rows[0].status);
    const result = immediate
      ? await db.query("UPDATE response_tasks SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE id=$1 AND status IN ('pending_review','confirmed') RETURNING id", [id])
      : await db.query("UPDATE response_tasks SET status='cancellation_requested',cancel_requested_at=now(),updated_at=now() WHERE id=$1 AND status IN ('assigned','navigating','arrived') RETURNING id", [id]);
    if (!result.rows[0]) throw Object.assign(new Error('Response task cannot be cancelled from its current state'), { statusCode: 409 });
    const nextStatus = immediate ? 'cancelled' : 'cancellation_requested';
    await audit('response.cancel', 'success', user.id, task.rows[0].source_vehicle_id, { responseTaskId: id });
    hub.publishPatrol({ type: 'response_status', responseTaskId: id, vehicleId: task.rows[0].assigned_vehicle_id ?? task.rows[0].source_vehicle_id, status: nextStatus });
    return { ok: true, cancellationRequested: !immediate, deduplicated: false };
  });

  app.get('/device/v1/response/tasks/next', async (request) => {
    const vehicleId = await deviceVehicle(request);
    const result = await db.query(`${RESPONSE_SELECT} WHERE rt.assigned_vehicle_id=$1 AND rt.status IN ('assigned','cancellation_requested') ORDER BY rt.assigned_at LIMIT 1`, [vehicleId]);
    return { task: result.rows[0] ?? null };
  });

  app.post('/device/v1/response/tasks/:id/events', async (request) => {
    const vehicleId = await deviceVehicle(request); const id = (request.params as { id: string }).id; const body = record(request.body);
    const eventId = requiredString(body?.eventId, 'eventId'); const type = requiredString(body?.type, 'type');
    const allowed = ['navigation_started', 'arrived', 'arrival_evidence', 'completed', 'failed', 'stop_confirmed'];
    if (!allowed.includes(type)) throw Object.assign(new Error('Unsupported response event'), { statusCode: 400 });
    const result = await db.transaction(async (client) => {
      const duplicate = await client.query('SELECT 1 FROM response_task_events WHERE task_id=$1 AND device_event_id=$2', [id, eventId]);
      if (duplicate.rowCount) return { duplicate: true, status: null as string | null };
      const task = await client.query<{ status: string }>('SELECT status FROM response_tasks WHERE id=$1 AND assigned_vehicle_id=$2 FOR UPDATE', [id, vehicleId]);
      if (!task.rows[0]) throw Object.assign(new Error('Response task not found'), { statusCode: 404 });
      if (type === 'stop_confirmed') {
        if (task.rows[0].status !== 'cancellation_requested' || body?.zeroVelocity !== true) throw Object.assign(new Error('Zero-velocity stop confirmation is required'), { statusCode: 409 });
        await client.query("UPDATE response_tasks SET status='cancelled',stop_confirmed_at=now(),cancelled_at=now(),updated_at=now() WHERE id=$1", [id]);
        await client.query('INSERT INTO response_task_events (id,task_id,device_event_id,event_type,details) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, eventId, type, JSON.stringify(body)]);
        return { duplicate: false, status: 'cancelled' };
      }
      const transitions: Record<string, { from: string; to: string }> = {
        navigation_started: { from: 'assigned', to: 'navigating' }, arrived: { from: 'navigating', to: 'arrived' },
        completed: { from: 'arrived', to: 'completed' },
      };
      if (type === 'arrival_evidence') {
        if (task.rows[0].status !== 'arrived' || typeof body?.evidenceUrl !== 'string' || !body.evidenceUrl.trim()) throw Object.assign(new Error('Arrival evidence is only accepted after arrival'), { statusCode: 409 });
        await client.query('UPDATE response_tasks SET arrival_evidence_url=$1,updated_at=now() WHERE id=$2', [body.evidenceUrl.trim(), id]);
      } else {
        const transition = type === 'failed' && ['assigned', 'navigating', 'arrived'].includes(task.rows[0].status)
          ? { from: task.rows[0].status, to: 'failed' }
          : transitions[type];
        if (!transition || task.rows[0].status !== transition.from) throw Object.assign(new Error('Invalid response task transition'), { statusCode: 409 });
        if ((type === 'arrived' || type === 'completed') && body?.zeroVelocity !== true) throw Object.assign(new Error('Zero-velocity confirmation is required'), { statusCode: 409 });
        if (type === 'completed') {
          const evidence = await client.query('SELECT 1 FROM response_tasks WHERE id=$1 AND arrival_evidence_url IS NOT NULL', [id]);
          if (!evidence.rowCount) throw Object.assign(new Error('Arrival evidence is required before completion'), { statusCode: 409 });
        }
        const timeColumn = type === 'navigation_started' ? 'navigation_started_at' : type === 'arrived' ? 'arrived_at' : type === 'completed' ? 'completed_at' : 'failed_at';
        await client.query(`UPDATE response_tasks SET status=$1,${timeColumn}=now(),failure_reason=$2,updated_at=now() WHERE id=$3`, [transition.to, type === 'failed' && typeof body?.reason === 'string' ? body.reason : null, id]);
      }
      await client.query('INSERT INTO response_task_events (id,task_id,device_event_id,event_type,details) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, eventId, type, JSON.stringify(body)]);
      return { duplicate: false, status: type === 'arrival_evidence' ? task.rows[0].status : transitions[type]?.to ?? task.rows[0].status };
    });
    if (!result.duplicate) hub.publishPatrol({ type: 'response_event', responseTaskId: id, vehicleId, eventType: type, status: result.status });
    return { ok: true, deduplicated: result.duplicate };
  });
}
