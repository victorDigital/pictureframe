import type { ScreenComponent } from "../shared";
import { AgendaBoardScreen, CalendarScreen } from "./Calendar";
import { AmbientScreen } from "./Ambient";
import { ClockScreen } from "./Clock";
import { DoorbellScreen } from "./Doorbell";
import { EmergencyScreen } from "./Emergency";
import { FamilyMessageScreen } from "./FamilyMessage";
import { MediaViewerScreen, PhotosScreen } from "./Media";
import { NowPlayingScreen } from "./NowPlaying";
import { StatusBoardScreen } from "./StatusBoard";
import { TransitScreen } from "./Transit";
import { WeatherScreen } from "./Weather";

export const screens: Record<string, ScreenComponent> = {
  "agenda-board": AgendaBoardScreen,
  ambient: AmbientScreen,
  calendar: CalendarScreen,
  clock: ClockScreen,
  doorbell: DoorbellScreen,
  emergency: EmergencyScreen,
  "family-message": FamilyMessageScreen,
  "media-viewer": MediaViewerScreen,
  "now-playing": NowPlayingScreen,
  photos: PhotosScreen,
  "status-board": StatusBoardScreen,
  transit: TransitScreen,
  weather: WeatherScreen,
};
