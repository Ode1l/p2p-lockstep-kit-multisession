import {
  failure,
  success,
  type GameEventSpec,
  type JsonObject,
  type MultiGamePlugin,
  type ParticipantId,
  type Result,
} from "p2p-lockstep-kit-multisession";

export interface MahjongTile extends JsonObject {
  readonly id: string;
  readonly suit: "characters" | "dots" | "bamboo" | "honor";
  readonly rank: number;
  readonly label: string;
}

export interface MahjongDiscard extends JsonObject {
  readonly participantId: ParticipantId;
  readonly tile: MahjongTile;
  readonly turn: number;
}

export interface MahjongSnapshot extends JsonObject {
  readonly order: readonly ParticipantId[];
  readonly hands: Readonly<Record<string, readonly MahjongTile[]>>;
  readonly wall: readonly MahjongTile[];
  readonly wallIndex: number;
  readonly currentParticipantId: ParticipantId;
  readonly discards: readonly MahjongDiscard[];
  readonly turn: number;
}

export type MahjongState = MahjongSnapshot;

export interface MahjongCommand extends JsonObject {
  readonly kind: "discard";
  readonly tileId: string;
}

export interface MahjongEventPayload extends JsonObject {
  readonly tileId: string;
}

const numberLabels = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const honorLabels = ["东", "南", "西", "北", "中", "发", "白"];

const buildWall = (): MahjongTile[] => {
  const wall: MahjongTile[] = [];
  const suited = [
    ["characters", "万"],
    ["dots", "筒"],
    ["bamboo", "索"],
  ] as const;
  for (const [suit, suffix] of suited) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        wall.push({
          id: `${suit}-${rank}-${copy}`,
          suit,
          rank,
          label: `${numberLabels[rank - 1]}${suffix}`,
        });
      }
    }
  }
  for (let rank = 1; rank <= honorLabels.length; rank += 1) {
    for (let copy = 0; copy < 4; copy += 1) {
      wall.push({
        id: `honor-${rank}-${copy}`,
        suit: "honor",
        rank,
        label: honorLabels[rank - 1]!,
      });
    }
  }
  return wall;
};

const cloneState = (state: MahjongState): MahjongState => ({
  ...state,
  order: [...state.order],
  hands: Object.fromEntries(
    Object.entries(state.hands).map(([id, hand]) => [
      id,
      hand.map((tile) => ({ ...tile })),
    ]),
  ),
  wall: state.wall.map((tile) => ({ ...tile })),
  discards: state.discards.map((discard) => ({
    ...discard,
    tile: { ...discard.tile },
  })),
});

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

export const mahjongPlugin: MultiGamePlugin<
  MahjongCommand,
  MahjongEventPayload,
  MahjongState,
  MahjongSnapshot
> = {
  id: "playground.mahjong.discard-cycle",

  parseCommand(input): Result<MahjongCommand> {
    if (
      !isRecord(input) ||
      input.kind !== "discard" ||
      typeof input.tileId !== "string"
    ) {
      return failure("麻将指令必须包含合法的 tileId");
    }
    return success({ kind: "discard", tileId: input.tileId });
  },

  parseEvent(type, payload): Result<MahjongEventPayload> {
    if (
      type !== "mahjong.discard" ||
      !isRecord(payload) ||
      typeof payload.tileId !== "string"
    ) {
      return failure("无效的麻将事件");
    }
    return success({ tileId: payload.tileId });
  },

  createInitialState(input): MahjongState {
    const order = [...input.seats.values()].filter(
      (id): id is ParticipantId => id !== null,
    );
    const wall = buildWall();
    const hands: Record<string, MahjongTile[]> = Object.fromEntries(
      order.map((id) => [id, []]),
    );
    let wallIndex = 0;
    for (let round = 0; round < 13; round += 1) {
      for (const id of order) {
        hands[id]!.push(wall[wallIndex++]!);
      }
    }
    const first = order[0];
    if (!first) throw new Error("麻将需要至少一个已入座参与者");
    hands[first]!.push(wall[wallIndex++]!);
    return {
      order,
      hands,
      wall,
      wallIndex,
      currentParticipantId: first,
      discards: [],
      turn: 1,
    };
  },

  validateCommand(command, context): Result<true> {
    if (context.actorId !== context.state.currentParticipantId) {
      return failure("还没有轮到该玩家");
    }
    const hand = context.state.hands[context.actorId] ?? [];
    return hand.some((tile) => tile.id === command.tileId)
      ? success(true)
      : failure("手牌中不存在这张牌");
  },

  commandToEvents(command): readonly GameEventSpec<MahjongEventPayload>[] {
    return [{ type: "mahjong.discard", payload: { tileId: command.tileId } }];
  },

  validateEvent(event, context): Result<true> {
    if (context.actorId !== context.state.currentParticipantId) {
      return failure("出牌者不是当前玩家");
    }
    const hand = context.state.hands[context.actorId] ?? [];
    return hand.some((tile) => tile.id === event.payload.tileId)
      ? success(true)
      : failure("事件引用了不存在的手牌");
  },

  reduce(state, event, context): MahjongState {
    const hands: Record<string, MahjongTile[]> = Object.fromEntries(
      Object.entries(state.hands).map(([id, hand]) => [id, [...hand]]),
    );
    const hand = hands[context.actorId] ?? [];
    const tileIndex = hand.findIndex((tile) => tile.id === event.payload.tileId);
    const [tile] = hand.splice(tileIndex, 1);
    if (!tile) return state;

    const actorIndex = state.order.indexOf(context.actorId);
    const nextParticipantId = state.order[(actorIndex + 1) % state.order.length]!;
    let wallIndex = state.wallIndex;
    const draw = state.wall[wallIndex];
    if (draw) {
      hands[nextParticipantId]!.push(draw);
      wallIndex += 1;
    }
    return {
      ...state,
      hands,
      wallIndex,
      currentParticipantId: nextParticipantId,
      discards: [
        ...state.discards,
        { participantId: context.actorId, tile, turn: state.turn },
      ],
      turn: state.turn + 1,
    };
  },

  getDecisionWindow(state) {
    return {
      id: `turn-${state.turn}`,
      openedAtSeq: state.turn,
      eligibleParticipantIds: [state.currentParticipantId],
      submittedParticipantIds: [],
      mode: "single",
    };
  },

  getOutcome(state) {
    return state.wallIndex >= state.wall.length
      ? { type: "draw", reason: "牌墙已摸完" }
      : null;
  },

  createSnapshot(state): MahjongSnapshot {
    return cloneState(state);
  },

  restoreSnapshot(snapshot): Result<MahjongState> {
    if (
      !isRecord(snapshot) ||
      !Array.isArray(snapshot.order) ||
      !isRecord(snapshot.hands) ||
      !Array.isArray(snapshot.wall) ||
      !Array.isArray(snapshot.discards) ||
      typeof snapshot.wallIndex !== "number" ||
      typeof snapshot.currentParticipantId !== "string" ||
      typeof snapshot.turn !== "number"
    ) {
      return failure("无效的麻将快照");
    }
    return success(cloneState(snapshot as unknown as MahjongState));
  },
};

export const isMahjongSnapshot = (value: unknown): value is MahjongSnapshot =>
  isRecord(value) &&
  Array.isArray(value.order) &&
  isRecord(value.hands) &&
  Array.isArray(value.wall) &&
  Array.isArray(value.discards) &&
  typeof value.currentParticipantId === "string";
