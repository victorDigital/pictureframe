export const cursorHideDelayMs = 1200;

export function cursorAutoHideScript(delayMs = cursorHideDelayMs): string {
  return `(() => {
    const idleClass = "frame-cursor-idle";
    const styleId = "frame-cursor-autohide-style";
    const delayMs = ${JSON.stringify(delayMs)};
    let timer = 0;

    const installStyle = () => {
      if (document.getElementById(styleId)) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = "html." + idleClass + ", html." + idleClass + " * { cursor: none !important; }";
      (document.head || document.documentElement).appendChild(style);
    };

    const hide = () => {
      window.clearTimeout(timer);
      document.documentElement.classList.add(idleClass);
    };

    const showBriefly = () => {
      installStyle();
      document.documentElement.classList.remove(idleClass);
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, delayMs);
    };

    installStyle();
    hide();
    window.addEventListener("pointermove", showBriefly, { passive: true });
    window.addEventListener("mousemove", showBriefly, { passive: true });
    window.addEventListener("pointerdown", hide, { passive: true });
    window.addEventListener("touchstart", hide, { passive: true });
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
  })();`;
}
