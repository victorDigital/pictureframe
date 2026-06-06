import type { ScreenComponent } from "../shared";
import { ClockScreen } from "./Clock";
import { NowPlayingScreen } from "./NowPlaying";

export const screens: Record<string, ScreenComponent> = {
  clock: ClockScreen,
  "now-playing": NowPlayingScreen,
};
