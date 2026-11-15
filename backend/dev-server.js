/**
 * Local development server — mirrors Vercel routing.
 * Run: npm run dev
 */
const express = require('express');
const app = express();

app.use('/api/search', require('./api/search'));
app.use('/api/anime/search', require('./api/anime/search'));
app.use('/api/anime/episodes', require('./api/anime/episodes'));
app.use('/api/playback', require('./api/playback'));
app.use('/api/details', require('./api/details'));
app.use('/api/discover', require('./api/discover'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MovieBox backend running on http://localhost:${PORT}`));
