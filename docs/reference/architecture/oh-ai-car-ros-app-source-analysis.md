# oh-ai-car-ros-app Source Analysis

## Scope
- 本文是来源提交 `6a9a7cb8839a6c16777eabf1f74e65d8c5867c1f` 的分析快照；其中出现的源码路径用于标识原始证据，不是本仓库的文件依赖。
- 本次分析范围：`Code/oh-ai-car-ros-app` 的 OpenHarmony/ArkTS 源码结构、页面入口、控制调用链、TCP 编码协议、视频链路、风险与后续 Web 端开发影响。
- 明确不包含：不分析真车固件/ROS 服务端实现，不运行构建，不连接设备，不修改业务源码，不清理现有 Git 工作区状态。

## Files Read
| File | Why Read | Key Evidence |
|---|---|---|
| `readme.md` | 确认项目用途、页面和目录说明 | 标题为智慧小车 ROS 对接版本，列出 `NetworkSettings`、`Index`、`MecanumWheel`、`RemoteControl` 和 ROS API 文档 |
| `doc/ros_api.md` | 确认 TCP 协议和命令码 | 标注 TCP 端口 `6000`，定义 `$...#` 基础编码和 `10/15/21/60/61/62/63/64` 命令 |
| `entry/src/main/module.json5` | 确认权限、页面配置和 Ability | 请求 `ohos.permission.INTERNET`，`pages` 指向 `$profile:main_pages` |
| `entry/src/main/resources/base/profile/main_pages.json` | 确认页面注册 | 注册 `pages/Index`、`pages/MecanumWheel`、`pages/RemoteControl`、`pages/NetworkSettings` |
| `entry/src/main/ets/entryability/EntryAbility.ets` | 确认应用启动入口 | `onWindowStageCreate` 加载 `pages/NetworkSettings`，初始化横屏/常亮/系统栏 |
| `entry/src/main/ets/pages/NetworkSettings.ets` | 确认网络配置和连接流程 | 默认 IP `192.168.1.11`、TCP `6000`、Video `6500`，连接成功后跳转 `pages/Index` |
| `entry/src/main/ets/pages/Index.ets` | 确认主页路由 | 跳转 `pages/MecanumWheel` 和 `pages/RemoteControl` |
| `entry/src/main/ets/pages/RemoteControl.ets` | 确认遥控页能力 | 使用 `CarBtnComponents`、`CarRockerComponents`、`VideoComponents`，循迹开关发送 `63/64` |
| `entry/src/main/ets/pages/MecanumWheel.ets` | 确认四轮速度控制 | `sendSpeed()` 调用 `CarEncode.UpSpeedCarEncode(...)` |
| `entry/src/main/ets/components/CarBtnComponents.ets` | 确认按钮控制行为 | Touch Down 发送方向，Touch Up 发送 Stop |
| `entry/src/main/ets/components/CarRockerComponents.ets` | 确认摇杆控制行为 | `tiltEvent` 调用 `CarEncode.CtrlCarEncode(tiltX, tiltY)` |
| `entry/src/main/ets/components/VideoComponents.ets` | 确认视频、拍照和录像 | WebView 加载 `http://<ip>:<port>/index2`，按钮发送 `60/61/62` |
| `entry/src/main/ets/CarUtill/CarApi.ets` | 确认业务 API 到 TCP 的桥接 | `send(message)` 调用 `TCPClientManager.getInstance().sendMessage(message)` |
| `entry/src/main/ets/CarUtill/CarEncode.ets` | 确认指令编码实现 | `BaseEncode` 拼接车辆类型 `01`、命令码、长度、数据体、校验和 |
| `entry/src/main/ets/CarUtill/CarEnum.ets` | 确认按钮方向枚举 | `Stop=0`、`Front=1`、`After=2`、`Left=3`、`Right=4`、`LeftRotate=5`、`RightRotate=6`、`Brake=7` |
| `entry/src/main/ets/tcp/TCPClientManager.ets` | 确认 TCP 连接和发送 | 使用 `@ohos.net.socket`，`connect()`、`isConnect()`、`sendMessage()` |
| `entry/src/main/ets/tcp/TCPClientSendUtils.ets` | 确认心跳发送状态 | `init()` 内实际发送逻辑被注释 |
| `entry/src/main/ets/tcp/TCPClientReceiveUtils.ets` | 确认接收处理状态 | `receiveMessage()` 内业务处理代码被注释 |
| `entry/src/main/ets/utils/PreferencesUtils.ets` | 确认网络配置持久化 | `KEY_IP`、`KEY_TCP_PORT`、`KEY_VIDEO_PORT`，默认值 `192.168.1.11/6000/6500` |

