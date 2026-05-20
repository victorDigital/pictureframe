import { useEffect, useState } from "react";
import { api } from "../api.js";

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
      setErr(String(e));
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  async function clearQuarantine(tag?: string) {
    const target = tag ? `/api/updates/quarantine/${encodeURIComponent(tag)}` : "/api/updates/quarantine";
    if (!confirm(tag ? `Allow ${tag} to be retried?` : "Clear all quarantined releases?")) return;
    await api(target, { method: "DELETE" });
    refresh();
  }

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
    <>
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

    <div className="tile">
      <h2>Quarantined releases</h2>
      {quarantined.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          No releases are quarantined. Failed applies land here and are skipped by the
          poller until cleared (SPEC §5.5).
        </p>
      ) : (
        <>
          {quarantined.map((q) => (
            <div
              key={q.tag}
              className="row"
              style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}
            >
              <div>
                <div><strong>{q.tag}</strong></div>
                <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                  {new Date(q.at).toLocaleString()} — {q.reason}
                </div>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <button className="secondary" onClick={() => clearQuarantine(q.tag)}>
                  Clear
                </button>
              </div>
            </div>
          ))}
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button className="danger" onClick={() => clearQuarantine()}>
              Clear all
            </button>
          </div>
        </>
      )}
    </div>

    <div className="tile">
      <h2>Snapshots</h2>
      {snapshots.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No snapshots yet — they're created on apply.</p>
      ) : (
        snapshots.map((s) => (
          <div
            key={s.name}
            className="row"
            style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}
          >
            <div>
              <div>
                <code>{s.from}</code> → <code>{s.to}</code>
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                {new Date(s.at).toLocaleString()}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  </>
  );
}
