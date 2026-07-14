import type { Database } from '../../db/index.js';
import type { ToolContext } from '../types.js';

export async function queryDevices(db: Database, ctx: ToolContext) {
  const result = await db.query<{
    id: string;
    code: string;
    name: string;
    tcp_host: string;
    tcp_port: number;
    video_port: number;
    bridge_url: string | null;
    last_seen_at: Date | null;
    recent_telem: Date | null;
  }>(
    `SELECT v.id, v.code, v.name, v.tcp_host, v.tcp_port, v.video_port, v.bridge_url, v.last_seen_at,
            (SELECT t.occurred_at FROM telemetry_points t
             WHERE t.vehicle_id = v.id AND t.occurred_at > now() - interval '2 minutes'
             ORDER BY t.occurred_at DESC LIMIT 1) AS recent_telem
     FROM vehicles v
     WHERE v.archived = false
       AND ($1::uuid IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = v.id AND vm.user_id = $1
       ))
     ORDER BY v.name
     LIMIT 100`,
    [ctx.memberId],
  );
  return {
    count: result.rows.length,
    devices: result.rows.map((row) => {
      const seenRecently = row.last_seen_at
        ? Date.now() - new Date(row.last_seen_at).getTime() < 2 * 60_000
        : false;
      const online = Boolean(row.recent_telem) || seenRecently;
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        host: row.tcp_host,
        tcpPort: row.tcp_port,
        videoPort: row.video_port,
        hasBridgeUrl: Boolean(row.bridge_url?.trim()),
        online,
        lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
      };
    }),
  };
}

export async function diagnoseDeviceConnection(db: Database, ctx: ToolContext, deviceId: string) {
  const access = await db.query<{ ok: number }>(
    `SELECT 1 AS ok FROM vehicles v
     WHERE v.id = $1 AND v.archived = false
       AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_members vm WHERE vm.vehicle_id = v.id AND vm.user_id = $2
       ))`,
    [deviceId, ctx.memberId],
  );
  if (!access.rows[0]) {
    return { found: false, message: '未找到该设备或当前用户无权访问。' };
  }

  const vehicle = await db.query<{
    id: string;
    name: string;
    code: string;
    tcp_host: string;
    tcp_port: number;
    bridge_url: string | null;
    last_seen_at: Date | null;
  }>('SELECT id, name, code, tcp_host, tcp_port, bridge_url, last_seen_at FROM vehicles WHERE id=$1', [deviceId]);
  const row = vehicle.rows[0]!;

  const telem = await db.query<{ occurred_at: Date; battery_pct: number | null; mode: string | null }>(
    `SELECT occurred_at, battery_pct, mode FROM telemetry_points
     WHERE vehicle_id=$1 AND occurred_at > now() - interval '2 minutes'
     ORDER BY occurred_at DESC LIMIT 1`,
    [deviceId],
  );
  const lease = await db.query<{ id: string; user_id: string; expires_at: Date; username: string | null }>(
    `SELECT cl.id, cl.user_id, cl.expires_at, u.username
     FROM control_leases cl
     LEFT JOIN users u ON u.id = cl.user_id
     WHERE cl.vehicle_id=$1 AND cl.released_at IS NULL AND cl.expires_at > now()
     LIMIT 1`,
    [deviceId],
  );
  const patrol = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM patrol_tasks
     WHERE vehicle_id=$1 AND status IN ('queued','running','cancellation_requested')
     LIMIT 1`,
    [deviceId],
  );

  const seenRecently = row.last_seen_at
    ? Date.now() - new Date(row.last_seen_at).getTime() < 2 * 60_000
    : false;
  const online = Boolean(telem.rows[0]) || seenRecently;
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!online) {
    issues.push('设备离线：2 分钟内无遥测且 last_seen 过期');
    suggestions.push('检查边缘 agent（GPS/网络）是否在跑，以及小车是否在同一局域网');
  }
  if (!row.bridge_url?.trim()) {
    issues.push('未配置 bridge_url');
    suggestions.push('在设备管理中为该车填写边缘 Bridge 地址（若使用平台遥测）');
  }
  if (lease.rows[0]) {
    issues.push(`控制租约被占用（用户 ${lease.rows[0].username ?? lease.rows[0].user_id}）`);
    suggestions.push('等待租约过期，或请占用方在控制台释放租约后重试');
  }
  if (patrol.rows[0]) {
    issues.push(`存在活动巡检任务（状态 ${patrol.rows[0].status}）`);
    suggestions.push('先在巡检任务页停止当前巡检，再尝试人工控车连接');
  }
  if (!issues.length) {
    suggestions.push('平台侧状态正常。若仍无法控车，核对本机网关是否运行在 127.0.0.1:8787，以及设备 TCP 主机/端口是否正确（勿向浏览器暴露原始 TCP 命令）');
  }

  return {
    found: true,
    device: {
      id: row.id,
      name: row.name,
      code: row.code,
      host: row.tcp_host,
      tcpPort: row.tcp_port,
      online,
      hasBridgeUrl: Boolean(row.bridge_url?.trim()),
      lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
      recentTelemetry: telem.rows[0]
        ? {
            occurredAt: telem.rows[0].occurred_at.toISOString(),
            batteryPct: telem.rows[0].battery_pct,
            mode: telem.rows[0].mode,
          }
        : null,
      activeLease: lease.rows[0]
        ? {
            leaseId: lease.rows[0].id,
            userId: lease.rows[0].user_id,
            username: lease.rows[0].username,
            expiresAt: lease.rows[0].expires_at.toISOString(),
          }
        : null,
      activePatrol: patrol.rows[0] ?? null,
    },
    issues,
    suggestions,
  };
}
