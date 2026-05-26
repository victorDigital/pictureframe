import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowExpand01Icon,
  ComputerIcon,
  Loading03Icon,
  PlayIcon,
  StopIcon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api, getToken } from "../api.js";
import { ErrorAlert } from "./common/ErrorAlert.js";
import { PageHeader } from "./common/PageHeader.js";

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
      setErr(String(e instanceof Error ? e.message : e));
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
      toast.success("VNC started");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setShow(false);
    try {
      await api("/api/vnc/stop", { method: "POST" });
      toast.success("VNC stopped");
    } catch (e) {
      toast.error(`Stop failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const vncUrl =
    status?.running && status.wsUrl
      ? `/vnc.html?${new URLSearchParams({
          host: location.hostname,
          port: location.port || (location.protocol === "https:" ? "443" : "80"),
          path: status.wsUrl.replace(/^\//, ""),
          ...(getToken() ? { token: getToken()! } : {}),
        })}`
      : null;

  return (
    <>
      <PageHeader
        title="Remote screen (VNC)"
        description="On-demand wayvnc + websockify for live viewing of the device."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={ComputerIcon} strokeWidth={2} className="size-4" />
            Session
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {err && <ErrorAlert message={err} onDismiss={() => setErr(null)} />}
          {!status ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" />
              Loading…
            </div>
          ) : status.running ? (
            <>
              <CardDescription>
                Running since {new Date(status.startedAt!).toLocaleString()}. Auto-stops after
                15 min idle (SPEC §8.3).
              </CardDescription>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setShow((v) => !v)}>
                  <HugeiconsIcon
                    icon={show ? ViewOffIcon : ViewIcon}
                    strokeWidth={2}
                  />
                  {show ? "Hide viewer" : "Open viewer"}
                </Button>
                <Button variant="outline" asChild>
                  <a href={vncUrl ?? "#"} target="_blank" rel="noreferrer">
                    <HugeiconsIcon icon={ArrowExpand01Icon} strokeWidth={2} />
                    Open in new tab
                  </a>
                </Button>
                <Button
                  variant="destructive"
                  onClick={stop}
                  disabled={busy}
                  className="ml-auto"
                >
                  <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                  Stop
                </Button>
              </div>
              {show && vncUrl && (
                <iframe
                  src={vncUrl}
                  title="VNC viewer"
                  allow="clipboard-read; clipboard-write"
                  className="w-full rounded-md border border-border/60 bg-black"
                  style={{ aspectRatio: "16 / 10" }}
                />
              )}
            </>
          ) : (
            <>
              <CardDescription>
                Starts wayvnc and websockify on demand. The bundled noVNC client connects through{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                  {location.host}/vnc/ws
                </code>
                ; nothing runs while idle.
              </CardDescription>
              <Button onClick={start} disabled={busy}>
                <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                Start VNC
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
