import {
  commandId,
  createInitialSessionState,
  createSessionConfiguration,
  eventId,
  gameId,
  membershipEventSpec,
  messageId,
  orderEventSpecs,
  participantId,
  peerId,
  proposalId,
  seatId,
  tableId,
  updateConnection,
  type GamePluginContext,
  type IdFactory,
  type JsonObject,
  type JsonValue,
  type MultiGamePlugin,
  type MultiSessionState,
  type ParticipantId,
  type SessionCommand,
} from "../src";
import { failure, success } from "../src/shared/result";

export interface TestCommand {
  readonly kind: "move";
}

export interface TestEventPayload extends JsonObject {
  readonly value: number;
}

export interface TestGameState {
  readonly moves: readonly ParticipantId[];
}

export const testPlugin: MultiGamePlugin<
  TestCommand,
  TestEventPayload,
  TestGameState,
  JsonValue
> = {
  id: "test.counter",
  parseCommand(input) {
    return typeof input === "object" && input !== null && (input as { kind?: unknown }).kind === "move"
      ? success({ kind: "move" })
      : failure("invalid test command");
  },
  parseEvent(type, payload) {
    if (
      type !== "test.move" ||
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { value?: unknown }).value !== "number"
    ) {
      return failure("invalid test event");
    }
    return success({ value: (payload as { value: number }).value });
  },
  createInitialState() {
    return { moves: [] };
  },
  validateCommand(_command, context) {
    const eligible = [...context.participants.keys()][context.state.moves.length % context.participantCount];
    return eligible === context.actorId ? success(true) : failure("not current actor");
  },
  commandToEvents(_command, context) {
    return [{ type: "test.move", payload: { value: context.state.moves.length + 1 } }];
  },
  validateEvent(event, context) {
    const eligible = [...context.participants.keys()][context.state.moves.length % context.participantCount];
    return event.payload.value === context.state.moves.length + 1 && eligible === context.actorId
      ? success(true)
      : failure("invalid ordered test move");
  },
  reduce(state, _event, context) {
    return { moves: [...state.moves, context.actorId] };
  },
  getDecisionWindow(state) {
    return state.moves.length === 0
      ? {
          id: "first-turn",
          openedAtSeq: 0,
          eligibleParticipantIds: [],
          submittedParticipantIds: [],
          mode: "single",
        }
      : null;
  },
  getOutcome(state) {
    return state.moves.length === 3
      ? { type: "winner", winners: [state.moves[0]!] }
      : null;
  },
  createSnapshot(state) {
    return { moves: [...state.moves] };
  },
  restoreSnapshot(snapshot) {
    if (typeof snapshot !== "object" || snapshot === null) return failure("invalid snapshot");
    const moves = (snapshot as { moves?: unknown }).moves;
    return Array.isArray(moves) && moves.every((value) => typeof value === "string")
      ? success({ moves: moves as ParticipantId[] })
      : failure("invalid snapshot");
  },
};

export const deterministicIds = (): IdFactory => {
  let event = 0;
  let message = 0;
  let game = 0;
  return {
    eventId: () => eventId(`event-${++event}`),
    messageId: () => messageId(`message-${++message}`),
    gameId: () => gameId(`game-next-${++game}`),
  };
};

export const buildSeatedState = async (count: number) => {
  const participants = Array.from({ length: count }, (_, index) => ({
    id: participantId(`participant-${index}`),
    peerId: peerId(`peer-${index}`),
    seatId: seatId(`seat-${index}`),
  }));
  const configuration = createSessionConfiguration({
    participantCount: count,
    seatIds: participants.map((item) => item.seatId),
  });
  if (!configuration.ok) throw new Error(configuration.error);
  let state = createInitialSessionState<TestGameState>({
    tableId: tableId("table-1"),
    gameId: gameId("game-1"),
    localParticipant: { ...participants[0]!, joinedAtSeq: 0 },
    coordinatorId: participants[0]!.id,
    configuration: configuration.value,
  });
  const ids = deterministicIds();
  for (const participant of participants) {
    const ordered = await orderEventSpecs({
      state,
      actorId: participants[0]!.id,
      specs: [
        membershipEventSpec({
          participant: { id: participant.id, peerId: participant.peerId },
          seatId: participant.seatId,
        }),
      ],
      plugin: testPlugin,
      idFactory: ids,
    });
    if (!ordered.ok) throw new Error(ordered.error);
    state = ordered.value.projectedState;
  }
  for (const participant of participants.slice(1)) {
    state = updateConnection(state, participant.id, "connected");
  }
  return { state, participants, ids };
};

export const orderCommand = async (
  state: MultiSessionState<TestGameState>,
  actorId: ParticipantId,
  command: SessionCommand,
  ids: IdFactory,
) => {
  const { commandEventSpecs } = await import("../src/coordinator/commands");
  const request = {
    commandId: commandId(`command-${state.lastAppliedSeq + 1}-${actorId}`),
    expectedSeq: state.lastAppliedSeq,
    command,
  };
  const specs = commandEventSpecs(state, actorId, request, testPlugin);
  if (!specs.ok) throw new Error(specs.error);
  const ordered = await orderEventSpecs({
    state,
    actorId,
    specs: specs.value,
    plugin: testPlugin,
    idFactory: ids,
  });
  if (!ordered.ok) throw new Error(ordered.error);
  return ordered.value;
};

export const restartProposalId = proposalId("proposal-1");

export const unusedContext = null as unknown as GamePluginContext<TestGameState>;
