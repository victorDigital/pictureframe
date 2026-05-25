import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Cancel01Icon,
  Loading03Icon,
  ViewIcon,
  Time03Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { api, getToken } from "../api.js";
import { ErrorAlert } from "./common/ErrorAlert.js";
import { PageHeader } from "./common/PageHeader.js";

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
      setErr(null);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  useEffect(() => {
    refresh();

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
          // ignore malformed event
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

    const t = setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  async function release(claimId: string, screenId: string) {
    try {
      await api(`/api/claims/${claimId}`, { method: "DELETE" });
      toast.success(`Released claim on ${screenId}`);
      refresh();
    } catch (e) {
      toast.error(`Release failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (err && !state) return <ErrorAlert message={err} onDismiss={() => setErr(null)} />;

  if (!state) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground">
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" />
          Loading state…
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Now showing"
        description={`${state.device} · v${state.version}`}
      />

      {state.safe_mode && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Safe mode active</AlertTitle>
          <AlertDescription>
            Configuration validation failed.
            {state.safe_mode_info && (
              <div className="mt-2 space-y-2">
                <div>
                  Reason: <code className="rounded bg-muted px-1 py-0.5">{state.safe_mode_info.reason}</code>
                </div>
                {state.safe_mode_info.details != null && (
                  <pre className="overflow-auto rounded bg-background/50 p-2 text-[10px] whitespace-pre-wrap">
                    {typeof state.safe_mode_info.details === "string"
                      ? state.safe_mode_info.details
                      : JSON.stringify(state.safe_mode_info.details, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={ViewIcon} strokeWidth={2} className="size-4" />
            Active screen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-heading text-2xl font-medium">
            {state.active ?? "—"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={Time03Icon} strokeWidth={2} className="size-4" />
            Claims
          </CardTitle>
          <CardDescription>
            Active claims override the default screen, ordered by priority.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.claims.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">No claims.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {state.claims.map((c) => (
                <div
                  key={c.claimId}
                  className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <span className="font-medium">{c.screenId}</span>
                    <Badge variant="secondary">{c.source}</Badge>
                    <Badge variant="outline">prio {c.priority}</Badge>
                    {c.expiresAt && (
                      <span className="text-xs text-muted-foreground">
                        expires {new Date(c.expiresAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {c.source !== "default" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => release(c.claimId, c.screenId)}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                      Release
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
