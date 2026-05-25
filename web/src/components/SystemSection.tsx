import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PowerIcon,
  RefreshIcon,
  Sun01Icon,
  ViewIcon,
  ViewOffIcon,
  Alert02Icon,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "../api.js";
import { ConfirmButton } from "./common/ConfirmButton.js";
import { ErrorAlert } from "./common/ErrorAlert.js";
import { PageHeader } from "./common/PageHeader.js";

const SUBSYSTEMS = ["api", "updater", "scheduler", "mqtt", "cdp", "config", "vnc"] as const;
const UNITS = ["frame-core", "frame-kiosk"] as const;
type Unit = (typeof UNITS)[number];

export function SystemSection() {
  const [brightness, setBrightness] = useState<number>(60);
  const [err, setErr] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsErr, setLogsErr] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("frame-core");
  const [subsystem, setSubsystem] = useState<string>("__all__");

  useEffect(() => {
    api<{ value: number }>("/api/system/brightness")
      .then((b) => setBrightness(b.value))
      .catch((e) => setErr(String(e instanceof Error ? e.message : e)));
  }, []);

  async function refreshLogs() {
    const qs = new URLSearchParams({ lines: "200", unit });
    if (unit === "frame-core" && subsystem !== "__all__") qs.set("subsystem", subsystem);
    try {
      const r = await api<{ lines: string[] }>(`/api/logs?${qs}`);
      setLogs(r.lines);
      setLogsErr(null);
    } catch (e) {
      setLogsErr(String(e instanceof Error ? e.message : e));
    }
  }
  useEffect(() => {
    refreshLogs();
    const t = setInterval(refreshLogs, 5000);
    return () => clearInterval(t);
  }, [unit, subsystem]);

  async function commit(v: number) {
    setBrightness(v);
    try {
      await api("/api/system/brightness", {
        method: "PUT",
        body: JSON.stringify({ value: v }),
      });
    } catch (e) {
      toast.error(`Brightness: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function reboot() {
    try {
      await api("/api/system/reboot", { method: "POST" });
      toast.success("Reboot requested");
    } catch (e) {
      toast.error(`Reboot failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function display(state: "on" | "off") {
    try {
      await api(`/api/system/display/${state}`, { method: "POST" });
      toast.success(`Display ${state}`);
    } catch (e) {
      toast.error(`Display: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <>
      <PageHeader
        title="System"
        description="Hardware controls and service logs."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={Sun01Icon} strokeWidth={2} className="size-4" />
            Display
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {err && <ErrorAlert message={err} onDismiss={() => setErr(null)} />}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Brightness</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {brightness}%
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[brightness]}
              onValueChange={(v) => setBrightness(v[0] ?? brightness)}
              onValueCommit={(v) => commit(v[0] ?? brightness)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => display("on")}>
              <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
              Display on
            </Button>
            <Button variant="outline" size="sm" onClick={() => display("off")}>
              <HugeiconsIcon icon={ViewOffIcon} strokeWidth={2} />
              Display off
            </Button>
            <ConfirmButton
              variant="destructive"
              size="sm"
              destructive
              className="ml-auto"
              title="Reboot the device?"
              description="The frame will be offline for ~1 minute while the OS restarts."
              confirmLabel="Reboot"
              onConfirm={reboot}
            >
              <HugeiconsIcon icon={PowerIcon} strokeWidth={2} />
              Reboot
            </ConfirmButton>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-muted-foreground">
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4" />
                Logs
              </CardTitle>
              <CardDescription>Auto-refreshes every 5 seconds.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refreshLogs}>
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {logsErr && <ErrorAlert message={logsErr} />}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Unit</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Subsystem</Label>
              <Select
                value={subsystem}
                onValueChange={setSubsystem}
                disabled={unit !== "frame-core"}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">all subsystems</SelectItem>
                  {SUBSYSTEMS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge variant="outline" className="ml-auto tabular-nums">
              {logs.length} lines
            </Badge>
          </div>
          <ScrollArea className="h-96 rounded-md border border-border/60 bg-muted/40">
            <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
              {logs.length === 0 ? "(no log lines)" : logs.join("\n")}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>
    </>
  );
}
