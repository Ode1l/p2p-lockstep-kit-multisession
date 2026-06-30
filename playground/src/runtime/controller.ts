import {
  EndpointMeshTransport,
  FakeMeshNetwork,
  MultiSessionRuntime,
  NetworkEndpoint,
  createSessionConfiguration,
  gameId,
  participantId,
  peerId,
  proposalId,
  seatId,
  tableId,
  type JsonValue,
  type MultiSessionSnapshot,
  type OrderedEvent,
  type ParticipantId,
  type PeerId,
} from "p2p-lockstep-kit-multisession";
import {
  mahjongPlugin,
  type MahjongCommand,
  type MahjongEventPayload,
  type MahjongSnapshot,
  type MahjongState,
} from "../game/mahjong";

export const DEFAULT_SIGNAL_URL = "wss://signal.jiahengli.xyz";
export const SEATS = ["south", "east", "north", "west"].map(seatId);

type Runtime = MultiSessionRuntime<
  MahjongCommand,
  MahjongEventPayload,
  MahjongState,
  MahjongSnapshot
>;

export interface TableView {
  readonly snapshot: MultiSessionSnapshot<MahjongSnapshot>;
  readonly events: readonly OrderedEvent[];
  readonly mode: "simulation" | "p2p";
  readonly localPeerId: PeerId;
  readonly tableCode: string;
  readonly error: string | null;
}

export interface TableController {
  subscribe(handler: (view: TableView) => void): () => void;
  ready(): Promise<void>;
  start(): Promise<void>;
  discard(tileId: string): Promise<void>;
  restart(): Promise<void>;
  resume(): Promise<void>;
  togglePeer?(): Promise<void>;
  dispose(): void;
}

