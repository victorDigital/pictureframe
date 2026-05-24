import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api, setToken } from "../api.js";

const OVERRIDE_PHRASE = "I understand this disables verification temporarily";

type FrameConfigView = {
  safe_mode: boolean;
  device: { name: string; bearer_token_file: string };
  display: {
    brightness_backend: "backlight" | "ddcutil" | "none";
    backlight_device: string | null;
    default_brightness: number;
  };
  screens_file: string;
  default_screen: string;
  manual_pinned_timeout_hours: number;
  scheduler: { max_preloaded_url_screens: number };
  updater: {
    repo: string;
    channel: "stable" | "beta";
    poll_interval_min: number;
    auto_apply: boolean;
    staging_delay_hours: number;
    health_check_window_sec: number;
    retain_releases: number;
    signing_key_file: string | null;
  };
  ha: {
    enabled: boolean;
    mqtt: {
      host: string;
      port: number;
      username: string;
      password_file: string;
      keepalive: number;
      discovery_prefix: string;
    } | null;
  };
  vnc: { enabled: boolean; password_file: string } | null;
  builtins: Record<string, { enabled?: boolean } & Record<string, unknown>>;
};

type ConfigPatch = {
  device?: { name?: string };
  display?: {
    brightness_backend?: "backlight" | "ddcutil" | "none";
    backlight_device?: string;
    default_brightness?: number;
  };
  default_screen?: string;
  manual_pinned_timeout_hours?: number;
  scheduler?: { max_preloaded_url_screens?: number };
  updater?: {
    repo?: string;
    channel?: "stable" | "beta";
    poll_interval_min?: number;
    auto_apply?: boolean;
    staging_delay_hours?: number;
    health_check_window_sec?: number;
    retain_releases?: number;
  };
  ha?: {
    enabled?: boolean;
    mqtt?: {
      host?: string;
      port?: number;
      username?: string;
      keepalive?: number;
      discovery_prefix?: string;
    };
  };
  vnc?: { enabled?: boolean };
  builtins?: Record<string, { enabled: boolean } & Record<string, unknown>>;
};

type Screen = {
  id: string;
  name: string;
  type: "url" | "builtin";
  source: string;
};

type Builtin = { id: string; name?: string; description?: string; stub?: boolean };

