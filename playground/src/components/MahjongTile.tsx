import type { MahjongTile as Tile } from "../game/mahjong";

interface MahjongTileProps {
  readonly tile: Tile;
  readonly selected?: boolean;
  readonly compact?: boolean;
  readonly onClick?: () => void;
}

export function MahjongTile({
  tile,
  selected = false,
  compact = false,
  onClick,
}: MahjongTileProps) {
  const content = (
    <>
      <span className="tile-label">{tile.label}</span>
      <span className="tile-index">{tile.rank}</span>
    </>
  );
  const className = [
    "mahjong-tile",
    `tile-${tile.suit}`,
    selected ? "is-selected" : "",
    compact ? "is-compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return onClick ? (
    <button
      type="button"
      className={className}
      aria-pressed={selected}
      aria-label={`选择 ${tile.label}`}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span className={className}>{content}</span>
  );
}

export function TileBack({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className={`tile-back${compact ? " is-compact" : ""}`} aria-hidden="true">
      <span />
    </span>
  );
}
