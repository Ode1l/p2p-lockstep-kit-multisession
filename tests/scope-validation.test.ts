import { describe, expect, it } from "vitest";
import {
  createOrderedEvent,
  eventId,
  gameId,
  parseOrderedEvent,
  participantId,
  reduceOrderedEvent,
  tableId,
} from "../src";
import { buildSeatedState, testPlugin } from "./helpers";

describe("event authorization and scope validation", () => {
  it.each(["table", "game", "actor"])("rejects a wrong %s scope", async (kind) => {
    const { state, participants } = await buildSeatedState(3);
    const actor =
      kind === "actor" ? participantId("participant-outsider") : participants[0]!.id;
    const event = await createOrderedEvent({
      eventId: eventId(`wrong-${kind}`),
      tableId: kind === "table" ? tableId("other-table") : state.tableId,
      gameId: kind === "game" ? gameId("other-game") : state.gameId,
      seq: state.lastAppliedSeq + 1,
      coordinatorEpoch: state.coordinatorEpoch,
      actorId: actor,
      spec: {
        type: "READY_CHANGED",
        payload: { participantId: actor, ready: true },
      },
      previousHash: state.lastEventHash,
    });
    const reduced = reduceOrderedEvent(state, event, testPlugin);
    expect(reduced.ok).toBe(false);
  });

  it("rejects a malformed event payload before reduction", () => {
    expect(
      parseOrderedEvent({
        eventId: "event-1",
        tableId: "table-1",
        gameId: "game-1",
        seq: 1,
        coordinatorEpoch: 1,
        actorId: "participant-1",
        type: "READY_CHANGED",
        payload: { participantId: "participant-1", ready: "yes" },
        previousHash: null,
        eventHash: "0".repeat(64),
      }).ok,
    ).toBe(false);
  });
});
