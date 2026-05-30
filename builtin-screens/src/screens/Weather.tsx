import { useState } from "react";
import { EMOJI, SUMMARY as WEATHER_SUMMARY, weatherIconSvg } from "../../weather/assets/icons.js";
import type { Config } from "../shared";
import { clamp, fetchWithTimeout, numberValue, Shell, stringValue, useEvery } from "../shared";

const emojiByCode = EMOJI as Record<number, string>;
export const weatherSummaryByCode = WEATHER_SUMMARY as Record<number, string>;

export function WeatherScreen({ config }: { config: Config }) {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState("");
  const days = Math.round(clamp(numberValue(config.forecast_days, 5), 1, 7));
  const iconStyle = stringValue(config.icon_style, "line");
  useEvery(async () => {
    if (config.latitude == null || config.longitude == null) {
      setError("Configure latitude and longitude.");
      return;
    }
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(config.latitude));
    url.searchParams.set("longitude", String(config.longitude));
    url.searchParams.set("current", "temperature_2m,weather_code,apparent_temperature");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
    url.searchParams.set("forecast_days", String(days));
    url.searchParams.set("temperature_unit", stringValue(config.units, "metric") === "imperial" ? "fahrenheit" : "celsius");
    url.searchParams.set("timezone", "auto");
    try {
      const res = await fetchWithTimeout(url, {}, 15000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError("");
    } catch (err) {
      setError(`Could not load weather: ${err}`);
    }
  }, 15 * 60 * 1000);
  const current = data?.current;
  const code = Number(current?.weather_code ?? 0);
  const apparent = Number(current?.apparent_temperature);
  const temp = Number(current?.temperature_2m);
  const unit = stringValue(data?.current_units?.temperature_2m, "°");
  const feelsLike =
    Number.isFinite(apparent) && Number.isFinite(temp) && Math.abs(Math.round(apparent) - Math.round(temp)) >= 2
      ? ` · Feels like ${Math.round(apparent)}${unit}`
      : "";
  const location =
    stringValue(config.location_label) ||
    (config.latitude != null && config.longitude != null
      ? `${Number(config.latitude).toFixed(2)}, ${Number(config.longitude).toFixed(2)}`
      : "");
  return (
    <Shell className="flex flex-col justify-between gap-8 p-8">
      <section className="flex min-h-0 flex-1 items-center gap-8">
        <div className="grid h-[clamp(5rem,calc(18vw*var(--font-scale,1)),14rem)] w-[clamp(5rem,calc(18vw*var(--font-scale,1)),14rem)] shrink-0 place-items-center text-[clamp(5rem,calc(18vw*var(--font-scale,1)),14rem)] leading-none text-primary">
          {data ? <WeatherIcon code={code} iconStyle={iconStyle} className="h-full w-full" /> : "…"}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="text-[clamp(5rem,calc(14vw*var(--font-scale,1)),18rem)] font-light leading-none tabular-nums text-foreground">
            {current ? Math.round(temp) : "--"}
            <span className="text-primary opacity-80">{unit}</span>
          </div>
          <div className="truncate text-[clamp(1.1rem,calc(1.8vw*var(--font-scale,1)),2rem)] font-medium text-muted-foreground">{location}</div>
          <div className={`text-[clamp(0.95rem,calc(1.1vw*var(--font-scale,1)),1.25rem)] leading-relaxed ${error ? "text-destructive" : "text-muted-foreground"}`}>
            {error || `${weatherSummaryByCode[code] ?? ""}${feelsLike}`}
          </div>
        </div>
      </section>
      <section className="grid shrink-0 gap-3" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
        {data?.daily?.time?.slice(0, days).map((time: string, i: number) => {
          const dayCode = Number(data.daily.weather_code[i]);
          return (
            <article key={time} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-4 text-center">
              <div className="text-sm uppercase tracking-wide text-muted-foreground">{new Date(time).toLocaleDateString(undefined, { weekday: "short" })}</div>
              <div
                className={`grid h-[clamp(2rem,calc(4vw*var(--font-scale,1)),3.5rem)] w-[clamp(2rem,calc(4vw*var(--font-scale,1)),3.5rem)] place-items-center text-primary ${
                  iconStyle === "emoji" ? "text-[clamp(2rem,calc(4vw*var(--font-scale,1)),3.5rem)] leading-none" : ""
                }`}
              >
                <WeatherIcon code={dayCode} iconStyle={iconStyle} className="h-full w-full" />
              </div>
              <div className="text-3xl tabular-nums">{Math.round(Number(data.daily.temperature_2m_max[i]))}°</div>
              <div className="text-sm tabular-nums text-muted-foreground">{Math.round(Number(data.daily.temperature_2m_min[i]))}°</div>
            </article>
          );
        })}
      </section>
    </Shell>
  );
}

export function WeatherIcon({ code, iconStyle, className }: { code: number; iconStyle: string; className: string }) {
  if (iconStyle === "emoji") return <>{emojiByCode[code] ?? "?"}</>;
  const style = iconStyle === "filled" ? "filled" : "line";
  return <span dangerouslySetInnerHTML={{ __html: weatherIconSvg(code, style, className) }} />;
}
