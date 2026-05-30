import { useEffect, useState } from "react";
import type React from "react";
import type { Config } from "../shared";
import { boolValue, isCssColor, Shell, stringValue } from "../shared";

export function EmergencyScreen({ config }: { config: Config }) {
  const [state, setState] = useState<{ reason: string; version: string; safe: string; details: unknown }>({
    reason: stringValue(config.reason, "loading..."),
    version: "-",
    safe: "-",
    details: config.details,
  });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = { ...state };
      try {
        const health = await fetch("/healthz");
        if (health.ok) {
          const body = (await health.json()) as { version?: string; safe_mode?: boolean };
          next.version = body.version ?? "-";
          next.safe = body.safe_mode ? "active" : "off";
          if (body.safe_mode && next.reason === "loading...") next.reason = "safe_mode_active";
        }
      } catch {
        next.version = "unreachable";
        next.safe = "-";
      }
      try {
        const res = await fetch("/api/state");
        if (res.ok) {
          const body = (await res.json()) as { safe_mode_info?: { reason?: string; details?: unknown } };
          if (body.safe_mode_info?.reason) next.reason = body.safe_mode_info.reason;
          if (body.safe_mode_info?.details != null) next.details = body.safe_mode_info.details;
        }
      } catch {
        // use configured fallback
      }
      if (!cancelled) setState(next);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Shell className="overflow-y-auto px-8 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className={`grid size-16 shrink-0 place-items-center rounded-2xl border ${isCssColor(config.accent_color) ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/30 bg-destructive/10 text-destructive"}`} aria-hidden="true">
            <svg className="size-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-destructive">Safe mode</p>
            <h1 className="mt-2 text-title-lg font-semibold tracking-tight">Configuration error</h1>
            <p className="mt-4 max-w-3xl text-body leading-relaxed text-muted-foreground">
              The frame is running in <strong className="font-medium text-foreground">safe mode</strong> because <InlineCode>frame.yaml</InlineCode> or <InlineCode>screens.yaml</InlineCode> failed validation. The web UI on this device is still reachable; fix the config files and restart frame-core, or use the validation view in <em className="text-foreground/90">Settings - Configuration</em>.
            </p>
          </div>
        </header>
        <section className="rounded-xl border border-destructive/30 bg-card p-5 shadow-md">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-title-sm font-medium">Failure reason</span>
            <code className="inline-flex max-w-full items-center rounded-lg bg-muted px-3 py-1.5 font-mono text-sm tabular-nums">{state.reason || "unknown"}</code>
          </div>
          {boolValue(config.show_validation_details, true) ? (
            <div className="mt-5 flex flex-col gap-2">
              <span className="text-eyebrow">Validation details</span>
              {state.details == null ? (
                <p className="text-caption">Open the admin UI Now tab while signed in for the full validation report, or check <code className="font-mono">journalctl -u frame-core</code>.</p>
              ) : (
                <ValidationDetails details={state.details} />
              )}
            </div>
          ) : null}
        </section>
        <section className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
          <Metric label="Frame version" value={state.version} />
          <Metric label="Safe mode" value={state.safe} />
        </section>
        <section className="flex flex-col gap-3 border-t border-border/50 pt-6 text-body text-muted-foreground">
          <p className="text-eyebrow text-foreground/80">How to recover</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>SSH to the device or open the LAN web UI and sign in.</li>
            <li>Inspect <InlineCode>/etc/frame/frame.yaml</InlineCode> and <InlineCode>screens.yaml</InlineCode> (path from <code className="font-mono text-sm">screens_file</code>).</li>
            <li>Run <code className="font-mono text-sm">journalctl -u frame-core -n 80</code> for the boot-time validation log.</li>
            <li>Save valid YAML and restart: <code className="font-mono text-sm">systemctl restart frame-core</code>.</li>
          </ol>
        </section>
      </div>
    </Shell>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">{children}</code>;
}

function ValidationDetails({ details }: { details: unknown }) {
  if (typeof details === "string" || typeof details !== "object" || details == null) {
    return <DetailsPre value={details == null ? "" : String(details)} />;
  }
  const data = details as { formErrors?: unknown; fieldErrors?: unknown };
  const formErrors = Array.isArray(data.formErrors) ? data.formErrors.map(String) : [];
  const fieldErrors = data.fieldErrors && typeof data.fieldErrors === "object" ? Object.entries(data.fieldErrors as Record<string, unknown>) : [];
  if (formErrors.length === 0 && fieldErrors.length === 0) return <DetailsPre value={formatDetailsPlain(details)} />;
  return (
    <div className="flex flex-col gap-3">
      {formErrors.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="text-eyebrow">Form errors</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive/90">
            {formErrors.map((message, index) => <li key={index}>{message}</li>)}
          </ul>
        </div>
      ) : null}
      {fieldErrors.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-eyebrow">Field errors</div>
          <dl className="flex flex-col gap-2">
            {fieldErrors.map(([path, messages]) => (
              <div key={path} className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2">
                <dt className="break-words font-mono text-xs text-destructive">{path}</dt>
                <dd className="mt-1 text-sm text-foreground/85">{Array.isArray(messages) ? messages.map(String).join(" - ") : String(messages)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function DetailsPre({ value }: { value: string }) {
  return <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/50 p-3 font-mono text-xs leading-relaxed text-foreground/90">{value}</pre>;
}

function formatDetailsPlain(details: unknown) {
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl tabular-nums">{value}</div>
    </div>
  );
}
