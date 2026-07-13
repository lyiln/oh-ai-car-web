#!/usr/bin/env node
/** Prints the three local processes needed for APP-equivalent web control. */
console.log(`
巡牌通本机控制需要同时运行三个进程（浏览器经本机网关连接已登记车辆）:

  1) Backend API
     npm run dev:backend

  2) Frontend (Vite)
     npm run dev:frontend

  3) Local gateway（操作电脑上，必须与小车同一局域网）
     PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway

Windows PowerShell:
     $env:PLATFORM_API_URL="http://127.0.0.1:8788"; npm run dev:gateway

然后打开 http://127.0.0.1:5173 → 登录 → 设备列表 → 控制台。
控制台使用设备档案和平台控制租约限定的 IP / TCP / 视频端口；
请由管理员在设备管理页更新设备地址。
`);
