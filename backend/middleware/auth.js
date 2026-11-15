/**
 * Auth middleware — validates X-API-KEY header or query param 'key'.
 * Every request to any /api/* route must carry this key.
 */
module.exports = function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid API key.' });
  }
  next();
};
