# Contract: WebSocket Control API

> **Unconfirmed protocol example:** The encoded packet in the result example
> below is preserved from the original contract. It conflicts with the
> source-derived packet used by this implementation. Do not treat either value
> as real-car confirmed; see [`PROTOCOL_STATUS.md`](../../../PROTOCOL_STATUS.md).

## Endpoint

```text
ws://127.0.0.1:<gatewayPort>/control
```

The gateway must bind to localhost only in v1.

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

Gateway state event:

```json
{
  "type": "state",
  "connected": true,
  "target": {
    "host": "192.168.1.11",
    "tcpPort": 6000,
    "videoPort": 6500
  }
}
```

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
