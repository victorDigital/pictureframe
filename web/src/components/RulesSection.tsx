import { useEffect, useState } from "react";
import { api } from "../api.js";

type Rule = {
  id: string;
  cron: string;
  screenId: string;
  durationMin?: number;
  enabled: boolean;
};

type Screen = { id: string; name: string };

export function RulesSection() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const [r, s] = await Promise.all([
        api<{ rules: Rule[] }>("/api/rules"),
        api<{ screens: Screen[] }>("/api/screens"),
      ]);
      setRules(r.rules);
      setScreens(s.screens);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function save(rule: Rule) {
    const next = rules.find((r) => r.id === rule.id)
      ? rules.map((r) => (r.id === rule.id ? rule : r))
      : [...rules, rule];
    try {
      await api("/api/rules", { method: "PUT", body: JSON.stringify({ rules: next }) });
      setDraft(null);
      refresh();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function remove(id: string) {
    if (!confirm(`Delete rule "${id}"?`)) return;
    const next = rules.filter((r) => r.id !== id);
    await api("/api/rules", { method: "PUT", body: JSON.stringify({ rules: next }) });
    refresh();
  }

  async function toggle(rule: Rule) {
    await save({ ...rule, enabled: !rule.enabled });
  }

  if (err) return <div className="banner">{err}</div>;

  return (
    <>
      <div className="tile">
        <h2>Scheduled rules</h2>
        <p style={{ color: "var(--muted)" }}>
          Cron expressions claim a screen at the configured time. See SPEC §4.7.
        </p>
        {rules.length === 0 && <p>No rules.</p>}
        {rules.map((r) => (
          <div
            key={r.id}
            className="row"
            style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}
          >
            <div>
              <div>{r.id} → {r.screenId}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                <code>{r.cron}</code>
                {r.durationMin ? ` · holds ${r.durationMin} min` : ""}
                {r.enabled ? "" : " · disabled"}
              </div>
            </div>
            <div className="row" style={{ marginLeft: "auto" }}>
              <button className="secondary" onClick={() => toggle(r)}>
                {r.enabled ? "Disable" : "Enable"}
              </button>
              <button className="secondary" onClick={() => setDraft(r)}>Edit</button>
              <button className="danger" onClick={() => remove(r.id)}>Delete</button>
            </div>
          </div>
        ))}
        <div style={{ marginTop: "1rem" }}>
          <button
            className="primary"
            onClick={() =>
              setDraft({
                id: "",
                cron: "0 9 * * 1-5",
                screenId: screens[0]?.id ?? "",
                enabled: true,
              })
            }
          >
            Add rule
          </button>
        </div>
      </div>

      {draft && (
        <RuleEditor draft={draft} screens={screens} onCancel={() => setDraft(null)} onSave={save} />
      )}
    </>
  );
}

function RuleEditor({
  draft,
  screens,
  onCancel,
  onSave,
}: {
  draft: Rule;
  screens: Screen[];
  onCancel: () => void;
  onSave: (r: Rule) => void;
}) {
  const [d, setD] = useState<Rule>(draft);
  const update = <K extends keyof Rule>(key: K, value: Rule[K]) => setD({ ...d, [key]: value });
  return (
    <div className="tile">
      <h2>{draft.id ? `Edit: ${draft.id}` : "New rule"}</h2>
      <label>ID</label>
      <input
        type="text"
        value={d.id}
        disabled={Boolean(draft.id)}
        onChange={(e) => update("id", e.target.value)}
      />
      <label style={{ marginTop: "0.75rem", display: "block" }}>Cron expression</label>
      <input type="text" value={d.cron} onChange={(e) => update("cron", e.target.value)} />
      <label style={{ marginTop: "0.75rem", display: "block" }}>Screen</label>
      <select
        value={d.screenId}
        onChange={(e) => update("screenId", e.target.value)}
        style={{ width: "100%", padding: "0.5rem", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "0.4rem" }}
      >
        {screens.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <label style={{ marginTop: "0.75rem", display: "block" }}>Hold duration (min, optional)</label>
      <input
        type="number"
        value={d.durationMin ?? ""}
        onChange={(e) => update("durationMin", e.target.value ? Number(e.target.value) : undefined)}
      />
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="primary" onClick={() => onSave(d)} disabled={!d.id || !d.cron || !d.screenId}>
          Save
        </button>
        <button className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
