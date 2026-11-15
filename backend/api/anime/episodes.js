const express = require('express');
const auth = require('../../middleware/auth');
const cors = require('../../middleware/cors');
const { getAnimeEpisodes } = require('../../lib/directAnimeSource');

const app = express();
app.use(cors, express.json(), auth);
app.post(['/', '/api/anime/episodes'], async (req, res) => {
  const { id, title, aliases } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return res.status(400).json({ error: 'A valid anime title is required.' });
  }
  try {
    const names = Array.isArray(aliases) ? aliases.filter(a => typeof a === 'string' && a.trim() && a.length <= 200).slice(0, 4) : [];
    return res.json({ episodeList: await getAnimeEpisodes({ id, title: title.trim(), aliases: names }) });
  } catch (error) {
    const missing = error.message === 'No matching anime title was found.';
    return res.status(missing ? 404 : 502).json({
      error: missing ? error.message : 'The episode list is temporarily unavailable.',
    });
  }
});

module.exports = app;
