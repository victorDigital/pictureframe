import { useState } from "react";
import type { Config } from "../shared";
import { clamp, fetchWithTimeout, formatDate, formatTime, numberValue, Shell, stringValue, useEvery } from "../shared";
import { WeatherIcon, weatherSummaryByCode } from "./Weather";

type CalEvent = { summary: string; location?: string; start: Date; end?: Date; allDay: boolean };

export function CalendarScreen({ config }: { config: Config }) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [message, setMessage] = useState("Loading...");
  const [error, setError] = useState(false);
  useEvery(async () => {
    const url = stringValue(config.ical_url);
    if (!url) {
      setError(false);
      setMessage("Configure ical_url to show events.");
      return;
    }
    setError(false);
    setMessage("Loading...");
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = filterEvents(
        parseIcs(await res.text()),
        Math.round(clamp(numberValue(config.horizon_days, 14), 1, 30)),
        Math.round(clamp(numberValue(config.max_events, 12), 1, 50)),
      );
      setEvents(next);
      setMessage(next.length === 0 ? "Nothing scheduled." : "");
    } catch (err) {
      setError(true);
      setMessage(`Could not load calendar: ${err}`);
    }
  }, 10 * 60 * 1000);
  return (
    <Shell className="grid grid-rows-[auto_1fr] gap-4 overflow-hidden px-8 py-6">
      <header className="shrink-0 border-b border-border/60 pb-4">
        <h1 className="text-4xl font-light tracking-tight">{stringValue(config.title, "Upcoming")}</h1>
      </header>
      <main className="min-h-0 overflow-y-auto">
        {message ? (
          <div className={error ? "text-base text-destructive" : "text-base italic text-muted-foreground"}>{message}</div>
        ) : (
          <CalendarEvents config={config} events={events} />
        )}
      </main>
    </Shell>
  );
}

export function AgendaBoardScreen({ config }: { config: Config }) {
  const [now, setNow] = useState(new Date());
  const [weather, setWeather] = useState<Record<string, any> | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [weatherError, setWeatherError] = useState("");
  const [agendaMessage, setAgendaMessage] = useState("Loading agenda...");
  const layout = ["split-2", "split-3", "stacked"].includes(stringValue(config.layout)) ? stringValue(config.layout) : "split-2";
  useEvery(() => setNow(new Date()), 30000);
  useEvery(async () => {
    if (config.latitude == null || config.longitude == null) {
      setWeatherError("Configure latitude and longitude.");
      return;
    }
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(config.latitude));
    url.searchParams.set("longitude", String(config.longitude));
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("temperature_unit", stringValue(config.units, "metric") === "imperial" ? "fahrenheit" : "celsius");
    url.searchParams.set("timezone", "auto");
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWeather(await res.json());
      setWeatherError("");
    } catch {
      setWeatherError("Could not load weather.");
    }
  }, 15 * 60 * 1000);
  useEvery(async () => {
    const url = stringValue(config.ical_url);
    if (!url) {
      setAgendaMessage("Configure ical_url to show events.");
      return;
    }
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = filterAgendaEvents(parseIcs(await res.text()), Math.round(clamp(numberValue(config.events_to_show, 6), 1, 12)));
      setEvents(next);
      setAgendaMessage(next.length === 0 ? "Nothing on the schedule." : "");
    } catch (err) {
      setAgendaMessage(`Could not load calendar: ${err}`);
    }
  }, 10 * 60 * 1000);
  const clock = <AgendaClockPanel now={now} />;
  const weatherPanel = <AgendaWeatherPanel config={config} error={weatherError} weather={weather} />;
  const agenda = <AgendaPanel events={events} layout={layout} message={agendaMessage} />;
  if (layout === "split-3") {
    return <Shell className="grid grid-cols-3 gap-6 p-8">{clock}{weatherPanel}{agenda}</Shell>;
  }
  if (layout === "stacked") {
    return <Shell className="flex flex-col items-center justify-center gap-6 p-8 text-center">{clock}{weatherPanel}{agenda}</Shell>;
  }
  return (
    <Shell className="grid grid-rows-[auto_1fr] gap-6 p-8">
      <header className="grid grid-cols-2 items-end gap-6">{clock}{weatherPanel}</header>
      {agenda}
    </Shell>
  );
}

