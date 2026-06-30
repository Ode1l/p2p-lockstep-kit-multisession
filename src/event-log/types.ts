import type {
  EventId,
  GameId,
  ParticipantId,
  PeerId,
  ProposalId,
  SeatId,
  TableId,
} from "../ids";
import type { JsonValue } from "../shared/json";
import type { GameOutcome } from "../state/types";

export interface OrderedEvent<
  TType extends string = string,
  TPayload = JsonValue,
> {
  readonly eventId: EventId;
  readonly tableId: TableId;
  readonly gameId: GameId;
  readonly seq: number;
  readonly coordinatorEpoch: number;
  readonly actorId: ParticipantId;
  readonly type: TType;
  readonly payload: TPayload;
  readonly previousHash: string | null;
  readonly eventHash: string;
}

export type CoreEventType =
  | "MEMBERSHIP_JOINED"
  | "PEER_BINDING_UPDATED"
  | "READY_CHANGED"
  | "GAME_STARTED"
  | "GAME_EVENT"
  | "GAME_ENDED"
  | "RESTART_PROPOSED"
  | "RESTART_VOTED"
  | "GAME_RESTARTED";

export type CoreEventPayload =
  | Readonly<{
      participantId: ParticipantId;
      peerId: PeerId;
      seatId: SeatId;
      displayName?: string;
    }>
  | Readonly<{ participantId: ParticipantId; peerId: PeerId }>
  | Readonly<{ participantId: ParticipantId; ready: boolean }>
  | Readonly<Record<string, never>>
  | Readonly<{ gameType: string; data: JsonValue }>
  | Readonly<{ outcome: GameOutcome }>
  | Readonly<{ proposalId: ProposalId }>
  | Readonly<{
      proposalId: ProposalId;
      participantId: ParticipantId;
      approve: boolean;
    }>
  | Readonly<{ proposalId: ProposalId; nextGameId: GameId }>;

export interface SessionEventSpec {
  readonly type: CoreEventType;
  readonly payload: CoreEventPayload;
}

export type EventValidation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: string; message: string }>;

export type EventIngestResult =
  | Readonly<{ status: "applied"; events: readonly OrderedEvent[] }>
  | Readonly<{ status: "duplicate" }>
  | Readonly<{ status: "gap"; expectedSeq: number; receivedSeq: number }>
  | Readonly<{ status: "rejected"; code: string; message: string }>
  | Readonly<{
      status: "conflict";
      code: "sequence_conflict" | "hash_mismatch" | "coordinator_equivocation";
      message: string;
    }>;
