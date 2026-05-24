import fs from "node:fs/promises";
import YAML from "yaml";
import { FrameConfigPatch } from "./schema.js";
import { sub } from "../util/logger.js";

const log = sub("config");

type MapNode = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  has: (key: string) => boolean;
};

function isMapNode(node: unknown): node is MapNode {
  return (
    node !== null &&
    typeof node === "object" &&
    typeof (node as { set?: unknown }).set === "function" &&
    typeof (node as { get?: unknown }).get === "function"
  );
}

function ensureMap(parent: MapNode, key: string, doc: YAML.Document): MapNode {
  const existing = parent.get(key);
  if (isMapNode(existing)) return existing;
  parent.set(key, doc.createNode({}));
  return parent.get(key) as MapNode;
}

function setIfDefined(node: MapNode, key: string, value: unknown) {
  if (value === undefined) return;
  node.set(key, value);
}

export async function applyConfigPatch(
  configFile: string,
  patch: FrameConfigPatch,
): Promise<void> {
  const raw = await fs.readFile(configFile, "utf8");
  const doc = YAML.parseDocument(raw);
  const root = doc as unknown as MapNode;

  if (patch.device) {
    const device = ensureMap(root, "device", doc);
    setIfDefined(device, "name", patch.device.name);
  }

  if (patch.display) {
    const display = ensureMap(root, "display", doc);
    setIfDefined(display, "brightness_backend", patch.display.brightness_backend);
    setIfDefined(display, "backlight_device", patch.display.backlight_device);
    setIfDefined(display, "default_brightness", patch.display.default_brightness);
  }

  setIfDefined(root, "default_screen", patch.default_screen);
  setIfDefined(root, "manual_pinned_timeout_hours", patch.manual_pinned_timeout_hours);

  if (patch.scheduler) {
    const scheduler = ensureMap(root, "scheduler", doc);
    setIfDefined(
      scheduler,
      "max_preloaded_url_screens",
      patch.scheduler.max_preloaded_url_screens,
    );
  }

  if (patch.updater) {
    const updater = ensureMap(root, "updater", doc);
    setIfDefined(updater, "repo", patch.updater.repo);
    setIfDefined(updater, "channel", patch.updater.channel);
    setIfDefined(updater, "poll_interval_min", patch.updater.poll_interval_min);
    setIfDefined(updater, "auto_apply", patch.updater.auto_apply);
    setIfDefined(updater, "staging_delay_hours", patch.updater.staging_delay_hours);
    setIfDefined(
      updater,
      "health_check_window_sec",
      patch.updater.health_check_window_sec,
    );
    setIfDefined(updater, "retain_releases", patch.updater.retain_releases);
  }

  if (patch.ha) {
    const ha = ensureMap(root, "ha", doc);
    setIfDefined(ha, "enabled", patch.ha.enabled);
    if (patch.ha.mqtt) {
      const mqtt = ensureMap(ha, "mqtt", doc);
      setIfDefined(mqtt, "host", patch.ha.mqtt.host);
      setIfDefined(mqtt, "port", patch.ha.mqtt.port);
      setIfDefined(mqtt, "username", patch.ha.mqtt.username);
      setIfDefined(mqtt, "keepalive", patch.ha.mqtt.keepalive);
      setIfDefined(mqtt, "discovery_prefix", patch.ha.mqtt.discovery_prefix);
    }
  }

  if (patch.vnc) {
    const vnc = ensureMap(root, "vnc", doc);
    setIfDefined(vnc, "enabled", patch.vnc.enabled);
  }

  if (patch.builtins) {
    const builtins = ensureMap(root, "builtins", doc);
    for (const [id, value] of Object.entries(patch.builtins)) {
      const existing = builtins.get(id);
      if (isMapNode(existing)) {
        for (const [k, v] of Object.entries(value)) {
          existing.set(k, v);
        }
      } else {
        builtins.set(id, doc.createNode(value));
      }
    }
  }

  const tmp = configFile + ".tmp";
  await fs.writeFile(tmp, doc.toString());
  await fs.rename(tmp, configFile);
  log.info("frame.yaml patched");
}
