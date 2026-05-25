import { fetchWithTimeout, formatTime } from "/builtin/_shared/runtime.js";

/** @typedef {{ SUMMARY: string, LOCATION?: string, DTSTART: Date, DTEND?: Date, allDay: boolean }} CalEvent */

const REFRESH_MS = 10 * 60 * 1000;

export function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

export function unescapeIcs(value) {
  return value
    .replace(/\\n/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * @param {string} value
 * @param {boolean} dateOnly
 */
export function parseIcsDate(value, dateOnly = false) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (dateOnly || !h) return new Date(Number(y), Number(mo) - 1, Number(d));
  return z === "Z"
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

/** @param {string} text */
export function parseIcs(text) {
  /** @type {CalEvent[]} */
  const events = [];
  const lines = unfoldIcs(text).split(/\r?\n/);
  /** @type {Record<string, string | Date | boolean | undefined> | null} */
  let cur = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) cur = {};
    else if (line.startsWith("END:VEVENT") && cur) {
      if (cur.SUMMARY && cur.DTSTART instanceof Date) {
        events.push({
          SUMMARY: String(cur.SUMMARY),
          LOCATION: cur.LOCATION ? String(cur.LOCATION) : undefined,
          DTSTART: cur.DTSTART,
          DTEND: cur.DTEND instanceof Date ? cur.DTEND : undefined,
          allDay: Boolean(cur.allDay),
        });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const rawKey = line.slice(0, idx);
      const key = rawKey.split(";")[0];
      const params = Object.fromEntries(
        rawKey
          .split(";")
          .slice(1)
          .map((p) => {
            const eq = p.indexOf("=");
            return eq < 0 ? [p.toLowerCase(), ""] : [p.slice(0, eq).toLowerCase(), p.slice(eq + 1)];
          }),
      );
      const val = unescapeIcs(line.slice(idx + 1));
      if (key === "DTSTART") {
        const dateOnly = params.value === "DATE";
        cur.allDay = dateOnly;
        cur.DTSTART = parseIcsDate(val, dateOnly);
      } else if (key === "DTEND") {
        cur.DTEND = parseIcsDate(val, params.value === "DATE");
      } else if (key === "SUMMARY") cur.SUMMARY = val;
      else if (key === "LOCATION") cur.LOCATION = val;
    }
  }
  return events;
}

/** @param {CalEvent} ev */
export function isAllDay(ev) {
  if (ev.allDay) return true;
  const s = ev.DTSTART;
  return s.getHours() === 0 && s.getMinutes() === 0 && s.getSeconds() === 0 && !ev.DTEND;
}

/** @param {Date|string} date */
export function fmtDayLabel(date) {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const formatted = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (d.toDateString() === today.toDateString()) return `Today, ${formatted}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${formatted}`;
  return formatted;
}

/** @param {Date} date */
export function fmtShortDay(date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** @param {CalEvent} ev */
export function fmtWhen(ev) {
  if (isAllDay(ev)) return "All day";
  return formatTime(ev.DTSTART);
}

/**
 * @param {CalEvent[]} events
 * @param {Date} now
 * @param {number} horizonDays
 * @param {number} maxEvents
 */
export function filterEvents(events, now, horizonDays, maxEvents) {
  const horizon = new Date(now.getTime() + horizonDays * 86400000);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  return events
    .filter((e) => {
      const end = e.DTEND ?? e.DTSTART;
      return end >= startOfToday && e.DTSTART <= horizon;
    })
    .sort((a, b) => a.DTSTART - b.DTSTART || (a.SUMMARY || "").localeCompare(b.SUMMARY || ""))
    .slice(0, maxEvents);
}

/**
 * @param {CalEvent[]} events
 * @returns {[string, CalEvent[]][]}
 */
export function groupByDay(events) {
  const groups = new Map();
  for (const ev of events) {
    const key = ev.DTSTART.toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  return [...groups.entries()].sort(([a], [b]) => new Date(a) - new Date(b));
}

function esc(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}

/**
 * @param {CalEvent} ev
 * @param {Record<string, unknown>} config
 * @param {{ showDay?: boolean, bordered?: boolean }} opts
 */
function renderEventRow(ev, config, opts = {}) {
  const compact = config.density === "compact";
  const handling = config.all_day_handling || "inline";
  const allDay = isAllDay(ev);
  const pad = compact ? "py-2" : "py-3";
  const timeCls = compact
    ? "text-sm tabular-nums text-muted-foreground"
    : "text-base tabular-nums text-muted-foreground";
  const titleCls = compact ? "text-sm font-medium leading-snug" : "text-lg font-medium leading-snug";
  const locCls = compact ? "text-xs text-muted-foreground mt-0.5" : "text-sm text-muted-foreground mt-1";
  const border = opts.bordered ? "border-t border-border/60" : "";

  let whenHtml = "";
  if (!allDay || handling === "inline") {
    whenHtml = `<div class="${timeCls}">${esc(allDay ? "All day" : fmtWhen(ev))}</div>`;
  } else if (handling === "badge") {
    whenHtml = `<div class="${timeCls} opacity-0 select-none" aria-hidden="true">—</div>`;
  }

  const badge =
    allDay && handling === "badge"
      ? `<span class="inline-flex items-center rounded-full bg-primary/5 text-primary px-2 py-0.5 text-xs font-medium mr-2">All day</span>`
      : "";

  const dayPrefix =
    opts.showDay && config.group_by_day === false
      ? `<span class="text-muted-foreground font-normal">${esc(fmtShortDay(ev.DTSTART))} · </span>`
      : "";

  const loc = ev.LOCATION ? `<div class="${locCls}">${esc(ev.LOCATION)}</div>` : "";

  return `
    <div class="grid grid-cols-[8rem_1fr] gap-x-4 ${pad} ${border}">
      ${whenHtml}
      <div>
        <div class="${titleCls}">${badge}${dayPrefix}${esc(ev.SUMMARY || "—")}</div>
        ${loc}
      </div>
    </div>`;
}

/**
 * @param {CalEvent[]} items
 * @param {Record<string, unknown>} config
 */
function renderAllDaySection(items, config) {
  if (config.all_day_handling !== "section") return "";
  const allDay = items.filter(isAllDay);
  if (allDay.length === 0) return "";
  const compact = config.density === "compact";
  const chipCls = compact
    ? "rounded-md bg-muted/40 border border-border/60 px-2 py-1 text-xs"
    : "rounded-lg bg-muted/40 border border-border/60 px-3 py-1.5 text-sm";
  return `
    <div class="mb-3">
      <div class="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2">All day</div>
      <div class="flex flex-wrap gap-2">
        ${allDay.map((ev) => `<div class="${chipCls}">${esc(ev.SUMMARY || "—")}</div>`).join("")}
      </div>
    </div>`;
}

/**
 * @param {CalEvent[]} items
 * @param {Record<string, unknown>} config
 * @param {boolean} bordered
 */
function renderTimedEvents(items, config, bordered) {
  const handling = config.all_day_handling || "inline";
  const list = handling === "section" ? items.filter((ev) => !isAllDay(ev)) : items;
  return list
    .map((ev, i) => renderEventRow(ev, config, { bordered: bordered && i > 0 }))
    .join("");
}

/**
 * @param {string} dateKey
 * @param {CalEvent[]} items
 * @param {Record<string, unknown>} config
 * @param {boolean} isFirst
 */
function renderDayGroup(dateKey, items, config, isFirst) {
  const showHeader = config.group_by_day !== false;
  const header = showHeader
    ? `<div class="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2 ${isFirst ? "" : "mt-6"}">${esc(fmtDayLabel(dateKey))}</div>`
    : "";
  return `${header}${renderAllDaySection(items, config)}${renderTimedEvents(items, config, true)}`;
}

/**
 * @param {CalEvent[]} events
 * @param {Record<string, unknown>} config
 */
function renderAgenda(events, config) {
  if (config.group_by_day === false) {
    return events
      .map((ev, i) => renderEventRow(ev, config, { showDay: true, bordered: i > 0 }))
      .join("");
  }
  return groupByDay(events)
    .map(([date, items], i) => renderDayGroup(date, items, config, i === 0))
    .join("");
}

/**
 * @param {CalEvent[]} events
 * @param {Record<string, unknown>} config
 */
function renderGrid(events, config) {
  const compact = config.density === "compact";
  const cardPad = compact ? "p-3" : "p-4";
  const titleCls = compact ? "text-sm font-semibold" : "text-lg font-medium";
  const evCls = compact ? "text-xs" : "text-sm";
  const cols = events.length <= 4 ? "grid-cols-2" : "grid-cols-3";

  const groups = config.group_by_day === false ? [["", events]] : groupByDay(events);

  return `
    <div class="grid ${cols} gap-4 auto-rows-min">
      ${groups
        .map(([date, items], gi) => {
          const heading =
            config.group_by_day !== false
              ? `<div class="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3 ${gi > 0 ? "mt-2" : ""}">${esc(fmtDayLabel(date))}</div>`
              : "";
          const body = items
            .map((ev) => {
              const allDay = isAllDay(ev);
              const when = allDay
                ? "All day"
                : `${formatTime(ev.DTSTART)}${config.group_by_day === false ? ` · ${fmtShortDay(ev.DTSTART)}` : ""}`;
              return `
                <div class="rounded-lg border border-border/60 bg-card/40 ${cardPad} mb-2">
                  <div class="${evCls} tabular-nums text-muted-foreground mb-1">${esc(when)}</div>
                  <div class="${titleCls} leading-snug">${esc(ev.SUMMARY || "—")}</div>
                  ${ev.LOCATION ? `<div class="text-sm text-muted-foreground mt-1">${esc(ev.LOCATION)}</div>` : ""}
                </div>`;
            })
            .join("");
          return `
            <div class="min-w-0">
              ${heading}
              ${body}
            </div>`;
        })
        .join("")}
    </div>`;
}

/**
 * @param {CalEvent[]} events
 * @param {Record<string, unknown>} config
 */
function renderCompact(events, config) {
  return `
    <div class="divide-y divide-border/60">
      ${events
        .map((ev) => {
          const allDay = isAllDay(ev);
          const when = allDay ? "All day" : formatTime(ev.DTSTART);
          return `
            <div class="flex items-baseline justify-between gap-4 py-2">
              <div class="min-w-0 flex-1 truncate text-sm font-medium">${esc(ev.SUMMARY || "—")}</div>
              <div class="shrink-0 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                ${esc(fmtShortDay(ev.DTSTART))} ${esc(when)}
              </div>
            </div>`;
        })
        .join("")}
    </div>`;
}

/**
 * @param {CalEvent[]} events
 * @param {Record<string, unknown>} config
 */
export function renderEvents(events, config) {
  const layout = config.layout || "agenda";
  if (layout === "grid") return renderGrid(events, config);
  if (layout === "compact") return renderCompact(events, config);
  return renderAgenda(events, config);
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} config
 */
export async function mountCalendar(root, config) {
  const titleEl = root.querySelector("#title");
  const bodyEl = root.querySelector("#body");
  if (!(titleEl instanceof HTMLElement) || !(bodyEl instanceof HTMLElement)) return;

  titleEl.textContent = String(config.title || "Upcoming");

  root.dataset.density = config.density === "compact" ? "compact" : "comfortable";
  root.dataset.layout = String(config.layout || "agenda");

  if (!config.ical_url) {
    bodyEl.className = "text-muted-foreground italic text-base";
    bodyEl.textContent = "Configure ical_url to show events.";
    return;
  }

  async function load() {
    bodyEl.className = "text-muted-foreground italic text-base";
    bodyEl.textContent = "Loading…";
    try {
      const res = await fetchWithTimeout(String(config.ical_url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const now = new Date();
      const events = filterEvents(
        parseIcs(text),
        now,
        Number(config.horizon_days) || 14,
        Number(config.max_events) || 12,
      );

      if (events.length === 0) {
        bodyEl.className = "text-muted-foreground italic text-base";
        bodyEl.textContent = "Nothing scheduled.";
        return;
      }

      bodyEl.className = "";
      bodyEl.innerHTML = renderEvents(events, config);
    } catch (err) {
      bodyEl.className = "text-destructive text-base";
      bodyEl.textContent = `Could not load calendar: ${err}`;
    }
  }

  await load();
  setInterval(load, REFRESH_MS);
}
