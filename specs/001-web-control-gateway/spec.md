# Feature Specification: Web Control Gateway

**Feature Branch**: `001-web-control-gateway`
**Created**: 2026-07-09
**Status**: Implemented; real-car validation pending
**Input**: Build the next Web-side development foundation from the existing OpenHarmony smart car controller.

> **Protocol warning:** Existing source evidence and an original contract
> example disagree on the button packet length and checksum. Neither is
> real-car confirmed. See [`PROTOCOL_STATUS.md`](../../PROTOCOL_STATUS.md)
> before changing command encoding or driving a physical car.

## Clarifications

### Session 2026-07-09
- Q: Web gateway should listen on localhost only, LAN, or configurable modes for v1? → A: Localhost only; the browser and gateway run on the same operator machine, and only the gateway connects to the car over LAN.
- Q: Should v1 command success depend on car-side ACK/telemetry? → A: No; v1 treats TCP write success as command success and does not require car-side ACK or telemetry.
- Q: What maximum send rate should v1 use for continuous rocker control? → A: 10 Hz maximum.
- Q: Should v1 add car-side video/content support if direct video loading fails? → A: No; v1 must not add car-side content. It should use the existing video endpoint directly, show an error if loading fails, and record proxy/car-side changes as follow-up only.
- Q: Should v1 allow browser users to send raw encoded TCP commands? → A: No; v1 allows only high-level button, rocker, media, tracking, and wheel-speed commands.

## User Scenarios & Testing

### User Story 1 - Connect to the smart car
As an operator, I want to enter the smart car IP, TCP port, and video port in a Web UI so that I can establish a control session from a browser.

**Acceptance Criteria**
1. Given default settings, the Web UI shows IP `192.168.1.11`, TCP port `6000`, and video port `6500`.
2. Given edited settings, the Web UI persists them locally and sends them to the gateway connection flow.
3. Given a failed TCP connection, movement controls remain disabled and the UI shows the failure.
4. Given a successful TCP connection, the UI enables control panels and shows the connected target.

### User Story 2 - Control movement with buttons
As an operator, I want directional buttons that match the mobile app so that I can drive the car using discrete commands.

**Acceptance Criteria**
1. Pressing a direction sends the matching `cmd 15` direction value.
2. Releasing a direction sends `Stop`.
3. Losing browser focus, pointer cancellation, or WebSocket disconnect sends or schedules `Stop`.
4. The UI exposes Stop/Brake as explicit controls.

### User Story 3 - Control movement with a rocker
As an operator, I want a joystick/rocker control so that I can send continuous X/Y movement commands.

**Acceptance Criteria**
1. Moving the rocker maps X/Y values to `-100..100`.
2. Rocker commands encode through the same `cmd 10` rule used by the mobile app.
3. Releasing the rocker recenters the control and sends zero movement.
4. Command sending is throttled to at most `10 Hz`; duplicate coordinates may be skipped to avoid flooding the TCP socket while preserving responsive control.

### User Story 4 - View video and media controls
As an operator, I want to view the car video feed and trigger photo/record controls from the Web UI.

**Acceptance Criteria**
1. The Web UI loads video directly from the existing `http://<ip>:<videoPort>/index2` endpoint.
2. Photo sends `cmd 60`.
3. Start recording sends `cmd 61` and marks recording active in the UI.
4. Stop recording sends `cmd 62` and clears recording active in the UI.
5. If the existing video endpoint cannot be loaded by the browser, the UI shows a video error state and documents the issue for follow-up; v1 must not require adding content or services to the car.

### User Story 5 - Toggle tracking mode
As an operator, I want to turn tracking/autopilot mode on and off from the Web UI.

**Acceptance Criteria**
1. Enabling tracking sends `cmd 63`.
2. Disabling tracking sends `cmd 64`.
3. The UI makes it clear when tracking mode is enabled.

### User Story 6 - Control mecanum wheel speeds
As an operator, I want to update four independent wheel speeds so that the Web app can replace the existing mecanum wheel page.

**Acceptance Criteria**
1. Four wheel inputs accept values from `-100..100`.
2. Update sends `cmd 21` using the same negative-value conversion as the ArkTS app.
3. Reset sets all four wheel speeds to `0` and sends an update.

## Functional Requirements
- **FR-001**: The Web UI must provide network configuration for IP, TCP port, and video port.
- **FR-002**: The gateway must open and manage TCP connections to the configured smart car target.
- **FR-003**: The browser must communicate with the gateway over WebSocket for control commands and connection state.
- **FR-003a**: In v1, the gateway must bind to localhost only and must not expose the WebSocket control API to other LAN devices.
- **FR-004**: The gateway must encode commands using the existing protocol format: `$` + vehicle type `01` + command code + length + payload + checksum + `#`.
- **FR-005**: The system must support command codes `10`, `15`, `21`, `60`, `61`, `62`, `63`, and `64`.
- **FR-006**: Negative speed values must be rounded and converted by adding `256` before hex encoding.
- **FR-007**: Button release, joystick release, browser blur, and gateway disconnect must stop movement.
- **FR-007a**: Rocker movement commands must be throttled to a maximum of `10 Hz`, excluding immediate stop commands on release/cancel/blur.
- **FR-008**: The Web UI must display connection state and disable movement controls when disconnected.
- **FR-009**: The Web UI must expose video preview by directly loading the existing car video endpoint `http://<ip>:<videoPort>/index2`.
- **FR-009a**: If direct video loading fails, v1 must show an error state and must not require gateway video proxying or car-side changes.
- **FR-010**: The gateway must expose structured command results or connection errors to the browser.
- **FR-010a**: In v1, a command result must mean the gateway successfully wrote the encoded command to the TCP socket; it must not imply the car acknowledged or executed the command.
- **FR-011**: Protocol encoding must be unit tested independently from real hardware.
- **FR-012**: Real-car testing must be documented separately and must not be assumed complete by unit tests.
- **FR-013**: In v1, the browser UI and public gateway API must not expose raw encoded command input or arbitrary TCP command passthrough.

## Non-Goals
- Do not modify the existing OpenHarmony/ArkTS app in v1.
- Do not implement ROS/server-side firmware changes in v1.
- Do not add new pages, services, or content to the smart car in v1.
- Do not require browser raw TCP APIs.
- Do not build authentication or internet remote access in v1; target same-LAN development use.
- Do not rely on telemetry, acknowledgement, or state feedback until the car-side receive protocol is confirmed.
- Do not expose raw encoded command sending to browser users in v1.

## Key Entities
- **ConnectionConfig**: IP address, TCP port, video port, connection timeout.
- **GatewaySession**: Browser-to-gateway session, car TCP socket state, last command time, connection state.
- **CarCommand**: High-level command type plus payload before encoding.
- **EncodedCommand**: TCP string ready for car transmission.
- **VideoConfig**: URL or proxy mode for video rendering.

## Evidence
- `docs/reference/context/ai-context.md`: source-app flow, defaults, and Web direction.
- `docs/reference/architecture/oh-ai-car-ros-app-source-analysis.md`: confirmed call chains, command codes, risks, and Web gateway recommendation.
- `docs/reference/protocol/ros_api.md`: retained original TCP protocol document.
- `docs/reference/protocol/encoder-evidence.md`: source-derived encoder, TCP, and video evidence without copied ArkTS business code.
- `PROTOCOL_STATUS.md`: unresolved packet conflict and real-car validation rule.

## Open Questions
- Does the car send useful acknowledgements or telemetry over TCP?
- What command rate is safe for continuous rocker control on the real device after real-car validation?
