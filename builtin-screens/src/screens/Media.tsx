import { useEffect, useRef, useState } from "react";
import type { Config } from "../shared";
import { clamp, ErrorPanel, numberValue, Shell, stringValue } from "../shared";

type MediaItem = { url: string; caption: string };
type PhotoItem = MediaItem & { api?: "immich" | "google" };
type PhotoSlide = { key: number; url: string; caption: string; visible: boolean; exiting: boolean };

function captionFromUrl(url: string) {
  try {
    return decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  } catch {
    return "";
  }
}

export function PhotosScreen({ config, id }: { config: Config; id: string }) {
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
        setItems(shuffle(await loadPhotos(config, id)));
      } catch (err) {
        setError(String(err));
      }
    }
    void load();
  }, [config, id]);
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

async function loadPhotos(config: Config, id: string): Promise<PhotoItem[]> {
  const library = stringValue(config.library, "google");
  if (library === "local") {
    const url = stringValue(config.local_index_url);
    if (!url) throw new Error("Configure local_index_url");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Local HTTP ${res.status}`);
    const list = (await res.json()) as unknown[];
    return list.map((src) => ({ url: String(src), caption: captionFromUrl(String(src)) }));
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
      api: "immich",
    }));
  }
  if (library === "google") {
    const res = await fetch(`/api/photos/google?screen=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Google Photos HTTP ${res.status}`);
    const body = (await res.json()) as { photos?: Array<{ url?: string; caption?: string }> };
    return (body.photos ?? [])
      .filter((photo) => photo.url)
      .map((photo) => ({ url: photo.url!, caption: photo.caption ?? "", api: "google" }));
  }
  throw new Error(`Unsupported photo library: ${library}`);
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
  const init = item.api === "immich" ? { headers: { "x-api-key": stringValue(config.immich_api_key) } } : {};
  const res = await fetch(item.url, init);
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
