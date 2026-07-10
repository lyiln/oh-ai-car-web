# Contract: WebSocket Control API

> **Unconfirmed protocol example:** The encoded packet in the result example
> below is preserved from the original contract. It conflicts with the
> source-derived packet used by this implementation. Do not treat either value
> as real-car confirmed; see [`PROTOCOL_STATUS.md`](../../../PROTOCOL_STATUS.md).

## Endpoint

```text
ws://127.0.0.1:8787/control
```

The gateway must bind to localhost only in v1. Browser upgrades are accepted
only from `http://127.0.0.1:8787`, `http://localhost:8787`,
`http://127.0.0.1:5173`, and `http://localhost:5173`.
Any missing or unapproved `Origin` is rejected during the WebSocket handshake
with HTTP `403`; no WebSocket JSON error envelope is created.

Only one browser session can control a car at a time. The session that
successfully sends `connect` owns control until it disconnects or closes.

## Envelope

All browser-to-gateway messages use this shape:

```json
{
  "type": "command",
  "requestId": "uuid-or-client-generated-id",
  "command": "button",
  "payload": {}
}
```

Gateway result:

```json
{
  "type": "result",
  "requestId": "uuid-or-client-generated-id",
  "ok": true,
  "encoded": "$011503011A#"
}
```

Gateway error:

```json
{
  "type": "error",
  "requestId": "uuid-or-client-generated-id",
  "code": "NOT_CONNECTED",
  "message": "TCP socket is not connected"
}
```

Additional error codes: `CONTROLLER_BUSY` and `STOP_FAILED`. `STOP_FAILED`
means the gateway closed the TCP socket after a
best-effort Stop write failed; it does not mean the vehicle stopped.

Gateway state event:

```json
{
  "type": "state",
  "connected": true,
  "ownsControl": true,
  "controlAvailable": true,
  "target": {
    "host": "192.168.1.11",
    "tcpPort": 6000,
    "videoPort": 6500
  }
}
```

`connected` describes the gateway's TCP connection. `ownsControl` is true only
for the browser that may issue commands. `controlAvailable` is true when the
receiving browser may claim the controller session. A connected observer must
keep all car commands disabled.

## Commands

### `connect`

```json
{
  "type": "command",
  "requestId": "1",
  "command": "connect",
  "payload": {
    "host": "192.168.1.11",
    "tcpPort": 6000,
    "videoPort": 6500
  }
}
```

When the same controlling session reconnects, the gateway first performs a
best-effort Stop and closes the old TCP socket. It does not connect the new
target when that Stop write fails.

### `disconnect`

```json
{ "type": "command", "requestId": "9", "command": "disconnect", "payload": {} }
```

The gateway writes Stop before closing TCP and releasing the controlling
session. Gateway shutdown and controlling-browser closure follow the same
best-effort Stop sequence.

### `button`

```json
{
  "type": "command",
  "requestId": "2",
  "command": "button",
  "payload": {
    "direction": "Front"
  }
}
```

Allowed directions: `Stop`, `Front`, `After`, `Left`, `Right`, `LeftRotate`, `RightRotate`, `Brake`.

### `rocker`

```json
{
  "type": "command",
  "requestId": "3",
  "command": "rocker",
  "payload": {
    "x": 0,
    "y": 100
  }
}
```

Values must be in `-100..100`. Normal movement sends are capped at `10 Hz`; stop commands on release/cancel/blur are immediate.

### `wheelSpeeds`

```json
{
  "type": "command",
  "requestId": "4",
  "command": "wheelSpeeds",
  "payload": {
    "l1": 0,
    "l2": 0,
    "r1": 0,
    "r2": 0
  }
}
```

Each value must be in `-100..100`.

### Media and tracking commands

```json
{ "type": "command", "requestId": "5", "command": "photo", "payload": {} }
```

```json
{ "type": "command", "requestId": "6", "command": "startRecording", "payload": {} }
```

```json
{ "type": "command", "requestId": "7", "command": "stopRecording", "payload": {} }
```

```json
{
  "type": "command",
  "requestId": "8",
  "command": "tracking",
  "payload": { "enabled": true }
}
```

## Explicitly Unsupported in v1

- Raw encoded command input.
- Arbitrary TCP passthrough.
- LAN-exposed gateway listener.
- Car-side content or service changes.
- UI behavior that depends on car-side ACK/telemetry.
