import { describe, expect, it } from "vitest";
import {
  createSessionConfiguration,
  eventId,
  FakeMeshNetwork,
  gameId,
  messageId,
  MultiSessionRuntime,
  participantId,
  peerId,
  proposalId,
  seatId,
  tableId,
  type IdFactory,
  type JsonValue,
} from "../src";
import { testPlugin, type TestCommand, type TestEventPayload, type TestGameState } from "./helpers";

const runtimeIds = (prefix: string): IdFactory => {
  let event = 0;
  let message = 0;
  let game = 0;
  return {
    eventId: () => eventId(`${prefix}-event-${++event}`),
    messageId: () => messageId(`${prefix}-message-${++message}`),
    gameId: () => gameId(`${prefix}-game-${++game}`),
  };
};

const pump = async (
  network: FakeMeshNetwork,
  runtimes: readonly MultiSessionRuntime<
    TestCommand,
    TestEventPayload,
    TestGameState,
    JsonValue
  >[],
) => {
  for (let round = 0; round < 100; round += 1) {
    network.deliverAll();
    await Promise.all(runtimes.map((runtime) => runtime.idle()));
    if (network.queuedMessageCount() === 0) return;
  }
  throw new Error("fake network did not become idle");
};

const setupRuntimes = async (count = 3) => {
  const network = new FakeMeshNetwork();
  const participants = Array.from({ length: count }, (_, index) => ({
    id: participantId(`participant-${index}`),
    peerId: peerId(`peer-${index}`),
  }));
  const seats = Array.from({ length: count }, (_, index) => seatId(`seat-${index}`));
  const config = createSessionConfiguration({ participantCount: count, seatIds: seats });
  if (!config.ok) throw new Error(config.error);
  const transports = participants.map((participant) =>
    network.createTransport(participant.peerId),
  );
  const runtimes = participants.map((participant, index) =>
    new MultiSessionRuntime({
      tableId: tableId("table-runtime"),
      gameId: gameId("game-runtime"),
      localParticipant: participant,
      coordinatorId: participants[0]!.id,
      coordinatorPeerId: participants[0]!.peerId,
      configuration: config.value,
      plugin: testPlugin,
      transport: transports[index]!,
      idFactory: runtimeIds(`runtime-${index}`),
    }),
  );
  await Promise.all(runtimes.map((runtime) => runtime.start()));
  for (const runtime of runtimes.slice(1)) {
    await runtime.join();
    await pump(network, runtimes);
  }
  await pump(network, runtimes);
  return { network, participants, runtimes, transports };
};

