#!/usr/bin/env node
/** Prints the local processes needed for APP-equivalent web control + plate scan. */
console.log(`
巡牌通本机控制需要运行以下进程（浏览器仅通过本机网关连接已登记车辆）:

  1) Backend API
     npm run dev:backend

  2) Frontend (Vite)
     npm run dev:frontend

  3) Local gateway（操作电脑上，必须与小车同一局域网）
     PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway

  4) 控制台车牌识别 YOLO API（使用“车牌识别工作台”时必须运行）
    npm run dev:plate-api

Windows PowerShell:
     $env:PLATFORM_API_URL="http://127.0.0.1:8788"; npm run dev:gateway

然后打开 http://127.0.0.1:5173 → 登录 → 设备列表 → 控制台。
控制台使用设备档案和平台控制租约限定的 IP / TCP / 视频端口；
请由管理员在设备管理页更新设备地址。
基础遥控只需前 3 个进程；连接成功后若要使用视频预览下方「车牌识别工作台」，
还必须运行第 4 个进程。它需要本机 Python/YOLO/PaddleOCR 依赖和模型权重，并监听 :8010。
`);
