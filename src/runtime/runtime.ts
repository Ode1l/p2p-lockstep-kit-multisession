import type {
  GameId,
  ParticipantId,
  PeerId,
  ProposalId,
  TableId,
} from "../ids";
import { commandId, proposalId } from "../ids";
import {
  commandEventSpecs,
  membershipEventSpec,
  orderEventSpecs,
} from "../coordinator/commands";
import { createIdFactory, type IdFactory } from "../coordinator/id-factory";
import { OrderedEventLog } from "../event-log/ordered-log";
import type { EventIngestResult, OrderedEvent } from "../event-log/types";
import { buildSnapshot, ObserverHub, type MultiSessionObserver } from "../observer";
import type { MultiGamePlugin } from "../plugin/types";
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
} from "../protocol/constants";
import type {
  CommandRequestPayload,
  ProtocolMessage,
  ProtocolMessageType,
  SessionCommand,
} from "../protocol/types";
import { parseProtocolMessage } from "../protocol/validation";
import type { JsonValue } from "../shared/json";
import { createInitialSessionState } from "../state/create";
import { completeConnectionSync, updateConnection } from "../state/connections";
import { reduceOrderedEvent } from "../state/reducer";
import type {
  MultiSessionState,
  Participant,
  ProtocolError,
  SessionConfiguration,
} from "../state/types";
import type { MultiPeerTransport, Unsubscribe } from "../transport/types";

export interface MultiSessionRuntimeOptions<
  TCommand,
  TEventPayload extends JsonValue,
  TGameState,
  TGameSnapshot extends JsonValue,
> {
  readonly tableId: TableId;
  readonly gameId: GameId;
  readonly localParticipant: Omit<Participant, "joinedAtSeq">;
  readonly coordinatorId: ParticipantId;
  readonly coordinatorPeerId: PeerId;
  readonly configuration: SessionConfiguration;
  readonly plugin: MultiGamePlugin<
    TCommand,
    TEventPayload,
    TGameState,
    TGameSnapshot
  >;
  readonly transport: MultiPeerTransport;
  readonly idFactory?: IdFactory;
  readonly ownsTransport?: boolean;
  readonly maxConcurrentConnections?: number;
}

export interface JoinOptions {
  readonly displayName?: string;
}

export class MultiSessionRuntime<
  TCommand,
  TEventPayload extends JsonValue,
  TGameState,
  TGameSnapshot extends JsonValue,
