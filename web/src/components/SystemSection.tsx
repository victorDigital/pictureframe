import { useEffect, useState } from "react";
import { api } from "../api.js";

const SUBSYSTEMS = ["api", "updater", "scheduler", "mqtt", "cdp", "config", "vnc"] as const;
const UNITS = ["frame-core", "frame-kiosk"] as const;
type Unit = (typeof UNITS)[number];

export function SystemSection() {
  const [brightness, setBrightness] = useState<number>(60);
  const [err, setErr] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsErr, setLogsErr] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("frame-core");
  const [subsystem, setSubsystem] = useState<string>("");

  useEffect(() => {
    api<{ value: number }>("/api/system/brightness")
      .then((b) => setBrightness(b.value))
      .catch((e) => setErr(String(e)));
  }, []);

  async function refreshLogs() {
    const qs = new URLSearchParams({ lines: "200", unit });
    if (unit === "frame-core" && subsystem) qs.set("subsystem", subsystem);
    try {
      const r = await api<{ lines: string[] }>(`/api/logs?${qs}`);
      setLogs(r.lines);
      setLogsErr(null);
    } catch (e) {
      setLogsErr(String(e));
    }
  }
  useEffect(() => {
    refreshLogs();
    const t = setInterval(refreshLogs, 5000);
    return () => clearInterval(t);
  }, [unit, subsystem]);

  async function commit(v: number) {
    setBrightness(v);
    await api("/api/system/brightness", {
      method: "PUT",
      body: JSON.stringify({ value: v }),
    });
  }

  async function reboot() {
    if (!confirm("Reboot the device now?")) return;
    await api("/api/system/reboot", { method: "POST" });
  }

  async function display(state: "on" | "off") {
    await api(`/api/system/display/${state}`, { method: "POST" });
  }

  return (
    <>
      <div className="tile">
        <h2>System</h2>
        {err && <div className="banner">{err}</div>}
        <div style={{ margin: "0.5rem 0" }}>
          <label>Brightness: {brightness}%</label>
          <input
            type="range"
            min={0}
            max={100}
            value={brightness}
            onChange={(e) => commit(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>
        <div className="row">
          <button className="secondary" onClick={() => display("on")}>
            Display on
          </button>
          <button className="secondary" onClick={() => display("off")}>
            Display off
          </button>
          <button className="danger" onClick={reboot} style={{ marginLeft: "auto" }}>
            Reboot
          </button>
        </div>
      </div>
      <div className="tile">
        <h2>Logs</h2>
        {logsErr && <div className="banner">{logsErr}</div>}
        <div className="row" style={{ marginBottom: "0.5rem" }}>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            style={{
              padding: "0.4rem",
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "0.4rem",
            }}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <select
            value={subsystem}
            onChange={(e) => setSubsystem(e.target.value)}
            disabled={unit !== "frame-core"}
            title={unit === "frame-core" ? "Filter by pino subsystem" : "Subsystem filter only applies to frame-core"}
            style={{
              padding: "0.4rem",
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "0.4rem",
              opacity: unit === "frame-core" ? 1 : 0.5,
            }}
          >
            <option value="">all subsystems</option>
            {SUBSYSTEMS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={refreshLogs}>
            Refresh
          </button>
        </div>
        <pre
          style={{
            background: "rgba(0,0,0,0.4)",
            padding: "0.75rem",
            borderRadius: "0.4rem",
            maxHeight: "24rem",
            overflow: "auto",
            fontSize: "0.78rem",
            lineHeight: "1.4",
            margin: 0,
            whiteSpace: "pre-wrap",
          }}
        >
          {logs.length === 0 ? "(no log lines)" : logs.join("\n")}
        </pre>
      </div>
    </>
  );
}
