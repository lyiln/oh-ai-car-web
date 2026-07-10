# Quickstart: Web Control Gateway Validation

This guide validates the planned Web control gateway feature after implementation. It does not assume real-car access for unit and fake TCP checks.

## Prerequisites

- Operator machine on the same LAN as the smart car.
- Browser available on the operator machine.
- Future implementation under `web/`.
- Existing smart car TCP service reachable at `<car-ip>:6000` for manual validation.
- Existing video endpoint reachable at `http://<car-ip>:6500/index2` for manual validation.

## 1. Protocol Unit Validation

Run the future protocol test suite.

Expected outcomes:
- Button commands encode command `15`.
- Rocker commands encode command `10`.
- Wheel speed commands encode command `21`.
- Media/tracking commands encode `60`, `61`, `62`, `63`, and `64`.
- Negative values are rounded, converted by adding `256`, and encoded as uppercase two-character hex.
- Checksums match the existing `CarEncode.BaseEncode()` behavior.

## 2. Gateway Fake TCP Validation

Start a fake TCP server on a local test port, then connect the gateway to that fake target.

Expected outcomes:
- Gateway binds its browser-facing WebSocket endpoint to localhost only.
- Browser command messages are accepted only through high-level commands.
- Fake TCP server receives encoded command strings.
- Gateway result means TCP write success, not car-side ACK.
- Gateway rejects movement commands when disconnected.
- WebSocket disconnect triggers best-effort Stop if TCP is connected.

## 3. Frontend Interaction Validation

Open the Web UI on the operator machine.

Expected outcomes:
- Defaults show `192.168.1.11`, `6000`, and `6500`.
- Movement controls are disabled before connection.
- Connect failure leaves movement controls disabled and shows an error.
- Button press sends direction; release sends Stop.
- Rocker movement is throttled to at most `10 Hz`.
- Rocker release/cancel/blur sends immediate stop.
- Raw encoded command input is not present.
- Video preview uses `http://<ip>:<videoPort>/index2`.
- Video load failure shows an error state without requiring car-side changes.

## 4. Manual Real-Car Validation

Only run when the car is available and the operator can safely stop it.

Expected outcomes:
- Connect to the configured car IP and TCP port.
- Verify forward, back, left, right, left rotate, right rotate, Stop, and Brake.
- Verify rocker center stop.
- Verify four-wheel speed update and reset.
- Verify photo, recording start/stop, and tracking toggle commands.
- Verify direct video load or record the browser failure for follow-up.

## 5. Documentation Follow-Up

Record real-car findings in `docs/flows/web-control-real-car-validation.md` after manual validation. Do not update the spec to claim ACK/telemetry behavior until the car-side protocol is confirmed.
