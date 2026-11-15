import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  StatusBar,
  ActivityIndicator,
  AppState,
  Alert,
  Linking,
  NativeModules,
  Modal,
  ScrollView,
  PanResponder,
  Pressable,
  useWindowDimensions,
} from "react-native";
import * as FileSystem from "expo-file-system";
import { SafeAreaView } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useIsFocused } from "@react-navigation/native";
import Video from "react-native-video";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize,
  X,
  Lock,
  Unlock,
  SkipForward,
  Sun,
  Volume2,
  PictureInPicture2,
  Gauge,
  Captions,
  SlidersHorizontal,
} from "lucide-react-native";
import { getDetails, resolvePlayback, forgetPlayback, prefetchPlayback } from "../services/api";
import { getQueue } from "../services/downloadManager";
import { recordProgress } from "../services/history";
import { orderPlaybackSources, qualityHeight, selectedAudioLanguage } from "../services/mediaOptions";
import { canShowNextEpisode, episodeLabel, nextEpisode, savedNextEpisodes } from "../services/playerEpisodes";
import { alternateAnimeAudio, animeAudioLabel, playbackProblem } from "../services/playbackErrors";
import { savedVideoExists } from "../services/savedPlayback";
import { formatSubtitleText } from "../utils/subtitles";
import {
  defaultSubtitleAppearance, readSubtitleAppearance, saveSubtitleAppearance, subtitleBackgrounds, subtitleSizes,
} from "../services/subtitleAppearance";
import {
  preferredSubtitleIndex,
  readSubtitlePreference,
  saveSubtitlePreference,
  subtitlePreferenceKey,
} from "../services/subtitlePreferences";
import { Action, IconButton, Chip } from "../components/Primitives";
import { colors, ui } from "../theme";
const playbackControls = NativeModules.MovieBoxPlaybackControls;
const format = (s) => {
  const n = Math.max(0, Math.floor(s || 0));
  return (
    (n >= 3600 ? Math.floor(n / 3600) + ":" : "") +
    String(Math.floor(n / 60) % 60).padStart(2, "0") +
    ":" +
    String(n % 60).padStart(2, "0")
  );
};
const LANGS = { en: "English", eng: "English", ja: "Japanese", jpn: "Japanese", hi: "Hindi", hin: "Hindi", es: "Spanish", spa: "Spanish", fr: "French", fre: "French", fra: "French", de: "German", ger: "German", deu: "German", it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese", ru: "Russian", rus: "Russian", ko: "Korean", kor: "Korean", zh: "Chinese", chi: "Chinese", zho: "Chinese", ar: "Arabic", ara: "Arabic", ta: "Tamil", tam: "Tamil", te: "Telugu", tel: "Telugu" };
const langName = (code) =>
  code && code !== "und" ? LANGS[String(code).toLowerCase()] || String(code).toUpperCase() : null;
const trackName = (t, i, known) =>
  t.title || known?.[i]?.title || langName(t.language) || "Track " + (i + 1);
// Keep about two minutes ahead so short network dips do not interrupt playback.
const BUFFER = {
  minBufferMs: 60000,
  maxBufferMs: 120000,
  bufferForPlaybackMs: 2000,
  bufferForPlaybackAfterRebufferMs: 5000,
  backBufferDurationMs: 30000,
};
// One saved position per title/episode, shared by streaming and the downloaded copy.
export function watchKey(request, streamUrl) {
  return (
    "watch:" +
    JSON.stringify(
      request ? [request.type, request.id, request.season, request.episode] : [streamUrl],
    )
  );
}
export default function PlayerScreen({ route, navigation }) {
  const {
    title = "Now playing",
    mediaRequest: initialRequest,
    streamUrl,
    subtitlesUri,
    episodeList,
    episodeCount,
  } = route.params || {};
  const [mediaRequest, setMediaRequest] = useState(initialRequest);
  const [recovery, setRecovery] = useState(null);
  const focused = useIsFocused();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const offline = !!streamUrl && /^(file|content):\/\//.test(streamUrl);
  const [savedNext, setSavedNext] = useState(null);
  const [loadedEpisodes, setLoadedEpisodes] = useState(null);
  const knownEpisodes = episodeList?.length ? episodeList : loadedEpisodes;
  const nextRequest = useMemo(() => {
    if (!offline) return nextEpisode(mediaRequest, knownEpisodes, episodeCount);
    return savedNext && { ...mediaRequest, season: savedNext.season, episode: savedNext.episode,
      audio: savedNext.audio, audioLanguage: savedNext.audioLanguage };
  }, [offline, savedNext, mediaRequest, knownEpisodes, episodeCount]);
  const video = useRef(null),
    hideTimer = useRef(null),
    position = useRef(0),
    lastSave = useRef(0),
    loadTimer = useRef(null),
    requestId = useRef(0),
    bufferTimer = useRef(null),
    gestureActions = useRef(null),
    swipeStart = useRef(null),
    swipe = useRef(null),
    levelTimer = useRef(null),
    pip = useRef({ active: false, playing: false, buffering: false, entryTimer: null, stateTimer: null, exitTimer: null }),
    flashTimer = useRef(null),
    nextTimer = useRef(null),
    advancing = useRef(false),
    manualAudio = useRef(false),
    prefetchedNext = useRef(false),
    barRef = useRef(null),
    bar = useRef({ x: 0, w: 1 }),
    scrubValue = useRef(null),
    durationRef = useRef(0),
    seekRef = useRef(null),
    saveHistoryRef = useRef(null),
    refreshControlsRef = useRef(null),
    finished = useRef(false),
    lastFailedSource = useRef(null),
    refreshedExpiredSource = useRef(false),
    resumeAt = useRef(0);
  const [media, setMedia] = useState(null),
    [sourceIndex, setSourceIndex] = useState(0),
    [error, setError] = useState(null),
    [loading, setLoading] = useState(true),
    [buffering, setBuffering] = useState(false),
    [paused, setPaused] = useState(false),
    [pipMode, setPipMode] = useState("off"),
    [background, setBackground] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [controls, setControls] = useState(true),
    [settings, setSettings] = useState(false),
    [locked, setLocked] = useState(false),
    [speed, setSpeed] = useState(1),
    [resize, setResize] = useState("contain"),
    [audioTracks, setAudioTracks] = useState([]),
    [audio, setAudio] = useState({ type: "system" }),
    [subtitleIndex, setSubtitleIndex] = useState(-1),
    [subtitleAppearance, setSubtitleAppearance] = useState(defaultSubtitleAppearance),
    [quality, setQuality] = useState({ type: "auto" }),
    [videoTracks, setVideoTracks] = useState([]),
    [scrub, setScrub] = useState(null),
    [swipePreview, setSwipePreview] = useState(null),
    [levelPreview, setLevelPreview] = useState(null),
    [flash, setFlash] = useState(null),
    [upNext, setUpNext] = useState(null);
  durationRef.current = duration;
  const storageKey = watchKey(mediaRequest, streamUrl);
  const subtitleKey = subtitlePreferenceKey(mediaRequest);
  const subtitleSize = subtitleSizes[subtitleAppearance.size] - (controls && !locked ? 4 : 0);
  const episode = episodeLabel(mediaRequest);
  const playerSubtitle = [
    episode,
    offline ? "Saved on this device" : episode && mediaRequest.type === "anime"
      ? (mediaRequest.audio === "Dub" ? "Dubbed" : "Subtitled")
      : "",
  ].filter(Boolean).join(" · ") || "Now playing";
  const showNext = !!nextRequest && canShowNextEpisode(duration, time) && focused &&
    !locked && !loading && !error && !settings && upNext === null && pipMode === "off";
  const source = media?.sources[sourceIndex];
  const videoSource = useMemo(() => {
    if (!source || !focused) return undefined;
    const startAt = position.current || resumeAt.current;
    return {
      uri: source.uri,
      type: source.type,
      headers: source.headers,
      startPosition: startAt > 0 ? Math.floor(startAt * 1000) : undefined,
      bufferConfig: BUFFER,
      minLoadRetryCount: 2,
    };
  }, [source, media, focused]);
  useEffect(() => {
    if (!focused || !offline || !episode) return;
    let active = true;
    setSavedNext(null);
    getQueue().then(async queue => {
      for (const item of savedNextEpisodes(queue, mediaRequest)) {
        if (!active) return;
        if (await savedVideoExists(item).catch(() => false)) {
          if (active) setSavedNext(item);
          return;
        }
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [focused, offline, episode, mediaRequest]);
  useEffect(() => {
    if (offline || mediaRequest?.type !== "series" || episodeList?.length) return;
    let active = true;
    getDetails(mediaRequest.id).then(data => {
      if (active) setLoadedEpisodes(data.episodeList || []);
    }).catch(() => {});
    return () => { active = false; };
  }, [offline, mediaRequest?.type, mediaRequest?.id, episodeList]);
  function showControls() {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 4500);
  }
  refreshControlsRef.current = showControls;
  async function load(fresh = false, request = mediaRequest) {
    const token = ++requestId.current;
    setLoading(true);
    setError(null);
    setRecovery(null);
    setMedia(null);
    setSourceIndex(0);
    try {
      let result;
      if (streamUrl) {
        if (
          !offline &&
          !/^https:\/\/[^\s]+\.(mp4|m3u8|mpd)(\?|$)/i.test(streamUrl)
        )
          throw new Error("This link is not a supported video file.");
        const ext = streamUrl.split("?")[0].split(".").pop().toLowerCase();
        result = {
          sources: [
            {
              uri: streamUrl,
              ...(["mp4", "m3u8", "mpd"].includes(ext) ? { type: ext } : {}),
            },
          ],
          subtitles: subtitlesUri
            ? await FileSystem.readAsStringAsync(subtitlesUri)
                .then(JSON.parse)
                .catch(() => [])
            : [],
        };
      } else result = await resolvePlayback(request, { fresh });
      const [saved, preference] = await Promise.all([
        AsyncStorage.getItem(storageKey),
        readSubtitlePreference(subtitleKey),
      ]);
      if (token !== requestId.current) return;
      resumeAt.current = position.current || Number(saved) || 0;
      const defaultOn = request?.type === "anime" && request.audio !== "Dub";
      setSubtitleIndex(preferredSubtitleIndex(result.subtitles, preference, defaultOn));
      const preferredQuality = offline ? null : request?.playbackQuality;
      const height = qualityHeight(preferredQuality);
      setQuality(height ? { type: "resolution", value: height } : { type: "auto" });
      setMedia({ ...result, sources: orderPlaybackSources(result.sources, preferredQuality) });
      setPaused(false);
    } catch (e) {
      if (token === requestId.current) {
        const problem = playbackProblem(e);
        setError(problem);
        if (problem.kind === "audio") checkAlternate(request, token);
        setLoading(false);
      }
    }
  }
  function checkAlternate(request, token) {
    const audio = alternateAnimeAudio(request);
    if (!audio) return;
    const alternative = { ...request, audio, playbackQuality: "Auto" };
    resolvePlayback(alternative).then(() => {
      if (token === requestId.current) setRecovery(alternative);
    }).catch(() => {});
  }
  function selectSubtitle(index) {
    setSubtitleIndex(index);
    saveSubtitlePreference(subtitleKey, media?.subtitles?.[index]);
  }
  function changeSubtitleAppearance(change) {
    const next = { ...subtitleAppearance, ...change };
    setSubtitleAppearance(next);
    saveSubtitleAppearance(next);
  }
  useEffect(() => {
    let active = true;
    readSubtitleAppearance().then(value => { if (active) setSubtitleAppearance(value); });
    return () => { active = false; };
  }, []);
  function updateAudioTracks(tracks) {
    setAudioTracks(tracks);
    if (!manualAudio.current) {
      const language = selectedAudioLanguage(mediaRequest?.audioLanguage, tracks);
      const type = language ? "language" : "system";
      setAudio(previous => previous.type === type && (previous.value || null) === language
        ? previous : language ? { type, value: language } : { type });
    }
  }

  function selectAudio(track) {
    manualAudio.current = true;
    setAudio(track);
  }
  useEffect(() => {
    load();
    const sub = AppState.addEventListener("change", (state) => {
      setBackground(state !== "active");
      // Never start the next episode while the app is in the background.
      if (state !== "active") {
        clearInterval(nextTimer.current);
        setUpNext(null);
      }
    });
    return () => {
      requestId.current++;
      sub.remove();
      clearTimeout(hideTimer.current);
      clearTimeout(loadTimer.current);
      clearTimeout(bufferTimer.current);
      clearTimeout(flashTimer.current);
      clearTimeout(levelTimer.current);
      clearTimeout(pip.current.entryTimer);
      clearTimeout(pip.current.stateTimer);
      clearTimeout(pip.current.exitTimer);
      swipeStart.current = null;
      swipe.current = null;
      playbackControls?.restoreBrightness();
      clearInterval(nextTimer.current);
      // Leaving before playback started must not wipe the saved position.
      if (position.current > 0) {
        AsyncStorage.setItem(storageKey, String(position.current)).catch(
          () => {},
        );
        saveHistoryRef.current?.(position.current);
      }
    };
  }, [storageKey]);
  useEffect(() => {
    if (focused) return;
    clearInterval(nextTimer.current);
    clearTimeout(levelTimer.current);
    swipeStart.current = null;
    swipe.current = null;
    setUpNext(null);
    setLevelPreview(null);
    playbackControls?.restoreBrightness();
  }, [focused]);
  async function openFloatingPlayer() {
    if (!focused || !source || loading || pipMode !== "off" || !video.current) return;
    try {
      if (!await playbackControls.canEnterPictureInPicture()) {
        Alert.alert("Allow Picture-in-Picture", "Enable Picture-in-Picture for MovieBox in Android settings.",
          [{ text: "Cancel" }, { text: "Open settings", onPress: () => Linking.openSettings().catch(() => {}) }]);
        return;
      }
      if (!navigation.isFocused() || !video.current) return;
      setPipMode("opening");
      setControls(false);
      setFlash(null);
      setLevelPreview(null);
      pip.current.entryTimer = setTimeout(() => {
        if (!pip.current.active) {
          setPipMode("off");
          showControls();
        }
      }, 2000);
      await video.current.enterPictureInPicture();
    } catch {
      clearTimeout(pip.current.entryTimer);
      setPipMode("off");
      showControls();
      Alert.alert("Couldn’t open Picture-in-Picture", "Try again once the video is playing.");
    }
  }
  function onFloatingPlayerChanged({ isActive }) {
    const state = pip.current;
    clearTimeout(state.entryTimer);
    clearTimeout(state.stateTimer);
    clearTimeout(state.exitTimer);
    const wasActive = state.active;
    state.active = isActive;
    setPipMode(isActive ? "active" : "off");
    if (isActive) {
      state.playing = !paused;
      clearInterval(nextTimer.current);
      playbackControls.restoreBrightness();
      if (!paused) video.current?.resume();
    } else if (wasActive) {
      setPaused(!state.playing);
      // Expanding PiP brings the Activity to the foreground; closing it leaves it stopped.
      state.exitTimer = setTimeout(() => {
        if (AppState.currentState !== "active") setPaused(true);
        else showControls();
      }, 350);
    }
  }
  // One "Continue watching" card per show, pointing at the latest episode watched.
  const historyKey = mediaRequest ? "show:" + mediaRequest.type + ":" + mediaRequest.id : null;
  function saveHistory(at, ended = false) {
    // After the end the player rewinds to 0:00; that must not bring a finished title back.
    if (mediaRequest && (!finished.current || ended))
      recordProgress({
        key: historyKey,
        title,
        request: mediaRequest,
        episodeCount,
        episodeList: knownEpisodes,
        savedNext: offline ? nextRequest : null,
        position: at,
        duration: durationRef.current,
        ended,
      });
  }
  saveHistoryRef.current = saveHistory;
  async function playNext() {
    clearInterval(nextTimer.current);
    if (!nextRequest || !navigation.isFocused() || pip.current.active || advancing.current) return;
    advancing.current = true;
    if (savedNext) {
      const exists = await savedVideoExists(savedNext).catch(() => false);
      if (!navigation.isFocused() || pip.current.active) {
        advancing.current = false;
        return;
      }
      if (!exists) {
        advancing.current = false;
        setUpNext(null);
        setSavedNext(null);
        Alert.alert("Next episode unavailable", "The saved video could not be opened.");
        return;
      }
    }
    navigation.replace("Player", {
      title,
      mediaRequest: nextRequest,
      episodeList: knownEpisodes,
      episodeCount,
      ...(savedNext && { streamUrl: savedNext.uri || savedNext.destUri, subtitlesUri: savedNext.subtitlesUri }),
    });
  }
  function ended() {
    setPaused(true);
    position.current = 0;
    setTime(0);
    AsyncStorage.removeItem(storageKey).catch(() => {});
    finished.current = true;
    saveHistory(durationRef.current, true);
    setControls(true);
    // Rewind either way, so Play works again if Up Next is cancelled.
    video.current?.seek(0);
    if (!nextRequest || pip.current.active || !focused) return;
    // Like a TV app: count down, then start the next episode unless cancelled.
    setUpNext(10);
    clearInterval(nextTimer.current);
    nextTimer.current = setInterval(() => {
      setUpNext((n) => {
        if (n === null) return null;
        if (n <= 1) {
          setTimeout(playNext, 0);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  }
  function toggleControls() {
    if (locked || error || upNext !== null) return;
    if (controls) {
      clearTimeout(hideTimer.current);
      setControls(false);
    } else showControls();
  }
  const canGestureSeek = focused && pipMode === "off" && !locked && !loading && !error && upNext === null && !!source && duration > 0;
  function updateLevel(adjustment) {
    if (adjustment.base === null) return;
    const level = Math.round(Math.max(0, Math.min(1,
      adjustment.base - adjustment.dy / adjustment.range,
    )) * 100);
    if (level !== adjustment.last) {
      adjustment.last = level;
      playbackControls.setLevel(adjustment.kind, level / 100);
      setLevelPreview({ kind: adjustment.kind, level });
    }
  }
  function finishLevelPreview() {
    clearTimeout(levelTimer.current);
    levelTimer.current = setTimeout(() => setLevelPreview(null), 850);
  }
  gestureActions.current = {
    tap: toggleControls,
    jump: x => {
      if (!canGestureSeek) return;
      const forward = x >= screenWidth / 2;
      seek(position.current + (forward ? 10 : -10), false);
      setFlash(forward ? "+10 s" : "−10 s");
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 600);
    },
    beginSwipe: ({ dx, dy, startX }) => {
      if (!canGestureSeek) return;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      const vertical = Math.abs(dy) > Math.abs(dx);
      if (vertical && !playbackControls) return;
      clearTimeout(hideTimer.current);
      clearTimeout(flashTimer.current);
      clearTimeout(levelTimer.current);
      setFlash(null);
      setLevelPreview(null);
      if (!vertical) {
        swipe.current = { kind: "seek", origin: position.current, target: null };
        return;
      }
      const kind = startX < screenWidth / 2 ? "volume" : "brightness";
      const adjustment = { kind, base: null, dy, range: screenHeight * 0.65 };
      swipe.current = adjustment;
      playbackControls.getLevel(kind).then(base => {
        if (swipe.current !== adjustment) return;
        adjustment.base = base;
        updateLevel(adjustment);
        if (adjustment.released) {
          swipe.current = null;
          finishLevelPreview();
        }
      }).catch(() => {
        if (swipe.current === adjustment) swipe.current = null;
      });
    },
    moveSwipe: ({ dx, dy }) => {
      const active = swipe.current;
      if (!active) return;
      if (active.kind !== "seek") {
        active.dy = dy;
        updateLevel(active);
        return;
      }
      // A full-width swipe moves two minutes, so shorter swipes make small adjustments.
      const target = Math.max(0, Math.min(duration, active.origin + dx * 120 / screenWidth));
      active.target = target;
      setSwipePreview({ target, delta: Math.round(target - active.origin) });
    },
    endSwipe: success => {
      const active = swipe.current;
      if (!active || active.released) return;
      if (active.kind === "seek") {
        if (success && canGestureSeek && active.target !== null) seek(active.target, false);
        else if (controls) showControls();
        swipe.current = null;
        setSwipePreview(null);
      } else {
        if (controls) showControls();
        if (success && active.base === null) active.released = true;
        else {
          swipe.current = null;
          finishLevelPreview();
        }
      }
    },
  };
  const surfaceGesture = useMemo(() => Gesture.Exclusive(
    Gesture.Pan().runOnJS(true).maxPointers(1).minDistance(16)
      .onBegin(e => { swipeStart.current = { x: e.absoluteX, y: e.absoluteY, localX: e.x }; })
      .onUpdate(e => {
        const start = swipeStart.current;
        if (!start) return;
        // Android can reset translation at activation. Measure from the actual touch-down.
        const movement = { dx: e.absoluteX - start.x, dy: e.absoluteY - start.y, startX: start.localX };
        if (!swipe.current || swipe.current.released) gestureActions.current.beginSwipe(movement);
        gestureActions.current.moveSwipe(movement);
      })
      .onFinalize((_e, success) => {
        swipeStart.current = null;
        gestureActions.current.endSwipe(success);
      }),
    Gesture.Tap().runOnJS(true).numberOfTaps(2).maxDelay(280).maxDistance(20)
      .onEnd((e, success) => { if (success) gestureActions.current.jump(e.x); }),
    Gesture.Tap().runOnJS(true).maxDistance(20)
      .onEnd((_e, success) => { if (success) gestureActions.current.tap(); }),
  ), []);
  const scrubber = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => moveScrub(e.nativeEvent.pageX),
        onPanResponderMove: (e) => moveScrub(e.nativeEvent.pageX),
        onPanResponderRelease: () => {
          if (scrubValue.current !== null) seekRef.current(scrubValue.current);
          scrubValue.current = null;
          setScrub(null);
        },
        onPanResponderTerminate: () => {
          if (scrubValue.current !== null) refreshControlsRef.current();
          scrubValue.current = null;
          setScrub(null);
        },
      }),
    [],
  );
  function moveScrub(pageX) {
    const fraction = Math.max(0, Math.min(1, (pageX - bar.current.x) / bar.current.w));
    scrubValue.current = fraction * durationRef.current;
    setScrub(scrubValue.current);
    clearTimeout(hideTimer.current);
  }
  useEffect(() => {
    if (!source || !focused) return;
    setLoading(true);
    clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(failed, 25000);
    return () => clearTimeout(loadTimer.current);
  }, [source, focused]);
  useEffect(() => {
    if (settings || error) {
      clearTimeout(hideTimer.current);
      setControls(true);
    } else showControls();
    return () => clearTimeout(hideTimer.current);
  }, [paused, settings, error]);
  function seek(value, reveal = true) {
    const next = Math.max(0, Math.min(duration || 0, value));
    video.current?.seek(next);
    setTime(next);
    position.current = next;
    if (reveal || controls) showControls();
  }
  seekRef.current = seek;
  const cue =
    subtitleIndex >= 0
      ? media?.subtitles?.[subtitleIndex]?.cues.find(
          (c) => time >= c.start && time < c.end,
        )
      : null;
  function failed(event) {
    if (!source || lastFailedSource.current === source || !navigation.isFocused()) return;
    lastFailedSource.current = source;
    clearTimeout(loadTimer.current);
    const failure = [event?.error?.errorException, event?.error?.errorStackTrace].filter(Boolean).join(" ");
    const status = Number(failure.match(/Response code:\s*(\d{3})/i)?.[1]);
    const host = uri => uri.match(/^https?:\/\/([^/:?#]+)/i)?.[1]?.toLowerCase();
    const failedHost = host(source.uri);
    const next = media.sources.findIndex((candidate, index) =>
      index > sourceIndex && (status !== 429 || !failedHost || host(candidate.uri) !== failedHost));
    if (next >= 0) {
      resumeAt.current = position.current || resumeAt.current;
      setSourceIndex(next);
    } else if (mediaRequest && !streamUrl && [401, 403, 404, 410].includes(status) && !refreshedExpiredSource.current) {
      refreshedExpiredSource.current = true;
      load(true);
    } else {
      // Don't let the next Watch tap reuse sources that just failed.
      forgetPlayback(mediaRequest);
      setLoading(false);
      const problem = status === 429 ? playbackProblem({ status }) : playbackProblem({
        message: offline
          ? "This saved file cannot be played. Delete it and download a new copy."
          : "This video source could not be played. Try again to request a fresh source.",
      });
      setError(problem);
      if (!streamUrl && status !== 429 && mediaRequest?.type === "anime") checkAlternate(mediaRequest, requestId.current);
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar hidden />
      {focused && source && !error && (
        <Video
          key={source.uri}
          ref={video}
          source={videoSource}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          resizeMode={resize}
          paused={paused || (background && pipMode === "off") || !!settings || !!error}
          rate={speed}
          controls={false}
          playInBackground={false}
          playWhenInactive={false}
          ignoreSilentSwitch="ignore"
          preventsDisplaySleepDuringVideoPlayback
          progressUpdateInterval={250}
          onPictureInPictureStatusChanged={onFloatingPlayerChanged}
          onPlaybackStateChanged={({ isPlaying, isSeeking }) => {
            const state = pip.current;
            if (!state.active || isSeeking) return;
            clearTimeout(state.stateTimer);
            if (isPlaying) state.playing = true;
            else state.stateTimer = setTimeout(() => {
              if (state.active && !state.buffering) state.playing = false;
            }, 250);
          }}
          selectedAudioTrack={audio}
          selectedVideoTrack={source.type === "m3u8" || source.type === "mpd" ? quality : { type: "auto" }}
          selectedTextTrack={{ type: "disabled" }}
          onLoad={(d) => {
            clearTimeout(loadTimer.current);
            setDuration(d.duration);
            setLoading(false);
            updateAudioTracks(d.audioTracks || []);
            setVideoTracks(d.videoTracks || []);
            // startPosition normally handles resume; seek only if the player ignored it.
            if (
              resumeAt.current > 0 &&
              resumeAt.current < d.duration - 5 &&
              Math.abs((d.currentTime || 0) - resumeAt.current) > 3
            )
              video.current?.seek(resumeAt.current);
            resumeAt.current = 0;
          }}
          onAudioTracks={(d) => updateAudioTracks(d.audioTracks || [])}
          onVideoTracks={(d) => setVideoTracks(d.videoTracks || [])}
          onProgress={(p) => {
            setTime(p.currentTime);
            position.current = p.currentTime;
            if (Date.now() - lastSave.current > 5000) {
              lastSave.current = Date.now();
              AsyncStorage.setItem(storageKey, String(p.currentTime)).catch(
                () => {},
              );
              saveHistory(p.currentTime);
            }
            // Fetch the next episode's source near the end so it starts instantly.
            if (
              nextRequest && !offline &&
              !prefetchedNext.current &&
              durationRef.current - p.currentTime < 120
            ) {
              prefetchedNext.current = true;
              prefetchPlayback(nextRequest);
            }
          }}
          onBuffer={({ isBuffering }) => {
            pip.current.buffering = isBuffering;
            clearTimeout(bufferTimer.current);
            // Short dips are not worth a spinner; show one only if the stall lasts.
            if (isBuffering)
              bufferTimer.current = setTimeout(() => setBuffering(true), 700);
            else setBuffering(false);
          }}
          onError={failed}
          onEnd={ended}
        />
      )}
      <GestureDetector gesture={surfaceGesture}>
        <View
          accessible={!locked}
          accessibilityRole="button"
          accessibilityLabel={controls ? "Hide playback controls" : "Show playback controls"}
          accessibilityHint={playbackControls ? "Swipe up or down on the left for volume, or on the right for brightness." : undefined}
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={toggleControls}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </GestureDetector>
      {controls && !locked && !error && !loading && pipMode === "off" && (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "#0005" }} />
      )}
      {swipePreview && (
        <View pointerEvents="none" style={{ position: "absolute", top: "28%", alignSelf: "center",
          borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: "#101824E8", alignItems: "center" }}>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{format(swipePreview.target)}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {swipePreview.delta < 0 ? "−" : "+"}{Math.abs(swipePreview.delta)} s
          </Text>
        </View>
      )}
      {levelPreview && (
        <View pointerEvents="none" style={{ position: "absolute", top: "28%",
          [levelPreview.kind === "volume" ? "left" : "right"]: 28,
          borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, gap: 8,
          alignItems: "center", backgroundColor: "#101824E8" }}>
          {levelPreview.kind === "volume"
            ? <Volume2 size={20} color={colors.accent} />
            : <Sun size={20} color={colors.accent} />}
          <View style={{ width: 6, height: 64, borderRadius: 4, overflow: "hidden",
            justifyContent: "flex-end", backgroundColor: colors.border }}>
            <View style={{ height: levelPreview.level + "%", backgroundColor: colors.accent }} />
          </View>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: "700" }}>
            {levelPreview.level}%
          </Text>
        </View>
      )}
      {flash && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            [flash.startsWith("+") ? "right" : "left"]: 0,
            width: "35%",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#FFFFFF14",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>{flash}</Text>
        </View>
      )}
      {upNext !== null && nextRequest && (
        <View
          style={{
            position: "absolute",
            right: 32,
            bottom: 32,
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            gap: 10,
            width: 300,
          }}
        >
          <Text style={[ui.label, { color: colors.accent }]}>UP NEXT</Text>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>
            {episodeLabel(nextRequest)}
          </Text>
          <Action title={"Play now · " + upNext + " s"} icon={SkipForward} onPress={playNext} />
          <Action
            title="Cancel"
            secondary
            onPress={() => {
              clearInterval(nextTimer.current);
              setUpNext(null);
            }}
          />
        </View>
      )}
      {showNext && !controls && (
        <SafeAreaView pointerEvents="box-none" style={{ position: "absolute", right: 24, bottom: 84 }}>
          <Action title="Next episode" icon={SkipForward} onPress={playNext} />
        </SafeAreaView>
      )}
      {loading && !error && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: "center",
            alignItems: "center",
            gap: 16,
          }}
        >
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ color: colors.text }}>
            {source ? "Starting video…" : "Finding a playable source…"}
          </Text>
        </View>
      )}
      {buffering && !loading && !error && (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}
      {cue && !error && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 48,
            right: 48,
            // With controls showing, sit just above the bottom bar in smaller type so the
            // play buttons stay clear.
            bottom: controls && !locked ? 122 : 28,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: subtitleSize,
              lineHeight: Math.round(subtitleSize * 1.35),
              fontWeight: "600",
              textAlign: "center",
              backgroundColor: subtitleBackgrounds[subtitleAppearance.background],
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 6,
              textShadowColor: "#000",
              textShadowRadius: 3,
            }}
          >
            {formatSubtitleText(cue.text)}
          </Text>
        </View>
      )}
      {locked ? (
        <SafeAreaView
          pointerEvents="box-none"
          style={{ position: "absolute", top: 12, left: 24 }}
        >
          <IconButton
            icon={Unlock}
            label="Unlock player"
            onPress={() => {
              setLocked(false);
              showControls();
            }}
          />
        </SafeAreaView>
      ) : (
        controls && pipMode === "off" &&
        !error &&
        upNext === null && (
          <SafeAreaView
            pointerEvents="box-none"
            style={{
              flex: 1,
              justifyContent: "space-between",
              paddingHorizontal: 24,
              paddingVertical: 12,
            }}
          >
            <View
              style={[
                ui.between,
                { paddingHorizontal: 4 },
              ]}
            >
              <View style={[ui.row, { flex: 1 }]}>
                <IconButton
                  icon={ArrowLeft}
                  label="Close player"
                  onPress={() => navigation.goBack()}
                  style={{ backgroundColor: "transparent" }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.text,
                      fontSize: 17,
                      fontWeight: "600",
                    }}
                  >
                    {title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}
                  >
                    {playerSubtitle}
                  </Text>
                </View>
              </View>
              {playbackControls?.pictureInPictureSupported && source && !loading && (
                <IconButton icon={PictureInPicture2} label="Picture-in-Picture" onPress={openFloatingPlayer} />
              )}
              <IconButton
                icon={Lock}
                label="Lock controls"
                onPress={() => setLocked(true)}
                style={{ backgroundColor: "transparent" }}
              />
            </View>
            {!loading && source ? (
              <View
                pointerEvents="box-none"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 40,
                }}
              >
                <IconButton
                  icon={RotateCcw}
                  label="Rewind 10 seconds"
                  onPress={() => seek(time - 10)}
                  style={{ backgroundColor: "transparent" }}
                />
                <IconButton
                  icon={paused ? Play : Pause}
                  label={paused ? "Play" : "Pause"}
                  onPress={() => {
                    // Pressing Play after the end starts a rewatch, which is tracked again.
                    finished.current = false;
                    setPaused((p) => !p);
                  }}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 36,
                    backgroundColor: "transparent",
                  }}
                />
                <IconButton
                  icon={RotateCw}
                  label="Forward 10 seconds"
                  onPress={() => seek(time + 10)}
                  style={{ backgroundColor: "transparent" }}
                />
              </View>
            ) : (
              <View />
            )}
            <View
              style={{
                paddingHorizontal: 4,
              }}
            >
              <View style={ui.row}>
                <Text
                  style={{
                    color: colors.text,
                    fontVariant: ["tabular-nums"],
                    fontSize: 12,
                  }}
                >
                  {format(scrub ?? time)}
                </Text>
                <View
                  ref={barRef}
                  {...scrubber.panHandlers}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Playback position"
                  accessibilityValue={{
                    min: 0,
                    max: Math.floor(duration),
                    now: Math.floor(time),
                  }}
                  accessibilityActions={[
                    { name: "increment" },
                    { name: "decrement" },
                  ]}
                  onAccessibilityAction={(e) =>
                    seek(
                      time +
                        (e.nativeEvent.actionName === "increment" ? 10 : -10),
                    )
                  }
                  // Window position is needed because drag events report screen coordinates.
                  onLayout={() =>
                    barRef.current?.measureInWindow((x, _y, w) => {
                      bar.current = { x, w: w || 1 };
                    })
                  }
                  style={{ flex: 1, height: 44, justifyContent: "center" }}
                >
                  <View
                    pointerEvents="none"
                    style={{
                      height: scrub !== null ? 6 : 4,
                      backgroundColor: colors.border,
                      borderRadius: 4,
                    }}
                  >
                    <View
                      style={{
                        height: "100%",
                        width:
                          (duration ? Math.min((scrub ?? time) / duration, 1) * 100 : 0) +
                          "%",
                        backgroundColor: colors.accent,
                        borderRadius: 4,
                      }}
                    />
                    <View
                      style={{
                        position: "absolute",
                        left:
                          (duration ? Math.min((scrub ?? time) / duration, 1) * 100 : 0) +
                          "%",
                        top: scrub !== null ? -6 : -5,
                        width: scrub !== null ? 18 : 14,
                        height: scrub !== null ? 18 : 14,
                        marginLeft: scrub !== null ? -9 : -7,
                        borderRadius: 9,
                        backgroundColor: colors.accent,
                      }}
                    />
                  </View>
                </View>
                <Text
                  style={{
                    color: colors.muted,
                    fontVariant: ["tabular-nums"],
                    fontSize: 12,
                  }}
                >
                  {format(duration)}
                </Text>
              </View>
              <View style={ui.between}>
                <PlayerOption icon={Gauge} label={"Speed (" + speed + "×)"} onPress={() => setSettings("speed")} />
                <PlayerOption icon={Maximize} label={resize === "contain" ? "Fit" : "Fill"}
                  onPress={() => setResize(r => r === "contain" ? "cover" : "contain")} />
                <PlayerOption icon={Captions} label="Audio & subtitles" onPress={() => setSettings("audio")} />
                <PlayerOption icon={SlidersHorizontal} label="Quality" onPress={() => setSettings("quality")} />
                {showNext && (
                  <IconButton
                    icon={SkipForward}
                    label="Next episode"
                    onPress={playNext}
                    style={{ height: 40, width: 44 }}
                  />
                )}
              </View>
            </View>
          </SafeAreaView>
        )
      )}
      {error && (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: "#101824",
          }}
        >
          <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
          <View style={{ maxWidth: 520, gap: 16, width: "100%" }}>
            <Text style={ui.heading}>{error.title}</Text>
            <Text style={ui.body}>{error.message}</Text>
            {recovery && <Action title={"Try " + animeAudioLabel(recovery.audio).toLowerCase()}
              onPress={() => {
                refreshedExpiredSource.current = false;
                setMediaRequest(recovery);
                load(false, recovery);
              }} />}
            {error.kind === "other" && !streamUrl && quality.type === "resolution" &&
              media?.sources.some(item => item.type === "m3u8" || item.type === "mpd") && (
              <Action secondary title="Try Auto quality" onPress={() => {
                const request = { ...mediaRequest, playbackQuality: "Auto" };
                refreshedExpiredSource.current = false;
                setMediaRequest(request);
                load(false, request);
              }} />
            )}
            <View style={ui.row}>
              <Action title="Try again" onPress={() => { refreshedExpiredSource.current = false; load(true); }} style={{ flex: 1 }} />
              <Action
                title="Go back"
                secondary
                onPress={() => navigation.goBack()}
                style={{ flex: 1 }}
              />
            </View>
          </View>
          </ScrollView>
        </SafeAreaView>
      )}
      <Modal
        visible={!!settings}
        transparent
        animationType="fade"
        onRequestClose={() => setSettings(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#000A",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 20,
              width: "100%",
              maxWidth: 600,
              maxHeight: "100%",
              padding: 20,
            }}
          >
            <View style={ui.between}>
              <Text style={ui.heading}>Playback settings</Text>
              <IconButton
                icon={X}
                label="Close settings"
                onPress={() => setSettings(false)}
              />
            </View>
            <ScrollView>
              {settings === "speed" && <Setting label="Speed">
                {[0.75, 1, 1.25, 1.5, 2].map((v) => (
                  <Chip
                    key={v}
                    title={v + "×"}
                    selected={speed === v}
                    onPress={() => setSpeed(v)}
                  />
                ))}
              </Setting>}
              {settings === "quality" && <Setting label="Quality">
                {media?.sources.length > 1 ? (
                  media.sources.map((s, i) => (
                    <Chip
                      key={i}
                      title={s.quality || "Source " + (i + 1)}
                      selected={sourceIndex === i}
                      onPress={() => {
                        if (i !== sourceIndex) {
                          lastFailedSource.current = null;
                          resumeAt.current = position.current || resumeAt.current;
                          setSourceIndex(i);
                          setError(null);
                        }
                      }}
                    />
                  ))
                ) : (
                  <>
                    <Chip
                      title="Auto"
                      selected={quality.type === "auto"}
                      onPress={() => setQuality({ type: "auto" })}
                    />
                    {[
                      ...new Set(
                        videoTracks.map((t) => t.height).filter(Boolean),
                      ),
                    ]
                      .sort((a, b) => a - b)
                      .map((h) => (
                        <Chip
                          key={h}
                          title={h + "p"}
                          selected={quality.value === h}
                          onPress={() =>
                            setQuality({ type: "resolution", value: h })
                          }
                        />
                      ))}
                  </>
                )}
              </Setting>}
              {settings === "audio" && <><Setting label="Audio">
                <Chip
                  title="Default"
                  selected={audio.type === "system"}
                  onPress={() => selectAudio({ type: "system" })}
                />
                {audioTracks.map((t, i) => (
                  <Chip
                    key={i}
                    title={trackName(t, i)}
                    selected={audio.type === "language" ? audio.value === t.language : audio.value === (t.index ?? i)}
                    onPress={() =>
                      selectAudio({ type: "index", value: t.index ?? i })
                    }
                  />
                ))}
              </Setting>
              <Setting label="Subtitles">
                <Chip
                  title="Off"
                  selected={subtitleIndex < 0}
                  onPress={() => selectSubtitle(-1)}
                />
                {(media?.subtitles || []).map((t, i) => (
                  <Chip
                    key={i}
                    title={trackName(t, i)}
                    selected={subtitleIndex === i}
                    onPress={() => selectSubtitle(i)}
                  />
                ))}
              </Setting>
              <Setting label="Subtitle size">
                {Object.keys(subtitleSizes).map(size => <Chip key={size} title={size}
                  selected={subtitleAppearance.size === size} onPress={() => changeSubtitleAppearance({ size })} />)}
              </Setting>
              <Setting label="Subtitle background">
                {Object.keys(subtitleBackgrounds).map(background => <Chip key={background} title={background}
                  selected={subtitleAppearance.background === background} onPress={() => changeSubtitleAppearance({ background })} />)}
              </Setting></>}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
function PlayerOption({ icon: Icon, label, onPress }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon size={17} color={colors.text} />
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
function Setting({ label, children }) {
  return (
    <View style={{ marginTop: 20 }}>
      <Text style={[ui.label, { marginBottom: 12 }]}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {children}
      </View>
    </View>
  );
}
