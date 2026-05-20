import { useEffect, useState } from "react";
import { api } from "../api.js";

type Screen = {
  id: string;
  name: string;
  type: "url" | "builtin";
  source: string;
  preload: boolean;
};

export function ScreensSection() {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ screens: Screen[] }>("/api/screens")
      .then((b) => setScreens(b.screens))
      .catch((e) => setErr(String(e)));
  }, []);

  async function show(id: string, mode: "next" | "pin") {
    await api(`/api/screens/${id}/show`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  }

  if (err) return <div className="banner">{err}</div>;
  return (
    <div className="tile">
      <h2>Screens</h2>
      {screens.map((s) => (
        <div
          key={s.id}
          className="row"
          style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}
        >
          <div>
            <div>{s.name}</div>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              {s.type} · {s.source} {s.preload && "· preload"}
            </div>
          </div>
          <div style={{ marginLeft: "auto" }} className="row">
            <button className="primary" onClick={() => show(s.id, "next")}>Show next</button>
            <button className="secondary" onClick={() => show(s.id, "pin")}>Pin</button>
          </div>
        </div>
      ))}
    </div>
  );
}
