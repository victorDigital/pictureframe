import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getToken } from "../api.js";

type Status = "idle" | "connecting" | "open" | "closed" | "error";

export function TerminalSection() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => () => disposeAll(), []);

  function disposeAll() {
    try {
      wsRef.current?.close();
    } catch {
      // socket may already be gone
    }
    wsRef.current = null;
    try {
      termRef.current?.dispose();
    } catch {
      // terminal may already be disposed
    }
    termRef.current = null;
    fitRef.current = null;
  }

  function start() {
    const token = getToken();
    if (!token) {
      setErr("not signed in");
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    setErr(null);
    setStatus("connecting");
    setRunning(true);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#0c0d10",
        foreground: "#e6e8ec",
        cursor: "#4f8cff",
      },
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // host may not yet be laid out; the ResizeObserver below catches it
    }
    termRef.current = term;
    fitRef.current = fit;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const cols = term.cols;
    const rows = term.rows;
    const url =
      `${proto}//${location.host}/api/terminal` +
      `?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      term.focus();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      }
    };
    ws.onerror = () => {
      setErr("WebSocket error");
      setStatus("error");
    };
    ws.onclose = () => {
      setStatus("closed");
      setRunning(false);
    };

    term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(new TextEncoder().encode(data));
    });

    const sendResize = () => {
      if (!termRef.current || !fitRef.current) return;
      try {
        fitRef.current.fit();
      } catch {
        // ignore — host may have zero dims briefly during layout
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: termRef.current.cols,
          rows: termRef.current.rows,
        }),
      );
    };
    const obs = new ResizeObserver(sendResize);
    obs.observe(host);
    ws.addEventListener("close", () => obs.disconnect());
  }

  function stop() {
    try {
      wsRef.current?.close();
    } catch {
      // socket may already be gone
    }
    disposeAll();
    setRunning(false);
    setStatus("closed");
  }

  return (
    <div className="tile">
      <h2>Terminal</h2>
      <div
        className="banner"
        style={{
          background: "rgba(255, 111, 111, 0.12)",
          color: "var(--danger)",
          marginBottom: "0.75rem",
        }}
      >
        Warning: Shell access — opens an interactive bash as the <code>frame</code> user on
        the device. The <code>frame</code> account has a narrow sudoers fragment
        (<code>deploy/sudoers.d/frame</code>) that grants passwordless root for a small set
        of commands; anyone holding the bearer token effectively has that same access.
        Rotate the token after sharing.
      </div>
      {err && <div className="banner">{err}</div>}
      <div className="row" style={{ marginBottom: "0.75rem" }}>
        {!running ? (
          <button className="primary" onClick={start}>
            Start shell
          </button>
        ) : (
          <button className="danger" onClick={stop}>
            Disconnect
          </button>
        )}
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          {status === "connecting" && "Connecting…"}
          {status === "open" && "Connected"}
          {status === "closed" && "Disconnected"}
          {status === "error" && "Error"}
          {status === "idle" && "Not started"}
        </span>
      </div>
      <div
        ref={hostRef}
        style={{
          width: "100%",
          height: "28rem",
          background: "#0c0d10",
          border: "1px solid var(--border)",
          borderRadius: "0.4rem",
          padding: "0.5rem",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
