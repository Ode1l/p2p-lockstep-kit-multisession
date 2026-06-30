# p2p-lockstep-kit-multisession

Deterministic P2P session core for private three-to-twenty-player turn-based
games. The library provides stable participant/peer/seat identities, a
coordinator-ordered hash-chained event log, full-mesh transport abstractions,
runtime validation, reconnect synchronization and instance-scoped observers.

This package is not a game, UI, lobby, signaling server or authoritative game
server. See [the architecture](docs/architecture.md),
[protocol](docs/protocol.md) and [confirmed decisions](docs/decisions.md).

The v1 trust model does not provide hidden-information confidentiality or
anti-cheat protection. Synchronization may transfer the complete existing
session record.

The repository includes a four-player Mahjong vertical slice in
[`playground`](playground). Run it with `pnpm playground:dev`; it defaults to a
four-runtime in-browser simulation and also exposes a real signaling/WebRTC
connection form.

## Install

```bash
pnpm add p2p-lockstep-kit-multisession
```

## Runtime outline

```ts
import {
  MultiSessionRuntime,
  EndpointMeshTransport,
  NetworkEndpoint,
  createSessionConfiguration,
  gameId,
  participantId,
  seatId,
  tableId,
  type PeerId,
} from "p2p-lockstep-kit-multisession";

const endpoint = new NetworkEndpoint<PeerId>();
const { peerId: localPeerId } = await endpoint.register(signalingUrl);
const transport = new EndpointMeshTransport(endpoint);

const configuration = createSessionConfiguration({
  participantCount: 4,
  seatIds: ["east", "south", "west", "north"].map(seatId),
});
if (!configuration.ok) throw new Error(configuration.error);

const runtime = new MultiSessionRuntime({
  tableId: tableId("private-table"),
  gameId: gameId("game-1"),
  localParticipant: {
    id: participantId("participant-a"),
    peerId: localPeerId,
  },
  coordinatorId: participantId("participant-a"),
  coordinatorPeerId: localPeerId,
  configuration: configuration.value,
  plugin: gamePlugin,
  transport,
  ownsTransport: true,
});

await runtime.start();
const unsubscribe = runtime.subscribe({
  onStateChange(snapshot) {
    console.log(snapshot.state.phase, snapshot.state.participants);
  },
});
```

`gamePlugin` implements `MultiGamePlugin`. `NetworkEndpoint` retains independent
one-to-one links; `EndpointMeshTransport` and the runtime own the participant
topology and Full Mesh policy. Every runtime is instance-scoped and must be
disposed:

```ts
unsubscribe();
runtime.dispose();
```

Coordinator actions are converted to a continuous, SHA-256 hash-chained event
sequence. Other nodes validate the same events before reducing them. A gap
requests complete-record synchronization; conflicting hashes stop the runtime.

## Confirmed v1 behavior

- The game instance chooses one exact participant count from 3 through 20.
- Every configured seat must be occupied and every participant ready to start.
- No mid-game join, replacement, seat change, spectator or role change.
- Any participant disconnect pauses the whole table in `offline`; commands stay
  disabled until the complete mesh reconnects and synchronization finishes.
- Undo is not part of the API. Restart requires every participant to approve.
- No turn timeout, automatic pass, bot takeover or coordinator election.
- No hidden-information confidentiality, randomness or anti-cheat guarantee.

## Network integration status

The included `FakeMeshNetwork` remains the deterministic test transport.
`p2p-lockstep-kit-network@0.1.4` adds `NetworkEndpoint`: one signaling
registration and WebSocket, exposing independent one-to-one `PeerLink` objects.
The session package combines those links into its topology. The existing
one-to-one `NetworkClient` and signaling-server protocol are unchanged. See
[the adapter boundary](docs/network-adapter.md).
