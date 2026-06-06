import fs from "node:fs/promises";
import { Screen } from "../config/schema.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PHOTOS_API = "https://photoslibrary.googleapis.com/v1";

type GoogleConfig = {
  clientId: string;
  clientSecretFile: string;
  refreshTokenFile: string;
  albumId?: string;
  pageSize: number;
  maxItems: number;
  imageWidth: number;
  imageHeight: number;
};

type Token = {
  accessToken: string;
  expiresAt: number;
};

type GoogleMediaItem = {
  id?: string;
  description?: string;
  filename?: string;
  mimeType?: string;
  baseUrl?: string;
  mediaMetadata?: {
    creationTime?: string;
  };
};

const tokenCache = new Map<string, Token>();

export type GooglePhotoItem = {
  id: string;
  url: string;
  caption: string;
};

export function readGoogleConfig(screen: Screen): GoogleConfig {
  const cfg = screen.config ?? {};
  const clientId = stringValue(cfg.google_client_id);
  const clientSecretFile = stringValue(cfg.google_client_secret_file);
  const refreshTokenFile = stringValue(cfg.google_refresh_token_file);
  if (!clientId || !clientSecretFile || !refreshTokenFile) {
    throw new Error("Configure google_client_id, google_client_secret_file, and google_refresh_token_file");
  }
  return {
    clientId,
    clientSecretFile,
    refreshTokenFile,
    albumId: stringValue(cfg.google_album_id) || undefined,
    pageSize: clamp(numberValue(cfg.google_page_size, 100), 1, 100),
    maxItems: clamp(numberValue(cfg.google_max_items, 200), 1, 1000),
    imageWidth: clamp(numberValue(cfg.google_image_width, 2160), 320, 8192),
    imageHeight: clamp(numberValue(cfg.google_image_height, 2160), 320, 8192),
  };
}

export async function listGooglePhotos(screen: Screen): Promise<GooglePhotoItem[]> {
  const cfg = readGoogleConfig(screen);
  const accessToken = await getAccessToken(cfg);
  const items: GooglePhotoItem[] = [];
  let pageToken: string | undefined;

  do {
    const limit = Math.min(cfg.pageSize, cfg.maxItems - items.length);
    const body = cfg.albumId
      ? { albumId: cfg.albumId, pageSize: limit, ...(pageToken ? { pageToken } : {}) }
      : {
          pageSize: limit,
          ...(pageToken ? { pageToken } : {}),
          filters: { mediaTypeFilter: { mediaTypes: ["PHOTO"] } },
        };
    const res = await fetchJson<{ mediaItems?: GoogleMediaItem[]; nextPageToken?: string }>(
      `${PHOTOS_API}/mediaItems:search`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    for (const item of res.mediaItems ?? []) {
      if (!item.id || !item.mimeType?.startsWith("image/")) continue;
      items.push({
        id: item.id,
        url: `/api/photos/google/media?screen=${encodeURIComponent(screen.id)}&id=${encodeURIComponent(item.id)}`,
        caption: captionFor(item),
      });
      if (items.length >= cfg.maxItems) break;
    }
    pageToken = res.nextPageToken;
  } while (pageToken && items.length < cfg.maxItems);

  return items;
}

export async function googlePhotoUrl(screen: Screen, mediaItemId: string): Promise<string> {
  const cfg = readGoogleConfig(screen);
  const accessToken = await getAccessToken(cfg);
  const item = await fetchJson<GoogleMediaItem>(
    `${PHOTOS_API}/mediaItems/${encodeURIComponent(mediaItemId)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!item.baseUrl || !item.mimeType?.startsWith("image/")) {
    throw new Error("google_photo_not_found");
  }
  return `${item.baseUrl}=w${cfg.imageWidth}-h${cfg.imageHeight}`;
}

async function getAccessToken(cfg: GoogleConfig) {
  const cacheKey = `${cfg.clientId}:${cfg.clientSecretFile}:${cfg.refreshTokenFile}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const [clientSecret, refreshToken] = await Promise.all([
    readSecret(cfg.clientSecretFile),
    readSecret(cfg.refreshTokenFile),
  ]);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetchJson<{ access_token?: string; expires_in?: number }>(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.access_token) throw new Error("google_token_missing_access_token");
  const expiresIn = Number.isFinite(res.expires_in) ? Number(res.expires_in) : 3600;
  tokenCache.set(cacheKey, {
    accessToken: res.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  });
  return res.access_token;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Photos HTTP ${res.status}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

async function readSecret(file: string) {
  return (await fs.readFile(file, "utf8")).trim();
}

function captionFor(item: GoogleMediaItem) {
  return item.description?.trim() || item.filename?.trim() || item.mediaMetadata?.creationTime?.slice(0, 10) || "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
