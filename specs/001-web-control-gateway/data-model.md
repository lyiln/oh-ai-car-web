# Data Model: Web Control Gateway

## ConnectionConfig

Represents operator-configured network settings.

| Field | Type | Validation |
|---|---|---|
| `host` | string | Required IPv4/hostname; default `192.168.1.11` |
| `tcpPort` | number | Integer `1..65535`; default `6000` |
| `videoPort` | number | Integer `1..65535`; default `6500` |
| `timeoutMs` | number | Positive integer; implementation default selected during coding |

## GatewaySession

Represents one browser-to-gateway control session.

| Field | Type | Validation |
|---|---|---|
| `sessionId` | string | Unique per WebSocket connection |
| `connected` | boolean | True only when TCP socket is connected |
| `target` | ConnectionConfig | Current configured car target |
| `lastCommandAt` | ISO timestamp or null | Updated after gateway writes command to TCP |
| `lastError` | string or null | Last connection/command error |

## CarCommand

High-level command accepted by the browser/gateway API.

| Command | Payload | Validation |
|---|---|---|
| `connect` | ConnectionConfig | Gateway binds localhost; target connects over LAN |
| `disconnect` | none | Closes TCP socket |
| `button` | `{ direction }` | Direction is `Stop`, `Front`, `After`, `Left`, `Right`, `LeftRotate`, `RightRotate`, or `Brake` |
| `rocker` | `{ x, y }` | `x` and `y` are numbers in `-100..100`; normal sends capped at `10 Hz` |
| `wheelSpeeds` | `{ l1, l2, r1, r2 }` | Each wheel speed is `-100..100` |
| `photo` | none | Encodes command `60` |
| `startRecording` | none | Encodes command `61` |
| `stopRecording` | none | Encodes command `62` |
| `tracking` | `{ enabled }` | `true` encodes `63`; `false` encodes `64` |

Raw encoded commands are not accepted in v1.

## EncodedCommand

String sent to the car TCP socket.

| Field | Type | Validation |
|---|---|---|
| `value` | string | Must match `$` + hex body + checksum + `#` |
| `commandCode` | string | One of `10`, `15`, `21`, `60`, `61`, `62`, `63`, `64` |
| `payloadHex` | string | Uppercase hexadecimal payload |

## VideoConfig

Represents the video preview target.

| Field | Type | Validation |
|---|---|---|
| `url` | string | `http://<host>:<videoPort>/index2` |
| `mode` | string | v1 value: `direct` |
| `error` | string or null | Set when direct video loading fails |

## State Transitions

```text
GatewaySession disconnected
  -> connect(config)
  -> connecting
  -> connected OR error

connected
  -> command write success
  -> connected with lastCommandAt updated

connected
  -> disconnect OR socket error
  -> disconnected

rocker active
  -> release/cancel/blur
  -> send immediate stop
  -> rocker centered
```
