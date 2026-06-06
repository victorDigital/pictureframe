import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNowPlaying } from "../src/nowPlaying.js";

test("now-playing normalizes Home Assistant trigger payloads", () => {
  assert.deepEqual(
    normalizeNowPlaying(
      {
        trigger: {
          to_state: {
            state: "PLAYING",
            attributes: {
              media_title: "Soft Light",
              media_artist: "The Frames",
              media_album_name: "Kiosk Sessions",
              media_duration: "245",
              media_position: "42",
              media_position_updated_at: "2026-06-06T12:00:00+00:00",
              entity_picture: "/api/media_player_proxy/media_player.spotify?token=abc",
            },
          },
        },
      },
      { haBaseUrl: "http://homeassistant.local:8123" },
    ),
    {
      state: "playing",
      title: "Soft Light",
      artist: "The Frames",
      album: "Kiosk Sessions",
      duration: 245,
      position: 42,
      position_updated_at: "2026-06-06T12:00:00+00:00",
      entity_picture: "http://homeassistant.local:8123/api/media_player_proxy/media_player.spotify?token=abc",
    },
  );
});

test("now-playing parses structured string payloads from HA templates", () => {
  assert.deepEqual(
    normalizeNowPlaying(
      "{'state': 'playing', 'attributes': {'media_title': 'Soft Light', 'media_artist': ['The Frames', 'Guest'], 'entity_picture': '/api/image/serve/abc/512x512'}}",
      { haBaseUrl: "https://ha.example" },
    ),
    {
      state: "playing",
      title: "Soft Light",
      artist: "The Frames, Guest",
      entity_picture: "https://ha.example/api/image/serve/abc/512x512",
    },
  );
});

test("now-playing treats metadata-only payloads as active media", () => {
  assert.deepEqual(
    normalizeNowPlaying({
      title: "Late Night",
      artist: "Signal",
      media_image_url: "https://images.example/cover.jpg",
    }),
    {
      state: "playing",
      title: "Late Night",
      artist: "Signal",
      entity_picture: "https://images.example/cover.jpg",
    },
  );
});

