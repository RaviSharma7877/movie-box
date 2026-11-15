import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { resolvePlayback } from "./api";
import { backgroundAvailable, startDownloadService, downloadNotification } from "./backgroundDownloads";
import { galleryAvailable, publishVideo, removeSharedVideo, sharedVideoExists } from "./videoLibrary";
const DIR = FileSystem.documentDirectory + "moviebox_downloads/";
const KEY = "moviebox_download_queue_v2";
const HLS_WORKERS = 4;
const CONCURRENCY_KEY = 'moviebox_download_concurrency';
let concurrency = null;
export async function getDownloadConcurrency() {
  if (concurrency !== null) return concurrency;
  const saved = Number(await AsyncStorage.getItem(CONCURRENCY_KEY));
  concurrency = Number.isInteger(saved) && saved >= 1 && saved <= 5 ? saved : 1;
  return concurrency;
}
export async function setDownloadConcurrency(value) {
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('Choose between 1 and 5 simultaneous downloads.');
  await AsyncStorage.setItem(CONCURRENCY_KEY, String(value));
  concurrency = value;
}
export function availableDownloadSlots(items, activeIds, limit) {
  const cap = Math.min(5, Math.max(1, Math.floor(limit) || 1));
  return items.filter(e => ['queued', 'downloading'].includes(e.status) && !activeIds.has(e.id)).slice(0, Math.max(0, cap - activeIds.size));
}
const activeTasks = new Map(),
  listeners = new Set();
let queue = null,
  initializing = null,
  writeChain = Promise.resolve();
