import {
  parseCommandId,
  parseEventId,
  parseGameId,
  parseMessageId,
  parseParticipantId,
  parsePeerId,
  parseProposalId,
  parseSeatId,
  parseTableId,
} from "../ids";
import type { OrderedEvent, CoreEventType } from "../event-log/types";
import { parseJsonValue, type JsonValue } from "../shared/json";
import { failure, success, type Result } from "../shared/result";
import {
  MAX_EVENT_BATCH,
  MAX_MESSAGE_BYTES,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
} from "./constants";
import type {
  CommandRequestPayload,
  ProtocolMessage,
  ProtocolMessageType,
  SessionCommand,
} from "./types";

const CORE_EVENT_TYPES: ReadonlySet<string> = new Set<CoreEventType>([
  "MEMBERSHIP_JOINED",
  "PEER_BINDING_UPDATED",
  "READY_CHANGED",
  "GAME_STARTED",
  "GAME_EVENT",
  "GAME_ENDED",
  "RESTART_PROPOSED",
  "RESTART_VOTED",
  "GAME_RESTARTED",
]);

const MESSAGE_TYPES: ReadonlySet<string> = new Set<ProtocolMessageType>([
  "JOIN_REQUEST",
  "JOIN_ACCEPTED",
  "JOIN_REJECTED",
  "MESH_HELLO",
  "COMMAND_REQUEST",
  "ORDERED_EVENTS",
  "EVENT_ACK",
  "SYNC_REQUEST",
  "SYNC_STATE",
  "PRIVATE_MESSAGE",
  "PROTOCOL_ERROR",
]);

const HASH_PATTERN = /^[a-f0-9]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseSafeSequence = (value: unknown, label: string, allowZero = false) =>
  Number.isSafeInteger(value) &&
  typeof value === "number" &&
  value >= (allowZero ? 0 : 1)
    ? success(value)
    : failure(`${label} must be a safe integer >= ${allowZero ? 0 : 1}`);

const parseHash = (
  value: unknown,
  label: string,
  nullable = false,
): Result<string | null> => {
  if (nullable && value === null) return success(null);
  return typeof value === "string" && HASH_PATTERN.test(value)
    ? success(value)
    : failure(`${label} must be a lowercase SHA-256 hex string`);
};

const parseString = (value: unknown, label: string, max = 512): Result<string> =>
  typeof value === "string" && value.length > 0 && value.length <= max
    ? success(value)
    : failure(`${label} must be a non-empty string up to ${max} characters`);

const parseParticipantArray = (value: unknown): Result<readonly string[]> => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    return failure("participant list must contain 1-20 entries");
  }
  const output: string[] = [];
  for (const item of value) {
    const parsed = parseParticipantId(item);
    if (!parsed.ok) return parsed;
    output.push(parsed.value);
  }
  if (new Set(output).size !== output.length) {
    return failure("participant list must not contain duplicates");
  }
  return success(output);
};

const validateOutcome = (value: unknown): Result<true> => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return failure("outcome must be an object with a type");
  }
  if (value.type === "winner") {
    return parseParticipantArray(value.winners).ok
      ? success(true)
      : failure("winner outcome requires valid winners");
  }
  if (value.type === "ranking") {
    return parseParticipantArray(value.order).ok
      ? success(true)
      : failure("ranking outcome requires valid order");
  }
  if (value.type === "draw") {
    return value.reason === undefined || typeof value.reason === "string"
      ? success(true)
      : failure("draw reason must be a string");
  }
  if (value.type === "aborted") {
    return typeof value.reason === "string" && value.reason.length > 0
      ? success(true)
      : failure("aborted outcome requires a reason");
  }
  return failure("unknown outcome type");
};

const validateCoreEventPayload = (
  type: CoreEventType,
  value: unknown,
): Result<JsonValue> => {
  const json = parseJsonValue(value);
  if (!json.ok) return json;
  if (!isRecord(value)) return failure(`${type} payload must be an object`);

  if (type === "MEMBERSHIP_JOINED") {
    const participant = parseParticipantId(value.participantId);
    const peer = parsePeerId(value.peerId);
    const seat = parseSeatId(value.seatId);
    if (!participant.ok) return participant;
    if (!peer.ok) return peer;
    if (!seat.ok) return seat;
    if (
      value.displayName !== undefined &&
      (typeof value.displayName !== "string" || value.displayName.length > 80)
    ) {
      return failure("displayName must be a string up to 80 characters");
    }
  } else if (type === "PEER_BINDING_UPDATED") {
    const participant = parseParticipantId(value.participantId);
    const peer = parsePeerId(value.peerId);
    if (!participant.ok) return participant;
    if (!peer.ok) return peer;
  } else if (type === "READY_CHANGED") {
    const participant = parseParticipantId(value.participantId);
    if (!participant.ok) return participant;
    if (typeof value.ready !== "boolean") return failure("ready must be boolean");
  } else if (type === "GAME_STARTED") {
    if (Object.keys(value).length !== 0) {
      return failure("GAME_STARTED payload must be empty");
    }
  } else if (type === "GAME_EVENT") {
    const gameType = parseString(value.gameType, "gameType", 128);
    if (!gameType.ok) return gameType;
    const data = parseJsonValue(value.data);
    if (!data.ok) return data;
  } else if (type === "GAME_ENDED") {
    const outcome = validateOutcome(value.outcome);
    if (!outcome.ok) return outcome;
  } else if (type === "RESTART_PROPOSED") {
    const proposal = parseProposalId(value.proposalId);
    if (!proposal.ok) return proposal;
  } else if (type === "RESTART_VOTED") {
    const proposal = parseProposalId(value.proposalId);
    const participant = parseParticipantId(value.participantId);
    if (!proposal.ok) return proposal;
    if (!participant.ok) return participant;
    if (typeof value.approve !== "boolean") return failure("approve must be boolean");
  } else if (type === "GAME_RESTARTED") {
    const proposal = parseProposalId(value.proposalId);
    const nextGame = parseGameId(value.nextGameId);
    if (!proposal.ok) return proposal;
    if (!nextGame.ok) return nextGame;
  }
  return success(json.value);
};

