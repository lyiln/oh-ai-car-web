# Source-Derived Encoding Evidence

This is a documentation summary of the retained source snapshot at commit
`6a9a7cb8839a6c16777eabf1f74e65d8c5867c1f`. It intentionally does not copy
ArkTS application source into this repository.

## Confirmed Source Behavior

- TCP control endpoint default: port `6000`.
- Video endpoint pattern: `http://<ip>:<videoPort>/index2`, default port
  `6500`.
- Default car address: `192.168.1.11`.
- Packet framing: `$` + vehicle type `01` + command + length + payload +
  checksum + `#`.
- The source encoder calculates length from the hexadecimal payload character
  count plus `2`; it calculates the checksum as the byte sum modulo `256`.
- Rocker and four-wheel values are rounded; a negative value is converted by
  adding `256` before two-character uppercase hexadecimal encoding.

## Command Evidence

| Capability | Command |
|---|---|
| Rocker X/Y | `10` |
| Button direction | `15` |
| Four wheel speeds | `21` |
| Photo / recording start / recording stop | `60` / `61` / `62` |
| Tracking on / off | `63` / `64` |

Button direction values are `Stop=0`, `Front=1`, `After=2`, `Left=3`,
`Right=4`, `LeftRotate=5`, `RightRotate=6`, and `Brake=7`.

## Boundary

The source-derived `Front` packet is `$011504011B#`. This conflicts with the
original WebSocket contract example and remains unconfirmed by real hardware.
See `PROTOCOL_STATUS.md` in the repository root.
