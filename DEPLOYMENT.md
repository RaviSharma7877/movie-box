# Native playback update

Deploy the `backend` directory to the existing Vercel project before installing the new mobile build.

```powershell
cd C:\Users\ravis\Desktop\MovieBox\backend
npx vercel --prod
```

Keep the current `INTERNAL_API_KEY` and `ALLOWED_ORIGIN`. The mobile API URL and shared key are unchanged. No additional environment variables are required for the default providers.

New endpoints:

- `POST /api/playback`: accepts `id`, `title`, `type` (`movie`, `series`, `anime`), optional `tmdbId`, `season`, `episode`, and `audio`. Returns direct sources, their request headers, actual quality labels, download capability, and subtitle tracks.
- `GET /api/details?id=tt...`: returns title details and available season/episode metadata.

The new app uses these endpoints. Existing `/api/stream` routes remain available for older installations; they are not used by the new player.

## Verification before deployment

- Deployed search endpoints returned HTTP 200 for film and anime queries.
- Deployed `/api/stream` returned an embed URL, not native media.
- Deployed `/api/playback` returned 404, confirming deployment is necessary.
- Updated local resolver returned MP4 URLs for Inception with 360p, 480p, and 1080p variants and subtitle tracks.
- Requests for the actual video bytes returned HTTP 429 from the external CDN. Successful playback is therefore not yet verified. A deployment does not guarantee provider availability; retest from Vercel and the phone before treating the app as ready for family use.
- Anime direct-source adapter still needs live verification; its provider timed out in local checks.
- Android debug build and Android JavaScript export succeeded. No new build was installed on the phone.

After deployment, verify `/api/playback` on the deployed URL, then install the native-only app and test play/pause, seek, source quality changes, subtitles, background/resume, offline download, and airplane-mode playback on the connected phone.

## Local checks

```powershell
node --test backend/test/*.test.js mobile/test/*.test.cjs
```

`backend/test/device-server.js` is a local-only acceptance fixture using the Blender Foundation's Big Buck Bunny sample. It is never part of the deployed API and must not replace the real backend during the production test.

For an operator-supplied direct-media catalog, optional `MEDIA_CATALOG_JSON` can map movie IDs (or `id:season:episode:audio` for episodes) to `{ "sources": [{ "url": "https://.../video.mp4", "quality": "720p" }] }`. This is optional and is not needed for the default resolver.

## Post-deployment device verification
The update was deployed successfully and the native-only release installed on the Samsung phone. Public sample playback, pause, ten-second seeking, and portrait return were verified. Film sources still return HTTP 429 on-device, and the anime API request returned 502. See device-checks/REPORT.md. No additional backend deployment is needed for the mobile layout fixes made during this test.

## 6 November: anime source repair

The installed Hianime adapter uses the older hianime.to service and paths. The backend now resolves anime through the current hianime.at search, episode list, and server configuration, preserving the required media referrer. Local live Naruto episode 1 verification returned master 200, variant 200, and video segment 206 (188 MPEG-TS bytes, sync byte 0x47). Deploy the backend again with `npx vercel --prod`, then verify the production anime endpoint before device testing. No mobile rebuild is needed for this resolver change. Film CDN delivery still returns HTTP 429 and is not fixed by this update.
