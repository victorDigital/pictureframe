// Shared runtime for picture-frame built-in screens.
// Loaded as an ES module from /builtin/_shared/runtime.js
//
// Each screen typically does:
//   import { init } from "/builtin/_shared/runtime.js";
//   const config = init("my-screen-id");
//
// init() reads the URL query config, applies universal theme/font/accent
// settings to <html>, and posts {type:"builtin_ready", id} to the host.

const FONT_STACKS = {
    geist: "'Geist Variable', ui-sans-serif, system-ui, sans-serif",
    system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    serif: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
};

const VALID_THEMES = new Set(["auto", "light", "dark", "midnight"]);

let cachedConfig = null;
let cursorTimer = 0;

function installCursorAutoHide() {
    hideCursor();
    window.addEventListener("pointermove", showCursorBriefly, { passive: true });
    window.addEventListener("mousemove", showCursorBriefly, { passive: true });
    window.addEventListener("pointerdown", hideCursor, { passive: true });
    window.addEventListener("touchstart", hideCursor, { passive: true });
    window.addEventListener("blur", hideCursor);
    document.addEventListener("visibilitychange", hideCursor);
}

function hideCursor() {
    window.clearTimeout(cursorTimer);
    document.documentElement.classList.remove("frame-cursor-active");
}

function showCursorBriefly() {
    document.documentElement.classList.add("frame-cursor-active");
    window.clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(hideCursor, 1200);
}

/**
 * Parse and return the config object from the iframe URL.
 * Returns {} if missing or malformed. Cached after first call.
 */
export function getConfig() {
    if (cachedConfig) return cachedConfig;
    try {
        const raw = new URLSearchParams(location.search).get("config");
        cachedConfig = raw ? JSON.parse(raw) : {};
    } catch {
        cachedConfig = {};
    }
    return cachedConfig;
}

/**
 * Apply a theme: "auto" | "light" | "dark" | "midnight".
 * Unknown values fall back to "auto".
 */
export function applyTheme(theme) {
    const t = VALID_THEMES.has(theme) ? theme : "auto";
    document.documentElement.dataset.theme = t;
}

/**
 * Multiply all clamp-based font sizes by `scale`.
 * Clamped to [0.5, 2] to keep layouts sane.
 */
export function applyFontScale(scale) {
    const n = Number(scale);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(0.5, Math.min(2, n));
    document.documentElement.style.setProperty("--font-scale", String(clamped));
}

/**
 * Switch the active font family. `family` in {"geist", "system", "serif", "mono"}.
 */
export function applyFontFamily(family) {
    const stack = FONT_STACKS[family] ?? FONT_STACKS.geist;
    document.documentElement.style.setProperty("--font-sans-active", stack);
}

/**
 * Override the primary accent color with a CSS color value (hex, rgb(), oklch(), etc.).
 * Pass null or a falsy value to leave the theme default in place.
 */
export function applyAccent(color) {
    if (!color || typeof color !== "string") return;
    document.documentElement.style.setProperty("--primary", color);
}

/**
 * Post the standard ready signal to the host shell.
 */
export function ready(id) {
    try {
        parent.postMessage({ type: "builtin_ready", id }, "*");
    } catch {
        // ignore — running standalone is fine
    }
    // also a console marker for curl-based health checks scraping logs
    console.info(`[builtin] ${id} ready`);
}

/**
 * Convenience: read config, apply universal options, post ready.
 * Returns the parsed config so the caller can act on screen-specific fields.
 */
export function init(id) {
    const cfg = getConfig();
    installCursorAutoHide();
    applyTheme(cfg.theme ?? "auto");
    if (cfg.font_scale != null) applyFontScale(cfg.font_scale);
    if (cfg.font_family) applyFontFamily(cfg.font_family);
    if (cfg.accent_color) applyAccent(cfg.accent_color);
    // Defer ready until the next paint so first-frame styles are settled.
    requestAnimationFrame(() => requestAnimationFrame(() => ready(id)));
    return cfg;
}

/**
 * Helper for screens that load remote data: wraps fetch with a timeout.
 */
export async function fetchWithTimeout(url, opts = {}, ms = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(url, { ...opts, signal: ctrl.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Format a Date as a locale time string honoring the screen's 12/24h preference.
 * `format` in {"24h", "12h"} — anything else uses the OS default.
 */
export function formatTime(date, format = "auto", showSeconds = false) {
    const opts = { hour: "2-digit", minute: "2-digit" };
    if (showSeconds) opts.second = "2-digit";
    if (format === "24h") opts.hour12 = false;
    else if (format === "12h") opts.hour12 = true;
    return date.toLocaleTimeString(undefined, opts);
}

/**
 * Format a Date as a locale date string.
 * `format` in {"long", "medium", "short", "weekday", "iso"}.
 */
export function formatDate(date, format = "long") {
    if (format === "iso") return date.toISOString().slice(0, 10);
    const opts =
        format === "short"   ? { month: "numeric", day: "numeric" } :
        format === "medium"  ? { month: "short", day: "numeric" } :
        format === "weekday" ? { weekday: "long" } :
        /* long */            { weekday: "long", month: "long", day: "numeric" };
    return date.toLocaleDateString(undefined, opts);
}
