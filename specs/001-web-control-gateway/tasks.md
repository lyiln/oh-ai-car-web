# Tasks: Web Control Gateway

**Status**: Historical implementation checklist. The v1 implementation is
delivered in this repository and audited in
`tasks/change-report-web-control-v1.md`. The original `web/...` paths below
pre-date the decision to make this a standalone repository; use the actual
root-level `frontend/`, `gateway/`, and `shared/` paths for future work.

**Input**: Design documents from `specs/001-web-control-gateway/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/websocket-control-api.md`, `quickstart.md`

**Tests**: Required by `FR-011`, `FR-012`, and `quickstart.md`. Test tasks are included before related implementation tasks.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently after the foundational protocol/gateway pieces are complete.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the isolated Web workspace without touching the existing OpenHarmony app.

- [ ] T001 Create `web/frontend/`, `web/gateway/`, and `web/shared/` directory structure described in `specs/001-web-control-gateway/plan.md`
- [ ] T002 Initialize TypeScript workspace metadata in `web/package.json`
- [ ] T003 [P] Add shared TypeScript configuration in `web/tsconfig.base.json`
- [ ] T004 [P] Add frontend Vite/React project configuration in `web/frontend/package.json`
- [ ] T005 [P] Add gateway Node TypeScript project configuration in `web/gateway/package.json`
- [ ] T006 [P] Add shared package project configuration in `web/shared/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement protocol, shared contracts, gateway transport, and test harness required by every user story.

**CRITICAL**: No user story work should begin until this phase is complete.

- [ ] T007 [P] Define shared WebSocket envelope and command types in `web/shared/src/protocol-types.ts`
- [ ] T008 [P] Define shared direction and command enums in `web/shared/src/car-command-types.ts`
- [ ] T009 Implement existing car command encoder in `web/shared/src/car-encoder.ts`
- [ ] T010 [P] Add protocol unit tests for `cmd 15` button encoding in `web/shared/tests/car-encoder.button.test.ts`
- [ ] T011 [P] Add protocol unit tests for `cmd 10` rocker encoding with negative values in `web/shared/tests/car-encoder.rocker.test.ts`
- [ ] T012 [P] Add protocol unit tests for `cmd 21` wheel speed encoding in `web/shared/tests/car-encoder.wheels.test.ts`
- [ ] T013 [P] Add protocol unit tests for `cmd 60/61/62/63/64` media and tracking encoding in `web/shared/tests/car-encoder.auxiliary.test.ts`
- [ ] T014 Implement gateway TCP client with connect, disconnect, write, and state reporting in `web/gateway/src/tcp/car-tcp-client.ts`
- [ ] T015 Implement gateway WebSocket server bound to `127.0.0.1` in `web/gateway/src/websocket/control-server.ts`
- [ ] T016 Implement gateway command dispatcher that accepts only high-level commands in `web/gateway/src/websocket/command-dispatcher.ts`
- [ ] T017 Add fake TCP server test helper in `web/gateway/tests/helpers/fake-car-tcp-server.ts`
- [ ] T018 Add gateway integration test for TCP write success result semantics in `web/gateway/tests/control-server.write-success.test.ts`
- [ ] T019 Add gateway integration test rejecting raw encoded command passthrough in `web/gateway/tests/control-server.raw-command.test.ts`
- [ ] T020 Add frontend WebSocket client service in `web/frontend/src/services/controlClient.ts`
- [ ] T021 Add frontend settings persistence helpers in `web/frontend/src/services/settingsStorage.ts`
- [ ] T022 Add shared connection state model in `web/frontend/src/services/connectionState.ts`

**Checkpoint**: Protocol tests pass, fake TCP gateway tests pass, and the frontend can connect to a localhost gateway service.

---

## Phase 3: User Story 1 - Connect to the smart car (Priority: P1) MVP

**Goal**: Operator can configure IP/TCP/video ports, connect through the localhost gateway, and see clear connection state.

**Independent Test**: With a fake TCP server, default settings show `192.168.1.11`, `6000`, `6500`; failed connection disables controls; successful connection enables the rest of the UI.

### Tests for User Story 1

- [ ] T023 [P] [US1] Add frontend test for default network settings in `web/frontend/tests/connection-settings.defaults.test.tsx`
- [ ] T024 [P] [US1] Add frontend test for persisted network settings in `web/frontend/tests/connection-settings.persistence.test.tsx`
- [ ] T025 [P] [US1] Add gateway integration test for localhost-only WebSocket binding in `web/gateway/tests/control-server.localhost.test.ts`
- [ ] T026 [P] [US1] Add frontend test for disabled controls before connection in `web/frontend/tests/connection-state.disabled-controls.test.tsx`

### Implementation for User Story 1

- [ ] T027 [US1] Implement connection settings form in `web/frontend/src/components/ConnectionSettings.tsx`
- [ ] T028 [US1] Implement connect/disconnect actions in `web/frontend/src/services/connectionActions.ts`
- [ ] T029 [US1] Implement connection status panel in `web/frontend/src/components/ConnectionStatus.tsx`
- [ ] T030 [US1] Wire connection page layout in `web/frontend/src/app/App.tsx`
- [ ] T031 [US1] Add gateway connection handling for `connect` and `disconnect` commands in `web/gateway/src/websocket/command-dispatcher.ts`

**Checkpoint**: US1 is complete when connection state works against a fake TCP server and movement controls remain unavailable until connected.

---

## Phase 4: User Story 2 - Control movement with buttons (Priority: P2)

**Goal**: Operator can drive the car with directional buttons and stop safely on release/cancel/blur/disconnect.

**Independent Test**: With a fake TCP server, pointer down sends the correct `cmd 15` direction and pointer up sends Stop.

### Tests for User Story 2

- [ ] T032 [P] [US2] Add frontend button press/release test in `web/frontend/tests/button-control.press-release.test.tsx`
- [ ] T033 [P] [US2] Add frontend blur/cancel stop test in `web/frontend/tests/button-control.stop-safety.test.tsx`
- [ ] T034 [P] [US2] Add gateway integration test for WebSocket disconnect best-effort Stop in `web/gateway/tests/control-server.disconnect-stop.test.ts`

### Implementation for User Story 2

- [ ] T035 [US2] Implement directional button grid in `web/frontend/src/controls/ButtonControl.tsx`
- [ ] T036 [US2] Implement pointer down/up/cancel command mapping in `web/frontend/src/controls/buttonControlHandlers.ts`
- [ ] T037 [US2] Add browser blur stop behavior in `web/frontend/src/services/stopSafety.ts`
- [ ] T038 [US2] Implement gateway best-effort Stop on WebSocket close in `web/gateway/src/websocket/control-server.ts`
- [ ] T039 [US2] Integrate button control into `web/frontend/src/app/App.tsx`

**Checkpoint**: US2 is complete when fake TCP logs show direction commands followed by Stop for release/cancel/blur/disconnect cases.

---

## Phase 5: User Story 3 - Control movement with a rocker (Priority: P3)

**Goal**: Operator can use joystick-style continuous control with values mapped to `-100..100` and throttled to at most `10 Hz`.

**Independent Test**: With a fake TCP server, moving the rocker sends `cmd 10` commands at no more than `10 Hz`; release sends immediate `(0,0)`.

### Tests for User Story 3

- [ ] T040 [P] [US3] Add rocker coordinate mapping test in `web/frontend/tests/rocker-control.mapping.test.tsx`
- [ ] T041 [P] [US3] Add rocker `10 Hz` throttling test in `web/frontend/tests/rocker-control.throttle.test.tsx`
- [ ] T042 [P] [US3] Add rocker release immediate stop test in `web/frontend/tests/rocker-control.release-stop.test.tsx`

### Implementation for User Story 3

- [ ] T043 [US3] Implement rocker visual control in `web/frontend/src/controls/RockerControl.tsx`
- [ ] T044 [US3] Implement coordinate mapping utility in `web/frontend/src/controls/rockerMath.ts`
- [ ] T045 [US3] Implement rocker throttling and duplicate-skip logic in `web/frontend/src/controls/rockerSender.ts`
- [ ] T046 [US3] Integrate rocker control into `web/frontend/src/app/App.tsx`

**Checkpoint**: US3 is complete when rocker movement remains responsive, respects the `10 Hz` cap, and always sends immediate stop on release/cancel/blur.

---

## Phase 6: User Story 4 - View video and media controls (Priority: P4)

**Goal**: Operator can view the existing video endpoint and trigger photo/record commands without adding car-side content.

**Independent Test**: UI generates `http://<ip>:<videoPort>/index2`, shows an error if it fails, and fake TCP receives `60/61/62` for media commands.

