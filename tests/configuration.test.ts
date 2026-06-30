import { describe, expect, it } from "vitest";
import {
  createSessionConfiguration,
  participantId,
  peerId,
  seatId,
  tableId,
  type ParticipantId,
  type PeerId,
} from "../src";

describe("configuration and identity domains", () => {
  it.each([3, 4, 8, 10, 20])("accepts an exact %i-player game instance", (count) => {
    const result = createSessionConfiguration({
      participantCount: count,
      seatIds: Array.from({ length: count }, (_, index) => seatId(`seat-${index}`)),
    });
    expect(result.ok).toBe(true);
  });

  it.each([2, 21, 3.5])("rejects participant count %s", (count) => {
    const result = createSessionConfiguration({
      participantCount: count,
      seatIds: [],
    });
    expect(result.ok).toBe(false);
  });

  it("keeps participant, peer and table IDs as distinct compile-time domains", () => {
    const participant: ParticipantId = participantId("participant-1");
    const peer: PeerId = peerId("peer-1");
    expect(participant).not.toBe(peer);
    expect(tableId("table-1")).toBe("table-1");
    // @ts-expect-error PeerId must not be assignable to ParticipantId.
    const invalid: ParticipantId = peer;
    expect(invalid).toBe(peer);
  });
});
