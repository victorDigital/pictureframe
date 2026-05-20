import { useEffect, useRef, useState } from "react";
import { api, getToken } from "../api.js";

type State = {
  version: string;
  safe_mode: boolean;
  safe_mode_info: { reason: string; details?: unknown } | null;
  device: string;
  active: string | null;
  claims: Array<{
    claimId: string;
    screenId: string;
    source: string;
    priority: number;
    expiresAt?: number;
    label?: string;
  }>;
  brightness: number | null;
};

export function NowSection() {
  const [state, setState] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  async function refresh() {
    try {
      setState(await api<State>("/api/state"));
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    refresh();

    // Subscribe to /api/events for live push. The full refresh above seeds
    // the initial view; subsequent activate / release events arrive inline.
    // Reconnects on close with exponential backoff capped at 30 s.
    let cancelled = false;
    let backoffMs = 1000;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (cancelled) return;
      const token = getToken();
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/api/events?token=${encodeURIComponent(token ?? "")}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        backoffMs = 1000;
        // On (re)connect, fetch the authoritative state in case we missed events.
        void refresh();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as {
            type?: string;
            payload?: {
              active: string | null;
              claims: State["claims"];
              brightness?: number | null;
            };
          };
          if (msg.type !== "state" || !msg.payload) return;
          const p = msg.payload;
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  active: p.active,
                  claims: p.claims,
                  brightness: p.brightness ?? prev.brightness,
                }
              : prev,
          );
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        const delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, 30_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    // Fallback polling at a relaxed cadence in case the WS keeps failing.
    const t = setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  async function release(claimId: string) {
    await api(`/api/claims/${claimId}`, { method: "DELETE" });
    refresh();
  }

  if (err) return <div className="banner">{err}</div>;
  if (!state) return <div className="tile">Loading…</div>;

  return (
    <>
      {state.safe_mode && (
        <div className="banner">
          <div>
            <strong>Safe mode active.</strong> Configuration validation failed.
          </div>
          {state.safe_mode_info && (
            <div style={{ marginTop: "0.5rem" }}>
              Reason: <code>{state.safe_mode_info.reason}</code>
              {state.safe_mode_info.details != null && (
                <pre
                  style={{
                    marginTop: "0.5rem",
                    background: "rgba(0,0,0,0.3)",
                    padding: "0.5rem",
                    fontSize: "0.8rem",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {typeof state.safe_mode_info.details === "string"
                    ? state.safe_mode_info.details
                    : JSON.stringify(state.safe_mode_info.details, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
      <div className="tile">
        <h2>Now showing</h2>
        <div className="row">
          <div style={{ fontSize: "1.5rem" }}>{state.active ?? "—"}</div>
          <div style={{ color: "var(--muted)", marginLeft: "auto" }}>
            {state.device} · v{state.version}
          </div>
        </div>
      </div>
      <div className="tile">
        <h2>Active claims</h2>
        {state.claims.length === 0 && <p>No claims.</p>}
        {state.claims.map((c) => (
          <div key={c.claimId} className="row" style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}>
            <span>{c.screenId}</span>
            <span style={{ color: "var(--muted)" }}>{c.source} (prio {c.priority})</span>
            {c.expiresAt && (
              <span style={{ color: "var(--muted)" }}>
                expires {new Date(c.expiresAt).toLocaleString()}
              </span>
            )}
            <span style={{ marginLeft: "auto" }}>
              {c.source !== "default" && (
                <button className="secondary" onClick={() => release(c.claimId)}>
                  Release
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
