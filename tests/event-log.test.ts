import { describe, expect, it } from "vitest";
import {
  createOrderedEvent,
  eventId,
  gameId,
  OrderedEventLog,
  participantId,
  tableId,
} from "../src";

const createEvent = async (input: {
  id: string;
  seq: number;
  previousHash: string | null;
  ready?: boolean;
}) =>
  createOrderedEvent({
    eventId: eventId(input.id),
    tableId: tableId("table-1"),
    gameId: gameId("game-1"),
    seq: input.seq,
    coordinatorEpoch: 1,
    actorId: participantId("participant-1"),
    spec: {
      type: "READY_CHANGED",
      payload: {
        participantId: participantId("participant-1"),
        ready: input.ready ?? true,
      },
    },
    previousHash: input.previousHash,
  });

describe("ordered event log", () => {
  it("buffers a gap and drains it only after the missing event arrives", async () => {
    const first = await createEvent({ id: "event-1", seq: 1, previousHash: null });
    const second = await createEvent({
      id: "event-2",
      seq: 2,
      previousHash: first.eventHash,
    });
    const log = new OrderedEventLog();
    const applied: number[] = [];
    const apply = (event: { seq: number }) => {
      applied.push(event.seq);
      return { ok: true as const };
    };
    expect(await log.ingest(second, apply)).toEqual({
      status: "gap",
      expectedSeq: 1,
      receivedSeq: 2,
    });
    expect(applied).toEqual([]);
    expect(await log.ingest(first, apply)).toMatchObject({
      status: "applied",
      events: [first, second],
    });
    expect(applied).toEqual([1, 2]);
    expect(await log.ingest(first, apply)).toEqual({ status: "duplicate" });
  });

  it("stops on same epoch/seq with different hashes", async () => {
    const first = await createEvent({ id: "event-1", seq: 1, previousHash: null });
    const conflicting = await createEvent({
      id: "event-other",
      seq: 1,
      previousHash: null,
      ready: false,
    });
    const log = new OrderedEventLog();
    await log.ingest(first, () => ({ ok: true }));
    expect(await log.ingest(conflicting, () => ({ ok: true }))).toMatchObject({
      status: "conflict",
      code: "coordinator_equivocation",
    });
    expect(log.stopped).toBe(true);
  });

  it("detects conflicting peer checkpoints", async () => {
    const first = await createEvent({ id: "event-1", seq: 1, previousHash: null });
    const log = new OrderedEventLog();
    await log.ingest(first, () => ({ ok: true }));
    expect(
      log.observeAck({
        coordinatorEpoch: 1,
        seq: 1,
        eventHash: "0".repeat(64),
      }),
    ).toMatchObject({ status: "conflict", code: "coordinator_equivocation" });
  });
});
