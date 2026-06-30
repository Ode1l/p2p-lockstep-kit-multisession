# Changelog

## 0.1.0

- Added an instance-scoped three-to-twenty-participant session runtime.
- Added stable table, game, participant, peer, seat, event and message IDs.
- Added runtime-validated protocol messages and ordered events.
- Added coordinator sequencing, SHA-256 hash chains, deduplication, gap recovery
  and peer checkpoint conflict detection.
- Added exact-seat readiness, deterministic game plugins, simultaneous decision
  windows, outcomes and unanimous restart proposals.
- Added per-peer connection state, whole-table offline pause and complete-record
  reconnect synchronization.
- Added abstract and deterministic fake Full Mesh transports.

The first version intentionally excludes Undo, spectators, mid-game membership,
seat changes, coordinator migration, timeout policy, anti-cheat and a production
WebRTC Full Mesh adapter.
