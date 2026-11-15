/**
 * Open Movie & TV Series Metadata Helper (Zero API Key Required).
 *
 * Uses Cinemeta (open IMDb catalog for movies + TV series) & TVMaze to fetch
 * posters, backdrops, ratings, episode lists, and details.
 *
 * Completely eliminates TMDB dependency and Cloudflare IP blocks!
 */
const axios = require('axios');

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TVMAZE_BASE   = 'https://api.tvmaze.com';

/**
 * Search movies & TV series by query (or get top/trending if query is 'trending' or 'popular').
 * Searches both Movie and Series catalogs in parallel so shows like 'Alchemy of Souls' are always found!
 * @param {string} query
 * @returns {Promise<object[]>}
 */
async function searchMovies(query) {
  const isTrending = !query || query === 'trending' || query === 'popular';
  const encoded = encodeURIComponent(query || '');

  // 1. Search Cinemeta Movies and Series in parallel
  try {
    const movieUrl = isTrending
      ? `${CINEMETA_BASE}/catalog/movie/top.json`
      : `${CINEMETA_BASE}/catalog/movie/top/search=${encoded}.json`;
    const seriesUrl = isTrending
      ? `${CINEMETA_BASE}/catalog/series/top.json`
      : `${CINEMETA_BASE}/catalog/series/top/search=${encoded}.json`;

    const [seriesRes, movieRes] = await Promise.allSettled([
      axios.get(seriesUrl, { timeout: 8000 }),
      axios.get(movieUrl, { timeout: 8000 }),
    ]);

    const seriesItems = seriesRes.status === 'fulfilled' && seriesRes.value?.data?.metas ? seriesRes.value.data.metas : [];
    const movieItems = movieRes.status === 'fulfilled' && movieRes.value?.data?.metas ? movieRes.value.data.metas : [];

    const combined = [];
    for (let i = 0; i < Math.max(movieItems.length, seriesItems.length); i++) {
      if (movieItems[i]) combined.push(movieItems[i]);
      if (seriesItems[i]) combined.push(seriesItems[i]);
    }
    if (combined.length > 0) {
      const seen = new Set();
      const unique = [];
      for (const item of combined) {
        const id = item.id || item.imdb_id;
        const yearNum = parseInt(String(item.year || item.releaseInfo || '0').slice(0, 4), 10);
        // Exclude unreleased future productions that have no streamable episodes yet
        if (isTrending && yearNum > new Date().getFullYear()) continue;
        if (id && !seen.has(id)) {
          seen.add(id);
          unique.push(formatCinemetaMovie(item));
        }
      }
      return unique.slice(0, isTrending ? 50 : 36);
    }
  } catch (err) {
    console.warn('[movieMetadata] Cinemeta parallel search failed:', err.message);
  }

  // 2. Open fallback: TVMaze (especially great for series, K-Dramas & shows)
  try {
    const encoded = encodeURIComponent(query || 'action');
    const { data } = await axios.get(`${TVMAZE_BASE}/search/shows?q=${encoded}`, {
      timeout: 8000,
    });

    if (data?.length > 0) {
      return data.slice(0, 16).map(formatTvMaze);
    }
  } catch (err) {
    console.warn('[movieMetadata] TVMaze fallback failed:', err.message);
  }

  return [];
}

/**
 * Get detailed movie/series information by ID.
 * @param {string|number} id - IMDb ID (e.g. tt1375666) or search title
 * @returns {Promise<object>}
 */
async function getMovieDetails(id) {
  if (/^tv_\d+$/.test(id)) {
    const { data } = await axios.get(`${TVMAZE_BASE}/shows/${id.slice(3)}?embed=episodes`, { timeout: 8000 });
    return {
      ...formatTvMaze({ show: data }),
      episodeList: (data._embedded?.episodes || []).filter(e => Number(e.season) > 0 && Number(e.number) > 0)
        .map(e => ({ season: e.season, number: e.number, title: e.name, thumbnail: e.image?.medium || null })),
    };
  }
  const isImdb = String(id).startsWith('tt');

  if (isImdb) {
    // Try both series and movie endpoints in parallel
    try {
      const [seriesRes, movieRes] = await Promise.allSettled([
        axios.get(`${CINEMETA_BASE}/meta/series/${id}.json`, { timeout: 8000 }),
        axios.get(`${CINEMETA_BASE}/meta/movie/${id}.json`, { timeout: 8000 }),
      ]);

      const seriesMeta = seriesRes.status === 'fulfilled' && seriesRes.value?.data?.meta ? seriesRes.value.data.meta : null;
      const movieMeta = movieRes.status === 'fulfilled' && movieRes.value?.data?.meta ? movieRes.value.data.meta : null;

      const meta = seriesMeta || movieMeta;
      if (meta) {
        return formatCinemetaDetail(meta);
      }
    } catch (err) {
      console.warn('[movieMetadata] Cinemeta detail failed:', err.message);
    }
  }

  // Fallback: search by id/title
  const results = await searchMovies(String(id));
  if (results.length > 0) {
    return results[0];
  }

  throw new Error('Title details unavailable.');
}

