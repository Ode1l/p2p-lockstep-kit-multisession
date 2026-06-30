import type { GameId, ParticipantId, SeatId, TableId } from "../ids";
import type { JsonValue } from "../shared/json";
import type { Result } from "../shared/result";
import type {
  DecisionWindow,
  GameOutcome,
  Participant,
} from "../state/types";

export interface GameEventSpec<TPayload extends JsonValue = JsonValue> {
  readonly type: string;
  readonly payload: TPayload;
}

export interface GamePluginContext<TState> {
  readonly tableId: TableId;
  readonly gameId: GameId;
  readonly actorId: ParticipantId;
  readonly participantCount: number;
  readonly participants: ReadonlyMap<ParticipantId, Participant>;
  readonly seats: ReadonlyMap<SeatId, ParticipantId | null>;
  readonly state: TState;
  readonly lastAppliedSeq: number;
}

export interface MultiGamePlugin<
  TCommand = JsonValue,
  TEventPayload extends JsonValue = JsonValue,
  TState = unknown,
  TSnapshot extends JsonValue = JsonValue,
> {
  readonly id: string;
  parseCommand(input: unknown): Result<TCommand>;
  parseEvent(type: string, payload: unknown): Result<TEventPayload>;
  createInitialState(input: {
    tableId: TableId;
    gameId: GameId;
    participantCount: number;
    participants: ReadonlyMap<ParticipantId, Participant>;
    seats: ReadonlyMap<SeatId, ParticipantId | null>;
  }): TState;
  validateCommand(
    command: TCommand,
    context: GamePluginContext<TState>,
  ): Result<true>;
  commandToEvents(
    command: TCommand,
    context: GamePluginContext<TState>,
  ): readonly GameEventSpec<TEventPayload>[];
  validateEvent(
    event: GameEventSpec<TEventPayload>,
    context: GamePluginContext<TState>,
  ): Result<true>;
  reduce(
    state: TState,
    event: GameEventSpec<TEventPayload>,
    context: Omit<GamePluginContext<TState>, "state">,
  ): TState;
  getDecisionWindow(state: TState): DecisionWindow | null;
  getOutcome(state: TState): GameOutcome | null;
  createSnapshot(state: TState): TSnapshot;
  restoreSnapshot(snapshot: unknown): Result<TState>;
}
