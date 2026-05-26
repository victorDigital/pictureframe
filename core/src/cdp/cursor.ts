export const cursorHideDelayMs = 1200;

export function cursorAutoHideScript(delayMs = cursorHideDelayMs): string {
  return `(() => {
    const activeClass = "frame-cursor-active";
    const styleId = "frame-cursor-autohide-style";
    const delayMs = ${JSON.stringify(delayMs)};
    let timer = 0;

    const installStyle = () => {
      if (document.getElementById(styleId)) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = "html, body, * { cursor: none !important; } html." + activeClass + ", html." + activeClass + " * { cursor: auto !important; }";
      (document.head || document.documentElement).appendChild(style);
    };

    const hide = () => {
      window.clearTimeout(timer);
      document.documentElement.classList.remove(activeClass);
    };

    const showBriefly = () => {
      installStyle();
      document.documentElement.classList.add(activeClass);
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
