import type {
  GameId,
  ParticipantId,
  PeerId,
  ProposalId,
  SeatId,
  TableId,
} from "../ids";
import type { JsonValue } from "../shared/json";

export const MIN_PARTICIPANTS = 3;
export const MAX_PARTICIPANTS = 20;

export type SessionPhase =
  | "invited"
  | "joining"
  | "mesh_connecting"
  | "seated"
  | "ready"
  | "playing"
  | "offline"
  | "syncing"
  | "ended"
  | "protocol_error";

export type PeerConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface Participant {
  readonly id: ParticipantId;
  readonly peerId: PeerId;
  readonly displayName?: string;
  readonly joinedAtSeq: number;
}

export interface DecisionWindow {
  readonly id: string;
  readonly openedAtSeq: number;
  readonly eligibleParticipantIds: readonly ParticipantId[];
  readonly submittedParticipantIds: readonly ParticipantId[];
  readonly mode: "single" | "simultaneous";
  readonly deadline?: number;
}

export type GameOutcome =
  | Readonly<{ type: "winner"; winners: readonly ParticipantId[] }>
  | Readonly<{ type: "draw"; reason?: string }>
  | Readonly<{ type: "ranking"; order: readonly ParticipantId[] }>
  | Readonly<{ type: "aborted"; reason: string }>;

export interface RestartProposal {
  readonly id: ProposalId;
  readonly type: "restart";
  readonly proposerId: ParticipantId;
  readonly votes: ReadonlyMap<ParticipantId, boolean>;
  readonly status: "open" | "rejected" | "accepted";
}

export type SyncState =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "required" | "syncing";
      reason: "sequence_gap" | "mesh_reconnected" | "checkpoint_mismatch";
      fromSeq: number;
    }>
  | Readonly<{ status: "complete"; atSeq: number }>;

export interface ProtocolError {
  readonly code:
    | "invalid_message"
    | "invalid_event"
    | "sequence_conflict"
    | "hash_mismatch"
    | "coordinator_equivocation"
    | "wrong_scope";
  readonly message: string;
  readonly peerId?: PeerId;
  readonly seq?: number;
  readonly evidence?: JsonValue;
}

export interface SessionConfiguration {
  readonly participantCount: number;
  readonly seatIds: readonly SeatId[];
}

export interface MultiSessionState<TGameState = unknown> {
  readonly tableId: TableId;
  readonly gameId: GameId;
  readonly phase: SessionPhase;
  readonly phaseBeforeOffline: Exclude<
    SessionPhase,
    "offline" | "syncing" | "protocol_error"
  > | null;
  readonly localParticipantId: ParticipantId;
  readonly coordinatorId: ParticipantId;
  readonly coordinatorEpoch: number;
  readonly configuration: SessionConfiguration;
  readonly participants: ReadonlyMap<ParticipantId, Participant>;
  readonly connections: ReadonlyMap<ParticipantId, PeerConnectionState>;
  readonly seats: ReadonlyMap<SeatId, ParticipantId | null>;
  readonly ready: ReadonlyMap<ParticipantId, boolean>;
  readonly meshReady: boolean;
  readonly lastAppliedSeq: number;
  readonly lastEventHash: string | null;
  readonly pendingDecisionWindow: DecisionWindow | null;
  readonly pendingRestart: RestartProposal | null;
  readonly sync: SyncState;
  readonly outcome: GameOutcome | null;
  readonly game: TGameState | null;
  readonly protocolError: ProtocolError | null;
}
