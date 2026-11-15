export function formatStorage(bytes) {
  const mb = bytes / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb.toFixed(1) + " MB";
}

export function groupSavedDownloads(saved) {
  const groups = new Map();
  const rows = [];
  for (const item of saved) {
    if (item.type !== "series" && item.type !== "anime") {
      rows.push(item);
      continue;
    }
    const season = Number(item.season || 1);
    const id = "group:" + JSON.stringify([item.type, item.movieId ?? item.title, season]);
    let group = groups.get(id);
    if (!group) {
      group = { id, group: true, title: item.title, posterUrl: item.posterUrl, season, episodes: [], storage: 0 };
      groups.set(id, group);
      rows.push(group);
    }
    group.episodes.push(item);
    group.storage += Number(item.fileSize) || 0;
  }
  for (const group of groups.values()) {
    group.episodes.sort((a, b) => Number(a.episode) - Number(b.episode));
    group.count = new Set(group.episodes.map(item => Number(item.episode))).size;
    group.ready = new Set(group.episodes.filter(item => !item.galleryPending).map(item => Number(item.episode))).size;
  }
  return rows;
}
