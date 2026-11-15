const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transformFileSync } = require("@babel/core");
const { runInNewContext } = require("node:vm");
const { join } = require("node:path");

test("the episode picker preserves legacy progress and marks finished episodes as last played", async () => {
  const file = join(__dirname, "../src/services/history.js");
  const { code } = transformFileSync(file, {
    configFile: false,
    babelrc: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const storage = new Map([['watch:["anime",12566,1,1]', "86"]]);
  const helpers = {};
  const episodeCode = transformFileSync(join(__dirname, "../src/services/playerEpisodes.js"), {
    configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
  }).code;
  runInNewContext(episodeCode, { exports: helpers });
  const exports = {};
  runInNewContext(code, {
    exports,
    require: name => name === "./playerEpisodes" ? helpers : ({
      getItem: async key => storage.get(key),
      setItem: async (key, value) => storage.set(key, value),
      multiGet: async keys => keys.map(key => [key, storage.get(key)]),
    }),
  });
  const id = "12566";
  const list = [1, 2, 3].map(number => ({ season: 1, number }));
  const episode = number => ({ type: "anime", id, season: 1, episode: number });
  const progress = { key: "show:anime:" + id, title: "One Punch Man 2", episodeCount: list.length, episodeList: list, duration: 1200 };
  await exports.recordProgress({ ...progress, request: episode(2), position: 330 });
  let history = await exports.getEpisodeHistory("anime", id, list);
  assert.equal(history.episodes["1:1"].position, 86);
  assert.equal(history.episodes["1:2"].watched, false);
  assert.equal(history.last.number, 2);
  assert.equal((await exports.getContinueWatching()).length, 1);

  await exports.recordProgress({ ...progress, request: episode(2), position: 1200, ended: true });
  const [upNext] = await exports.getContinueWatching();
  assert.equal(upNext.upNext, true);
  assert.equal(upNext.request.episode, 3);

  await exports.recordProgress({ ...progress, request: episode(3), position: 1200, ended: true });
  history = await exports.getEpisodeHistory("anime", id, list);
  assert.equal(history.episodes["1:3"].watched, true);
  assert.equal(history.episodes["1:2"].position, 1200);
  assert.equal(history.episodes["1:2"].watched, true);
  assert.equal(history.last.number, 3);
  assert.equal(exports.episodeHistoryStatus(history, list[2]), "lastPlayed");
  assert.equal((await exports.getContinueWatching()).length, 0);

  await exports.recordProgress({ ...progress, request: episode(2), position: 350 });
  history = await exports.getEpisodeHistory("anime", id, list);
  assert.equal(exports.episodeHistoryStatus(history, list[2]), "watched");
  assert.equal(exports.episodeHistoryStatus(history, list[1]), "lastPlayed");
});
