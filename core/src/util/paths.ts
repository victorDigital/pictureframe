import path from "node:path";

export const paths = {
  configFile: process.env.FRAME_CONFIG ?? "/etc/frame/frame.yaml",
  stateDir: process.env.FRAME_STATE_DIR ?? "/opt/frame/state",
  releasesDir: process.env.FRAME_RELEASES_DIR ?? "/opt/frame/releases",
  snapshotsDir: process.env.FRAME_SNAPSHOTS_DIR ?? "/opt/frame/snapshots",
  runtimeDir: process.env.FRAME_RUNTIME_DIR ?? "/run/frame",
  current: process.env.FRAME_CURRENT ?? "/opt/frame/current",
  staticRoot:
    process.env.FRAME_STATIC_ROOT ??
    path.resolve(process.cwd(), ".."),
};

export const stateFile = (...parts: string[]) =>
  path.join(paths.stateDir, ...parts);

export const releaseDir = (tag: string) => path.join(paths.releasesDir, tag);
