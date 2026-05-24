import { z } from "zod";

export const ScreenSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  type: z.enum(["url", "builtin"]),
  source: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  preload: z.boolean().default(false),
  transitionMs: z.number().int().min(0).max(10_000).optional(),
  reloadIntervalSec: z.number().int().min(5).optional(),
  tags: z.array(z.string()).optional(),
});

export type Screen = z.infer<typeof ScreenSchema>;

export const ScreensFileSchema = z.object({
  screens: z.array(ScreenSchema).min(1),
});

export type ScreensFile = z.infer<typeof ScreensFileSchema>;

const HOSTNAME_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const hostnameOrIp = z
  .string()
  .min(1)
  .refine((s) => IPV4_RE.test(s) || HOSTNAME_RE.test(s), {
    message: "must be a hostname or IPv4 address",
  });

export const FrameConfigSchema = z
  .object({
    device: z.object({
      name: z.string().min(1),
      bearer_token_file: z.string().min(1),
    }),
    display: z.object({
      brightness_backend: z.enum(["backlight", "ddcutil", "none"]).default("backlight"),
      backlight_device: z.string().optional(),
      default_brightness: z.number().int().min(0).max(100).default(60),
    }),
    screens_file: z.string().min(1),
    default_screen: z.string().min(1),
    manual_pinned_timeout_hours: z.number().int().min(0).default(4),
    scheduler: z
      .object({
        max_preloaded_url_screens: z.number().int().min(1).max(20).default(5),
      })
      .default({ max_preloaded_url_screens: 5 }),
    updater: z.object({
      repo: z.string().regex(/^[^/]+\/[^/]+$/, "expected owner/repo"),
      channel: z.enum(["stable", "beta"]).default("stable"),
      poll_interval_min: z.number().int().min(1).default(15),
      auto_apply: z.boolean().default(false),
      staging_delay_hours: z.number().int().min(0).default(24),
      health_check_window_sec: z.number().int().min(5).default(60),
      retain_releases: z.number().int().min(1).default(3),
      signing_key_file: z.string().optional(),
    }),
    ha: z
      .object({
        enabled: z.boolean().default(false),
        mqtt: z
          .object({
            host: hostnameOrIp,
            port: z.number().int().min(1).max(65535).default(1883),
            username: z.string().min(1),
            password_file: z.string().min(1),
            keepalive: z.number().int().min(5).default(60),
            discovery_prefix: z.string().default("homeassistant"),
          })
          .optional(),
      })
      .default({ enabled: false }),
    vnc: z
      .object({
        enabled: z.boolean().default(true),
        password_file: z.string().min(1),
      })
      .optional(),
    builtins: z.record(z.unknown()).default({}),
  })
  .strict();

export type FrameConfig = z.infer<typeof FrameConfigSchema>;

export const FrameConfigPatchSchema = z
  .object({
    device: z
      .object({
        name: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    display: z
      .object({
        brightness_backend: z.enum(["backlight", "ddcutil", "none"]).optional(),
        backlight_device: z.string().optional(),
        default_brightness: z.number().int().min(0).max(100).optional(),
      })
      .strict()
      .optional(),
    default_screen: z.string().min(1).optional(),
    manual_pinned_timeout_hours: z.number().int().min(0).max(168).optional(),
    scheduler: z
      .object({
        max_preloaded_url_screens: z.number().int().min(1).max(20).optional(),
      })
      .strict()
      .optional(),
    updater: z
      .object({
        repo: z.string().regex(/^[^/]+\/[^/]+$/, "expected owner/repo").optional(),
        channel: z.enum(["stable", "beta"]).optional(),
        poll_interval_min: z.number().int().min(1).max(1440).optional(),
        auto_apply: z.boolean().optional(),
        staging_delay_hours: z.number().int().min(0).max(720).optional(),
        health_check_window_sec: z.number().int().min(5).max(3600).optional(),
        retain_releases: z.number().int().min(1).max(20).optional(),
      })
      .strict()
      .optional(),
    ha: z
      .object({
        enabled: z.boolean().optional(),
        mqtt: z
          .object({
            host: hostnameOrIp.optional(),
            port: z.number().int().min(1).max(65535).optional(),
            username: z.string().min(1).optional(),
            keepalive: z.number().int().min(5).max(3600).optional(),
            discovery_prefix: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    vnc: z
      .object({
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    builtins: z.record(z.object({ enabled: z.boolean() }).passthrough()).optional(),
  })
  .strict();

export type FrameConfigPatch = z.infer<typeof FrameConfigPatchSchema>;