## Confirmed Facts
| Fact | Evidence | Source Type | Confidence |
|---|---|---|---|
| 项目是 OpenHarmony/ArkTS 智能小车 ROS 对接 App | `readme.md` 标题和目录结构；`oh-package.json5`；`entry/src/main/ets/**` | Project Docs / Source Code | Confirmed |
| 应用启动后先进入网络配置页 | `EntryAbility.ets` 的 `windowStage.loadContent('pages/NetworkSettings', ...)` | Source Code | Confirmed |
| 网络配置页保存 IP、TCP 端口、视频端口，并尝试建立 TCP 连接 | `NetworkSettings.ets` 的 `saveNetConfig()`、`initTcpConfig()` | Source Code | Confirmed |
| 默认 TCP 控制端口是 `6000` | `doc/ros_api.md`；`NetworkSettings.ets`；`PreferencesUtils.ets` | Project Docs / Source Code | Confirmed |
| 默认视频端口是 `6500` | `NetworkSettings.ets`；`PreferencesUtils.ets`；`VideoComponents.ets` | Source Code | Confirmed |
| 遥控页支持按钮控制、摇杆控制、视频显示、拍照、录像、循迹开关 | `RemoteControl.ets`、`CarBtnComponents.ets`、`CarRockerComponents.ets`、`VideoComponents.ets` | Source Code | Confirmed |
| 按钮按下发送方向指令，抬起发送停止指令 | `CarBtnComponents.ets` 的 `makeTouchEvent()` | Source Code | Confirmed |
| 摇杆移动会把 X/Y 映射为 `-100~100` 后发送 `cmd 10` | `RockerComponent.ets` 映射逻辑；`CarRockerComponents.ets`；`CarEncode.CtrlCarEncode()` | Source Code | Confirmed |
| 四轮速度更新使用 `cmd 21` | `MecanumWheel.ets` 调用 `CarEncode.UpSpeedCarEncode()`，该函数调用 `BaseEncode('21', ...)` | Source Code | Confirmed |
| 拍照、开始录像、结束录像、开启循迹、关闭循迹分别使用 `60/61/62/63/64` | `CarEncode.ets` 的 `TakePhotosEncode()`、`StartRecordingEncode()`、`CloselRecordingEncode()`、`TrackingOpenEncode()`、`TrackingCloseEncode()` | Source Code | Confirmed |
| TCP 接收处理尚无实际业务逻辑 | `TCPClientReceiveUtils.ets` 中处理逻辑被注释；`TCPClientManager.receiveMessage` 默认空函数 | Source Code | Confirmed |
| 心跳工具存在但未发送实际心跳消息 | `TCPClientSendUtils.ets` 的 `init()` 内发送逻辑被注释 | Source Code | Confirmed |

## Entry Points
| Entry | File | Function / Component | Evidence |
|---|---|---|---|
| 应用 Ability | `entry/src/main/ets/entryability/EntryAbility.ets` | `EntryAbility.onCreate()` / `onWindowStageCreate()` | 初始化 `PreferencesUtils` 并加载 `pages/NetworkSettings` |
| 网络配置页 | `entry/src/main/ets/pages/NetworkSettings.ets` | `NetworkSettings` / `LoginComponent` | 连接 TCP、保存网络配置、设置视频 IP/端口 |
| 主页 | `entry/src/main/ets/pages/Index.ets` | `Index` | 跳转麦克纳姆轮和遥控页 |
| 遥控页 | `entry/src/main/ets/pages/RemoteControl.ets` | `RemoteControl` | 按钮/摇杆/视频/循迹控制 |
| 麦克纳姆轮页 | `entry/src/main/ets/pages/MecanumWheel.ets` | `MecanumWheel` | 四轮速度滑条和更新按钮 |

