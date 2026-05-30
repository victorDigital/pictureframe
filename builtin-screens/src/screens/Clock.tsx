import { useEffect, useRef, useState } from "react";
import type { Config } from "../shared";
import { boolValue, formatDate, Shell, stringValue, weightClass } from "../shared";

export function ClockScreen({ config }: { config: Config }) {
  const [now, setNow] = useState(() => new Date());
  const showSeconds = boolValue(config.show_seconds, false);
  const showDate = boolValue(config.show_date, true);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const face = stringValue(config.face, "minimal");
  const weight = weightClass[stringValue(config.font_weight, "light")] ?? "font-light";
  const syncBad = now.getFullYear() < 2020;
  const dateFormat = stringValue(config.date_format, "long");
  const timeFormat = stringValue(config.time_format, "auto");
  return (
    <Shell className="grid place-items-center p-8">
      {syncBad ? <div className="fixed right-4 top-4 z-50 rounded-lg border border-destructive/30 bg-destructive px-4 py-2 text-sm text-primary-foreground shadow-lg">Clock not synced</div> : null}
      {face === "analog" ? <AnalogClock date={now} showSeconds={showSeconds} showDate={showDate} dateFormat={dateFormat} /> : null}
      {face === "flip" ? <FlipClock date={now} showSeconds={showSeconds} showDate={showDate} dateFormat={dateFormat} timeFormat={timeFormat} weight={weight} /> : null}
      {face !== "analog" && face !== "flip" ? (
        <DigitalClock
          date={now}
          variant={face === "digital" ? "digital" : "minimal"}
          showSeconds={showSeconds}
          showDate={showDate}
          dateFormat={dateFormat}
          timeFormat={timeFormat}
          weight={weight}
        />
      ) : null}
    </Shell>
  );
}

function timeParts(date: Date, format: string) {
  let twelve = false;
  if (format === "12h") twelve = true;
  else if (format === "auto") twelve = Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? false;
  let h = date.getHours();
  const period = twelve ? (h >= 12 ? "PM" : "AM") : "";
  if (twelve) h = h % 12 || 12;
  return {
    hh: String(h).padStart(2, "0"),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0"),
    period,
  };
}

function DigitalClock(props: { date: Date; variant: "digital" | "minimal"; showSeconds: boolean; showDate: boolean; dateFormat: string; timeFormat: string; weight: string }) {
  const parts = timeParts(props.date, props.timeFormat);
  const digital = props.variant === "digital";
  return (
    <div className={`flex flex-col items-center text-center ${digital ? "gap-4" : "gap-3"}`}>
      <div className={`${digital ? "text-display" : "text-title-xl"} ${props.weight} tabular-nums tracking-tight text-foreground`}>
        <span>{parts.hh}</span>
        <span className={digital ? "text-primary opacity-80" : "opacity-40"}>:</span>
        <span>{parts.mm}</span>
        {props.showSeconds ? (
          <>
            <span className={digital ? "text-primary opacity-80" : "opacity-40"}>:</span>
            <span>{parts.ss}</span>
          </>
        ) : null}
        {parts.period ? <span className={`${digital ? "ml-4 text-title-md" : "text-title-sm"} text-muted-foreground`}> {parts.period}</span> : null}
      </div>
      {props.showDate ? (
        <div className={digital ? "text-title-sm text-muted-foreground" : "text-caption uppercase tracking-widest"}>
          {formatDate(props.date, props.dateFormat)}
        </div>
      ) : null}
    </div>
  );
}

function FlipClock(props: { date: Date; showSeconds: boolean; showDate: boolean; dateFormat: string; timeFormat: string; weight: string }) {
  const parts = timeParts(props.date, props.timeFormat);
  const text = `${parts.hh}:${parts.mm}${props.showSeconds ? `:${parts.ss}` : ""}${parts.period ? ` ${parts.period}` : ""}`;
  const previous = useRef("");
  const previousText = previous.current;
  useEffect(() => {
    previous.current = text;
  }, [text]);
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className={`flex flex-row flex-wrap items-center justify-center gap-2 text-title-xl ${props.weight}`}>
        {[...text].map((ch, i) =>
          ch === ":" || ch === " " ? (
            ch === ":" ? <span key={`${ch}-${i}`} className="grid place-items-center px-1 text-primary opacity-70">{ch}</span> : <span key={`${ch}-${i}`} className="w-2" />
          ) : (
            <span key={`${ch}-${i}`} className="flip-digit">
              <span className="flip-card" data-flip={previousText !== "" && previousText[i] !== ch ? "true" : "false"}>
                <span>{ch}</span>
              </span>
            </span>
          ),
        )}
      </div>
      {props.showDate ? <div className="text-title-sm text-muted-foreground">{formatDate(props.date, props.dateFormat)}</div> : null}
    </div>
  );
}

function AnalogClock({ date, showSeconds, showDate, dateFormat }: { date: Date; showSeconds: boolean; showDate: boolean; dateFormat: string }) {
  const s = date.getSeconds();
  const m = date.getMinutes();
  const h = date.getHours() % 12;
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const major = i % 5 === 0;
    const len = major ? 10 : 5;
    const inner = 96 - len;
    const rad = ((i * 6 - 90) * Math.PI) / 180;
    return <line key={i} x1={100 + inner * Math.cos(rad)} y1={100 + inner * Math.sin(rad)} x2={100 + 96 * Math.cos(rad)} y2={100 + 96 * Math.sin(rad)} strokeWidth={major ? 2 : 1} opacity={major ? 0.9 : 0.35} />;
  });
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <svg className="analog-face" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="96" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
        <g stroke="var(--muted-foreground)" strokeLinecap="round">{ticks}</g>
        <line className="analog-hand" x1="100" y1="100" x2="100" y2="58" stroke="var(--foreground)" strokeWidth="4" strokeLinecap="round" transform={`rotate(${h * 30 + m * 0.5} 100 100)`} />
        <line className="analog-hand" x1="100" y1="100" x2="100" y2="38" stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round" transform={`rotate(${m * 6 + s * 0.1} 100 100)`} />
        {showSeconds ? <line className="analog-hand analog-hand-second" x1="100" y1="108" x2="100" y2="28" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${s * 6} 100 100)`} /> : null}
        <circle cx="100" cy="100" r="4" fill="var(--primary)" />
      </svg>
      {showDate ? <div className="text-title-sm text-muted-foreground">{formatDate(date, dateFormat)}</div> : null}
    </div>
  );
}
