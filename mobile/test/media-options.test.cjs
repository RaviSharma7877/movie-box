const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transformFileSync } = require("@babel/core");
const { runInNewContext } = require("node:vm");
const { join } = require("node:path");

const { code } = transformFileSync(join(__dirname, "../src/services/mediaOptions.js"), {
  configFile: false,
  babelrc: false,
  plugins: ["@babel/plugin-transform-modules-commonjs"],
});
const options = {};
runInNewContext(code, {
  exports: options,
  require: module => module === "react-native" ? { NativeModules: {} } : {
    parseMaster: () => [{ label: "1080p", height: 1080 }, { label: "480p", height: 480 }],
  },
  fetch: async () => ({ ok: true, text: async () => "test manifest" }),
});

test("quality selection uses provider files and advertised stream resolutions", async () => {
  const sources = [
    { type: "mp4", quality: "720p", downloadable: true },
    { type: "m3u8", quality: "Auto", uri: "https://example.com/master.m3u8" },
    { type: "mpd", quality: "2160p" },
  ];
  const download = await options.getQualityOptions(sources, "download");
  assert.deepEqual(Array.from(download, item => item.label), ["Auto", "1080p", "720p", "480p"]);
  assert.equal(download[1].source, sources[1]);
  assert.equal(options.orderPlaybackSources(sources, "1080p")[0], sources[1]);
  assert.equal(options.orderPlaybackSources(sources, "2160p")[0], sources[2]);
});

test("the player's native language is matched to the selected language code", () => {
  const tracks = [{ language: "en" }, { language: "hi" }];
  assert.equal(options.selectedAudioLanguage("hin", tracks), "hi");
  assert.equal(options.selectedAudioLanguage("ja", tracks), null);
});
