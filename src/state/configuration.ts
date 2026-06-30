import type { SeatId } from "../ids";
import { failure, success, type Result } from "../shared/result";
import {
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  type SessionConfiguration,
} from "./types";

export const createSessionConfiguration = (input: {
  participantCount: number;
  seatIds: readonly SeatId[];
}): Result<SessionConfiguration> => {
  if (
    !Number.isInteger(input.participantCount) ||
    input.participantCount < MIN_PARTICIPANTS ||
    input.participantCount > MAX_PARTICIPANTS
  ) {
    return failure(
      `participantCount must be an integer between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS}`,
    );
  }
  if (input.seatIds.length !== input.participantCount) {
    return failure("seatIds length must equal participantCount");
  }
  if (new Set(input.seatIds).size !== input.seatIds.length) {
    return failure("seatIds must be unique");
  }
  return success({
    participantCount: input.participantCount,
    seatIds: Object.freeze([...input.seatIds]),
  });
};
