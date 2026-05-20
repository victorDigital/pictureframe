import { FrameConfig, Screen } from "./schema.js";

const SAFE_MODE_TOKEN_LEN = 24;

function randomToken() {
  const chars =
    "ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(SAFE_MODE_TOKEN_LEN));
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

export type SafeMode = {
  config: FrameConfig;
  screens: Screen[];
  bearerToken: string;
  reason: string;
  details?: unknown;
};

export function buildSafeMode(reason: string, details?: unknown): SafeMode {
  const token = randomToken();
  // eslint-disable-next-line no-console
  console.error(
    `\n========= FRAME SAFE MODE =========\n` +
      `Reason: ${reason}\n` +
      `Use this one-time bearer token for the web UI: ${token}\n` +
      `=====================================\n`,
  );

  const config: FrameConfig = {
    device: { name: "frame-safe-mode", bearer_token_file: "" },
    display: { brightness_backend: "none", default_brightness: 60 },
    screens_file: "",
    default_screen: "emergency",
    manual_pinned_timeout_hours: 4,
    scheduler: { max_preloaded_url_screens: 5 },
    updater: {
      repo: "victorDigital/pictureframe",
      channel: "stable",
      poll_interval_min: 15,
      auto_apply: false,
      staging_delay_hours: 24,
      health_check_window_sec: 60,
      retain_releases: 3,
    },
    ha: { enabled: false },
    builtins: {},
  };

  const screens: Screen[] = [
    {
      id: "emergency",
      name: "Configuration error",
      type: "builtin",
      source: "emergency",
      preload: true,
    },
  ];

  return { config, screens, bearerToken: token, reason, details };
}