## Call Chain
```text
[confirmed] App launch
  -> EntryAbility.onCreate()
  -> PreferencesUtils.getInstance().init(this.context)
  -> EntryAbility.onWindowStageCreate()
  -> windowStage.loadContent('pages/NetworkSettings')

[confirmed] TCP setup
  -> NetworkSettings.LoginComponent.initTcpConfig()
  -> TCPClientManager.getInstance().initNetAddress({ address, port })
  -> TCPClientManager.getInstance().connect()
  -> TCPClientSendUtils.getInstance().init()
  -> router.pushUrl({ url: 'pages/Index' })

[confirmed] button control
  -> RemoteControl
  -> CarBtnComponents.makeTouchEvent()
  -> carApi.carBtnCtrl(CarDirection.*)
  -> CarEncode.ButtonCarEncode()
  -> TCPClientManager.sendMessage()

[confirmed] rocker control
  -> RemoteControl or MecanumWheel
  -> CarRockerComponents
  -> RockerComponent.tiltEvent(tiltX, tiltY)
  -> CarEncode.CtrlCarEncode(tiltX, tiltY)
  -> TCPClientManager.sendMessage()

[confirmed] mecanum wheel speed update
  -> MecanumWheel.sendSpeed()
  -> CarEncode.UpSpeedCarEncode(L1, L2, R1, R2)
  -> TCPClientManager.sendMessage()

[confirmed] video and media commands
  -> VideoComponents.getWebSrc()
  -> WebView src http://<ip>:<videoPort>/index2
  -> photo/record buttons
  -> CarEncode.TakePhotosEncode() / StartRecordingEncode() / CloselRecordingEncode()
  -> TCPClientManager.sendMessage()
```

## Data Flow
| Data | From | To | Evidence |
|---|---|---|---|
| IP / TCP port / video port | `LoginComponent` text inputs | `PreferencesUtils` and `TCPClientManager` / `VideoComponents` | `NetworkSettings.ets` |
| Button direction enum | Button touch event | `CarEncode.ButtonCarEncode()` | `CarBtnComponents.ets` and `CarApi.ets` |
| Rocker X/Y values | `RockerComponent` touch coordinates | `CarEncode.CtrlCarEncode()` | `RockerComponent.ets` and `CarRockerComponents.ets` |
| Four wheel speed values | `MecanumWheel` sliders | `CarEncode.UpSpeedCarEncode()` | `MecanumWheel.ets` |
| Encoded command string | `CarEncode.BaseEncode()` | `TCPClientManager.sendMessage()` | `CarEncode.ets` and `CarApi.ets` |
| Video URL | `VideoComponents.ip` / `VideoComponents.port` | WebView | `VideoComponents.ets` |

## State Transitions
| From | Event | To | Evidence |
|---|---|---|---|
| App start | `onWindowStageCreate` | `NetworkSettings` page | `EntryAbility.ets` |
| Network settings | TCP connect succeeds | `Index` page | `NetworkSettings.ets` |
| Index | Click mecanum wheel item | `MecanumWheel` page | `Index.ets` |
| Index | Click remote control item | `RemoteControl` page | `Index.ets` |
| Remote control button down | Touch down | Send selected direction | `CarBtnComponents.ets` |
| Remote control button up | Touch up | Send Stop | `CarBtnComponents.ets` |
| Recording false | Click record | Send start recording and set `isRecording=true` | `VideoComponents.ets` |
| Recording true | Click end | Send close recording and set `isRecording=false` | `VideoComponents.ets` |

## Database Operations
| Table / Entity | Operation | File | Evidence |
|---|---|---|---|
| OpenHarmony preferences `net_preferences_utils` | Read/write IP, TCP port, video port | `entry/src/main/ets/utils/PreferencesUtils.ets` | `getIP()`、`setIp()`、`getTcpPort()`、`setTcpPort()`、`getVideoPort()`、`setVideoPort()` |
| Relational database | Not found | Not applicable | 未发现数据库表、SQL、ORM 或关系型数据库访问源码证据 |

