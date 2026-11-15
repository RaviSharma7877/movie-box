const express = require('express');
const auth = require('../middleware/auth');
const cors = require('../middleware/cors');
const { getMovieDetails } = require('../lib/movieMetadata');
const app = express();
app.use(cors, auth);
app.get(['/', '/api/details'], async (req, res) => {
  if (typeof req.query.id !== 'string' || !/^(tt|tv_)\d+$/.test(req.query.id)) return res.status(400).json({ error: 'A valid title ID is required.' });
  try { return res.json(await getMovieDetails(req.query.id)); }
  catch { return res.status(502).json({ error: 'Title details are temporarily unavailable.' }); }
});
module.exports = app;
