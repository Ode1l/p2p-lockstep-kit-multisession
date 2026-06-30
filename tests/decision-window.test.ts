import { describe, expect, it } from "vitest";
import {
  commandEventSpecs,
  commandId,
  orderEventSpecs,
  type JsonObject,
  type JsonValue,
  type MultiGamePlugin,
  type MultiSessionState,
  type ParticipantId,
  type SessionCommand,
} from "../src";
import { failure, success } from "../src/shared/result";
import { buildSeatedState } from "./helpers";

interface IntentCommand {
  readonly kind: "intent";
}

interface IntentPayload extends JsonObject {
  readonly kind: "intent" | "resolved";
}

interface IntentState {
  readonly eligible: readonly ParticipantId[];
  readonly intents: readonly ParticipantId[];
  readonly resolved: boolean;
}

const decisionPlugin: MultiGamePlugin<
  IntentCommand,
  IntentPayload,
  IntentState,
  JsonValue
> = {
  id: "test.simultaneous",
  parseCommand(input) {
    return typeof input === "object" && input !== null && (input as { kind?: unknown }).kind === "intent"
      ? success({ kind: "intent" })
      : failure("invalid intent");
  },
  parseEvent(type, payload) {
    const kind = (payload as { kind?: unknown } | null)?.kind;
    return type === "decision" && (kind === "intent" || kind === "resolved")
      ? success({ kind })
      : failure("invalid decision event");
  },
  createInitialState(input) {
    return { eligible: [...input.participants.keys()], intents: [], resolved: false };
  },
  validateCommand(_command, context) {
    return !context.state.resolved && !context.state.intents.includes(context.actorId)
      ? success(true)
      : failure("intent is not eligible");
  },
  commandToEvents(_command, context) {
    const events: IntentPayload[] = [{ kind: "intent" }];
    if (context.state.intents.length + 1 === context.participantCount) {
      events.push({ kind: "resolved" });
    }
    return events.map((payload) => ({ type: "decision", payload }));
  },
  validateEvent(event, context) {
    if (event.payload.kind === "intent") {
      return !context.state.resolved && !context.state.intents.includes(context.actorId)
        ? success(true)
        : failure("duplicate intent");
    }
    return context.state.intents.length === context.participantCount
      ? success(true)
      : failure("cannot resolve incomplete window");
  },
  reduce(state, event, context) {
    return event.payload.kind === "intent"
      ? { ...state, intents: [...state.intents, context.actorId] }
      : { ...state, resolved: true };
  },
  getDecisionWindow(state) {
    if (state.resolved) return null;
    return {
      id: "simultaneous-1",
      openedAtSeq: 0,
      eligibleParticipantIds: state.eligible,
      submittedParticipantIds: state.intents,
      mode: "simultaneous",
    };
  },
  getOutcome() {
    return null;
  },
  createSnapshot(state) {
    return {
      eligible: [...state.eligible],
      intents: [...state.intents],
      resolved: state.resolved,
    };
  },
  restoreSnapshot() {
    return failure("not used in this test");
  },
};

describe("simultaneous decision windows", () => {
  it("collects every eligible intent and emits one deterministic resolution", async () => {
    const base = await buildSeatedState(3);
    let state = base.state as unknown as MultiSessionState<IntentState>;
    const { participants, ids } = base;
    let sequence = 0;
    const apply = async (actorId: ParticipantId, command: SessionCommand) => {
      const request = {
        commandId: commandId(`decision-command-${++sequence}`),
        expectedSeq: state.lastAppliedSeq,
        command,
      };
      const specs = commandEventSpecs(state, actorId, request, decisionPlugin);
      if (!specs.ok) throw new Error(specs.error);
      const ordered = await orderEventSpecs({
        state,
        actorId,
        specs: specs.value,
        plugin: decisionPlugin,
        idFactory: ids,
      });
      if (!ordered.ok) throw new Error(ordered.error);
      state = ordered.value.projectedState;
    };

    for (const participant of participants) {
      await apply(participant.id, { type: "SET_READY", ready: true });
    }
    await apply(participants[0]!.id, { type: "START_GAME" });
    expect(state.pendingDecisionWindow?.mode).toBe("simultaneous");

    for (let index = 0; index < participants.length; index += 1) {
      await apply(participants[index]!.id, {
        type: "GAME_COMMAND",
        data: { kind: "intent" },
      });
      if (index < participants.length - 1) {
        expect(state.pendingDecisionWindow?.submittedParticipantIds).toHaveLength(index + 1);
      }
    }
    expect(state.game).toEqual({
      eligible: participants.map((participant) => participant.id),
      intents: participants.map((participant) => participant.id),
      resolved: true,
    });
    expect(state.pendingDecisionWindow).toBeNull();
  });
});
