const { test } = require('node:test');
const assert = require('node:assert/strict');
const { directAnimeSource } = require('../lib/directAnimeSource');

function fixture({ audio = 'sub', title = 'Naruto' } = {}) {
  const config = Buffer.from(JSON.stringify({ src: 'https://cdn.example/video/master.m3u8', subtitles: [] }));
  const key = Buffer.from('otaku-embed-v1');
  for (let i = 0; i < config.length; i++) config[i] ^= key[i % key.length];
  const embed = Buffer.from('https://zokoanime.video/mal/20/1/sub').toString('base64');
  const responses = [
    `<h3 class="film-name"><a title="${title}" href="/naruto-1335">${title}</a></h3>`,
    { html: '<a data-number="1" data-id="22676" href="/watch/naruto-1335?ep=22676"></a>' },
    { html: `<div data-server-name="ZokoAnime" data-type="${audio}" data-hash="${embed}"></div>` },
    `window.__P="${config.toString('base64')}"`,
  ];
  const urls = [];
  return { urls, request: async url => {
    urls.push(url);
    const value = responses.shift();
    return { ok: true, text: async () => value, json: async () => value };
  } };
}
test('current anime API resolves episode and passes the required media referrer', async () => {
  const f = fixture();
  const result = await directAnimeSource({ title: 'Naruto', episode: 1 }, f.request);
  assert.equal(result.sources[0].url, 'https://cdn.example/video/master.m3u8');
  assert.equal(result.sources[0].headers.Referer, 'https://zokoanime.video/');
  assert.ok(f.urls[1].endsWith('/api/theme/episode/list/1335'));
  assert.ok(f.urls[2].endsWith('episodeId=22676'));
});
test('does not substitute a different anime with a similar title', async () => {
  const f = fixture({ title: 'Boruto: Naruto Next Generations' });
  await assert.rejects(directAnimeSource({ title: 'Naruto' }, f.request), /matching anime/);
  assert.equal(f.urls.length, 1);
});
test('missing dub fails explicitly instead of silently returning subtitled audio', async () => {
  const f = fixture();
  await assert.rejects(directAnimeSource({ title: 'Naruto', audio: 'Dub' }, f.request), /dub audio/);
});
test('romanisation differences still match the same anime', async () => {
  const f = fixture({ title: 'Naruto: Shippuden' });
  const result = await directAnimeSource({ title: 'Naruto: Shippuuden', episode: 1 }, f.request);
  assert.equal(result.sources[0].url, 'https://cdn.example/video/master.m3u8');
});
test('a numbered season matches the provider spelling without selecting specials or another season', async () => {
  const f = fixture({ title: 'One Punch Man 2nd Season' });
  const result = await directAnimeSource({ title: 'One Punch Man 2' }, async (url, options) => {
    const response = await f.request(url, options);
    if (!url.includes('/search?')) return response;
    return {
      ...response,
      text: async () => '<h3 class="film-name"><a title="One Punch Man 2nd Season Specials" href="/specials-2">Specials</a></h3>' +
        '<h3 class="film-name"><a title="One Punch Man Season 3" href="/wrong-3">Season 3</a></h3>' +
        await response.text(),
    };
  });
  assert.ok(f.urls[1].endsWith('/1335'));
  assert.equal(result.sources[0].url, 'https://cdn.example/video/master.m3u8');
});
test('a different provider title can match by verified anime ID while a similarly named wrong part is excluded', async () => {
  const f = fixture();
  const search = '<h3 class="film-name"><a href="/other-part-11">Similar Season Part 2</a></h3>' +
    '<h3 class="film-name"><a href="/correct-part-22">Alternate Name</a></h3>';
  const response = value => ({ ok: true, text: async () => value, json: async () => value });
  const token = (id) => Buffer.from(`https://zokoanime.video/stream/mal/${id}/1/sub`).toString('base64');
  const get = async url => {
    if (url.includes('/search?')) return response(search);
    if (url.endsWith('/11')) return response({ html: '<a data-number="1" data-id="11" href="/watch/other-part-11?ep=11"></a>' });
    if (url.endsWith('/22')) return response({ html: '<a data-number="1" data-id="22" href="/watch/correct-part-22?ep=22"></a>' });
    if (url.includes('/episode/servers?')) return response({
      html: `<div data-server-name="ZokoAnime" data-type="sub" data-hash="${token(url.endsWith('22') ? 20 : 21)}"></div>`,
    });
    assert.match(url, /\/mal\/20\//);
    for (let i = 0; i < 3; i++) await f.request('fixture');
    return f.request(url);
  };
  const result = await directAnimeSource({ id: 20, title: 'Similar Season' }, get);
  assert.equal(result.sources[0].url, 'https://cdn.example/video/master.m3u8');
});
