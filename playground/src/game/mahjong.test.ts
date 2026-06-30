import {
  gameId,
  participantId,
  seatId,
  tableId,
  type Participant,
} from "p2p-lockstep-kit-multisession";
import { describe, expect, it } from "vitest";
import { mahjongPlugin } from "./mahjong";

const ids = ["south", "east", "north", "west"].map(participantId);
const participants = new Map(
  ids.map((id, index) => [
    id,
    {
      id,
      peerId: `peer-${index}`,
      joinedAtSeq: index + 1,
    } as Participant,
  ]),
);
const seats = new Map(
  ["south", "east", "north", "west"].map((seat, index) => [
    seatId(seat),
    ids[index]!,
  ]),
);

describe("mahjong playground plugin", () => {
  it("deals fourteen tiles to the first player and advances deterministically", () => {
    const state = mahjongPlugin.createInitialState({
      tableId: tableId("table-test"),
      gameId: gameId("game-test"),
      participantCount: 4,
      participants,
      seats,
    });
    const first = ids[0]!;
    const tile = state.hands[first]![0]!;
    expect(state.hands[first]).toHaveLength(14);
    expect(state.hands[ids[1]!]).toHaveLength(13);

    const next = mahjongPlugin.reduce(
      state,
      { type: "mahjong.discard", payload: { tileId: tile.id } },
      {
        tableId: tableId("table-test"),
        gameId: gameId("game-test"),
        actorId: first,
        participantCount: 4,
        participants,
        seats,
        lastAppliedSeq: 1,
      },
    );
    expect(next.currentParticipantId).toBe(ids[1]);
    expect(next.hands[first]).toHaveLength(13);
    expect(next.hands[ids[1]!]).toHaveLength(14);
    expect(next.discards[0]?.tile.id).toBe(tile.id);
  });
});
