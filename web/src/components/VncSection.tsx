import { useEffect, useState } from "react";
import { api } from "../api.js";

type VncStatus = {
  running: boolean;
  startedAt?: number;
  wsUrl?: string;
  wsPort: number;
  vncPort: number;
};

export function VncSection() {
  const [status, setStatus] = useState<VncStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setStatus(await api<VncStatus>("/api/vnc/status"));
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  async function start() {
    setBusy(true);
    try {
      const s = await api<VncStatus>("/api/vnc/start", { method: "POST" });
      setStatus(s);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    await api("/api/vnc/stop", { method: "POST" });
    setBusy(false);
    refresh();
  }

  return (
    <div className="tile">
      <h2>Remote screen (VNC)</h2>
      {err && <div className="banner">{err}</div>}
      {!status ? (
        "Loading…"
      ) : status.running ? (
        <>
          <p>
            Running since {new Date(status.startedAt!).toLocaleString()}. Auto-stops after
            15 min idle (SPEC §8.3).
          </p>
          <p>
            WebSocket: <code>ws://frame.local:{status.wsPort}</code>
          </p>
          <p style={{ color: "var(--muted)" }}>
            If <code>/usr/share/novnc</code> is installed on the device, point a browser at
            <a href={`http://${location.hostname}:${status.wsPort}/vnc.html?path=`}> noVNC</a>.
          </p>
          <div className="row" style={{ marginTop: "1rem" }}>
            <button className="danger" onClick={stop} disabled={busy}>
              Stop
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Idle. Starts wayvnc + websockify on demand and stops them after 15 min of idle.</p>
          <button className="primary" onClick={start} disabled={busy}>
            Start VNC
          </button>
        </>
      )}
    </div>
  );
}
