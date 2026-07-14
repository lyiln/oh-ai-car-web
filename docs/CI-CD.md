# CI/CD 维护指南

## 目的和范围

本仓库使用 GitHub Actions 验证可在普通 Linux 环境复现的软件交付：Node.js
workspaces、Python 边缘代理中的无硬件测试、PostGIS 集成测试以及 Docker Compose
部署冒烟测试。工作流位于 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)。

它**不**把模拟测试称为真车验证，也不会连接小车、Jetson、串口、雷达、相机或真实
云端。真实车辆和 ROS2 操作仍必须遵守仓库的安全与验收记录。

```text
Developer push / pull request
              |
              v
      GitHub Actions (CI)
              |
     +--------+------------------+
     |                           |
     v                           v
TypeScript + mock Python    disposable PostGIS + Docker
typecheck / unit tests      integration + Compose smoke test
     |                           |
     +------------+--------------+
                  v
           GitHub check result
                  |
        (after server setup only)
                  v
       manual, protected CD deployment
```

这个结构适合当前课程项目：常规 PR 能尽早发现编译和协议/界面回归；容器作业再验证
数据库迁移和 Nginx 代理路径。没有引入 Kubernetes、镜像仓库或额外云服务。

## 当前项目分析

| 项目部分 | 现状 | CI 处理 |
| --- | --- | --- |
| 根目录 | npm workspaces，Node.js `>=22` | `npm ci` 使用 `package-lock.json`，并缓存 npm 下载目录 |
| `shared/` | TypeScript 协议类型和编码器 | 类型检查和 Vitest 单元测试 |
| `frontend/` | React + Vite Web 前端 | `npm run build` 运行 TypeScript 编译和 Vite 生产构建；另有单元测试 |
| `backend/` | TypeScript + Fastify + PostgreSQL/PostGIS | 单元测试；另以 Testcontainers 启动临时 PostGIS 运行集成测试 |
| `gateway/` | Node.js 本机 WebSocket/TCP 网关 | TypeScript 和 Fake TCP 自动化测试；不连接真实小车 |
| `edge-agent/` | Python ROS2/遥测/视觉适配代码 | 只运行 mock 模式、无模型依赖的 `unittest`；YOLO 权重/外部仓库相关测试会跳过 |
| Docker | `Dockerfile.backend`、`Dockerfile.frontend`、`docker-compose.yml` | 校验 Compose，并用现有 `npm run test:deploy-live` 执行 `docker compose up --build` 冒烟测试 |
| ROS2 Workspace | 不存在 `colcon` workspace、`package.xml` 或 ROS2 构建入口 | 不运行 ROS2 构建；边缘代理须在获批准的 Jetson/ROS2 环境另行验收 |

现有两个 Dockerfile 与 Compose 已适配本项目：后端镜像构建 TypeScript 后以 Node 22
运行，前端镜像构建 Vite 静态文件后由 Nginx 服务；Compose 组合 PostgreSQL/PostGIS、
后端和前端。CI 使用现有的 `test:deploy-live`，因此 Docker 构建不仅检查 Dockerfile，
还会实际启动并验证受保护的 WebSocket 路径。

## CI 工作流

`CI` 在推送至 `main`、针对 `main` 的 Pull Request，以及手动触发时运行。使用 Node
22，和 `package.json` 一致；每个作业都独立安装依赖，避免依赖另一个 runner 的状态。

### `TypeScript and edge-agent tests`

依次执行：

1. `npm ci`
2. `npm run typecheck`：会先构建 shared，再对每个 workspace 执行类型检查。
3. `npm run build`：构建 shared、backend、frontend（Vite）和 gateway。
4. `npm test`：运行 shared、frontend、backend、gateway 的 Vitest 测试。
5. `python -m unittest discover -s edge-agent/tests -p 'test_*.py'`：运行 mock 适配器和纯映射测试。
所有写入日志的命令都启用 `pipefail`，因此测试命令失败时不会被 `tee` 掩盖。

失败时，Actions 会上传 `quality-logs-*` artifact，保留 14 天。

### `PostGIS and Docker smoke tests`

依次执行：

1. `npm run test:integration --workspace=@oh-ai-car-web/backend`：Testcontainers 从
   `postgis/postgis:16-3.4` 创建一次性数据库，测试完成后销毁。
2. `docker compose config --quiet`：用仅供 CI 的占位值验证必填变量和 Compose 语法。
3. `npm run test:deploy-live`：执行现有的 `docker compose up --build`，进行登录与
   `/patrol/live` WebSocket 验证，然后运行 `docker compose down -v` 清理。

这一步同时就是 Docker build 验证。失败时会显示 Docker 容器诊断，并上传
`container-logs-*` artifact。

## 本地复现

在仓库根目录执行：

```sh
npm ci
npm run typecheck
npm test
python3 -m unittest discover -s edge-agent/tests -p 'test_*.py'
npm run test:integration --workspace=@oh-ai-car-web/backend
npm run test:deploy-live
```

最后两项需要 Docker daemon；`test:integration` 还会下载/运行临时 PostGIS 镜像。
如只修改前端、协议或网关，可先运行前三项和 Python 测试；提交前仍应让 CI 完整运行。

## 为什么不在 CI 运行硬件任务

