import AsyncStorage from "@react-native-async-storage/async-storage";
import { nextEpisode } from "./playerEpisodes";

// "Continue watching": the most recent titles with their position, newest first.
const KEY = "moviebox_continue_watching_v1";
const LIMIT = 20;
let chain = Promise.resolve();
const episodeKey = (season, number) => season + ":" + number;
const showKey = (type, id) => "moviebox:episodes:" + type + ":" + id;

export function episodeHistoryStatus(history, episode) {
  const last = history?.last;
  if (last && last.season === episode.season && last.number === episode.number) return "lastPlayed";
  if (history?.episodes?.[episodeKey(episode.season, episode.number)]?.watched) return "watched";
  return null;
}

async function read() {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) || "[]");
  } catch {
    return [];
  }
}
function write(change) {
  chain = chain
    .then(async () => AsyncStorage.setItem(KEY, JSON.stringify(change(await read()))))
    .catch(() => {});
  return chain;
}
// The last 5% counts as finished. Keep the show's card when another episode is known.
export function recordProgress({ key, title, request, episodeCount, episodeList, savedNext, position, duration, ended = false }) {
  if (!key || !request || !(duration > 0) || (!ended && !(position > 0))) return chain;
  const watched = ended || position / duration >= 0.95;
  if (request.type !== "movie") {
    const storageKey = showKey(request.type, request.id);
    const { season = 1, episode = 1 } = request;
    chain = chain.then(async () => {
      const history = JSON.parse(await AsyncStorage.getItem(storageKey) || "{}");
      const episodes = history.episodes || {};
      const at = episodeKey(season, episode);
      episodes[at] = { position, duration, watched: watched || !!episodes[at]?.watched };
      await AsyncStorage.setItem(storageKey, JSON.stringify({ episodes, last: { season, number: episode } }));
    }).catch(() => {});
  }
  const upcoming = watched ? nextEpisode(request, episodeList, episodeCount) || savedNext : null;
  if (watched && !upcoming) return removeProgress(key);
  const item = { key, title, request: upcoming || request, episodeCount,
    position: upcoming ? 0 : position, duration: upcoming ? 0 : duration,
    upNext: !!upcoming, updatedAt: Date.now() };
  return write((list) => [item, ...list.filter((e) => e.key !== key)].slice(0, LIMIT));
}

export async function getEpisodeHistory(type, id, episodeList) {
  await chain;
  const saved = JSON.parse(await AsyncStorage.getItem(showKey(type, id)) || "{}");
  const episodes = { ...saved.episodes };
  // The old player saved resume positions separately. Keep those visible for existing viewers.
  const legacyKeys = new Map();
  for (const { season, number } of episodeList) {
    if (episodes[episodeKey(season, number)]) continue;
    const ids = /^\d+$/.test(String(id)) ? [String(id), Number(id)] : [id];
    for (const oldId of ids) {
      legacyKeys.set("watch:" + JSON.stringify([type, oldId, season, number]), episodeKey(season, number));
    }
  }
  if (legacyKeys.size) {
    const entries = await AsyncStorage.multiGet([...legacyKeys.keys()]);
    for (const [key, value] of entries) {
      const position = Number(value);
      if (position > 0) episodes[legacyKeys.get(key)] = { position, watched: false };
    }
  }
  const previous = !saved.last && (await read()).find(entry =>
    entry.request?.type === type && String(entry.request.id) === String(id));
  const last = saved.last || (previous ? {
    season: previous.request.season || 1, number: previous.request.episode || 1,
  } : null);
  return { episodes, last };
}
export function removeProgress(key) {
  return write((list) => list.filter((e) => e.key !== key));
}
export async function getContinueWatching() {
  await chain;
  // Entries are kept per show ("show:…"); older per-episode entries are ignored.
  return (await read()).filter((e) => String(e.key).startsWith("show:"));
}
