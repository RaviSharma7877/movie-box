const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transformFileSync } = require("@babel/core");
const { runInNewContext } = require("node:vm");
const { join } = require("node:path");

test("the next episode uses the show's saved subtitle track even when track order changes", async () => {
  const file = join(__dirname, "../src/services/subtitlePreferences.js");
  const { code } = transformFileSync(file, {
    configFile: false,
    babelrc: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const storage = new Map();
  const preferences = {};
  runInNewContext(code, {
    exports: preferences,
    require: () => ({
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => storage.set(key, value),
    }),
  });
  const { subtitlePreferenceKey, saveSubtitlePreference, readSubtitlePreference, preferredSubtitleIndex } = preferences;
  const first = subtitlePreferenceKey({ type: "series", id: "tt123", season: 1, episode: 1 });
  const next = subtitlePreferenceKey({ type: "series", id: "tt123", season: 1, episode: 2 });
  const differentShow = subtitlePreferenceKey({ type: "series", id: "tt124", season: 1, episode: 1 });
  const english = { title: "English", language: "en" };
  const spanish = { title: "Spanish", language: "es" };

  saveSubtitlePreference(first, english);
  const preference = await readSubtitlePreference(next);
  assert.equal(preferredSubtitleIndex([spanish, english], preference, false), 1);
  assert.equal(preferredSubtitleIndex([spanish], preference, true), -1);
  assert.equal(await readSubtitlePreference(differentShow), null);

  saveSubtitlePreference(next, spanish);
  saveSubtitlePreference(next, null);
  assert.equal(preferredSubtitleIndex([english, spanish], await readSubtitlePreference(first), true), -1);
});
