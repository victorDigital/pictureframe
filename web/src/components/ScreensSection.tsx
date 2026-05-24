import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

type PropSchema = {
  type?: string;
  default?: unknown;
  enum?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
  items?: PropSchema & { required?: string[]; properties?: Record<string, PropSchema> };
  properties?: Record<string, PropSchema>;
  required?: string[];
};

type BuiltinManifest = {
  id: string;
  name?: string;
  description?: string;
  stub?: boolean;
  config_schema?: {
    type?: string;
    required?: string[];
    properties?: Record<string, PropSchema>;
  };
};

function validateConfig(
  config: Record<string, unknown> | undefined,
  schema: BuiltinManifest["config_schema"],
): string[] {
  if (!schema?.properties) return [];
  const errors: string[] = [];
  const cfg = config ?? {};
  for (const key of schema.required ?? []) {
    const v = cfg[key];
    if (v === undefined || v === null || v === "") {
      errors.push(`"${key}" is required`);
    }
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = cfg[key];
    if (v === undefined || v === null || v === "") continue;
    if (prop.enum && !prop.enum.includes(String(v))) {
      errors.push(`"${key}" must be one of: ${prop.enum.join(", ")}`);
    }
    if ((prop.type === "integer" || prop.type === "number") && typeof v !== "number") {
      errors.push(`"${key}" must be a number`);
    }
    if (prop.type === "boolean" && typeof v !== "boolean") {
      errors.push(`"${key}" must be a boolean`);
    }
    if (prop.type === "array" && !Array.isArray(v)) {
      errors.push(`"${key}" must be an array`);
    }
    if (typeof v === "number") {
      if (prop.minimum !== undefined && v < prop.minimum) {
        errors.push(`"${key}" must be ≥ ${prop.minimum}`);
      }
      if (prop.maximum !== undefined && v > prop.maximum) {
        errors.push(`"${key}" must be ≤ ${prop.maximum}`);
      }
    }
  }
  return errors;
}

