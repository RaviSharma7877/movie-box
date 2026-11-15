/**
 * CORS middleware — allows only the configured ALLOWED_ORIGIN.
 * This means only YOUR mobile app's Vercel deployment can call these routes.
 */
const cors = require('cors');

module.exports = cors({
  origin: process.env.ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-KEY'],
});
