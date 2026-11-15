const axios = require('axios');
const { directMovieSource } = require('./directMovieSource');
const { directAnimeSource } = require('./directAnimeSource');

const normaliseTitle = (title) => String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function normaliseSources(result) {
  return (result.sources || []).flatMap((source) => {
    const uri = source.url || source.uri;
    if (!uri || !/^https:\/\//i.test(uri)) return [];
    let path;
    try { path = new URL(uri).pathname.toLowerCase(); } catch { return []; }
    const type = source.isM3U8 || path.endsWith('.m3u8') ? 'm3u8'
      : path.endsWith('.mp4') ? 'mp4' : path.endsWith('.mpd') ? 'mpd' : null;
    if (!type) return [];
    return [{ uri, type, quality: source.quality || 'Auto', headers: { ...result.headers, ...source.headers }, downloadable: type === 'mp4' }];
  });
}

// Asks for the first byte of each file so sources the CDN refuses (e.g. HTTP 429) never reach the player.
async function reachable(source, get = axios.get) {
  try {
    const { status } = await get(source.uri, {
      headers: { ...source.headers, Range: 'bytes=0-0' }, timeout: 5000,
      responseType: 'stream', validateStatus: () => true, maxRedirects: 3,
    }).then((res) => { res.data?.destroy?.(); return res; });
    return status === 200 || status === 206;
  } catch { return false; }
}

async function keepReachable(sources, get) {
  const ok = await Promise.all(sources.map((s) => (s.type === 'mp4' ? reachable(s, get) : true)));
  return sources.filter((_, i) => ok[i]);
}

async function resolveMedia({ id, tmdbId, title, aliases, type = 'movie', season = 1, episode = 1, audio = 'Sub' }) {
  // Optional catalog of direct media supplied by the operator; never a client-provided fetch URL.
  const catalog = JSON.parse(process.env.MEDIA_CATALOG_JSON || '{}');
  const key = type === 'movie' ? String(id) : `${id}:${season}:${episode}:${audio}`;
  const configured = catalog[key];
  if (configured) {
    const sources = normaliseSources({ sources: configured.sources || [], headers: configured.headers });
    if (!sources.length) throw new Error('No supported media in catalog entry.');
    return { sources, subtitles: configured.subtitles || [] };
  }

  if (type === 'anime') {
    const result = await directAnimeSource({ id, title, aliases, episode, audio });
    return { sources: normaliseSources(result), subtitles: result.subtitles };
  }

  const direct = await directMovieSource({ id, tmdbId, type, season, episode });
  const found = normaliseSources(direct);
  if (!found.length) throw new Error('The provider did not return a direct video source.');
  const sources = await keepReachable(found);
  if (!sources.length) {
    const err = new Error('The video server is refusing connections right now.');
    err.code = 'SOURCE_BLOCKED';
    throw err;
  }
  return { sources, subtitles: direct.subtitles || [] };
}

module.exports = { normaliseSources, normaliseTitle, resolveMedia, keepReachable };
