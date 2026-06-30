# Network adapter boundary

## Current status

The multisession library will first ship and test an abstract
`MultiPeerTransport` plus an in-memory fake full mesh. The legacy integrated
checkout exposes only a one-peer `NetworkClient`. The authoritative repositories
are now present and declare network 0.1.3, session 0.1.12 and UI 0.1.4. They are
read-only inputs in the current phase; no legacy source is modified.

The inspected signaling server needs no room or multiplayer change. One
registered WebSocket identity may relay any number of directed SDP/ICE messages
to different `to` Peer IDs. Its existing resume token preserves one Peer ID
across reconnects. The missing capability is only in the network client:
`NetworkClient` owns one `RtcPeer`, and a second client cannot concurrently
resume the same online Peer ID (`ALREADY_CONNECTED`). The future adapter must
therefore reuse one signaling registration and place the peer map below it.

## Required adapter design

A future backward-compatible adapter belongs in the authorized network package
or in a separate bridge package. It must add a new API rather than changing the
semantics of `NetworkClient`:

- retain existing register/resume, single-peer connect/send/media behavior;
- share or safely compose the signaling connection without losing signal
  listeners;
- own one fresh `RTCPeerConnection`/peer wrapper per remote `PeerId`;
- route signaling strictly by source and destination peer IDs;
- choose exactly one initial offerer for each peer pair by stable Peer ID
  comparison;
- limit concurrent connection negotiations (recommended default three);
- use one reliable ordered data channel per peer connection;
- expose per-peer connecting/connected/reconnecting/failed/closed states;
- repair or replace one failed link without resetting healthy links;
- provide unsubscribe handles and idempotent aggregate disposal;
- expose optional connection diagnostics needed to record TURN relay usage and
  connection/reconnection timing without leaking credentials.

Media mesh is outside scope. Existing media methods remain one-to-one behavior
unless separately designed.

## Acceptance before integration

1. Resolve the authoritative network repository and current package exports.
2. Add regression tests proving existing `NetworkClient` behavior and types are
   unchanged.
3. Run real browser scenarios with 3, 4, 8, 10 and 20 peers, ordinary-peer loss and
   recovery, coordinator loss, and a mix of direct and TURN-relayed links.
4. Cover desktop plus WebKit/iOS-equivalent and Chromium/Android-equivalent
   engines.
5. Record mesh formation time, single-peer repair time, memory, data-channel
   round trip and relay usage. Treat these measurements, not connection-count
   arithmetic, as the viability result.

The adapter transports validated protocol messages but owns no membership,
coordinator, game, sync, authorization or UI policy.