export async function ensureDownloadDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists)
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}
async function initialize() {
  if (queue) return;
  if (initializing) return initializing;
  initializing = (async () => {
    const raw = await AsyncStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) : [];
    queue = stored.map((e) =>
      e.status === "downloading"
        ? { ...e, status: "paused", interrupted: true }
        : e.status === "done" && !e.validated
          ? {
              ...e,
              status: "error",
              error:
                "This older download was not verified as video. Delete it and download again.",
            }
          : e,
    );
  })();
  try {
    await initializing;
  } finally {
    initializing = null;
  }
}
export async function getQueue() {
  await initialize();
  await writeChain;
  return queue.map((e) => ({ ...e }));
}
function mutate(change) {
  const next = writeChain.then(async () => {
    await initialize();
    const updated = change(queue);
    await AsyncStorage.setItem(KEY, JSON.stringify(updated));
    queue = updated;
    listeners.forEach((fn) => fn(queue.map((e) => ({ ...e }))));
    return queue;
  });
  writeChain = next.catch(() => {});
  return next;
}
export function subscribeToQueue(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function updateQueueEntry(id, patch) {
  return mutate((items) =>
    items.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  );
}

async function finishDownload(id, fields) {
  await updateQueueEntry(id, {
    ...fields,
    status: "done",
    progress: 1,
    validated: true,
    interrupted: false,
    error: null,
    completedAt: Date.now(),
    galleryPending: galleryAvailable,
    galleryError: null,
  });
  if (galleryAvailable) {
    const item = (await getQueue()).find(e => e.id === id && e.galleryPending);
    if (item) await publishDownload(item);
  }
}

async function publishDownload(entry) {
  let published;
  try {
    published = await publishVideo(entry);
    await updateQueueEntry(entry.id, {
      uri: published.uri,
      galleryUri: published.uri,
      galleryFilename: published.filename,
      galleryPending: false,
      galleryError: null,
    });
  } catch (error) {
    // Keep the original usable offline when Android cannot publish it.
    await updateQueueEntry(entry.id, { galleryPending: false, galleryError: error.message });
    return;
  }
  if (entry.destUri?.startsWith(DIR)) {
    await FileSystem.deleteAsync(entry.destUri, { idempotent: true }).catch(console.warn);
  }
}

export async function retryGalleryVideo(id) {
  if (!galleryAvailable) return;
  await mutate(items => items.map(e => e.id === id && e.status === "done" && !e.galleryUri
    ? { ...e, galleryPending: true, galleryError: null } : e));
  await startDownloadService({ requestNotifications: false });
}

export async function reconcileSharedDownloads(ids) {
  if (!galleryAvailable) return;
  const saved = (await getQueue()).filter(item => item.status === "done" &&
    item.galleryUri && !item.galleryPending && (!ids || ids.has(item.id)));
  const missing = new Map();
  await Promise.all(saved.map(async item => {
    try {
      if (await sharedVideoExists(item.galleryUri) === false) missing.set(item.id, item);
    } catch {
      // A temporarily inaccessible library is not evidence that a file was deleted.
    }
  }));
  if (!missing.size) return;
  await mutate(items => items.filter(item => {
    const checked = missing.get(item.id);
    return !checked || item.status !== "done" || item.galleryPending ||
      item.galleryUri !== checked.galleryUri || item.completedAt !== checked.completedAt;
  }));
}

export function downloadIdentity({
  id,
  type = "movie",
  season = 1,
  episode = 1,
  audio = "English",
  quality = "Auto",
}) {
  return [type, id, season, episode, audio, quality]
    .map((v) => encodeURIComponent(String(v)))
    .join("_");
}

// ─── HLS helpers ────────────────────────────────────────────────────────────
// Streams arrive as an HLS playlist of short segments. They are saved one by one next to a
// rewritten playlist that points at the local files, so the player can read them offline.
export function joinUrl(base, ref) {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (ref.startsWith("/")) return base.match(/^https?:\/\/[^/]+/i)[0] + ref;
  return base.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + ref;
}
export function parseMaster(text, base) {
  const lines = String(text).split(/\r?\n/);
  const variants = [];
  lines.forEach((line, i) => {
    if (!line.startsWith("#EXT-X-STREAM-INF")) return;
    const uri = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith("#"));
    if (!uri) return;
    const height = Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1]) || null;
    const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/)?.[1]) || 0;
    variants.push({ url: joinUrl(base, uri.trim()), height, bandwidth, label: height ? height + "p" : "Auto" });
  });
  return variants.sort((a, b) => (b.height || 0) - (a.height || 0) || b.bandwidth - a.bandwidth);
}
export function planMedia(text, base) {
  const files = [];
  let duration = 0;
  const playlist = String(text)
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#EXTINF:")) duration += parseFloat(trimmed.slice(8)) || 0;
      if (trimmed.startsWith("#")) {
        // Keys (EXT-X-KEY) and init segments (EXT-X-MAP) are referenced as URI="..."
        return line.replace(/URI="([^"]+)"/, (_, uri) => {
          const name = "f" + files.length + ".bin";
          files.push({ url: joinUrl(base, uri), name });
          return 'URI="' + name + '"';
        });
      }
      if (!trimmed) return line;
      const name = "s" + String(files.length).padStart(5, "0") + ".ts";
      files.push({ url: joinUrl(base, trimmed), name, segment: true });
      return name;
    })
    .join("\n");
  return { files, playlist, duration };
}
async function getText(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("The video server returned HTTP " + res.status + ".");
  return res.text();
}
const SEGMENT_TIMEOUT = 90000;
async function saveFile(url, dest, headers) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // A separate file per attempt, so a cancelled transfer can never be moved into place.
      const part = dest + ".part" + attempt;
      // FileSystem.downloadAsync can hang forever if the connection drops mid-file; a resumable
      // task rejects on errors and can be cancelled when it stalls.
      const task = FileSystem.createDownloadResumable(url, part, { headers });
      let timer;
      const result = await Promise.race([
        task.downloadAsync(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            task.pauseAsync().catch(() => {});
            reject(new Error("A video segment timed out."));
          }, SEGMENT_TIMEOUT);
        }),
      ]).finally(() => clearTimeout(timer));
      if (!result) throw new Error("A video segment was interrupted.");
      if (result.status !== 200 && result.status !== 206)
        throw new Error("The video server returned HTTP " + result.status + ".");
      const info = await FileSystem.getInfoAsync(part, { size: true });
      if (!info.exists || !(info.size > 0)) throw new Error("An empty file was received.");
      await FileSystem.moveAsync({ from: part, to: dest });
      return info.size;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
