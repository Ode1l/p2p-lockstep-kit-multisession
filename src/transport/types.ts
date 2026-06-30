import type { PeerId } from "../ids";
import type { PeerConnectionState } from "../state/types";

export type Unsubscribe = () => void;

export interface MultiPeerTransport {
  readonly localPeerId: PeerId | null;
  connect(peerId: PeerId): Promise<void>;
  disconnect(peerId: PeerId): void;
  sendTo(peerId: PeerId, message: unknown): void;
  getPeerState(peerId: PeerId): PeerConnectionState;
  onMessage(handler: (peerId: PeerId, message: unknown) => void): Unsubscribe;
  onPeerStateChange(
    handler: (peerId: PeerId, state: PeerConnectionState) => void,
  ): Unsubscribe;
  dispose(): void;
}