function CalendarEvents({ config, events }: { config: Config; events: CalEvent[] }) {
  const layout = stringValue(config.layout, "agenda");
  if (layout === "grid") return <CalendarGrid config={config} events={events} />;
  if (layout === "compact") return <CalendarCompact events={events} />;
  return <CalendarAgenda config={config} events={events} />;
}

function CalendarAgenda({ config, events }: { config: Config; events: CalEvent[] }) {
  if (config.group_by_day === false) {
    return <>{events.map((ev, index) => <CalendarEventRow bordered={index > 0} config={config} event={ev} key={`${ev.start.toISOString()}-${ev.summary}`} showDay />)}</>;
  }
  return (
    <>
      {groupCalendarEvents(events).map(([date, items], index) => (
        <section key={date}>
          <div className={`mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground ${index === 0 ? "" : "mt-6"}`}>{fmtDayLabel(date)}</div>
          <CalendarAllDaySection config={config} items={items} />
          <CalendarTimedEvents bordered config={config} items={items} />
        </section>
      ))}
    </>
  );
}

function CalendarEventRow({ bordered = false, config, event, showDay = false }: { bordered?: boolean; config: Config; event: CalEvent; showDay?: boolean }) {
  const compact = stringValue(config.density, "comfortable") === "compact";
  const handling = stringValue(config.all_day_handling, "inline");
  const titleClass = compact ? "text-sm font-medium leading-snug" : "text-lg font-medium leading-snug";
  const locClass = compact ? "mt-0.5 text-xs text-muted-foreground" : "mt-1 text-sm text-muted-foreground";
  const timeClass = compact ? "text-sm tabular-nums text-muted-foreground" : "text-base tabular-nums text-muted-foreground";
  return (
    <div className={`grid grid-cols-[8rem_1fr] gap-x-4 ${compact ? "py-2" : "py-3"} ${bordered ? "border-t border-border/60" : ""}`}>
      {!event.allDay || handling === "inline" ? (
        <div className={timeClass}>{event.allDay ? "All day" : formatTime(event.start)}</div>
      ) : handling === "badge" ? (
        <div className={`${timeClass} select-none opacity-0`} aria-hidden="true">—</div>
      ) : null}
      <div>
        <div className={titleClass}>
          {event.allDay && handling === "badge" ? <span className="mr-2 inline-flex items-center rounded-full bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">All day</span> : null}
          {showDay && config.group_by_day === false ? <span className="font-normal text-muted-foreground">{fmtShortDay(event.start)} · </span> : null}
          {event.summary || "—"}
        </div>
        {event.location ? <div className={locClass}>{event.location}</div> : null}
      </div>
    </div>
  );
}

function CalendarAllDaySection({ config, items }: { config: Config; items: CalEvent[] }) {
  if (stringValue(config.all_day_handling, "inline") !== "section") return null;
  const allDay = items.filter((ev) => ev.allDay);
  if (allDay.length === 0) return null;
  const chipClass =
    stringValue(config.density, "comfortable") === "compact"
      ? "rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs"
      : "rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-sm";
  return (
    <div className="mb-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">All day</div>
      <div className="flex flex-wrap gap-2">
        {allDay.map((ev) => <div className={chipClass} key={`${ev.start.toISOString()}-${ev.summary}`}>{ev.summary || "—"}</div>)}
      </div>
    </div>
  );
}

