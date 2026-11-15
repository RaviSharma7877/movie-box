const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
function harness({ mime = "video/mp4", hold = false } = {}) {
  const data = new Map(),
    tasks = [];
  const FileSystem = {
    documentDirectory: "file:///test/",
    getInfoAsync: async () => ({ exists: true, size: 100 }),
    deleteAsync: async () => {},
    createDownloadResumable: (url, dest, options, progress, resumeData) => {
      const task = {
        resumeData,
        downloadAsync: () =>
          hold
            ? new Promise(() => {})
            : Promise.resolve({
                uri: dest,
                status: 200,
                headers: { "Content-Type": mime },
              }),
        resumeAsync: async () => ({
          uri: dest,
          status: 200,
          headers: { "Content-Type": mime },
        }),
        pauseAsync: async () => ({
          url,
          fileUri: dest,
          options,
          resumeData: "saved-offset",
        }),
      };
      tasks.push(task);
      return task;
    },
  };
  const context = {
    galleryAvailable: false,
    backgroundAvailable: false, startDownloadService: async () => {}, downloadNotification: () => {},
    console,
    setTimeout,
    clearTimeout,
    FileSystem,
    AsyncStorage: {
      getItem: async (k) => data.get(k) || null,
      setItem: async (k, v) => data.set(k, v),
    },
    resolvePlayback: async () => ({
      sources: [
        {
          uri: "https://example.com/video.mp4",
          type: "mp4",
          downloadable: true,
        },
      ],
    }),
  };
  vm.createContext(context);
  vm.runInContext(
    fs
      .readFileSync(__dirname + "/../src/services/downloadManager.js", "utf8")
      .replace(/^import .*;$/gm, "")
      .replace(/export /g, ""),
    context,
  );
  return { context, tasks };
}
const options = {
  id: "one",
  title: "Example",
  type: "series",
  season: 1,
  episode: 1,
  audio: "English",
  quality: "720p",
  source: {
    uri: "https://example.com/video.mp4",
    type: "mp4",
    downloadable: true,
  },
};
const settle = () => new Promise((r) => setTimeout(r, 30));
test("HTML downloads are rejected instead of marked complete", async () => {
  const { context: c } = harness({ mime: "text/html" });
  await c.enqueueDownload(options);
  await settle();
  assert.equal((await c.getQueue())[0].status, "error");
});
test("a finished download uses the Gallery URI before removing its private file", async () => {
  const { context: c } = harness();
  const removed = [];
  const shared = "content://media/external_primary/video/media/42";
  c.galleryAvailable = true;
  c.publishVideo = async item => {
    assert.equal((await c.getQueue())[0].galleryPending, true);
    assert.match(item.uri, /^file:/);
    return { uri: shared, filename: "Example.mp4" };
  };
  c.FileSystem.deleteAsync = async uri => {
    assert.equal((await c.getQueue())[0].uri, shared);
    removed.push(uri);
  };
  await c.enqueueDownload(options);
  await settle();
  const [item] = await c.getQueue();
  assert.equal(item.galleryUri, shared);
  assert.equal(item.galleryPending, false);
  assert.deepEqual(removed, [item.destUri]);
});
test("existing downloads migrate without another transfer and preserve the original if export fails", async () => {
  const { context: c, tasks } = harness();
  await c.enqueueDownload(options);
  await settle();
  const [original] = await c.getQueue();
  c.galleryAvailable = true;
  c.publishVideo = async () => { throw new Error("No space available"); };
  const removed = [];
  c.FileSystem.deleteAsync = async uri => { removed.push(uri); };
  await c.migrateSavedVideos();
  await c.backgroundDownloadTask();
  const [item] = await c.getQueue();
  assert.equal(tasks.length, 1);
  assert.equal(item.status, "done");
  assert.equal(item.uri, original.uri);
  assert.equal(item.galleryError, "No space available");
  assert.deepEqual(removed, []);
});

