import { describe, expect, it } from "vitest";
import {
  createOrderedEvent,
  eventId,
  reduceOrderedEvent,
  type GameOutcome,
} from "../src";
import { buildSeatedState, testPlugin } from "./helpers";

describe("game outcomes", () => {
  it.each(["draw", "ranking", "aborted", "multiple-winners"])(
    "applies a deterministic %s outcome",
    async (kind) => {
      const { state: seated, participants } = await buildSeatedState(3);
      const outcome: GameOutcome =
        kind === "draw"
          ? { type: "draw", reason: "no legal action" }
          : kind === "ranking"
            ? { type: "ranking", order: participants.map((item) => item.id) }
            : kind === "aborted"
              ? { type: "aborted", reason: "game rule aborted" }
              : {
                  type: "winner",
                  winners: [participants[0]!.id, participants[1]!.id],
                };
      const state = {
        ...seated,
        phase: "playing" as const,
        game: { moves: [] },
      };
      const plugin = { ...testPlugin, getOutcome: () => outcome };
      const event = await createOrderedEvent({
        eventId: eventId(`outcome-${kind}`),
        tableId: state.tableId,
        gameId: state.gameId,
        seq: state.lastAppliedSeq + 1,
        coordinatorEpoch: state.coordinatorEpoch,
        actorId: participants[0]!.id,
        spec: { type: "GAME_ENDED", payload: { outcome } },
        previousHash: state.lastEventHash,
      });
      const reduced = reduceOrderedEvent(state, event, plugin);
      expect(reduced).toMatchObject({ ok: true, value: { phase: "ended", outcome } });
    },
  );
});
