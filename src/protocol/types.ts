import type {
  CommandId,
  GameId,
  MessageId,
  ParticipantId,
  PeerId,
  ProposalId,
  TableId,
} from "../ids";
import type { OrderedEvent } from "../event-log/types";
import type { JsonValue } from "../shared/json";
import type { PROTOCOL_NAME, PROTOCOL_VERSION } from "./constants";

export type SessionCommand =
  | Readonly<{ type: "SET_READY"; ready: boolean }>
  | Readonly<{ type: "START_GAME" }>
  | Readonly<{ type: "GAME_COMMAND"; data: JsonValue }>
  | Readonly<{ type: "PROPOSE_RESTART"; proposalId: ProposalId }>
  | Readonly<{
      type: "VOTE_RESTART";
      proposalId: ProposalId;
      approve: boolean;
      nextGameId?: GameId;
    }>;

export interface CommandRequestPayload {
  readonly commandId: CommandId;
  readonly expectedSeq: number;
  readonly command: SessionCommand;
}

export type ProtocolMessageType =
  | "JOIN_REQUEST"
  | "JOIN_ACCEPTED"
  | "JOIN_REJECTED"
  | "MESH_HELLO"
  | "COMMAND_REQUEST"
  | "ORDERED_EVENTS"
  | "EVENT_ACK"
  | "SYNC_REQUEST"
  | "SYNC_STATE"
  | "PRIVATE_MESSAGE"
  | "PROTOCOL_ERROR";

export interface ProtocolEnvelope<
  TType extends ProtocolMessageType = ProtocolMessageType,
  TPayload = JsonValue,
> {
  readonly protocol: typeof PROTOCOL_NAME;
  readonly version: typeof PROTOCOL_VERSION;
  readonly messageId: MessageId;
  readonly type: TType;
  readonly tableId: TableId;
  readonly gameId: GameId;
  readonly senderParticipantId: ParticipantId | null;
  readonly senderPeerId: PeerId;
  readonly payload: TPayload;
}

export type ProtocolMessage =
  | ProtocolEnvelope<
      "JOIN_REQUEST",
      Readonly<{
        participantId: ParticipantId;
        displayName?: string;
      }>
    >
  | ProtocolEnvelope<"JOIN_ACCEPTED", Readonly<{ events: readonly OrderedEvent[] }>>
  | ProtocolEnvelope<"JOIN_REJECTED", Readonly<{ reason: string }>>
  | ProtocolEnvelope<"MESH_HELLO", Readonly<{ lastAppliedSeq: number; eventHash: string | null }>>
  | ProtocolEnvelope<"COMMAND_REQUEST", CommandRequestPayload>
  | ProtocolEnvelope<"ORDERED_EVENTS", Readonly<{ events: readonly OrderedEvent[] }>>
  | ProtocolEnvelope<
      "EVENT_ACK",
      Readonly<{ coordinatorEpoch: number; seq: number; eventHash: string }>
    >
  | ProtocolEnvelope<
      "SYNC_REQUEST",
      Readonly<{
        coordinatorEpoch: number;
        lastAppliedSeq: number;
        lastEventHash: string | null;
      }>
    >
  | ProtocolEnvelope<"SYNC_STATE", Readonly<{ events: readonly OrderedEvent[] }>>
  | ProtocolEnvelope<
      "PRIVATE_MESSAGE",
      Readonly<{ relatedEventId?: string; data: JsonValue }>
    >
  | ProtocolEnvelope<
      "PROTOCOL_ERROR",
      Readonly<{ code: string; message: string }>
    >;
