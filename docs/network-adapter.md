# Network adapter boundary

## Current status

The multisession library ships an abstract `MultiPeerTransport` and an
in-memory fake full mesh. `p2p-lockstep-kit-network@0.1.4` now also exposes a
shared-identity `NetworkEndpoint<TPeerId>` and independent one-to-one
`PeerLink<TPeerId>` objects while preserving the existing `NetworkClient` API.

The signaling server needs no room or multiplayer change. One
registered WebSocket identity may relay any number of directed SDP/ICE messages
to different `to` Peer IDs. Its existing resume token preserves one Peer ID
across reconnects. `NetworkEndpoint` therefore reuses one registration and
routes each signal to the matching one-to-one link. It does not construct one
registered `NetworkClient` per remote: a second client cannot concurrently
resume the same online Peer ID (`ALREADY_CONNECTED`).

## Implemented adapter design

The packages divide responsibility as follows:

- network retains existing register/resume and `NetworkClient` behavior;
- `NetworkEndpoint` shares one signaling identity and routes SDP/ICE strictly
  by source and destination Peer IDs;
- each `PeerLink` remains one-to-one, owns one reliable ordered data channel and
  exposes only connect/send/state/disconnect lifecycle;
- network does not know tables, members, coordinators, Mesh, broadcast,
  connection order or reconnection policy;
- multisession's `EndpointMeshTransport` retains the selected links;
- the runtime chooses offerers, bounds concurrent connection attempts, sends
  table broadcasts by iterating its participant map and repairs required links;
- disposal and subscriptions remain instance-scoped and idempotent.

Media mesh is outside scope. Existing media methods remain one-to-one behavior
unless separately designed.

## Usage

```ts
import { NetworkEndpoint } from "p2p-lockstep-kit-network";
import {
  EndpointMeshTransport,
  type MultiPeerTransport,
  type PeerId,
} from "p2p-lockstep-kit-multisession";

const endpoint = new NetworkEndpoint<PeerId>();
const { peerId: localPeerId } = await endpoint.register(signalingUrl);
const transport: MultiPeerTransport = new EndpointMeshTransport(endpoint);
```

The joining participant first connects to the known coordinator Peer ID. After
membership is ordered, the multisession runtime connects the rest of the mesh;
for each missing pair only the lower validated Peer ID initiates the offer.
Before the Mesh is complete, the coordinator sends the membership event and
complete record over its existing one-to-one links. Gameplay remains disabled,
so network never needs a temporary host-relay mode for game commands.

## Remaining browser acceptance

1. Run real browser scenarios with 3, 4, 8, 10 and 20 peers, ordinary-peer loss and
   recovery, coordinator loss, and a mix of direct and TURN-relayed links.
2. Cover desktop plus WebKit/iOS-equivalent and Chromium/Android-equivalent
   engines.
3. Record mesh formation time, single-peer repair time, memory, data-channel
   round trip and relay usage. Treat these measurements, not connection-count
   arithmetic, as the viability result.

The adapter transports validated protocol messages but owns no membership,
coordinator, game, sync, authorization or UI policy.
