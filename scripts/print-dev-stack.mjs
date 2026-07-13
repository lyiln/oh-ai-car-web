#!/usr/bin/env node
/** Prints the three local processes needed for APP-equivalent web control. */
console.log(`
巡牌通本机控制需要同时运行三个进程（对齐鸿蒙 APP：本机 TCP → 小车 :6000）:

  1) Backend API
     npm run dev:backend

  2) Frontend (Vite)
     npm run dev:frontend

  3) Local gateway（操作电脑上，必须与小车同一局域网）
     PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway

Windows PowerShell:
     $env:PLATFORM_API_URL="http://127.0.0.1:8788"; npm run dev:gateway

然后打开 http://127.0.0.1:5173 → 登录 → 设备列表 → 控制台。
在控制台可像 APP NetworkSettings 一样修改 IP / TCP 6000 / 视频 6500。
`);