type Screen = {
  id: string;
  name: string;
  type: "url" | "builtin";
  source: string;
  preload: boolean;
  transitionMs?: number;
  reloadIntervalSec?: number;
  tags?: string[];
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
  const [tagFilter, setTagFilter] = useState<string>("");
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
    try {
      await api("/api/screens", { method: "PUT", body: JSON.stringify({ screens: next }) });
      refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
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
    const exists = screens.find((s) => s.id === updated.id);
    const next = exists ? screens.map((s) => (s.id === updated.id ? updated : s)) : [...screens, updated];
    try {
      await api("/api/screens", { method: "PUT", body: JSON.stringify({ screens: next }) });
      setEditing(null);
      refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  if (editing) {
    return (
      <ScreenEditor
        screen={editing}
        onCancel={() => {
          setEditing(null);
          setErr(null);
        }}
        onSave={save}
        error={err}
      />
    );
  }

  const allTags = Array.from(new Set(screens.flatMap((s) => s.tags ?? []))).sort();
  const visible = tagFilter
    ? screens.filter((s) => (s.tags ?? []).includes(tagFilter))
    : screens;

  return (
    <>
      {err && (
        <div className="banner" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ flex: 1 }}>{err}</span>
          <button className="secondary" onClick={() => setErr(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="tile">
        <h2>Screens</h2>
        {allTags.length > 0 && (
          <div className="row" style={{ marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Filter:</span>
            <button
              className={tagFilter === "" ? "primary" : "secondary"}
              onClick={() => setTagFilter("")}
              style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }}
            >
              all
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                className={tagFilter === t ? "primary" : "secondary"}
                onClick={() => setTagFilter(t)}
                style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
        {visible.map((s) => (
          <div
            key={s.id}
            className="row"
            style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}
          >
            <div>
              <div>
                {s.name}
                {(s.tags ?? []).map((t) => (
                  <span
                    key={t}
                    style={{
                      marginLeft: "0.4rem",
                      fontSize: "0.7rem",
                      background: "rgba(79,140,255,0.18)",
                      color: "var(--accent)",
                      padding: "0.05rem 0.4rem",
                      borderRadius: "0.3rem",
                    }}
                  >
                    #{t}
                  </span>
                ))}
              </div>
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

const selectStyle = {
  width: "100%",
  padding: "0.5rem",
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "0.4rem",
};

function ScreenEditor({
  screen,
  onCancel,
  onSave,
  error,
}: {
  screen: Screen;
  onCancel: () => void;
  onSave: (s: Screen) => void;
  error?: string | null;
}) {
  const [draft, setDraft] = useState<Screen>(screen);
  const [builtins, setBuiltins] = useState<BuiltinManifest[]>([]);
  const [rawJson, setRawJson] = useState(false);
  const [tagInput, setTagInput] = useState<string>((screen.tags ?? []).join(", "));

  useEffect(() => {
    api<{ builtins: BuiltinManifest[] }>("/api/builtins")
      .then((b) => setBuiltins(b.builtins))
      .catch(() => undefined);
  }, []);

  const manifest = useMemo(
    () => (draft.type === "builtin" ? builtins.find((b) => b.id === draft.source) : undefined),
    [builtins, draft.type, draft.source],
  );

  const validationErrors = useMemo(
    () => (manifest ? validateConfig(draft.config, manifest.config_schema) : []),
    [manifest, draft.config],
  );

  const update = <K extends keyof Screen>(key: K, value: Screen[K]) =>
    setDraft({ ...draft, [key]: value });
  const updateConfig = (k: string, v: unknown) => {
    const next = { ...(draft.config ?? {}) };
    if (v === undefined) delete next[k];
    else next[k] = v;
    setDraft({ ...draft, config: Object.keys(next).length ? next : undefined });
  };

  function renderManifestField(key: string, schema: PropSchema) {
    const current = draft.config?.[key];
    const value =
      current !== undefined ? current : "default" in schema ? schema.default : "";

    if (schema.enum) {
      return (
        <select
          value={String(value ?? "")}
          onChange={(e) => updateConfig(key, e.target.value || undefined)}
          style={selectStyle}
        >
          <option value="">(unset)</option>
          {schema.enum.map((opt: string) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (schema.type === "boolean") {
      return (
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => updateConfig(key, e.target.checked)}
          />
          {schema.description ?? "Enabled"}
        </label>
      );
    }

    if (schema.type === "integer" || schema.type === "number") {
      return (
        <input
          type="number"
          min={schema.minimum}
          max={schema.maximum}
          value={value as number | string}
          onChange={(e) =>
            updateConfig(key, e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );
    }

    if (schema.type === "array") {
      const arrValue = Array.isArray(value) ? value : [];
      return (
        <textarea
          rows={Math.max(3, arrValue.length + 1)}
          defaultValue={JSON.stringify(arrValue, null, 2)}
          onChange={(e) => {
            const text = e.target.value.trim();
            if (!text) {
              updateConfig(key, undefined);
              return;
            }
            try {
              const parsed = JSON.parse(text) as unknown;
              if (Array.isArray(parsed)) updateConfig(key, parsed);
            } catch {
              // keep last valid value until JSON parses
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
      );
    }

    return (
      <input
        type="text"
        value={(value as string) ?? ""}
        onChange={(e) => updateConfig(key, e.target.value || undefined)}
      />
    );
  }

  const builtinSourceMissing =
    draft.type === "builtin" &&
    draft.source !== "" &&
    builtins.length > 0 &&
    !builtins.some((b) => b.id === draft.source);

  return (
    <div className="tile">
      <h2>{screen.id ? `Edit: ${screen.id}` : "New screen"}</h2>
      {error && <div className="banner" style={{ marginBottom: "0.75rem" }}>{error}</div>}
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
        style={selectStyle}
      >
        <option value="url">URL</option>
        <option value="builtin">Built-in</option>
      </select>
      <label style={{ marginTop: "0.75rem", display: "block" }}>
        {draft.type === "url" ? "URL" : "Built-in source"}
      </label>
      {draft.type === "builtin" ? (
        <select
          value={draft.source}
          onChange={(e) => update("source", e.target.value)}
          style={selectStyle}
        >
          <option value="">— pick one —</option>
          {builtinSourceMissing && (
            <option value={draft.source}>{draft.source} (unknown)</option>
          )}
          {builtins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name ?? b.id}
              {b.stub ? " (stub)" : ""}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={draft.source}
          onChange={(e) => update("source", e.target.value)}
        />
      )}
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

      <label style={{ marginTop: "0.75rem", display: "block" }}>Tags (comma separated)</label>
      <input
        type="text"
        value={tagInput}
        onChange={(e) => {
          setTagInput(e.target.value);
          const tags = e.target.value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          update("tags", tags.length ? tags : undefined);
        }}
      />

      <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
        <div className="row" style={{ alignItems: "baseline" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--muted)" }}>Config</h3>
          {manifest?.config_schema?.properties && (
            <button
              className="secondary"
              style={{ marginLeft: "auto" }}
              onClick={() => setRawJson((v) => !v)}
            >
              {rawJson ? "Use form" : "Edit as JSON"}
            </button>
          )}
        </div>
        {manifest?.description && (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
            {manifest.description}
          </p>
        )}
        {manifest?.config_schema?.properties && !rawJson ? (
          Object.entries(manifest.config_schema.properties).map(([key, schema]) => (
            <div key={key} style={{ marginTop: "0.75rem" }}>
              <label style={{ display: "block" }}>
                {key}
                {(manifest.config_schema?.required ?? []).includes(key) && (
                  <span style={{ color: "var(--danger)" }}> *</span>
                )}
              </label>
              {renderManifestField(key, schema)}
              {schema.description && schema.type !== "boolean" && (
                <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
                  {schema.description}
                </div>
              )}
            </div>
          ))
        ) : (
          <textarea
            rows={6}
            defaultValue={draft.config ? JSON.stringify(draft.config, null, 2) : ""}
            onChange={(e) => {
              try {
                update(
                  "config",
                  e.target.value ? (JSON.parse(e.target.value) as Record<string, unknown>) : undefined,
                );
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
              marginTop: "0.5rem",
            }}
          />
        )}
      </div>

      {validationErrors.length > 0 && (
        <div
          style={{
            marginTop: "0.75rem",
            background: "rgba(255, 120, 80, 0.12)",
            border: "1px solid rgba(255, 120, 80, 0.4)",
            color: "var(--danger)",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.4rem",
            fontSize: "0.85rem",
          }}
        >
          <strong>Config issues:</strong>
          <ul style={{ margin: "0.25rem 0 0 1rem" }}>
            {validationErrors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="row" style={{ marginTop: "1rem" }}>
        <button
          className="primary"
          onClick={() => onSave(draft)}
          disabled={
            !draft.id ||
            !draft.name ||
            !draft.source ||
            validationErrors.length > 0
          }
        >
          Save
        </button>
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
