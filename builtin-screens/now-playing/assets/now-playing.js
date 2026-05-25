let progressTimer = null;
export function startNowPlaying(config, els) {
  const layout = config.layout ?? "split";
  const blurOn = config.blur_background !== false;
  const blurPx = clampInt(config.blur_amount, 0, 96, 48);
  const accentSource = config.accent_source ?? "art";
  const showProgress = config.show_progress !== false;
  document.documentElement.style.setProperty("--np-blur", blurPx + "px");
  applyLayout(els.panel, layout);
  if (!showProgress) els.progress.classList.add("hidden");
  function applyLayout(panel, mode) {
    panel.classList.remove("np-layout-split", "np-layout-stacked", "np-layout-minimal");
    panel.classList.add("np-layout-" + mode);
  }
  async function applyAccent(artUrl) {
    if (accentSource === "primary") { document.documentElement.style.removeProperty("--np-accent"); return; }
    if (accentSource === "custom") {
      if (config.accent_color) document.documentElement.style.setProperty("--np-accent", config.accent_color);
      else document.documentElement.style.removeProperty("--np-accent");
      return;
    }
    if (artUrl) {
      const sampled = await sampleArtColor(artUrl);
      if (sampled) { document.documentElement.style.setProperty("--np-accent", sampled); return; }
    }
    document.documentElement.style.removeProperty("--np-accent");
  }
  function render(state) {
    if (!state || state.state !== "playing") {
      els.panel.classList.add("hidden"); els.panel.classList.remove("grid", "flex");
      els.empty.classList.remove("hidden"); els.empty.classList.add("grid");
      els.bg.style.backgroundImage = ""; clearInterval(progressTimer); return;
    }
    els.empty.classList.add("hidden"); els.empty.classList.remove("grid");
    els.panel.classList.remove("hidden");
    els.panel.classList.add(layout === "split" ? "grid" : "flex");
    els.title.textContent = state.title || "";
    els.artist.textContent = state.artist || "";
    els.album.textContent = state.album || "";
    const art = state.entity_picture || "";
    const artCss = art ? "url(" + cssUrl(art) + ")" : "none";
    els.art.style.backgroundImage = artCss;
    if (blurOn && art) { els.bg.style.backgroundImage = artCss; els.bg.classList.remove("hidden"); }
    else { els.bg.style.backgroundImage = ""; els.bg.classList.add("hidden"); }
    applyAccent(art);
    clearInterval(progressTimer);
    const bar = els.progress.firstElementChild;
    if (showProgress && state.duration && state.position != null) {
      els.progress.classList.remove("hidden");
      const startedAt = Date.now() - state.position * 1000;
      const duration = state.duration * 1000;
      const update = () => {
        const pct = Math.min(100, ((Date.now() - startedAt) / duration) * 100);
        bar.style.width = pct + "%";
        if (pct >= 100) clearInterval(progressTimer);
      };
      update(); progressTimer = setInterval(update, 500);
    } else { bar.style.width = "0%"; if (!showProgress) els.progress.classList.add("hidden"); }
  }
  window.addEventListener("message", (ev) => { if (ev.data?.type === "now_playing") render(ev.data.state); });
  async function poll() {
    try { const r = await fetch("/api/now_playing"); if (r.ok) render(await r.json()); } catch {}
  }
  poll(); setInterval(poll, 5000);
}
function cssUrl(url) { return String(url).replace(/"/g, "\\22"); }
function clampInt(value, min, max, fallback) {
  const n = Number(value); if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function sampleArtColor(url) {
  return new Promise((resolve) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 32; const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        if (!n) { resolve(null); return; }
        resolve("rgb(" + Math.round(r/n) + "," + Math.round(g/n) + "," + Math.round(b/n) + ")");
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null); img.src = url;
  });
}
