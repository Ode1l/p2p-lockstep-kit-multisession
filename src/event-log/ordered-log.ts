import { verifyOrderedEventHash } from "./hash";
import type {
  EventIngestResult,
  EventValidation,
  OrderedEvent,
} from "./types";

export interface OrderedEventLogOptions {
  readonly maxBufferedEvents?: number;
}

export class OrderedEventLog {
  readonly #events: OrderedEvent[] = [];
  readonly #eventHashes = new Map<string, string>();
  readonly #sequenceHashes = new Map<string, string>();
  readonly #ackHashes = new Map<string, string>();
  readonly #future = new Map<number, OrderedEvent>();
  readonly #futureEventHashes = new Map<string, string>();
  readonly #maxBufferedEvents: number;
  #stopped = false;

  constructor(options: OrderedEventLogOptions = {}) {
    this.#maxBufferedEvents = options.maxBufferedEvents ?? 512;
  }

  get lastAppliedSeq(): number {
    return this.#events.at(-1)?.seq ?? 0;
  }

  get lastEventHash(): string | null {
    return this.#events.at(-1)?.eventHash ?? null;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  getEvents(): readonly OrderedEvent[] {
    return [...this.#events];
  }

  async ingest(
    event: OrderedEvent,
    validateAndApply: (event: OrderedEvent) => EventValidation | Promise<EventValidation>,
  ): Promise<EventIngestResult> {
    if (this.#stopped) {
      return {
        status: "rejected",
        code: "log_stopped",
        message: "event log is stopped after a protocol violation",
      };
    }
    if (!(await verifyOrderedEventHash(event))) {
      this.#stopped = true;
      return {
        status: "conflict",
        code: "hash_mismatch",
        message: `event ${event.eventId} has an invalid hash`,
      };
    }

    const knownEventHash = this.#eventHashes.get(event.eventId);
    if (knownEventHash !== undefined) {
      if (knownEventHash === event.eventHash) return { status: "duplicate" };
      this.#stopped = true;
      return {
        status: "conflict",
        code: "sequence_conflict",
        message: `eventId ${event.eventId} was reused with different content`,
      };
    }
    const futureEventHash = this.#futureEventHashes.get(event.eventId);
    if (futureEventHash !== undefined) {
      if (futureEventHash === event.eventHash) {
        return { status: "gap", expectedSeq: this.lastAppliedSeq + 1, receivedSeq: event.seq };
      }
      this.#stopped = true;
      return {
        status: "conflict",
        code: "sequence_conflict",
        message: `buffered eventId ${event.eventId} was reused with different content`,
      };
    }

    const sequenceKey = this.#sequenceKey(event.coordinatorEpoch, event.seq);
    const knownSequenceHash =
      this.#sequenceHashes.get(sequenceKey) ?? this.#ackHashes.get(sequenceKey);
    if (knownSequenceHash !== undefined && knownSequenceHash !== event.eventHash) {
      this.#stopped = true;
      return {
        status: "conflict",
        code: "coordinator_equivocation",
        message: `epoch ${event.coordinatorEpoch} seq ${event.seq} has conflicting hashes`,
      };
    }

    const expectedSeq = this.lastAppliedSeq + 1;
    if (event.seq < expectedSeq) {
      this.#stopped = true;
      return {
        status: "conflict",
        code: "sequence_conflict",
        message: `unrecognized historical event at seq ${event.seq}`,
      };
    }
    if (event.seq > expectedSeq) {
      const buffered = this.#future.get(event.seq);
      if (buffered && buffered.eventHash !== event.eventHash) {
        this.#stopped = true;
        return {
          status: "conflict",
          code: "coordinator_equivocation",
          message: `buffered seq ${event.seq} has conflicting hashes`,
        };
      }
      if (!buffered) {
        if (this.#future.size >= this.#maxBufferedEvents) {
          this.#stopped = true;
          return {
            status: "rejected",
            code: "gap_buffer_full",
            message: "sequence gap buffer limit exceeded",
          };
        }
        this.#future.set(event.seq, event);
        this.#futureEventHashes.set(event.eventId, event.eventHash);
      }
      return { status: "gap", expectedSeq, receivedSeq: event.seq };
    }

    const applied: OrderedEvent[] = [];
    let next: OrderedEvent | undefined = event;
    while (next) {
      const result = await this.#applyOne(next, validateAndApply);
      if (!result.ok) {
        this.#stopped = true;
        return { status: "rejected", code: result.code, message: result.message };
      }
      applied.push(next);
      this.#future.delete(next.seq);
      this.#futureEventHashes.delete(next.eventId);
      next = this.#future.get(this.lastAppliedSeq + 1);
    }
    return { status: "applied", events: applied };
  }

  observeAck(input: {
    coordinatorEpoch: number;
    seq: number;
    eventHash: string;
  }): EventIngestResult {
    if (this.#stopped) {
      return {
        status: "rejected",
        code: "log_stopped",
        message: "event log is stopped after a protocol violation",
      };
    }
    const key = this.#sequenceKey(input.coordinatorEpoch, input.seq);
    const known = this.#sequenceHashes.get(key) ?? this.#ackHashes.get(key);
    if (known !== undefined && known !== input.eventHash) {
      this.#stopped = true;
      return {
        status: "conflict",
        code: "coordinator_equivocation",
        message: `checkpoint conflict at epoch ${input.coordinatorEpoch} seq ${input.seq}`,
      };
    }
    this.#ackHashes.set(key, input.eventHash);
    return { status: "duplicate" };
  }

  #sequenceKey(epoch: number, seq: number): string {
    return `${epoch}:${seq}`;
  }

  async #applyOne(
    event: OrderedEvent,
    validateAndApply: (event: OrderedEvent) => EventValidation | Promise<EventValidation>,
  ): Promise<EventValidation> {
    if (event.seq !== this.lastAppliedSeq + 1) {
      return { ok: false, code: "sequence_gap", message: "event is not contiguous" };
    }
    if (event.previousHash !== this.lastEventHash) {
      return {
        ok: false,
        code: "previous_hash_mismatch",
        message: `event ${event.seq} does not link to the current hash`,
      };
    }
    const ack = this.#ackHashes.get(
      this.#sequenceKey(event.coordinatorEpoch, event.seq),
    );
    if (ack !== undefined && ack !== event.eventHash) {
      return {
        ok: false,
        code: "coordinator_equivocation",
        message: `event ${event.seq} conflicts with an observed checkpoint`,
      };
    }
    const validation = await validateAndApply(event);
    if (!validation.ok) return validation;
    this.#events.push(event);
    this.#eventHashes.set(event.eventId, event.eventHash);
    this.#sequenceHashes.set(
      this.#sequenceKey(event.coordinatorEpoch, event.seq),
      event.eventHash,
    );
    return { ok: true };
  }
}
