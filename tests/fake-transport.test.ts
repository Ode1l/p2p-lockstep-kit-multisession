import { describe, expect, it } from "vitest";
import { FakeMeshNetwork, peerId } from "../src";

describe("fake full mesh transport", () => {
  it.each([3, 4, 8, 10, 20])(
    "creates each logical pair exactly once for %i peers",
    async (count) => {
      const network = new FakeMeshNetwork();
      const transports = Array.from({ length: count }, (_, index) =>
        network.createTransport(peerId(`peer-${index}`)),
      );
      for (let left = 0; left < transports.length; left += 1) {
        for (let right = left + 1; right < transports.length; right += 1) {
          await transports[left]!.connect(transports[right]!.localPeerId);
          await transports[right]!.connect(transports[left]!.localPeerId);
          expect(
            network.getLogicalConnectionCount(
              transports[left]!.localPeerId,
              transports[right]!.localPeerId,
            ),
          ).toBe(1);
        }
      }
      for (const transport of transports) {
        expect(transport.getConnectedPeerIds()).toHaveLength(count - 1);
      }
      for (const transport of transports) {
        transport.dispose();
        expect(transport.getListenerCounts()).toEqual({ message: 0, state: 0 });
      }
    },
  );

  it("can duplicate, delay, reorder and drop queued messages", async () => {
    const network = new FakeMeshNetwork();
    const left = network.createTransport(peerId("peer-left"));
    const right = network.createTransport(peerId("peer-right"));
    const received: unknown[] = [];
    right.onMessage((_peer, message) => received.push(message));
    await left.connect(right.localPeerId);
    left.sendTo(right.localPeerId, { seq: 1 });
    left.sendTo(right.localPeerId, { seq: 2 });
    network.duplicateQueued(0);
    network.deliverQueued(2);
    network.dropQueued(0);
    network.deliverAll();
    expect(received).toEqual([{ seq: 2 }, { seq: 1 }]);
  });
});
