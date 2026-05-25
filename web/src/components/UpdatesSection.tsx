import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowReloadHorizontalIcon,
  Cancel01Icon,
  Download01Icon,
  FlashIcon,
  Loading03Icon,
  RefreshIcon,
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
import { api } from "../api.js";
import { ConfirmButton } from "./common/ConfirmButton.js";
import { ErrorAlert } from "./common/ErrorAlert.js";
import { PageHeader } from "./common/PageHeader.js";

type Snapshot = { from: string; to: string; at: string; name: string };
type QuarantinedTag = { tag: string; at: string; reason: string };

type Status = {
  current: string;
  available?: { tag: string; firstSeenAt: string; appliedAfter: string; prerelease: boolean };
  lastResult?: string;
  lastError?: string;
  busy: boolean;
  channel: string;
  autoApply: boolean;
};

export function UpdatesSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [quarantined, setQuarantined] = useState<QuarantinedTag[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [s, snap, q] = await Promise.all([
        api<Status>("/api/updates"),
        api<{ snapshots: Snapshot[] }>("/api/updates/snapshots"),
        api<{ quarantined: QuarantinedTag[] }>("/api/updates/quarantine"),
      ]);
      setStatus(s);
      setSnapshots(snap.snapshots);
      setQuarantined(q.quarantined);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  async function clearQuarantine(tag?: string) {
    const target = tag
      ? `/api/updates/quarantine/${encodeURIComponent(tag)}`
      : "/api/updates/quarantine";
    try {
      await api(target, { method: "DELETE" });
      toast.success(tag ? `Cleared ${tag}` : "Quarantine cleared");
      refresh();
    } catch (e) {
      toast.error(`Clear failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function check() {
    setBusy(true);
    try {
      await api("/api/updates/check", { method: "POST" });
      toast.success("Update check kicked off");
    } catch (e) {
      toast.error(`Check failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function apply(force: boolean) {
    setBusy(true);
    try {
      await api(force ? "/api/updates/apply_force" : "/api/updates/apply", {
        method: "POST",
      });
      toast.success(force ? "Force-apply started" : "Apply started");
    } catch (e) {
      toast.error(`Apply failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function rollback() {
    setBusy(true);
    try {
      await api("/api/updates/rollback", { method: "POST" });
      toast.success("Rollback started");
    } catch (e) {
      toast.error(`Rollback failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (err && !status) return <ErrorAlert message={err} onDismiss={() => setErr(null)} />;

  if (!status) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground">
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" />
          Loading…
        </CardContent>
      </Card>
    );
  }

  const appliedAfter = status.available ? new Date(status.available.appliedAfter) : null;
  const stagingActive = appliedAfter && appliedAfter > new Date();

  return (
    <>
      <PageHeader
        title="Updates"
        description={`Channel ${status.channel}${status.autoApply ? " · auto-apply on" : ""}`}
        actions={
          <Button variant="outline" size="sm" onClick={check} disabled={busy}>
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
            Check now
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-4" />
            Release
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
            <span className="text-muted-foreground">Current</span>
            <span className="font-mono font-medium">{status.current}</span>
            <span className="text-muted-foreground">Channel</span>
            <span><Badge variant="outline">{status.channel}</Badge></span>
          </div>
          {status.available ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Available</span>
                <span className="font-mono font-medium">{status.available.tag}</span>
                {status.available.prerelease && (
                  <Badge variant="secondary">prerelease</Badge>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">
                first seen {new Date(status.available.firstSeenAt).toLocaleString()} · applies after{" "}
                {appliedAfter?.toLocaleString()}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No newer release on this channel.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ConfirmButton
              title="Apply update now?"
              description={
                status.available
                  ? `Frame will restart onto ${status.available.tag}. Config is snapshotted automatically.`
                  : undefined
              }
              confirmLabel="Apply"
              disabled={!status.available || busy || Boolean(stagingActive)}
              onConfirm={() => apply(false)}
            >
              <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
              Update now
            </ConfirmButton>
            <ConfirmButton
              variant="outline"
              destructive
              title="Force apply now?"
              description="Skips the staging delay. Only do this if you understand the risk."
              confirmLabel="Force apply"
              disabled={!status.available || busy}
              onConfirm={() => apply(true)}
            >
              <HugeiconsIcon icon={FlashIcon} strokeWidth={2} />
              Force update
            </ConfirmButton>
            <ConfirmButton
              variant="destructive"
              destructive
              className="ml-auto"
              title="Roll back to previous release?"
              description="Config snapshots will be restored. Frame restarts onto the prior version."
              confirmLabel="Roll back"
              disabled={busy}
              onConfirm={rollback}
            >
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} />
              Roll back
            </ConfirmButton>
          </div>
          {status.lastResult && (
            <p className="text-xs text-muted-foreground">
              Last result: <span className="text-foreground">{status.lastResult}</span>
              {status.lastError && ` — ${status.lastError}`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4" />
            Quarantined releases
          </CardTitle>
          <CardDescription>
            Failed applies land here and are skipped by the poller until cleared (SPEC §5.5).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {quarantined.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No releases are quarantined.</p>
          ) : (
            <div className="space-y-2">
              <div className="divide-y divide-border/60">
                {quarantined.map((q) => (
                  <div
                    key={q.tag}
                    className="flex items-center gap-3 py-2 first:pt-0"
                  >
                    <div className="flex-1">
                      <div className="font-mono font-medium">{q.tag}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(q.at).toLocaleString()} — {q.reason}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => clearQuarantine(q.tag)}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                      Clear
                    </Button>
                  </div>
                ))}
              </div>
              <ConfirmButton
                variant="destructive"
                size="sm"
                destructive
                title="Clear all quarantined releases?"
                description="The poller will retry every quarantined tag on its next cycle."
                confirmLabel="Clear all"
                onConfirm={() => clearQuarantine()}
              >
                Clear all
              </ConfirmButton>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground">Snapshots</CardTitle>
          <CardDescription>Config snapshots created on each apply.</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              No snapshots yet — they're created on apply.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {snapshots.map((s) => (
                <div key={s.name} className="flex items-center gap-3 py-2 first:pt-0">
                  <div className="flex-1">
                    <div className="font-mono text-xs">
                      <code>{s.from}</code>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <code>{s.to}</code>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(s.at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