async function runHls(entry, state) {
  const id = entry.id;
  const dir = entry.destUri;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  let source = entry.source;
  if (entry.status !== "downloading" || entry.interrupted) {
    // Stream links expire, so a resumed download asks for a fresh one.
    const media = await resolvePlayback(
      { id: entry.movieId, tmdbId: entry.tmdbId, title: entry.title, aliases: entry.aliases, type: entry.type, season: entry.season, episode: entry.episode, audio: entry.audio },
      { fresh: true },
    );
    source = media.sources.find((s) => s.type === "m3u8");
    if (!source) throw new Error("This episode is no longer available to save.");
  }
  if (state.paused || state.deleted) return;
  const headers = source.headers || {};
  let base = source.uri;
  let text = await getText(base, headers);
  const variants = parseMaster(text, base);
  if (variants.length) {
    const match = variants.find(v => v.label === entry.quality);
    if (!match && entry.requireQuality) throw new Error(entry.quality + " is unavailable for this episode.");
    const chosen = match || variants[0];
    base = chosen.url;
    text = await getText(base, headers);
  } else if (entry.requireQuality && source.quality !== entry.quality) {
    throw new Error(entry.quality + " is unavailable for this episode.");
  }
  const plan = planMedia(text, base);
  const segments = plan.files.filter((f) => f.segment).length;
  if (!segments) throw new Error("The video server did not return any video segments.");
  let done = 0,
    bytes = 0,
    next = 0,
    checkedSpace = false,
    lastProgress = 0;
  const worker = async () => {
    try {
      await work();
    } catch (err) {
      // One failure stops every worker, so nothing keeps downloading after an error.
      state.failed = true;
      throw err;
    }
  };
  const work = async () => {
    while (next < plan.files.length && !state.paused && !state.deleted && !state.failed) {
      const file = plan.files[next++];
      const dest = dir + file.name;
      const existing = await FileSystem.getInfoAsync(dest, { size: true });
      const size = existing.exists && existing.size > 0 ? existing.size : await saveFile(file.url, dest, headers);
      bytes += size;
      done++;
      if (!checkedSpace && file.segment && done >= 3) {
        checkedSpace = true;
        const estimate = (bytes / done) * plan.files.length;
        const free = await FileSystem.getFreeDiskStorageAsync().catch(() => Infinity);
        if (free < (estimate - bytes) * 1.1)
          throw new Error("Not enough storage. This episode needs about " + Math.ceil(estimate / 1048576) + " MB free.");
      }
      if (Date.now() - lastProgress > 750) {
        lastProgress = Date.now();
        updateQueueEntry(id, { progress: Math.min(0.99, done / plan.files.length) }).catch(console.warn);
      }
    }
  };
  await Promise.all(Array.from({ length: HLS_WORKERS }, worker));
  if (state.paused || state.deleted) return;
  // A real MPEG-TS segment starts with the sync byte 0x47; one byte of it is "Rw==" in base64.
  // An HTML error page saved in its place starts with "<" instead.
  const firstSegment = plan.files.find((f) => f.segment);
  const head = await FileSystem.readAsStringAsync(dir + firstSegment.name, { encoding: "base64", position: 0, length: 1 });
  if (head !== "Rw==" && !firstSegment.url.match(/\.(mp4|m4s)(\?|$)/i))
    throw new Error("The server did not return a valid video file.");
  const playlistUri = dir + "index.m3u8";
  await FileSystem.writeAsStringAsync(playlistUri, plan.playlist);
  await finishDownload(id, {
    uri: playlistUri,
    fileSize: bytes,
    duration: plan.duration,
  });
}

