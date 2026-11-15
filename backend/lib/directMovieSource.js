const nacl = require('tweetnacl');
const axios = require('axios');
// Provider protocol key already used by this project's existing VidLink integration.
const PROVIDER_KEY = Buffer.from('c75136c5668bbfe65a7ecad431a745db68b5f381555b38d8f6c699449cf11fcd', 'hex');
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Origin: 'https://vidlink.pro', Referer: 'https://vidlink.pro/' };

function createToken(id) {
  const nonce = Buffer.alloc(24);
  const expires = Buffer.alloc(8);
  expires.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000) + 480));
  const message = Buffer.concat([Buffer.from(String(id)), expires]);
  return Buffer.concat([nonce, Buffer.from(nacl.secretbox(message, nonce, PROVIDER_KEY))]).toString('base64url');
}

async function directMovieSource({ id, tmdbId, type, season = 1, episode = 1 }) {
  let numericId = tmdbId;
  if (!numericId && /^tt\d+$/.test(String(id))) {
    const { data } = await axios.get(`https://v3-cinemeta.strem.io/meta/${type === 'series' ? 'series' : 'movie'}/${id}.json`, { timeout: 6000 });
    numericId = data.meta?.moviedb_id;
  }
  if (!/^\d+$/.test(String(numericId))) throw new Error('No media provider ID is available.');
  const path = type === 'series' ? `tv/${createToken(numericId)}/${season}/${episode}` : `movie/${createToken(numericId)}`;
  const { data } = await axios.get(`https://vidlink.pro/api/b/${path}?multiLang=1`, { headers: HEADERS, timeout: 10000 });
  if (!data?.stream) {
    const error = new Error('This title is not available from the video provider yet.');
    error.code = 'SOURCE_UNAVAILABLE';
    throw error;
  }
  // The vidlink.pro headers belong to the API call above only. The video CDN answers 429 when they are
  // sent along, so each file gets exactly the headers the provider lists for it (usually none).
  const qualities = Object.entries(data.stream.qualities || {}).flatMap(([quality, value]) => value?.url ? [{
    url: value.url, quality: /^\d+$/.test(quality) ? `${quality}p` : quality,
    isM3U8: value.type === 'hls', headers: { ...value.headers },
  }] : []);
  // Start with a moderate resolution; expose all actual source choices to the player.
  qualities.sort((a, b) => Math.abs(parseInt(a.quality) - 720) - Math.abs(parseInt(b.quality) - 720));
  if (data.stream.playlist && !qualities.some(source => source.url === data.stream.playlist)) {
    qualities.push({ url: data.stream.playlist, isM3U8: true, quality: 'Auto', headers: { ...(data.stream.headers || {}) } });
  }
  return { sources: qualities, subtitles: (data.stream?.captions || []).filter(s => /^https:\/\//.test(s.url || '')).map(s => ({
    uri: s.url, title: s.language || 'Subtitles', language: s.language === 'English' ? 'en' : s.language === 'हिन्दी' ? 'hi' : 'und', type: s.type === 'srt' ? 'application/x-subrip' : 'text/vtt',
  })) };
}

module.exports = { directMovieSource, createToken };
