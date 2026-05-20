// Shell page (Tab 0). Hosts built-in screens as iframes and the
// transition overlay layer. Speaks the versioned WebSocket protocol
// described in SPEC §4.4.

const PROTOCOL_VERSION = 3;

type ScreenInfo = {
  id: string;
  name: string;
  type: "url" | "builtin";
  source: string;
  config?: Record<string, unknown>;
  preload?: boolean;
  transitionMs?: number;
};

type CoreMsg =
  | { type: "welcome"; protocolVersion: number }
  | { type: "reload_required"; reason: string }
  | { type: "preload_builtin"; screen: ScreenInfo }
  | { type: "show_builtin"; id: string; transitionMs: number }
  | { type: "unload_builtin"; id: string }
  | { type: "show_overlay_image"; dataUrl: string; transitionMs: number }
  | { type: "show_overlay_color"; color: string; transitionMs: number }
  | { type: "show_loading_hint"; label: string }
  | { type: "hide_loading_hint" }
  | { type: "hide_overlay"; transitionMs: number };

const builtinsRoot = document.getElementById("builtins")!;
const overlayEl = document.getElementById("overlay")!;
const statusEl = document.getElementById("status")!;

const iframes = new Map<string, HTMLIFrameElement>();
let activeId: string | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let visible: string = "";

function setStatus(text: string | null) {
  if (text) {
    statusEl.textContent = text;
    statusEl.setAttribute("data-show", "true");
  } else {
    statusEl.removeAttribute("data-show");
  }
}

function setTransitionMs(ms: number) {
  document.documentElement.style.setProperty("--transition-ms", `${ms}ms`);
}

function builtinUrl(screen: ScreenInfo): string {
  const cfg = screen.config ? `?config=${encodeURIComponent(JSON.stringify(screen.config))}` : "";
  return `/builtin/${encodeURIComponent(screen.source)}/index.html${cfg}`;
}

function preloadBuiltin(screen: ScreenInfo) {
  if (iframes.has(screen.id)) return;
  const iframe = document.createElement("iframe");
  iframe.src = builtinUrl(screen);
  iframe.dataset.id = screen.id;
  iframe.dataset.active = "false";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  builtinsRoot.appendChild(iframe);
  iframes.set(screen.id, iframe);
}

function showBuiltin(id: string, transitionMs: number) {
  setTransitionMs(transitionMs);
  for (const [otherId, ifr] of iframes) {
    ifr.dataset.active = otherId === id ? "true" : "false";
  }
  activeId = id;
  visible = id;
  send({ type: "heartbeat", visible });
}

function unloadBuiltin(id: string) {
  const ifr = iframes.get(id);
  if (ifr) {
    ifr.remove();
    iframes.delete(id);
  }
}

function showOverlayImage(dataUrl: string, transitionMs: number) {
  overlayEl.style.background = `#000 center / cover no-repeat url("${dataUrl}")`;
  setTransitionMs(transitionMs);
  // Force reflow so transition applies.
  void overlayEl.offsetHeight;
  overlayEl.setAttribute("data-state", "visible");
}

function showOverlayColor(color: string, transitionMs: number) {
  overlayEl.style.background = color;
  setTransitionMs(transitionMs);
  void overlayEl.offsetHeight;
  overlayEl.setAttribute("data-state", "visible");
}

function hideOverlay(transitionMs: number) {
  setTransitionMs(transitionMs);
  overlayEl.setAttribute("data-state", "hidden");
  setTimeout(() => {
    overlayEl.style.background = "transparent";
  }, transitionMs + 50);
}

function send(msg: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.onopen = () => {
    setStatus(null);
    send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  };
  ws.onmessage = (ev) => {
    let msg: CoreMsg;
    try {
      msg = JSON.parse(ev.data) as CoreMsg;
    } catch {
      return;
    }
    handle(msg);
  };
  ws.onclose = () => {
    ws = null;
    if (activeId) setStatus("Reconnecting…");
    if (reconnectTimer == null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1500);
    }
  };
  ws.onerror = () => ws?.close();
}

function handle(msg: CoreMsg) {
  switch (msg.type) {
    case "welcome":
      if (msg.protocolVersion !== PROTOCOL_VERSION) location.reload();
      break;
    case "reload_required":
      location.reload();
      break;
    case "preload_builtin":
      preloadBuiltin(msg.screen);
      break;
    case "show_builtin":
      showBuiltin(msg.id, msg.transitionMs);
      break;
    case "unload_builtin":
      unloadBuiltin(msg.id);
      break;
    case "show_overlay_image":
      showOverlayImage(msg.dataUrl, msg.transitionMs);
      break;
    case "show_overlay_color":
      showOverlayColor(msg.color, msg.transitionMs);
      break;
    case "show_loading_hint":
      showLoadingHint(msg.label);
      break;
    case "hide_loading_hint":
      hideLoadingHint();
      break;
    case "hide_overlay":
      hideOverlay(msg.transitionMs);
      break;
  }
}

let loadingHintEl: HTMLDivElement | null = null;
function showLoadingHint(label: string) {
  if (!loadingHintEl) {
    loadingHintEl = document.createElement("div");
    loadingHintEl.id = "loading-hint";
    loadingHintEl.style.cssText =
      "position:fixed;bottom:2rem;right:2rem;background:rgba(0,0,0,0.6);" +
      "color:#fff;padding:0.5rem 1rem;border-radius:0.4rem;font-size:1rem;" +
      "z-index:1000;backdrop-filter:blur(4px);";
    document.body.appendChild(loadingHintEl);
  }
  loadingHintEl.textContent = `Loading ${label}…`;
  loadingHintEl.style.display = "block";
}

function hideLoadingHint() {
  if (loadingHintEl) loadingHintEl.style.display = "none";
}

window.addEventListener("message", (ev) => {
  if (ev.data?.type === "builtin_ready" && typeof ev.data.id === "string") {
    send({ type: "builtin_ready", id: ev.data.id });
  } else if (ev.data?.type === "builtin_error") {
    send({ type: "builtin_error", id: ev.data.id, error: ev.data.error });
  }
});

setInterval(() => send({ type: "heartbeat", visible }), 5000);

connect();
