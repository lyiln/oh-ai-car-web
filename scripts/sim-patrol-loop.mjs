#!/usr/bin/env node
// 阶段 C 本机闭环：不依赖 ROS。轮询领取巡检任务 → 假导航（可选上报 pose）→ 上报航点/完成；
// 若平台进入 cancellation_requested 则 cancel 并上报 stop_confirmed。
//
// 用法：
//   npm run sim:patrol -- <deviceCredentialToken> [platformApiUrl]
//   DEVICE_CREDENTIAL=... PLATFORM_API_URL=http://127.0.0.1:8788 npm run sim:patrol
//
// 可选：
//   SIM_TRAVEL_SECONDS=2   每航点行驶秒数
//   POLL_SECONDS=2
//   MAP_VERSION=floor-map-v1
//   PUBLISH_POSE=true

const token = process.env.DEVICE_CREDENTIAL ?? process.argv[2];
const baseUrl = (process.env.PLATFORM_API_URL ?? process.argv[3] ?? 'http://127.0.0.1:8788').replace(/\/$/, '');
const travelSeconds = Number(process.env.SIM_TRAVEL_SECONDS ?? 2);
const pollSeconds = Number(process.env.POLL_SECONDS ?? 2);
const mapVersion = process.env.MAP_VERSION ?? 'floor-map-v1';
const publishPose = (process.env.PUBLISH_POSE ?? 'true') !== 'false';

if (!token || !token.includes('.')) {
  console.error('缺少设备凭据。用法: npm run sim:patrol -- <id.secret> [platformApiUrl]');
  process.exit(1);
}

async function api(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(value.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.body = value;
    throw error;
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postPose(x, y, yaw) {
  if (!publishPose) return;
  try {
    await api('POST', '/device/v1/pose', {
      points: [{ occurredAt: new Date().toISOString(), x, y, yaw, mapVersion }],
    });
  } catch {
    /* best effort */
  }
}

async function navigate(from, goal, shouldCancel) {
  const steps = Math.max(1, Math.round(travelSeconds / 0.2));
  for (let index = 1; index <= steps; index += 1) {
    if (await shouldCancel()) return false;
    const t = index / steps;
    const x = from.x + (goal.x - from.x) * t;
    const y = from.y + (goal.y - from.y) * t;
    const yaw = from.yaw + (goal.yaw - from.yaw) * t;
    await postPose(x, y, yaw);
    await sleep((travelSeconds * 1000) / steps);
  }
  await postPose(goal.x, goal.y, goal.yaw);
  return true;
}

async function taskStatus(taskId) {
  const result = await api('GET', `/device/v1/patrol/tasks/${taskId}`);
  return result.task?.status ?? '';
}

async function runTask(task) {
  const taskId = task.id;
  const waypoints = [...(task.waypoints ?? [])].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  console.log(`claimed task ${taskId} with ${waypoints.length} waypoint(s)`);
  let pose = { x: 0, y: 0, yaw: 0 };

  const cancelled = async () => {
    try {
      const status = await taskStatus(taskId);
      return status === 'cancellation_requested' || status === 'stopped' || status === 'completed' || status === 'failed';
    } catch {
      return false;
    }
  };

  try {
    for (const waypoint of waypoints) {
      if (await cancelled()) {
        await api('POST', `/device/v1/patrol/tasks/${taskId}/events`, { type: 'stop_confirmed', zeroVelocity: true });
        console.log(`stop_confirmed for ${taskId}`);
        return;
      }
      const goal = { x: Number(waypoint.x), y: Number(waypoint.y), yaw: Number(waypoint.yaw ?? 0) };
      console.log(`navigating to ${waypoint.name ?? waypoint.id} (${goal.x.toFixed(2)}, ${goal.y.toFixed(2)})`);
      const ok = await navigate(pose, goal, cancelled);
      pose = goal;
      if (!ok || (await cancelled())) {
        await api('POST', `/device/v1/patrol/tasks/${taskId}/events`, { type: 'stop_confirmed', zeroVelocity: true });
        console.log(`stop_confirmed for ${taskId}`);
        return;
      }
      const dwellMs = Math.min(10, Math.max(8, Number(waypoint.dwellSeconds ?? 8))) * 1000;
      const until = Date.now() + dwellMs;
      while (Date.now() < until) {
        if (await cancelled()) {
          await api('POST', `/device/v1/patrol/tasks/${taskId}/events`, { type: 'stop_confirmed', zeroVelocity: true });
          console.log(`stop_confirmed for ${taskId}`);
          return;
        }
        await sleep(200);
      }
      await api('POST', `/device/v1/patrol/tasks/${taskId}/events`, { type: 'waypoint', waypointId: waypoint.id });
      console.log(`waypoint reached: ${waypoint.name ?? waypoint.id}`);
    }
    await api('POST', `/device/v1/patrol/tasks/${taskId}/events`, { type: 'status', status: 'completed' });
    console.log(`task ${taskId} completed`);
  } catch (error) {
    console.error(`task ${taskId} failed:`, error instanceof Error ? error.message : error);
    try {
      await api('POST', `/device/v1/patrol/tasks/${taskId}/events`, {
        type: 'status',
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch (postError) {
      console.error('failed to post failure:', postError instanceof Error ? postError.message : postError);
    }
  }
}

async function loop() {
  console.log(`sim-patrol-loop → ${baseUrl} (travel=${travelSeconds}s, poll=${pollSeconds}s). Ctrl+C 停止。`);
  for (;;) {
    try {
      const result = await api('GET', '/device/v1/patrol/tasks/next');
      if (result.task) await runTask(result.task);
      else await sleep(pollSeconds * 1000);
    } catch (error) {
      console.error('platform poll deferred:', error instanceof Error ? error.message : error);
      await sleep(pollSeconds * 1000);
    }
  }
}

void loop();
