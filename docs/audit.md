# Legacy kit audit

## Scope and source priority

This audit was performed against the checkout at `../p2p-lockstep-kit` and the
legacy notes at `../resume/network.md` and `../resume/session.md`. The inspected
areas were the complete network and session source trees, the UI README,
package manifest, public types and application shell, and the Gomoku package,
rules and tests.

The original checkout contains no root package manifest, lockfile or installed
`node_modules`. The separate authoritative repositories were subsequently made
available and inspected. Their manifests declare
`p2p-lockstep-kit-network@0.1.3`, `p2p-lockstep-kit-session@0.1.12` and
`p2p-lockstep-kit-ui@0.1.4`. Network emits `dist/network/index.js` plus
declarations with `tsc`; session emits ESM and declarations with `tsup`; UI
emits an ESM library, declarations and CSS with Vite/`tsc`. The repositories
remain read-only inputs until adapter work is separately authorized.

## Current behavior

### Network

- `NetworkClient` owns exactly one `RtcPeer`, one remote peer identifier and one
  data channel. Registering again disposes that peer and creates a new
  `RTCPeerConnection`.
- `SignalingClient` supports register, ten-minute local resume credentials,
  `offer`/`answer`/ICE relay and multiple signal listeners. This signaling shape
  can serve several peer wrappers after suitable lifecycle and routing work.
- `RtcPeer` implements offer/answer/ICE, a reliable ordered `game` data channel,
  queued sends while requesting, media renegotiation and listener cleanup on
  disposal.
- There is no deterministic offerer rule, negotiation concurrency limit,
  per-peer state map, independent peer repair or mesh completeness concept.
- JSON decoding isolates syntax errors, but decoded signaling and application
  values are accepted through TypeScript casts rather than runtime schemas.

### Session

- `createSession` is directly typed against `NetworkClient` and initializes a
  process-global context used by every handler. A second session replaces the
  first session's dependencies.
- State is two mirrored FSMs named `local` and `remote`; history entries and win
  results use the same perspective-relative labels.
- The Command Bus serializes handler execution. The observer keeps subscriber
  sets and returns an unsubscribe function from the public game observer.
- Both local and remote moves pass through the same plugin validation, and the
  ordered history is sufficient for the Gomoku example to reconstruct its
  board.
- `seq`, `stateHash` and parts of `sid` exist only as optional envelope fields.
  There is no versioned discriminated wire union, schema validation, dedupe,
  gap handling, hash chain, coordinator ordering or equivocation detection.
- Sync replaces the complete history and flips every `local`/`remote` label.
  It has no snapshot checkpoint, tail sync, hash verification or private-state
  boundary.
- Start uses `Math.random()` on the initiating peer and transmits its choice.
  Undo/restart are specifically two-party request/approval flows.
- Handler failures and invalid input are generally logged and dropped; they do
  not produce a stable protocol-error state. There is no aggregate `dispose()`
  contract for timers, state observers and transport listeners.

### UI and Gomoku

- The UI composes the concrete one-peer network and session packages itself.
  Its public state exposes peer identity, connection, both FSM states, ready,
  turn, history, pending approval and the last error.
- A fresh share URL stays on pairing until a real connection. An interrupted
  match remains visible, and visibility/page-show recovery asks the UI runtime
  to reconnect.
- These presentation principles are reusable, but the `me`/`peer` model and
  direct package composition are not a multi-session API.
- Gomoku uses a tagged serializable move, validates untrusted move shape, and
  reconstructs rule state entirely from history. Its tests demonstrate the
  desired deterministic plugin testing style.

The legacy session note mentions `REJOIN`, but the inspected session protocol
union does not contain it. Source is treated as authoritative for this audit.

## Reuse matrix

| Area | Reuse | Rewrite or adapt | Missing capability |
| --- | --- | --- | --- |
| Signaling registration | Register/resume intent, ICE server response, credential storage pattern | Replace casts with schemas; make subscriptions disposable; verify authoritative package API | Participant credential and table-membership recovery |
| `RtcPeer` | Offer/answer/ICE and ordered data-channel lifecycle snippets | One wrapper per remote peer; deterministic offerer; new connection object on repair; bounded negotiation queue | 3/4/8/10/20-peer browser evidence and TURN metrics |
| Serialization | `decodeSafe` error isolation and opaque transport payload | Canonical serialization and runtime parsing at the protocol boundary | Version negotiation, size/depth limits and structured parse errors |
| Command dispatch | Type-to-handler routing and serialized execution | Instance-scoped dependencies; explicit result/error flow; disposal | Coordinator command ordering and backpressure policy |
| Session state | History/replay as the source of truth | One table/game reducer plus participant, seat, readiness and connection maps | Stable identities, membership, outcomes and decision windows |
| Game plugin | Deterministic validation/replay boundary and tagged game payloads | Generic command/event/state/outcome types; ordered-event validation; snapshots | Simultaneous intent resolution and hidden-information extension |
| Observer | Subscriber set, error isolation and unsubscribe handle | Immutable multi-participant snapshot; initial snapshot; aggregate cleanup | Mesh, sync, conflict, proposal and per-peer visibility |
| Ready/start | Explicit lifecycle actions | Membership- and seat-aware readiness; coordinator-ordered start | Open product policy for player counts and required seats |
| Undo/restart | Proposal concept | Generic proposal/vote events and configurable policy | Product decision for quorum, kick and dissolution |
| Reconnect/sync | Distinguish peer resume from timeline restoration; page-resume trigger | Tail/checkpoint sync with hash verification and cross-check | Participant credential, private-state recovery and coordinator outage policy |
| UI | Information hierarchy, fresh-invite gate, active-game recovery | Separate future multi UI driven only by public snapshots/facade | Responsive multi-seat UI, not part of this repository |
| Tests/build | Vitest/strict TypeScript and history-driven rule tests | Library build emitting JavaScript and declarations; fake mesh tests | Root toolchain, lockfile, package smoke test and browser matrix |

## Principal risks

1. The one-to-one package source and manifests are now known, but a future
   adapter still needs tarball-level regression tests before modifying those
   repositories.
2. A full mesh does not supply a total order. Coordinator sequencing plus local
   validation and peer checkpoint comparison are all required; omitting any one
   leaves either nondeterminism or undetected equivocation.
3. A public checkpoint can restore only public deterministic state. Secret
   hands/decks need a separate persistence or cryptographic protocol and must
   never enter the common sync snapshot.
4. Browser viability at twenty peers is an empirical acceptance criterion. Unit
   tests and the theoretical 190-connection count are insufficient.
5. v1 deliberately trades confidentiality and anti-cheat protection for a
   simple complete-record sync model. This limitation must be explicit in the
   public README and API documentation.