### Tests for User Story 4

- [ ] T047 [P] [US4] Add video URL generation test in `web/frontend/tests/video-panel.url.test.tsx`
- [ ] T048 [P] [US4] Add video load error state test in `web/frontend/tests/video-panel.error.test.tsx`
- [ ] T049 [P] [US4] Add media command fake TCP integration test in `web/gateway/tests/control-server.media.test.ts`

### Implementation for User Story 4

- [ ] T050 [US4] Implement video panel direct URL rendering in `web/frontend/src/components/VideoPanel.tsx`
- [ ] T051 [US4] Implement video error state in `web/frontend/src/components/VideoPanel.tsx`
- [ ] T052 [US4] Implement photo and recording controls in `web/frontend/src/controls/MediaControls.tsx`
- [ ] T053 [US4] Implement recording UI state transitions in `web/frontend/src/controls/mediaState.ts`
- [ ] T054 [US4] Integrate video and media controls into `web/frontend/src/app/App.tsx`

**Checkpoint**: US4 is complete when video is attempted directly, failures are visible, and media commands encode correctly without gateway video proxying.

---

## Phase 7: User Story 5 - Toggle tracking mode (Priority: P5)

**Goal**: Operator can enable and disable tracking mode with visible UI state.

**Independent Test**: With a fake TCP server, enabling tracking sends `cmd 63` and disabling tracking sends `cmd 64`.

