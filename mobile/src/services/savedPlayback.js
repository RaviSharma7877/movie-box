import * as FileSystem from "expo-file-system";
import { sharedVideoExists } from "./videoLibrary";

export async function savedVideoExists(item) {
  if (item.galleryUri) return sharedVideoExists(item.galleryUri);
  return (await FileSystem.getInfoAsync(item.uri || item.destUri)).exists;
}

export async function findSavedVideo(queue, request) {
  const candidates = queue.filter(item =>
    item.status === "done" && !item.galleryPending && (item.uri || item.destUri) &&
    item.type === request.type && String(item.movieId) === String(request.id) &&
    (request.type !== "anime" || !request.audio || item.audio === request.audio) &&
    (request.type === "movie" || (Number(item.season || 1) === Number(request.season || 1) &&
      Number(item.episode) === Number(request.episode)))
  ).sort((a, b) => Number(b.audio === request.audio) - Number(a.audio === request.audio));
  for (const item of candidates) {
    if (await savedVideoExists(item).catch(() => false)) return item;
  }
  return null;
}

export function savedPlaybackParams(item, request) {
  return {
    streamUrl: item.uri || item.destUri,
    subtitlesUri: item.subtitlesUri,
    mediaRequest: {
      ...request,
      audio: item.audio,
      audioLanguage: item.audioLanguage ?? request.audioLanguage,
    },
  };
}
