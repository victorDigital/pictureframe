import { useEffect, useState } from "react";
import { api } from "../api.js";

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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setStatus(await api<Status>("/api/updates"));
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  async function check() {
    setBusy(true);
    await api("/api/updates/check", { method: "POST" });
    setBusy(false);
    refresh();
  }

  async function apply(force: boolean) {
    if (!confirm(force ? "Force apply, overriding staging delay?" : "Apply now?")) return;
    setBusy(true);
    try {
      await api(force ? "/api/updates/apply_force" : "/api/updates/apply", { method: "POST" });
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
    refresh();
  }

  async function rollback() {
    if (!confirm("Roll back to the previous release? Config snapshots will be restored.")) return;
    setBusy(true);
    await api("/api/updates/rollback", { method: "POST" });
    setBusy(false);
    refresh();
  }

  if (err) return <div className="banner">{err}</div>;
  if (!status) return <div className="tile">Loading…</div>;

  const appliedAfter = status.available ? new Date(status.available.appliedAfter) : null;
  const stagingActive = appliedAfter && appliedAfter > new Date();

  return (
    <div className="tile">
      <h2>Updates</h2>
      <div>
        Current: <strong>{status.current}</strong> · channel <code>{status.channel}</code>
        {status.autoApply ? " · auto-apply on" : ""}
      </div>
      <div style={{ marginTop: "0.5rem" }}>
        {status.available ? (
          <>
            Available: <strong>{status.available.tag}</strong>{" "}
            {status.available.prerelease && <em>(prerelease)</em>}
            <div style={{ color: "var(--muted)" }}>
              first seen {new Date(status.available.firstSeenAt).toLocaleString()} · applies after{" "}
              {appliedAfter?.toLocaleString()}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--muted)" }}>No newer release on this channel.</span>
        )}
      </div>
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="secondary" onClick={check} disabled={busy}>Check now</button>
        <button
          className="primary"
          disabled={!status.available || busy || Boolean(stagingActive)}
          onClick={() => apply(false)}
        >
          Update now
        </button>
        <button
          className="secondary"
          disabled={!status.available || busy}
          onClick={() => apply(true)}
          title="Override staging delay"
        >
          Force update now
        </button>
        <button className="danger" onClick={rollback} disabled={busy} style={{ marginLeft: "auto" }}>
          Roll back
        </button>
      </div>
      {status.lastResult && (
        <div style={{ marginTop: "1rem", color: "var(--muted)" }}>
          Last result: {status.lastResult}
          {status.lastError && ` — ${status.lastError}`}
        </div>
      )}
    </div>
  );
}
