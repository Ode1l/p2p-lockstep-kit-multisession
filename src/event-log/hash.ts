import { parseJsonValue, canonicalizeJson } from "../shared/json";
import type { OrderedEvent } from "./types";

const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
};

export const hashOrderedEvent = async (
  event: Omit<OrderedEvent, "eventHash">,
): Promise<string> => {
  const parsed = parseJsonValue(event);
  if (!parsed.ok) {
    throw new TypeError(`Ordered event is not canonical JSON: ${parsed.error}`);
  }
  return sha256Hex(canonicalizeJson(parsed.value));
};

export const verifyOrderedEventHash = async (
  event: OrderedEvent,
): Promise<boolean> => {
  const { eventHash, ...unsigned } = event;
  return (await hashOrderedEvent(unsigned)) === eventHash;
};
