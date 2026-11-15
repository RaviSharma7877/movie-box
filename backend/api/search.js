/**
 * POST /api/search
 *
 * Body: { "query": "Inception" }
 * Headers: X-API-KEY: <secret>
 *
 * Returns enriched movie results from TMDB + available qualities/audio from flix-cli.
 */
const express = require('express');
const auth = require('../middleware/auth');
const corsMiddleware = require('../middleware/cors');
const { searchMovies } = require('../lib/movieMetadata');
const { sanitiseInput } = require('../utils/sanitise');

const app = express();
app.use(corsMiddleware);
app.use(express.json());
app.use(auth);

async function handleSearch(req, res) {
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
    const results = await searchMovies(clean);
    return res.json({ results });
  } catch (err) {
    console.error('[/api/search] Error:', err.message);
    return res.status(500).json({ error: 'Search failed. Please try again.' });
  }
}

app.all(['/', '/api/search'], handleSearch);

module.exports = app;
