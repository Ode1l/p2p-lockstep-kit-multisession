import type { GameId, ParticipantId, TableId } from "../ids";
import type { Participant } from "./types";
import type {
  MultiSessionState,
  SessionConfiguration,
} from "./types";

export const createInitialSessionState = <TGameState>(input: {
  tableId: TableId;
  gameId: GameId;
  localParticipant: Participant;
  coordinatorId: ParticipantId;
  configuration: SessionConfiguration;
  phase?: "invited" | "mesh_connecting";
}): MultiSessionState<TGameState> => {
  const participants = new Map();
  const connections = new Map();
  const seats = new Map(input.configuration.seatIds.map((id) => [id, null]));
  const ready = new Map();

  return {
    tableId: input.tableId,
    gameId: input.gameId,
    phase: input.phase ?? "mesh_connecting",
    phaseBeforeOffline: null,
    localParticipantId: input.localParticipant.id,
    coordinatorId: input.coordinatorId,
    coordinatorEpoch: 1,
    configuration: input.configuration,
    participants,
    connections,
    seats,
    ready,
    meshReady: false,
    lastAppliedSeq: 0,
    lastEventHash: null,
    pendingDecisionWindow: null,
    pendingRestart: null,
    sync: { status: "idle" },
    outcome: null,
    game: null,
    protocolError: null,
  };
};
