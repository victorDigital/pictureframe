import { useEffect, useRef } from "react";
import type React from "react";

export type Config = Record<string, unknown>;
export type ScreenComponent = (props: { config: Config; id: string }) => React.ReactElement;

export const fontStacks: Record<string, string> = {
  geist: "\"Geist Variable\", ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
  serif: "ui-serif, Georgia, Cambria, Times New Roman, Times, serif",
  mono: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace",
};

export const weightClass: Record<string, string> = {
  thin: "font-thin",
  light: "font-light",
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

export function useScreenEnvironment(config: Config, id: string) {
  useEffect(() => {
    const root = document.documentElement;
    const theme = stringValue(config.theme, "auto");
    root.dataset.theme = ["auto", "light", "dark", "midnight"].includes(theme) ? theme : "auto";
    root.style.setProperty("--font-scale", String(clamp(numberValue(config.font_scale, 1), 0.5, 2)));
    root.style.setProperty("--font-sans", fontStacks[stringValue(config.font_family, "geist")] ?? "\"Geist Variable\", ui-sans-serif, system-ui, sans-serif");
    if (isCssColor(config.accent_color)) root.style.setProperty("--primary", config.accent_color);
    if (isCssColor(config.color)) root.style.setProperty("--foreground", config.color);
    if (isCssColor(config.background)) root.style.setProperty("--background", config.background);

    const a = requestAnimationFrame(() => {
      const b = requestAnimationFrame(() => {
        parent.postMessage({ type: "builtin_ready", id }, "*");
        console.info("[builtin] " + id + " ready");
      });
      return () => cancelAnimationFrame(b);
    });
    return () => cancelAnimationFrame(a);
  }, [config, id]);
}

export function useEvery(fn: () => void | Promise<void>, ms: number) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  useEffect(() => {
    void fnRef.current();
    const timer = setInterval(() => void fnRef.current(), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

export function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function numberValue(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function isCssColor(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function fetchWithTimeout(url: string | URL, opts: RequestInit = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function formatTime(date: Date, format = "auto", showSeconds = false) {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  if (showSeconds) opts.second = "2-digit";
  if (format === "24h") opts.hour12 = false;
  if (format === "12h") opts.hour12 = true;
  return date.toLocaleTimeString(undefined, opts);
}

export function formatDate(date: Date, format = "long") {
  if (format === "iso") return date.toISOString().slice(0, 10);
  const opts: Intl.DateTimeFormatOptions =
    format === "short"
      ? { month: "numeric", day: "numeric" }
      : format === "medium"
        ? { month: "short", day: "numeric" }
        : format === "weekday"
          ? { weekday: "long" }
          : { weekday: "long", month: "long", day: "numeric" };
  return date.toLocaleDateString(undefined, opts);
}

export function Shell({ children, className = "" }: React.PropsWithChildren<{ className?: string }>) {
  return <main className={"h-screen w-screen overflow-hidden bg-background text-foreground " + className}>{children}</main>;
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <Shell className="grid place-items-center p-8 text-center">
      <p className="max-w-3xl text-3xl font-medium text-destructive">{message}</p>
    </Shell>
  );
}

export function MissingScreen({ id }: { id: string }) {
  return <ErrorPanel message={"Unknown built-in screen: " + id} />;
}