export const parseOrderedEvent = (value: unknown): Result<OrderedEvent> => {
  if (!isRecord(value)) return failure("ordered event must be an object");
  const event = parseEventId(value.eventId);
  const table = parseTableId(value.tableId);
  const game = parseGameId(value.gameId);
  const seq = parseSafeSequence(value.seq, "seq");
  const epoch = parseSafeSequence(value.coordinatorEpoch, "coordinatorEpoch");
  const actor = parseParticipantId(value.actorId);
  if (!event.ok) return event;
  if (!table.ok) return table;
  if (!game.ok) return game;
  if (!seq.ok) return seq;
  if (!epoch.ok) return epoch;
  if (!actor.ok) return actor;
  if (typeof value.type !== "string" || !CORE_EVENT_TYPES.has(value.type)) {
    return failure("unknown ordered event type");
  }
  const payload = validateCoreEventPayload(value.type as CoreEventType, value.payload);
  if (!payload.ok) return payload;
  const previousHash = parseHash(value.previousHash, "previousHash", true);
  const eventHash = parseHash(value.eventHash, "eventHash");
  if (!previousHash.ok) return previousHash;
  if (!eventHash.ok || eventHash.value === null) return failure("invalid eventHash");
  return success({
    eventId: event.value,
    tableId: table.value,
    gameId: game.value,
    seq: seq.value,
    coordinatorEpoch: epoch.value,
    actorId: actor.value,
    type: value.type,
    payload: payload.value,
    previousHash: previousHash.value,
    eventHash: eventHash.value,
  });
};

const parseEventBatch = (value: unknown): Result<readonly OrderedEvent[]> => {
  if (!Array.isArray(value) || value.length > MAX_EVENT_BATCH) {
    return failure(`events must be an array with at most ${MAX_EVENT_BATCH} entries`);
  }
  const events: OrderedEvent[] = [];
  for (const item of value) {
    const parsed = parseOrderedEvent(item);
    if (!parsed.ok) return parsed;
    events.push(parsed.value);
  }
  return success(events);
};

const parseCommand = (value: unknown): Result<SessionCommand> => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return failure("command must be an object with a type");
  }
  if (value.type === "SET_READY") {
    return typeof value.ready === "boolean"
      ? success({ type: "SET_READY", ready: value.ready })
      : failure("SET_READY requires ready boolean");
  }
  if (value.type === "START_GAME") return success({ type: "START_GAME" });
  if (value.type === "GAME_COMMAND") {
    const data = parseJsonValue(value.data);
    return data.ok
      ? success({ type: "GAME_COMMAND", data: data.value })
      : data;
  }
  if (value.type === "PROPOSE_RESTART") {
    const proposal = parseProposalId(value.proposalId);
    return proposal.ok
      ? success({ type: "PROPOSE_RESTART", proposalId: proposal.value })
      : proposal;
  }
  if (value.type === "VOTE_RESTART") {
    const proposal = parseProposalId(value.proposalId);
    if (!proposal.ok) return proposal;
    if (typeof value.approve !== "boolean") return failure("approve must be boolean");
    if (value.nextGameId === undefined) {
      return success({
        type: "VOTE_RESTART",
        proposalId: proposal.value,
        approve: value.approve,
      });
    }
    const nextGame = parseGameId(value.nextGameId);
    return nextGame.ok
      ? success({
          type: "VOTE_RESTART",
          proposalId: proposal.value,
          approve: value.approve,
          nextGameId: nextGame.value,
        })
      : nextGame;
  }
  return failure("unknown command type");
};

const parseCommandRequest = (value: unknown): Result<CommandRequestPayload> => {
  if (!isRecord(value)) return failure("command request payload must be an object");
  const id = parseCommandId(value.commandId);
  const seq = parseSafeSequence(value.expectedSeq, "expectedSeq", true);
  const command = parseCommand(value.command);
  if (!id.ok) return id;
  if (!seq.ok) return seq;
  if (!command.ok) return command;
  return success({ commandId: id.value, expectedSeq: seq.value, command: command.value });
};

