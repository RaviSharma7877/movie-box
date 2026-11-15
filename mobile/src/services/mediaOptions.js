import { NativeModules } from "react-native";
import { parseMaster } from "./downloadManager";

export const qualityHeight = label => Number(/^(\d+)p$/i.exec(label || "")?.[1]) || 0;

export function orderPlaybackSources(sources, quality) {
  if (!quality || quality === "Auto") return sources;
  const preferred = sources.find(source => source.quality === quality)
    || sources.find(source => source.type === "m3u8" || source.type === "mpd");
  return preferred ? [preferred, ...sources.filter(source => source !== preferred)] : sources;
}

export async function getQualityOptions(sources, mode, signal) {
  const available = mode === "download" ? sources.filter(source =>
    source.type === "m3u8" || (source.type === "mp4" && source.downloadable)) : sources;
  if (!available.length) return [];
  const choices = new Map();
  for (const source of available) {
    if (source.quality && source.quality !== "Auto" && !choices.has(source.quality)) {
      choices.set(source.quality, { label: source.quality, source });
    }
  }
  const adaptive = available.find(source => source.type === "m3u8");
  if (adaptive) {
    try {
      const response = await fetch(adaptive.uri, { headers: adaptive.headers || {}, signal });
      if (response.ok) for (const variant of parseMaster(await response.text(), adaptive.uri)) {
        if (variant.height && !choices.has(variant.label)) choices.set(variant.label, { label: variant.label, source: adaptive });
      }
    } catch {
      // The adaptive source is still an Auto option when the manifest cannot be inspected.
    }
  }
  return [{ label: "Auto", source: available[0] }, ...[...choices.values()].sort((a, b) => qualityHeight(b.label) - qualityHeight(a.label))];
}

const audioReads = new Map();
export function readAudioLanguages(source) {
  const bridge = NativeModules.MovieBoxPlaybackControls;
  if (source?.type !== "mp4" || !bridge?.readAudioLanguages) return Promise.resolve([]);
  const key = source.uri;
  if (audioReads.has(key)) return audioReads.get(key);
  let timer;
  const pending = Promise.race([
    Promise.resolve().then(() => bridge.readAudioLanguages(key, source.headers || {})),
    new Promise(resolve => { timer = setTimeout(() => resolve([]), 5000); }),
  ]).catch(() => []).finally(() => clearTimeout(timer));
  if (audioReads.size >= 24) audioReads.delete(audioReads.keys().next().value);
  audioReads.set(key, pending);
  pending.then(languages => {
    if (!languages.length && audioReads.get(key) === pending) audioReads.delete(key);
  });
  return pending;
}

export function selectedAudioLanguage(preference, tracks) {
  if (!preference) return null;
  const language = String(preference).toLowerCase().split(/[-_]/)[0];
  const aliases = { en: "eng", hi: "hin", ja: "jpn", ko: "kor", es: "spa", fr: "fra", de: "deu", it: "ita", pt: "por", ta: "tam", te: "tel", ml: "mal", zh: "zho", ar: "ara", ru: "rus", bn: "ben" };
  const canonical = code => aliases[code] || code;
  return tracks.find(track => canonical(String(track.language || "").toLowerCase().split(/[-_]/)[0]) === canonical(language))?.language || null;
}
