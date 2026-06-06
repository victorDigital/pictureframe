import { useEffect, useRef, useState } from "react";
import type { Config } from "../shared";
import { boolValue, formatDate, Shell, stringValue, weightClass } from "../shared";

export function ClockScreen({ config }: { config: Config }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const face = stringValue(config.face, "minimal");
  const showSeconds = boolValue(config.show_seconds, face === "analog");
  const showDate = boolValue(config.show_date, true);
  const weight = weightClass[stringValue(config.font_weight, "light")] ?? "font-light";
  const syncBad = now.getFullYear() < 2020;
  const dateFormat = stringValue(config.date_format, "long");
  const timeFormat = stringValue(config.time_format, "auto");
  return (
    <Shell className={face === "analog" ? "analog-shell" : "grid place-items-center p-8"}>
      {syncBad ? <div className="fixed right-4 top-4 z-50 rounded-lg border border-destructive/30 bg-destructive px-4 py-2 text-sm text-primary-foreground shadow-lg">Clock not synced</div> : null}
      {face === "analog" ? <AnalogClock showSeconds={showSeconds} showDate={showDate} /> : null}
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

function AnalogClock({ showSeconds, showDate }: { showSeconds: boolean; showDate: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !ctx) return;

    let frame = 0;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let fontFamily = "\"Geist Variable\", ui-sans-serif, system-ui, sans-serif";

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      fontFamily = getComputedStyle(canvas).fontFamily || fontFamily;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      drawAnalogCanvas(ctx, width, height, new Date(), showSeconds, showDate, fontFamily);
      frame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    draw();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [showSeconds, showDate]);

  return <canvas ref={canvasRef} className="analog-canvas" role="img" aria-label="Analog clock" />;
}

const TAU = Math.PI * 2;

function drawAnalogCanvas(ctx: CanvasRenderingContext2D, width: number, height: number, date: Date, showSeconds: boolean, showDate: boolean, fontFamily: string) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const unit = Math.min(width, height);
  const max = Math.max(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const x = 0;
  const y = 0;
  const radius = unit * 0.12;
  const halfW = width * 0.5;
  const halfH = height * 0.5;

  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();

  const face = ctx.createRadialGradient(cx - width * 0.12, cy - height * 0.18, 0, cx, cy, max * 0.72);
  face.addColorStop(0, "#2b2b2b");
  face.addColorStop(0.46, "#1a1a1a");
  face.addColorStop(1, "#050505");
  ctx.fillStyle = face;
  ctx.fillRect(x, y, width, height);

  const glow = ctx.createRadialGradient(cx, cy, unit * 0.02, cx, cy, max * 0.52);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  glow.addColorStop(0.35, "rgba(255, 255, 255, 0.055)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, width, height);

  drawAnalogTicks(ctx, cx, cy, halfW, halfH, unit);
  if (showDate) drawAnalogDate(ctx, cx, cy, unit, date, fontFamily);
  drawAnalogHands(ctx, cx, cy, halfW, halfH, unit, date, showSeconds);

  ctx.restore();
}

function drawAnalogTicks(ctx: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, unit: number) {
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < 60; i += 1) {
    const angle = (i / 60) * TAU - Math.PI / 2;
    const major = i % 5 === 0;
    const quarter = i % 15 === 0;
    const boundary = superellipseRadius(angle, halfW, halfH, 5.8);
    const outer = boundary - unit * 0.045;
    const length = quarter ? unit * 0.215 : major ? unit * 0.17 : unit * 0.064;
    const inner = outer - length;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    ctx.beginPath();
    ctx.moveTo(cx + dx * inner, cy + dy * inner);
    ctx.lineTo(cx + dx * outer, cy + dy * outer);
    ctx.lineWidth = quarter ? unit * 0.007 : major ? unit * 0.005 : unit * 0.0028;
    ctx.strokeStyle = quarter ? "rgba(235, 235, 235, 0.62)" : major ? "rgba(225, 225, 225, 0.5)" : "rgba(215, 215, 215, 0.32)";
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnalogDate(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, date: Date, fontFamily: string) {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).replace(/\.$/, "").toUpperCase();
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `400 ${Math.max(16, size * 0.068)}px ${fontFamily}`;
  ctx.fillStyle = "rgba(210, 210, 210, 0.42)";
  ctx.fillText(`${weekday} ${date.getDate()}`, cx, cy - size * 0.2);
  ctx.restore();
}

function drawAnalogHands(ctx: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, unit: number, date: Date, showSeconds: boolean) {
  const ms = date.getMilliseconds();
  const seconds = date.getSeconds() + ms / 1000;
  const minutes = date.getMinutes() + seconds / 60;
  const hours = (date.getHours() % 12) + minutes / 60;
  const hourAngle = (hours / 12) * TAU - Math.PI / 2;
  const minuteAngle = (minutes / 60) * TAU - Math.PI / 2;
  const secondAngle = (seconds / 60) * TAU - Math.PI / 2;
  const hourBoundary = superellipseRadius(hourAngle, halfW, halfH, 5.8);
  const minuteBoundary = superellipseRadius(minuteAngle, halfW, halfH, 5.8);
  const secondBoundary = superellipseRadius(secondAngle, halfW, halfH, 5.8);

  if (showSeconds) drawSecondSweep(ctx, cx, cy, halfW, halfH, unit, secondAngle);
  drawHand(ctx, cx, cy, hourAngle, hourBoundary * 0.4, unit * 0.025, unit * 0.02);
  drawHand(ctx, cx, cy, minuteAngle, minuteBoundary * 0.72, unit * 0.018, unit * 0.016);
  if (showSeconds) drawSecondHand(ctx, cx, cy, secondAngle, secondBoundary, unit);

  ctx.save();
  ctx.shadowColor = "rgba(255, 255, 255, 0.55)";
  ctx.shadowBlur = unit * 0.018;
  ctx.fillStyle = "#f4f4f4";
  ctx.beginPath();
  ctx.arc(cx, cy, unit * 0.012, 0, TAU);
  ctx.fill();
  ctx.lineWidth = unit * 0.004;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.78)";
  ctx.stroke();
  ctx.restore();
}

function drawSecondSweep(ctx: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, unit: number, angle: number) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const gradient = ctx.createRadialGradient(cx, cy, unit * 0.04, cx, cy, Math.max(halfW, halfH));
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.85)");
  gradient.addColorStop(0.55, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  const trail = 0.46;
  const segments = 40;
  for (let i = segments - 1; i >= 0; i -= 1) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const start = angle - trail * t1;
    const end = angle - trail * t0;
    ctx.globalAlpha = Math.pow(1 - t0, 2.6) * 0.26;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let p = 0; p <= 3; p += 1) {
      const a = start + ((end - start) * p) / 3;
      const r = superellipseRadius(a, halfW, halfH, 5.8) - unit * 0.045;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawHand(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, length: number, back: number, width: number) {
  const mainWidth = width * 1.45;
  const mainHalf = mainWidth / 2;
  const neckHalf = mainHalf * 0.36;
  const rootX = -back * 0.55;
  const neckX = Math.min(length * 0.12, mainWidth * 1.9);
  const shoulderX = Math.min(length * 0.2, mainWidth * 3.6);
  const capX = length - mainHalf;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.shadowColor = "rgba(0, 0, 0, 0.48)";
  ctx.shadowBlur = mainWidth * 0.55;
  ctx.shadowOffsetX = mainWidth * 0.24;
  ctx.shadowOffsetY = mainWidth * 0.24;
  ctx.fillStyle = "rgba(250, 250, 250, 0.98)";
  ctx.beginPath();
  ctx.moveTo(rootX + neckHalf, -neckHalf);
  ctx.lineTo(neckX, -neckHalf);
  ctx.quadraticCurveTo(shoulderX * 0.78, -neckHalf, shoulderX, -mainHalf);
  ctx.lineTo(capX, -mainHalf);
  ctx.quadraticCurveTo(length, -mainHalf, length, 0);
  ctx.quadraticCurveTo(length, mainHalf, capX, mainHalf);
  ctx.lineTo(shoulderX, mainHalf);
  ctx.quadraticCurveTo(shoulderX * 0.78, neckHalf, neckX, neckHalf);
  ctx.lineTo(rootX + neckHalf, neckHalf);
  ctx.quadraticCurveTo(rootX, neckHalf, rootX, 0);
  ctx.quadraticCurveTo(rootX, -neckHalf, rootX + neckHalf, -neckHalf);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(1, mainWidth * 0.08);
  ctx.strokeStyle = "rgba(190, 190, 190, 0.55)";
  ctx.stroke();
  ctx.restore();
}

function drawSecondHand(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, boundary: number, unit: number) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255, 255, 255, 0.55)";
  ctx.shadowBlur = unit * 0.01;
  ctx.lineWidth = unit * 0.006;
  ctx.strokeStyle = "rgba(250, 250, 250, 0.96)";
  ctx.beginPath();
  ctx.moveTo(cx - dx * unit * 0.045, cy - dy * unit * 0.045);
  ctx.lineTo(cx + dx * (boundary - unit * 0.05), cy + dy * (boundary - unit * 0.05));
  ctx.stroke();
  ctx.restore();
}

function superellipseRadius(angle: number, halfW: number, halfH: number, exponent: number) {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return 1 / Math.pow(Math.pow(c / halfW, exponent) + Math.pow(s / halfH, exponent), 1 / exponent);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
