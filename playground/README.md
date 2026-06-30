# Mahjong playground

A four-player vertical slice for `p2p-lockstep-kit-multisession`.

```bash
pnpm install
pnpm playground:dev
```

The default mode runs four real `MultiSessionRuntime` instances over
`FakeMeshNetwork` in one browser page. It covers joining, all-player Ready,
coordinator Start, deterministic dealing/discarding, whole-table offline pause,
reconnect synchronization and unanimous restart.

Use **连接 P2P** to switch one page to the published `NetworkEndpoint`. Create
the table with an empty coordinator Peer ID, then join from separate browser
profiles using the same table code and the host Peer ID. Ordinary tabs in one
browser share the resumed signaling identity and must not be used as separate
participants.

This first slice intentionally implements deterministic dealing and sequential
discarding only. Claim priority, win validation, scoring and concealed-data
semantics remain game-layer work for the next iteration.
