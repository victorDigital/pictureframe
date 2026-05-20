import { useEffect, useState } from "react";
import { api, setToken } from "../api.js";

type UpdaterSettings = {
  channel: "stable" | "beta";
  auto_apply: boolean;
  staging_delay_hours: number;
  poll_interval_min: number;
  retain_releases: number;
  repo: string;
  signing_key_file: string | null;
};

export function SettingsSection({ onSignOut }: { onSignOut: () => void }) {
  const [newToken, setNewToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<UpdaterSettings | null>(null);

  async function refresh() {
    try {
      setSettings(await api<UpdaterSettings>("/api/settings/updater"));
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function rotate() {
    const sure = confirm(
      "Rotate the bearer token?\n\nAll other browser sessions will be signed out — including any mobile app or Home Assistant integration using this token.",
    );
    if (!sure) return;
    setBusy(true);
    try {
      const r = await api<{ ok: true; token: string }>("/api/settings/rotate_bearer", {
        method: "POST",
      });
      setToken(r.token);
      setNewToken(r.token);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveUpdater(patch: Partial<UpdaterSettings>) {
    setBusy(true);
    try {
      await api("/api/settings/updater", { method: "PUT", body: JSON.stringify(patch) });
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tile">
        <h2>Bearer token</h2>
        <p>
          Rotating the token signs out every other session (mobile app, Home Assistant integration,
          additional browsers). Your current session is updated to the new token automatically.
        </p>
        {err && <div className="banner">{err}</div>}
        {newToken && (
          <div
            className="banner"
            style={{
              background: "rgba(79, 140, 255, 0.12)",
              borderColor: "var(--accent)",
              color: "var(--accent)",
            }}
          >
            <strong>New token:</strong> <code>{newToken}</code>
            <div style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
              Saved to <code>/etc/frame/secrets/bearer_token</code>. Update every other client.
            </div>
          </div>
        )}
        <div className="row" style={{ marginTop: "1rem" }}>
          <button className="secondary" onClick={rotate} disabled={busy}>
            Rotate token
          </button>
          <button className="danger" onClick={onSignOut} style={{ marginLeft: "auto" }}>
            Sign out
          </button>
        </div>
      </div>

      <div className="tile">
        <h2>Updater</h2>
        {!settings ? (
          "Loading…"
        ) : (
          <>
            <div>
              <label>Channel</label>
              <select
                value={settings.channel}
                onChange={(e) => saveUpdater({ channel: e.target.value as UpdaterSettings["channel"] })}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.4rem",
                  marginBottom: "0.75rem",
                }}
              >
                <option value="stable">stable</option>
                <option value="beta">beta</option>
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.5rem 0" }}>
              <input
                type="checkbox"
                checked={settings.auto_apply}
                onChange={(e) => saveUpdater({ auto_apply: e.target.checked })}
              />
              Auto-apply once past staging delay
            </label>
            <label>Staging delay (hours)</label>
            <input
              type="number"
              min={0}
              value={settings.staging_delay_hours}
              onChange={(e) => saveUpdater({ staging_delay_hours: Number(e.target.value) })}
            />
            <p style={{ color: "var(--muted)", marginTop: "0.75rem", fontSize: "0.9rem" }}>
              Repo: <code>{settings.repo}</code> · polls every {settings.poll_interval_min} min ·
              keeps last {settings.retain_releases} releases.
            </p>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              Signing key:{" "}
              {settings.signing_key_file ? <code>{settings.signing_key_file}</code> : "not configured"}
              . Rotation requires the new key to be signed by the old one, or explicit override
              (SPEC §5.7).
            </p>
          </>
        )}
      </div>
    </>
  );
}