export async function enqueueDownload(options) {
  await ensureDownloadDir();
  await initialize();
  const id = downloadIdentity(options);
  let existing = (await getQueue()).find((e) => e.id === id);
  if (existing?.galleryUri) {
    await reconcileSharedDownloads(new Set([id]));
    existing = (await getQueue()).find(e => e.id === id);
  }
  if (existing) {
    if (options.audioLanguage !== undefined) {
      await updateQueueEntry(id, { audioLanguage: options.audioLanguage, requireQuality: options.requireQuality });
    }
    if (existing.status === "paused" || existing.status === "error")
      await resumeDownload(id);
    return existing;
  }
  const hls = options.source?.type === "m3u8";
  if (!hls && (!options.source?.downloadable || options.source.type !== "mp4"))
    throw new Error(
      "This source is streaming-only and cannot be saved offline.",
    );
  const { subtitles, ...rest } = options;
  const entry = {
    ...rest,
    id,
    kind: hls ? "hls" : "mp4",
    movieId: options.id,
    status: "downloading",
    progress: 0,
    createdAt: Date.now(),
    filename: id + (hls ? "" : ".mp4"),
    destUri: DIR + id + (hls ? "/" : ".mp4"),
  };
  // Subtitles are kept in a file beside the video so they also work offline.
  if (subtitles?.length) {
    entry.subtitlesUri = DIR + id + ".subtitles.json";
    await FileSystem.writeAsStringAsync(entry.subtitlesUri, JSON.stringify(subtitles.slice(0, 2))).catch(() => {
      entry.subtitlesUri = null;
    });
  }
  await mutate((items) =>
    items.some((e) => e.id === id) ? items : [entry, ...items],
  );
  if (backgroundAvailable) {
    await updateQueueEntry(id, { status: 'queued' });
    try { await startDownloadService(); }
    catch (error) { await updateQueueEntry(id, { status: 'paused' }); throw error; }
    return entry;
  }
  if (!activeTasks.has(id)) runTask(entry).catch(console.warn);
  return entry;
}
async function runTask(original) {
  let entry = original;
  const id = entry.id;
  if (activeTasks.has(id)) return;
  const state = { task: null, paused: false, deleted: false, failed: false };
  activeTasks.set(id, state);
  try {
    if (!entry.source) {
      const media = await resolvePlayback({ id: entry.movieId, tmdbId: entry.tmdbId, title: entry.title, aliases: entry.aliases, type: entry.type, season: entry.season, episode: entry.episode, audio: entry.audio }, { fresh: true });
      if (state.paused || state.deleted) return;
      const downloadable = media.sources.filter(s => s.type === 'm3u8' || (s.type === 'mp4' && s.downloadable));
      const source = downloadable.find(s => s.quality === entry.quality) || downloadable.find(s => s.type === 'm3u8') ||
        (!entry.requireQuality ? downloadable[0] : null);
      if (!source && entry.requireQuality) throw new Error(entry.quality + " is unavailable for this episode.");
      if (!source) throw new Error('No downloadable source is available for this episode.');
      const kind = source.type === 'm3u8' ? 'hls' : 'mp4';
      const subtitlesUri = DIR + id + '.subtitles.json';
      await FileSystem.writeAsStringAsync(subtitlesUri, JSON.stringify(media.subtitles || []));
      entry = { ...entry, source, kind, status: 'downloading', subtitlesUri, destUri: DIR + id + (kind === 'hls' ? '/' : '.mp4') };
      await updateQueueEntry(id, entry);
    }
    if (entry.kind === "hls") {
      await runHls(entry, state);
      return;
    }
    let source = entry.source;
    if (entry.interrupted && entry.snapshot) {
      // The saved resume point is from the last pause, not from when the app was closed, so the
      // partial file no longer matches it. Start this file again rather than corrupt it.
      await FileSystem.deleteAsync(entry.destUri, { idempotent: true });
      entry = { ...entry, snapshot: null };
    }
    if (!entry.snapshot && entry.status !== "downloading") {
      const media = await resolvePlayback({
        id: entry.movieId,
        tmdbId: entry.tmdbId,
        title: entry.title,
        aliases: entry.aliases,
        type: entry.type,
        season: entry.season,
        episode: entry.episode,
        audio: entry.audio,
      }, { fresh: true });
      source =
        media.sources.find((s) => s.downloadable && s.type === "mp4" && s.quality === entry.quality) ||
        (!entry.requireQuality ? media.sources.find((s) => s.downloadable && s.type === "mp4") : null);
      if (!source && entry.requireQuality) throw new Error(entry.quality + " is unavailable for this video.");
      if (!source)
        throw new Error("A downloadable file is no longer available.");
    }
    if (state.paused || state.deleted) return;
    if (!source?.downloadable || source.type !== "mp4")
      throw new Error("A direct MP4 video is required.");
    let lastProgress = 0;
    const task = FileSystem.createDownloadResumable(
      entry.snapshot?.url || source.uri,
      entry.destUri,
      entry.snapshot?.options || { headers: source.headers || {} },
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        if (state.paused || state.deleted || Date.now() - lastProgress < 750)
          return;
        lastProgress = Date.now();
        if (totalBytesExpectedToWrite > 0)
          updateQueueEntry(id, {
            progress: Math.min(
              0.99,
              totalBytesWritten / totalBytesExpectedToWrite,
            ),
          }).catch(console.warn);
      },
      entry.snapshot?.resumeData,
    );
    state.task = task;
    const result = await (entry.snapshot
      ? task.resumeAsync()
      : task.downloadAsync());
    if (state.paused || state.deleted) return;
    if (!result?.uri) throw new Error("Download did not finish.");
    const contentType =
      Object.entries(result.headers || {}).find(
        ([k]) => k.toLowerCase() === "content-type",
      )?.[1] || "";
    const info = await FileSystem.getInfoAsync(result.uri, { size: true });
    if (
      result.status < 200 ||
      result.status >= 300 ||
      !/^(video\/mp4|application\/octet-stream)(;|$)/i.test(contentType) ||
      !info.exists ||
      !(info.size > 0)
    ) {
      await FileSystem.deleteAsync(entry.destUri, { idempotent: true });
      throw new Error(
        result.status === 429
          ? "The video server is busy and refused the download. Try again later."
          : "The server did not return a valid video file.",
      );
    }
    await finishDownload(id, {
      uri: result.uri,
      fileSize: info.size,
      snapshot: null,
    });
  } catch (err) {
    if (!state.paused && !state.deleted)
      await updateQueueEntry(id, {
        status: "error",
        error: err.message,
        snapshot: null,
      });
  } finally {
    if (activeTasks.get(id) === state) activeTasks.delete(id);
  }
}
export async function pauseDownload(id) {
  const state = activeTasks.get(id);
  if (state) {
    state.paused = true;
    try {
      const snapshot = state.task ? await state.task.pauseAsync() : null;
      await updateQueueEntry(id, { status: "paused", snapshot });
    } catch (err) {
      await updateQueueEntry(id, { status: "error", error: err.message });
    } finally {
      activeTasks.delete(id);
    }
  } else await updateQueueEntry(id, { status: "paused" });
}
export async function resumeDownload(id) {
  if (activeTasks.has(id)) return;
  const entry = (await getQueue()).find((e) => e.id === id);
  if (!entry || entry.status === "done") return;
  // The flag only means "was running when the app closed"; runTask still sees the original entry.
  await updateQueueEntry(id, { status: "downloading", error: null, interrupted: false });
  if (backgroundAvailable) {
    await updateQueueEntry(id, { status: 'queued' });
    try { await startDownloadService(); }
    catch (error) { await updateQueueEntry(id, { status: 'paused' }); throw error; }
    return;
  }
  runTask(entry).catch(console.warn);
}

