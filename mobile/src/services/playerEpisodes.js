export function episodeLabel(request) {
  if (!request?.episode) return "";
  if (request.type === "series") return `Season ${request.season || 1} · Episode ${request.episode}`;
  if (request.type === "anime") return `Episode ${request.episode}`;
  return "";
}

export function nextEpisode(request, episodeList, episodeCount) {
  if (!episodeLabel(request)) return null;
  const season = Number(request.season || 1);
  const episode = Number(request.episode);
  if (episodeList?.length) {
    const sorted = [...episodeList].sort((a, b) => a.season - b.season || a.number - b.number);
    const current = sorted.findIndex(item => item.season === season && item.number === episode);
    const next = current >= 0 ? sorted[current + 1] : null;
    return next ? { ...request, season: next.season, episode: next.number } : null;
  }
  if (request.type !== "anime" || !episodeCount || episode >= episodeCount) return null;
  return { ...request, season, episode: episode + 1 };
}

export function savedNextEpisodes(queue, request) {
  if (!episodeLabel(request)) return [];
  return queue.filter(item =>
    item.status === "done" && !item.galleryPending && (item.uri || item.destUri) &&
    item.type === request.type && String(item.movieId) === String(request.id) &&
    Number(item.season || 1) === Number(request.season || 1) &&
    Number(item.episode) === Number(request.episode) + 1
  ).sort((a, b) => Number(b.audio === request.audio) - Number(a.audio === request.audio));
}

export function canShowNextEpisode(duration, time) {
  return Number.isFinite(duration) && Number.isFinite(time) && duration > 0 &&
    time >= 0 && time <= duration && duration - time <= 5 * 60;
}
