import {
  eventId,
  gameId,
  messageId,
  type EventId,
  type GameId,
  type MessageId,
} from "../ids";

export interface IdFactory {
  eventId(): EventId;
  messageId(): MessageId;
  gameId(): GameId;
}

export const createIdFactory = (): IdFactory => ({
  eventId: () => eventId(`event-${globalThis.crypto.randomUUID()}`),
  messageId: () => messageId(`message-${globalThis.crypto.randomUUID()}`),
  gameId: () => gameId(`game-${globalThis.crypto.randomUUID()}`),
});
