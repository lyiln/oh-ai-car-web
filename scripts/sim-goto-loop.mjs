#!/usr/bin/env node
// 本机闭环：领取单点前往目标 → 假导航并上报 pose → arrived / 取消。
// 对齐 RViz「2D Goal Pose」；不依赖 ROS。
//
// 用法：
//   npm run sim:goto -- <deviceCredentialToken> [platformApiUrl]
//
// 可选：SIM_TRAVEL_SECONDS、POLL_SECONDS、MAP_VERSION、PUBLISH_POSE

const token = process.env.DEVICE_CREDENTIAL ?? process.argv[2];
const baseUrl = (process.env.PLATFORM_API_URL ?? process.argv[3] ?? 'http://127.0.0.1:8788').replace(/\/$/, '');
const travelSeconds = Number(process.env.SIM_TRAVEL_SECONDS ?? 3);
const pollSeconds = Number(process.env.POLL_SECONDS ?? 1.5);
const mapVersion = process.env.MAP_VERSION ?? 'floor-map-v1';
const publishPose = (process.env.PUBLISH_POSE ?? 'true') !== 'false';

if (!token || !token.includes('.')) {
  console.error('缺少设备凭据。用法: npm run sim:goto -- <id.secret> [platformApiUrl]');
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
    throw error;
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let pose = { x: 0, y: 0, yaw: 0 };

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

async function navigate(goal, shouldCancel) {
  const from = { ...pose };
  const steps = Math.max(1, Math.round(travelSeconds / 0.2));
  for (let index = 1; index <= steps; index += 1) {
    if (await shouldCancel()) return false;
    const t = index / steps;
    const x = from.x + (goal.x - from.x) * t;
    const y = from.y + (goal.y - from.y) * t;
    const yaw = from.yaw + (goal.yaw - from.yaw) * t;
    pose = { x, y, yaw };
    await postPose(x, y, yaw);
    await sleep((travelSeconds * 1000) / steps);
  }
  pose = { x: goal.x, y: goal.y, yaw: goal.yaw };
  await postPose(goal.x, goal.y, goal.yaw);
  return true;
}

async function goalStatus(goalId) {
  const result = await api('GET', `/device/v1/goto/${goalId}`);
  return result.goal?.status ?? '';
}

async function runGoal(goal) {
  const goalId = goal.id;
  console.log(`claimed goto ${goalId} -> (${Number(goal.x).toFixed(2)}, ${Number(goal.y).toFixed(2)})`);
  const target = { x: Number(goal.x), y: Number(goal.y), yaw: Number(goal.yaw ?? 0) };
  if (pose.x === 0 && pose.y === 0) {
    // 朝向目标
    target.yaw = Math.atan2(target.y - pose.y, target.x - pose.x);
  } else {
    target.yaw = Math.atan2(target.y - pose.y, target.x - pose.x);
  }

  const cancelled = async () => {
    try {
      const status = await goalStatus(goalId);
      return status === 'cancellation_requested' || status === 'cancelled' || status === 'arrived' || status === 'failed';
    } catch {
      return false;
    }
  };

  try {
    const ok = await navigate(target, cancelled);
    if (!ok || (await cancelled())) {
      const status = await goalStatus(goalId);
      if (status === 'cancellation_requested' || status === 'navigating') {
        await api('POST', `/device/v1/goto/${goalId}/events`, { type: 'stop_confirmed', zeroVelocity: true });
        console.log(`goto cancelled ${goalId}`);
      }
      return;
    }
    await api('POST', `/device/v1/goto/${goalId}/events`, { type: 'arrived' });
    console.log(`arrived ${goalId}`);
  } catch (error) {
    console.error(`goto failed:`, error instanceof Error ? error.message : error);
    try {
      await api('POST', `/device/v1/goto/${goalId}/events`, {
        type: 'failed',
        reason: error instanceof Error ? error.message : 'sim error',
      });
    } catch {
      /* ignore */
    }
  }
}

console.log(`sim:goto polling ${baseUrl} every ${pollSeconds}s (travel ${travelSeconds}s)`);
await postPose(pose.x, pose.y, pose.yaw);

for (;;) {
  try {
    const result = await api('GET', '/device/v1/goto/next');
    if (result.goal) await runGoal(result.goal);
    else await sleep(pollSeconds * 1000);
  } catch (error) {
    console.error('poll error:', error instanceof Error ? error.message : error);
    await sleep(pollSeconds * 1000);
  }
}
