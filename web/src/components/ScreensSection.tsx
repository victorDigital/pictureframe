import { useEffect, useState } from "react";
import { api } from "../api.js";

type Screen = {
  id: string;
  name: string;
  type: "url" | "builtin";
  source: string;
  preload: boolean;
  transitionMs?: number;
  reloadIntervalSec?: number;
  config?: Record<string, unknown>;
};

type TestResult = {
  ok: boolean;
  httpStatus?: number;
  finalUrl?: string;
  loaded: boolean;
  consoleErrors: string[];
  screenshot?: string;
  error?: string;
};

export function ScreensSection() {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [editing, setEditing] = useState<Screen | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; result: TestResult } | null>(null);

  async function refresh() {
    try {
      const b = await api<{ screens: Screen[] }>("/api/screens");
      setScreens(b.screens);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function show(id: string, mode: "next" | "pin") {
    await api(`/api/screens/${id}/show`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  }

  async function remove(id: string) {
    if (!confirm(`Delete screen "${id}"?`)) return;
    const next = screens.filter((s) => s.id !== id);
    await api("/api/screens", { method: "PUT", body: JSON.stringify({ screens: next }) });
    refresh();
  }

  async function test(id: string) {
    setTestResult({ id, result: { ok: false, loaded: false, consoleErrors: [] } });
    try {
      const result = await api<TestResult>(`/api/screens/${id}/test`, { method: "POST" });
      setTestResult({ id, result });
    } catch (e) {
      setTestResult({ id, result: { ok: false, loaded: false, consoleErrors: [], error: String(e) } });
    }
  }

  async function save(updated: Screen) {
    const others = screens.filter((s) => s.id !== updated.id);
    const exists = screens.find((s) => s.id === updated.id);
    const next = exists ? screens.map((s) => (s.id === updated.id ? updated : s)) : [...others, updated];
    try {
      await api("/api/screens", { method: "PUT", body: JSON.stringify({ screens: next }) });
      setEditing(null);
      refresh();
    } catch (e) {
      setErr(String(e));
    }
  }

  if (err) return <div className="banner">{err}</div>;

  if (editing) {
    return <ScreenEditor screen={editing} onCancel={() => setEditing(null)} onSave={save} />;
  }

  return (
    <>
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
              <button className="primary" onClick={() => show(s.id, "next")}>
                Show next
              </button>
              <button className="secondary" onClick={() => show(s.id, "pin")}>
                Pin
              </button>
              {s.type === "url" && (
                <button className="secondary" onClick={() => test(s.id)}>
                  Test
                </button>
              )}
              <button className="secondary" onClick={() => setEditing(s)}>
                Edit
              </button>
              <button className="danger" onClick={() => remove(s.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        <div style={{ marginTop: "1rem" }}>
          <button
            className="primary"
            onClick={() =>
              setEditing({ id: "", name: "", type: "url", source: "", preload: false })
            }
          >
            Add screen
          </button>
        </div>
      </div>

      {testResult && (
        <div className="tile">
          <h2>
            Test: {testResult.id}{" "}
            {testResult.result.ok ? "✅" : "⚠️"}
          </h2>
          {testResult.result.error && (
            <div className="banner">{testResult.result.error}</div>
          )}
          <div>HTTP: {testResult.result.httpStatus ?? "—"}</div>
          <div>Loaded: {String(testResult.result.loaded)}</div>
          <div>Final URL: {testResult.result.finalUrl ?? "—"}</div>
          {testResult.result.consoleErrors.length > 0 && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary>Console errors ({testResult.result.consoleErrors.length})</summary>
              <pre style={{ background: "rgba(0,0,0,0.3)", padding: "0.5rem", fontSize: "0.85rem" }}>
                {testResult.result.consoleErrors.join("\n")}
              </pre>
            </details>
          )}
          {testResult.result.screenshot && (
            <img
              src={testResult.result.screenshot}
              alt="screenshot"
              style={{ width: "100%", marginTop: "0.5rem", borderRadius: "0.4rem" }}
            />
          )}
        </div>
      )}
    </>
  );
}

function ScreenEditor({
  screen,
  onCancel,
  onSave,
}: {
  screen: Screen;
  onCancel: () => void;
  onSave: (s: Screen) => void;
}) {
  const [draft, setDraft] = useState<Screen>(screen);
  const update = <K extends keyof Screen>(key: K, value: Screen[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <div className="tile">
      <h2>{screen.id ? `Edit: ${screen.id}` : "New screen"}</h2>
      <label>ID (lowercase, hyphenated)</label>
      <input
        type="text"
        value={draft.id}
        disabled={Boolean(screen.id)}
        onChange={(e) => update("id", e.target.value)}
      />
      <label style={{ marginTop: "0.75rem", display: "block" }}>Name</label>
      <input type="text" value={draft.name} onChange={(e) => update("name", e.target.value)} />
      <label style={{ marginTop: "0.75rem", display: "block" }}>Type</label>
      <select
        value={draft.type}
        onChange={(e) => update("type", e.target.value as Screen["type"])}
        style={{ width: "100%", padding: "0.5rem", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "0.4rem" }}
      >
        <option value="url">URL</option>
        <option value="builtin">Built-in</option>
      </select>
      <label style={{ marginTop: "0.75rem", display: "block" }}>
        {draft.type === "url" ? "URL" : "Built-in source ID (e.g. clock)"}
      </label>
      <input type="text" value={draft.source} onChange={(e) => update("source", e.target.value)} />
      {draft.type === "url" && (
        <>
          <label style={{ marginTop: "0.75rem", display: "block" }}>Reload interval (sec)</label>
          <input
            type="number"
            value={draft.reloadIntervalSec ?? ""}
            onChange={(e) =>
              update("reloadIntervalSec", e.target.value ? Number(e.target.value) : undefined)
            }
          />
        </>
      )}
      <label style={{ marginTop: "0.75rem", display: "block" }}>Transition (ms)</label>
      <input
        type="number"
        value={draft.transitionMs ?? ""}
        onChange={(e) =>
          update("transitionMs", e.target.value ? Number(e.target.value) : undefined)
        }
      />
      <label style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={draft.preload}
          onChange={(e) => update("preload", e.target.checked)}
        />
        Preload (keep in memory)
      </label>
      <label style={{ marginTop: "0.75rem", display: "block" }}>Config (JSON)</label>
      <textarea
        rows={5}
        defaultValue={draft.config ? JSON.stringify(draft.config, null, 2) : ""}
        onChange={(e) => {
          try {
            update("config", e.target.value ? JSON.parse(e.target.value) : undefined);
          } catch {
            // ignore until valid
          }
        }}
        style={{
          width: "100%",
          background: "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "0.4rem",
          padding: "0.5rem",
          fontFamily: "ui-monospace, monospace",
          fontSize: "0.85rem",
          boxSizing: "border-box",
        }}
      />
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="primary" onClick={() => onSave(draft)} disabled={!draft.id || !draft.name || !draft.source}>
          Save
        </button>
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
