import fs from "node:fs/promises";
import mqtt from "mqtt";
import { FrameConfig, Screen } from "../config/schema.js";
import { Scheduler } from "../scheduler/index.js";
import { Updater } from "../updater/index.js";
import { Brightness } from "../system/brightness.js";
import { sub } from "../util/logger.js";

const log = sub("mqtt");

type MqttState = "disconnected" | "connecting" | "connected" | "retrying" | "auth_failed";

export class HaBridge {
  private client?: mqtt.MqttClient;
  private state: MqttState = "disconnected";
  private authFailures = 0;
  private discoveryPrefix: string;
  private nodeId: string;

  constructor(
    private cfg: FrameConfig,
    private scheduler: Scheduler,
    private updater: Updater,
    private brightness: Brightness,
  ) {
    const mqtt = cfg.ha.mqtt;
    this.discoveryPrefix = mqtt?.discovery_prefix ?? "homeassistant";
    this.nodeId = `frame_${cfg.device.name.replace(/[^a-z0-9_]/gi, "_")}`;
    this.scheduler.on("activate", () => this.publishState());
  }

  updateConfig(cfg: FrameConfig) {
    this.cfg = cfg;
    this.discoveryPrefix = cfg.ha.mqtt?.discovery_prefix ?? "homeassistant";
    this.nodeId = `frame_${cfg.device.name.replace(/[^a-z0-9_]/gi, "_")}`;
  }

  async restart() {
    this.stop();
    if (this.cfg.ha.enabled && this.cfg.ha.mqtt) {
      await this.start();
    }
  }

  status() {
    return { state: this.state, authFailures: this.authFailures };
  }

