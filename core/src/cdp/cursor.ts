export function cursorHideScript(): string {
  return `(() => {
    const styleId = "frame-cursor-hidden-style";

    const installStyle = () => {
      if (document.getElementById(styleId)) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = "html, body, * { cursor: none !important; }";
      (document.head || document.documentElement).appendChild(style);
    };

    installStyle();
  })();`;
}
