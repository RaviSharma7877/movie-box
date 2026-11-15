# MovieBox mobile

Native Android app built with Expo / React Native.

The redesigned interface uses midnight-blue surfaces, ivory typography, gold accents, consistent spacing, safe-area insets, and touch targets of at least 44 points.

## Main flows

- Discover and search films, series, and anime.
- Read title details and select season / episode.
- Watch in the native video player, with seeking, speed, fit/fill, screen lock, available source quality, audio, and subtitle settings.
- Save downloadable MP4 sources, pause/resume transfers, and play verified files offline.

No WebView is used or installed. HLS/DASH streams are playable but are not presented as downloadable MP4 files. Downloads are not guaranteed to continue while Android suspends or terminates the app; interrupted records are restored as paused.

## Configuration

Keep `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_API_KEY` in `.env`. The backend needs the new `/api/playback` and `/api/details` endpoints before this version can be tested against production.

## Development

```powershell
npm install
npm run android
```

Use a native build, not Expo Go. To validate bundling:

```powershell
npx expo export --platform android --output-dir dist-native-check
```

Run `npm test` for download regressions. Device acceptance testing follows backend deployment, as described in [deployment notes](../DEPLOYMENT.md).
