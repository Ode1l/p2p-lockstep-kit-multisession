# Product decisions

The following v1 behavior was confirmed on 2026-06-30 and is now part of the
implementation contract.

| ID | Decision | Confirmed v1 behavior | Deferred possibility |
| --- | --- | --- | --- |
| D1 | Player count and start condition | A game instance supplies one exact `participantCount` when created. It must be 3-20. The game starts only when that many seats are occupied and every participant is ready. | Different instance-level counts remain possible; plugin ranges are unnecessary. |
| D2 | Mid-game membership and roles | No join after play starts, no member replacement, no seat changes, no spectators and no role changes. | Replacements or spectators require a later membership redesign. |
| D3 | Any participant disconnects | Every node enters `offline` and the entire game pauses immediately. There is no grace-period outcome and no coordinator migration. After the mesh reconnects, nodes sync before resuming. | A later version may define coordinator migration. |
| D4 | Undo and restart | Undo is not implemented. Restart uses a proposal and requires every current participant to approve. | A later restart flow may return remaining members to preparation and admit a replacement. |
| D5 | Timeouts | v1 has no automatic pass, bot, loss, removal or deadline consequence. It waits for input or reconnection. | Game-specific timeout policy can be added later. |
| D6 | Randomness, hidden data and anti-cheat | Core provides no randomness, hidden-information protocol or anti-cheat guarantee. A participant may inspect/alter locally available data. Sync may transfer the complete existing session record. | Trusted-deck or mental-poker protocols are separate future work. |
| D7 | Participant continuity | `ParticipantId` remains stable and is supplied/persisted by the application on the same client. v1 provides no secure cross-device takeover or impersonation resistance. | Credential transfer and revocation require a later security design. |
| D8 | Cross-repository work | The authoritative network/session/UI repositories are read-only inputs for now. Build the abstract transport and fake mesh here before a separately authorized backward-compatible adapter change. | A real adapter remains a later cross-repository task. |

## Confirmed constraints

- Three to twenty participants; WebRTC data-channel full mesh; at most 190 pair
  links and 19 remote links per device.
- Private invitation flow, existing signaling for SDP/ICE, optional TURN only as
  a transport relay.
- Logical coordinator ordering with independent deterministic verification and
  no authoritative game server.
- Stable participant identity distinct from peer and seat identity.
- Immutable versioned public event log, runtime validation, hash chain,
  sequence-gap recovery and peer checkpoint comparison.
- One table/game state machine with participant maps; instance-scoped runtime;
  no `local`/`remote` history rewriting.
- v1 does not promise private/hidden-state confidentiality and may sync the
  complete existing record.
- Multi-session UI and Mahjong rules are separate projects.
