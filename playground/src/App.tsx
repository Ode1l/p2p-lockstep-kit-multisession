import { useCallback, useEffect, useState } from "react";
import { ActionBar } from "./components/ActionBar";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { MahjongTable, currentParticipantName } from "./components/MahjongTable";
import { SessionPanel } from "./components/SessionPanel";
import {
  LiveTableController,
  LocalTableController,
  type LiveSetup,
  type TableController,
  type TableView,
} from "./runtime/controller";

export function App() {
  const [controller, setController] = useState<TableController | null>(null);
  const [view, setView] = useState<TableView | null>(null);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const attachController = useCallback((next: TableController) => {
    setController((current) => {
      current?.dispose();
      return next;
    });
    setView(null);
    next.subscribe((nextView) => {
      setView(nextView);
      setSelectedTileId((selected) => {
        const local = nextView.snapshot.state.localParticipantId;
        const hand = nextView.snapshot.game?.hands[local] ?? [];
        return hand.some((tile) => tile.id === selected) ? selected : null;
      });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void LocalTableController.create()
      .then((next) => {
        if (cancelled) return next.dispose();
        attachController(next);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "初始化失败"))
      .finally(() => setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [attachController]);

  useEffect(() => () => controller?.dispose(), [controller]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const connectLive = (setup: LiveSetup) => {
    void run(async () => {
      const next = await LiveTableController.create(setup);
      attachController(next);
      setDialogOpen(false);
    });
  };

  const resetSimulation = () => {
    void run(async () => attachController(await LocalTableController.create()));
  };

  if (!view || !controller) {
    return (
      <main className="loading-screen">
        <span className="brand-tile">南</span>
        <h1>四方牌局</h1>
        <p>{error ?? "正在创建四人牌桌…"}</p>
      </main>
    );
  }

  const phase = view.snapshot.state.phase;
  const isOffline = phase === "offline" || phase === "syncing";
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-tile">南</span><strong>四方牌局</strong></div>
        <div className="topbar-meta">
          <span>房间 · {view.tableCode}</span>
          <span>东 1 局</span>
          <span>第 {view.snapshot.game?.turn ?? 0} 巡</span>
        </div>
        <div className="topbar-actions">
          <span className={`network-health${isOffline ? " is-offline" : ""}`}><i />{isOffline ? "全桌暂停" : `在线 ${view.snapshot.state.participants.size}/4`}</span>
          <button type="button" onClick={() => setDialogOpen(true)}>连接 P2P</button>
          {view.mode === "p2p" ? <button type="button" onClick={resetSimulation}>本机演示</button> : null}
        </div>
      </header>

      <main className="game-layout">
        <div className="game-stage">
          <div className="turn-banner">
            <span>{phase === "playing" ? `轮到 ${currentParticipantName(view.snapshot)}` : "四人麻将会话演示"}</span>
            <small>{error ?? view.error ?? (phase === "playing" ? "选择一张手牌出牌" : "准备、开局、掉线和重连都由 multisession 驱动")}</small>
          </div>
          <MahjongTable snapshot={view.snapshot} selectedTileId={selectedTileId} onSelectTile={setSelectedTileId} />
          <ActionBar
            snapshot={view.snapshot}
            selectedTileId={selectedTileId}
            busy={busy}
            onDiscard={() => selectedTileId && void run(() => controller.discard(selectedTileId))}
          />
        </div>
        <SessionPanel
          view={view}
          busy={busy}
          onReady={() => void run(() => controller.ready())}
          onStart={() => void run(() => controller.start())}
          onRestart={() => void run(() => controller.restart())}
          onResume={() => void run(() => controller.resume())}
          {...(controller.togglePeer ? { onTogglePeer: () => void run(() => controller.togglePeer!()) } : {})}
        />
      </main>

      <ConnectionDialog
        open={dialogOpen}
        busy={busy}
        error={error}
        onClose={() => setDialogOpen(false)}
        onConnect={connectLive}
      />
    </div>
  );
}