describe("MultiSessionRuntime", () => {
  it("joins through the coordinator and forms a complete mesh", async () => {
    const { network, participants, runtimes } = await setupRuntimes(3);
    for (const runtime of runtimes) {
      expect(runtime.getState().participants.size).toBe(3);
      expect(runtime.getState().meshReady).toBe(true);
      expect(runtime.getState().phase).toBe("seated");
      expect(runtime.getHistory()).toHaveLength(3);
    }
    for (let left = 0; left < participants.length; left += 1) {
      for (let right = left + 1; right < participants.length; right += 1) {
        expect(
          network.getLogicalConnectionCount(
            participants[left]!.peerId,
            participants[right]!.peerId,
          ),
        ).toBe(1);
      }
    }
    runtimes.forEach((runtime) => runtime.dispose());
  });

  it("forms the configured maximum twenty-participant runtime mesh", async () => {
    const { participants, runtimes } = await setupRuntimes(20);
    for (const runtime of runtimes) {
      expect(runtime.getState().participants.size).toBe(20);
      expect(runtime.getState().meshReady).toBe(true);
      expect(runtime.getState().phase).toBe("seated");
      expect(runtime.getState().connections.size).toBe(20);
    }
    expect(participants).toHaveLength(20);
    runtimes.forEach((runtime) => runtime.dispose());
  });

  it("orders ready/start/game commands and keeps all histories identical", async () => {
    const { network, participants, runtimes } = await setupRuntimes(3);
    for (const runtime of runtimes) {
      await runtime.ready(true);
      await pump(network, runtimes);
    }
    await runtimes[0]!.startGame();
    await pump(network, runtimes);
    for (let index = 0; index < runtimes.length; index += 1) {
      await runtimes[index]!.gameCommand({ kind: "move" });
      await pump(network, runtimes);
    }
    const hashes = runtimes.map((runtime) => runtime.getState().lastEventHash);
    const histories = runtimes.map((runtime) =>
      runtime.getHistory().map((event) => event.eventHash),
    );
    expect(new Set(hashes).size).toBe(1);
    expect(histories.every((history) => JSON.stringify(history) === JSON.stringify(histories[0]))).toBe(true);
    for (const runtime of runtimes) {
      expect(runtime.getState().phase).toBe("ended");
      expect(runtime.getState().outcome).toEqual({
        type: "winner",
        winners: [participants[0]!.id],
      });
    }
  });

  it("rejects an ineligible remote command without stopping the coordinator queue", async () => {
    const { network, runtimes } = await setupRuntimes(3);
    for (const runtime of runtimes) {
      await runtime.ready(true);
      await pump(network, runtimes);
    }
    await runtimes[0]!.startGame();
    await pump(network, runtimes);
    await runtimes[1]!.gameCommand({ kind: "move" });
    await pump(network, runtimes);
    expect(runtimes[0]!.getState().phase).toBe("playing");
    expect(runtimes[0]!.getState().protocolError).toBeNull();
    await runtimes[0]!.gameCommand({ kind: "move" });
    await pump(network, runtimes);
    expect(runtimes[0]!.getState().game?.moves).toHaveLength(1);
  });

  it("pauses every node when one participant disconnects and resumes after full-record sync", async () => {
    const { network, participants, runtimes } = await setupRuntimes(3);
    for (const runtime of runtimes) {
      await runtime.ready(true);
      await pump(network, runtimes);
    }
    await runtimes[0]!.startGame();
    await pump(network, runtimes);
    network.disconnectPeer(participants[1]!.peerId);
    const resumedStates = runtimes.map((runtime) => runtime.getState());
    expect(
      resumedStates.map((state) => state.phase),
      JSON.stringify(resumedStates.map((state) => state.protocolError)),
    ).toEqual([
      "offline",
      "offline",
      "offline",
    ]);
    await Promise.all(runtimes.map((runtime) => runtime.resumeConnections()));
    await pump(network, runtimes);
    const afterSync = runtimes.map((runtime) => runtime.getState());
    expect(
      afterSync.map((state) => state.phase),
      JSON.stringify(afterSync.map((state) => state.protocolError)),
    ).toEqual([
      "playing",
      "playing",
      "playing",
    ]);
    expect(new Set(runtimes.map((runtime) => runtime.getState().lastEventHash)).size).toBe(1);
  });

  it("requests a full record after a sequence gap and then continues", async () => {
    const { network, participants, runtimes } = await setupRuntimes(3);
    await runtimes[0]!.ready(true);
    const missingIndex = network.getQueuedMessages().findIndex((queued) => {
      const message = queued.message as { type?: unknown };
      return queued.to === participants[2]!.peerId && message.type === "ORDERED_EVENTS";
    });
    expect(missingIndex).toBeGreaterThanOrEqual(0);
    network.dropQueued(missingIndex);
    await pump(network, runtimes);

    await runtimes[1]!.ready(true);
    await pump(network, runtimes);
    expect(runtimes[2]!.getState().phase).not.toBe("protocol_error");
    expect(runtimes[2]!.getState().lastAppliedSeq).toBe(
      runtimes[0]!.getState().lastAppliedSeq,
    );
    expect(runtimes[2]!.getHistory().map((event) => event.eventHash)).toEqual(
      runtimes[0]!.getHistory().map((event) => event.eventHash),
    );
  });

  it("rejects local game commands while any participant is offline", async () => {
    const { network, participants, runtimes } = await setupRuntimes(3);
    network.disconnectPeer(participants[1]!.peerId);
    await expect(runtimes[2]!.gameCommand({ kind: "move" })).rejects.toThrow(
      "commands are disabled",
    );
  });

  it("requires unanimous restart approval across the runtime", async () => {
    const { network, runtimes } = await setupRuntimes(3);
    for (const runtime of runtimes) {
      await runtime.ready(true);
      await pump(network, runtimes);
    }
    await runtimes[0]!.startGame();
    await pump(network, runtimes);
    const id = proposalId("proposal-runtime");
    await runtimes[1]!.proposeRestart(id);
    await pump(network, runtimes);
    await runtimes[0]!.voteRestart(id, true);
    await pump(network, runtimes);
    expect(runtimes[0]!.getState().gameId).toBe("game-runtime");
    await runtimes[2]!.voteRestart(id, true);
    await pump(network, runtimes);
    for (const runtime of runtimes) {
      expect(runtime.getState().gameId).toBe("runtime-0-game-1");
      expect(runtime.getState().phase).toBe("seated");
      expect([...runtime.getState().ready.values()]).toEqual([false, false, false]);
    }
  });

  it("routes optional point-to-point application data without claiming secrecy", async () => {
    const { network, participants, runtimes } = await setupRuntimes(3);
    const received: unknown[] = [];
    const unsubscribe = runtimes[2]!.subscribe({
      onStateChange() {},
      onPrivateMessage(message) {
        received.push(message);
      },
    });
    runtimes[1]!.sendPrivate(
      participants[2]!.id,
      { tiles: [1, 2, 3] },
      "related-event",
    );
    await pump(network, runtimes);
    expect(received).toEqual([
      {
        fromParticipantId: participants[1]!.id,
        data: { tiles: [1, 2, 3] },
        relatedEventId: "related-event",
      },
    ]);
    expect(JSON.stringify(runtimes[2]!.getHistory())).not.toContain("tiles");
    unsubscribe();
  });

  it("stops on a conflicting checkpoint and removes listeners on dispose", async () => {
    const { network, participants, runtimes, transports } = await setupRuntimes(3);
    const source = participants[1]!;
    const target = participants[0]!;
    const targetRuntime = runtimes[0]!;
    const raw = {
      protocol: "p2p-lockstep-kit-multisession",
      version: 1,
      messageId: messageId("conflicting-ack"),
      type: "EVENT_ACK",
      tableId: tableId("table-runtime"),
      gameId: gameId("game-runtime"),
      senderParticipantId: source.id,
      senderPeerId: source.peerId,
      payload: {
        coordinatorEpoch: 1,
        seq: 1,
        eventHash: "0".repeat(64),
      },
    };
    transports[1]!.sendTo(target.peerId, raw);
    await pump(network, runtimes);
    expect(targetRuntime.getState().phase).toBe("protocol_error");
    expect(targetRuntime.getState().protocolError?.code).toBe("coordinator_equivocation");
    runtimes.forEach((runtime) => runtime.dispose());
    for (const transport of transports) {
      expect(transport.getListenerCounts()).toEqual({ message: 0, state: 0 });
    }
  });
});