### Tests for User Story 5

- [ ] T055 [P] [US5] Add tracking toggle UI test in `web/frontend/tests/tracking-toggle.state.test.tsx`
- [ ] T056 [P] [US5] Add tracking command fake TCP integration test in `web/gateway/tests/control-server.tracking.test.ts`

### Implementation for User Story 5

- [ ] T057 [US5] Implement tracking toggle component in `web/frontend/src/controls/TrackingToggle.tsx`
- [ ] T058 [US5] Integrate tracking toggle into `web/frontend/src/app/App.tsx`

**Checkpoint**: US5 is complete when tracking state is visible and command `63/64` is received by fake TCP.

---

## Phase 8: User Story 6 - Control mecanum wheel speeds (Priority: P6)

**Goal**: Operator can set four wheel speeds, update them with `cmd 21`, and reset all speeds to zero.

**Independent Test**: With a fake TCP server, wheel speed update encodes four values with existing negative conversion and reset sends all zeroes.

### Tests for User Story 6

- [ ] T059 [P] [US6] Add wheel speed bounds test in `web/frontend/tests/wheel-speed.bounds.test.tsx`
- [ ] T060 [P] [US6] Add wheel speed update fake TCP integration test in `web/gateway/tests/control-server.wheel-speeds.test.ts`
- [ ] T061 [P] [US6] Add wheel speed reset UI test in `web/frontend/tests/wheel-speed.reset.test.tsx`

### Implementation for User Story 6

- [ ] T062 [US6] Implement four-wheel speed control component in `web/frontend/src/controls/WheelSpeedControl.tsx`
- [ ] T063 [US6] Implement wheel speed validation helpers in `web/frontend/src/controls/wheelSpeedValidation.ts`
- [ ] T064 [US6] Integrate wheel speed control into `web/frontend/src/app/App.tsx`

