# Home Assistant wiring

Picture Frame announces itself over MQTT discovery the moment
`ha.enabled: true` is set in `frame.yaml`. The entities listed in
SPEC §6.2 appear under a single device named after `device.name`.

For most setups the discovery-published entities are enough — you can
build automations entirely around `select.frame_current_screen` and the
`number.frame_brightness` slider in HA's UI.

The recipes below cover the two integrations that need glue beyond the
out-of-the-box entities.

---

## Doorbell auto-trigger

`builtin-screens/doorbell` displays a snapshot or MJPEG stream and pulses
a banner. It doesn't observe anything itself; SPEC §7 leaves the trigger
to an HA automation. Define the doorbell as a regular URL-screen-style
built-in in `screens.yaml`:

```yaml
- id: front-door
  name: Front door
  type: builtin
  source: doorbell
  config:
    snapshot_url: http://homeassistant.local:8123/api/camera_proxy/camera.front_door
    is_stream: false
    refresh_ms: 1000
    label: Someone at the door
  preload: false
```

Then in HA:

```yaml
- alias: "Frame: show front door for 60 s on ring"
  trigger:
    - platform: state
      entity_id: binary_sensor.front_door_ring
      to: "on"
  action:
    - service: mqtt.publish
      data:
        topic: frame/cmd/show_screen
        payload: '{"id": "front-door", "claim": "ha", "duration_min": 1}'
```

`claim: ha` (priority 20) outranks scheduled rules but yields to anything
manually pinned — that's intentional so a person can still take the frame
back if they want. Use `programmatic` (priority 30) if you'd rather have
the doorbell beat manual-next claims too.

---

## Push media_player → now-playing

The `now-playing` built-in polls `/api/now_playing` and renders whatever
state HA has pushed there. A short automation keeps that endpoint in sync.

Generate a long-lived token in HA (under Profile → Security) and store it
on the frame device, e.g. `/etc/frame/secrets/ha_token` (mode `0600`).
Then in HA:

```yaml
- alias: "Frame: push spotify now-playing"
  trigger:
    - platform: state
      entity_id: media_player.spotify
  action:
    - service: rest_command.frame_push_now_playing
      data:
        state: "{{ states('media_player.spotify') }}"
        title: "{{ state_attr('media_player.spotify', 'media_title') }}"
        artist: "{{ state_attr('media_player.spotify', 'media_artist') }}"
        album: "{{ state_attr('media_player.spotify', 'media_album_name') }}"
        duration: "{{ state_attr('media_player.spotify', 'media_duration') | int(0) }}"
        position: "{{ state_attr('media_player.spotify', 'media_position') | int(0) }}"
        entity_picture: "{{ state_attr('media_player.spotify', 'entity_picture') }}"

rest_command:
  frame_push_now_playing:
    url: "http://frame.local:8080/api/now_playing"
    method: PUT
    headers:
      Authorization: "Bearer !secret frame_bearer_token"
    content_type: "application/json"
    payload: >
      {
        "state": "{{ state }}",
        "title": "{{ title }}",
        "artist": "{{ artist }}",
        "album": "{{ album }}",
        "duration": {{ duration }},
        "position": {{ position }},
        "entity_picture": "{{ entity_picture }}"
      }
```

Combine with the SPEC §6.4 example to swap to the now-playing screen the
moment a track starts:

```yaml
- alias: "Frame: show now playing while music plays"
  trigger:
    platform: state
    entity_id: media_player.spotify
    to: "playing"
  action:
    service: select.select_option
    target: { entity_id: select.frame_current_screen }
    data: { option: "now-playing" }
```

---

## Sunset dim, work-hours dashboard

These are straight from SPEC §6.4 and need no extra glue:

```yaml
- alias: "Frame: dim at sunset"
  trigger: { platform: sun, event: sunset }
  action:
    service: number.set_value
    target: { entity_id: number.frame_brightness }
    data: { value: 15 }

- alias: "Frame: work-hours Grafana"
  trigger: { platform: time, at: "09:00:00" }
  condition: { condition: time, weekday: [mon, tue, wed, thu, fri] }
  action:
    service: mqtt.publish
    data:
      topic: frame/cmd/show_screen
      payload: '{"id": "grafana-home", "claim": "ha", "duration_min": 480}'
```

---

## MQTT broker credential drift

If you rotate the broker password but forget to update
`/etc/frame/secrets/mqtt`, frame-core's MQTT client retries five times
before going into `auth_failed`. That state is published as
`binary_sensor.frame_mqtt_auth_ok = off` and shown as a distinct badge in
the web UI. Build an HA alert against it:

```yaml
- alias: "Frame: alert on MQTT auth failure"
  trigger:
    platform: state
    entity_id: binary_sensor.frame_mqtt_auth_ok
    to: "off"
  action:
    service: notify.mobile_app_phone
    data:
      message: "Picture Frame can't talk to the MQTT broker — check the password file."
```