function formatCinemetaMovie(m) {
  const isSeries = m.type === 'series';
  return {
    id: m.id || m.imdb_id,
    imdbId: m.imdb_id || m.id,
    tmdbId: m.moviedb_id || null,
    title: m.name,
    year: m.releaseInfo || m.year || 'N/A',
    posterUrl: m.poster || null,
    backdropUrl: m.background || m.poster || null,
    rating: m.imdbRating ? parseFloat(parseFloat(m.imdbRating).toFixed(1)) : null,
    description: m.description || '',
    genres: m.genres || [],
    length: m.runtime || (isSeries ? 'Series' : 'N/A'),
    type: m.type || 'movie',
    episodes: m.videos?.length || null,
  };
}

function formatCinemetaDetail(m) {
  const isSeries = m.type === 'series';
  return {
    id: m.id || m.imdb_id,
    imdbId: m.imdb_id || m.id,
    tmdbId: m.moviedb_id || null,
    title: m.name,
    year: m.year || m.releaseInfo || 'N/A',
    posterUrl: m.poster || null,
    backdropUrl: m.background || m.poster || null,
    rating: m.imdbRating ? parseFloat(parseFloat(m.imdbRating).toFixed(1)) : null,
    description: m.description || '',
    genres: m.genres || [],
    length: m.runtime || (isSeries ? 'Series' : 'N/A'),
    type: m.type || 'movie',
    episodes: m.videos?.length || null,
    cast: (m.cast || []).map((name) => ({ name, character: '', photo: null })),
    episodeList: (m.videos || []).filter(v => Number(v.season) > 0 && Number(v.episode) > 0 &&
      (!v.released || Date.parse(v.released) <= Date.now())).map(v => ({
      season: Number(v.season), number: Number(v.episode), title: v.title || `Episode ${v.episode}`, thumbnail: v.thumbnail || null,
    })),
  };
}

function formatTvMaze(item) {
  const show = item.show || {};
  return {
    id: show.externals?.imdb || `tv_${show.id}`,
    imdbId: show.externals?.imdb || null,
    title: show.name,
    year: show.premiered ? show.premiered.split('-')[0] : 'N/A',
    posterUrl: show.image?.original || show.image?.medium || null,
    backdropUrl: show.image?.original || null,
    rating: show.rating?.average ? parseFloat(show.rating.average.toFixed(1)) : null,
    description: show.summary ? show.summary.replace(/<[^>]*>/g, '') : '',
    genres: show.genres || [],
    length: show.averageRuntime ? `${show.averageRuntime} mins` : 'Series',
    type: 'series',
    episodes: null,
  };
}

async function movieGenres() {
  const { data } = await axios.get(`${CINEMETA_BASE}/manifest.json`, { timeout: 6000 });
  const genres = data.catalogs.filter(catalog => catalog.id === 'top').flatMap(catalog => catalog.genres || []);
  return [...new Set(genres)].map(name => ({ id: name, name }));
}

async function browseMovieGenre(genre) {
  const groups = await Promise.allSettled(['movie', 'series'].map(type =>
    axios.get(`${CINEMETA_BASE}/catalog/${type}/top/genre=${encodeURIComponent(genre)}.json`, { timeout: 6500 })));
  if (groups.every(group => group.status === 'rejected')) throw new Error('Genre unavailable.');
  return groups.flatMap(group => group.status === 'fulfilled'
    ? (group.value.data.metas || []).slice(0, 30).map(formatCinemetaMovie) : []);
}

module.exports = { searchMovies, getMovieDetails, movieGenres, browseMovieGenre };

