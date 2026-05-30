import { useState } from "react";
import type { Config } from "../shared";
import { boolValue, clamp, ErrorPanel, fetchWithTimeout, formatTime, numberValue, Shell, stringValue, useEvery } from "../shared";

type TransitDeparture = { when?: string; line?: string; destination?: string; minutes?: number; status?: string; cancelled?: boolean; late?: boolean };
type TransitStatus = "on_time" | "late" | "cancelled";

export function TransitScreen({ config }: { config: Config }) {
  const [data, setData] = useState<{ stops?: Array<{ name?: string; departures?: TransitDeparture[] }> } | null>(null);
  const [error, setError] = useState("");
  const refresh = Math.max(15, numberValue(config.refresh_sec, 60)) * 1000;
  const compact = boolValue(config.compact_mode, false);
  const max = Math.round(clamp(numberValue(config.max_per_stop, 4), 1, 12));
  const statusColors = {
    cancelled: stringValue(config.cancelled_color, "var(--destructive)"),
    imminent: "var(--primary)",
    late: stringValue(config.late_color, "var(--primary)"),
    on_time: stringValue(config.on_time_color, "var(--foreground)"),
  };
  useEvery(async () => {
    const feed = stringValue(config.feed_url);
    if (!feed) {
      setError("Configure feed_url.");
      return;
    }
    try {
      const res = await fetchWithTimeout(feed, {}, 15000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError("");
    } catch (err) {
      setError(`Could not load transit: ${err}`);
    }
  }, refresh);
  if (error) return <ErrorPanel message={error} />;
  const stops = data?.stops ?? [];
  return (
    <Shell className={`flex flex-col overflow-y-auto px-10 py-10 ${compact ? "gap-4" : "gap-8"}`}>
      {stops.length === 0 ? (
        <p className="text-base italic text-muted-foreground">No stops configured.</p>
      ) : (
        stops.map((stop, idx) => (
          <section key={`${stop.name}-${idx}`} className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
            <h2 className={compact ? "text-xl font-light tracking-tight" : "text-3xl font-light tracking-tight"}>{stop.name ?? "Stop"}</h2>
            {(stop.departures ?? []).length === 0 ? (
              <p className="text-base italic text-muted-foreground">No upcoming departures.</p>
            ) : (
              <div className={`divide-y divide-border/60 rounded-xl border border-border/60 bg-card/40 ${compact ? "px-4 py-1" : "px-5 py-2"}`}>
                {(stop.departures ?? []).slice(0, max).map((dep, i) => (
                  <TransitDepartureRow
                    badgeStyle={stringValue(config.line_badge_style, "filled")}
                    compact={compact}
                    dep={dep}
                    key={`${dep.line ?? ""}-${dep.destination ?? ""}-${dep.when ?? dep.minutes ?? i}`}
                    statusColors={statusColors}
                  />
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </Shell>
  );
}

function TransitDepartureRow({
  badgeStyle,
  compact,
  dep,
  statusColors,
}: {
  badgeStyle: string;
  compact: boolean;
  dep: TransitDeparture;
  statusColors: Record<TransitStatus | "imminent", string>;
}) {
  const status = depStatus(dep);
  const minutes = depMinutes(dep);
  const imminent = minutes != null && minutes <= 5 && status !== "cancelled";
  const color = imminent ? statusColors.imminent : statusColors[status];
  return (
    <div className={`flex items-baseline ${compact ? "gap-4 py-[0.35rem]" : "gap-6 py-[0.65rem]"}`}>
      <span className={lineBadgeClass(badgeStyle)}>{dep.line ?? "—"}</span>
      <span
        className={`min-w-0 flex-1 truncate ${compact ? "text-base" : "text-lg"} ${status === "cancelled" ? "line-through opacity-70" : ""}`}
        style={status === "cancelled" ? { color } : undefined}
      >
        {dep.destination ?? ""}
      </span>
      <span
        className={`shrink-0 whitespace-nowrap tabular-nums ${compact ? "text-base" : "text-lg"} ${
          status === "cancelled" ? "line-through opacity-85" : imminent || status === "late" ? "font-semibold" : ""
        }`}
        style={{ color }}
      >
        {depWhen(dep)}
      </span>
    </div>
  );
}

function lineBadgeClass(style: string) {
  const base = "inline-flex min-w-[3.25rem] shrink-0 items-center justify-center whitespace-nowrap px-[0.55em] py-[0.15em] text-lg font-semibold tabular-nums leading-[1.2]";
  if (style === "outline") return `${base} rounded-sm border border-primary/45 bg-transparent text-primary`;
  if (style === "pill") return `${base} rounded-full bg-primary/20 text-primary`;
  if (style === "square") return `${base} rounded-none bg-primary/20 text-primary`;
  if (style === "minimal") return "inline-flex shrink-0 items-center justify-center whitespace-nowrap px-0 py-[0.15em] text-lg font-bold tabular-nums leading-[1.2] text-primary";
  return `${base} rounded-sm bg-primary/20 text-primary`;
}

function depStatus(dep: TransitDeparture): TransitStatus {
  const raw = dep.status ?? (dep.cancelled ? "cancelled" : dep.late ? "late" : null);
  if (!raw) return "on_time";
  const s = String(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "canceled" || s === "cancelled") return "cancelled";
  if (s === "late" || s === "delayed" || s === "delay") return "late";
  return "on_time";
}

function depMinutes(dep: TransitDeparture) {
  if (typeof dep.minutes === "number") return dep.minutes;
  if (!dep.when) return null;
  const d = new Date(dep.when);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 60000);
}

function depWhen(dep: TransitDeparture) {
  if (depStatus(dep) === "cancelled") return "Cancelled";
  if (typeof dep.minutes === "number") return dep.minutes <= 0 ? "now" : `${dep.minutes} min`;
  if (dep.when) {
    const d = new Date(dep.when);
    if (!Number.isNaN(d.getTime())) {
      const mins = Math.round((d.getTime() - Date.now()) / 60000);
      if (mins <= 0) return "now";
      if (mins < 60) return `${mins} min`;
      return formatTime(d);
    }
  }
  return "—";
}
