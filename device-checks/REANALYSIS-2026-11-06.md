# MovieBox reanalysis — 6 November 2026

## Current verification

The deployed production playback API was tested using the mobile configuration:

| Title | Production result |
|---|---|
| Breaking Bad S1E1 | HTTP 200; MP4 360p, 480p, 720p, 1080p |
| Alchemy of Souls S1E1 | HTTP 200; MP4 360p, 480p, 720p |
| Inception | HTTP 200; MP4 360p, 480p, 1080p |
| Interstellar | HTTP 502; provider reports title unavailable |

The current backend probes MP4 URLs before returning them. These results establish server-side access, not playback acceptance on the phone. ADB showed no devices during this review, so all three named film/series paths still require device verification. Earlier Naruto phone verification remains historical evidence, not a fresh test of the current build.

24 existing regression checks passed: 12 backend and 12 mobile. No runtime code was changed during this review.

## Findings needing attention

1. **Client timeout is shorter than the backend budget.** Mobile fetchPlayback uses 15 seconds while /api/playback permits 25 seconds. A source successfully resolved in seconds 15–25 can still appear to fail in the app. Align the budgets and test a delayed response.
2. **Offline HLS does not handle separate audio renditions.** parseMaster reads video variants but ignores EXT-X-MEDIA AUDIO groups. runHls downloads only the chosen media playlist. A source with separate audio can save successfully but play without sound offline. The current fixtures do not cover this playlist structure.
3. **HLS completion validation checks only the first segment.** Later downloaded files are checked for nonzero size and HTTP status, but an HTML response with HTTP 200 in a later segment can survive validation. This can mark a damaged episode complete. Validate each media segment and cover failures after the first segment.

## Clarifications to the supplied status list

- Inception is now accepted by the deployed backend; the earlier PC refusal does not persist in this check. Its cause was not established, so repeated requests should not be stated as the confirmed cause.
- Interstellar remains unavailable from the single configured film provider. Provider coverage remains a limitation.
- Download recovery is implemented at App startup through resumeInterrupted. It is not a native background transfer service. HLS reuses completed segments; interrupted MP4 tasks without a valid snapshot restart the file rather than guarantee byte-level continuation.
- Manually paused downloads are distinct from tasks interrupted when the app closes.
- Audio labels use a supplied title first, then a recognized language code, then Track N. Missing metadata cannot reliably establish a language; a label should not be guessed.
- Subtitle cues are parsed before enqueue and saved beside the download, so the JSON contains offline cues rather than just remote subtitle URLs.

## Next device acceptance checks

Reconnect an unlocked USB-debugging phone, verify which APK is installed, then test Breaking Bad S1E1, Alchemy of Souls S1E1, and Inception. For each: start, pause, seek, quality change, audio selection, background/foreground. Test an HLS save with subtitles, close/reopen recovery, and offline playback. Test MP4 recovery separately because its behavior differs.

