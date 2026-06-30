import type { PeerId } from "../ids";
import type { PeerConnectionState } from "../state/types";
import type { MultiPeerTransport, Unsubscribe } from "./types";

export interface OneToOnePeerLink {
  readonly remotePeerId: PeerId;
  readonly state: PeerConnectionState;
  connect(): Promise<void>;
  disconnect(): void;
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): Unsubscribe;
  onStateChange(handler: (state: PeerConnectionState) => void): Unsubscribe;
  dispose(): void;
}

export interface SharedPeerEndpoint {
  readonly localPeerId: PeerId | null;
  peer(remotePeerId: PeerId): OneToOnePeerLink;
  onPeer(handler: (link: OneToOnePeerLink) => void): Unsubscribe;
  dispose(): void;
}

export interface EndpointMeshTransportOptions {
  readonly ownsEndpoint?: boolean;
}

export class EndpointMeshTransport implements MultiPeerTransport {
  readonly localPeerId: PeerId;
  readonly #endpoint: SharedPeerEndpoint;
  readonly #ownsEndpoint: boolean;
  readonly #links = new Map<PeerId, OneToOnePeerLink>();
  readonly #linkSubscriptions = new Map<PeerId, Unsubscribe[]>();
  readonly #messageHandlers = new Set<
    (peerId: PeerId, message: unknown) => void
  >();
  readonly #stateHandlers = new Set<
    (peerId: PeerId, state: PeerConnectionState) => void
  >();
  readonly #unsubscribeEndpoint: Unsubscribe;
  #disposed = false;

  constructor(
    endpoint: SharedPeerEndpoint,
    options: EndpointMeshTransportOptions = {},
  ) {
    if (!endpoint.localPeerId) {
      throw new Error("network endpoint must be registered first");
    }
    this.#endpoint = endpoint;
    this.localPeerId = endpoint.localPeerId;
    this.#ownsEndpoint = options.ownsEndpoint ?? true;
    this.#unsubscribeEndpoint = endpoint.onPeer((link) => this.#attach(link));
  }

  async connect(peerId: PeerId): Promise<void> {
    this.#assertActive();
    const link = this.#endpoint.peer(peerId);
    this.#attach(link);
    await link.connect();
  }

  disconnect(peerId: PeerId): void {
    if (this.#disposed) return;
    this.#links.get(peerId)?.disconnect();
  }

  sendTo(peerId: PeerId, message: unknown): void {
    this.#assertActive();
    const link = this.#links.get(peerId);
    if (!link) throw new Error(`peer link does not exist: ${peerId}`);
    link.send(message);
  }

  getPeerState(peerId: PeerId): PeerConnectionState {
    return this.#links.get(peerId)?.state ?? "disconnected";
  }

  onMessage(
    handler: (peerId: PeerId, message: unknown) => void,
  ): Unsubscribe {
    this.#assertActive();
    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  onPeerStateChange(
    handler: (peerId: PeerId, state: PeerConnectionState) => void,
  ): Unsubscribe {
    this.#assertActive();
    this.#stateHandlers.add(handler);
    return () => this.#stateHandlers.delete(handler);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeEndpoint();
    for (const unsubscribers of this.#linkSubscriptions.values()) {
      for (const unsubscribe of unsubscribers) unsubscribe();
    }
    this.#linkSubscriptions.clear();
    this.#links.clear();
    this.#messageHandlers.clear();
    this.#stateHandlers.clear();
    if (this.#ownsEndpoint) this.#endpoint.dispose();
  }

  #attach(link: OneToOnePeerLink): void {
    if (this.#disposed) return;
    const peerId = link.remotePeerId;
    const existing = this.#links.get(peerId);
    if (existing === link) return;
    const previousSubscriptions = this.#linkSubscriptions.get(peerId);
    if (previousSubscriptions) {
      for (const unsubscribe of previousSubscriptions) unsubscribe();
    }
    this.#links.set(peerId, link);
    this.#linkSubscriptions.set(peerId, [
      link.onMessage((message) => {
        for (const handler of [...this.#messageHandlers]) {
          try {
            handler(peerId, message);
          } catch {
            // One runtime observer must not break transport delivery.
          }
        }
      }),
      link.onStateChange((state) => {
        for (const handler of [...this.#stateHandlers]) {
          try {
            handler(peerId, state);
          } catch {
            // One runtime observer must not break link state delivery.
          }
        }
      }),
    ]);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("endpoint mesh transport is disposed");
  }
}
