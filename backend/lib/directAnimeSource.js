const { load } = require('cheerio');
const BASE = 'https://hianime.at';
// Romanisation varies between catalogues ("Shippuuden" vs "Shippuden", "Kyou" vs "Kyo"), so long vowels are folded.
const titleKey = value => String(value || '').normalize('NFKC').toLowerCase()
  // Keep the installment, part and special markers; normalize only season notation.
  .replace(/\bseason\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)?\s+season\b/g, (_, before, after) => before || after)
  .replace(/[^\p{L}\p{N}]/gu, '')
  .replace(/ou|oo/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/ee/g, 'e');

function decodeConfig(html) {
  const encoded = html.match(/window\.__P\s*=\s*["']([^"']+)["']/)?.[1];
  if (!encoded) throw new Error('Anime player configuration is unavailable.');
  const bytes = Buffer.from(encoded, 'base64');
  const key = Buffer.from('otaku-embed-v1');
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  return JSON.parse(bytes.toString('utf8'));
}

async function findAnime({ id, title, aliases = [] }, get) {
  const titles = [...new Set([title, ...aliases].filter(Boolean))].slice(0, 5);
  const keys = new Set(titles.map(titleKey));
  const candidates = new Map();
  for (const query of titles.slice(0, 2)) {
    const $ = load(await get(`${BASE}/search?keyword=${encodeURIComponent(query)}`));
    $('#main-sidebar').remove();
    const results = $('.film-name a').toArray().flatMap(el => {
      const link = $(el);
      const href = link.attr('href');
      if (!href) return [];
      const url = new URL(href, BASE);
      if (url.origin !== BASE) return [];
      const slug = url.pathname.split('/').filter(Boolean).pop();
      const id = slug?.match(/-(\d+)$/)?.[1];
      const exact = [link.attr('title'), link.attr('data-jname'), link.text()].some(name => keys.has(titleKey(name)));
      return id ? [{ slug, id, exact }] : [];
    });
    for (const result of results) candidates.set(result.id, result);
    const matches = results.filter(result => result.exact);
    if (matches.length) return [...new Map(matches.map(m => [m.id, m])).values()];
  }
  if (candidates.size && /^\d+$/.test(String(id))) {
    const malId = typeof id === 'number' ? String(id) : await kitsuMalId(id, get);
    if (malId) {
      const checks = await Promise.allSettled([...candidates.values()].slice(0, 5).map(async candidate => {
        const [first] = await listEpisodes(candidate, get);
        if (!first) return null;
        const servers = await episodeServers(first.episodeId, get);
        const belongsToTitle = servers.some(({ embed }) => animeIdFromEmbed(embed) === malId);
        return belongsToTitle ? { ...candidate, malId } : null;
      }));
      const verified = checks.flatMap(check => check.status === 'fulfilled' && check.value ? [check.value] : []);
      if (verified.length) return verified;
      if (checks.every(check => check.status === 'rejected')) throw checks[0].reason;
    }
  }
  throw new Error('No matching anime title was found.');
}

async function kitsuMalId(id, get) {
  const { data } = await get(`https://kitsu.io/api/edge/anime/${id}/mappings`, true);
  const value = data?.find(item => item.attributes?.externalSite === 'myanimelist/anime')?.attributes.externalId;
  return /^\d+$/.test(String(value)) ? String(value) : null;
}

function animeIdFromEmbed(embed) {
  return embed.pathname.match(/(?:^|\/)mal\/(\d+)(?:\/|$)/)?.[1];
}

async function episodeServers(episodeId, get) {
  const $ = load((await get(`${BASE}/api/theme/episode/servers?episodeId=${encodeURIComponent(episodeId)}`, true)).html || '');
  return $('[data-server-name="ZokoAnime"]').toArray().flatMap(element => {
    const server = $(element);
    try {
      const embed = new URL(Buffer.from(server.attr('data-hash') || '', 'base64').toString('utf8'));
      return embed.origin === 'https://zokoanime.video' ? [{ embed, mode: server.attr('data-type') }] : [];
    } catch {
      return [];
    }
  });
}

function animeClient(request) {
  return async function get(url, json = false) {
    const response = await request(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`Anime provider returned HTTP ${response.status}.`);
    return json ? response.json() : response.text();
  };
}

async function directAnimeSource({ id, title, aliases, episode = 1, audio = 'Sub' }, request = fetch) {
  const get = animeClient(request);
  const matches = await findAnime({ id, title, aliases }, get);
  let lastError;
  for (const match of matches.slice(0, 2)) {
    try {
      return await resolveEpisode(match, episode, audio, get);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function listEpisodes({ slug, id }, get) {
  const episodes = load((await get(`${BASE}/api/theme/episode/list/${id}`, true)).html || '');
  return episodes('[data-number]').toArray().flatMap(el => {
    const entry = episodes(el);
    const number = Number(entry.attr('data-number'));
    const episodeId = entry.attr('data-id');
    if (!Number.isInteger(number) || number < 1 || !episodeId ||
        !(entry.attr('href') || '').includes(`/watch/${slug}?`)) return [];
    return [{ number, episodeId, title: entry.attr('title') || entry.find('.ep-name').text().trim() }];
  });
}

async function getAnimeEpisodes({ id, title, aliases }, request = fetch) {
  const get = animeClient(request);
  const matches = await findAnime({ id, title, aliases }, get);
  const responses = await Promise.allSettled(matches.slice(0, 2).map(match => listEpisodes(match, get)));
  const episodes = new Map();
  for (const response of responses) {
    if (response.status === 'fulfilled') for (const { number, title } of response.value) {
      if (!episodes.has(number)) episodes.set(number, { season: 1, number, title: title || `Episode ${number}` });
    }
  }
  if (!episodes.size && responses.every(response => response.status === 'rejected')) throw responses[0].reason;
  return [...episodes.values()].sort((a, b) => a.number - b.number);
}

async function resolveEpisode(match, episode, audio, get) {
  const item = (await listEpisodes(match, get)).find(item => item.number === Number(episode));
  const episodeId = item?.episodeId;
  if (!episodeId) throw new Error('This anime episode is unavailable.');
  const mode = audio === 'Dub' ? 'dub' : 'sub';
  const servers = await episodeServers(episodeId, get);
  const matching = servers.find(server => server.mode === mode && (!match.malId || animeIdFromEmbed(server.embed) === match.malId));
  if (!matching) throw new Error(`This episode is unavailable in ${mode} audio.`);
  const { embed } = matching;
  const config = decodeConfig(await get(embed.href));
  const uri = new URL(config.src);
  if (uri.protocol !== 'https:' || !uri.pathname.endsWith('.m3u8')) throw new Error('No direct anime video was returned.');
  return {
    sources: [{ url: uri.href, quality: 'Auto', isM3U8: true, headers: { Referer: `${embed.origin}/`, 'User-Agent': 'Mozilla/5.0' } }],
    subtitles: (config.subtitles || []).filter(s => /^https:\/\//.test(s.src || '') && /\.vtt(?:\?|$)/i.test(s.src)).map(s => ({ uri: s.src, title: s.label || s.lang || 'Subtitles', language: s.lang || 'und', type: 'text/vtt', headers: { Referer: `${embed.origin}/`, 'User-Agent': 'Mozilla/5.0' } })),
  };
}
module.exports = { directAnimeSource, decodeConfig, getAnimeEpisodes };
