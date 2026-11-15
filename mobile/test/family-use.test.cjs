const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transformFileSync } = require("@babel/core");
const { runInNewContext } = require("node:vm");
const { join } = require("node:path");

function load(name, modules = {}) {
  const { code } = transformFileSync(join(__dirname, "../src/services", name + ".js"), {
    configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const exports = {};
  runInNewContext(code, { exports, require: name => modules[name] });
  return exports;
}

test("Continue Watching uses an existing saved copy of the exact episode and audio version", async () => {
  const { findSavedVideo } = load("savedPlayback", {
    "expo-file-system": { getInfoAsync: async uri => ({ exists: uri !== "file:///deleted" }) },
  });
  const request = { id: "12566", type: "anime", season: 1, episode: 2, audio: "Dub" };
  const entry = { movieId: 12566, type: "anime", season: 1, episode: 2, status: "done", audio: "Dub" };
  const saved = { ...entry, uri: "file:///saved" };
  assert.equal(await findSavedVideo([
    { ...entry, episode: 1, uri: "file:///previous" },
    { ...entry, audio: "Sub", uri: "file:///subbed" },
    { ...entry, uri: "file:///deleted" },
    saved,
  ], request), saved);
  assert.equal(await findSavedVideo([{ ...entry, galleryPending: true, uri: "file:///pending" }], request), null);
});

test("saved downloads group by show and season and count unique episodes separately from storage", () => {
  const { groupSavedDownloads } = load("savedDownloadGroups");
  const base = { movieId: "show", title: "Series", type: "series", fileSize: 100 };
  const rows = groupSavedDownloads([
    { ...base, season: 1, episode: 2 },
    { ...base, season: 1, episode: 1, galleryPending: true },
    { ...base, season: 1, episode: 2, audio: "Hindi" },
    { ...base, season: 2, episode: 1 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].ready, 1);
  assert.equal(rows[0].storage, 300);
  assert.equal(rows[0].episodes[0].episode, 1);
  assert.equal(rows[1].season, 2);
});

test("playback issues distinguish missing sources, rate limits, and missing dubbed audio", () => {
  const { playbackProblem, alternateAnimeAudio } = load("playbackErrors");
  assert.equal(playbackProblem({ status: 404 }).kind, "missing");
  assert.equal(playbackProblem({ message: "The video server is busy and refusing connections." }).kind, "busy");
  assert.equal(playbackProblem({ status: 502, message: "This episode is unavailable in dub audio." }).title, "Dub unavailable");
  assert.equal(alternateAnimeAudio({ type: "anime", audio: "Dub" }), "Sub");
  assert.equal(alternateAnimeAudio({ type: "movie" }), null);
});

test("subtitle appearance survives reopening and falls back for invalid stored values", async () => {
  let stored = JSON.stringify({ size: "invalid", background: "invalid" });
  const { readSubtitleAppearance, saveSubtitleAppearance } = load("subtitleAppearance", {
    "@react-native-async-storage/async-storage": {
      getItem: async () => stored,
      setItem: async (_, value) => { stored = value; },
    },
  });
  assert.equal((await readSubtitleAppearance()).size, "Medium");
  saveSubtitleAppearance({ size: "Large", background: "Solid" });
  const appearance = await readSubtitleAppearance();
  assert.equal(appearance.size, "Large");
  assert.equal(appearance.background, "Solid");
});
