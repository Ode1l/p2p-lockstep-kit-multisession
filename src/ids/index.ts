import { failure, success, type Result } from "../shared/result";

declare const identifierBrand: unique symbol;
type Identifier<Name extends string> = string & {
  readonly [identifierBrand]: Name;
};

export type TableId = Identifier<"TableId">;
export type GameId = Identifier<"GameId">;
export type ParticipantId = Identifier<"ParticipantId">;
export type PeerId = Identifier<"PeerId">;
export type SeatId = Identifier<"SeatId">;
export type EventId = Identifier<"EventId">;
export type MessageId = Identifier<"MessageId">;
export type CommandId = Identifier<"CommandId">;
export type ProposalId = Identifier<"ProposalId">;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;

const parseIdentifier = <T extends string>(
  value: unknown,
  label: string,
): Result<T> => {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    return failure(
      `${label} must be 1-128 URL-safe ASCII characters and start with an alphanumeric character`,
    );
  }
  return success(value as T);
};

const createParser = <T extends string>(label: string) => (value: unknown) =>
  parseIdentifier<T>(value, label);

const createConstructor = <T extends string>(label: string) =>
  (value: string): T => {
    const parsed = parseIdentifier<T>(value, label);
    if (!parsed.ok) throw new TypeError(parsed.error);
    return parsed.value;
  };

export const parseTableId = createParser<TableId>("TableId");
export const parseGameId = createParser<GameId>("GameId");
export const parseParticipantId = createParser<ParticipantId>("ParticipantId");
export const parsePeerId = createParser<PeerId>("PeerId");
export const parseSeatId = createParser<SeatId>("SeatId");
export const parseEventId = createParser<EventId>("EventId");
export const parseMessageId = createParser<MessageId>("MessageId");
export const parseCommandId = createParser<CommandId>("CommandId");
export const parseProposalId = createParser<ProposalId>("ProposalId");

export const tableId = createConstructor<TableId>("TableId");
export const gameId = createConstructor<GameId>("GameId");
export const participantId = createConstructor<ParticipantId>("ParticipantId");
export const peerId = createConstructor<PeerId>("PeerId");
export const seatId = createConstructor<SeatId>("SeatId");
export const eventId = createConstructor<EventId>("EventId");
export const messageId = createConstructor<MessageId>("MessageId");
export const commandId = createConstructor<CommandId>("CommandId");
export const proposalId = createConstructor<ProposalId>("ProposalId");
