const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");

// Load only the pure subtitle parser from api.js (the rest needs React Native).
const src = fs.readFileSync(__dirname + "/../src/services/api.js", "utf8");
const start = src.indexOf("const toSeconds");
const end = src.indexOf("return cues.sort", start);
const code = src.slice(start, src.indexOf("}\n", end) + 2).replace("export ", "");
const ctx = {};
vm.runInNewContext(code + "\nthis.parse = parseCues;", ctx);
// Objects from the vm realm have foreign prototypes; copy them so deepEqual compares values.
ctx.parseCues = (text) => JSON.parse(JSON.stringify(ctx.parse(text)));

test("WebVTT cues are parsed with styling tags removed", () => {
  const cues = ctx.parseCues(
    "WEBVTT\r\n\r\n00:00:04.810 --> 00:00:10.980 align:start\r\n<i>A demon fox</i>\r\n<i>with nine tails.</i>\r\n\r\n00:07:06.520 --> 00:07:07.780\r\nI'm a ninja &amp; proud!",
  );
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 4.81, end: 10.98, text: "A demon fox\nwith nine tails." });
  assert.equal(cues[1].start, 426.52);
  assert.equal(cues[1].text, "I'm a ninja & proud!");
});

test("SRT cues with hours and comma decimals are parsed", () => {
  const [cue] = ctx.parseCues("12\n01:02:03,500 --> 01:02:05,000\nLate line");
  assert.deepEqual(cue, { start: 3723.5, end: 3725, text: "Late line" });
});

test("non-subtitle text yields no cues", () => {
  assert.deepEqual(ctx.parseCues("<html>403 Forbidden</html>"), []);
});

test("ASS hard breaks display as new lines in streamed and previously saved cues", () => {
  const { formatSubtitleText } = require("../src/utils/subtitles.js");
  const line = String.raw`The purpose of this gathering\Nis to discuss.`;
  const expected = "The purpose of this gathering\nis to discuss.";
  const [streamed] = ctx.parseCues("00:00:01.000 --> 00:00:04.000\n" + line);
  const [saved] = JSON.parse(JSON.stringify([{ ...streamed, text: line }]));
  assert.equal(formatSubtitleText(streamed.text), expected);
  assert.equal(formatSubtitleText(saved.text), expected);
  assert.equal(formatSubtitleText("Existing\nline / No change"), "Existing\nline / No change");
});
