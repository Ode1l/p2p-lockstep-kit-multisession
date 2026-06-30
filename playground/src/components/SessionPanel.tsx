import type { OrderedEvent, ParticipantId } from "p2p-lockstep-kit-multisession";
import type { TableView } from "../runtime/controller";

interface SessionPanelProps {
  readonly view: TableView;
  readonly busy: boolean;
  readonly onReady: () => void;
  readonly onStart: () => void;
  readonly onRestart: () => void;
  readonly onResume: () => void;
  readonly onTogglePeer?: () => void;
}

const eventLabel = (event: OrderedEvent): string => {
  const actor = String(event.actorId).replace("participant-", "");
  if (event.type === "MEMBERSHIP_JOINED") {
    const joined = String((event.payload as { participantId?: unknown }).participantId ?? actor)
      .replace("participant-", "");
    return `${joined} 加入牌桌`;
  }
  if (event.type === "READY_CHANGED") return `${actor} 更新准备状态`;
  if (event.type === "GAME_STARTED") return "四人就绪，牌局开始";
  if (event.type === "GAME_EVENT") return `${actor} 打出一张牌`;
  if (event.type === "RESTART_PROPOSED") return `${actor} 提议重开`;
  if (event.type === "RESTART_VOTED") return `${actor} 同意重开`;
  if (event.type === "GAME_RESTARTED") return "新一局已创建";
  if (event.type === "GAME_ENDED") return "牌局结束";
  return event.type;
};

const connectionLabel = (connection: string) => {
  if (connection === "connected") return "在线";
  if (connection === "disconnected") return "离线";
  if (connection === "reconnecting") return "重连中";
  if (connection === "connecting") return "连接中";
  return "失败";
};

export function SessionPanel({
  view,
  busy,
  onReady,
  onStart,
  onRestart,
  onResume,
  onTogglePeer,
}: SessionPanelProps) {
  const { snapshot } = view;
  const { state } = snapshot;
  const localReady = state.ready.get(state.localParticipantId) === true;
  const isCoordinator = state.localParticipantId === state.coordinatorId;
  const canStart = isCoordinator && state.phase === "ready";
  const isOffline = state.phase === "offline" || state.phase === "syncing";
  const canRestart = state.phase === "playing" || state.phase === "ended";
  const seatByParticipant = new Map<ParticipantId, string>();
  for (const [seat, participant] of state.seats) {
    if (participant) seatByParticipant.set(participant, String(seat));
  }
  const winds: Record<string, string> = {
    south: "南",
    east: "东",
    north: "北",
    west: "西",
  };

  return (
    <aside className="session-panel">
      <section className="panel-section room-summary">
        <header><h2>会话信息</h2><span>{view.mode === "simulation" ? "本机模拟" : "P2P"}</span></header>
        <dl>
          <div><dt>房间代码</dt><dd>{view.tableCode}</dd></div>
          <div><dt>本机 Peer</dt><dd title={view.localPeerId}>{String(view.localPeerId).slice(0, 16)}</dd></div>
          <div><dt>阶段</dt><dd>{state.phase}</dd></div>
          <div><dt>事件序号</dt><dd>#{state.lastAppliedSeq}</dd></div>
        </dl>
      </section>

      <section className="panel-section participants-panel">
        <header><h2>参与者</h2><span>{state.participants.size}/4</span></header>
        <ul>
          {[...state.seats.entries()].map(([seat, participantId]) => {
            const participant = participantId ? state.participants.get(participantId) : null;
            const connection = participantId
              ? state.connections.get(participantId) ?? "disconnected"
              : "disconnected";
            return (
              <li key={seat}>
                <span className="roster-wind">{winds[String(seat)] ?? String(seat)}</span>
                <span className="roster-name">{participant?.displayName ?? "等待加入"}</span>
                <span className={`roster-status status-${connection}`}>
                  {participant ? connectionLabel(connection) : "空位"}
                </span>
                <span className={`ready-dot${participantId && state.ready.get(participantId) ? " is-ready" : ""}`}>
                  {participantId && state.ready.get(participantId) ? "已准备" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel-section control-panel">
        <header><h2>控制</h2><span>{isCoordinator ? "房主" : "参与者"}</span></header>
        {isOffline ? (
          <button type="button" className="button-primary" disabled={busy} onClick={onResume}>恢复连接</button>
        ) : (
          <>
            <button type="button" disabled={busy || localReady || state.phase === "playing"} onClick={onReady}>
              {localReady ? "已准备" : view.mode === "simulation" ? "模拟全员准备" : "准备就绪"}
            </button>
            <button type="button" className="button-primary" disabled={busy || !canStart} onClick={onStart}>开始游戏</button>
          </>
        )}
        <button type="button" disabled={busy || !canRestart} onClick={onRestart}>全员同意重开</button>
        {onTogglePeer ? (
          <button type="button" className="button-quiet" disabled={busy} onClick={onTogglePeer}>
            {isOffline ? "重连北风" : "模拟北风掉线"}
          </button>
        ) : null}
      </section>

      <section className="panel-section event-panel">
        <header><h2>事件记录</h2><span>{view.events.length}</span></header>
        <ol>
          {view.events.slice(-12).reverse().map((event) => (
            <li key={event.eventId}>
              <time>#{String(event.seq).padStart(2, "0")}</time>
              <span>{eventLabel(event)}</span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
