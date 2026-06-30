import { describe, expect, it } from "vitest";
import { proposalId } from "../src";
import { buildSeatedState, orderCommand } from "./helpers";

describe("multi-session reducer and coordinator", () => {
  it.each([3, 4, 8, 10, 20])(
    "builds an exact %i-participant seated table",
    async (count) => {
      const { state } = await buildSeatedState(count);
      expect(state.participants.size).toBe(count);
      expect(state.seats.size).toBe(count);
      expect([...state.seats.values()].filter(Boolean)).toHaveLength(count);
      expect(state.meshReady).toBe(true);
      expect(state.phase).toBe("seated");
    },
  );

  it("requires every occupied seat to be ready before start", async () => {
    let { state, participants, ids } = await buildSeatedState(3);
    for (const participant of participants) {
      state = (
        await orderCommand(state, participant.id, { type: "SET_READY", ready: true }, ids)
      ).projectedState;
    }
    expect(state.phase).toBe("ready");
    state = (
      await orderCommand(state, participants[0]!.id, { type: "START_GAME" }, ids)
    ).projectedState;
    expect(state.phase).toBe("playing");
    expect(state.game).toEqual({ moves: [] });
  });

  it("validates game commands independently and supports a deterministic outcome", async () => {
    let { state, participants, ids } = await buildSeatedState(3);
    for (const participant of participants) {
      state = (
        await orderCommand(state, participant.id, { type: "SET_READY", ready: true }, ids)
      ).projectedState;
    }
    state = (
      await orderCommand(state, participants[0]!.id, { type: "START_GAME" }, ids)
    ).projectedState;
    for (const participant of participants) {
      state = (
        await orderCommand(
          state,
          participant.id,
          { type: "GAME_COMMAND", data: { kind: "move" } },
          ids,
        )
      ).projectedState;
    }
    expect(state.phase).toBe("ended");
    expect(state.outcome).toEqual({ type: "winner", winners: [participants[0]!.id] });
  });

  it("restarts only after unanimous approval and clears readiness", async () => {
    let { state, participants, ids } = await buildSeatedState(3);
    for (const participant of participants) {
      state = (
        await orderCommand(state, participant.id, { type: "SET_READY", ready: true }, ids)
      ).projectedState;
    }
    state = (
      await orderCommand(state, participants[0]!.id, { type: "START_GAME" }, ids)
    ).projectedState;
    const id = proposalId("proposal-restart");
    state = (
      await orderCommand(
        state,
        participants[1]!.id,
        { type: "PROPOSE_RESTART", proposalId: id },
        ids,
      )
    ).projectedState;
    expect(state.pendingRestart?.votes.size).toBe(1);
    state = (
      await orderCommand(
        state,
        participants[0]!.id,
        { type: "VOTE_RESTART", proposalId: id, approve: true },
        ids,
      )
    ).projectedState;
    expect(state.gameId).toBe("game-1");
    state = (
      await orderCommand(
        state,
        participants[2]!.id,
        { type: "VOTE_RESTART", proposalId: id, approve: true },
        ids,
      )
    ).projectedState;
    expect(state.gameId).toBe("game-next-1");
    expect(state.phase).toBe("seated");
    expect([...state.ready.values()]).toEqual([false, false, false]);
    expect(state.game).toBeNull();
  });
});
