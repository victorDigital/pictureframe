import { useEffect, useRef, useState } from "react";
import type { Config } from "../shared";
import { boolValue, clamp, ErrorPanel, fetchWithTimeout, numberValue, Shell, stringValue } from "../shared";

type MediaItem = { url: string; caption: string };
type PhotoItem = MediaItem & { api?: boolean };
type PhotoSlide = { key: number; url: string; caption: string; visible: boolean; exiting: boolean };

export function MediaViewerScreen({ config }: { config: Config }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const interval = Math.max(3, numberValue(config.interval_sec, 15)) * 1000;
  useEffect(() => {
    async function load() {
      const indexUrl = stringValue(config.index_url);
      if (!indexUrl) {
        setError("Configure index_url");
        return;
      }
      try {
        const res = await fetchWithTimeout(indexUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        if (!Array.isArray(raw)) throw new Error("Index must be a JSON array");
        setItems(raw.map(normalizeMediaItem).filter((item) => item.url));
      } catch (err) {
        setError(String(err));
      }
    }
    void load();
  }, [config]);
  const current = items[index];
  const isVideo = current ? isVideoUrl(current.url) : false;
  const advance = () => setIndex((i) => (items.length ? (i + 1) % items.length : i));
  useEffect(() => {
    if (!current || items.length <= 1) return;
    const timer = setTimeout(advance, isVideo ? Math.max(interval, 3000) : interval);
    return () => clearTimeout(timer);
  }, [current, index, interval, isVideo, items.length]);
  if (error) return <ErrorPanel message={error} />;
  if (items.length === 0) return <ErrorPanel message="No media in directory." />;
  return (
    <MediaFrame
      item={current!}
      fit={stringValue(config.fit_mode, stringValue(config.fit, "contain"))}
      captionPosition={stringValue(config.caption_position, "bottom")}
      dots={boolValue(config.show_progress_dots, true) ? { count: items.length, index } : undefined}
      onVideoEnded={advance}
    />
  );
}

function normalizeMediaItem(entry: unknown): MediaItem {
  if (typeof entry === "string") return { url: entry, caption: captionFromUrl(entry) };
  if (entry && typeof entry === "object") {
    const data = entry as Record<string, unknown>;
    const url = stringValue(data.url) || stringValue(data.src) || stringValue(data.href);
    return { url, caption: stringValue(data.caption) || stringValue(data.title) || stringValue(data.name) || captionFromUrl(url) };
  }
  return { url: "", caption: "" };
}

function captionFromUrl(url: string) {
  try {
    return decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  } catch {
    return "";
  }
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

function MediaFrame({ item, fit, captionPosition, dots, onVideoEnded }: { item: MediaItem; fit: string; captionPosition: string; dots?: { count: number; index: number }; onVideoEnded?: () => void }) {
  const isVideo = isVideoUrl(item.url);
  const object = fit === "cover" ? "object-cover" : "object-contain";
  return (
    <Shell className="relative flex flex-col bg-black">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 grid place-items-center bg-black">
          {isVideo ? (
            <video key={item.url} className={`h-full w-full opacity-100 transition-opacity duration-700 ease-out ${object}`} src={item.url} autoPlay muted playsInline onEnded={onVideoEnded} />
          ) : (
            <img key={item.url} className={`h-full w-full opacity-100 transition-opacity duration-700 ease-out ${object}`} src={item.url} alt={item.caption} />
          )}
        </div>
        {captionPosition === "overlay" && item.caption ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-6 py-4">
            <p className="max-w-2xl truncate rounded-lg border border-border bg-card px-4 py-3 text-center text-lg font-medium leading-snug text-card-foreground backdrop-blur-sm">{item.caption}</p>
          </div>
        ) : null}
        {dots && dots.count > 1 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center gap-2 px-6 py-4">
            {Array.from({ length: dots.count }, (_, i) => <span key={i} className={`h-2 w-2 rounded-full transition-all duration-300 ${i === dots.index ? "bg-primary" : "bg-muted opacity-50"}`} />)}
          </div>
        ) : null}
      </div>
      {captionPosition === "bottom" && item.caption ? (
        <footer className="shrink-0 border-t border-border bg-card px-6 py-4">
          <p className="truncate text-center text-lg font-medium text-card-foreground">{item.caption}</p>
        </footer>
      ) : null}
    </Shell>
  );
}