test("external video deletion removes only confirmed missing saved files", async () => {
  const { context: c } = harness();
  for (const id of ["gone", "present", "unavailable"]) await c.enqueueDownload({ ...options, id });
  await settle();
  for (const entry of await c.getQueue()) {
    await c.updateQueueEntry(entry.id, { galleryUri: "content://media/" + entry.movieId });
  }
  c.galleryAvailable = true;
  c.sharedVideoExists = async uri => {
    if (uri.endsWith("unavailable")) throw new Error("MediaStore temporarily inaccessible");
    return uri.endsWith("present");
  };
  await c.reconcileSharedDownloads();
  const saved = Array.from(await c.getQueue(), entry => entry.movieId);
  assert.deepEqual(saved.sort(), ["present", "unavailable"]);
});
test("season and audio variants have separate files", async () => {
  const { context: c } = harness();
  await c.enqueueDownload(options);
  await c.enqueueDownload({ ...options, season: 2 });
  await c.enqueueDownload({ ...options, audio: "French" });
  await settle();
  const q = await c.getQueue();
  assert.equal(q.length, 3);
  assert.equal(new Set(q.map((e) => e.destUri)).size, 3);
});
test("pause persists the returned snapshot and resume reuses it", async () => {
  const { context: c, tasks } = harness({ hold: true });
  const entry = await c.enqueueDownload(options);
  await settle();
  await c.pauseDownload(entry.id);
  assert.equal((await c.getQueue())[0].snapshot.resumeData, "saved-offset");
  await c.resumeDownload(entry.id);
  await settle();
  assert.equal(tasks[1].resumeData, "saved-offset");
  assert.equal((await c.getQueue())[0].status, "done");
});
test("concurrent updates do not lose entries or progress", async () => {
  const { context: c } = harness({ hold: true });
  const a = await c.enqueueDownload(options),
    b = await c.enqueueDownload({ ...options, id: "two" });
  await Promise.all([
    c.updateQueueEntry(a.id, { progress: 0.4 }),
    c.updateQueueEntry(b.id, { progress: 0.6 }),
  ]);
  const q = await c.getQueue();
  assert.equal(q.find((e) => e.id === a.id).progress, 0.4);
  assert.equal(q.find((e) => e.id === b.id).progress, 0.6);
});

// ─── HLS (anime) downloads ────────────────────────────────────────────────
// "Rw==" is the base64 of the single byte 0x47 (MPEG-TS sync); "PA==" is "<" from an HTML page.
function hlsHarness({ segmentStatus = 200, firstBytes = "Rw==", free = 1e12 } = {}) {
  const files = new Map(), fetched = [];
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480\n480/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1422x800\n800/index.m3u8\n";
  const media = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:6.0,\nhttps://seg.example/800/seg_0.ts.jpg\n#EXTINF:4.0,\nseg_1.ts.jpg\n#EXT-X-ENDLIST\n";
  const { context: c } = harness();
  Object.assign(c.FileSystem, {
    makeDirectoryAsync: async () => {},
    getInfoAsync: async (uri) => (files.has(uri) ? { exists: true, size: files.get(uri).length } : { exists: uri.endsWith("/"), size: 0 }),
    createDownloadResumable: (url, dest, opts) => ({
      downloadAsync: async () => {
        fetched.push({ url, headers: opts.headers });
        if (segmentStatus === 200) files.set(dest, "x".repeat(1000));
        return { status: segmentStatus, uri: dest };
      },
      pauseAsync: async () => ({}),
    }),
    moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
    readAsStringAsync: async () => firstBytes,
    writeAsStringAsync: async (uri, text) => files.set(uri, text),
    getFreeDiskStorageAsync: async () => free,
    deleteAsync: async () => {},
  });
  c.fetch = async (url) => ({ ok: true, text: async () => (url.endsWith("master.m3u8") ? master : media) });
  return { c, files, fetched };
}
const hlsOptions = {
  id: "20", title: "Naruto", type: "anime", season: 1, episode: 1, audio: "Sub", quality: "800p",
  source: { uri: "https://cdn.example/p/master.m3u8", type: "m3u8", downloadable: false, headers: { Referer: "https://embed.example/" } },
  subtitles: [{ title: "English", cues: [{ start: 1, end: 2, text: "Hi" }] }],
};
test("anime HLS downloads save every segment with headers and a local playlist", async () => {
  const { c, files, fetched } = hlsHarness();
  await c.enqueueDownload(hlsOptions);
  await settle();
  const [entry] = await c.getQueue();
  assert.equal(entry.status, "done", entry.error);
  assert.equal(entry.kind, "hls");
  assert.deepEqual(fetched.map((f) => f.url), ["https://seg.example/800/seg_0.ts.jpg", "https://cdn.example/p/800/seg_1.ts.jpg"]);
  assert.ok(fetched.every((f) => f.headers.Referer === "https://embed.example/"));
  const playlist = files.get(entry.uri);
  assert.match(playlist, /^s00000\.ts$/m);
  assert.match(playlist, /^s00001\.ts$/m);
  assert.doesNotMatch(playlist, /https?:/);
  assert.equal(JSON.parse(files.get(entry.subtitlesUri))[0].cues[0].text, "Hi");
});
test("the chosen HLS quality is the variant that is downloaded", () => {
  const { c } = hlsHarness();
  const variants = c.parseMaster("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480\n480/i.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720\nhttps://o.example/720.m3u8\n", "https://cdn.example/a/master.m3u8");
  assert.deepEqual(JSON.parse(JSON.stringify(variants.map((v) => [v.label, v.url]))), [["720p", "https://o.example/720.m3u8"], ["480p", "https://cdn.example/a/480/i.m3u8"]]);
});
test("a selected download quality never silently switches to another resolution", async () => {
  const { c, fetched } = hlsHarness();
  await c.enqueueDownload({ ...hlsOptions, quality: "720p", requireQuality: true });
  await settle();
  const [entry] = await c.getQueue();
  assert.equal(entry.status, "error");
  assert.match(entry.error, /720p is unavailable/);
  assert.equal(fetched.length, 0);
});
test("HTML error pages instead of video segments fail the download", async () => {
  const { c } = hlsHarness({ firstBytes: "PA==" });
  await c.enqueueDownload(hlsOptions);
  await settle();
  assert.equal((await c.getQueue())[0].status, "error");
});
test("a refused segment fails the download with the server status", async () => {
  const { c, fetched } = hlsHarness({ segmentStatus: 429 });
  await c.enqueueDownload(hlsOptions);
  await settle();
  const [entry] = await c.getQueue();
  assert.equal(entry.status, "error");
  assert.match(entry.error, /429/);
  // Each segment is tried 3 times; once it fails, the other workers stop instead of fetching the rest.
  assert.ok(fetched.length <= 3 * 4, "fetched " + fetched.length);
});
test("encryption keys are saved locally and the playlist points at them", () => {
  const { c } = hlsHarness();
  const plan = c.planMedia('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/keys/k1"\n#EXTINF:5,\na.ts\n', "https://cdn.example/x/index.m3u8");
  assert.deepEqual(JSON.parse(JSON.stringify(plan.files.map((f) => f.url))), ["https://cdn.example/keys/k1", "https://cdn.example/x/a.ts"]);
  assert.match(plan.playlist, /URI="f0\.bin"/);
});

