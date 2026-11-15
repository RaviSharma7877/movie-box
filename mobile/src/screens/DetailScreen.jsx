import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { ArrowLeft, Bookmark, Check, Download, Play, Search, Star } from "lucide-react-native";
import { Action, Chip, IconButton, Notice } from "../components/Primitives";
import { Artwork } from "../components/Artwork";
import MediaOptionsSheet from "../components/MediaOptionsSheet";
import { discoverCatalog, getAnimeEpisodes, getDetails } from "../services/api";
import { enqueueDownload, enqueueSeason } from "../services/downloadManager";
import { episodeHistoryStatus, getEpisodeHistory } from "../services/history";
import { getWatchlist, titleId, toggleWatchlist } from "../services/watchlist";
import { colors, episodeColors, ui } from "../theme";

const PAGE = 24;
const EMPTY = [];

export default function DetailScreen({ route, navigation }) {
  const initial = route.params.movie;
  const type = initial.category === "anime" || initial.type === "anime" ? "anime"
    : initial.type === "series" ? "series" : "movie";
  const [movie, setMovie] = useState(initial);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [detailsLoading, setDetailsLoading] = useState(type !== "movie");
  const [detailsError, setDetailsError] = useState(null);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [related, setRelated] = useState([]);
  const [picker, setPicker] = useState(null);
  const [history, setHistory] = useState({ episodes: {}, last: null });
  const mounted = useRef(false);
  const episodeList = movie.episodeList || EMPTY;
  const seasons = [...new Set(episodeList.map(e => e.season))].sort((a, b) => a - b);
  const episodes = episodeList.filter(e => e.season === season);
  const request = useMemo(() => ({
    id: movie.id,
    tmdbId: movie.tmdbId,
    title: movie.title,
    aliases: movie.aliases,
    type,
    audio: type === "anime" ? "Sub" : "English",
    posterUrl: movie.posterUrl,
  }), [movie, type]);
  const playable = type === "movie" || episodes.some(e => e.number === episode);
  const loadingEpisodes = type !== "movie" && detailsLoading;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let live = true;
    getWatchlist().then(list => { if (live) setSaved(list.some(item => titleId(item) === titleId(initial))); }).catch(() => {});
    const mode = type === "anime" ? "anime" : "movies";
    discoverCatalog(mode).then(sections => {
      if (!live) return;
      const unique = [...new Map(sections.flatMap(section => section.items).map(item => [titleId(item), item])).values()];
      const sameGenre = (item) => (item.genres || []).filter(genre => initial.genres?.includes(genre)).length;
      setRelated(unique.filter(item => titleId(item) !== titleId(initial) && item.title !== initial.title)
        .sort((a, b) => sameGenre(b) - sameGenre(a)).slice(0, 12));
    }).catch(() => {});
    return () => { live = false; };
  }, [initial, type]);

  useEffect(() => {
    let live = true;
    const fetchDetails = type === "anime" ? () => getAnimeEpisodes(initial)
      : /^tt\d+$|^tv_\d+$/.test(String(initial.id)) ? () => getDetails(initial.id) : null;
    if (!fetchDetails) { setDetailsLoading(false); return; }
    setDetailsLoading(true);
    setDetailsError(null);
    fetchDetails().then(data => {
      if (!live) return;
      setMovie(item => ({ ...item, ...data }));
      const first = data.episodeList?.[0];
      if (first) {
        setSeason(first.season);
        setEpisode(first.number);
      }
    }).catch(error => {
      if (live && type !== "movie") setDetailsError(error.message);
    }).finally(() => { if (live) setDetailsLoading(false); });
    return () => { live = false; };
  }, [initial, type, reload]);

  useFocusEffect(useCallback(() => {
    if (type === "movie" || !episodeList.length) return;
    let active = true;
    getEpisodeHistory(type, movie.id, episodeList).then(data => {
      if (active) setHistory(data);
    }).catch(() => {});
    return () => { active = false; };
  }, [type, movie.id, episodeList]));

  function openOptions(mode, number) {
    const last = mode === "play" && number === undefined && episodeList.find(item =>
      item.season === history.last?.season && item.number === history.last.number);
    setPicker({
      mode,
      season: last ? last.season : season,
      episode: last ? last.number : number === undefined ? episode : number,
    });
  }

  async function confirmOptions(selection) {
    const { request: chosen, quality, episodeNumbers, source, subtitles } = selection;
    if (selection.mode === "download") {
      const download = { ...chosen, episodeCount: episodeList.length, requireQuality: quality !== "Auto" };
      if (episodeNumbers.length > 1) await enqueueSeason(download, episodeNumbers, quality);
      else await enqueueDownload({ ...download, source, quality, subtitles });
    }
    if (!mounted.current || !navigation.isFocused()) return;
    setPicker(null);
    if (selection.mode === "play") {
      if (season !== chosen.season) { setSeason(chosen.season); setPage(0); }
      setEpisode(chosen.episode);
      navigation.navigate("Player", {
        title: movie.title, mediaRequest: { ...chosen, playbackQuality: quality }, episodeList, episodeCount: episodeList.length,
      });
    } else navigation.navigate("Downloads");
  }

  const filtered = episodes.filter(e => !query.trim() ||
    String(e.number).includes(query.trim()) || e.title?.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.ceil(filtered.length / PAGE);
  const visibleEpisodes = filtered.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Artwork uri={movie.backdropUrl} fallback={movie.posterUrl} shade fadeToBackground />
          <IconButton icon={ArrowLeft} label="Go back" onPress={() => navigation.goBack()} style={styles.back} />
        </View>
        <View style={styles.content}>
          <View style={ui.between}>
            <Text style={styles.title}>{movie.title}</Text>
            <IconButton icon={saved ? Check : Bookmark} label={saved ? "Remove from My List" : "Add to My List"}
              onPress={() => toggleWatchlist(initial).then(setSaved).catch(error => Alert.alert("Could not update My List", error.message))}
              style={{ backgroundColor: "transparent" }} />
          </View>
          <View style={[ui.row, { flexWrap: "wrap" }]}>
            {movie.rating > 0 && (
              <View style={[ui.row, { gap: 5 }]}>
                <Star size={16} color="#FF6373" fill="#FF6373" />
                <Text style={{ color: "#FF6373", fontWeight: "700" }}>{Number(movie.rating).toFixed(1)}</Text>
              </View>
            )}
            {!!movie.year && <Text style={ui.body}>{movie.year}</Text>}
            <Text style={styles.format}>{movie.format || (type === "series" ? "Series" : type === "anime" ? "Anime" : "Movie")}</Text>
            {episodeList.length > 0 && <Text style={ui.body}>{episodeList.length} episodes</Text>}
          </View>
          <View style={styles.actions}>
            <Action title="Play" icon={Play} disabled={!playable} loading={loadingEpisodes}
              onPress={() => openOptions("play")} style={styles.pill} />
            <Action title="Download" icon={Download} secondary disabled={!playable} loading={loadingEpisodes}
              onPress={() => openOptions("download")} style={[styles.pill, styles.outline]} />
          </View>
          {movie.genres?.length > 0 && <View style={styles.genres}>{movie.genres.map(genre => (
            <Text key={genre} style={styles.genre}>{genre}</Text>
          ))}</View>}
          {!!movie.description && <Text style={ui.body}>{movie.description}</Text>}
          {type !== "movie" && (
            <View style={styles.episodes}>
              <View style={ui.between}>
                <Text style={ui.heading}>Episodes</Text>
                {detailsLoading && <ActivityIndicator color={colors.accent} />}
                {!!episodes.length && <View style={styles.search}>
                  <Search size={17} color={colors.muted} />
                  <TextInput accessibilityLabel="Search episodes" value={query} placeholder="Find episode"
                    placeholderTextColor={colors.muted} onChangeText={value => { setQuery(value); setPage(0); }}
                    style={{ color: colors.text, flex: 1, minHeight: 44 }} />
                </View>}
              </View>
              {seasons.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {seasons.map(value => <Chip key={value} title={"Season " + value} selected={season === value} onPress={() => {
                  setSeason(value);
                  setEpisode(episodeList.find(item => item.season === value).number);
                  setPage(0);
                }} />)}
              </ScrollView>}
              {detailsError && <Notice title="Episodes unavailable" message={detailsError} action="Retry" onAction={() => setReload(n => n + 1)} />}
              {!detailsLoading && !detailsError && !episodeList.length && <Text style={ui.body}>There are no released episodes in the catalog yet.</Text>}
              {!!episodes.length && <Action title={type === "anime" ? "Download season" : "Download season " + season}
                icon={Download} secondary onPress={() => openOptions("download", null)} />}
              {pageCount > 1 && <View style={[ui.between, { gap: 6 }]}>
                <Action title="Previous" secondary disabled={page === 0} onPress={() => setPage(n => n - 1)} />
                <Text style={ui.body}>{page + 1} / {pageCount}</Text>
                <Action title="Next" secondary disabled={page + 1 === pageCount} onPress={() => setPage(n => n + 1)} />
              </View>}
              {query.trim() && !filtered.length && <Text style={ui.body}>No episodes match your search.</Text>}
              <View style={styles.episodeGrid}>{visibleEpisodes.map(item => {
                const status = episodeHistoryStatus(history, item);
                const tint = episodeColors[status];
                const label = "Play episode " + item.number +
                  (status === "lastPlayed" ? ", last played" : status === "watched" ? ", watched" : "");
                return <View key={item.number} style={styles.episodeCard}>
                  <Pressable accessibilityRole="button" accessibilityLabel={label}
                    onPress={() => openOptions("play", item.number)}
                    style={[styles.episodeArt, tint && { borderColor: tint.border }]}>
                    <Artwork uri={item.thumbnail || movie.backdropUrl} fallback={movie.posterUrl} shade />
                    <View style={styles.playCircle}><Play size={18} color="#252428" fill="#252428" /></View>
                    <Text numberOfLines={1} style={[styles.episodeNumber, tint && { color: tint.text }]}>Episode {item.number}</Text>
                  </Pressable>
                  <View style={ui.between}>
                    <Text numberOfLines={1} style={[styles.episodeTitle, { flex: 1 }, tint && { color: tint.text }]}>{item.title}</Text>
                    <IconButton icon={Download} label={"Download episode " + item.number}
                      onPress={() => openOptions("download", item.number)} />
                  </View>
                </View>;
              })}</View>
            </View>
          )}
          {!!related.length && <View style={{ gap: 12, marginTop: 8 }}>
            <Text style={ui.heading}>More like this</Text>
            <FlatList horizontal data={related} keyExtractor={titleId} showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10 }} renderItem={({ item }) => (
                <Pressable accessibilityRole="button" accessibilityLabel={item.title}
                  onPress={() => navigation.push("Detail", { movie: item })} style={{ width: 105 }}>
                  <View style={styles.relatedPoster}><Artwork uri={item.posterUrl} /></View>
                  <Text numberOfLines={2} style={styles.episodeTitle}>{item.title}</Text>
                </Pressable>
              )} />
          </View>}
        </View>
      </ScrollView>
      {picker && <MediaOptionsSheet initial={picker} request={request} episodeList={episodeList}
        history={history} onClose={() => setPicker(null)} onConfirm={confirmOptions} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { height: 260, backgroundColor: colors.surface },
  back: { position: "absolute", top: 12, left: 16, backgroundColor: "#222126AC" },
  content: { paddingHorizontal: 16, gap: 15, marginTop: -4 },
  title: { flex: 1, color: colors.text, fontSize: 26, lineHeight: 31, fontWeight: "800" },
  format: { borderColor: "#FF6373", color: "#FF6373", paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: 8, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10 },
  pill: { borderRadius: 30, paddingHorizontal: 8, flex: 1 },
  outline: { borderWidth: 1, borderColor: colors.muted, backgroundColor: "transparent" },
  genres: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  genre: { backgroundColor: colors.surface, color: colors.muted, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  episodes: { gap: 12, marginTop: 13 },
  row: { flexDirection: "row", gap: 8 },
  search: { maxWidth: 166, flex: 1, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 10 },
  episodeGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 13 },
  episodeCard: { width: "48%" },
  episodeArt: { aspectRatio: 1.6, borderRadius: 10, overflow: "hidden", justifyContent: "center", alignItems: "center",
    borderWidth: 2, borderColor: "transparent" },
  playCircle: { padding: 9, borderRadius: 24, backgroundColor: "#FFFFFFDC" },
  episodeNumber: { color: colors.text, position: "absolute", bottom: 7, left: 9, fontWeight: "700", fontSize: 12 },
  episodeTitle: { color: colors.text, fontSize: 12, paddingVertical: 5 },
  relatedPoster: { aspectRatio: 0.67, borderRadius: 10, overflow: "hidden" },
});
