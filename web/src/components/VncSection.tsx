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
  const [show, setShow] = useState(false);

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
      setShow(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setShow(false);
    await api("/api/vnc/stop", { method: "POST" });
    setBusy(false);
    refresh();
  }

  const vncUrl =
    status?.running && status.wsPort
      ? `/vnc.html?host=${location.hostname}&port=${status.wsPort}`
      : null;

  return (
    <div className="tile">
      <h2>Remote screen (VNC)</h2>
      {err && <div className="banner">{err}</div>}
      {!status ? (
        "Loading…"
      ) : status.running ? (
        <>
          <p style={{ color: "var(--muted)" }}>
            Running since {new Date(status.startedAt!).toLocaleString()}. Auto-stops after
            15 min idle (SPEC §8.3).
          </p>
          <div className="row" style={{ marginBottom: "1rem" }}>
            <button className="primary" onClick={() => setShow((v) => !v)}>
              {show ? "Hide viewer" : "Open viewer"}
            </button>
            <a
              className="secondary"
              href={vncUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                padding: "0.4rem 0.9rem",
                borderRadius: "0.4rem",
                textDecoration: "none",
              }}
            >
              Open in new tab
            </a>
            <button className="danger" onClick={stop} disabled={busy} style={{ marginLeft: "auto" }}>
              Stop
            </button>
          </div>
          {show && vncUrl && (
            <iframe
              src={vncUrl}
              title="VNC viewer"
              style={{
                width: "100%",
                aspectRatio: "16 / 10",
                border: "1px solid var(--border)",
                borderRadius: "0.4rem",
                background: "#000",
              }}
              allow="clipboard-read; clipboard-write"
            />
          )}
        </>
      ) : (
        <>
          <p>
            Starts wayvnc and websockify on demand. The bundled noVNC client connects to
            <code style={{ marginLeft: "0.25rem" }}>
              ws://{location.hostname}:{status.wsPort}
            </code>
            ; nothing runs while idle.
          </p>
          <button className="primary" onClick={start} disabled={busy}>
            Start VNC
          </button>
        </>
      )}
    </div>
  );
}
