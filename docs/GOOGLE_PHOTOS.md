# Google Photos

The `photos` built-in can load a Google Photos album through frame-core. The
browser never talks to Google directly: frame-core refreshes OAuth access tokens,
lists media items, and proxies image bytes through local `/api/photos/google/*`
URLs.

## API limits

Google Photos requires OAuth 2.0 user consent. Service accounts are not
supported for Google Photos.

The current Google Photos Library API is limited to app-created content. In
practice, the configured album and media need to be accessible to the OAuth app
you created. If you need arbitrary personal-library photo picking, that is a
separate Google Photos Picker API integration and is not part of this built-in.

## Configure Google

1. In Google Cloud Console, enable the Google Photos Library API.
2. Create an OAuth client for a web server or desktop app.
3. Request offline access with this scope:

```text
https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata
```

4. Complete OAuth consent once and save the resulting refresh token.
5. Store the OAuth client secret and refresh token on the frame:

```sh
sudo install -d -m 0750 -o root -g frame /etc/frame/secrets
sudo install -m 0640 -o root -g frame /path/to/client_secret /etc/frame/secrets/google_photos_client_secret
sudo install -m 0640 -o root -g frame /path/to/refresh_token /etc/frame/secrets/google_photos_refresh_token
```

## Configure the screen

```yaml
screens:
  - id: photos
    name: Family photos
    type: builtin
    source: photos
    config:
      library: google
      google_album_id: "replace-with-google-photos-album-id"
      google_client_id: "replace-with-google-oauth-client-id"
      google_client_secret_file: /etc/frame/secrets/google_photos_client_secret
      google_refresh_token_file: /etc/frame/secrets/google_photos_refresh_token
      google_max_items: 200
      google_image_width: 2160
      google_image_height: 2160
      interval_sec: 30
      transition_style: kenburns
    preload: true
```

Leave `google_album_id` empty to use app-created library photos rather than one
album. Google caps media-list pages at 100 items; `google_max_items` controls how
many items frame-core follows across pages.
