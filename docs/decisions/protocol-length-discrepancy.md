# Command Length Evidence

## Finding

The copied WebSocket contract result example contains `$011503011A#` for a
forward button command. The reference source does not generate that packet.

`entry/src/main/ets/CarUtill/CarEncode.ets` computes the length as
`info.length + 2`. A one-byte button payload is two hexadecimal characters, so
the resulting length is `04`. The original `doc/ros_api.md` also gives
`$011504011B#` as its button example.

## Implementation Decision

The Web encoder uses `$011504011B#` for `button: Front`, because the feature
specification requires reuse of the existing `CarEncode` rule. The copied
contract remains an unchanged reference snapshot. Hardware validation must
confirm this before a document-authority change is propagated upstream.
