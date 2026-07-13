# 安全分阶段合并记录

日期：2026-07-13

来源：`origin/super`（`70ec07f`、`664a927`）合并到独立集成分支
`merge/origin-super-safe`。此记录不代表已合并到 `main` 或已推送。

## 已合入范围

- 设备搜索、编辑、归档和管理员权限；遥测轨迹、违规坐标回填及地图定位展示。
- 受平台控制租约限定的 TCP probe：probe 的主机、TCP 和视频端口必须与租约
  车辆完全一致，且 probe 不占用控制会话。
- TCP 意外断开后不自动重连或重发控制命令；后续命令必须重新建立连接。
- 保留 SMTP OTP、白名单管理员权限、Origin 限制、单控制者租约和 Stop 断开路径。

## 明确暂缓

- Jetson SSH 写入、Docker/ROS 启动、凭据轮换、mock GPS 与硬编码设备 IP 的
  部署脚本和文档均未合入。
- 当前设备环境仍以 `NEXT_SESSION.md` 记录的 `10.82.66.12`、ROS 运行时缺失为
  准；任何运行时恢复或硬件操作必须遵循阶段 1.5 的单独批准。

## 验证

- `npm run typecheck`：通过。
- `npm run typecheck:integration --workspace=@oh-ai-car-web/backend`：通过。
- `npm run build`：通过。
- `npm test`：通过（shared 5、gateway 14、frontend 28、backend 20 个测试）。
- `npm run test:integration --workspace=@oh-ai-car-web/backend`：测试文件加载和
  类型检查通过，但本机无 Docker/Testcontainers runtime，15 个 PostGIS 用例未执行；
  需在具备容器运行时的 CI 或开发机复跑。

Fake TCP、地图和单元测试不构成真车或 ROS/GPS 验证。
