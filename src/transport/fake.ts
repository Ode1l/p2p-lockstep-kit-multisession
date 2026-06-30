import type { PeerId } from "../ids";
import type { PeerConnectionState } from "../state/types";
import type { MultiPeerTransport, Unsubscribe } from "./types";

interface QueuedMessage {
  readonly from: PeerId;
  readonly to: PeerId;
  readonly message: unknown;
}

const pairKey = (left: PeerId, right: PeerId): string =>
  [left, right].sort().join("|");

export class FakeMeshNetwork {
  readonly #transports = new Map<PeerId, FakeMultiPeerTransport>();
  readonly #connectedPairs = new Set<string>();
  readonly #connectionCounts = new Map<string, number>();
  readonly #queue: QueuedMessage[] = [];

  createTransport(localPeerId: PeerId): FakeMultiPeerTransport {
    if (this.#transports.has(localPeerId)) {
      throw new Error(`transport already exists for ${localPeerId}`);
    }
    const transport = new FakeMultiPeerTransport(this, localPeerId);
    this.#transports.set(localPeerId, transport);
    return transport;
  }

  connect(left: PeerId, right: PeerId): void {
    const local = this.#requireTransport(left);
    const remote = this.#requireTransport(right);
    const key = pairKey(left, right);
    if (this.#connectedPairs.has(key)) {
      local.setPeerState(right, "connected");
      remote.setPeerState(left, "connected");
      return;
    }
    this.#connectedPairs.add(key);
    this.#connectionCounts.set(key, (this.#connectionCounts.get(key) ?? 0) + 1);
    local.setPeerState(right, "connected");
    remote.setPeerState(left, "connected");
  }

  disconnect(left: PeerId, right: PeerId): void {
    const key = pairKey(left, right);
    if (!this.#connectedPairs.delete(key)) return;
    this.#transports.get(left)?.setPeerState(right, "disconnected");
    this.#transports.get(right)?.setPeerState(left, "disconnected");
  }

  disconnectPeer(peer: PeerId): void {
    for (const other of this.#transports.keys()) {
      if (other !== peer) this.disconnect(peer, other);
    }
  }

  enqueue(from: PeerId, to: PeerId, message: unknown): void {
    if (!this.#connectedPairs.has(pairKey(from, to))) {
      throw new Error(`peers ${from} and ${to} are not connected`);
    }
    this.#queue.push({ from, to, message });
  }

  queuedMessageCount(): number {
    return this.#queue.length;
  }

  getQueuedMessages(): readonly Readonly<QueuedMessage>[] {
    return this.#queue.map((item) => ({ ...item }));
  }

  duplicateQueued(index = 0): void {
    const item = this.#queue[index];
    if (!item) throw new RangeError("queued message does not exist");
    this.#queue.splice(index + 1, 0, item);
  }

  dropQueued(index = 0): void {
    if (!this.#queue.splice(index, 1).length) {
      throw new RangeError("queued message does not exist");
    }
  }

  deliverQueued(index = 0): void {
    const [item] = this.#queue.splice(index, 1);
    if (!item) throw new RangeError("queued message does not exist");
    this.#transports.get(item.to)?.receive(item.from, item.message);
  }

  deliverAll(): void {
    while (this.#queue.length > 0) this.deliverQueued(0);
  }

  getLogicalConnectionCount(left: PeerId, right: PeerId): number {
    return this.#connectionCounts.get(pairKey(left, right)) ?? 0;
  }

  remove(peerId: PeerId): void {
    this.disconnectPeer(peerId);
    this.#transports.delete(peerId);
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const item = this.#queue[index]!;
      if (item.from === peerId || item.to === peerId) this.#queue.splice(index, 1);
    }
  }

  #requireTransport(peerId: PeerId): FakeMultiPeerTransport {
    const transport = this.#transports.get(peerId);
    if (!transport) throw new Error(`unknown fake peer ${peerId}`);
    return transport;
  }
}

export class FakeMultiPeerTransport implements MultiPeerTransport {
  readonly localPeerId: PeerId;
  readonly #states = new Map<PeerId, PeerConnectionState>();
  readonly #messageHandlers = new Set<(peerId: PeerId, message: unknown) => void>();
  readonly #stateHandlers = new Set<
    (peerId: PeerId, state: PeerConnectionState) => void
  >();
  #disposed = false;

  constructor(
    readonly network: FakeMeshNetwork,
    localPeerId: PeerId,
  ) {
    this.localPeerId = localPeerId;
  }

  async connect(peerId: PeerId): Promise<void> {
    this.assertActive();
    if (peerId === this.localPeerId) throw new Error("cannot connect to local peer");
    if (this.getPeerState(peerId) === "connected") return;
    this.setPeerState(peerId, "connecting");
    this.network.connect(this.localPeerId, peerId);
  }

  disconnect(peerId: PeerId): void {
    if (this.#disposed) return;
    this.network.disconnect(this.localPeerId, peerId);
  }

  sendTo(peerId: PeerId, message: unknown): void {
    this.assertActive();
    this.network.enqueue(this.localPeerId, peerId, message);
  }

  broadcast(message: unknown, except: ReadonlySet<PeerId> = new Set()): void {
    this.assertActive();
    for (const peerId of this.getConnectedPeerIds()) {
      if (!except.has(peerId)) this.sendTo(peerId, message);
    }
  }

  getPeerState(peerId: PeerId): PeerConnectionState {
    return this.#states.get(peerId) ?? "disconnected";
  }

  getConnectedPeerIds(): readonly PeerId[] {
    return [...this.#states]
      .filter(([, state]) => state === "connected")
      .map(([peerId]) => peerId)
      .sort();
  }

  onMessage(handler: (peerId: PeerId, message: unknown) => void): Unsubscribe {
    this.assertActive();
    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  onPeerStateChange(
    handler: (peerId: PeerId, state: PeerConnectionState) => void,
  ): Unsubscribe {
    this.assertActive();
    this.#stateHandlers.add(handler);
    return () => this.#stateHandlers.delete(handler);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.network.remove(this.localPeerId);
    this.#states.clear();
    this.#messageHandlers.clear();
    this.#stateHandlers.clear();
  }

  setPeerState(peerId: PeerId, state: PeerConnectionState): void {
    if (this.#disposed || this.#states.get(peerId) === state) return;
    this.#states.set(peerId, state);
    for (const handler of [...this.#stateHandlers]) handler(peerId, state);
  }

  receive(peerId: PeerId, message: unknown): void {
    if (this.#disposed) return;
    for (const handler of [...this.#messageHandlers]) handler(peerId, message);
  }

  getListenerCounts(): Readonly<{ message: number; state: number }> {
    return { message: this.#messageHandlers.size, state: this.#stateHandlers.size };
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("transport is disposed");
  }

  private assertActive(): void {
    this.#assertNotDisposed();
  }
}
