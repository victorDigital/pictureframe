import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { MissingScreen, useScreenEnvironment } from "./shared";
import type { Config } from "./shared";
import { screens } from "./screens";
import "./style.css";

function readConfig(): Config {
  try {
    const raw = new URLSearchParams(location.search).get("config");
    return raw ? (JSON.parse(raw) as Config) : {};
  } catch {
    return {};
  }
}

function App({ id }: { id: string }) {
  const config = useMemo(readConfig, []);
  useScreenEnvironment(config, id);
  const Component = screens[id] ?? MissingScreen;
  return <Component config={config} id={id} />;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");
createRoot(rootEl).render(<App id={rootEl.dataset.screenId ?? ""} />);