## External Dependencies
| Dependency | Usage | Evidence | Risk |
|---|---|---|---|
| `@ohos.net.socket` | TCP client connection and send/receive | `TCPClientManager.ets` | Browser Web cannot directly reuse this raw TCP API |
| `@ohos.data.preferences` | Persist network config | `PreferencesUtils.ets` | Web version needs localStorage or backend config equivalent |
| `@ohos.router` | Page navigation | `NetworkSettings.ets`、`Index.ets` | Web version needs route mapping |
| `@ohos.web.webview` | Video page embedding | `VideoComponents.ets` | Web version may face CORS/mixed-content/proxy issues depending deployment |
| `rocker` local module | Reusable joystick component | `CarRockerComponents.ets` imports `RockerComponent` | Web version needs a pointer/canvas implementation |

## Async Jobs
- `TCPClientSendUtils.init()` creates a `setInterval(..., 5000)`, but the actual heartbeat send logic is commented out.
- `RedRound.aboutToAppear()` creates a `setInterval(..., 1000)` to toggle the recording indicator visibility.
- No background job, queue, or scheduler beyond these intervals was found in the inspected files.

## Error Handling
- `NetworkSettings.ets` shows toast on TCP connect success/failure.
- `TCPClientManager.connect()` catches connection failure, closes the socket, and returns `false`.
- `TCPClientManager.sendMessage()` checks connection state before sending and calls `connect()` when disconnected, but the failed send itself returns `false`.
- `TCPClientManager` wraps receive-message callback execution in `try/catch`.

## Edge Cases
- Negative speed values are converted by adding `256` before hex encoding in `CarEncode.CtrlCarEncode()` and `CarEncode.UpSpeedCarEncode()`.
- `CtrlCarEncode()` and `UpSpeedCarEncode()` round speed values before encoding.
- `CarBtnComponents.makeTouchEvent()` ignores missing events and ignores `TouchType.Move`.
- `NetworkSettings` has a debug fallback that can navigate to `Index` even when connection fails if `MyUtils.isDebug` is true.

## Risks
| Risk | Evidence | Impact | Suggested Next Step |
|---|---|---|---|
| Web frontend cannot directly reproduce raw TCP control from browser APIs | Current app uses `@ohos.net.socket` in `TCPClientManager.ets` | Web implementation needs a gateway or device-side HTTP/WebSocket API | Build a small Node/Go/Python TCP gateway for Web control |
| Receive path is not implemented | `TCPClientReceiveUtils.ets` logic is commented; `TCPClientManager._receiveMessage` defaults to empty | Web cannot rely on existing app behavior for telemetry/state feedback | Treat v1 Web as command-send-first unless hardware response protocol is confirmed |
| Heartbeat is stubbed | `TCPClientSendUtils.init()` send logic is commented | Connection liveness behavior is unclear | Verify device timeout behavior with simulator or real car |
| Existing Git worktree is already dirty | `git status --short --untracked-files=all` showed many modified/deleted/untracked files before this documentation work | Future diffs can be noisy and risky to review | Keep future changes isolated; do not normalize line endings unless explicitly planned |
| Build config contains local machine signing paths | `build-profile.json5` diff showed Windows user-specific signing paths in current worktree | Builds may fail on another machine | Document local build setup separately before build automation |

## Possible Causes to Verify
| Possible Cause | Missing Evidence | Files to Check Next |
|---|---|---|
| The current dirty worktree came from DevEco/Hvigor sync and CRLF conversion | No original package provenance checked | `.gitattributes` if added later, DevEco settings, source archive metadata |
| Video endpoint supports only `/index2` | No device/server code inspected | Hardware/ROS service source or runtime endpoint listing |
| Commands `60-64` are handled by car-side ROS service | Only app-side encoding and docs inspected | Car-side TCP server or ROS bridge implementation |

## Open Questions
- What exact service on the smart car listens on TCP `6000`?
- Does the car send acknowledgements or telemetry back over TCP?
- Does the video server require same-network access only, and does it allow browser embedding from a Web app origin?
- Should the Web gateway expose high-level commands or raw encoded command strings?
- Should future Web work preserve the same UI split between remote control and mecanum wheel control?

## Recommended Next Step
- `task-planning-flow`：为 Web 端前端 + TCP 网关制定实现方案。
- `bugfix-flow`：仅当后续发现连接、编码、视频或构建失败时使用。
- `execute-agent`：在 Web 端方案批准后执行代码实现。
- `review-agent`：在实现后审查网关协议、安全边界和前端控制交互。
- `sync-docs-flow`：在 Web 端实现改变架构或协议后同步更新 `docs/`。
