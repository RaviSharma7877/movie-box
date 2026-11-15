# Device verification — 5 November 2026

Device: Samsung SM-S938B, connected through ADB.
Backend: existing deployed production URL, unchanged during this verification.

## Passed

- Release build compiled and installed successfully.
- No WebView package is present in the native dependency list.
- Native playback of the public Big Buck Bunny sample displays video frames and reports a 09:56 duration.
- Pause holds playback position.
- Forward ten seconds changes position from 01:54 to 02:04.
- Settings show actual 180p video and available audio/subtitle options.
- Speed selection is accessible.
- Returning from the player restores portrait browsing.
- Exact-title search prioritizes Inception over loosely related results.
- Button sizes, colors, and two-column card layout were fixed after device inspection.

## Not working / not verified

- Inception resolves to three MP4 source URLs, but all three return HTTP 429 on the device. Android's player logs confirm a source response error, not a decoder failure.
- Anime playback request for Naruto returns HTTP 502 from the deployed API.
- A source response includes requiresProxy metadata, but a supported provider proxy delivery contract could not be verified. No speculative proxy or access bypass was added.
- Catalog downloads and airplane-mode playback are not acceptance-tested because the catalog source is unavailable. Download validation and resume behavior passed local regression tests.
- Some metadata artwork is unavailable or slow. Fallback treatment exists; richer movie detail enrichment remains a follow-up.

## Artifacts

- Updated standalone APK: ../MovieBox-native.apk
- Screenshots: home-fixed.png, detail.png, sample-player.png, player-verified.png, settings.png
- UI observations: paused.xml, seek.xml, audio-settings.xml, returned-portrait.xml

The app is not yet ready to promise reliable family catalog playback. The native player works with valid media; the external media delivery service remains the blocker.


## 6 November: anime fix deployed and verified
Production Naruto episode 1 returned API 200, HLS master 200, variant 200, and segment 206 with MPEG-TS sync byte 0x47. Opened Naruto Anime from app search and played episode 1 through the deployed API on the Samsung phone. Video frames verified in naruto-live.png. This supersedes the earlier anime 502 result. Film CDN 429 remains unresolved.
