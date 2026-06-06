export type NowPlaying = {
  state: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  position?: number;
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
  const source = unwrapHomeAssistantState(input);
  if (source == null) return null;
  if (typeof source === "string") {
    const state = cleanString(source);
    return state ? { state } : null;
  }
  if (!isRecord(source)) return null;

  const attrs = isRecord(source.attributes) ? source.attributes : {};
  const state = cleanString(source.state) ?? cleanString(attrs.state);
  if (!state) return null;

  return {
    state,
    ...stringProp("title", source.title, attrs.media_title, attrs.title),
    ...stringProp("artist", source.artist, attrs.media_artist, attrs.artist),
    ...stringProp("album", source.album, attrs.media_album_name, attrs.media_album, attrs.album),
    ...numberProp("duration", source.duration, attrs.media_duration, attrs.duration),
    ...numberProp("position", source.position, attrs.media_position, attrs.position),
    ...pictureProp(source.entity_picture, attrs.entity_picture, attrs.entity_picture_local, source.picture, opts.haBaseUrl),
  };
}

function unwrapHomeAssistantState(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const event = input.event;
  if (isRecord(event) && isRecord(event.data) && "new_state" in event.data) return event.data.new_state;
  if (isRecord(input.data) && "new_state" in input.data) return input.data.new_state;
  if ("new_state" in input) return input.new_state;
  return input;
}

function stringProp(key: "title" | "artist" | "album", ...values: unknown[]) {
  const value = firstString(...values);
  return value ? { [key]: value } : {};
}

function numberProp(key: "duration" | "position", ...values: unknown[]) {
  const value = firstNumber(...values);
  return value == null ? {} : { [key]: value };
}

function pictureProp(...values: unknown[]) {
  const haBaseUrl = values.at(-1);
  const picture = firstString(...values.slice(0, -1));
  if (!picture) return {};
  return {
    entity_picture: absolutizeUrl(picture, typeof haBaseUrl === "string" ? haBaseUrl : undefined),
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || ["none", "null", "undefined", "unknown", "unavailable"].includes(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
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