// Persist every episode before starting, so a season queue survives closing the activity.
export async function enqueueSeason(request, episodeNumbers, quality = 'Auto') {
  await ensureDownloadDir();
  const numbers = [...new Set(episodeNumbers)].filter(n => Number.isInteger(n) && n > 0).sort((a,b) => a-b);
  if (!numbers.length) throw new Error('The episode list for this season is not available yet.');
  const entries = numbers.map(episode => {
    const id = downloadIdentity({ ...request, episode, quality });
    return { ...request, movieId: request.id, id, episode, quality, source: null, status: 'queued', progress: 0, createdAt: Date.now(), destUri: DIR + id };
  });
  await reconcileSharedDownloads(new Set(entries.map(entry => entry.id)));
  const selectedIds = new Set(entries.map(entry => entry.id));
  await mutate(items => [
    ...items.map(item => {
      if (!selectedIds.has(item.id)) return item;
      const preferences = request.audioLanguage === undefined ? {}
        : { audioLanguage: request.audioLanguage, requireQuality: request.requireQuality };
      return ['error', 'paused'].includes(item.status)
        ? { ...item, ...preferences, status: 'queued', error: null } : { ...item, ...preferences };
    }),
    ...entries.filter(e => !items.some(old => old.id === e.id)),
  ]);
  if (backgroundAvailable) {
    try { await startDownloadService(); }
    catch (error) {
      await mutate(items => items.map(item => entries.some(e => e.id === item.id) && item.status === 'queued' ? { ...item, status: 'paused' } : item));
      throw error;
    }
  }
  else backgroundDownloadTask().catch(console.warn);
  return numbers.length;
}

