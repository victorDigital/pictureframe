import { Screen } from "../config/schema.js";

export const SHELL_PROTOCOL_VERSION = 3;

export type CoreToShell =
  | { type: "welcome"; protocolVersion: number }
  | { type: "reload_required"; reason: string }
  | { type: "preload_builtin"; screen: Screen }
  | { type: "show_builtin"; id: string; transitionMs: number }
  | { type: "unload_builtin"; id: string }
  | { type: "show_overlay_image"; dataUrl: string; transitionMs: number }
  | { type: "show_overlay_color"; color: string; transitionMs: number }
  | { type: "hide_overlay"; transitionMs: number }
  | {
      type: "state";
      payload: {
        active: string | null;
        claims: Array<{
          claimId: string;
          screenId: string;
          source: string;
          priority: number;
          expiresAt?: number;
          label?: string;
        }>;
        brightness?: number | null;
      };
    };

export type ShellToCore =
  | { type: "hello"; protocolVersion: number }
  | { type: "builtin_ready"; id: string }
  | { type: "builtin_error"; id: string; error: string }
  | { type: "heartbeat"; visible: string };
