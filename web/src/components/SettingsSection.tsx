import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ComputerIcon,
  Download01Icon,
  KeyIcon,
  LogoutIcon,
  Notification01Icon,
  PictureInPictureOnIcon,
  PuzzleIcon,
  Settings02Icon,
  ShieldIcon,
  Sun01Icon,
  Time03Icon,
} from "@hugeicons/core-free-icons";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, setToken } from "../api.js";
import { ConfirmButton } from "./common/ConfirmButton.js";
import { ErrorAlert } from "./common/ErrorAlert.js";
import { PageHeader } from "./common/PageHeader.js";

const OVERRIDE_PHRASE = "I understand this disables verification temporarily";

type FrameConfigView = {
  safe_mode: boolean;
  device: { name: string; bearer_token_file: string };
  display: {
    brightness_backend: "backlight" | "ddcutil" | "none";
    backlight_device: string | null;
    default_brightness: number;
    scale: number;
    orientation: "normal" | "90" | "180" | "270";
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
    scale?: number;
    orientation?: "normal" | "90" | "180" | "270";
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
      setErr(String(e instanceof Error ? e.message : e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function save(patch: ConfigPatch, successMsg?: string) {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/settings/config", { method: "PUT", body: JSON.stringify(patch) });
      await refresh();
      if (successMsg) toast.success(successMsg);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    try {
      const r = await api<{ ok: true; token: string }>("/api/settings/rotate_bearer", {
        method: "POST",
      });
      setToken(r.token);
      setNewToken(r.token);
      toast.success("Bearer token rotated");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <Card><CardContent className="py-6 text-muted-foreground">Loading…</CardContent></Card>;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Device configuration. Changes are validated against the frame schema."
        actions={
          <ConfirmButton
            variant="destructive"
            size="sm"
            destructive
            title="Sign out of the control panel?"
            description="This clears the bearer token from your browser. Other sessions are unaffected."
            confirmLabel="Sign out"
            onConfirm={onSignOut}
          >
            <HugeiconsIcon icon={LogoutIcon} strokeWidth={2} />
            Sign out
          </ConfirmButton>
        }
      />

      {cfg.safe_mode && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Safe mode</AlertTitle>
          <AlertDescription>
            Config edits are disabled until <code className="rounded bg-muted px-1">frame.yaml</code>
            {" "}validates.
          </AlertDescription>
        </Alert>
      )}

      <BearerTokenTile
        cfg={cfg}
        busy={busy}
        onRotate={rotate}
        newToken={newToken}
        err={err}
        onClearErr={() => setErr(null)}
      />

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

type TileProps = {
  cfg: FrameConfigView;
  save: (patch: ConfigPatch, msg?: string) => Promise<void>;
  busy: boolean;
};

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof KeyIcon;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-muted-foreground">
          <HugeiconsIcon icon={Icon} strokeWidth={2} className="size-4" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function BearerTokenTile({
  cfg,
  busy,
  onRotate,
  newToken,
  err,
  onClearErr,
}: {
  cfg: FrameConfigView;
  busy: boolean;
  onRotate: () => void;
  newToken: string | null;
  err: string | null;
  onClearErr: () => void;
}) {
  return (
    <SettingsCard
      icon={KeyIcon}
      title="Bearer token"
      description="Rotating signs out every other session (mobile app, HA integration, other browsers). Your current session is updated automatically."
    >
      {err && <ErrorAlert message={err} onDismiss={onClearErr} />}
      {newToken && (
        <Alert>
          <HugeiconsIcon icon={KeyIcon} strokeWidth={2} />
          <AlertTitle>New token</AlertTitle>
          <AlertDescription>
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{newToken}</code>
            <div className="mt-1 text-[10px]">
              Saved to <code>{cfg.device.bearer_token_file}</code>. Update every other client.
            </div>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <ConfirmButton
          variant="outline"
          destructive
          title="Rotate the bearer token?"
          description="All other browser sessions will be signed out — including any mobile app or Home Assistant integration using this token."
          confirmLabel="Rotate"
          disabled={busy}
          onConfirm={onRotate}
        >
          <HugeiconsIcon icon={KeyIcon} strokeWidth={2} />
          Rotate token
        </ConfirmButton>
      </div>
    </SettingsCard>
  );
}

function DeviceTile({ cfg, save, busy }: TileProps) {
  const [name, setName] = useState(cfg.device.name);
  useEffect(() => setName(cfg.device.name), [cfg.device.name]);

  return (
    <SettingsCard icon={Settings02Icon} title="Device">
      <Field
        label="Name"
        hint="Used as the MQTT node id and Home Assistant device name. Restart required to re-publish discovery topics."
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="living-room-frame"
        />
      </Field>
      <p className="text-[10px] text-muted-foreground">
        Bearer token file: <code className="rounded bg-muted px-1">{cfg.device.bearer_token_file}</code>
      </p>
      <div className="flex items-center gap-2 pt-1">
        <Button
          disabled={busy || name === cfg.device.name || !name.trim()}
          onClick={() => save({ device: { name: name.trim() } }, "Device name saved.")}
        >
          Save
        </Button>
        <RestartBadge />
      </div>
    </SettingsCard>
  );
}

function DisplayTile({ cfg, save, busy }: TileProps) {
  const [backend, setBackend] = useState(cfg.display.brightness_backend);
  const [device, setDevice] = useState(cfg.display.backlight_device ?? "");
  const [defaultB, setDefaultB] = useState(cfg.display.default_brightness);
  const [scale, setScale] = useState(cfg.display.scale);
  const [orientation, setOrientation] = useState(cfg.display.orientation);

  useEffect(() => setBackend(cfg.display.brightness_backend), [cfg.display.brightness_backend]);
  useEffect(() => setDevice(cfg.display.backlight_device ?? ""), [cfg.display.backlight_device]);
  useEffect(() => setDefaultB(cfg.display.default_brightness), [cfg.display.default_brightness]);
  useEffect(() => setScale(cfg.display.scale), [cfg.display.scale]);
  useEffect(() => setOrientation(cfg.display.orientation), [cfg.display.orientation]);

  const dirty =
    backend !== cfg.display.brightness_backend ||
    device !== (cfg.display.backlight_device ?? "") ||
    defaultB !== cfg.display.default_brightness ||
    scale !== cfg.display.scale ||
    orientation !== cfg.display.orientation;

  return (
    <SettingsCard icon={Sun01Icon} title="Display">
      <Field label="Brightness backend">
        <Select
          value={backend}
          onValueChange={(v) =>
            setBackend(v as FrameConfigView["display"]["brightness_backend"])
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="backlight">backlight (sysfs)</SelectItem>
            <SelectItem value="ddcutil">ddcutil (external monitor)</SelectItem>
            <SelectItem value="none">none</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {backend === "backlight" && (
        <Field label="Backlight device path">
          <Input
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            placeholder="/sys/class/backlight/intel_backlight"
          />
        </Field>
      )}
      <Field label={`Default brightness (${defaultB}%)`}>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[defaultB]}
          onValueChange={(v) => setDefaultB(v[0] ?? defaultB)}
        />
      </Field>
      <Field label="Screen scale">
        <Input
          type="number"
          min={0.5}
          max={4}
          step={0.05}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
        />
      </Field>
      <Field label="Screen orientation">
        <Select
          value={orientation}
          onValueChange={(v) =>
            setOrientation(v as FrameConfigView["display"]["orientation"])
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">normal</SelectItem>
            <SelectItem value="90">90 degrees</SelectItem>
            <SelectItem value="180">180 degrees</SelectItem>
            <SelectItem value="270">270 degrees</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex items-center gap-2 pt-1">
        <Button
          disabled={busy || !dirty}
          onClick={() =>
            save(
              {
                display: {
                  brightness_backend: backend,
                  backlight_device: device || undefined,
                  default_brightness: defaultB,
                  scale,
                  orientation,
                },
              },
              "Display settings saved.",
            )
          }
        >
          Save
        </Button>
      </div>
    </SettingsCard>
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
  useEffect(
    () => setMaxPre(cfg.scheduler.max_preloaded_url_screens),
    [cfg.scheduler.max_preloaded_url_screens],
  );

  const dirty =
    defaultScreen !== cfg.default_screen ||
    pinned !== cfg.manual_pinned_timeout_hours ||
    maxPre !== cfg.scheduler.max_preloaded_url_screens;

  return (
    <SettingsCard icon={Time03Icon} title="Scheduler">
      <Field label="Default screen" hint="Shown when nothing else is claiming.">
        <Select value={defaultScreen} onValueChange={setDefaultScreen}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {screens.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} <span className="text-muted-foreground">({s.id})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Manual-pinned timeout (hours)">
        <Input
          type="number"
          min={0}
          max={168}
          value={pinned}
          onChange={(e) => setPinned(Number(e.target.value))}
        />
      </Field>
      <Field label="Max preloaded URL screens">
        <Input
          type="number"
          min={1}
          max={20}
          value={maxPre}
          onChange={(e) => setMaxPre(Number(e.target.value))}
        />
      </Field>
      <div className="flex items-center gap-2 pt-1">
        <Button
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
        </Button>
      </div>
    </SettingsCard>
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
    <SettingsCard icon={Notification01Icon} title="Home Assistant (MQTT)">
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div>
          <div className="text-xs font-medium">Enabled</div>
          <div className="text-[10px] text-muted-foreground">
            Connects to the MQTT broker and publishes discovery topics.
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <Field label="Broker host (hostname or IPv4)">
        <Input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="homeassistant.local"
          aria-invalid={host !== "" && !hostValid}
        />
        {host !== "" && !hostValid && (
          <p className="text-[10px] text-destructive">Must be a hostname or IPv4 address.</p>
        )}
      </Field>
      <Field label="Port">
        <Input
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
      </Field>
      <Field label="Username">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="frame"
        />
      </Field>
      <Field label="Keepalive (seconds)">
        <Input
          type="number"
          min={5}
          max={3600}
          value={keepalive}
          onChange={(e) => setKeepalive(Number(e.target.value))}
        />
      </Field>
      <Field label="Discovery prefix">
        <Input
          value={discoveryPrefix}
          onChange={(e) => setDiscoveryPrefix(e.target.value)}
          placeholder="homeassistant"
        />
      </Field>
      <p className="text-[10px] text-muted-foreground">
        Password file: <code className="rounded bg-muted px-1">{initial.mqtt?.password_file ?? "(unset)"}</code>
        {" "}— edit on disk or via the install script. Bearer-token endpoints do not surface secret
        bytes.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <Button
          disabled={busy || !dirty || (enabled && (!host || !hostValid || !username))}
          onClick={submit}
        >
          Save
        </Button>
      </div>
    </SettingsCard>
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
    <SettingsCard icon={Download01Icon} title="Updater">
      <Field label="GitHub repo (owner/repo)">
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="victorDigital/pictureframe"
          aria-invalid={!repoValid}
        />
        {!repoValid && (
          <p className="text-[10px] text-destructive">
            Format must be <code>owner/repo</code>.
          </p>
        )}
      </Field>
      <Field label="Channel">
        <Select value={channel} onValueChange={(v) => setChannel(v as "stable" | "beta")}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stable">stable</SelectItem>
            <SelectItem value="beta">beta</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div>
          <div className="text-xs font-medium">Auto-apply</div>
          <div className="text-[10px] text-muted-foreground">
            Apply releases automatically once past the staging delay.
          </div>
        </div>
        <Switch checked={autoApply} onCheckedChange={setAutoApply} />
      </div>
      <Field label="Poll interval (minutes)">
        <Input
          type="number"
          min={1}
          max={1440}
          value={pollMin}
          onChange={(e) => setPollMin(Number(e.target.value))}
        />
      </Field>
      <Field label="Staging delay (hours)">
        <Input
          type="number"
          min={0}
          max={720}
          value={stagingHours}
          onChange={(e) => setStagingHours(Number(e.target.value))}
        />
      </Field>
      <Field label="Health check window (seconds)">
        <Input
          type="number"
          min={5}
          max={3600}
          value={healthSec}
          onChange={(e) => setHealthSec(Number(e.target.value))}
        />
      </Field>
      <Field label="Retain releases on disk">
        <Input
          type="number"
          min={1}
          max={20}
          value={retain}
          onChange={(e) => setRetain(Number(e.target.value))}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground">
        Signing key:{" "}
        {u.signing_key_file ? (
          <code className="rounded bg-muted px-1">{u.signing_key_file}</code>
        ) : (
          "not configured"
        )}
        .
      </p>
      <div className="flex items-center gap-2 pt-1">
        <Button
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
        </Button>
        <RestartBadge label="repo / poll interval / health window changes apply on next restart" />
      </div>
    </SettingsCard>
  );
}

function VncTile({ cfg, save, busy }: TileProps) {
  const initial = cfg.vnc?.enabled ?? false;
  const [enabled, setEnabled] = useState(initial);
  useEffect(() => setEnabled(initial), [initial]);

  return (
    <SettingsCard icon={ComputerIcon} title="VNC">
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div>
          <div className="text-xs font-medium">Enabled</div>
          <div className="text-[10px] text-muted-foreground">
            Allows Start VNC from the VNC tab. Disabling stops a running wayvnc/websockify pair.
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Password file:{" "}
        <code className="rounded bg-muted px-1">{cfg.vnc?.password_file ?? "(unset)"}</code>
        .
      </p>
      <div className="flex items-center gap-2 pt-1">
        <Button
          disabled={busy || enabled === initial}
          onClick={() => save({ vnc: { enabled } }, "VNC setting saved.")}
        >
          Save
        </Button>
      </div>
    </SettingsCard>
  );
}

function BuiltinsTile({
  cfg,
  builtins,
  save,
  busy,
}: TileProps & { builtins: Builtin[] }) {
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

  const dirty = Object.entries(drafts).some(([id, v]) => v !== currentEnabled(id));

  function descriptionFor(id: string): string | undefined {
    const key = id.replace(/_/g, "-");
    return builtins.find((b) => b.id === key)?.description;
  }

  return (
    <SettingsCard
      icon={PuzzleIcon}
      title="Built-in screens"
      description="Toggle opt-in features here. Per-screen options (weather coordinates, photo libraries, etc.) live on the Screens tab."
    >
      {builtinIds.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">No built-ins registered.</p>
      ) : (
        <div className="divide-y divide-border/60">
          {builtinIds.map((id) => (
            <div key={id} className="flex items-start gap-3 py-2 first:pt-0">
              <Switch
                checked={effective(id)}
                onCheckedChange={(checked) =>
                  setDrafts((d) => ({ ...d, [id]: checked }))
                }
              />
              <div className="flex-1">
                <code className="text-xs font-medium">{id}</code>
                {descriptionFor(id) && (
                  <p className="text-[10px] text-muted-foreground">{descriptionFor(id)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button
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
        </Button>
      </div>
    </SettingsCard>
  );
}

function RestartBadge({ label }: { label?: string } = {}) {
  return (
    <Badge variant="outline" className="ml-auto" title={label}>
      {label ? "requires restart" : "applies after restart"}
    </Badge>
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
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setStatus(await api<SigningKeyStatus>("/api/settings/signing_key"));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function submit() {
    setErr(null);
    if (!keyText.includes("BEGIN PGP PUBLIC KEY BLOCK")) {
      setErr("Paste an ASCII-armored PGP public key (BEGIN PGP PUBLIC KEY BLOCK).");
      return;
    }
    if (status?.configured && !sigText && override !== OVERRIDE_PHRASE) {
      setErr(
        "Rotating an existing key requires either a detached signature from the old key, or the explicit override phrase typed in full.",
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
      toast.success(status?.configured ? "Signing key rotated." : "Signing key installed.");
      setKeyText("");
      setSigText("");
      setOverride("");
      refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard icon={ShieldIcon} title="Signing key">
      {err && <ErrorAlert message={err} onDismiss={() => setErr(null)} />}
      {!status ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : status.configured ? (
        <p className="text-xs">
          Configured at <code className="rounded bg-muted px-1">{status.path}</code>
          {status.fingerprint && (
            <>
              {" · fingerprint "}
              <code className="rounded bg-muted px-1">{status.fingerprint}</code>
            </>
          )}
          . Releases without a matching <code className="rounded bg-muted px-1">release.asc</code>
          {" "}asset will be refused.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          No signing key installed. The updater accepts unsigned tarballs until one is configured
          here or at install time via <code className="rounded bg-muted px-1">--signing-key</code>.
        </p>
      )}
      <Separator />
      <Field label="New public key (ASCII-armored)">
        <Textarea
          rows={6}
          value={keyText}
          onChange={(e) => setKeyText(e.target.value)}
          placeholder={"-----BEGIN PGP PUBLIC KEY BLOCK-----\n…\n-----END PGP PUBLIC KEY BLOCK-----"}
          className="font-mono text-[11px]"
        />
      </Field>
      {status?.configured && (
        <>
          <p className="text-[10px] text-muted-foreground">
            Rotation: either paste a detached signature of the new key made with the old key, or
            type the override phrase to disable verification for this rotation.
          </p>
          <Field label="Detached signature (optional)">
            <Textarea
              rows={5}
              value={sigText}
              onChange={(e) => setSigText(e.target.value)}
              placeholder={"-----BEGIN PGP SIGNATURE-----\n…\n-----END PGP SIGNATURE-----"}
              className="font-mono text-[11px]"
            />
          </Field>
          <Field
            label="Override (type the exact phrase to skip signature check)"
            hint={`Required if no detached signature is provided. Phrase: "${OVERRIDE_PHRASE}".`}
          >
            <Input
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder={OVERRIDE_PHRASE}
            />
          </Field>
        </>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button onClick={submit} disabled={busy || !keyText}>
          <HugeiconsIcon icon={ShieldIcon} strokeWidth={2} />
          {status?.configured ? "Rotate key" : "Install key"}
        </Button>
      </div>
    </SettingsCard>
  );
}