> {
  readonly #options: MultiSessionRuntimeOptions<
    TCommand,
    TEventPayload,
    TGameState,
    TGameSnapshot
  >;
  readonly #plugin: MultiGamePlugin<
    TCommand,
    TEventPayload,
    TGameState,
    TGameSnapshot
  >;
  readonly #transport: MultiPeerTransport;
  readonly #idFactory: IdFactory;
  readonly #observer = new ObserverHub<TGameSnapshot>();
  readonly #unsubscribers: Unsubscribe[] = [];
  readonly #seenMessageIds = new Set<string>();
  readonly #seenCommandIds = new Set<string>();
  readonly #maxConcurrentConnections: number;
  #state: MultiSessionState<TGameState>;
  #log = new OrderedEventLog();
  #started = false;
  #disposed = false;
  #messageQueue: Promise<void> = Promise.resolve();
  #commandQueue: Promise<void> = Promise.resolve();
  #nextCommand = 0;

  constructor(
    options: MultiSessionRuntimeOptions<
      TCommand,
      TEventPayload,
      TGameState,
      TGameSnapshot
    >,
  ) {
    if (options.transport.localPeerId !== options.localParticipant.peerId) {
      throw new Error("transport localPeerId must match local participant peerId");
    }
    this.#options = options;
    this.#plugin = options.plugin;
    this.#transport = options.transport;
    this.#idFactory = options.idFactory ?? createIdFactory();
    this.#maxConcurrentConnections = options.maxConcurrentConnections ?? 3;
    if (
      !Number.isInteger(this.#maxConcurrentConnections) ||
      this.#maxConcurrentConnections < 1 ||
      this.#maxConcurrentConnections > 10
    ) {
      throw new RangeError("maxConcurrentConnections must be an integer between 1 and 10");
    }
    this.#state = this.#createBaseState();
  }

  async start(): Promise<void> {
    this.#assertActive();
    if (this.#started) return;
    this.#started = true;
    this.#unsubscribers.push(
      this.#transport.onMessage((peerId, message) => {
        this.#messageQueue = this.#messageQueue
          .then(() => this.#handleMessage(peerId, message))
          .catch((error: unknown) => {
            this.#fail("invalid_message", error instanceof Error ? error.message : "message handler failed", peerId);
          });
      }),
      this.#transport.onPeerStateChange((peerId, connection) => {
        const participant = this.#participantForPeer(peerId);
        if (!participant) return;
        this.#state = updateConnection(this.#state, participant.id, connection);
        this.#notify();
      }),
    );

    if (this.isCoordinator && this.#log.lastAppliedSeq === 0) {
      const seat = this.#options.configuration.seatIds[0];
      if (!seat) throw new Error("coordinator seat is missing");
      const ordered = await orderEventSpecs({
        state: this.#state,
        actorId: this.#state.coordinatorId,
        specs: [
          membershipEventSpec({
            participant: this.#options.localParticipant,
            seatId: seat,
          }),
        ],
        plugin: this.#plugin,
        idFactory: this.#idFactory,
      });
      if (!ordered.ok) throw new Error(ordered.error);
      await this.#applyEvents(ordered.value.events, this.#options.localParticipant.peerId);
    }
    this.#notify();
  }

  get isCoordinator(): boolean {
    return this.#options.localParticipant.id === this.#options.coordinatorId;
  }

  getState(): MultiSessionState<TGameState> {
    return this.#state;
  }

  getHistory(): readonly OrderedEvent[] {
    return this.#log.getEvents();
  }

  subscribe(observer: MultiSessionObserver<TGameSnapshot>): Unsubscribe {
    return this.#observer.subscribe(observer);
  }

  async join(options: JoinOptions = {}): Promise<void> {
    this.#assertStarted();
    if (this.isCoordinator) throw new Error("coordinator is already a member");
    if (this.#state.phase !== "invited") throw new Error("session is not invited");
    this.#state = { ...this.#state, phase: "joining" };
    this.#notify();
    await this.#transport.connect(this.#options.coordinatorPeerId);
    const payload = {
      participantId: this.#options.localParticipant.id,
      ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
    };
    this.#sendTo(
      this.#options.coordinatorPeerId,
      "JOIN_REQUEST",
      payload,
      null,
    );
  }

  ready(ready: boolean): Promise<void> {
    return this.#submit({ type: "SET_READY", ready });
  }

  startGame(): Promise<void> {
    return this.#submit({ type: "START_GAME" });
  }

  gameCommand(data: JsonValue): Promise<void> {
    return this.#submit({ type: "GAME_COMMAND", data });
  }

  proposeRestart(id: ProposalId = proposalId(`proposal-${globalThis.crypto.randomUUID()}`)): Promise<void> {
    return this.#submit({ type: "PROPOSE_RESTART", proposalId: id });
  }

  voteRestart(id: ProposalId, approve: boolean): Promise<void> {
    return this.#submit({ type: "VOTE_RESTART", proposalId: id, approve });
  }

  sendPrivate(
    participantId: ParticipantId,
    data: JsonValue,
    relatedEventId?: string,
  ): void {
    this.#assertStarted();
    const participant = this.#state.participants.get(participantId);
    if (!participant) throw new Error("private-message target is not a member");
    if (this.#transport.getPeerState(participant.peerId) !== "connected") {
      throw new Error("private-message target is not connected");
    }
    this.#sendTo(participant.peerId, "PRIVATE_MESSAGE", {
      data,
      ...(relatedEventId === undefined ? {} : { relatedEventId }),
    });
  }

  async resumeConnections(): Promise<void> {
    this.#assertStarted();
    await this.#connectRequiredPeers();
    if (this.#state.meshReady && this.#state.phase === "syncing") {
      if (this.isCoordinator) {
        this.#state = completeConnectionSync(this.#state);
        this.#notify();
      } else {
        this.#requestSync("mesh_reconnected");
      }
    }
  }

  async idle(): Promise<void> {
    await this.#messageQueue;
    await this.#commandQueue;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
    this.#observer.clear();
    this.#seenMessageIds.clear();
    this.#seenCommandIds.clear();
    if (this.#options.ownsTransport) this.#transport.dispose();
  }

  #createBaseState(): MultiSessionState<TGameState> {
    return createInitialSessionState<TGameState>({
      tableId: this.#options.tableId,
      gameId: this.#options.gameId,
      localParticipant: { ...this.#options.localParticipant, joinedAtSeq: 0 },
      coordinatorId: this.#options.coordinatorId,
      configuration: this.#options.configuration,
      phase: this.isCoordinator ? "mesh_connecting" : "invited",
    });
  }

  #submit(command: SessionCommand): Promise<void> {
    this.#assertStarted();
    if (
      this.#state.phase === "offline" ||
      this.#state.phase === "syncing" ||
      this.#state.phase === "protocol_error"
    ) {
      return Promise.reject(
        new Error("commands are disabled while offline, syncing or conflicted"),
      );
    }
    const request: CommandRequestPayload = {
      commandId: commandId(
        `command-${this.#options.localParticipant.id}-${++this.#nextCommand}`,
      ),
      expectedSeq: this.#state.lastAppliedSeq,
      command,
    };
    if (this.isCoordinator) return this.#enqueueCommand(this.#options.localParticipant.id, request);
    const coordinator = this.#state.participants.get(this.#state.coordinatorId);
    if (!coordinator) return Promise.reject(new Error("coordinator is not in the roster"));
    this.#sendTo(coordinator.peerId, "COMMAND_REQUEST", request);
    return Promise.resolve();
  }

  #enqueueCommand(actorId: ParticipantId, request: CommandRequestPayload): Promise<void> {
    const task = this.#commandQueue
      .catch(() => undefined)
      .then(() => this.#processCommand(actorId, request));
    this.#commandQueue = task.catch(() => undefined);
    return task;
  }

  async #processCommand(actorId: ParticipantId, request: CommandRequestPayload): Promise<void> {
    if (!this.isCoordinator) return;
    if (this.#seenCommandIds.has(request.commandId)) return;
    this.#seenCommandIds.add(request.commandId);
    const specs = commandEventSpecs(this.#state, actorId, request, this.#plugin);
    if (!specs.ok) throw new Error(specs.error);
    const ordered = await orderEventSpecs({
      state: this.#state,
      actorId,
      specs: specs.value,
      plugin: this.#plugin,
      idFactory: this.#idFactory,
    });
    if (!ordered.ok) throw new Error(ordered.error);
    await this.#applyEvents(
      ordered.value.events,
      this.#options.localParticipant.peerId,
      false,
    );
    this.#broadcast(
      "ORDERED_EVENTS",
      { events: ordered.value.events },
      undefined,
      ordered.value.events[0]?.gameId,
    );
    for (const event of ordered.value.events) this.#broadcastAck(event);
  }

  async #handleMessage(sourcePeerId: PeerId, raw: unknown): Promise<void> {
    const parsed = parseProtocolMessage(raw);
    if (!parsed.ok) {
      this.#fail("invalid_message", parsed.error, sourcePeerId);
      return;
    }
    const message = parsed.value;
    if (message.senderPeerId !== sourcePeerId) {
      this.#fail("invalid_message", "senderPeerId does not match transport source", sourcePeerId);
      return;
    }
    if (message.tableId !== this.#state.tableId) {
      this.#fail("wrong_scope", "message has wrong tableId", sourcePeerId);
      return;
    }
    if (this.#seenMessageIds.has(message.messageId)) return;
    this.#rememberMessage(message.messageId);

    if (message.type === "JOIN_REQUEST") {
      await this.#handleJoin(sourcePeerId, message);
      return;
    }
    if (message.type === "JOIN_ACCEPTED") {
      if (sourcePeerId !== this.#options.coordinatorPeerId) {
        this.#fail("invalid_message", "join response is not from coordinator", sourcePeerId);
        return;
      }
      await this.#replaceFromRecord(message.payload.events);
      await this.#connectRequiredPeers();
      return;
    }
    if (message.type === "JOIN_REJECTED") {
      this.#state = { ...this.#state, phase: "invited" };
      this.#notify();
      return;
    }

    const sender = this.#participantForPeer(sourcePeerId);
    if (!sender || message.senderParticipantId !== sender.id) {
      this.#fail("invalid_message", "sender is not bound to source peer", sourcePeerId);
      return;
    }
    if (
      message.gameId !== this.#state.gameId &&
      message.type !== "SYNC_STATE" &&
      message.type !== "EVENT_ACK"
    ) {
      this.#fail("wrong_scope", "message has wrong gameId", sourcePeerId);
      return;
    }

    if (message.type === "COMMAND_REQUEST") {
      if (!this.isCoordinator) return;
      try {
        await this.#enqueueCommand(sender.id, message.payload);
      } catch (error) {
        this.#sendTo(sourcePeerId, "PROTOCOL_ERROR", {
          code: "command_rejected",
          message: error instanceof Error ? error.message : "command rejected",
        });
      }
    } else if (message.type === "ORDERED_EVENTS") {
      if (sender.id !== this.#state.coordinatorId) {
        this.#fail("invalid_event", "ordered events are not from coordinator", sourcePeerId);
        return;
      }
      await this.#applyEvents(message.payload.events, sourcePeerId);
      await this.#connectRequiredPeers();
    } else if (message.type === "EVENT_ACK") {
      const result = this.#log.observeAck(message.payload);
      if (result.status === "conflict") this.#failFromIngest(result, sourcePeerId);
    } else if (message.type === "SYNC_REQUEST") {
      if (this.isCoordinator) {
        this.#sendTo(sourcePeerId, "SYNC_STATE", { events: this.#log.getEvents() });
      }
    } else if (message.type === "SYNC_STATE") {
      if (sender.id !== this.#state.coordinatorId) {
        this.#fail("invalid_message", "sync state is not from coordinator", sourcePeerId);
        return;
      }
      await this.#replaceFromRecord(message.payload.events);
      this.#state = completeConnectionSync(this.#state);
      this.#notify();
    } else if (message.type === "MESH_HELLO") {
      if (
        message.payload.lastAppliedSeq === this.#state.lastAppliedSeq &&
        message.payload.eventHash !== this.#state.lastEventHash
      ) {
        this.#fail("coordinator_equivocation", "mesh checkpoint hash differs", sourcePeerId);
      }
    } else if (message.type === "PRIVATE_MESSAGE") {
      this.#observer.notifyPrivateMessage({
        fromParticipantId: sender.id,
        data: message.payload.data,
        ...(message.payload.relatedEventId === undefined
          ? {}
          : { relatedEventId: message.payload.relatedEventId }),
      });
    }
  }

  async #handleJoin(
    sourcePeerId: PeerId,
    message: Extract<ProtocolMessage, { type: "JOIN_REQUEST" }>,
  ): Promise<void> {
    if (!this.isCoordinator) return;
    if (this.#state.phase === "playing" || this.#state.participants.size >= this.#state.configuration.participantCount) {
      this.#sendTo(sourcePeerId, "JOIN_REJECTED", { reason: "table is not accepting participants" });
      return;
    }
    if (message.payload.participantId === this.#state.coordinatorId) {
      this.#sendTo(sourcePeerId, "JOIN_REJECTED", { reason: "participantId is already reserved" });
      return;
    }
    const seat = [...this.#state.seats].find(([, participant]) => participant === null)?.[0];
    if (!seat) {
      this.#sendTo(sourcePeerId, "JOIN_REJECTED", { reason: "no seat available" });
      return;
    }
    const participant: Omit<Participant, "joinedAtSeq"> = {
      id: message.payload.participantId,
      peerId: sourcePeerId,
      ...(message.payload.displayName === undefined
        ? {}
        : { displayName: message.payload.displayName }),
    };
    const ordered = await orderEventSpecs({
      state: this.#state,
      actorId: this.#state.coordinatorId,
      specs: [membershipEventSpec({ participant, seatId: seat })],
      plugin: this.#plugin,
      idFactory: this.#idFactory,
    });
    if (!ordered.ok) {
      this.#sendTo(sourcePeerId, "JOIN_REJECTED", { reason: ordered.error });
      return;
    }
    await this.#applyEvents(
      ordered.value.events,
      this.#options.localParticipant.peerId,
      false,
    );
    this.#broadcast(
      "ORDERED_EVENTS",
      { events: ordered.value.events },
      new Set([sourcePeerId]),
      ordered.value.events[0]?.gameId,
    );
    this.#sendTo(sourcePeerId, "JOIN_ACCEPTED", { events: this.#log.getEvents() });
    await this.#connectRequiredPeers();
  }

  async #applyEvents(
    events: readonly OrderedEvent[],
    sourcePeerId: PeerId,
    broadcastAcks = true,
  ): Promise<void> {
    for (const event of events) {
      const result = await this.#log.ingest(event, (next) => {
        const reduced = reduceOrderedEvent(this.#state, next, this.#plugin);
        if (!reduced.ok) return { ok: false, code: "invalid_event", message: reduced.error };
        this.#state = reduced.value;
        return { ok: true };
      });
      if (result.status === "gap") {
        const previous = this.#state.phase;
        this.#state = {
          ...this.#state,
          phase: "syncing",
          phaseBeforeOffline:
            previous === "offline" || previous === "syncing" || previous === "protocol_error"
              ? this.#state.phaseBeforeOffline
              : previous,
          sync: { status: "required", reason: "sequence_gap", fromSeq: result.expectedSeq - 1 },
        };
        this.#notify();
        this.#requestSync("sequence_gap");
        return;
      }
      if (result.status === "conflict" || result.status === "rejected") {
        this.#failFromIngest(result, sourcePeerId);
        return;
      }
      if (result.status === "applied") {
        if (broadcastAcks) {
          for (const applied of result.events) this.#broadcastAck(applied);
        }
        this.#notify();
      }
    }
  }

  async #replaceFromRecord(events: readonly OrderedEvent[]): Promise<void> {
    const nextLog = new OrderedEventLog();
    let nextState = this.#createBaseState();
    for (const event of events) {
      const result = await nextLog.ingest(event, (next) => {
        const reduced = reduceOrderedEvent(nextState, next, this.#plugin);
        if (!reduced.ok) return { ok: false, code: "invalid_event", message: reduced.error };
        nextState = reduced.value;
        return { ok: true };
      });
      if (result.status !== "applied" && result.status !== "duplicate") {
        throw new Error(`sync record rejected: ${result.status}`);
      }
    }
    this.#log = nextLog;
    this.#state = nextState;
    for (const participant of this.#state.participants.values()) {
      const connection =
        participant.id === this.#state.localParticipantId
          ? "connected"
          : this.#transport.getPeerState(participant.peerId);
      this.#state = updateConnection(this.#state, participant.id, connection);
    }
    if (this.#state.meshReady) {
      this.#state = {
        ...this.#state,
        sync: { status: "complete", atSeq: this.#state.lastAppliedSeq },
      };
    }
    this.#notify();
  }

  async #connectRequiredPeers(): Promise<void> {
    const localPeer = this.#options.localParticipant.peerId;
    const peers = [...this.#state.participants.values()]
      .filter(
        (participant) =>
          participant.id !== this.#state.localParticipantId &&
          this.#transport.getPeerState(participant.peerId) !== "connected" &&
          localPeer < participant.peerId,
      )
      .map((participant) => participant.peerId);
    let cursor = 0;
    const worker = async () => {
      while (cursor < peers.length) {
        const peer = peers[cursor++];
        if (peer) await this.#transport.connect(peer);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.#maxConcurrentConnections, peers.length) },
        worker,
      ),
    );
    for (const participant of this.#state.participants.values()) {
      if (participant.id !== this.#state.localParticipantId) {
        const connection = this.#transport.getPeerState(participant.peerId);
        this.#state = updateConnection(
          this.#state,
          participant.id,
          connection,
        );
        if (connection === "connected") {
          this.#sendTo(participant.peerId, "MESH_HELLO", {
            lastAppliedSeq: this.#state.lastAppliedSeq,
            eventHash: this.#state.lastEventHash,
          });
        }
      }
    }
    this.#notify();
  }

  #requestSync(reason: "sequence_gap" | "mesh_reconnected"): void {
    const coordinator = this.#state.participants.get(this.#state.coordinatorId);
    if (!coordinator || coordinator.id === this.#state.localParticipantId) return;
    this.#sendTo(coordinator.peerId, "SYNC_REQUEST", {
      coordinatorEpoch: this.#state.coordinatorEpoch,
      lastAppliedSeq: this.#state.lastAppliedSeq,
      lastEventHash: this.#state.lastEventHash,
      reason,
    });
  }

  #broadcastAck(event: OrderedEvent): void {
    this.#broadcast("EVENT_ACK", {
      coordinatorEpoch: event.coordinatorEpoch,
      seq: event.seq,
      eventHash: event.eventHash,
    });
  }

  #sendTo(
    peerId: PeerId,
    type: ProtocolMessageType,
    payload: unknown,
    senderParticipantId: ParticipantId | null = this.#state.localParticipantId,
  ): void {
    this.#transport.sendTo(
      peerId,
      this.#message(type, payload, senderParticipantId),
    );
  }

  #broadcast(
    type: ProtocolMessageType,
    payload: unknown,
    except?: ReadonlySet<PeerId>,
    gameScope?: GameId,
  ): void {
    const message = this.#message(
      type,
      payload,
      this.#state.localParticipantId,
      gameScope,
    );
    for (const participant of this.#state.participants.values()) {
      if (participant.id === this.#state.localParticipantId) continue;
      if (except?.has(participant.peerId)) continue;
      if (this.#transport.getPeerState(participant.peerId) !== "connected") {
        continue;
      }
      this.#transport.sendTo(participant.peerId, message);
    }
  }

  #message(
    type: ProtocolMessageType,
    payload: unknown,
    senderParticipantId: ParticipantId | null = this.#state.localParticipantId,
    gameScope: GameId = this.#state.gameId,
  ): ProtocolMessage {
    return {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      messageId: this.#idFactory.messageId(),
      type,
      tableId: this.#state.tableId,
      gameId: gameScope,
      senderParticipantId,
      senderPeerId: this.#options.localParticipant.peerId,
      payload,
    } as ProtocolMessage;
  }

  #participantForPeer(peerId: PeerId): Participant | null {
    return [...this.#state.participants.values()].find((item) => item.peerId === peerId) ?? null;
  }

  #rememberMessage(id: string): void {
    this.#seenMessageIds.add(id);
    if (this.#seenMessageIds.size > 10_000) {
      const first = this.#seenMessageIds.values().next().value as string | undefined;
      if (first) this.#seenMessageIds.delete(first);
    }
  }

  #failFromIngest(
    result: Extract<EventIngestResult, { status: "conflict" | "rejected" }>,
    peerId: PeerId,
  ): void {
    const code =
      result.status === "conflict"
        ? result.code
        : result.code === "previous_hash_mismatch"
          ? "hash_mismatch"
          : "invalid_event";
    this.#fail(code, result.message, peerId);
  }

  #fail(code: ProtocolError["code"], message: string, peerId?: PeerId): void {
    const error: ProtocolError = { code, message, ...(peerId ? { peerId } : {}) };
    this.#state = { ...this.#state, phase: "protocol_error", protocolError: error };
    this.#observer.notifyError(error);
    this.#notify();
  }

  #notify(): void {
    this.#observer.notify(buildSnapshot(this.#state, this.#log.getEvents().length, this.#plugin));
  }

  #assertStarted(): void {
    this.#assertActive();
    if (!this.#started) throw new Error("runtime has not started");
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("runtime is disposed");
  }
}
