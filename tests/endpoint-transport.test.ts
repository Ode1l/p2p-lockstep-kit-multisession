import { describe, expect, it } from "vitest";
import { peerId, type PeerId } from "../src/ids";
import type { PeerConnectionState } from "../src/state/types";
import {
  EndpointMeshTransport,
  type OneToOnePeerLink,
  type SharedPeerEndpoint,
} from "../src/transport/endpoint";

class FakeLink implements OneToOnePeerLink {
  state: PeerConnectionState = "disconnected";
  readonly sent: unknown[] = [];
  readonly #messageHandlers = new Set<(message: unknown) => void>();
  readonly #stateHandlers = new Set<
    (state: PeerConnectionState) => void
  >();

  constructor(readonly remotePeerId: PeerId) {}

  async connect(): Promise<void> {
    this.#setState("connecting");
    this.#setState("connected");
  }

  disconnect(): void {
    this.#setState("disconnected");
  }

  send(message: unknown): void {
    if (this.state !== "connected") throw new Error("not connected");
    this.sent.push(message);
  }

  onMessage(handler: (message: unknown) => void) {
    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  onStateChange(handler: (state: PeerConnectionState) => void) {
    this.#stateHandlers.add(handler);
    return () => this.#stateHandlers.delete(handler);
  }

  dispose(): void {
    this.disconnect();
    this.#messageHandlers.clear();
    this.#stateHandlers.clear();
  }

  receive(message: unknown): void {
    for (const handler of [...this.#messageHandlers]) handler(message);
  }

  #setState(state: PeerConnectionState): void {
    this.state = state;
    for (const handler of [...this.#stateHandlers]) handler(state);
  }
}

class FakeEndpoint implements SharedPeerEndpoint {
  readonly links = new Map<PeerId, FakeLink>();
  readonly #handlers = new Set<(link: OneToOnePeerLink) => void>();
  disposed = false;

  constructor(readonly localPeerId: PeerId) {}

  peer(remotePeerId: PeerId): FakeLink {
    const existing = this.links.get(remotePeerId);
    if (existing) return existing;
    const link = new FakeLink(remotePeerId);
    this.links.set(remotePeerId, link);
    for (const handler of [...this.#handlers]) handler(link);
    return link;
  }

  onPeer(handler: (link: OneToOnePeerLink) => void) {
    this.#handlers.add(handler);
    for (const link of this.links.values()) handler(link);
    return () => this.#handlers.delete(handler);
  }

  dispose(): void {
    this.disposed = true;
    for (const link of this.links.values()) link.dispose();
    this.links.clear();
    this.#handlers.clear();
  }
}

describe("EndpointMeshTransport", () => {
  it("adapts independent links while keeping aggregate behavior in session", async () => {
    const endpoint = new FakeEndpoint(peerId("peer-local"));
    const transport = new EndpointMeshTransport(endpoint);
    const remote = peerId("peer-remote");
    const states: PeerConnectionState[] = [];
    const messages: unknown[] = [];
    transport.onPeerStateChange((source, state) => {
      if (source === remote) states.push(state);
    });
    transport.onMessage((source, message) => {
      messages.push({ source, message });
    });

    await transport.connect(remote);
    transport.sendTo(remote, { direct: true });
    endpoint.peer(remote).receive({ reply: true });

    expect(states).toEqual(["connecting", "connected"]);
    expect(endpoint.peer(remote).sent).toEqual([{ direct: true }]);
    expect(messages).toEqual([{ source: remote, message: { reply: true } }]);
    expect(transport).not.toHaveProperty("broadcast");
    transport.dispose();
    expect(endpoint.disposed).toBe(true);
  });

  it("observes a link created by an incoming endpoint offer", () => {
    const endpoint = new FakeEndpoint(peerId("peer-local"));
    const transport = new EndpointMeshTransport(endpoint, {
      ownsEndpoint: false,
    });
    const remote = peerId("peer-incoming");
    const messages: unknown[] = [];
    transport.onMessage((source, message) => messages.push({ source, message }));

    const incoming = endpoint.peer(remote);
    incoming.receive({ join: true });

    expect(messages).toEqual([{ source: remote, message: { join: true } }]);
    transport.dispose();
    expect(endpoint.disposed).toBe(false);
  });
});