let backgroundLoop = null;
export function backgroundDownloadTask() {
  if (backgroundLoop) return backgroundLoop;
  backgroundLoop = (async () => {
    const unsubscribe = subscribeToQueue(items => {
      const current = items.find(e => e.status === 'downloading');
      if (current) downloadNotification(current.title + (current.type !== 'movie' ? ' · Episode ' + current.episode : ''), (current.progress || 0) * 100);
    });
    try {
    // Allow the activity's enqueue mutation to finish before inspecting the queue.
    await new Promise(resolve => setTimeout(resolve, 500));
    await initialize();
    for (const item of await getQueue()) {
      if (item.interrupted && item.status === 'paused') await updateQueueEntry(item.id, { status: 'queued', interrupted: false });
    }
    const seen = new Set();
    for (;;) {
      const items = await getQueue();
      const running = items.filter(e => e.status === 'downloading');
      const pending = items.filter(e => e.status === 'queued');
      const gallery = galleryAvailable ? items.filter(e => e.status === 'done' && e.galleryPending) : [];
      const current = running[0] || pending[0];
      [...running, ...pending, ...gallery].forEach(e => seen.add(e.id));
      if (!current && !gallery.length && !activeTasks.size) break;
      if (current) downloadNotification(current.title + (current.type !== 'movie' ? ' · Episode ' + current.episode : '') + ' · ' + (pending.length + running.length) + ' remaining', (current.progress || 0) * 100);
      else if (gallery.length) downloadNotification("Preparing videos for Gallery · " + gallery.length + " remaining", -1);
      const limit = await getDownloadConcurrency();
      const ready = availableDownloadSlots(items, new Set(activeTasks.keys()), limit);
      for (const entry of ready) {
        await updateQueueEntry(entry.id, { status: 'downloading', error: null });
        runTask(entry).catch(console.warn);
      }
      const exportSlots = Math.max(0, limit - activeTasks.size);
      for (const entry of gallery.filter(e => !activeTasks.has(e.id)).slice(0, exportSlots)) {
        const state = {};
        activeTasks.set(entry.id, state);
        publishDownload(entry).catch(console.warn).finally(() => {
          if (activeTasks.get(entry.id) === state) activeTasks.delete(entry.id);
        });
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const finalItems = await getQueue();
    const paused = finalItems.some(e => seen.has(e.id) && e.status === 'paused');
    const failures = finalItems.filter(e => seen.has(e.id) && (e.status === 'error' || e.galleryError)).length;
    downloadNotification(paused ? 'Downloads paused' : failures ? 'Downloads finished · ' + failures + ' need attention' : 'Downloads finished', 100, true);
    } finally { unsubscribe(); }
  })().finally(() => { backgroundLoop = null; });
  return backgroundLoop;
}
// Downloads that were running when the app closed continue when it opens again.
export async function resumeInterrupted() {
  const items = (await getQueue()).filter((e) => e.interrupted && e.status === "paused");
  for (const e of items) await resumeDownload(e.id);
}
export async function migrateSavedVideos() {
  if (!galleryAvailable) return;
  const needsGallery = e => e.status === "done" && e.validated && !e.galleryUri && !e.galleryError;
  if (!(await getQueue()).some(needsGallery)) return;
  await mutate(entries => entries.map(e => needsGallery(e) ? { ...e, galleryPending: true } : e));
  await startDownloadService({ requestNotifications: false });
}
export async function deleteDownload(id) {
  const entry = (await getQueue()).find((e) => e.id === id);
  if (entry?.galleryPending) throw new Error("Wait until MovieBox finishes preparing the video for Gallery.");
  const state = activeTasks.get(id);
  if (state) {
    state.deleted = true;
    state.paused = true;
    if (state.task)
      try {
        await state.task.pauseAsync();
      } catch {}
    activeTasks.delete(id);
  }
  if (entry?.galleryUri) await removeSharedVideo(entry.galleryUri);
  for (const uri of [entry?.destUri, entry?.subtitlesUri].filter(Boolean))
    await FileSystem.deleteAsync(uri, { idempotent: true });
  await mutate((items) => items.filter((e) => e.id !== id));
}
export async function listDownloads() {
  const items = (await getQueue()).filter((e) => e.status === "done");
  return Promise.all(
    items.map(async (e) => {
      if (e.galleryUri) return { ...e, exists: await sharedVideoExists(e.galleryUri), size: e.fileSize || 0 };
      const info = await FileSystem.getInfoAsync(e.uri || e.destUri, {
        size: true,
      });
      return { ...e, exists: info.exists, size: info.size || 0 };
    }),
  );
}
