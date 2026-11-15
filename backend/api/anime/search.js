/**
 * POST /api/anime/search
 * Body: { "query": "Naruto" }
 * Headers: X-API-KEY: <secret>
 */
const express = require('express');
const auth = require('../../middleware/auth');
const corsMiddleware = require('../../middleware/cors');
const { searchAnime } = require('../../lib/animeMetadata');
const { sanitiseInput } = require('../../utils/sanitise');

const app = express();
app.use(corsMiddleware);
app.use(express.json());
app.use(auth);

async function handleAnimeSearch(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const { query = 'trending' } = req.body || {};
  let clean = 'trending';
  if (query && typeof query === 'string' && query.trim().length > 0) {
    try {
      clean = sanitiseInput(query);
    } catch {
      clean = 'trending';
    }
  }

  try {
    const results = await searchAnime(clean);
    return res.json({ results });
  } catch (err) {
    console.error('[/api/anime/search] Error:', err.message);
    return res.status(500).json({ error: 'Anime search failed.' });
  }
}

app.all(['/', '/api/anime/search'], handleAnimeSearch);

module.exports = app;

