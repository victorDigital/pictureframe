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

test("now-playing treats stale Music Assistant idle state with media as playing", () => {
  assert.deepEqual(
    normalizeNowPlaying(
      {
        state: "idle",
        attributes: {
          mass_player_type: "player",
          active_queue: "kitchen",
          media_title: "Still Here",
          media_artist: "The Queue",
          media_album_name: "State Drift",
          media_duration: 181,
          entity_picture: "/api/media_player_proxy/media_player.ma_kitchen?token=abc",
        },
      },
      { haBaseUrl: "https://ha.example" },
    ),
    {
      state: "playing",
      title: "Still Here",
      artist: "The Queue",
      album: "State Drift",
      duration: 181,
      entity_picture: "https://ha.example/api/media_player_proxy/media_player.ma_kitchen?token=abc",
    },
  );
});

test("now-playing accepts Music Assistant queue responses", () => {
  assert.deepEqual(
    normalizeNowPlaying({
      "media_player.ma_kitchen_speaker": {
        queue_id: "kitchen",
        active: true,
        elapsed_time: 37,
        current_item: {
          queue_item_id: "abc",
          name: "Queue Name",
          duration: 224,
          media_item: {
            media_type: "track",
            uri: "spotify://track/123",
            name: "New Signal",
            image: "https://images.example/new-signal.jpg",
            artists: [{ name: "Desk Light" }, { name: "Late Guest" }],
            album: { name: "Night Mode" },
          },
        },
      },
    }),
    {
      state: "playing",
      title: "New Signal",
      artist: "Desk Light, Late Guest",
      album: "Night Mode",
      duration: 224,
      position: 37,
      entity_picture: "https://images.example/new-signal.jpg",
    },
  );
});
