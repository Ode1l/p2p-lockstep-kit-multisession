import { describe, expect, it } from "vitest";
import {
  gameId,
  messageId,
  parseProtocolMessage,
  participantId,
  peerId,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  tableId,
} from "../src";

const validHello = () => ({
  protocol: PROTOCOL_NAME,
  version: PROTOCOL_VERSION,
  messageId: messageId("message-1"),
  type: "MESH_HELLO",
  tableId: tableId("table-1"),
  gameId: gameId("game-1"),
  senderParticipantId: participantId("participant-1"),
  senderPeerId: peerId("peer-1"),
  payload: { lastAppliedSeq: 0, eventHash: null },
});

describe("protocol runtime validation", () => {
  it("parses a valid discriminated message", () => {
    expect(parseProtocolMessage(validHello())).toMatchObject({
      ok: true,
      value: { type: "MESH_HELLO" },
    });
  });

  it.each([
    ["wrong protocol", { protocol: "other" }],
    ["wrong version", { version: 2 }],
    ["unknown type", { type: "UNKNOWN" }],
    ["malformed payload", { payload: { lastAppliedSeq: -1, eventHash: null } }],
    ["missing participant", { senderParticipantId: null }],
  ])("rejects %s", (_label, replacement) => {
    expect(parseProtocolMessage({ ...validHello(), ...replacement }).ok).toBe(false);
  });

  it("rejects malformed JSON without throwing", () => {
    expect(parseProtocolMessage("{broken")).toEqual({
      ok: false,
      error: "message is not valid JSON",
    });
  });
});
