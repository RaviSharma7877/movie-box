const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
let server, base;
before(async () => {
  process.env.INTERNAL_API_KEY = 'test-only-key';
  process.env.MEDIA_CATALOG_JSON = JSON.stringify({ fixture: { sources: [{ url: 'https://example.com/video.mp4', quality: '720p' }] } });
  const app = require('../api/playback');
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}/api/playback`;
});
after(() => new Promise(resolve => server.close(resolve)));
async function post(body, authorized = true) {
  return fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { 'X-API-KEY': 'test-only-key' } : {}) }, body: JSON.stringify(body) });
}
test('playback keeps the existing shared key requirement', async () => {
  assert.equal((await post({ id: 'fixture', title: 'Fixture' }, false)).status, 401);
});
test('playback rejects invalid episode values', async () => {
  assert.equal((await post({ id: 'fixture', title: 'Fixture', episode: -1 })).status, 400);
});
test('playback returns direct sources and prevents caching expired media URLs', async () => {
  const response = await post({ id: 'fixture', title: 'Fixture', type: 'movie', episode: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.sources[0].uri, 'https://example.com/video.mp4');
  assert.equal(body.sources[0].downloadable, true);
});
