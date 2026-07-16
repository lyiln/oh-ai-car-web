# 微信通知快速截图演示

## 1. 启动页面

```bash
npm run dev:backend
npm run dev:frontend
```

后端首次启动会应用 migration 024。登录管理员账号后保持浏览器打开。

## 2. 一键生成演示记录

待人工确认态（可以截图“确认并发送微信”按钮）：

```bash
npm run demo:wxpush
```

已推送截图态（纯演示数据，不真实发送微信）：

```bash
npm run demo:wxpush -- --sent
```

脚本每次只删除并重建编码为 `DEMO-WXPUSH-SCREENSHOT` 的演示车辆，不影响其他车辆。可通过环境变量覆盖演示值：

```bash
DEMO_PLATE=京A88888 DEMO_WX_UID=UID_xxx npm run demo:wxpush
```

## 3. 建议截图

1. `/violations`：违规车辆、车主、禁停位置和证据图。
2. `/reviews`：待人工审核记录。
3. `/responses`：微信通知状态及“确认并发送微信”按钮；`--sent` 模式显示“已推送”。

真实发送还需要在 `.env` 配置 `WXPUSHER_APP_TOKEN`，并把白名单 `wxUid` 改为测试用户真实 UID。不要使用真实住户 UID 做演示。
