/** Canvas blob field for the ambient built-in screen. */

const PALETTES = {
  midnight: ["#021029", "#0a3358", "#3b6da6", "#75aede"],
  embers: ["#1a0500", "#5a1100", "#a83a16", "#f0b264"],
  aurora: ["#001a1f", "#003d3b", "#19a98c", "#7be0b6"],
  ocean: ["#010a14", "#062a45", "#14658a", "#4aafc9"],
  forest: ["#020a06", "#0d2e1a", "#1f6040", "#6aab72"],
  mono: ["#0a0a0a", "#2a2a2a", "#666666", "#aaaaaa"],
};

const SPEED = { slow: 0.12, normal: 0.25, fast: 0.45 };
const BLOB_COUNT = { sparse: 4, normal: 7, dense: 12 };

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Record<string, unknown>} config
 */
export function startAmbient(canvas, config) {
  const paletteName = PALETTES[config.palette] ? config.palette : "midnight";
  const palette = [...PALETTES[paletteName]];
  if (typeof config.accent_color === "string" && config.accent_color.trim()) {
    palette[palette.length - 1] = config.accent_color.trim();
  }

  const ctx = canvas.getContext("2d");
  const speedMul = SPEED[config.motion_speed] ?? SPEED.slow;
  const blobCount = BLOB_COUNT[config.density] ?? BLOB_COUNT.normal;

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const W = () => window.innerWidth;
  const H = () => window.innerHeight;

  const blobs = Array.from({ length: blobCount }, (_, i) => ({
    x: Math.random() * W(),
    y: Math.random() * H(),
    vx: (Math.random() - 0.5) * speedMul,
    vy: (Math.random() - 0.5) * speedMul,
    r: W() * (0.22 + Math.random() * 0.28),
    c: palette[(i % (palette.length - 1)) + 1],
  }));

  function frame() {
    ctx.fillStyle = palette[0];
    ctx.fillRect(0, 0, W(), H());
    ctx.globalCompositeOperation = "lighter";
    for (const b of blobs) {
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < -b.r) b.vx = Math.abs(b.vx);
      if (b.x > W() + b.r) b.vx = -Math.abs(b.vx);
      if (b.y < -b.r) b.vy = Math.abs(b.vy);
      if (b.y > H() + b.r) b.vy = -Math.abs(b.vy);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, b.c + "aa");
      g.addColorStop(1, b.c + "00");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(frame);
  }
  frame();
}

const CLOCK_STYLES = {
  minimal: "text-display-lg tabular font-thin tracking-tight text-foreground opacity-60",
  soft: "text-title-xl tabular font-light tracking-tight text-muted-foreground",
  bold: "text-display tabular font-medium tracking-tight text-foreground",
  ghost:
    "text-display-lg tabular font-thin tracking-tight text-foreground opacity-30 backdrop-blur-sm",
};

/**
 * @param {HTMLElement} el
 * @param {Record<string, unknown>} config
 */
export function startClock(el, config) {
  if (config.show_clock === false) {
    el.classList.add("hidden");
    return;
  }

  const style = CLOCK_STYLES[config.clock_style] ?? CLOCK_STYLES.minimal;
  el.className =
    "fixed inset-0 z-10 flex items-center justify-center pointer-events-none select-none " + style;

  function tick() {
    const n = new Date();
    el.textContent =
      String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0");
  }
  tick();
  setInterval(tick, 1000);
}
