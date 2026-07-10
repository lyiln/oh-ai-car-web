# Protocol Packet Conflict

## Status

Unresolved. No real-car packet capture or acknowledgement has been collected.

## Conflicting Evidence

The retained WebSocket contract example contains `$011503011A#` for a forward
button command. The source-derived evidence does not generate that packet.

`entry/src/main/ets/CarUtill/CarEncode.ets` computes the length as
`info.length + 2`. A one-byte button payload is two hexadecimal characters, so
the resulting length is `04`. The original `doc/ros_api.md` also gives
`$011504011B#` as its button example.

## Current Implementation Choice

The Web encoder uses `$011504011B#` for `button: Front`, because its stated
goal is to reproduce the available `CarEncode` rule. This is not a claim that
the physical car accepts this packet. The original contract example remains
preserved as conflicting evidence.

## Resolution Gate

Only a controlled real-car validation result may resolve this conflict. Record
the observed data in `docs/flows/web-control-real-car-validation.md`, then
update `PROTOCOL_STATUS.md`, this decision, the contract example, and encoder
tests together.
