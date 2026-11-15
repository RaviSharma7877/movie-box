/**
 * Anime Metadata Helper.
 * Fetches titles, posters, episode counts, synopsis, score, and genre chips.
 * Primary: Jikan REST API (MyAnimeList).
 * Fallback: Kitsu.io API.
 * Neither requires an API key.
 */
const axios = require('axios');

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const KITSU_BASE = 'https://kitsu.io/api/edge';

/**
 * Search anime by query text (or get top/trending if query is 'trending' or 'popular').
 * @param {string} query
 * @returns {Promise<object[]>}
 */
async function searchAnime(query) {
  const isTrending = !query || query === 'trending' || query === 'popular';

  // 1. Try Kitsu API first (Ultra-fast CDN, ~300ms, no rate-limiting)
  try {
    const endpoint = isTrending ? `${KITSU_BASE}/trending/anime` : `${KITSU_BASE}/anime`;
    const params = isTrending
      ? { 'page[limit]': 16 }
      : { 'filter[text]': query, 'page[limit]': 20, include: 'categories' };

    const { data } = await axios.get(endpoint, {
      params,
      timeout: 5000,
    });

    if (data?.data?.length > 0) {
      return formatKitsuCollection(data);
    }
  } catch (err) {
    console.warn('[animeMetadata] Kitsu search failed, falling back to Jikan:', err.message);
  }

  // 2. Fallback to Jikan API
  try {
    const endpoint = isTrending ? `${JIKAN_BASE}/top/anime` : `${JIKAN_BASE}/anime`;
    const params = isTrending
      ? { limit: 16, sfw: true }
      : { q: query, limit: 16, sfw: true };

    const { data } = await axios.get(endpoint, {
      params,
      timeout: 5000,
    });

    if (data?.data?.length > 0) {
      return data.data.map(formatJikanAnime);
    }
  } catch (err) {
    console.warn('[animeMetadata] Jikan fallback failed:', err.message);
  }

  return [];
}

/**
 * Get detailed anime info by ID.
 * @param {number|string} animeId
 * @returns {Promise<object>}
 */
async function getAnimeDetails(animeId) {
  try {
    const { data } = await axios.get(`${JIKAN_BASE}/anime/${animeId}`, {
      timeout: 10000,
    });
    return formatJikanAnime(data.data);
  } catch {
    return null;
  }
}

function formatJikanAnime(a) {
  if (!a) return null;
  return {
    id: a.mal_id,
    type: 'anime',
    title: a.title_english || a.title,
    aliases: [...new Set([a.title, a.title_english, a.title_japanese, ...(a.title_synonyms || [])].filter(Boolean))].slice(0, 4),
    format: a.type,
    releaseDate: a.aired?.from || null,
    japaneseTitle: a.title_japanese || null,
    year: a.year || (a.aired?.from ? a.aired.from.split('-')[0] : 'N/A'),
    posterUrl: a.images?.webp?.image_url || a.images?.jpg?.image_url || a.images?.webp?.large_image_url || null,
    backdropUrl: a.images?.webp?.large_image_url || a.images?.jpg?.large_image_url || null,
    rating: a.score ? parseFloat(a.score.toFixed(1)) : null,
    episodes: a.episodes || null,
    status: a.status || 'Finished',
    description: a.synopsis || '',
    genres: (a.genres || []).map((g) => g.name),
  };
}

function formatKitsuAnime(k, categories) {
  const attr = k.attributes || {};
  return {
    id: k.id,
    type: 'anime',
    title: attr.canonicalTitle || attr.en_jp || attr.en || 'Unknown Anime',
    aliases: [...new Set([...Object.values(attr.titles || {}), ...(attr.abbreviatedTitles || [])].filter(Boolean))].slice(0, 4),
    format: /^tv$/i.test(attr.showType) ? 'TV' : attr.showType
      ? attr.showType[0].toUpperCase() + attr.showType.slice(1) : null,
    releaseDate: attr.startDate || null,
    japaneseTitle: attr.ja_jp || null,
    year: attr.startDate ? attr.startDate.split('-')[0] : 'N/A',
    posterUrl: attr.posterImage?.large || attr.posterImage?.medium || null,
    backdropUrl: attr.coverImage?.large || attr.posterImage?.large || null,
    rating: attr.averageRating ? parseFloat((parseFloat(attr.averageRating) / 10).toFixed(1)) : null,
    episodes: attr.episodeCount || null,
    status: attr.status || 'finished',
    description: attr.synopsis || '',
    genres: (k.relationships?.categories?.data || []).map(genre => categories.get(genre.id)).filter(Boolean),
  };
}

function formatKitsuCollection(data) {
  const categories = new Map((data.included || []).filter(item => item.type === 'categories')
    .map(item => [item.id, item.attributes.title]));
  return (data.data || []).map(item => formatKitsuAnime(item, categories));
}

async function kitsuCatalog(params = {}) {
  const { data } = await axios.get(`${KITSU_BASE}/anime`, {
    params: { 'page[limit]': 20, include: 'categories', ...params }, timeout: 7000,
  });
  return formatKitsuCollection(data);
}

async function discoverAnime() {
  const [trending, airing, latest, popular, films] = await Promise.allSettled([
    axios.get(`${KITSU_BASE}/trending/anime`, { timeout: 7000 }).then(({ data }) => formatKitsuCollection(data)),
    kitsuCatalog({ sort: '-userCount', 'filter[status]': 'current' }),
    kitsuCatalog({ sort: '-startDate', 'filter[status]': 'current' }),
    kitsuCatalog({ sort: '-userCount' }),
    kitsuCatalog({ sort: '-userCount', 'filter[subtype]': 'movie' }),
  ]);
  const items = result => result.status === 'fulfilled' ? result.value : [];
  const sections = [
    { title: 'Trending', items: items(trending) },
    { title: 'New releases', items: items(latest) },
    { title: 'Top airing', items: items(airing) },
    { title: 'Popular anime', items: items(popular) },
    { title: 'Completed', items: items(popular).filter(a => a.status === 'finished') },
    { title: 'Anime movies', items: items(films) },
  ].filter(section => section.items.length);
  if (!sections.length) throw new Error('Anime catalog unavailable.');
  return sections;
}

async function animeGenres() {
  const limit = 20;
  const page = offset => axios.get(`${KITSU_BASE}/categories`, {
    params: { 'page[limit]': limit, 'page[offset]': offset, sort: 'title' }, timeout: 7000,
  }).then(({ data }) => data);
  const first = await page(0);
  const remaining = await Promise.all(Array.from({ length: Math.ceil(first.meta.count / limit) - 1 },
    (_, index) => page((index + 1) * limit)));
  return [first, ...remaining].flatMap(result => result.data).map(genre => ({
    id: genre.attributes.slug, name: genre.attributes.title,
  }));
}

async function browseAnimeGenre(id) {
  return kitsuCatalog({ 'filter[categories]': id, sort: '-userCount' });
}

module.exports = { searchAnime, getAnimeDetails, discoverAnime, animeGenres, browseAnimeGenre };
