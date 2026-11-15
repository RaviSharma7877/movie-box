/**
 * API service — all calls to the MovieBox backend.
 * Includes timeout protection and instant offline defaults for low-bandwidth environments.
 */
import { sanitize } from "../utils/sanitize";

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  "https://moviebox-backend-orcin.vercel.app";
const API_KEY =
  process.env.EXPO_PUBLIC_API_KEY || "mbx_131fd09ec3a4baa10c1e6a61616f5237";

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-API-KEY": API_KEY,
};

// Mobile connections sometimes stall on the first request after idle; one quick retry hides that.
async function apiFetch(path, method = "GET", body, timeoutMs = 10000) {
  try {
    return await apiFetchOnce(path, method, body, timeoutMs);
  } catch (err) {
    if (!/too long|offline/.test(err.message)) throw err;
    return apiFetchOnce(path, method, body, timeoutMs);
  }
}

async function apiFetchOnce(path, method, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: AUTH_HEADERS,
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    clearTimeout(timer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw Object.assign(new Error(err.error || `HTTP ${res.status}`), { status: res.status });
    }

    return res.json();
  } catch (err) {
    clearTimeout(timer);
    throw friendly(err);
  }
}

function friendly(err) {
  if (err?.name === "AbortError" || /^abort/i.test(err?.message || ""))
    return new Error("The server took too long to respond. Check your connection and try again.");
  if (/network request failed/i.test(err?.message || ""))
    return new Error("You appear to be offline. Check your internet connection and try again.");
  return err;
}

const decorate = (item, category) => ({ ...item, category });

export async function searchCatalog(mode, query) {
  const clean = sanitize(query).trim();
  if (!clean) return [];
  const path = mode === "anime" ? "/api/anime/search" : "/api/search";
  const data = await apiFetch(path, "POST", { query: clean }, 22000);
  const target = clean.toLowerCase();
  const rank = (item) => {
    const title = String(item.title || "").toLowerCase();
    return title === target ? 0 : title.startsWith(target) ? 1 : 2;
  };
  return (data.results || []).map(item => decorate(item, mode)).sort((a, b) => rank(a) - rank(b));
}

const discovery = new Map();
export function discoverCatalog(mode, { fresh = false } = {}) {
  const cached = discovery.get(mode);
  if (!fresh && cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.promise;
  const promise = apiFetch("/api/discover?mode=" + mode, "GET", undefined, 25000)
    .then(data => data.sections.map(section => ({
      ...section, items: section.items.map(item => decorate(item, mode)),
    })));
  discovery.set(mode, { at: Date.now(), promise });
  promise.catch(() => { if (discovery.get(mode)?.promise === promise) discovery.delete(mode); });
  return promise;
}

export async function listGenres(mode) {
  const data = await apiFetch("/api/discover?view=genres&mode=" + mode);
  return data.genres;
}

export async function browseGenre(mode, genre) {
  const data = await apiFetch("/api/discover?mode=" + mode + "&genre=" + encodeURIComponent(genre));
  return data.items.map(item => decorate(item, mode));
}

// Sources are fetched once per title/episode and reused for a few minutes, so the
// detail screen can prefetch and Watch starts immediately.
const playbackCache = new Map();
const PLAYBACK_TTL = 3 * 60 * 1000;
const playbackKey = (r) => JSON.stringify([r.type, r.id, r.title, r.season, r.episode, r.audio]);

export function resolvePlayback(request, { fresh = false } = {}) {
  const key = playbackKey(request);
  const hit = playbackCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < PLAYBACK_TTL) return hit.promise;
  const promise = fetchPlayback(request);
  playbackCache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (playbackCache.get(key)?.promise === promise) playbackCache.delete(key);
  });
  return promise;
}

export function forgetPlayback(request) {
  if (request) playbackCache.delete(playbackKey(request));
}

export function prefetchPlayback(request) {
  resolvePlayback(request).catch(() => {});
}

// Android's player ignores sideloaded subtitle files for HLS/MP4, and some hosts need a Referer,
// so subtitles are fetched here and drawn by the player from these cues.
const toSeconds = (t) =>
  t.replace(",", ".").split(":").map(Number).reduce((total, part) => total * 60 + part, 0);
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&quot;": '"', "&#39;": "'" };
export function parseCues(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => line.includes("-->"));
    if (at < 0) continue;
    const [from, to] = lines[at].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const body = lines
      .slice(at + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e)
      .trim();
    if (body && from && to) cues.push({ start: toSeconds(from), end: toSeconds(to), text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

async function loadSubtitles(subtitles = []) {
  const picked = [...subtitles]
    .sort((a, b) => (b.language === "en") - (a.language === "en"))
    .slice(0, 6);
  const loaded = await Promise.all(
    picked.map(async (s) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(s.uri, { headers: s.headers || {}, signal: controller.signal });
        if (!res.ok) return null;
        const cues = parseCues(await res.text());
        return cues.length ? { title: s.title, language: s.language, cues } : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return loaded.filter(Boolean);
}

async function fetchPlayback(request) {
  const data = await apiFetch("/api/playback", "POST", request, 28000);
  const sources = (data.sources || []).filter(
    (s) =>
      s.uri &&
      /^https:\/\//i.test(s.uri) &&
      ["mp4", "m3u8", "mpd"].includes(s.type),
  );
  if (!sources.length)
    throw new Error("No playable video source is available for this title.");
  return { ...data, sources, subtitles: await loadSubtitles(data.subtitles) };
}
export function getDetails(id) {
  return apiFetch("/api/details?id=" + encodeURIComponent(id));
}

export function getAnimeEpisodes({ id, title, aliases }) {
  return apiFetch("/api/anime/episodes", "POST", { id, title, aliases }, 30000);
}
