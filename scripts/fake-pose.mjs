#!/usr/bin/env node
// 阶段 A 联调用：向平台 POST /device/v1/pose 注入一段绕圈的假位姿（map 坐标系），
// 驱动 Web 楼道地图上的小车与轨迹显示。不接触真车，仅供本地演示。
//
// 用法：
//   node scripts/fake-pose.mjs <deviceCredentialToken> [platformApiUrl]
// 或使用环境变量：
//   DEVICE_CREDENTIAL=<id.secret> PLATFORM_API_URL=http://127.0.0.1:8788 node scripts/fake-pose.mjs
//
// 可选环境变量（单位米/秒）：
//   FAKE_CX, FAKE_CY  圆心（默认 0,0）
//   FAKE_R            半径（默认 1.5）
//   FAKE_PERIOD_MS    发送间隔（默认 500）
//   FAKE_MAP_VERSION  地图版本（默认 floor-map-v1）

const token = process.env.DEVICE_CREDENTIAL ?? process.argv[2];
const baseUrl = (process.env.PLATFORM_API_URL ?? process.argv[3] ?? 'http://127.0.0.1:8788').replace(/\/$/, '');

if (!token || !token.includes('.')) {
  console.error('缺少设备凭据。请在管理端为车辆生成设备凭据（形如 <id>.<secret>）。');
  console.error('用法: node scripts/fake-pose.mjs <deviceCredentialToken> [platformApiUrl]');
  process.exit(1);
}

const cx = Number(process.env.FAKE_CX ?? 0);
const cy = Number(process.env.FAKE_CY ?? 0);
const radius = Number(process.env.FAKE_R ?? 1.5);
const periodMs = Number(process.env.FAKE_PERIOD_MS ?? 500);
const mapVersion = process.env.FAKE_MAP_VERSION ?? 'floor-map-v1';
const url = `${baseUrl}/device/v1/pose`;

let angle = 0;

async function tick() {
  angle += 0.08;
  const x = cx + radius * Math.cos(angle);
  const y = cy + radius * Math.sin(angle);
  const yaw = angle + Math.PI / 2; // 切线方向
  const payload = { points: [{ occurredAt: new Date().toISOString(), x, y, yaw, mapVersion }] };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) console.error(`位姿上报失败 (${response.status}):`, body);
    else process.stdout.write(`\r已上报 x=${x.toFixed(2)} y=${y.toFixed(2)} yaw=${yaw.toFixed(2)}   `);
  } catch (error) {
    console.error('\n位姿上报异常:', error instanceof Error ? error.message : error);
  }
}

console.log(`向 ${url} 注入假位姿，圆心(${cx},${cy}) 半径 ${radius}m，间隔 ${periodMs}ms。Ctrl+C 停止。`);
setInterval(() => void tick(), periodMs);