function CalendarTimedEvents({ bordered, config, items }: { bordered: boolean; config: Config; items: CalEvent[] }) {
  const list = stringValue(config.all_day_handling, "inline") === "section" ? items.filter((ev) => !ev.allDay) : items;
  return <>{list.map((ev, index) => <CalendarEventRow bordered={bordered && index > 0} config={config} event={ev} key={`${ev.start.toISOString()}-${ev.summary}`} />)}</>;
}

function CalendarGrid({ config, events }: { config: Config; events: CalEvent[] }) {
  const groups = config.group_by_day === false ? [["", events] as const] : groupCalendarEvents(events);
  const compact = stringValue(config.density, "comfortable") === "compact";
  const cardClass = compact ? "mb-2 rounded-lg border border-border/60 bg-card/40 p-3" : "mb-2 rounded-lg border border-border/60 bg-card/40 p-4";
  return (
    <div className={`grid ${events.length <= 4 ? "grid-cols-2" : "grid-cols-3"} auto-rows-min gap-4`}>
      {groups.map(([date, items], groupIndex) => (
        <section className="min-w-0" key={date || "events"}>
          {config.group_by_day !== false ? <div className={`mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground ${groupIndex > 0 ? "mt-2" : ""}`}>{fmtDayLabel(date)}</div> : null}
          {items.map((ev) => (
            <article className={cardClass} key={`${ev.start.toISOString()}-${ev.summary}`}>
              <div className={`${compact ? "text-xs" : "text-sm"} mb-1 tabular-nums text-muted-foreground`}>
                {ev.allDay ? "All day" : `${formatTime(ev.start)}${config.group_by_day === false ? ` · ${fmtShortDay(ev.start)}` : ""}`}
              </div>
              <div className={`${compact ? "text-sm font-semibold" : "text-lg font-medium"} leading-snug`}>{ev.summary || "—"}</div>
              {ev.location ? <div className="mt-1 text-sm text-muted-foreground">{ev.location}</div> : null}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function CalendarCompact({ events }: { events: CalEvent[] }) {
  return (
    <div className="divide-y divide-border/60">
      {events.map((ev) => (
        <div className="flex items-baseline justify-between gap-4 py-2" key={`${ev.start.toISOString()}-${ev.summary}`}>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{ev.summary || "—"}</div>
          <div className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fmtShortDay(ev.start)} {ev.allDay ? "All day" : formatTime(ev.start)}</div>
        </div>
      ))}
    </div>
  );
}

function AgendaClockPanel({ now }: { now: Date }) {
  return (
    <section className="w-full max-w-4xl">
      <div className="text-[clamp(4rem,12vw,10rem)] font-light leading-none tabular-nums">{formatTime(now)}</div>
      <div className="mt-2 text-3xl text-muted-foreground">{formatDate(now)}</div>
    </section>
  );
}

function AgendaWeatherPanel({ config, error, weather }: { config: Config; error: string; weather: Record<string, any> | null }) {
  const code = Number(weather?.current?.weather_code ?? 0);
  const label =
    stringValue(config.location_label) ||
    (config.latitude != null && config.longitude != null ? `${Number(config.latitude).toFixed(2)}, ${Number(config.longitude).toFixed(2)}` : "");
  return (
    <section className="w-full max-w-4xl text-right">
      <div className="text-7xl leading-none text-primary"><WeatherIcon code={code} iconStyle="emoji" className="" /></div>
      <div className="mt-2 text-7xl font-light leading-none tabular-nums">
        {weather ? Math.round(Number(weather.current.temperature_2m)) : "--"}
        <span className="text-primary">{stringValue(weather?.current_units?.temperature_2m, "°")}</span>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-[clamp(0.95rem,calc(1.1vw*var(--font-scale,1)),1.25rem)] ${error ? "text-destructive" : "text-muted-foreground"}`}>{error || weatherSummaryByCode[code] || ""}</div>
    </section>
  );
}

function AgendaPanel({ events, layout, message }: { events: CalEvent[]; layout: string; message: string }) {
  return (
    <section className={`flex min-h-0 w-full max-w-4xl flex-col ${layout === "split-3" ? "self-stretch border-l border-border px-6" : ""}`}>
      <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">Today &amp; tomorrow</h2>
      {message ? <div className={`text-base ${message.startsWith("Could not") ? "text-destructive" : "italic text-muted-foreground"}`}>{message}</div> : <AgendaList events={events} />}
    </section>
  );
}

function AgendaList({ events }: { events: CalEvent[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden divide-y divide-border">
      {events.map((ev) => (
        <div key={`${ev.start.toISOString()}-${ev.summary}`} className="grid grid-cols-[8rem_1fr] gap-4 py-3">
          <div className="text-[clamp(1.1rem,calc(1.8vw*var(--font-scale,1)),2rem)] font-medium tabular-nums text-muted-foreground">{formatAgendaWhen(ev)}</div>
          <div className="min-w-0">
            <div className="truncate text-[clamp(1.1rem,calc(1.8vw*var(--font-scale,1)),2rem)] font-medium">{ev.summary || "—"}</div>
            {ev.location ? <div className="mt-1 truncate text-sm text-muted-foreground">{ev.location}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function parseIcs(text: string): CalEvent[] {
  const events: CalEvent[] = [];
  let current: Record<string, any> | null = null;
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT" && current) {
      if (current.summary && current.start instanceof Date) {
        const allDay =
          current.allDay === true ||
          (!(current.end instanceof Date) && current.start.getHours() === 0 && current.start.getMinutes() === 0) ||
          (current.end instanceof Date && current.end.getTime() - current.start.getTime() >= 86400000);
        events.push({ summary: current.summary, location: current.location, start: current.start, end: current.end, allDay });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const head = line.slice(0, sep);
    const value = line.slice(sep + 1).replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
    const [name, ...params] = head.split(";");
    if (name === "SUMMARY") current.summary = value;
    if (name === "LOCATION") current.location = value;
    if (name === "DTSTART") {
      current.allDay = params.some((p) => p.toUpperCase() === "VALUE=DATE") || !value.includes("T");
      current.start = parseIcsDate(value, current.allDay);
    }
    if (name === "DTEND") current.end = parseIcsDate(value, params.some((p) => p.toUpperCase() === "VALUE=DATE"));
  }
  return events;
}

function parseIcsDate(value: string, dateOnly: boolean) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h, mi, s, z] = m;
  if (dateOnly || !h) return new Date(Number(y), Number(mo) - 1, Number(d));
  return z === "Z" ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))) : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function filterEvents(events: CalEvent[], horizonDays: number, maxEvents: number) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const horizon = new Date(now.getTime() + horizonDays * 86400000);
  return events.filter((e) => (e.end ?? e.start) >= start && e.start <= horizon).sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, maxEvents);
}

function filterAgendaEvents(events: CalEvent[], maxEvents: number) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 36 * 3600 * 1000);
  return events.filter((e) => e.start >= now && e.start <= horizon).sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, maxEvents);
}

function groupCalendarEvents(events: CalEvent[]) {
  const groups = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const key = ev.start.toDateString();
    groups.set(key, [...(groups.get(key) ?? []), ev]);
  }
  return [...groups.entries()].sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());
}

function fmtDayLabel(date: Date | string) {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const formatted = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (d.toDateString() === today.toDateString()) return `Today, ${formatted}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${formatted}`;
  return formatted;
}

function fmtShortDay(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatAgendaWhen(ev: CalEvent) {
  const now = new Date();
  const sameDay = ev.start.toDateString() === now.toDateString();
  if (ev.allDay) return sameDay ? "All day" : formatDate(ev.start, "weekday");
  if (sameDay) return formatTime(ev.start);
  return `${formatDate(ev.start, "weekday")} ${formatTime(ev.start)}`;
}