const configuration = (() => {
  const result = createSessionConfiguration({
    participantCount: 4,
    seatIds: SEATS,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
})();

const pump = async (network: FakeMeshNetwork, runtimes: readonly Runtime[]) => {
  for (let round = 0; round < 100; round += 1) {
    network.deliverAll();
    await Promise.all(runtimes.map((runtime) => runtime.idle()));
    if (network.queuedMessageCount() === 0) return;
  }
  throw new Error("本机模拟网络未能收敛");
};

abstract class BaseController implements TableController {
  protected readonly listeners = new Set<(view: TableView) => void>();
  protected view: TableView | null = null;

  subscribe(handler: (view: TableView) => void) {
    this.listeners.add(handler);
    if (this.view) handler(this.view);
    return () => this.listeners.delete(handler);
  }

  protected emit(view: TableView) {
    this.view = view;
    for (const listener of [...this.listeners]) listener(view);
  }

  abstract ready(): Promise<void>;
  abstract start(): Promise<void>;
  abstract discard(tileId: string): Promise<void>;
  abstract restart(): Promise<void>;
  abstract resume(): Promise<void>;
  abstract dispose(): void;
}

export class LocalTableController extends BaseController {
  readonly #network: FakeMeshNetwork;
  readonly #participants: readonly {
    id: ParticipantId;
    peerId: PeerId;
    displayName: string;
  }[];
  readonly #runtimes: Runtime[];
  readonly #unsubscribe: () => void;
  #botTimer: number | null = null;
  #disposed = false;

  private constructor(
    network: FakeMeshNetwork,
    participants: readonly {
      id: ParticipantId;
      peerId: PeerId;
      displayName: string;
    }[],
    runtimes: Runtime[],
  ) {
    super();
    this.#network = network;
    this.#participants = participants;
    this.#runtimes = runtimes;
    this.#unsubscribe = runtimes[0]!.subscribe({
      onStateChange: (snapshot) => {
        this.emit({
          snapshot,
          events: runtimes[0]!.getHistory(),
          mode: "simulation",
          localPeerId: this.#participants[0]!.peerId,
          tableCode: "DEMO-4P",
          error: snapshot.state.protocolError?.message ?? null,
        });
        this.#scheduleBot();
      },
    });
  }

  static async create(): Promise<LocalTableController> {
    const network = new FakeMeshNetwork();
    const participants = [
      ["you", "你"],
      ["east", "听雨眠"],
      ["north", "清风徐来"],
      ["west", "墨染江南"],
    ].map(([id, displayName], index) => ({
      id: participantId(`participant-${id}`),
      peerId: peerId(`peer-${index}-${id}`),
      displayName: displayName!,
    }));
    const transports = participants.map((participant) =>
      network.createTransport(participant.peerId),
    );
    const runtimes = participants.map(
      (participant, index) =>
        new MultiSessionRuntime({
          tableId: tableId("playground-local-table"),
          gameId: gameId("playground-local-game"),
          localParticipant: participant,
          coordinatorId: participants[0]!.id,
          coordinatorPeerId: participants[0]!.peerId,
          configuration,
          plugin: mahjongPlugin,
          transport: transports[index]!,
        }),
    );
    await Promise.all(runtimes.map((runtime) => runtime.start()));
    for (const runtime of runtimes.slice(1)) {
      await runtime.join({
        displayName: participants[runtimes.indexOf(runtime)]!.displayName,
      });
      await pump(network, runtimes);
    }
    await pump(network, runtimes);
    return new LocalTableController(network, participants, runtimes);
  }

  async ready(): Promise<void> {
    for (const runtime of this.#runtimes) {
      await runtime.ready(true);
      await pump(this.#network, this.#runtimes);
    }
  }

  async start(): Promise<void> {
    await this.#runtimes[0]!.startGame();
    await pump(this.#network, this.#runtimes);
  }

  async discard(tileId: string): Promise<void> {
    await this.#runtimes[0]!.gameCommand({ kind: "discard", tileId });
    await pump(this.#network, this.#runtimes);
  }

  async restart(): Promise<void> {
    const id = proposalId(`playground-restart-${Date.now()}`);
    await this.#runtimes[0]!.proposeRestart(id);
    await pump(this.#network, this.#runtimes);
    for (const runtime of this.#runtimes.slice(1)) {
      await runtime.voteRestart(id, true);
      await pump(this.#network, this.#runtimes);
    }
  }

  async resume(): Promise<void> {
    await Promise.all(this.#runtimes.map((runtime) => runtime.resumeConnections()));
    await pump(this.#network, this.#runtimes);
  }

  async togglePeer(): Promise<void> {
    const state = this.#runtimes[0]!.getState();
    if (state.phase === "offline" || state.phase === "syncing") {
      await this.resume();
      return;
    }
    this.#network.disconnectPeer(this.#participants[2]!.peerId);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#botTimer !== null) window.clearTimeout(this.#botTimer);
    this.#unsubscribe();
    for (const runtime of this.#runtimes) runtime.dispose();
    this.listeners.clear();
  }

  #scheduleBot(): void {
    if (this.#disposed || this.#botTimer !== null || !this.view) return;
    const { snapshot } = this.view;
    const game = snapshot.game;
    if (
      snapshot.state.phase !== "playing" ||
      !game ||
      game.currentParticipantId === snapshot.state.localParticipantId
    ) {
      return;
    }
    const runtimeIndex = this.#participants.findIndex(
      (participant) => participant.id === game.currentParticipantId,
    );
    const tile = game.hands[game.currentParticipantId]?.[0];
    if (runtimeIndex < 0 || !tile) return;
    this.#botTimer = window.setTimeout(() => {
      this.#botTimer = null;
      void this.#runtimes[runtimeIndex]!
        .gameCommand({ kind: "discard", tileId: tile.id } as JsonValue)
        .then(() => pump(this.#network, this.#runtimes));
    }, 620);
  }
}

export interface LiveSetup {
  readonly signalUrl: string;
  readonly tableCode: string;
  readonly displayName: string;
  readonly coordinatorPeerId: string;
}

export class LiveTableController extends BaseController {
  readonly #runtime: Runtime;
  readonly #localParticipantId: ParticipantId;
  readonly #unsubscribe: () => void;
  #disposed = false;

  private constructor(input: {
    runtime: Runtime;
    localParticipantId: ParticipantId;
    localPeerId: PeerId;
    tableCode: string;
  }) {
    super();
    this.#runtime = input.runtime;
    this.#localParticipantId = input.localParticipantId;
    this.#unsubscribe = input.runtime.subscribe({
      onStateChange: (snapshot) => {
        this.emit({
          snapshot,
          events: input.runtime.getHistory(),
          mode: "p2p",
          localPeerId: input.localPeerId,
          tableCode: input.tableCode,
          error: snapshot.state.protocolError?.message ?? null,
        });
      },
    });
  }

  static async create(setup: LiveSetup): Promise<LiveTableController> {
    const endpoint = new NetworkEndpoint<PeerId>();
    const { peerId: localPeerId } = await endpoint.register(setup.signalUrl);
    const isCoordinator = setup.coordinatorPeerId.trim().length === 0;
    const coordinatorPeerId = isCoordinator
      ? localPeerId
      : peerId(setup.coordinatorPeerId.trim());
    const localParticipantId = participantId(`participant-${localPeerId}`);
    const coordinatorId = participantId(`participant-${coordinatorPeerId}`);
    const transport = new EndpointMeshTransport(endpoint);
    const runtime = new MultiSessionRuntime({
      tableId: tableId(`table-${setup.tableCode.trim()}`),
      gameId: gameId(`game-${setup.tableCode.trim()}-1`),
      localParticipant: {
        id: localParticipantId,
        peerId: localPeerId,
        displayName: setup.displayName.trim() || "牌友",
      },
      coordinatorId,
      coordinatorPeerId,
      configuration,
      plugin: mahjongPlugin,
      transport,
      ownsTransport: true,
    });
    const controller = new LiveTableController({
      runtime,
      localParticipantId,
      localPeerId,
      tableCode: setup.tableCode.trim(),
    });
    await runtime.start();
    if (!isCoordinator) await runtime.join({ displayName: setup.displayName });
    return controller;
  }

  async ready(): Promise<void> {
    await this.#runtime.ready(true);
  }

  async start(): Promise<void> {
    await this.#runtime.startGame();
  }

  async discard(tileId: string): Promise<void> {
    await this.#runtime.gameCommand({ kind: "discard", tileId });
  }

  async restart(): Promise<void> {
    const pending = this.#runtime.getState().pendingRestart;
    if (!pending) {
      await this.#runtime.proposeRestart(
        proposalId(`playground-live-restart-${Date.now()}`),
      );
      return;
    }
    if (!pending.votes.has(this.#localParticipantId)) {
      await this.#runtime.voteRestart(pending.id, true);
    }
  }

  async resume(): Promise<void> {
    await this.#runtime.resumeConnections();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    this.#runtime.dispose();
    this.listeners.clear();
  }
}