test("season queue persists unique episode requests before resolving sources", async () => {
 const {context:c}=harness(); c.backgroundAvailable=true;
 await c.enqueueSeason({id:'show',title:'Show',type:'series',season:2,audio:'English'},[3,1,2,2], '720p');
 await c.enqueueSeason({id:'show',title:'Show',type:'series',season:2,audio:'English'},[1,2,3], '720p');
 const q=await c.getQueue();assert.equal(q.length,3);assert.deepEqual(Array.from(q,e=>e.episode),[1,2,3]);assert.ok(q.every(e=>e.status==='queued'&&!e.source));
});
test("notification denial leaves a download paused rather than falsely running", async () => {
 const {context:c}=harness();c.backgroundAvailable=true;c.startDownloadService=async()=>{throw new Error('notifications denied')};
 await assert.rejects(c.enqueueDownload(options),/notifications denied/);assert.equal((await c.getQueue())[0].status,'paused');
});

test("headless worker drains persisted season requests without an activity", async () => {
 const {context:c}=harness();c.backgroundAvailable=true;c.FileSystem.writeAsStringAsync=async()=>{};
 await c.enqueueSeason({id:'show',title:'Show',type:'series',season:1},[1,2], '720p');
 await c.backgroundDownloadTask();const q=await c.getQueue();assert.equal(q.length,2);assert.ok(q.every(e=>e.status==='done'&&e.validated));
});

test("download concurrency defaults to one, persists, and rejects more than five", async () => {
 const {context:c}=harness();assert.equal(await c.getDownloadConcurrency(),1);await c.setDownloadConcurrency(5);assert.equal(await c.getDownloadConcurrency(),5);await assert.rejects(c.setDownloadConcurrency(6),/between 1 and 5/);
});
test("scheduler respects occupied slots and always caps concurrent downloads at five", () => {
 const {context:c}=harness();const items=Array.from({length:10},(_,i)=>({id:String(i),status:'queued'}));
 assert.equal(c.availableDownloadSlots(items,new Set(),1).length,1);assert.equal(c.availableDownloadSlots(items,new Set(['0','1']),5).length,3);assert.equal(c.availableDownloadSlots(items,new Set(),99).length,5);assert.equal(c.availableDownloadSlots(items,new Set(['0','1','2']),1).length,0);
});
