const express = require('express');
const auth = require('../middleware/auth');
const cors = require('../middleware/cors');
const { discoverAnime, animeGenres, browseAnimeGenre } = require('../lib/animeMetadata');
const { searchMovies, movieGenres, browseMovieGenre } = require('../lib/movieMetadata');

const app = express();
const cache = new Map();
const TTL = 5 * 60 * 1000;
app.use(cors, auth);

async function movieSections() {
  const items = await searchMovies('trending');
  if (!items.length) throw new Error('Movie catalog unavailable.');
  return [
    { title: 'Trending', items },
    { title: 'Popular movies', items: items.filter(m => m.type === 'movie') },
    { title: 'Series and web shows', items: items.filter(m => m.type === 'series') },
    { title: 'Dramas', items: items.filter(m => m.genres.includes('Drama')) },
  ].filter(section => section.items.length);
}

app.get(['/', '/api/discover'], async (req, res) => {
  const { mode, view, genre } = req.query;
  if (mode !== 'anime' && mode !== 'movies') return res.status(400).json({ error: 'Choose a catalog.' });
  if (view !== undefined && view !== 'genres') return res.status(400).json({ error: 'Unknown catalog view.' });
  if (genre !== undefined && (typeof genre !== 'string' || !(mode === 'anime' ? /^[a-z0-9-]{1,90}$/ : /^[\w &-]{1,60}$/).test(genre))) {
    return res.status(400).json({ error: 'Choose a valid genre.' });
  }
  const key = JSON.stringify([mode, view, genre]);
  let entry = cache.get(key);
  if (!entry || Date.now() >= entry.expires) {
    const anime = mode === 'anime';
    const load = genre ? async () => ({ items: await (anime ? browseAnimeGenre(genre) : browseMovieGenre(genre)) })
      : view === 'genres' ? async () => ({ genres: await (anime ? animeGenres() : movieGenres()) })
      : async () => ({ sections: await (anime ? discoverAnime() : movieSections()) });
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    entry = { expires: Date.now() + TTL, result: load() };
    cache.set(key, entry);
  }
  try {
    return res.json(await entry.result);
  } catch {
    if (cache.get(key) === entry) cache.delete(key);
    return res.status(502).json({ error: 'The catalog is temporarily unavailable. Try again.' });
  }
});

module.exports = app;
