import AsyncStorage from "@react-native-async-storage/async-storage";

const pendingWrites = new Map();

export function subtitlePreferenceKey(request) {
  if (!request || !["series", "anime"].includes(request.type) || request.id == null) return null;
  return "moviebox:subtitles:" + JSON.stringify([request.type, String(request.id)]);
}

export async function readSubtitlePreference(key) {
  if (!key) return null;
  try {
    await pendingWrites.get(key);
    return JSON.parse(await AsyncStorage.getItem(key));
  } catch {
    return null;
  }
}

const trackTitle = track => String(track.title || "").trim().toLowerCase();
const trackLanguage = track => String(track.language || "").trim().toLowerCase()
  .replace(/_/g, "-").replace(/^(und|unknown)$/, "");

export function saveSubtitlePreference(key, track) {
  if (!key) return;
  const preference = track
    ? { enabled: true, title: trackTitle(track), language: trackLanguage(track) }
    : { enabled: false };
  const write = (pendingWrites.get(key) || Promise.resolve())
    .then(() => AsyncStorage.setItem(key, JSON.stringify(preference)))
    .catch(() => {});
  pendingWrites.set(key, write);
  write.then(() => {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  });
}

export function preferredSubtitleIndex(tracks = [], preference, defaultOn) {
  if (!tracks.length) return -1;
  if (!preference) return defaultOn ? 0 : -1;
  if (!preference.enabled) return -1;
  const { title, language } = preference;
  if (language) {
    const exact = tracks.findIndex(track => trackLanguage(track) === language && trackTitle(track) === title);
    if (exact >= 0) return exact;
    const sameLanguage = tracks.findIndex(track => trackLanguage(track) === language);
    if (sameLanguage >= 0) return sameLanguage;
  }
  if (title) return tracks.findIndex(track => trackTitle(track) === title && (!language || !trackLanguage(track)));
  return language ? -1 : 0;
}