以下内容不具备 GitHub-hosted runner 的运行条件，且模拟成功不能证明真实设备可用：

- ROS2 节点、`/gps/fix`、Nav2、地图和真实传感器话题；
- Jetson 上的 Docker/驱动、串口、激光雷达、深度相机和底盘；
- YOLO 真正推理所需的模型权重、GPU/CUDA、外部 YOLO 工作目录和真实图像；
- 本机 localhost gateway 到真实车辆 TCP `:6000`、视频 `:6500` 的连接；
- 真实 AMap、SMTP、设备凭据与生产数据库。

这些项目必须在已批准的测试环境中手动运行，并将真实结果记录到相应硬件验证文档；
不要把 GitHub Actions 日志作为真车验收证据。

## CD 状态与服务器接入

当前仓库没有可用服务器地址、部署用户、SSH 认证方式或受保护的 GitHub Environment，
所以**尚未创建自动 SSH 部署工作流**。这样避免把 `main` 的提交意外部署到未知主机。
现有 CI 已完整可用。

准备测试服务器后，建议采用简单的手动 CD：仅从受保护的 `main` 或发布 tag 触发，SSH
到服务器的固定目录，拉取指定提交并执行：

```sh
git fetch --tags origin
git checkout --detach "$GITHUB_SHA"
docker compose --env-file .env.production up -d --build --remove-orphans
docker compose ps
```

不要在 Actions 日志中打印 `.env.production`，也不要把它提交到 Git。部署前应先在服务器
上根据 `.env.example` 创建该文件，并将 `PLATFORM_PUBLIC_ORIGIN` 设为实际 HTTPS 域名，
将 `COOKIE_SECURE=true`，使用强 `SESSION_SECRET`，并配置真实 SMTP。部署后应按
`docs/deployment/vehicle-platform.md` 做登录和 WebSocket 冒烟验证。

当服务器确定后，可新增一个只允许手动触发的 `deploy.yml`。它应使用 GitHub
Environment（例如 `staging`）并设置并发锁，避免两次部署同时改 Compose 状态；这个
部署目标和健康检查地址属于外部环境决策，确认后再写入工作流。

## GitHub Secrets

当前 `ci.yml` 不需要任何 Secret；所有 Compose 变量均为一次性占位值，测试不会访问
真实服务。

为上面的 SSH CD 准备服务器后，在对应 GitHub Environment（推荐 `staging`）配置：

| Secret | 用途 |
| --- | --- |
| `SERVER_HOST` | 部署服务器的主机名或 IP 地址 |
| `SERVER_USER` | 仅具有必要 Docker/仓库权限的 SSH 用户 |
| `SERVER_SSH_KEY` | 该用户的专用私钥；公钥只放在服务器 `authorized_keys` |
| `SERVER_PORT` | 非默认 SSH 端口时使用；默认 22 可不配置 |
| `DEPLOY_PATH` | 服务器上此仓库的固定绝对路径 |

生产运行时机密不应作为 Actions 命令行参数传入。应仅保存在服务器的
`.env.production`（权限建议 `chmod 600`）中，包括：`POSTGRES_PASSWORD`、
`SESSION_SECRET`、`BOOTSTRAP_ADMIN_PASSWORD`、`SMTP_PASSWORD`、`VITE_AMAP_KEY`、
`AMAP_SECURITY_JS_CODE`，以及任何 `AI_API_KEY`、设备凭据。若团队希望由 GitHub
管理这些值，再在经审批的部署工作流中将它们写入服务器的受限文件，且不得回显。

## 修改与扩展工作流

- 新增 Node workspace：把它加入根 `workspaces`，提供 `build`、`typecheck`、`test`
  脚本；根命令会自动覆盖它。
- 新增纯 Python 测试：放到 `edge-agent/tests/test_*.py`；若引入依赖，新增固定版本的
  requirements 文件，并在 CI 明确安装它，而不是依赖 runner 预装包。
- 新增需要服务的测试：优先使用 Testcontainers 或把它加入现有 Compose 冒烟测试，避免
  增加独立的长期云测试环境。
- 新增 CD：先确认服务器、回滚方法、健康检查 URL 和负责人员，再创建手动触发、环境
  保护和并发锁齐全的 workflow；不要让 pull request 或普通分支自动部署。

## 常见问题

| 现象 | 排查方式 |
| --- | --- |
| `npm ci` 失败 | 检查 `package.json` 和 `package-lock.json` 是否同步；不要在 CI 用 `npm install` 绕过锁文件。 |
| PostGIS 集成测试失败 | 在日志确认 Docker 是否可用、镜像能否拉取；本地执行相同 `test:integration` 命令复现。 |
| Compose 配置失败 | 对照 `.env.example` 补齐必填变量；CI 中只有占位值，生产值必须在服务器受限 env 文件中。 |
| Docker 冒烟失败 | 下载失败 artifact，并在本地执行 `npm run test:deploy-live`；该命令会清理临时容器和卷。 |
| Python 测试显示 skipped | 外部 YOLO 代码、权重或样本不存在时属于预期；mock 单元测试仍必须通过。 |
| 真车没有动作 | 这不属于 CI 失败；遵循真实车辆验证流程，检查 ROS2、网络、协议状态和安全条件。 |
