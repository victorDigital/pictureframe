export function SettingsSection({ onSignOut }: { onSignOut: () => void }) {
  return (
    <>
      <div className="tile">
        <h2>Bearer token</h2>
        <p>
          Rotating the token signs out every other session (mobile app, Home Assistant integration, etc.).
        </p>
        <button className="danger" onClick={onSignOut}>Sign out</button>
      </div>
      <div className="tile">
        <h2>Channel &amp; auto-apply</h2>
        <p style={{ color: "var(--muted)" }}>UI pending — edit <code>/etc/frame/frame.yaml</code> for now.</p>
      </div>
      <div className="tile">
        <h2>Signing key</h2>
        <p style={{ color: "var(--muted)" }}>
          Rotation requires the new key to be signed by the old one, or explicit override.
          See SPEC §5.7.
        </p>
      </div>
    </>
  );
}
