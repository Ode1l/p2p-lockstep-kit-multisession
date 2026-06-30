import type { MultiSessionSnapshot } from "p2p-lockstep-kit-multisession";
import type { MahjongSnapshot } from "../game/mahjong";

interface ActionBarProps {
  readonly snapshot: MultiSessionSnapshot<MahjongSnapshot>;
  readonly selectedTileId: string | null;
  readonly busy: boolean;
  readonly onDiscard: () => void;
}

export function ActionBar({
  snapshot,
  selectedTileId,
  busy,
  onDiscard,
}: ActionBarProps) {
  const localTurn =
    snapshot.state.phase === "playing" &&
    snapshot.game?.currentParticipantId === snapshot.state.localParticipantId;
  return (
    <div className="action-bar" aria-label="牌局操作">
      <button
        type="button"
        className="action-primary"
        disabled={!localTurn || !selectedTileId || busy}
        onClick={onDiscard}
      >
        出牌
      </button>
      <button type="button" disabled title="动作窗口将在下一轮 demo 接入">碰</button>
      <button type="button" disabled title="动作窗口将在下一轮 demo 接入">杠</button>
      <button type="button" disabled title="胡牌判定将在下一轮 demo 接入">胡</button>
      <button type="button" disabled title="当前为顺序出牌窗口">过</button>
    </div>
  );
}
