import { useEffect, useState } from "react";
import { api } from "../api.js";

export function SystemSection() {
  const [brightness, setBrightness] = useState<number>(60);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ value: number }>("/api/system/brightness")
      .then((b) => setBrightness(b.value))
      .catch((e) => setErr(String(e)));
  }, []);

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
        <button className="secondary" onClick={() => display("on")}>Display on</button>
        <button className="secondary" onClick={() => display("off")}>Display off</button>
        <button className="danger" onClick={reboot} style={{ marginLeft: "auto" }}>Reboot</button>
      </div>
    </div>
  );
}
