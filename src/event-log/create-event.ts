import type { EventId, GameId, ParticipantId, TableId } from "../ids";
import { hashOrderedEvent } from "./hash";
import type { OrderedEvent, SessionEventSpec } from "./types";

export const createOrderedEvent = async (input: {
  eventId: EventId;
  tableId: TableId;
  gameId: GameId;
  seq: number;
  coordinatorEpoch: number;
  actorId: ParticipantId;
  spec: SessionEventSpec;
  previousHash: string | null;
}): Promise<OrderedEvent> => {
  const unsigned: Omit<OrderedEvent, "eventHash"> = {
    eventId: input.eventId,
    tableId: input.tableId,
    gameId: input.gameId,
    seq: input.seq,
    coordinatorEpoch: input.coordinatorEpoch,
    actorId: input.actorId,
    type: input.spec.type,
    payload: input.spec.payload as never,
    previousHash: input.previousHash,
  };
  return { ...unsigned, eventHash: await hashOrderedEvent(unsigned) };
};