**Checkpoint**: US6 is complete when each speed is bounded, update sends `cmd 21`, and reset sends all zeroes.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and cleanup across all stories.

- [ ] T065 [P] Run shared protocol unit tests from `web/shared/`
- [ ] T066 [P] Run gateway fake TCP integration tests from `web/gateway/`
- [ ] T067 [P] Run frontend interaction tests from `web/frontend/`
- [ ] T068 Execute `specs/001-web-control-gateway/quickstart.md` validation scenarios and record results in `docs/flows/web-control-real-car-validation.md`
- [ ] T069 [P] Update architecture documentation in `docs/architecture/` if implementation deviates from `specs/001-web-control-gateway/plan.md`
- [ ] T070 [P] Confirm no existing OpenHarmony app files under `entry/`, `Rocker/`, `AppScope/`, `hvigor/`, or `doc/` were modified by Web implementation work

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1; blocks all user stories.
- **US1 Connection (P1)**: Depends on Phase 2 and is the MVP.
- **US2 Button Control (P2)**: Depends on Phase 2 and benefits from US1 connection UI.
- **US3 Rocker Control (P3)**: Depends on Phase 2 and benefits from US1 connection UI.
- **US4 Video/Media (P4)**: Depends on Phase 2 and US1 settings.
- **US5 Tracking (P5)**: Depends on Phase 2 and US1 connection UI.
- **US6 Wheel Speeds (P6)**: Depends on Phase 2 and US1 connection UI.
- **Phase 9 Polish**: Depends on selected stories being complete.

### User Story Dependencies

- **US1**: Independent MVP after foundational gateway and shared services.
- **US2**: Uses shared encoder/gateway and connection state from US1.
- **US3**: Uses shared encoder/gateway and connection state from US1.
- **US4**: Uses settings from US1; media commands use shared gateway.
- **US5**: Uses shared gateway and connection state.
- **US6**: Uses shared encoder/gateway and connection state.

## Parallel Opportunities

- T003-T006 can run in parallel after T001-T002.
- T007-T013 can run in parallel except T009 must complete before encoder tests can pass.
- T017-T019 can run in parallel after T014-T016.
- Frontend UI tests within each user story can run in parallel with gateway integration tests for that story.
- US2-US6 can be developed in parallel after Phase 2 if they integrate through the shared WebSocket client and command contracts.

## Parallel Example: User Story 2

```text
Task: "T032 [P] [US2] Add frontend button press/release test in web/frontend/tests/button-control.press-release.test.tsx"
Task: "T033 [P] [US2] Add frontend blur/cancel stop test in web/frontend/tests/button-control.stop-safety.test.tsx"
Task: "T034 [P] [US2] Add gateway integration test for WebSocket disconnect best-effort Stop in web/gateway/tests/control-server.disconnect-stop.test.ts"
```

## Parallel Example: User Story 4

```text
Task: "T047 [P] [US4] Add video URL generation test in web/frontend/tests/video-panel.url.test.tsx"
Task: "T048 [P] [US4] Add video load error state test in web/frontend/tests/video-panel.error.test.tsx"
Task: "T049 [P] [US4] Add media command fake TCP integration test in web/gateway/tests/control-server.media.test.ts"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 Setup.
2. Complete Phase 2 Foundational protocol/gateway/frontend services.
3. Complete Phase 3 US1 connection workflow.
4. Stop and validate against a fake TCP server before implementing movement controls.

### Incremental Delivery

1. US1: connect and state.
2. US2: safe button control.
3. US3: rocker control with `10 Hz` throttling.
4. US4: direct video and media commands.
5. US5: tracking toggle.
6. US6: mecanum wheel speeds.

### Validation Strategy

- Protocol tests must pass before gateway tests.
- Gateway fake TCP tests must pass before real-car testing.
- Real-car validation is manual and must be documented separately; do not infer ACK/telemetry behavior from command write success.
