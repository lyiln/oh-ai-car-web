import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

const root = resolve(import.meta.dirname, '..');
for (const name of ['.env.development', '.env']) {
  const path = resolve(root, name);
  if (existsSync(path)) loadDotenv({ path, override: true });
}

if (!process.env.DATABASE_URL && process.env.DATABASE_HOST && process.env.DATABASE_USER && process.env.DATABASE_NAME) {
  const password = process.env.NEON_PASSWORD ?? process.env.DATABASE_PASSWORD;
  if (password) {
    const user = encodeURIComponent(process.env.DATABASE_USER);
    const host = process.env.DATABASE_HOST;
    const port = process.env.DATABASE_PORT ?? '5432';
    const database = process.env.DATABASE_NAME;
    process.env.DATABASE_URL = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=require`;
  }
}

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://oh_ai_car:oh_ai_car@127.0.0.1:5432/oh_ai_car';
const sent = process.argv.includes('--sent');
const plate = process.env.DEMO_PLATE?.trim() || '京A12345';
const wxUid = process.env.DEMO_WX_UID?.trim() || 'UID_DEMO_SCREENSHOT';
const client = new pg.Client({ connectionString: databaseUrl });

await client.connect();
try {
  await client.query('BEGIN');
  const migration = await client.query("SELECT 1 FROM schema_migrations WHERE version='024-wxpush-violation-flow'");
  if (!migration.rowCount) throw new Error('请先启动一次新版 backend，让 migration 024 完成');
  const admin = await client.query("SELECT id FROM users WHERE role='admin' AND active=true ORDER BY created_at LIMIT 1");
  if (!admin.rows[0]) throw new Error('没有管理员账号，请先启动 backend 创建 BOOTSTRAP_ADMIN_USERNAME');
  const adminId = admin.rows[0].id;

  const previous = await client.query("SELECT id FROM vehicles WHERE code='DEMO-WXPUSH-SCREENSHOT'");
  if (previous.rows[0]) {
    await client.query(
      'DELETE FROM response_tasks WHERE source_vehicle_id=$1 OR assigned_vehicle_id=$1',
      [previous.rows[0].id],
    );
    await client.query('DELETE FROM vehicles WHERE id=$1', [previous.rows[0].id]);
  }

  const vehicleId = randomUUID();
  const routeId = randomUUID();
  const waypointId = randomUUID();
  const whitelistId = randomUUID();
  const whitelistEntryId = randomUUID();
  const taskId = randomUUID();
  const observationId = randomUUID();
  const eventId = randomUUID();
  const reviewId = randomUUID();
  const violationId = randomUUID();
  const responseId = randomUUID();
  const now = new Date();
  const bucket = new Date(Math.floor(now.getTime() / 1_800_000) * 1_800_000);

  const sample = resolve(root, 'YOLOv5/oh-ai-car-YOLOv5/demo_input/hard_batch_20/00507064176245-90_86-318&485_449&527-446&524_327&523_325&489_445&490-0_0_12_33_31_31_33-136-22.jpg');
  const evidenceDir = resolve(root, process.env.EVIDENCE_STORAGE_DIR || 'backend/data/evidence');
  const evidenceName = 'demo-wxpush-screenshot.jpg';
  mkdirSync(evidenceDir, { recursive: true });
  if (existsSync(sample)) copyFileSync(sample, resolve(evidenceDir, evidenceName));
  const evidenceUrl = existsSync(sample) ? `/api/evidence/${evidenceName}` : 'https://placehold.co/960x540.jpg?text=WxPusher+Demo';

  await client.query("INSERT INTO vehicles (id,code,name,description,tcp_host,tcp_port,video_port) VALUES ($1,'DEMO-WXPUSH-SCREENSHOT','微信通知演示车','一键截图演示数据','127.0.0.1',6000,6500)", [vehicleId]);
  await client.query('INSERT INTO vehicle_members (vehicle_id,user_id) VALUES ($1,$2)', [vehicleId, adminId]);
  await client.query("INSERT INTO patrol_routes (id,vehicle_id,name,code,map_version,source_yaml,created_by_user_id) VALUES ($1,$2,'截图演示路线','DEMO-WX','demo-map-v1','demo',$3)", [routeId, vehicleId, adminId]);
  await client.query("INSERT INTO patrol_waypoints (id,route_id,ordinal,name,x,y,yaw,dwell_seconds,no_parking_roi) VALUES ($1,$2,0,'东门禁停区',1,2,0,8,'[0.1,0.1,0.9,0.9]'::jsonb)", [waypointId, routeId]);
  await client.query("INSERT INTO whitelist_imports (id,vehicle_id,name,created_by_user_id,is_snapshot) VALUES ($1,$2,'微信通知演示白名单',$3,true)", [whitelistId, vehicleId, adminId]);
  await client.query("INSERT INTO whitelist_entries (id,whitelist_id,plate,owner_name,building,category,parking_spot,wx_uid) VALUES ($1,$2,$3,'张同学','3号楼','private','A-018',$4)", [whitelistEntryId, whitelistId, plate, wxUid]);
  await client.query("INSERT INTO patrol_tasks (id,vehicle_id,route_id,whitelist_id,shift,status,created_by_user_id,started_at,finished_at) VALUES ($1,$2,$3,$4,'morning','completed',$5,$6,$6)", [taskId, vehicleId, routeId, whitelistId, adminId, now]);
  await client.query("INSERT INTO plate_observations (id,task_id,waypoint_id,occurred_at,dedupe_bucket,dedupe_key,plate,confidence,classification,no_parking,evidence_image_url,observation_count,last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0.96,'registered_private',true,$8,3,$4)", [observationId, taskId, waypointId, now, bucket, `${plate}:demo`, plate, evidenceUrl]);
  await client.query("INSERT INTO patrol_events (id,task_id,event_type,waypoint_id,waypoint,plate,confidence,evidence_url,review_status,occurred_at,details) VALUES ($1,$2,'observation',$3,'东门禁停区',$4,0.96,$5,$6,$7,$8)", [eventId, taskId, waypointId, plate, evidenceUrl, sent ? 'confirmed' : 'pending', now, JSON.stringify({ source: 'screenshot_demo', observationId })]);
  await client.query("INSERT INTO reviews (id,event_id,reason,status,resolution,resolver_id,resolved_at) VALUES ($1,$2,'console_scan_test',$3,$4,$5,$6)", [reviewId, eventId, sent ? 'resolved' : 'pending', sent ? 'confirmed' : null, sent ? adminId : null, sent ? now : null]);
  await client.query("INSERT INTO violations (id,event_id,observation_id,plate,violation_type,task_id,vehicle_id,waypoint,priority,disposition,evidence_url,occurred_at,source,dedupe_key,dedupe_bucket) VALUES ($1,$2,$3,$4,'no_parking',$5,$6,'东门禁停区','high','pending',$7,$8,'screenshot_demo',$9,$10)", [violationId, eventId, observationId, plate, taskId, vehicleId, evidenceUrl, now, `${plate}:demo`, bucket]);
  await client.query("INSERT INTO response_tasks (id,observation_id,violation_id,source_patrol_task_id,source_vehicle_id,destination_id,plate,owner_name,building,owner_wx_uid,status,eligibility_reason,notification_only,ai_suggestion,notification_text,sms_status,sms_sent_at,completed_at) VALUES ($1,$2,$3,$4,$5,NULL,$6,'张同学','3号楼',$7,$8,'wxpush_after_operator_confirmation',true,'请尽快将车辆移出禁停区域。','您的车辆位于东门禁停区，请尽快移车。',$9,$10,$10)", [responseId, observationId, violationId, taskId, vehicleId, plate, wxUid, sent ? 'completed' : 'pending_review', sent ? 'sent' : 'none', sent ? now : null]);
  await client.query('COMMIT');

  console.log(`演示数据已生成：${sent ? '已推送截图态（未真实发送）' : '待人工确认态'}`);
  console.log(`车牌：${plate}  WxUID：${wxUid}`);
  console.log('截图页面：');
  console.log('  http://127.0.0.1:5173/violations');
  console.log('  http://127.0.0.1:5173/reviews');
  console.log('  http://127.0.0.1:5173/responses');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