  async start() {
    if (!this.cfg.ha.enabled || !this.cfg.ha.mqtt) {
      log.info("HA disabled in config");
      return;
    }
    const conf = this.cfg.ha.mqtt;
    const password = (await fs.readFile(conf.password_file, "utf8").catch(() => "")).trim();
    this.state = "connecting";

    const client = mqtt.connect(`mqtt://${conf.host}:${conf.port}`, {
      clientId: `${this.nodeId}_${process.pid}`,
      protocolVersion: 4,
      clean: true,
      username: conf.username,
      password,
      keepalive: conf.keepalive,
      reconnectPeriod: 5000,
      will: {
        topic: this.stateTopic("availability"),
        payload: "offline",
        retain: true,
        qos: 0,
      },
    });
    this.client = client;

    client.on("connect", () => {
      this.state = "connected";
      this.authFailures = 0;
      log.info("MQTT connected");
      void this.publishDiscovery();
      client.publish(this.stateTopic("availability"), "online", { retain: true, qos: 0 });
      client.subscribe(`frame/cmd/+`, { qos: 0 }, (err) => {
        if (err) log.warn({ err }, "MQTT command subscribe failed");
      });
      this.publishState();
    });

    client.on("reconnect", () => {
      if (this.state === "connected") this.state = "retrying";
    });

    client.on("close", () => {
      if (this.state === "connected") this.state = "disconnected";
    });

    client.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      const msg = String(err.message);
      if (msg.toLowerCase().includes("not authoriz") || code === "Not authorized") {
        this.authFailures++;
        if (this.authFailures >= 5) {
          this.state = "auth_failed";
          log.error("MQTT auth_failed after 5 attempts; stopping retries");
          client.end(true);
        }
      } else {
        if (msg.includes("Invalid header flag bits")) {
          log.warn(
            { err: msg, host: conf.host, port: conf.port },
            "MQTT protocol error; check that host/port points to the broker listener, usually 1883, not the Home Assistant web UI",
          );
          return;
        }
        log.warn({ err: msg }, "MQTT error");
      }
    });

    client.on("message", (topic, payload) => {
      this.handleCommand(topic, payload.toString()).catch((err) =>
        log.error({ err, topic }, "command handler failed"),
      );
    });
  }

  stop() {
    this.client?.end(true);
    this.client = undefined;
    this.state = "disconnected";
  }

  private stateTopic(suffix: string) {
    return `frame/${this.cfg.device.name}/${suffix}`;
  }

  private commonDevice() {
    return {
      identifiers: [this.nodeId],
      name: `Picture Frame – ${this.cfg.device.name}`,
      manufacturer: "Picture Frame",
      model: "frame-core",
      sw_version: this.updater.status().current,
    };
  }

  private async publishDiscovery() {
    if (!this.client) return;
    const device = this.commonDevice();
    const availability = [{ topic: this.stateTopic("availability") }];

    const publish = (component: string, id: string, payload: Record<string, unknown>) => {
      const topic = `${this.discoveryPrefix}/${component}/${this.nodeId}/${id}/config`;
      this.client!.publish(topic, JSON.stringify(payload), { retain: true });
    };

    const screenOptions = (this.scheduler as unknown as { screens: Map<string, { id: string }> })
      .screens
      ? Array.from((this.scheduler as unknown as { screens: Map<string, { id: string }> }).screens.values()).map(
          (s) => s.id,
        )
      : [];

    publish("select", "current_screen", {
      name: "Current screen",
      command_topic: "frame/cmd/show_screen",
      command_template: '{"id": "{{ value }}", "claim": "ha"}',
      state_topic: this.stateTopic("active_screen"),
      options: screenOptions,
      unique_id: `${this.nodeId}_current_screen`,
      availability,
      device,
    });

    publish("sensor", "active_screen", {
      name: "Active screen",
      state_topic: this.stateTopic("active_screen"),
      unique_id: `${this.nodeId}_active_screen`,
      availability,
      device,
    });
    publish("sensor", "version", {
      name: "Version",
      state_topic: this.stateTopic("version"),
      unique_id: `${this.nodeId}_version`,
      availability,
      device,
    });
    publish("sensor", "update_available", {
      name: "Update available",
      state_topic: this.stateTopic("update_available"),
      unique_id: `${this.nodeId}_update_available`,
      availability,
      device,
    });
    publish("sensor", "last_update_status", {
      name: "Last update status",
      state_topic: this.stateTopic("last_update_status"),
      unique_id: `${this.nodeId}_last_update_status`,
      availability,
      device,
    });
    publish("binary_sensor", "mqtt_auth_ok", {
      name: "MQTT auth ok",
      state_topic: this.stateTopic("mqtt_auth_ok"),
      payload_on: "true",
      payload_off: "false",
      unique_id: `${this.nodeId}_mqtt_auth_ok`,
      availability,
      device,
    });
    publish("number", "brightness", {
      name: "Brightness",
      command_topic: "frame/cmd/brightness",
      command_template: '{"value": {{ value }}}',
      state_topic: this.stateTopic("brightness"),
      min: 0,
      max: 100,
      step: 1,
      unique_id: `${this.nodeId}_brightness`,
      availability,
      device,
    });
    publish("switch", "display_power", {
      name: "Display",
      command_topic: "frame/cmd/display_power",
      command_template: '{"state": "{{ value }}"}',
      payload_on: "on",
      payload_off: "off",
      state_topic: this.stateTopic("display_power"),
      unique_id: `${this.nodeId}_display_power`,
      availability,
      device,
    });
    publish("sensor", "uptime", {
      name: "Uptime",
      state_topic: this.stateTopic("uptime"),
      unit_of_measurement: "s",
      unique_id: `${this.nodeId}_uptime`,
      availability,
      device,
    });
    publish("button", "reboot", {
      name: "Reboot",
      command_topic: "frame/cmd/reboot",
      unique_id: `${this.nodeId}_reboot`,
      availability,
      device,
    });
    publish("button", "update_now", {
      name: "Update now",
      command_topic: "frame/cmd/update_now",
      unique_id: `${this.nodeId}_update_now`,
      availability,
      device,
    });
    publish("button", "update_now_force", {
      name: "Update now (force)",
      command_topic: "frame/cmd/update_now_force",
      unique_id: `${this.nodeId}_update_now_force`,
      availability,
      device,
    });
  }

  private async publishState() {
    if (!this.client) return;
    const active = this.scheduler.activeScreen();
    this.client.publish(this.stateTopic("active_screen"), active?.id ?? "none", { retain: true });
    this.client.publish(this.stateTopic("version"), this.updater.status().current, { retain: true });
    this.client.publish(
      this.stateTopic("update_available"),
      this.updater.status().available?.tag ?? "none",
      { retain: true },
    );
    this.client.publish(
      this.stateTopic("last_update_status"),
      this.updater.status().lastResult ?? "unknown",
      { retain: true },
    );
    this.client.publish(this.stateTopic("mqtt_auth_ok"), this.state === "auth_failed" ? "false" : "true", {
      retain: true,
    });
    this.client.publish(this.stateTopic("uptime"), String(Math.round(process.uptime())));
    try {
      const b = await this.brightness.read();
      this.client.publish(this.stateTopic("brightness"), String(b), { retain: true });
    } catch {
      // ignore
    }
  }

  private async handleCommand(topic: string, raw: string) {
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      // some buttons send empty payloads
    }
    const cmd = topic.replace(/^frame\/cmd\//, "");
    log.info({ cmd, body }, "command received");
    switch (cmd) {
      case "show_screen": {
        const id = String(body.id ?? "");
        const claimRaw = String(body.claim ?? "ha");
        const claim = claimRaw === "ha" ? "ha" : "programmatic";
        const dur = typeof body.duration_min === "number" ? body.duration_min : undefined;
        if (id) this.scheduler.show(id, claim as "ha" | "programmatic", { durationMin: dur });
        break;
      }
      case "release_screen": {
        const id = String(body.id ?? "");
        if (!id) break;
        for (const c of this.scheduler.list()) {
          if (c.screenId === id && c.source !== "default") this.scheduler.release(c.claimId);
        }
        break;
      }
      case "brightness": {
        if (typeof body.value === "number") await this.brightness.write(body.value);
        break;
      }
      case "display_power": {
        const s = body.state === "off" ? "off" : "on";
        await this.brightness.displayPower(s);
        break;
      }
      case "reboot":
        await this.brightness.scheduleReboot();
        break;
      case "update_now":
        await this.updater.applyAvailable({ force: false }).catch((err) =>
          log.error({ err }, "update_now failed"),
        );
        break;
      case "update_now_force":
        await this.updater.applyAvailable({ force: true }).catch((err) =>
          log.error({ err }, "update_now_force failed"),
        );
        break;
      case "set_default":
        if (typeof body.id === "string") this.scheduler.updateDefault(body.id);
        break;
      default:
        log.warn({ cmd }, "unknown command");
    }
    this.publishState();
  }

  // Provided to satisfy the type checker on the screens parameter referenced above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _screensReference(_s: Screen[]) {}
}
