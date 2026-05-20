export function VncSection() {
  return (
    <div className="tile">
      <h2>Remote screen (VNC)</h2>
      <p>
        Opens a noVNC viewer connected to wayvnc over <code>ws://frame.local:8080/vnc</code>.
        Started on demand; idle when not in use.
      </p>
      <p style={{ color: "var(--muted)" }}>
        Embedding pending — see <a href="/vnc" target="_blank" rel="noreferrer">/vnc</a>.
      </p>
    </div>
  );
}
