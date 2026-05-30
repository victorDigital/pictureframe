import { useEffect, useState } from "react";
import type React from "react";
import type { Config } from "../shared";
import { boolValue, clamp, isCssColor, numberValue, Shell, stringValue } from "../shared";

type NowPlaying = { state?: string; title?: string; artist?: string; album?: string; entity_picture?: string; duration?: number; position?: number };

export function NowPlayingScreen({ config }: { config: Config }) {
  const [state, setState] = useState<NowPlaying | null>(null);
  const [progress, setProgress] = useState(0);
  const [sampledAccent, setSampledAccent] = useState<string | null>(null);
  const showProgress = boolValue(config.show_progress, true);
  const art = state?.state === "playing" ? state.entity_picture || "" : "";
  const layout = stringValue(config.layout, "split");
  const accentSource = stringValue(config.accent_source, "art");
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/now_playing");
        if (res.ok && !cancelled) setState(await res.json());
      } catch {
        return;
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "now_playing") setState(ev.data.state as NowPlaying);
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (!showProgress || !state || state.state !== "playing" || !state.duration || state.position == null) {
      setProgress(0);
      return;
    }
    const startedAt = Date.now() - state.position * 1000;
    const duration = state.duration * 1000;
    const update = () => setProgress(clamp(((Date.now() - startedAt) / duration) * 100, 0, 100));
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [showProgress, state]);
  useEffect(() => {
    let cancelled = false;
    if (accentSource !== "art" || !art) {
      setSampledAccent(null);
      return;
    }
    void sampleArtColor(art).then((color) => {
      if (!cancelled) setSampledAccent(color);
    });
    return () => {
      cancelled = true;
    };
  }, [accentSource, art]);
  if (!state || state.state !== "playing") return <Shell className="grid place-items-center text-4xl text-muted-foreground">Nothing is playing.</Shell>;
  const accent =
    accentSource === "custom" && isCssColor(config.accent_color)
      ? stringValue(config.accent_color)
      : accentSource === "art"
        ? sampledAccent
        : undefined;
  const blurPx = clamp(numberValue(config.blur_amount, 48), 0, 96);
  const artImage = art ? `url("${art.replace(/"/g, '\\"')}")` : undefined;
  const panel =
    layout === "stacked"
      ? "flex flex-col items-center justify-center gap-[clamp(1.5rem,4vh,3rem)] px-[clamp(1.5rem,5vw,4rem)] py-[clamp(2rem,6vh,4rem)] text-center"
      : layout === "minimal"
        ? "flex flex-col justify-end gap-[clamp(1rem,3vh,2rem)] px-[clamp(2rem,6vw,5rem)] py-[clamp(2rem,5vh,4rem)]"
        : "grid grid-cols-2 items-center gap-[clamp(2rem,6vw,5rem)] px-[clamp(2rem,6vw,5rem)] py-[clamp(3rem,8vh,6rem)]";
  const artWrap = layout === "minimal" ? "w-[clamp(5rem,14vw,9rem)] shrink-0" : layout === "split" ? "justify-self-end shrink-0" : "shrink-0";
  const artBox = layout === "minimal" ? "aspect-square w-full rounded-lg bg-muted bg-cover bg-center shadow-xl" : "aspect-square w-full max-w-[min(70vh,42rem)] rounded-xl bg-muted bg-cover bg-center shadow-2xl";
  const info = layout === "split" ? "min-w-0 max-w-lg" : "min-w-0 max-w-3xl";
  return (
    <Shell className="relative">
      {boolValue(config.blur_background, true) && artImage ? <div className="fixed -inset-[5%] z-0 scale-110 bg-cover bg-center brightness-50 blur-[var(--np-blur)]" style={{ backgroundImage: artImage, "--np-blur": `${blurPx}px` } as React.CSSProperties} /> : null}
      <section className={`fixed inset-0 z-10 ${panel}`}>
        <div className={artWrap}>
          <div className={artBox} style={{ backgroundImage: artImage }} role="img" aria-label="Album art" />
        </div>
        <div className={info}>
          <h1 className="text-balance text-[clamp(3rem,7vw,9rem)] font-light leading-tight tracking-tight">{state.title}</h1>
          <p className="mt-3 text-[clamp(1.5rem,3vw,3.5rem)] text-muted-foreground">{state.artist}</p>
          <p className="mt-1 text-[clamp(1.1rem,1.8vw,2rem)] text-muted-foreground/70">{state.album}</p>
          {showProgress ? (
            <div className="mt-[clamp(1rem,3vh,2rem)] h-[0.3rem] overflow-hidden rounded-full bg-foreground/15">
              <div className="h-full rounded-[inherit] bg-[var(--np-accent,var(--primary))] transition-[width] duration-500 ease-linear" style={{ width: `${progress}%`, "--np-accent": accent } as React.CSSProperties} />
            </div>
          ) : null}
        </div>
      </section>
    </Shell>
  );
}

function sampleArtColor(url: string) {
  return new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if ((data[i + 3] ?? 0) < 128) continue;
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          n += 1;
        }
        resolve(n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
