import { useState, type FormEvent } from "react";
import { DEFAULT_SIGNAL_URL, type LiveSetup } from "../runtime/controller";

interface ConnectionDialogProps {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConnect: (setup: LiveSetup) => void;
}

export function ConnectionDialog({
  open,
  busy,
  error,
  onClose,
  onConnect,
}: ConnectionDialogProps) {
  const [signalUrl, setSignalUrl] = useState(DEFAULT_SIGNAL_URL);
  const [tableCode, setTableCode] = useState("MAHJONG-01");
  const [displayName, setDisplayName] = useState("牌友");
  const [coordinatorPeerId, setCoordinatorPeerId] = useState("");

  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConnect({ signalUrl, tableCode, displayName, coordinatorPeerId });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="connection-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><h2>连接真实 P2P 牌桌</h2><p>房主留空房主 Peer；加入者粘贴房主 Peer。</p></div>
          <button type="button" className="dialog-close" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <label>Signaling URL<input required value={signalUrl} onChange={(event) => setSignalUrl(event.target.value)} /></label>
        <div className="dialog-row">
          <label>房间代码<input required value={tableCode} onChange={(event) => setTableCode(event.target.value)} /></label>
          <label>显示名称<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        </div>
        <label>房主 Peer ID（创建房间时留空）<input value={coordinatorPeerId} onChange={(event) => setCoordinatorPeerId(event.target.value)} placeholder="粘贴房主 Peer ID" /></label>
        {error ? <p className="dialog-error">{error}</p> : null}
        <p className="dialog-note">同一浏览器的普通标签页共享注册身份；测试四人时请使用独立浏览器配置文件。</p>
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={busy}>{busy ? "连接中…" : coordinatorPeerId ? "加入牌桌" : "创建牌桌"}</button>
        </footer>
      </form>
    </div>
  );
}
