import type {
  GameId,
  ParticipantId,
  PeerId,
  ProposalId,
  SeatId,
} from "../ids";
import type { OrderedEvent } from "../event-log/types";
import type { MultiGamePlugin, GamePluginContext } from "../plugin/types";
import { canonicalizeJson, parseJsonValue, type JsonValue } from "../shared/json";
import { failure, success, type Result } from "../shared/result";
import type {
  GameOutcome,
  MultiSessionState,
  Participant,
  RestartProposal,
} from "./types";

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): Result<RecordValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? success(value as RecordValue)
    : failure("event payload must be an object");

const withEventPosition = <TState>(
  state: MultiSessionState<TState>,
  event: OrderedEvent,
): MultiSessionState<TState> => ({
  ...state,
  lastAppliedSeq: event.seq,
  lastEventHash: event.eventHash,
});

const pluginContext = <TState>(
  state: MultiSessionState<TState>,
  actorId: ParticipantId,
): GamePluginContext<TState> => ({
  tableId: state.tableId,
  gameId: state.gameId,
  actorId,
  participantCount: state.configuration.participantCount,
  participants: state.participants,
  seats: state.seats,
  state: state.game as TState,
  lastAppliedSeq: state.lastAppliedSeq,
});

const allSeatsOccupied = <TState>(state: MultiSessionState<TState>): boolean =>
  state.seats.size === state.configuration.participantCount &&
  [...state.seats.values()].every((participant) => participant !== null);

const allReady = <TState>(state: MultiSessionState<TState>): boolean =>
  state.participants.size === state.configuration.participantCount &&
  [...state.participants.keys()].every((id) => state.ready.get(id) === true);

const outcomesEqual = (left: GameOutcome, right: GameOutcome): boolean => {
  const leftJson = parseJsonValue(left);
  const rightJson = parseJsonValue(right);
  return (
    leftJson.ok &&
    rightJson.ok &&
    canonicalizeJson(leftJson.value) === canonicalizeJson(rightJson.value)
  );
};

export const reduceOrderedEvent = <
  TCommand,
  TEventPayload extends JsonValue,
  TGameState,
  TSnapshot extends JsonValue,
