import { useEffect, useState } from "react";
import type { Config } from "../shared";
import { boolValue, clamp, isCssColor, numberValue, Shell, stringValue } from "../shared";

export function DoorbellScreen({ config }: { config: Config }) {
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(() => clamp(numberValue(config.auto_dismiss_seconds, 60), 5, 600));
  const snapshot = stringValue(config.snapshot_url);
  const isStream = boolValue(config.is_stream, false);
  const refreshMs = Math.max(200, numberValue(config.refresh_ms, 1000));
  const [src, setSrc] = useState(snapshot);
  const showCountdown = boolValue(config.show_countdown, false) && Number(config.auto_dismiss_seconds) > 0;
  useEffect(() => {
    if (!snapshot) return;
    if (isStream) {
      setSrc(snapshot);
      return;
    }
    const pull = () => {
      const sep = snapshot.includes("?") ? "&" : "?";
      setSrc(`${snapshot}${sep}_t=${Date.now()}`);
    };
    pull();
    const timer = setInterval(pull, refreshMs);
    return () => clearInterval(timer);
  }, [isStream, refreshMs, snapshot]);
  useEffect(() => {
    if (!showCountdown) return;
    setRemaining(clamp(numberValue(config.auto_dismiss_seconds, 60), 5, 600));
    const timer = setInterval(() => setRemaining((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [config.auto_dismiss_seconds, showCountdown]);
  if (!snapshot) return <DoorbellError message="Configure snapshot_url" />;
  if (error) return <DoorbellError message={error} />;
  const style = stringValue(config.alert_style, "banner");
  const label = stringValue(config.label, "Doorbell");
  const alert = doorbellAlertClasses(style, isCssColor(config.accent_color));
  return (
    <Shell className="relative bg-black">
      <img className="h-full w-full object-contain" src={isStream ? snapshot : src} alt="" onError={() => setError("Camera feed unavailable")} />
      {style === "pulse" ? <div className="pointer-events-none fixed inset-0 z-10 pulse-vignette" aria-hidden="true" /> : null}
      <div className={alert.wrap} role="status" aria-live="polite">
        <div className={alert.inner}>
          {alert.icon ? <img className="doorbell-ring size-8 shrink-0 opacity-90" src="/builtin/doorbell/assets/doorbell.svg" alt="" /> : null}
          <span className={alert.label}>{label}</span>
          {showCountdown ? <span className="text-xl font-medium opacity-90 tabular-nums">{formatCountdown(remaining)}</span> : null}
        </div>
      </div>
    </Shell>
  );
}

function doorbellAlertClasses(style: string, useAccent: boolean) {
  if (style === "badge") {
    return {
      wrap: "pointer-events-none fixed right-4 top-4 z-20 max-w-2xl",
      inner: `flex items-center gap-3 rounded-2xl border px-5 py-3 text-primary-foreground shadow-xl ${useAccent ? "border-primary bg-primary" : "border-destructive bg-destructive"}`,
      label: "alert-label-compact font-semibold tracking-wide",
      icon: true,
    };
  }
  if (style === "pulse") {
    return {
      wrap: "pointer-events-none fixed left-0 right-0 top-4 z-20 flex justify-center px-4",
      inner: `pulse-frame flex items-center gap-3 rounded-2xl border-2 px-8 py-4 text-primary-foreground opacity-90 shadow-2xl backdrop-blur-md ${useAccent ? "border-primary bg-primary" : "border-destructive bg-destructive"}`,
      label: "alert-label animate-pulse font-bold uppercase tracking-widest",
      icon: true,
    };
  }
  return {
    wrap: `pointer-events-none fixed inset-x-0 top-0 z-20 border-b text-primary-foreground opacity-90 shadow-lg backdrop-blur-md ${useAccent ? "border-primary bg-primary" : "border-destructive bg-destructive"}`,
    inner: "flex items-center justify-center gap-3 px-6 py-4",
    label: "alert-label font-bold uppercase tracking-widest",
    icon: false,
  };
}

function DoorbellError({ message }: { message: string }) {
  return (
    <Shell className="grid place-items-center p-8">
      <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
        <img className="size-16 opacity-80" src="/builtin/doorbell/assets/doorbell.svg" alt="" />
        <p className="text-2xl font-medium text-destructive">{message}</p>
        <p className="text-lg text-muted-foreground">
          Set <code className="rounded-md bg-muted px-2 py-1 text-foreground">snapshot_url</code> in the screen config.
        </p>
      </div>
    </Shell>
  );
}

function formatCountdown(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes > 0 ? `${minutes}:` : ""}${String(seconds).padStart(2, "0")}`;
}
