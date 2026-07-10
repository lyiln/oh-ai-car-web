# Protocol Status: Real-Car Validation Required

## Do Not Treat Either Packet as Confirmed

Two retained documents disagree about the button command for `Front`:

| Evidence | Packet | Status |
|---|---|---|
| Original WebSocket contract example | `$011503011A#` | Unverified |
| Original ArkTS encoder and `ros_api.md` | `$011504011B#` | Unverified |

The Web gateway currently emits `$011504011B#` because it reproduces the
available ArkTS `CarEncode` algorithm. This is an implementation compatibility
assumption, not proof of the packet accepted by the physical car.

## Required Rule

- Do not change the packet format based only on either document.
- Do not claim a command is real-car compatible based on fake TCP tests.
- Before operating a real car, follow
  `docs/flows/web-control-real-car-validation.md` and record the observed
  packet behavior there.
- After a controlled real-car result is recorded, update this document, the
  WebSocket contract example, the encoder tests, and the decision record in
  one reviewable change.

## Local Evidence

- `docs/reference/protocol/ros_api.md`
- `docs/reference/protocol/encoder-evidence.md`
- `docs/decisions/protocol-length-discrepancy.md`