>(
  state: MultiSessionState<TGameState>,
  event: OrderedEvent,
  plugin: MultiGamePlugin<TCommand, TEventPayload, TGameState, TSnapshot>,
): Result<MultiSessionState<TGameState>> => {
  if (event.tableId !== state.tableId) return failure("event has wrong tableId");
  if (event.gameId !== state.gameId) return failure("event has wrong gameId");
  if (event.coordinatorEpoch !== state.coordinatorEpoch) {
    return failure("event has wrong coordinatorEpoch");
  }
  if (event.seq !== state.lastAppliedSeq + 1) return failure("event seq is not contiguous");
  if (event.previousHash !== state.lastEventHash) return failure("event hash chain is broken");
  const payload = asRecord(event.payload);
  if (!payload.ok) return payload;
  const value = payload.value;

  if (event.type === "MEMBERSHIP_JOINED") {
    if (event.actorId !== state.coordinatorId) {
      return failure("only coordinator can admit a participant");
    }
    if (state.phase === "playing" || state.phase === "offline" || state.phase === "syncing") {
      return failure("membership is frozen after play starts");
    }
    const participantId = value.participantId as ParticipantId;
    const peerId = value.peerId as PeerId;
    const seatId = value.seatId as SeatId;
    if (state.participants.has(participantId)) return failure("participant already exists");
    if (state.participants.size >= state.configuration.participantCount) {
      return failure("table is full");
    }
    if (!state.seats.has(seatId) || state.seats.get(seatId) !== null) {
      return failure("seat is unavailable");
    }
    if ([...state.participants.values()].some((item) => item.peerId === peerId)) {
      return failure("peerId is already bound");
    }
    const participant: Participant = {
      id: participantId,
      peerId,
      joinedAtSeq: event.seq,
      ...(typeof value.displayName === "string"
        ? { displayName: value.displayName }
        : {}),
    };
    const participants = new Map(state.participants).set(participantId, participant);
    const seats = new Map(state.seats).set(seatId, participantId);
    const ready = new Map(state.ready).set(participantId, false);
    const connections = new Map(state.connections).set(
      participantId,
      participantId === state.localParticipantId ? "connected" : "disconnected",
    );
    return success(
      withEventPosition<TGameState>(
        {
          ...state,
          participants,
          seats,
          ready,
          connections,
          phase: "mesh_connecting",
          meshReady: false,
        },
        event,
      ),
    );
  }

  if (!state.participants.has(event.actorId)) return failure("event actor is not a member");

  if (event.type === "PEER_BINDING_UPDATED") {
    if (event.actorId !== state.coordinatorId) {
      return failure("only coordinator can update a peer binding");
    }
    const participantId = value.participantId as ParticipantId;
    const peerId = value.peerId as PeerId;
    const current = state.participants.get(participantId);
    if (!current) return failure("participant does not exist");
    if ([...state.participants.values()].some((item) => item.id !== participantId && item.peerId === peerId)) {
      return failure("peerId is already bound");
    }
    const participants = new Map(state.participants).set(participantId, {
      ...current,
      peerId,
    });
    const connections = new Map(state.connections).set(participantId, "disconnected");
    return success(withEventPosition({ ...state, participants, connections, meshReady: false }, event));
  }

  if (event.type === "READY_CHANGED") {
    const participantId = value.participantId as ParticipantId;
    if (event.actorId !== participantId) return failure("ready actor mismatch");
    if (state.participants.size !== state.configuration.participantCount) {
      return failure("full membership is required before ready");
    }
    if (state.phase === "playing" || state.phase === "ended") {
      return failure("ready change is not allowed after game start");
    }
    const ready = new Map(state.ready).set(participantId, value.ready as boolean);
    const next = { ...state, ready };
    return success(
      withEventPosition({ ...next, phase: allReady(next) ? "ready" : "seated" }, event),
    );
  }

  if (event.type === "GAME_STARTED") {
    if (event.actorId !== state.coordinatorId) return failure("only coordinator can start");
    if (state.phase !== "ready" || !allReady(state) || !allSeatsOccupied(state)) {
      return failure("table is not ready to start");
    }
    const game = plugin.createInitialState({
      tableId: state.tableId,
      gameId: state.gameId,
      participantCount: state.configuration.participantCount,
      participants: state.participants,
      seats: state.seats,
    });
    return success(
      withEventPosition(
        {
          ...state,
          phase: "playing",
          game,
          pendingDecisionWindow: plugin.getDecisionWindow(game),
          outcome: null,
        },
        event,
      ),
    );
  }

  if (event.type === "GAME_EVENT") {
    if (state.phase !== "playing" || state.game === null) {
      return failure("game event is not allowed outside playing");
    }
    const gameType = value.gameType;
    if (typeof gameType !== "string") return failure("gameType must be a string");
    const parsed = plugin.parseEvent(gameType, value.data);
    if (!parsed.ok) return parsed;
    const spec = { type: gameType, payload: parsed.value };
    const context = pluginContext(state, event.actorId);
    const valid = plugin.validateEvent(spec, context);
    if (!valid.ok) return valid;
    const game = plugin.reduce(state.game, spec, {
      tableId: context.tableId,
      gameId: context.gameId,
      actorId: context.actorId,
      participantCount: context.participantCount,
      participants: context.participants,
      seats: context.seats,
      lastAppliedSeq: event.seq,
    });
    return success(
      withEventPosition(
        {
          ...state,
          game,
          pendingDecisionWindow: plugin.getDecisionWindow(game),
        },
        event,
      ),
    );
  }

  if (event.type === "GAME_ENDED") {
    if (state.phase !== "playing" || state.game === null) {
      return failure("game cannot end outside playing");
    }
    const expected = plugin.getOutcome(state.game);
    const outcome = value.outcome as GameOutcome;
    if (!expected || !outcomesEqual(expected, outcome)) {
      return failure("game outcome does not match deterministic plugin result");
    }
    return success(
      withEventPosition(
        { ...state, phase: "ended", outcome, pendingDecisionWindow: null },
        event,
      ),
    );
  }

  if (event.type === "RESTART_PROPOSED") {
    if (!["playing", "ended"].includes(state.phase)) {
      return failure("restart proposal requires an active table");
    }
    if (state.pendingRestart?.status === "open") {
      return failure("a restart proposal is already open");
    }
    const proposalId = value.proposalId as ProposalId;
    const proposal: RestartProposal = {
      id: proposalId,
      type: "restart",
      proposerId: event.actorId,
      votes: new Map([[event.actorId, true]]),
      status: "open",
    };
    return success(withEventPosition({ ...state, pendingRestart: proposal }, event));
  }

  if (event.type === "RESTART_VOTED") {
    const proposal = state.pendingRestart;
    const proposalId = value.proposalId as ProposalId;
    const participantId = value.participantId as ParticipantId;
    const approve = value.approve as boolean;
    if (!proposal || proposal.id !== proposalId || proposal.status !== "open") {
      return failure("restart proposal is not open");
    }
    if (event.actorId !== participantId) return failure("restart vote actor mismatch");
    if (proposal.votes.has(participantId)) return failure("participant already voted");
    const votes = new Map(proposal.votes).set(participantId, approve);
    const status = !approve
      ? "rejected"
      : votes.size === state.participants.size
        ? "accepted"
        : "open";
    return success(
      withEventPosition(
        { ...state, pendingRestart: { ...proposal, votes, status } },
        event,
      ),
    );
  }

  if (event.type === "GAME_RESTARTED") {
    const proposal = state.pendingRestart;
    const proposalId = value.proposalId as ProposalId;
    const nextGameId = value.nextGameId as GameId;
    if (event.actorId !== state.coordinatorId) return failure("only coordinator can restart");
    if (!proposal || proposal.id !== proposalId || proposal.status !== "accepted") {
      return failure("restart does not have unanimous approval");
    }
    const ready = new Map(
      [...state.participants.keys()].map((participantId) => [participantId, false]),
    );
    return success(
      withEventPosition<TGameState>(
        {
          ...state,
          gameId: nextGameId,
          phase: "seated",
          phaseBeforeOffline: null,
          ready,
          game: null,
          pendingDecisionWindow: null,
          pendingRestart: null,
          outcome: null,
          sync: { status: "idle" },
        },
        event,
      ),
    );
  }

  return failure(`unsupported event type ${event.type}`);
};