const parsePayload = (
  type: ProtocolMessageType,
  value: unknown,
): Result<unknown> => {
  if (!isRecord(value)) return failure(`${type} payload must be an object`);
  if (type === "JOIN_REQUEST") {
    const participant = parseParticipantId(value.participantId);
    if (!participant.ok) return participant;
    if (value.displayName === undefined) {
      return success({ participantId: participant.value });
    }
    const displayName = parseString(value.displayName, "displayName", 80);
    return displayName.ok
      ? success({ participantId: participant.value, displayName: displayName.value })
      : displayName;
  }
  if (type === "JOIN_ACCEPTED" || type === "ORDERED_EVENTS" || type === "SYNC_STATE") {
    const events = parseEventBatch(value.events);
    return events.ok ? success({ events: events.value }) : events;
  }
  if (type === "JOIN_REJECTED") {
    const reason = parseString(value.reason, "reason");
    return reason.ok ? success({ reason: reason.value }) : reason;
  }
  if (type === "MESH_HELLO") {
    const seq = parseSafeSequence(value.lastAppliedSeq, "lastAppliedSeq", true);
    const hash = parseHash(value.eventHash, "eventHash", true);
    return seq.ok && hash.ok
      ? success({ lastAppliedSeq: seq.value, eventHash: hash.value })
      : !seq.ok
        ? seq
        : hash;
  }
  if (type === "COMMAND_REQUEST") return parseCommandRequest(value);
  if (type === "EVENT_ACK") {
    const epoch = parseSafeSequence(value.coordinatorEpoch, "coordinatorEpoch");
    const seq = parseSafeSequence(value.seq, "seq");
    const hash = parseHash(value.eventHash, "eventHash");
    return epoch.ok && seq.ok && hash.ok && hash.value !== null
      ? success({ coordinatorEpoch: epoch.value, seq: seq.value, eventHash: hash.value })
      : failure("invalid EVENT_ACK payload");
  }
  if (type === "SYNC_REQUEST") {
    const epoch = parseSafeSequence(value.coordinatorEpoch, "coordinatorEpoch");
    const seq = parseSafeSequence(value.lastAppliedSeq, "lastAppliedSeq", true);
    const hash = parseHash(value.lastEventHash, "lastEventHash", true);
    return epoch.ok && seq.ok && hash.ok
      ? success({
          coordinatorEpoch: epoch.value,
          lastAppliedSeq: seq.value,
          lastEventHash: hash.value,
        })
      : failure("invalid SYNC_REQUEST payload");
  }
  if (type === "PRIVATE_MESSAGE") {
    const data = parseJsonValue(value.data);
    if (!data.ok) return data;
    if (value.relatedEventId === undefined) return success({ data: data.value });
    const related = parseString(value.relatedEventId, "relatedEventId", 128);
    return related.ok
      ? success({ relatedEventId: related.value, data: data.value })
      : related;
  }
  const code = parseString(value.code, "code", 128);
  const message = parseString(value.message, "message", 1024);
  return code.ok && message.ok
    ? success({ code: code.value, message: message.value })
    : failure("invalid PROTOCOL_ERROR payload");
};

export const parseProtocolMessage = (input: unknown): Result<ProtocolMessage> => {
  let value = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_MESSAGE_BYTES) {
      return failure(`message exceeds ${MAX_MESSAGE_BYTES} bytes`);
    }
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return failure("message is not valid JSON");
    }
  } else {
    try {
      if (
        new TextEncoder().encode(JSON.stringify(input)).byteLength >
        MAX_MESSAGE_BYTES
      ) {
        return failure(`message exceeds ${MAX_MESSAGE_BYTES} bytes`);
      }
    } catch {
      return failure("message is not JSON serializable");
    }
  }
  if (!isRecord(value)) return failure("message must be an object");
  if (value.protocol !== PROTOCOL_NAME) return failure("wrong protocol");
  if (value.version !== PROTOCOL_VERSION) return failure("unsupported protocol version");
  if (typeof value.type !== "string" || !MESSAGE_TYPES.has(value.type)) {
    return failure("unknown message type");
  }
  const id = parseMessageId(value.messageId);
  const table = parseTableId(value.tableId);
  const game = parseGameId(value.gameId);
  const peer = parsePeerId(value.senderPeerId);
  const participant =
    value.senderParticipantId === null
      ? success(null)
      : parseParticipantId(value.senderParticipantId);
  if (!id.ok) return id;
  if (!table.ok) return table;
  if (!game.ok) return game;
  if (!peer.ok) return peer;
  if (!participant.ok) return participant;
  if (participant.value === null && value.type !== "JOIN_REQUEST") {
    return failure("senderParticipantId may be null only for JOIN_REQUEST");
  }
  const payload = parsePayload(value.type as ProtocolMessageType, value.payload);
  if (!payload.ok) return payload;
  return success({
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    messageId: id.value,
    type: value.type,
    tableId: table.value,
    gameId: game.value,
    senderParticipantId: participant.value,
    senderPeerId: peer.value,
    payload: payload.value,
  } as ProtocolMessage);
};
