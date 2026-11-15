const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transformFileSync } = require("@babel/core");
const { runInNewContext } = require("node:vm");
const { join } = require("node:path");

const { code } = transformFileSync(join(__dirname, "../src/services/playerEpisodes.js"), {
  configFile: false,
  babelrc: false,
  plugins: ["@babel/plugin-transform-modules-commonjs"],
});
const helpers = {};
runInNewContext(code, { exports: helpers });

test("Next episode appears at five minutes remaining and hides when seeking back", () => {
  assert.equal(helpers.canShowNextEpisode(1200, 899.99), false);
  assert.equal(helpers.canShowNextEpisode(1200, 900), true);
  assert.equal(helpers.canShowNextEpisode(1200, 1199), true);
  assert.equal(helpers.canShowNextEpisode(1200, 800), false);
  assert.equal(helpers.canShowNextEpisode(0, 0), false);
});

test("offline playback finds the immediately following saved episode", () => {
  const request = { type: "series", id: "tt123", season: 2, episode: 3, audio: "English" };
  const saved = { status: "done", movieId: "tt123", type: "series", season: 2, uri: "file:///video.mp4" };
  const result = helpers.savedNextEpisodes([
    { ...saved, episode: 5 },
    { ...saved, episode: 4, status: "queued" },
    { ...saved, episode: 4, season: 1 },
    { ...saved, episode: 4, audio: "French" },
    { ...saved, episode: 4, audio: "English" },
  ], request);
  assert.deepEqual(Array.from(result, item => item.audio), ["English", "French"]);
  assert.equal(helpers.episodeLabel(request), "Season 2 · Episode 3");
  assert.equal(helpers.episodeLabel({ type: "anime", episode: 3 }), "Episode 3");
});