export function SettingsSection({ onSignOut }: { onSignOut: () => void }) {
  const [cfg, setCfg] = useState<FrameConfigView | null>(null);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [builtins, setBuiltins] = useState<Builtin[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function refresh() {
    try {
      const [c, s, b] = await Promise.all([
        api<FrameConfigView>("/api/settings/config"),
        api<{ screens: Screen[] }>("/api/screens"),
        api<{ builtins: Builtin[] }>("/api/builtins"),
      ]);
      setCfg(c);
      setScreens(s.screens);
      setBuiltins(b.builtins);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function save(patch: ConfigPatch, successMsg?: string) {
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await api("/api/settings/config", { method: "PUT", body: JSON.stringify(patch) });
      await refresh();
      if (successMsg) setOkMsg(successMsg);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

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

  if (!cfg) return <div className="tile">Loading…</div>;

  return (
    <>
      <div className="tile">
        <h2>Bearer token</h2>
        <p>
          Rotating the token signs out every other session (mobile app, Home Assistant integration,
          additional browsers). Your current session is updated to the new token automatically.
        </p>
        {err && <div className="banner">{err}</div>}
        {okMsg && <SuccessBanner msg={okMsg} />}
        {newToken && (
          <div
            className="banner"
            style={{
              background: "rgba(79, 140, 255, 0.12)",
              borderColor: "var(--accent)",
              color: "var(--accent)",
            }}
          >
            <strong>New token:</strong> <code>{newToken}</code>
            <div style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
              Saved to <code>{cfg.device.bearer_token_file}</code>. Update every other client.
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

      {cfg.safe_mode && (
        <div className="banner">
          Frame is in safe mode — config edits are disabled until frame.yaml validates.
        </div>
      )}

      <DeviceTile cfg={cfg} save={save} busy={busy || cfg.safe_mode} />
      <DisplayTile cfg={cfg} save={save} busy={busy || cfg.safe_mode} />
      <SchedulerTile
        cfg={cfg}
        screens={screens}
        save={save}
        busy={busy || cfg.safe_mode}
      />
      <HomeAssistantTile cfg={cfg} save={save} busy={busy || cfg.safe_mode} />
      <UpdaterTile cfg={cfg} save={save} busy={busy || cfg.safe_mode} />
      <VncTile cfg={cfg} save={save} busy={busy || cfg.safe_mode} />
      <BuiltinsTile cfg={cfg} builtins={builtins} save={save} busy={busy || cfg.safe_mode} />

      <SigningKeyTile />
    </>
  );
}

function SuccessBanner({ msg }: { msg: string }) {
  return (
    <div
      className="banner"
      style={{
        background: "rgba(79, 140, 255, 0.12)",
        borderColor: "var(--accent)",
        color: "var(--accent)",
      }}
    >
      {msg}
    </div>
  );
}

type TileProps = {
  cfg: FrameConfigView;
  save: (patch: ConfigPatch, msg?: string) => Promise<void>;
  busy: boolean;
};

function DeviceTile({ cfg, save, busy }: TileProps) {
  const [name, setName] = useState(cfg.device.name);
  useEffect(() => setName(cfg.device.name), [cfg.device.name]);

  return (
    <div className="tile">
      <h2>Device</h2>
      <label>Name</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="living-room-frame"
      />
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
        Used as the MQTT node id and Home Assistant device name. Restart required to
        re-publish discovery topics.
      </p>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        Bearer token file: <code>{cfg.device.bearer_token_file}</code>
      </p>
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button
          className="primary"
          disabled={busy || name === cfg.device.name || !name.trim()}
          onClick={() => save({ device: { name: name.trim() } }, "Device name saved.")}
        >
          Save
        </button>
        <RestartBadge />
      </div>
    </div>
  );
}

function DisplayTile({ cfg, save, busy }: TileProps) {
  const [backend, setBackend] = useState(cfg.display.brightness_backend);
  const [device, setDevice] = useState(cfg.display.backlight_device ?? "");
  const [defaultB, setDefaultB] = useState(cfg.display.default_brightness);

  useEffect(() => setBackend(cfg.display.brightness_backend), [cfg.display.brightness_backend]);
  useEffect(() => setDevice(cfg.display.backlight_device ?? ""), [cfg.display.backlight_device]);
  useEffect(() => setDefaultB(cfg.display.default_brightness), [cfg.display.default_brightness]);

  const dirty =
    backend !== cfg.display.brightness_backend ||
    device !== (cfg.display.backlight_device ?? "") ||
    defaultB !== cfg.display.default_brightness;

  return (
    <div className="tile">
      <h2>Display</h2>
      <label>Brightness backend</label>
      <select
        value={backend}
        onChange={(e) => setBackend(e.target.value as FrameConfigView["display"]["brightness_backend"])}
        style={selectStyle}
      >
        <option value="backlight">backlight (sysfs)</option>
        <option value="ddcutil">ddcutil (external monitor)</option>
        <option value="none">none</option>
      </select>
      {backend === "backlight" && (
        <>
          <label>Backlight device path</label>
          <input
            type="text"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            placeholder="/sys/class/backlight/intel_backlight"
          />
        </>
      )}
      <label style={{ marginTop: "0.75rem", display: "block" }}>
        Default brightness ({defaultB}%)
      </label>
      <input
        type="range"
        min={0}
        max={100}
        value={defaultB}
        onChange={(e) => setDefaultB(Number(e.target.value))}
        style={{ width: "100%" }}
      />
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() =>
            save(
              {
                display: {
                  brightness_backend: backend,
                  backlight_device: device || undefined,
                  default_brightness: defaultB,
                },
              },
              "Display settings saved.",
            )
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

function SchedulerTile({
  cfg,
  screens,
  save,
  busy,
}: TileProps & { screens: Screen[] }) {
  const [defaultScreen, setDefaultScreen] = useState(cfg.default_screen);
  const [pinned, setPinned] = useState(cfg.manual_pinned_timeout_hours);
  const [maxPre, setMaxPre] = useState(cfg.scheduler.max_preloaded_url_screens);

  useEffect(() => setDefaultScreen(cfg.default_screen), [cfg.default_screen]);
  useEffect(() => setPinned(cfg.manual_pinned_timeout_hours), [cfg.manual_pinned_timeout_hours]);
  useEffect(() => setMaxPre(cfg.scheduler.max_preloaded_url_screens), [cfg.scheduler.max_preloaded_url_screens]);

  const dirty =
    defaultScreen !== cfg.default_screen ||
    pinned !== cfg.manual_pinned_timeout_hours ||
    maxPre !== cfg.scheduler.max_preloaded_url_screens;

  return (
    <div className="tile">
      <h2>Scheduler</h2>
      <label>Default screen (shown when nothing else is claiming)</label>
      <select
        value={defaultScreen}
        onChange={(e) => setDefaultScreen(e.target.value)}
        style={selectStyle}
      >
        {screens.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.id})
          </option>
        ))}
      </select>
      <label>Manual-pinned timeout (hours)</label>
      <input
        type="number"
        min={0}
        max={168}
        value={pinned}
        onChange={(e) => setPinned(Number(e.target.value))}
      />
      <label>Max preloaded URL screens</label>
      <input
        type="number"
        min={1}
        max={20}
        value={maxPre}
        onChange={(e) => setMaxPre(Number(e.target.value))}
      />
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() =>
            save(
              {
                default_screen: defaultScreen,
                manual_pinned_timeout_hours: pinned,
                scheduler: { max_preloaded_url_screens: maxPre },
              },
              "Scheduler settings saved.",
            )
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

function HomeAssistantTile({ cfg, save, busy }: TileProps) {
  const initial = cfg.ha;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [host, setHost] = useState(initial.mqtt?.host ?? "");
  const [port, setPort] = useState(initial.mqtt?.port ?? 1883);
  const [username, setUsername] = useState(initial.mqtt?.username ?? "");
  const [keepalive, setKeepalive] = useState(initial.mqtt?.keepalive ?? 60);
  const [discoveryPrefix, setDiscoveryPrefix] = useState(
    initial.mqtt?.discovery_prefix ?? "homeassistant",
  );

  useEffect(() => setEnabled(initial.enabled), [initial.enabled]);
  useEffect(() => setHost(initial.mqtt?.host ?? ""), [initial.mqtt?.host]);
  useEffect(() => setPort(initial.mqtt?.port ?? 1883), [initial.mqtt?.port]);
  useEffect(() => setUsername(initial.mqtt?.username ?? ""), [initial.mqtt?.username]);
  useEffect(() => setKeepalive(initial.mqtt?.keepalive ?? 60), [initial.mqtt?.keepalive]);
  useEffect(
    () => setDiscoveryPrefix(initial.mqtt?.discovery_prefix ?? "homeassistant"),
    [initial.mqtt?.discovery_prefix],
  );

  const hostValid = useMemo(() => {
    if (!host) return false;
    return /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/.test(
      host,
    );
  }, [host]);

  const dirty =
    enabled !== initial.enabled ||
    host !== (initial.mqtt?.host ?? "") ||
    port !== (initial.mqtt?.port ?? 1883) ||
    username !== (initial.mqtt?.username ?? "") ||
    keepalive !== (initial.mqtt?.keepalive ?? 60) ||
    discoveryPrefix !== (initial.mqtt?.discovery_prefix ?? "homeassistant");

  const submit = () => {
    const patch: ConfigPatch = { ha: { enabled } };
    if (host && username) {
      patch.ha!.mqtt = {
        host,
        port,
        username,
        keepalive,
        discovery_prefix: discoveryPrefix,
      };
    }
    save(patch, "Home Assistant settings saved. MQTT bridge reconnecting.");
  };

  return (
    <div className="tile">
      <h2>Home Assistant (MQTT)</h2>
      <label style={checkboxLabel}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enabled
      </label>
      <label>Broker host (hostname or IPv4)</label>
      <input
        type="text"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        placeholder="homeassistant.local"
      />
      {host && !hostValid && (
        <div style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
          Must be a hostname or IPv4 address.
        </div>
      )}
      <label>Port</label>
      <input
        type="number"
        min={1}
        max={65535}
        value={port}
        onChange={(e) => setPort(Number(e.target.value))}
      />
      <label>Username</label>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="frame"
      />
      <label>Keepalive (seconds)</label>
      <input
        type="number"
        min={5}
        max={3600}
        value={keepalive}
        onChange={(e) => setKeepalive(Number(e.target.value))}
      />
      <label>Discovery prefix</label>
      <input
        type="text"
        value={discoveryPrefix}
        onChange={(e) => setDiscoveryPrefix(e.target.value)}
        placeholder="homeassistant"
      />
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
        Password file: <code>{initial.mqtt?.password_file ?? "(unset)"}</code> — edit on disk
        or via the install script. Bearer-token endpoints do not surface secret bytes.
      </p>
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button
          className="primary"
          disabled={
            busy || !dirty || (enabled && (!host || !hostValid || !username))
          }
          onClick={submit}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function UpdaterTile({ cfg, save, busy }: TileProps) {
  const u = cfg.updater;
  const [repo, setRepo] = useState(u.repo);
  const [channel, setChannel] = useState(u.channel);
  const [pollMin, setPollMin] = useState(u.poll_interval_min);
  const [autoApply, setAutoApply] = useState(u.auto_apply);
  const [stagingHours, setStagingHours] = useState(u.staging_delay_hours);
  const [healthSec, setHealthSec] = useState(u.health_check_window_sec);
  const [retain, setRetain] = useState(u.retain_releases);

  useEffect(() => setRepo(u.repo), [u.repo]);
  useEffect(() => setChannel(u.channel), [u.channel]);
  useEffect(() => setPollMin(u.poll_interval_min), [u.poll_interval_min]);
  useEffect(() => setAutoApply(u.auto_apply), [u.auto_apply]);
  useEffect(() => setStagingHours(u.staging_delay_hours), [u.staging_delay_hours]);
  useEffect(() => setHealthSec(u.health_check_window_sec), [u.health_check_window_sec]);
  useEffect(() => setRetain(u.retain_releases), [u.retain_releases]);

  const repoValid = /^[^/]+\/[^/]+$/.test(repo);
  const dirty =
    repo !== u.repo ||
    channel !== u.channel ||
    pollMin !== u.poll_interval_min ||
    autoApply !== u.auto_apply ||
    stagingHours !== u.staging_delay_hours ||
    healthSec !== u.health_check_window_sec ||
    retain !== u.retain_releases;

  return (
    <div className="tile">
      <h2>Updater</h2>
      <label>GitHub repo (owner/repo)</label>
      <input
        type="text"
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        placeholder="victorDigital/pictureframe"
      />
      {!repoValid && (
        <div style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
          Format must be <code>owner/repo</code>.
        </div>
      )}
      <label>Channel</label>
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value as "stable" | "beta")}
        style={selectStyle}
      >
        <option value="stable">stable</option>
        <option value="beta">beta</option>
      </select>
      <label style={checkboxLabel}>
        <input
          type="checkbox"
          checked={autoApply}
          onChange={(e) => setAutoApply(e.target.checked)}
        />
        Auto-apply once past staging delay
      </label>
      <label>Poll interval (minutes)</label>
      <input
        type="number"
        min={1}
        max={1440}
        value={pollMin}
        onChange={(e) => setPollMin(Number(e.target.value))}
      />
      <label>Staging delay (hours)</label>
      <input
        type="number"
        min={0}
        max={720}
        value={stagingHours}
        onChange={(e) => setStagingHours(Number(e.target.value))}
      />
      <label>Health check window (seconds)</label>
      <input
        type="number"
        min={5}
        max={3600}
        value={healthSec}
        onChange={(e) => setHealthSec(Number(e.target.value))}
      />
      <label>Retain releases on disk</label>
      <input
        type="number"
        min={1}
        max={20}
        value={retain}
        onChange={(e) => setRetain(Number(e.target.value))}
      />
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
        Signing key:{" "}
        {u.signing_key_file ? <code>{u.signing_key_file}</code> : "not configured"}.
      </p>
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button
          className="primary"
          disabled={busy || !dirty || !repoValid}
          onClick={() =>
            save(
              {
                updater: {
                  repo,
                  channel,
                  poll_interval_min: pollMin,
                  auto_apply: autoApply,
                  staging_delay_hours: stagingHours,
                  health_check_window_sec: healthSec,
                  retain_releases: retain,
                },
              },
              "Updater settings saved.",
            )
          }
        >
          Save
        </button>
        <RestartBadge label="repo / poll interval / health window changes apply on next restart" />
      </div>
    </div>
  );
}

function VncTile({ cfg, save, busy }: TileProps) {
  const initial = cfg.vnc?.enabled ?? false;
  const [enabled, setEnabled] = useState(initial);
  useEffect(() => setEnabled(initial), [initial]);

  return (
    <div className="tile">
      <h2>VNC</h2>
      <label style={checkboxLabel}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enabled (allow Start VNC from the VNC tab)
      </label>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        Disabling stops a running wayvnc/websockify pair if one is up. Password file:{" "}
        <code>{cfg.vnc?.password_file ?? "(unset)"}</code>.
      </p>
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button
          className="primary"
          disabled={busy || enabled === initial}
          onClick={() => save({ vnc: { enabled } }, "VNC setting saved.")}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function BuiltinsTile({
  cfg,
  builtins,
  save,
  busy,
}: TileProps & { builtins: Builtin[] }) {
  // Show every builtin that ships with the repo so operators can flip
  // family_message and similar opt-in screens without editing yaml.
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});

  const builtinIds = useMemo(() => {
    const fromCfg = Object.keys(cfg.builtins);
    const fromManifests = builtins.map((b) => b.id.replace(/-/g, "_"));
    return Array.from(new Set([...fromCfg, ...fromManifests])).sort();
  }, [cfg.builtins, builtins]);

  function currentEnabled(id: string): boolean {
    return Boolean(
      (cfg.builtins[id] as { enabled?: boolean } | undefined)?.enabled,
    );
  }
  function effective(id: string): boolean {
    return drafts[id] ?? currentEnabled(id);
  }

  const dirty = Object.entries(drafts).some(
    ([id, v]) => v !== currentEnabled(id),
  );

  function descriptionFor(id: string): string | undefined {
    const key = id.replace(/_/g, "-");
    return builtins.find((b) => b.id === key)?.description;
  }

  return (
    <div className="tile">
      <h2>Built-in screens</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        Toggle opt-in features here. Per-screen options (weather coordinates, photo libraries,
        etc.) live on the Screens tab.
      </p>
      {builtinIds.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No built-ins registered.</p>
      ) : (
        builtinIds.map((id) => (
          <label
            key={id}
            style={{
              display: "flex",
              gap: "0.6rem",
              alignItems: "flex-start",
              padding: "0.4rem 0",
              borderTop: "1px solid var(--border)",
            }}
          >
            <input
              type="checkbox"
              checked={effective(id)}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [id]: e.target.checked }))
              }
            />
            <div>
              <div>
                <code>{id}</code>
              </div>
              {descriptionFor(id) && (
                <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                  {descriptionFor(id)}
                </div>
              )}
            </div>
          </label>
        ))
      )}
      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() => {
            const payload: Record<string, { enabled: boolean }> = {};
            for (const [id, v] of Object.entries(drafts)) {
              if (v !== currentEnabled(id)) payload[id] = { enabled: v };
            }
            save({ builtins: payload }, "Built-ins updated.").then(() => setDrafts({}));
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function RestartBadge({ label }: { label?: string } = {}) {
  return (
    <span
      style={{
        marginLeft: "auto",
        color: "var(--muted)",
        fontSize: "0.78rem",
        border: "1px solid var(--border)",
        padding: "0.15rem 0.5rem",
        borderRadius: "0.4rem",
      }}
      title={label}
    >
      {label ? "requires restart" : "applies after restart"}
    </span>
  );
}

type SigningKeyStatus = {
  configured: boolean;
  path?: string;
  fingerprint: string | null;
};

function SigningKeyTile() {
  const [status, setStatus] = useState<SigningKeyStatus | null>(null);
  const [keyText, setKeyText] = useState("");
  const [sigText, setSigText] = useState("");
  const [override, setOverride] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setStatus(await api<SigningKeyStatus>("/api/settings/signing_key"));
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function submit() {
    setErr(null);
    setOkMsg(null);
    if (!keyText.includes("BEGIN PGP PUBLIC KEY BLOCK")) {
      setErr("Paste an ASCII-armored PGP public key (BEGIN PGP PUBLIC KEY BLOCK).");
      return;
    }
    if (status?.configured && !sigText && override !== OVERRIDE_PHRASE) {
      setErr(
        "Rotating an existing key requires either a detached signature from the old key, " +
          "or the explicit override phrase typed in full.",
      );
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, string> = { key: keyText };
      if (sigText) body.signature = sigText;
      if (override) body.override = override;
      await api("/api/settings/signing_key", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setOkMsg(status?.configured ? "Signing key rotated." : "Signing key installed.");
      setKeyText("");
      setSigText("");
      setOverride("");
      refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tile">
      <h2>Signing key</h2>
      {err && <div className="banner">{err}</div>}
      {okMsg && (
        <div
          className="banner"
          style={{
            background: "rgba(79, 140, 255, 0.12)",
            borderColor: "var(--accent)",
            color: "var(--accent)",
          }}
        >
          {okMsg}
        </div>
      )}
      {!status ? (
        "Loading…"
      ) : status.configured ? (
        <p>
          Configured at <code>{status.path}</code>
          {status.fingerprint && (
            <>
              {" "}
              · fingerprint <code>{status.fingerprint}</code>
            </>
          )}
          . Releases without a matching <code>release.asc</code> asset will be refused.
        </p>
      ) : (
        <p style={{ color: "var(--muted)" }}>
          No signing key installed. The updater accepts unsigned tarballs until one is
          configured here or at install time via <code>--signing-key</code>.
        </p>
      )}
      <label style={{ marginTop: "1rem", display: "block" }}>
        New public key (ASCII-armored)
      </label>
      <textarea
        rows={6}
        value={keyText}
        onChange={(e) => setKeyText(e.target.value)}
        placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----&#10;…&#10;-----END PGP PUBLIC KEY BLOCK-----"
        style={textareaStyle}
      />
      {status?.configured && (
        <>
          <p style={{ color: "var(--muted)", marginTop: "1rem", fontSize: "0.85rem" }}>
            Rotation: either paste a detached signature of the new key made with the old
            key, or type the override phrase to disable verification for this rotation.
          </p>
          <label style={{ display: "block" }}>Detached signature (optional)</label>
          <textarea
            rows={5}
            value={sigText}
            onChange={(e) => setSigText(e.target.value)}
            placeholder="-----BEGIN PGP SIGNATURE-----&#10;…&#10;-----END PGP SIGNATURE-----"
            style={textareaStyle}
          />
          <label style={{ marginTop: "0.75rem", display: "block" }}>
            Override (type the exact phrase to skip signature check)
          </label>
          <input
            type="text"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder={OVERRIDE_PHRASE}
          />
        </>
      )}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="primary" onClick={submit} disabled={busy || !keyText}>
          {status?.configured ? "Rotate key" : "Install key"}
        </button>
      </div>
    </div>
  );
}

const textareaStyle: CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "0.4rem",
  padding: "0.5rem",
  fontFamily: "ui-monospace, monospace",
  fontSize: "0.8rem",
  boxSizing: "border-box",
};

const selectStyle: CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "0.4rem",
  marginBottom: "0.75rem",
};

const checkboxLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  margin: "0.5rem 0",
};
