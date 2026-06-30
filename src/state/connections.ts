import type { ParticipantId } from "../ids";
import type {
  MultiSessionState,
  PeerConnectionState,
  SessionPhase,
} from "./types";

const resumablePhase = (
  phase: SessionPhase,
): Exclude<SessionPhase, "offline" | "syncing" | "protocol_error"> => {
  if (phase === "offline" || phase === "syncing" || phase === "protocol_error") {
    return "seated";
  }
  return phase;
};

export const updateConnection = <TGameState>(
  state: MultiSessionState<TGameState>,
  participantId: ParticipantId,
  connection: PeerConnectionState,
): MultiSessionState<TGameState> => {
  if (!state.participants.has(participantId)) return state;
  const connections = new Map(state.connections);
  connections.set(participantId, connection);
  const tableFull = state.participants.size === state.configuration.participantCount;
  const meshReady =
    tableFull &&
    [...state.participants.keys()].every(
      (id) => id === state.localParticipantId || connections.get(id) === "connected",
    );

  if (
    !meshReady &&
    tableFull &&
    state.phase !== "protocol_error" &&
    state.phase !== "mesh_connecting"
  ) {
    const phaseBeforeOffline =
      state.phase === "offline" || state.phase === "syncing"
        ? state.phaseBeforeOffline
        : resumablePhase(state.phase);
    return {
      ...state,
      connections,
      meshReady,
      phase: "offline",
      phaseBeforeOffline,
      sync: { status: "required", reason: "mesh_reconnected", fromSeq: state.lastAppliedSeq },
    };
  }

  if (meshReady && state.phase === "offline") {
    return {
      ...state,
      connections,
      meshReady,
      phase: "syncing",
      sync: { status: "syncing", reason: "mesh_reconnected", fromSeq: state.lastAppliedSeq },
    };
  }

  let phase = state.phase;
  if (meshReady && phase === "mesh_connecting") phase = "seated";
  return { ...state, connections, meshReady, phase };
};

export const completeConnectionSync = <TGameState>(
  state: MultiSessionState<TGameState>,
): MultiSessionState<TGameState> => {
  if (state.phase !== "syncing" || !state.meshReady) return state;
  return {
    ...state,
    phase: state.phaseBeforeOffline ?? "seated",
    phaseBeforeOffline: null,
    sync: { status: "complete", atSeq: state.lastAppliedSeq },
  };
};
