import { useEffect, useRef, useState } from "react";
import type { Config } from "../shared";
import { boolValue, formatTime, Shell, stringValue } from "../shared";

export function AmbientScreen({ config }: { config: Config }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState(() => new Date());
  const showClock = boolValue(config.show_clock, true);
  useEffect(() => {
    if (!showClock) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [showClock]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frameId = 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const palette = ambientPalette(stringValue(config.palette, "midnight"), stringValue(config.accent_color));
    const count = stringValue(config.density, "normal") === "dense" ? 12 : stringValue(config.density, "normal") === "sparse" ? 4 : 7;
    const speed = stringValue(config.motion_speed, "slow") === "fast" ? 0.45 : stringValue(config.motion_speed, "slow") === "normal" ? 0.25 : 0.12;
    const blobs = Array.from({ length: count }, (_, i) => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, vx: (Math.random() - 0.5) * speed, vy: (Math.random() - 0.5) * speed, r: innerWidth * (0.22 + Math.random() * 0.28), c: palette[(i % (palette.length - 1)) + 1] ?? palette[1]! }));
    const resize = () => {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    const draw = () => {
      ctx.fillStyle = palette[0]!;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.globalCompositeOperation = "lighter";
      for (const b of blobs) {
        b.x += b.vx;
        b.y += b.vy;
        if (b.x < -b.r || b.x > innerWidth + b.r) b.vx *= -1;
        if (b.y < -b.r || b.y > innerHeight + b.r) b.vy *= -1;
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, `${b.c}aa`);
        g.addColorStop(1, `${b.c}00`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      frameId = requestAnimationFrame(draw);
    };
    resize();
    addEventListener("resize", resize);
    draw();
    return () => {
      cancelAnimationFrame(frameId);
      removeEventListener("resize", resize);
    };
  }, [config]);
  const clockStyle = stringValue(config.clock_style, "minimal");
  const clockClass =
    clockStyle === "soft"
      ? "text-[clamp(3rem,7vw,9rem)] font-light text-muted-foreground"
      : clockStyle === "bold"
        ? "text-[clamp(8rem,22vw,28rem)] font-medium text-foreground"
        : clockStyle === "ghost"
          ? "text-[clamp(5rem,14vw,18rem)] font-thin text-foreground/30 backdrop-blur-sm"
          : "text-[clamp(5rem,14vw,18rem)] font-thin text-foreground/60";
  return (
    <Shell className="relative bg-black">
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" aria-hidden="true" />
      {showClock ? <div className={`pointer-events-none fixed inset-0 grid place-items-center tabular-nums tracking-tight ${clockClass}`}>{formatTime(now, "24h")}</div> : null}
    </Shell>
  );
}

function ambientPalette(name: string, accent: string) {
  const palettes: Record<string, string[]> = {
    midnight: ["#021029", "#0a3358", "#3b6da6", "#75aede"],
    embers: ["#1a0500", "#5a1100", "#a83a16", "#f0b264"],
    aurora: ["#001a1f", "#003d3b", "#19a98c", "#7be0b6"],
    ocean: ["#010a14", "#062a45", "#14658a", "#4aafc9"],
    forest: ["#020a06", "#0d2e1a", "#1f6040", "#6aab72"],
    mono: ["#0a0a0a", "#2a2a2a", "#666666", "#aaaaaa"],
  };
  const picked = [...(palettes[name] ?? palettes.midnight!)];
  if (accent) picked[picked.length - 1] = accent;
  return picked;
}
