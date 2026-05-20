import { useEffect, useState } from "react";
import { getToken, setToken } from "./api.js";
import { NowSection } from "./components/NowSection.js";
import { ScreensSection } from "./components/ScreensSection.js";
import { SystemSection } from "./components/SystemSection.js";
import { UpdatesSection } from "./components/UpdatesSection.js";
import { VncSection } from "./components/VncSection.js";
import { SettingsSection } from "./components/SettingsSection.js";
import { RulesSection } from "./components/RulesSection.js";

type Tab = "now" | "screens" | "rules" | "system" | "updates" | "vnc" | "settings";

export function App() {
  const [authed, setAuthed] = useState<boolean>(Boolean(getToken()));
  const [tab, setTab] = useState<Tab>("now");
  const [publicIp, setPublicIp] = useState(false);

  useEffect(() => {
    fetch("/healthz")
      .then((r) => r.json())
      .then((b) => {
        if (b?.public_ip) setPublicIp(true);
      })
      .catch(() => {});
  }, []);

  if (!authed) {
    return <Login onAuth={() => setAuthed(true)} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Picture Frame</h1>
        <nav className="nav">
          <button data-active={tab === "now"} onClick={() => setTab("now")}>Now</button>
          <button data-active={tab === "screens"} onClick={() => setTab("screens")}>Screens</button>
          <button data-active={tab === "rules"} onClick={() => setTab("rules")}>Rules</button>
          <button data-active={tab === "system"} onClick={() => setTab("system")}>System</button>
          <button data-active={tab === "updates"} onClick={() => setTab("updates")}>Updates</button>
          <button data-active={tab === "vnc"} onClick={() => setTab("vnc")}>VNC</button>
          <button data-active={tab === "settings"} onClick={() => setTab("settings")}>Settings</button>
        </nav>
      </aside>
      <main className="main">
        {publicIp && (
          <div className="banner">
            This device appears to have a public IP. The bearer-token model assumes a trusted LAN; expose only behind a reverse proxy or Tailscale.
          </div>
        )}
        {tab === "now" && <NowSection />}
        {tab === "screens" && <ScreensSection />}
        {tab === "rules" && <RulesSection />}
        {tab === "system" && <SystemSection />}
        {tab === "updates" && <UpdatesSection />}
        {tab === "vnc" && <VncSection />}
        {tab === "settings" && <SettingsSection onSignOut={() => { setToken(null); setAuthed(false); }} />}
      </main>
    </div>
  );
}

function Login({ onAuth }: { onAuth: () => void }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setToken(value);
    try {
      const res = await fetch("/api/state", { headers: { Authorization: `Bearer ${value}` } });
      if (res.ok) onAuth();
      else {
        setErr("Bearer token rejected.");
        setToken(null);
      }
    } catch {
      setErr("Could not reach frame-core.");
    }
  }
  return (
    <div className="login">
      <h2>Picture Frame</h2>
      <p style={{ color: "var(--muted)" }}>Enter the bearer token from <code>/etc/frame/secrets/bearer_token</code>.</p>
      <form onSubmit={submit}>
        <input
          type="password"
          placeholder="Bearer token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {err && <div className="banner" style={{ marginTop: "1rem" }}>{err}</div>}
        <button className="primary" type="submit" style={{ marginTop: "1rem", width: "100%" }}>
          Sign in
        </button>
      </form>
    </div>
  );
}
