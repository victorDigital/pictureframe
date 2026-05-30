import { useState } from "react";
import type React from "react";
import type { Config } from "../shared";
import { arrayValue, clamp, fetchWithTimeout, numberValue, Shell, stringValue, useEvery } from "../shared";

export function StatusBoardScreen({ config }: { config: Config }) {
  const [results, setResults] = useState<Array<{ entity: Record<string, any>; state?: Record<string, any>; error?: string }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEvery(async () => {
    const base = stringValue(config.ha_base_url).replace(/\/$/, "");
    const token = stringValue(config.ha_token);
    const entities = arrayValue(config.entities) as Array<Record<string, any>>;
    if (!base || !token || !Array.isArray(config.entities)) {
      setError("Configure ha_base_url, ha_token and entities.");
      return;
    }
    if (entities.length === 0) {
      setError("Add at least one entity to the entities list.");
      return;
    }
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    setLoading(true);
    setResults(await Promise.all(entities.map(async (entity) => {
      try {
        const res = await fetchWithTimeout(`${base}/api/states/${encodeURIComponent(String(entity.id))}`, { headers });
        if (!res.ok) return { entity, error: `HTTP ${res.status}` };
        return { entity, state: await res.json() };
      } catch (err) {
        return { entity, error: String(err) };
      }
    })));
    setLoading(false);
    setError("");
  }, 30000);
  const cols = Math.round(clamp(numberValue(config.columns, 3), 1, 6));
  const density = statusDensity(stringValue(config.layout_density, "comfortable"));
  const errorClass = statusErrorClass(stringValue(config.error_styling, "border"));
  return (
    <Shell className="overflow-y-auto">
      <div
        className={`grid h-full w-full content-start p-6 transition-opacity duration-300 ${density.gridGap}`}
        role="list"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, opacity: loading ? 0.65 : 1 }}
      >
        {error ? (
          <StatusTileFrame className={`col-span-full justify-center ${errorClass}`} density={density}>
            <div className={`${density.icon} opacity-80`} aria-hidden="true">⚠️</div>
            <div className={`${density.value} font-light leading-none tracking-tight tabular-nums`}>{error}</div>
            <div className={`${density.label} text-muted-foreground`}>Configuration</div>
          </StatusTileFrame>
        ) : (
          results.map((result, i) => <StatusTile density={density} errorClass={errorClass} key={stringValue(result.entity.id) || i} result={result} valueColor={stringValue(config.value_color, "auto")} globalAccent={stringValue(config.accent_color)} />)
        )}
      </div>
    </Shell>
  );
}

type StatusDensity = {
  gap: string;
  gridGap: string;
  icon: string;
  label: string;
  minH: string;
  pad: string;
  unit: string;
  value: string;
};

function statusDensity(mode: string): StatusDensity {
  if (mode === "compact") {
    return { gap: "gap-2", gridGap: "gap-2", icon: "text-2xl", label: "text-xs", minH: "min-h-[12vh]", pad: "p-3", unit: "text-sm", value: "text-3xl" };
  }
  if (mode === "spacious") {
    return { gap: "gap-4", gridGap: "gap-6", icon: "text-4xl", label: "text-base", minH: "min-h-[20vh]", pad: "p-8", unit: "text-lg", value: "text-5xl" };
  }
  return { gap: "gap-3", gridGap: "gap-4", icon: "text-3xl", label: "text-sm", minH: "min-h-[16vh]", pad: "p-5", unit: "text-base", value: "text-4xl" };
}

function statusErrorClass(mode: string) {
  if (mode === "subtle") return "text-destructive";
  if (mode === "prominent") return "border-2 border-destructive bg-destructive/20 text-destructive ring-2 ring-destructive/30";
  return "border border-destructive bg-destructive/10 text-destructive";
}

function statusValueColor(mode: string) {
  if (mode === "primary") return "text-primary";
  if (mode === "destructive") return "text-destructive";
  return "text-foreground";
}

function StatusTileFrame({
  children,
  className,
  density,
  style,
}: React.PropsWithChildren<{ className?: string; density: StatusDensity; style?: React.CSSProperties }>) {
  return (
    <article
      className={`flex flex-col rounded-xl border border-border bg-card text-card-foreground shadow-sm ${density.pad} ${density.gap} ${density.minH} ${className ?? ""}`}
      role="listitem"
      style={style}
    >
      {children}
    </article>
  );
}

function StatusTile({
  density,
  errorClass,
  globalAccent,
  result,
  valueColor,
}: {
  density: StatusDensity;
  errorClass: string;
  globalAccent: string;
  result: { entity: Record<string, any>; state?: Record<string, any>; error?: string };
  valueColor: string;
}) {
  const unit = stringValue(result.entity.unit) || stringValue(result.state?.attributes?.unit_of_measurement);
  const label = stringValue(result.entity.label) || stringValue(result.state?.attributes?.friendly_name) || stringValue(result.entity.id);
  const accent = stringValue(result.entity.accent_color) || globalAccent;
  const accentStyle = accent ? { borderLeftColor: accent } : undefined;
  const accentClass = accent ? "border-l-4" : "";
  if (result.error) {
    return (
      <StatusTileFrame className={`${accentClass} ${errorClass}`} density={density} style={accentStyle}>
        <div className={`${density.icon} opacity-80`} aria-hidden="true">{stringValue(result.entity.icon, "⚠️")}</div>
        <div className={`${density.value} break-words font-light leading-none tracking-tight tabular-nums`}>{result.error}</div>
        <div className={`${density.label} text-muted-foreground`}>{label}</div>
      </StatusTileFrame>
    );
  }
  return (
    <StatusTileFrame className={accentClass} density={density} style={accentStyle}>
      <div className={`${density.icon} opacity-80`} aria-hidden="true">{stringValue(result.entity.icon, "•")}</div>
      <div className={`${density.value} font-light leading-none tracking-tight tabular-nums ${statusValueColor(valueColor)}`}>
        {stringValue(result.state?.state, "—")}
        {unit ? <span className={`${density.unit} ml-1 font-normal text-muted-foreground`}>{unit}</span> : null}
      </div>
      <div className={`${density.label} text-muted-foreground`}>{label}</div>
    </StatusTileFrame>
  );
}
