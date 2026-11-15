// Local-only device acceptance fixture. This server is never deployed to Vercel.
require('dotenv').config();
const express = require('express');
const auth = require('../middleware/auth');
const app = express();
const film = {
  id: 'sample-bbb', title: 'Big Buck Bunny', type: 'movie', category: 'movies', year: '2008',
  rating: 6.5, length: '10 minutes', genres: ['Animation', 'Short film'],
  description: 'A gentle giant takes on three mischievous woodland creatures. A Blender Foundation open movie, used here to verify native playback and offline downloads.',
  posterUrl: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg',
};
process.env.MEDIA_CATALOG_JSON = JSON.stringify({
  'sample-bbb': { sources: [{ url: 'https://storage.googleapis.com/exoplayer-test-media-0/BigBuckBunny_320x180.mp4', quality: '180p' }] },
});
app.use(express.json());
app.post('/api/search', auth, (req, res) => res.json({ results: !req.body.query || ['trending', 'popular'].includes(req.body.query) || film.title.toLowerCase().includes(req.body.query.toLowerCase()) ? [film] : [] }));
app.post('/api/anime/search', auth, (req, res) => res.json({ results: [] }));
app.use('/api/playback', require('../api/playback'));
app.use('/api/details', require('../api/details'));
app.listen(3100, '127.0.0.1', () => console.log('Device acceptance fixture on port 3100 (public sample film only).'));