export function PhotosScreen({ config }: { config: Config }) {
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [slides, setSlides] = useState<PhotoSlide[]>([]);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const interval = Math.max(5, numberValue(config.interval_sec, 30)) * 1000;
  const fadeMs = clamp(numberValue(config.fade_duration_ms, 1500), 200, 5000);
  const kbSec = clamp(numberValue(config.kenburns_duration, 30), 5, 120);
  const transitionStyle = resolvePhotoTransition(config);
  const captionPosition = stringValue(config.caption_position, "none");
  const instant = stringValue(config.transition) === "none" && !stringValue(config.transition_style);
  const indexRef = useRef(0);
  const keyRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    async function load() {
      try {
        setItems(shuffle(await loadPhotos(config)));
      } catch (err) {
        setError(String(err));
      }
    }
    void load();
  }, [config]);
  useEffect(() => {
    document.documentElement.style.setProperty("--fade-duration", `${fadeMs}ms`);
    document.documentElement.style.setProperty("--kb-duration", `${kbSec}s`);
  }, [fadeMs, kbSec]);
  useEffect(() => {
    if (!items.length || error) return;
    let cancelled = false;
    const clearTimers = () => {
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];
    };
    const showNext = async () => {
      const item = items[indexRef.current % items.length]!;
      indexRef.current += 1;
      let url = "";
      try {
        url = await fetchPhoto(config, item);
        await preloadImage(url);
      } catch (err) {
        console.error("photo load failed", err);
        revokeBlob(url);
        if (!cancelled) timersRef.current.push(window.setTimeout(showNext, 1500));
        return;
      }
      if (cancelled) {
        revokeBlob(url);
        return;
      }
      const next = { key: keyRef.current++, url, caption: item.caption, visible: false, exiting: false };
      setSlides((current) => [...current.map((slide) => ({ ...slide, visible: false, exiting: true })), next]);
      requestAnimationFrame(() => {
        setSlides((current) => current.map((slide) => (slide.key === next.key ? { ...slide, visible: true } : slide)));
        setCaption(item.caption);
      });
      timersRef.current.push(window.setTimeout(() => {
        setSlides((current) => {
          const keep = current.filter((slide) => !slide.exiting);
          current.forEach((slide) => {
            if (slide.exiting) revokeBlob(slide.url);
          });
          return keep;
        });
      }, instant ? 0 : fadeMs));
      timersRef.current.push(window.setTimeout(showNext, interval));
    };
    void showNext();
    return () => {
      cancelled = true;
      clearTimers();
      setSlides((current) => {
        current.forEach((slide) => revokeBlob(slide.url));
        return [];
      });
    };
  }, [config, error, fadeMs, instant, interval, items]);
  if (error) return <ErrorPanel message={error} />;
  if (!items.length) return <ErrorPanel message="No photos in library." />;
  return (
    <Shell className="relative bg-background">
      <div className={`fixed inset-0 isolate bg-background slide-${transitionStyle}`}>
        {slides.map((slide) => (
          <img key={slide.key} src={slide.url} alt={slide.caption || "Photo"} decoding="async" className={`photo-slide ${slide.visible ? "is-visible" : ""} ${slide.exiting ? "is-exiting" : ""}`} />
        ))}
      </div>
      {captionPosition !== "none" && caption ? (
        <div className={`pointer-events-none fixed inset-x-0 z-20 px-8 py-6 text-center text-[clamp(1.1rem,1.8vw,2rem)] font-medium ${captionPosition === "overlay" ? "bottom-8 left-8 right-8 mx-auto max-w-4xl rounded-xl bg-background/40 text-foreground backdrop-blur-sm" : "bottom-0 bg-gradient-to-t from-background/90 to-transparent text-muted-foreground"}`} aria-live="polite">
          {caption}
        </div>
      ) : null}
    </Shell>
  );
}

function resolvePhotoTransition(config: Config) {
  const modern = stringValue(config.transition_style);
  if (modern) return modern;
  const legacy = stringValue(config.transition, "kenburns");
  return legacy === "none" ? "fade" : legacy;
}

async function loadPhotos(config: Config): Promise<PhotoItem[]> {
  const library = stringValue(config.library, "immich");
  if (library === "local") {
    const url = stringValue(config.local_index_url);
    if (!url) throw new Error("Configure local_index_url");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Local HTTP ${res.status}`);
    const list = (await res.json()) as unknown[];
    return list.map((src) => ({ url: String(src), caption: captionFromUrl(String(src)), api: false }));
  }
  if (library === "immich") {
    const base = stringValue(config.immich_base_url).replace(/\/$/, "");
    const key = stringValue(config.immich_api_key);
    if (!base || !key) throw new Error("Configure immich_base_url and immich_api_key");
    const headers = { "x-api-key": key };
    const album = stringValue(config.immich_album_id);
    const res = await fetch(album ? `${base}/api/album/${album}` : `${base}/api/asset?type=IMAGE`, { headers });
    if (!res.ok) throw new Error(`Immich HTTP ${res.status}`);
    const body = await res.json();
    const assets = (album ? body.assets : body) as Array<Record<string, any>>;
    return assets.slice(0, 200).map((asset) => ({
      url: `${base}/api/asset/file/${asset.id}?isThumb=false`,
      caption: asset.exifInfo?.description ?? (asset.exifInfo?.city && asset.exifInfo?.country ? `${asset.exifInfo.city}, ${asset.exifInfo.country}` : asset.originalFileName ?? ""),
      api: true,
    }));
  }
  throw new Error("Google Photos backend is best-effort; switch to Immich (see SPEC section 11).");
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

async function fetchPhoto(config: Config, item: PhotoItem) {
  if (!item.api) return item.url;
  const res = await fetch(item.url, { headers: { "x-api-key": stringValue(config.immich_api_key) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

function preloadImage(url: string) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("load failed"));
    img.src = url;
  });
}

function revokeBlob(url: string) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}
