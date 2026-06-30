import type { MultiSessionSnapshot, ParticipantId, SeatId } from "p2p-lockstep-kit-multisession";
import type { MahjongSnapshot } from "../game/mahjong";
import { MahjongTile, TileBack } from "./MahjongTile";

interface MahjongTableProps {
  readonly snapshot: MultiSessionSnapshot<MahjongSnapshot>;
  readonly selectedTileId: string | null;
  readonly onSelectTile: (tileId: string) => void;
}

const seatNames: Record<string, string> = {
  south: "南",
  east: "东",
  north: "北",
  west: "西",
};

const seatClass = (seat: SeatId) => `seat-${String(seat)}`;

export function MahjongTable({
  snapshot,
  selectedTileId,
  onSelectTile,
}: MahjongTableProps) {
  const { state, game } = snapshot;
  const participantForSeat = (seat: SeatId) => {
    const id = state.seats.get(seat);
    return id ? state.participants.get(id) ?? null : null;
  };
  const localHand = game?.hands[state.localParticipantId] ?? [];
  const wallRemaining = game ? game.wall.length - game.wallIndex : 136;

  return (
    <section className="table-frame" aria-label="四人麻将桌">
      <div className="felt-table">
        {[...state.seats.keys()].map((seat) => {
          const participant = participantForSeat(seat);
          const participantId = participant?.id;
          const connection = participantId
            ? state.connections.get(participantId) ?? "disconnected"
            : "disconnected";
          const isCurrent = game?.currentParticipantId === participantId;
          const isLocal = participantId === state.localParticipantId;
          return (
            <div className={`player-seat ${seatClass(seat)}${isCurrent ? " is-current" : ""}`} key={seat}>
              <span className="wind-mark">{seatNames[String(seat)] ?? String(seat)}</span>
              <span className="player-copy">
                <strong>{participant?.displayName ?? "等待加入"}</strong>
                <small className={`connection-${connection}`}>
                  {participant ? (connection === "connected" ? "在线" : connection) : "空位"}
                </small>
              </span>
              {isLocal ? <span className="dealer-mark">庄</span> : null}
            </div>
          );
        })}

        <div className="opponent-hand opponent-north" aria-hidden="true">
          {Array.from({ length: 13 }, (_, index) => <TileBack compact key={index} />)}
        </div>
        <div className="opponent-hand opponent-west" aria-hidden="true">
          {Array.from({ length: 13 }, (_, index) => <TileBack compact key={index} />)}
        </div>
        <div className="opponent-hand opponent-east" aria-hidden="true">
          {Array.from({ length: 13 }, (_, index) => <TileBack compact key={index} />)}
        </div>

        <div className="table-center">
          <div className="discard-river" aria-label="牌河">
            {(game?.discards ?? []).slice(-20).map((discard) => (
              <MahjongTile compact key={`${discard.turn}-${discard.tile.id}`} tile={discard.tile} />
            ))}
          </div>
          <div className="round-dial">
            <strong>东 1 局</strong>
            <span>余 {wallRemaining}</span>
          </div>
        </div>

        <div className="local-hand" aria-label="你的手牌">
          {localHand.length > 0 ? (
            localHand.map((tile) => (
              <MahjongTile
                key={tile.id}
                tile={tile}
                selected={selectedTileId === tile.id}
                onClick={() => onSelectTile(tile.id)}
              />
            ))
          ) : (
            <p className="hand-placeholder">
              {state.phase === "playing" ? "等待同步手牌" : "四人就座并准备后开始发牌"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export const currentParticipantName = (
  snapshot: MultiSessionSnapshot<MahjongSnapshot>,
): string => {
  const current = snapshot.game?.currentParticipantId as ParticipantId | undefined;
  return current ? snapshot.state.participants.get(current)?.displayName ?? String(current) : "等待开局";
};
