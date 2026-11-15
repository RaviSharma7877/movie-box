# MovieBox backend

Express functions deployed to the existing Vercel project.

## Setup

Copy `.env.example` to `.env` if needed, preserve the existing `INTERNAL_API_KEY` and `ALLOWED_ORIGIN`, and run `npm install` followed by `npm run dev`.

## Native app endpoints

| Endpoint | Purpose |
| --- | --- |
| POST /api/search | Film and series search |
| POST /api/anime/search | Anime search |
| POST /api/playback | Direct sources, required media headers, actual quality options, and subtitles |
| GET /api/details?id=tt... | Details and season/episode metadata |

Send the existing `X-API-KEY` header on every request.

Playback accepts `{ id, title, type, tmdbId?, season?, episode?, audio? }`. Type is `movie`, `series`, or `anime`. An episode parameter never changes a movie into a series.

Film/series resolution first uses the project's existing VidLink integration with actual direct source URLs. FlixHQ is the fallback. Anime uses the installed Hianime adapter with exact title matching and episode selection. External provider failures return an actionable 502 instead of an embed page.

Existing stream/download endpoints are retained for compatibility with old builds; the redesigned app does not use them.

Optional `MEDIA_CATALOG_JSON` allows an operator-provided direct-media catalog. See [deployment notes](../DEPLOYMENT.md).

## Deploy

From this folder, run `npx vercel --prod`. Keep the existing production project and URL.

## Tests

Run `npm test`. Tests use an isolated local HTTP server; they do not change the deployed service.
