import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ComputerTerminal01Icon,
  PlayIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getToken } from "../api.js";
import { ErrorAlert } from "./common/ErrorAlert.js";
import { PageHeader } from "./common/PageHeader.js";

type Status = "idle" | "connecting" | "open" | "closed" | "error";

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  idle: "outline",
  connecting: "secondary",
  open: "default",
  closed: "outline",
  error: "destructive",
};

const STATUS_LABEL: Record<Status, string> = {
  idle: "Not started",
  connecting: "Connecting…",
  open: "Connected",
  closed: "Disconnected",
  error: "Error",
};

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
      setErr("Not signed in");
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
    <>
      <PageHeader
        title="Terminal"
        description="Interactive bash session over WebSocket."
      />

      <Alert variant="destructive">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
        <AlertTitle>Shell access</AlertTitle>
        <AlertDescription>
          Opens an interactive bash as the <code className="rounded bg-muted px-1">frame</code> user
          on the device. The <code className="rounded bg-muted px-1">frame</code> account has a narrow
          sudoers fragment (<code className="rounded bg-muted px-1">deploy/sudoers.d/frame</code>)
          that grants passwordless root for a small set of commands; anyone holding the bearer token
          effectively has that same access. Rotate the token after sharing.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <HugeiconsIcon icon={ComputerTerminal01Icon} strokeWidth={2} className="size-4" />
              Session
            </CardTitle>
            <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {err && <ErrorAlert message={err} onDismiss={() => setErr(null)} />}
          <div className="flex items-center gap-2">
            {!running ? (
              <Button onClick={start}>
                <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                Start shell
              </Button>
            ) : (
              <Button variant="destructive" onClick={stop}>
                <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                Disconnect
              </Button>
            )}
          </div>
          <div
            ref={hostRef}
            className="rounded-md border border-border/60 bg-[#0c0d10] p-2"
            style={{ width: "100%", height: "28rem", boxSizing: "border-box" }}
          />
        </CardContent>
      </Card>
    </>
  );
}
