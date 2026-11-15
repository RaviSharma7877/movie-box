const express = require('express');
const auth = require('../middleware/auth');
const cors = require('../middleware/cors');
const { resolveMedia } = require('../lib/mediaSources');
const app = express();
app.use(cors, express.json(), auth);
app.post(['/', '/api/playback'], async (req, res) => {
  const { id, tmdbId, title, aliases, type = 'movie', season = 1, episode = 1, audio = 'Sub' } = req.body || {};
  if (!['string', 'number'].includes(typeof id) || !id || String(id).length > 150 || typeof title !== 'string' || !title.trim() || title.length > 200 ||
      !['movie', 'series', 'anime'].includes(type) ||
      !Number.isInteger(Number(season)) || Number(season) < 1 ||
      !Number.isInteger(Number(episode)) || Number(episode) < 1) {
    return res.status(400).json({ error: 'A title, media type, and valid season and episode are required.' });
  }
  let timer;
  try {
    const result = await Promise.race([
      resolveMedia({ id, tmdbId, title: title.trim(),
        aliases: Array.isArray(aliases) ? aliases.filter(a => typeof a === 'string' && a.trim() && a.length <= 200).slice(0, 4) : [],
        type, season, episode, audio }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Provider timeout')), 25000); }),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(result);
  } catch (err) {
    console.warn('[playback]', err.message);
    const error = err.code === 'SOURCE_BLOCKED'
      ? 'The video server for this title is busy and refusing connections. Try again in a few minutes.'
      : err.message === 'Provider timeout'
        ? 'Finding a video took too long. Try again.'
        : /episode|dub|sub audio|matching|not available/i.test(err.message)
          ? err.message
          : 'No playable source is available for this title right now. Try again later.';
    return res.status(err.code === 'SOURCE_UNAVAILABLE' ? 404 : 502).json({ error });
  } finally { clearTimeout(timer); }
});
module.exports = app;
