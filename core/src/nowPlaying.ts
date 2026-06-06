import YAML from "yaml";

export type NowPlaying = {
  state: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  position?: number;
  position_updated_at?: string;
  entity_picture?: string;
};

type NormalizeOptions = {
  haBaseUrl?: string;
};

let nowPlaying: NowPlaying | null = null;

export function getNowPlaying() {
  return nowPlaying;
}

export function setNowPlaying(input: unknown, opts: NormalizeOptions = {}) {
  nowPlaying = normalizeNowPlaying(input, opts);
  return nowPlaying;
}

export function normalizeNowPlaying(input: unknown, opts: NormalizeOptions = {}): NowPlaying | null {
  if (input == null) return null;
  const source = unwrapMusicAssistantQueueResponse(
    unwrapHomeAssistantState(parseStructuredString(input)),
  );
  if (source == null) return null;
  if (typeof source === "string") {
    const state = normalizeState(source);
    return state ? { state } : null;
  }
  if (!isRecord(source)) return null;

  const attrs = isRecord(source.attributes) ? source.attributes : {};
  const queueItem = isRecord(source.current_item) ? source.current_item : undefined;
  const mediaItem = isRecord(queueItem?.media_item) ? queueItem.media_item : undefined;
  const streamTitle = firstString(
    queueItem?.stream_title,
    mediaItem?.stream_title,
    source.stream_title,
    attrs.stream_title,
  );
  const streamParts = splitStreamTitle(streamTitle);
  const state = normalizeState(source.state) ?? normalizeState(attrs.state);
  const title = firstString(
    source.title,
    attrs.media_title,
    attrs.title,
    attrs.media_name,
    streamParts?.title,
    mediaItem?.name,
    queueItem?.name,
    attrs.name,
  );
  const artist = firstString(
    source.artist,
    attrs.media_artist,
    attrs.artist,
    streamParts?.artist,
    namesFromItems(mediaItem?.artists),
    attrs.media_album_artist,
  );
  const album = firstString(
    source.album,
    attrs.media_album_name,
    attrs.media_album,
    attrs.album,
    isRecord(mediaItem?.album) ? mediaItem.album.name : undefined,
  );
  const duration = firstNumber(source.duration, attrs.media_duration, attrs.duration, queueItem?.duration);
  const position = firstNumber(
    source.position,
    attrs.media_position,
    attrs.position,
    source.elapsed_time,
    attrs.elapsed_time,
  );
  const positionUpdatedAt = firstString(
    source.position_updated_at,
    attrs.media_position_updated_at,
    attrs.position_updated_at,
  );
  const picture = firstString(
    source.entity_picture,
    attrs.entity_picture,
    attrs.entity_picture_local,
    source.media_image_url,
    attrs.media_image_url,
    source.media_image,
    attrs.media_image,
    source.thumbnail,
    attrs.thumbnail,
    source.image,
    attrs.image,
    queueItem?.image,
    mediaItem?.image,
    source.picture,
    source.art_url,
    source.album_art_url,
  );
  const hasMedia = Boolean(title || artist || album || picture);
  const resolvedState =
    state && shouldTrustMusicAssistantMetadata(source, attrs, state, hasMedia)
      ? "playing"
      : (state ?? (hasMedia ? "playing" : undefined));
  if (!resolvedState) return null;

  return {
    state: resolvedState,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(duration == null ? {} : { duration }),
    ...(position == null ? {} : { position }),
    ...(positionUpdatedAt ? { position_updated_at: positionUpdatedAt } : {}),
    ...(picture ? { entity_picture: absolutizeUrl(picture, opts.haBaseUrl) } : {}),
  };
}

function unwrapHomeAssistantState(input: unknown): unknown {
  if (!isRecord(input)) return input;
  if ("payload" in input && !("state" in input) && !("attributes" in input)) {
    return unwrapHomeAssistantState(parseStructuredString(input.payload));
  }
  if (isRecord(input.trigger) && "to_state" in input.trigger) {
    return unwrapHomeAssistantState(input.trigger.to_state);
  }
  const event = input.event;
  if (isRecord(event) && isRecord(event.data) && "new_state" in event.data) return event.data.new_state;
  if (isRecord(input.data) && "new_state" in input.data) return input.data.new_state;
  if (isRecord(input.data) && "to_state" in input.data) return input.data.to_state;
  if ("new_state" in input) return input.new_state;
  if ("to_state" in input) return input.to_state;
  return input;
}

function unwrapMusicAssistantQueueResponse(input: unknown): unknown {
  if (!isRecord(input) || "state" in input || "attributes" in input || "current_item" in input) {
    return input;
  }
  const values = Object.values(input);
  if (values.length !== 1 || !isRecord(values[0])) return input;
  const value = values[0];
  return "current_item" in value && ("queue_id" in value || "elapsed_time" in value) ? value : input;
}

function parseStructuredString(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return input;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    try {
      return YAML.parse(trimmed) as unknown;
    } catch {
      return input;
    }
  }
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value.map(cleanString).filter(Boolean).join(", ");
      if (joined) return joined;
    }
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function namesFromItems(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => (isRecord(item) ? cleanString(item.name) : cleanString(item)))
    .filter(Boolean);
}

function cleanString(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed || ["none", "null", "undefined", "unknown", "unavailable"].includes(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
}

function normalizeState(value: unknown) {
  return cleanString(value)?.toLowerCase();
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function splitStreamTitle(value: string | undefined) {
  if (!value?.includes(" - ")) return undefined;
  const [artist, title] = value.split(" - ", 2).map((part) => cleanString(part));
  return artist || title ? { artist, title } : undefined;
}

function shouldTrustMusicAssistantMetadata(
  source: Record<string, unknown>,
  attrs: Record<string, unknown>,
  state: string,
  hasMedia: boolean,
) {
  if (!hasMedia || !["idle", "off", "standby", "unknown", "unavailable"].includes(state)) return false;
  return Boolean(
    firstString(source.queue_id, attrs.active_queue, attrs.mass_player_type) ||
      firstString(source.app_id, attrs.app_id) === "music_assistant",
  );
}

function absolutizeUrl(value: string, baseUrl?: string) {
  try {
    return new URL(value).toString();
  } catch {
    if (!baseUrl || !value.startsWith("/")) return value;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
