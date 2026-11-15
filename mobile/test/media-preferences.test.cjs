const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transformFileSync } = require("@babel/core");
const { runInNewContext } = require("node:vm");
const { join } = require("node:path");

test("title defaults persist across episodes and keep Play and Download choices separate", async () => {
  const { code } = transformFileSync(join(__dirname, "../src/services/mediaPreferences.js"), {
    configFile: false,
    babelrc: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const stored = new Map();
  const preferences = {};
  runInNewContext(code, {
    exports: preferences,
    require: () => ({
      getItem: async key => stored.get(key),
      setItem: async (key, value) => stored.set(key, value),
    }),
  });
  const first = { type: "anime", id: 12566, season: 1, episode: 1 };
  const next = { ...first, id: "12566", episode: 2 };
  preferences.saveMediaPreferences(first, "play", { audio: "Dub" });
  preferences.saveMediaPreferences(first, "play", { quality: "720p" });
  preferences.saveMediaPreferences(first, "download", { audio: "Sub", quality: "1080p" });
  const play = await preferences.readMediaPreferences(next, "play");
  const download = await preferences.readMediaPreferences(next, "download");
  assert.equal(play.audio, "Dub");
  assert.equal(play.quality, "720p");
  assert.equal(download.audio, "Sub");
  assert.equal(download.quality, "1080p");
  assert.equal((await preferences.readMediaPreferences({ ...next, id: "2" }, "play")).quality, undefined);
});
