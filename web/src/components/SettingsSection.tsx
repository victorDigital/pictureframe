import { useState } from "react";
import { api, setToken } from "../api.js";

export function SettingsSection({ onSignOut }: { onSignOut: () => void }) {
  const [newToken, setNewToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <div className="banner" style={{ background: "rgba(79, 140, 255, 0.12)", borderColor: "var(--accent)", color: "var(--accent)" }}>
            <strong>New token:</strong> <code>{newToken}</code>
            <div style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
              Saved to <code>/etc/frame/secrets/bearer_token</code>. Update every other client that
              talked to this frame.
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
        <h2>Channel &amp; auto-apply</h2>
        <p style={{ color: "var(--muted)" }}>
          UI pending — edit <code>/etc/frame/frame.yaml</code> for now.
        </p>
      </div>
      <div className="tile">
        <h2>Signing key</h2>
        <p style={{ color: "var(--muted)" }}>
          Rotation requires the new key to be signed by the old one, or explicit override. See SPEC §5.7.
        </p>
      </div>
    </>
  );
}
