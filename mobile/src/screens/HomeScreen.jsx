import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { ArrowLeft, Bookmark, Check, Download, Film, Home, Play, Plus, Search, Shapes, X } from "lucide-react-native";
import { browseGenre, discoverCatalog, listGenres, searchCatalog } from "../services/api";
import { getContinueWatching } from "../services/history";
import { getQueue } from "../services/downloadManager";
import { episodeLabel } from "../services/playerEpisodes";
import { findSavedVideo, savedPlaybackParams } from "../services/savedPlayback";
import { getWatchlist, titleId, toggleWatchlist } from "../services/watchlist";
import { Action, IconButton, Notice } from "../components/Primitives";
import { Artwork } from "../components/Artwork";
import { colors, ui } from "../theme";

const TABS = [
  { name: "Home", icon: Home },
  { name: "Genres", icon: Shapes },
  { name: "My List", icon: Bookmark },
  { name: "Downloads", icon: Download },
];
const EMPTY = [];
const GENRE_COLORS = ["#724060", "#355864", "#51416B", "#795044", "#35594E"];

function Poster({ item, onPress, rank, width }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={onPress}
      style={{ width, paddingLeft: rank ? 27 : 0 }}>
      {!!rank && <Text style={styles.rank}>{rank}</Text>}
      <View style={styles.poster}>
        <Film size={26} color={colors.muted} />
        {item.posterUrl && <Artwork uri={item.posterUrl} shade />}
        <Text style={styles.badge}>{item.format || (item.type === "series" ? "Series" : item.type === "anime" ? "Anime" : "Movie")}</Text>
        {item.episodes > 0 && item.type === "anime" && (
          <Text style={styles.episodeBadge}>{item.episodes} ep</Text>
        )}
      </View>
      <Text numberOfLines={2} style={styles.posterTitle}>{item.title}</Text>
    </Pressable>
  );
}

function Rail({ section, ranked, open, onAll }) {
  return (
    <View style={styles.rail}>
      <View style={[ui.between, styles.railHeader]}>
        <Text style={ui.heading}>{section.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={"See all " + section.title} onPress={onAll} style={styles.seeAll}>
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railItems}>
        {section.items.slice(0, 12).map((item, index) => (
          <Poster key={titleId(item)} item={item} width={ranked ? 150 : 105}
            rank={ranked ? index + 1 : null} onPress={() => open(item)} />
        ))}
      </ScrollView>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState("movies");
  const [tab, setTab] = useState("Home");
  const [section, setSection] = useState(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [catalogs, setCatalogs] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [reload, setReload] = useState(0);
  const [searchReload, setSearchReload] = useState(0);
  const [genreLists, setGenreLists] = useState({});
  const [genreError, setGenreError] = useState(null);
  const [genreResults, setGenreResults] = useState(null);
  const [genreLoading, setGenreLoading] = useState(false);
  const [genreReload, setGenreReload] = useState(0);
  const [continuing, setContinuing] = useState([]);
  const [opening, setOpening] = useState(null);
  const openingRef = useRef(false);
  const [saved, setSaved] = useState([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const searchInput = useRef(null);
  const sections = catalogs[mode] || EMPTY;
  const featured = sections[0]?.items.filter(item => item.backdropUrl || item.posterUrl).slice(0, 7) || [];
  const hero = featured[heroIndex] || featured[0];
  const heroSaved = !!hero && saved.some(item => titleId(item) === titleId(hero));
  const open = item => navigation.navigate("Detail", { movie: item });
  async function resume(item) {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(item.key);
    try {
      const local = await getQueue().then(queue => findSavedVideo(queue, item.request)).catch(() => null);
      if (navigation.isFocused()) navigation.navigate("Player", {
        title: item.title, mediaRequest: item.request, episodeCount: item.episodeCount,
        ...(local && savedPlaybackParams(local, item.request)),
      });
    } finally {
      openingRef.current = false;
      setOpening(null);
    }
  }

  useFocusEffect(useCallback(() => {
    let focused = true;
    getContinueWatching().then(list => { if (focused) setContinuing(list); }).catch(() => {});
    getWatchlist().then(list => { if (focused) setSaved(list); }).catch(() => {});
    return () => { focused = false; };
  }, []));

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    discoverCatalog(mode, { fresh: reload > 0 }).then(sections => {
      if (live) setCatalogs(prev => ({ ...prev, [mode]: sections }));
    }).catch(error => {
      if (live) setError(error.message);
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mode, reload]);

  useEffect(() => {
    let live = true;
    setSearchError(null);
    setResults([]);
    if (!searching || !query.trim()) {
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      searchCatalog(mode, query).then(items => { if (live) setResults(items); })
        .catch(error => { if (live) setSearchError(error.message); })
        .finally(() => { if (live) setSearchLoading(false); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [mode, query, searching, searchReload]);

  const genreArtwork = useMemo(() => {
    const items = new Map();
    const byGenre = new Map();
    for (const section of sections) for (const item of section.items) items.set(titleId(item), item);
    for (const item of items.values()) for (const genre of item.genres || []) {
      if (!byGenre.has(genre)) byGenre.set(genre, []);
      byGenre.get(genre).push(item);
    }
    return byGenre;
  }, [sections]);
  const genres = genreLists[mode] || EMPTY;
  const genreId = section?.genreId;

  useEffect(() => {
    if (tab !== "Genres" || genreLists[mode]) return;
    let live = true;
    setGenreError(null);
    listGenres(mode).then(data => {
      if (live) setGenreLists(prev => ({ ...prev, [mode]: [...data].sort((a, b) => a.name.localeCompare(b.name)) }));
    }).catch(error => { if (live) setGenreError(error.message); });
    return () => { live = false; };
  }, [tab, mode, genreLists, genreReload]);

  useEffect(() => {
    setGenreResults(null);
    if (!genreId) return;
    let live = true;
    setGenreLoading(true);
    setGenreError(null);
    browseGenre(mode, genreId).then(data => { if (live) setGenreResults(data); })
      .catch(error => { if (live) setGenreError(error.message); })
      .finally(() => { if (live) setGenreLoading(false); });
    return () => { live = false; };
  }, [mode, genreId, genreReload]);

  function selectMode(next) {
    if (next === mode) return;
    setMode(next);
    setSection(null);
    setHeroIndex(0);
    setResults([]);
  }

  function selectTab(name) {
    if (name === "Downloads") {
      navigation.navigate("Downloads");
      return;
    }
    setTab(name);
    setSearching(false);
    setQuery("");
    setSection(null);
  }

  const refresh = <RefreshControl refreshing={loading} onRefresh={() => setReload(n => n + 1)} tintColor={colors.accent} colors={[colors.accent]} />;
  const emptyCatalog = !sections.length && (loading
    ? <ActivityIndicator style={styles.loading} color={colors.accent} />
    : <View style={styles.inset}><Notice title="Catalog unavailable" message={error || "There are no titles to show yet."} action="Retry" onAction={() => setReload(n => n + 1)} /></View>);
  const readingGrid = searching || !!section || tab === "My List";
  const gridItems = searching ? results : genreId ? genreResults || EMPTY : section?.items || saved.filter(item => item.category === mode);
  const gridWidth = (width - 56) / 3;

  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={[ui.between, styles.header]}>
        {searching ? (
          <>
            <IconButton icon={ArrowLeft} label="Close search" onPress={() => { setSearching(false); setQuery(""); }} />
            <TextInput ref={searchInput} autoFocus accessibilityLabel="Search titles"
              placeholder={mode === "anime" ? "Search anime" : "Search movies, series, and dramas"}
              placeholderTextColor={colors.muted} value={query} onChangeText={setQuery}
              returnKeyType="search" style={styles.search} />
            {query.length > 0 && <IconButton icon={X} label="Clear search" onPress={() => { setQuery(""); searchInput.current?.focus(); }} />}
          </>
        ) : (
          <>
            {section && <IconButton icon={ArrowLeft} label="Back to catalog" onPress={() => setSection(null)} />}
            {tab === "Home" && !section ? (
              <Text style={styles.wordmark}>Movie<Text style={{ color: colors.accent }}>Box</Text></Text>
            ) : <Text numberOfLines={1} style={[ui.heading, { flex: 1 }]}>{section?.title || tab}</Text>}
            <View style={[ui.row, { gap: 4 }]}>
              <IconButton icon={Search} label="Search" onPress={() => setSearching(true)} style={styles.headerIcon} />
              <IconButton icon={Download} label="Open downloads" onPress={() => navigation.navigate("Downloads")} style={styles.headerIcon} />
            </View>
          </>
        )}
      </View>

      <View style={styles.switcher} accessibilityRole="tablist">
        {[["movies", "Movies"], ["anime", "Anime"]].map(([value, label]) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }}
            onPress={() => selectMode(value)} style={[styles.switchOption, mode === value && styles.switchActive]}>
            <Text style={{ color: mode === value ? colors.ink : colors.muted, fontWeight: "700" }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {readingGrid ? (
        <FlatList
          key="poster-grid" data={gridItems} numColumns={3} keyExtractor={titleId}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.grid}
          renderItem={({ item }) => <Poster item={item} width={gridWidth} onPress={() => open(item)} />}
          ListEmptyComponent={(searching && searchLoading) || (genreId && genreLoading)
            ? <ActivityIndicator style={styles.loading} color={colors.accent} />
            : <Notice title={searching ? (searchError ? "Search unavailable" : query.trim() ? "No results" : "Find a title") : genreId ? "No titles to show" : "Your list is empty"}
              message={searching ? (searchError || (query.trim() ? "Try a different title or switch catalogs." : "Enter a movie, show, or anime title."))
                : genreId ? genreError || "This genre has no titles available." : "Save a title to find it here."}
              action={(searching && searchError) || (genreId && genreError) ? "Retry" : undefined}
              onAction={() => searching ? setSearchReload(n => n + 1) : setGenreReload(n => n + 1)} />}
        />
      ) : tab === "Genres" ? (
        <FlatList
          key={"genres-" + mode} data={genres} numColumns={2} keyExtractor={genre => genre.id}
          contentContainerStyle={styles.grid} columnWrapperStyle={styles.gridRow}
          ListEmptyComponent={genreError ? <Notice title="Genres unavailable" message={genreError} action="Retry"
            onAction={() => setGenreReload(n => n + 1)} /> : <ActivityIndicator style={styles.loading} color={colors.accent} />}
          renderItem={({ item: genre, index }) => {
            const art = genreArtwork.get(genre.name)?.[0];
            return <Pressable accessibilityRole="button" accessibilityLabel={genre.name}
              onPress={() => setSection({ title: genre.name, genreId: genre.id })}
              style={[styles.genre, { width: (width - 46) / 2, backgroundColor: GENRE_COLORS[index % GENRE_COLORS.length] }]}>
              {art ? <Artwork uri={art.backdropUrl} fallback={art.posterUrl} shade /> :
                <Text style={styles.genreInitial} accessible={false}>{genre.name[0]}</Text>}
              <Text style={styles.genreText}>{genre.name}</Text>
            </Pressable>;
          }}
        />
      ) : (
        <ScrollView key={"home-" + mode} refreshControl={refresh} contentContainerStyle={{ paddingBottom: 95 }}>
          {emptyCatalog}
          {!!hero && (
            <View style={[styles.hero, { height: Math.min(455, Math.max(305, height * 0.49)) }]}>
              <Artwork uri={hero.backdropUrl} fallback={hero.posterUrl} shade fadeToBackground />
              <View style={styles.heroText}>
                <Text style={styles.heroTitle} numberOfLines={2}>{hero.title}</Text>
                <Text numberOfLines={1} style={styles.heroMeta}>{hero.genres?.slice(0, 3).join(" · ") || [hero.format, hero.year].filter(Boolean).join(" · ")}</Text>
                <View style={ui.row}>
                  <Action title={hero.type === "movie" ? "Play" : "Episodes"} icon={Play} onPress={() => {
                    if (hero.type === "movie") navigation.navigate("Player", {
                      title: hero.title, mediaRequest: { ...hero, season: 1, episode: 1, audio: "English" },
                    });
                    else open(hero);
                  }} style={styles.pill} />
                  <Action title="My List" icon={heroSaved ? Check : Plus} secondary style={styles.outline}
                    onPress={() => toggleWatchlist(hero).then(getWatchlist).then(setSaved).catch(() => {})} />
                </View>
              </View>
              {featured.length > 1 && <View style={styles.dots}>
                {featured.map((item, index) => (
                  <Pressable key={titleId(item)} accessibilityRole="button" accessibilityLabel={"Feature " + item.title}
                    accessibilityState={{ selected: index === heroIndex }} onPress={() => setHeroIndex(index)}
                    hitSlop={4} style={styles.dotTarget}>
                    <View style={[styles.dot, index === heroIndex && styles.dotActive]} />
                  </Pressable>
                ))}
              </View>}
            </View>
          )}
          {continuing.some(item => (item.request.type === "anime") === (mode === "anime")) && (
            <View style={styles.rail}>
              <View style={styles.railHeader}><Text style={ui.heading}>Continue watching</Text></View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railItems}>
                {continuing.filter(item => (item.request.type === "anime") === (mode === "anime")).map(item => {
                  const progress = item.duration > 0 ? Math.max(0, Math.min(1, item.position / item.duration)) : 0;
                  const episode = episodeLabel(item.request);
                  return (
                  <Pressable key={item.key} onPress={() => resume(item)} accessibilityRole="button"
                    accessibilityState={{ busy: opening === item.key }}
                    accessibilityLabel={[item.upNext ? "Up next" : "Continue", item.title, episode].filter(Boolean).join(", ")}
                    style={styles.continueCard}>
                    <Artwork uri={item.request.posterUrl} shade />
                    {opening === item.key ? <ActivityIndicator color={colors.text} /> : <Play size={18} color={colors.text} />}
                    <Text style={styles.posterTitle} numberOfLines={2}>{item.title}</Text>
                    {!!episode && <Text style={styles.continueEpisode} numberOfLines={1}>{item.upNext ? "Up next · " : ""}{episode}</Text>}
                    {!item.upNext && progress > 0 && <View style={styles.continueTrack}>
                      <View style={[styles.continueProgress, { width: progress * 100 + "%" }]} />
                    </View>}
                  </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
          {sections.map((item, index) => (
            <Rail key={item.title} section={item} ranked={index === 0} open={open} onAll={() => setSection(item)} />
          ))}
        </ScrollView>
      )}

      {!searching && (
        <View style={[styles.dock, !readingGrid && tab !== "Genres" && styles.dockFloating]}>
          {TABS.map(({ name, icon: Icon }) => {
            const selected = tab === name;
            return (
              <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected }}
                onPress={() => selectTab(name)} style={[styles.tab, selected && styles.tabActive]}>
                <Icon size={20} color={selected ? colors.text : colors.muted} />
                <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: selected ? colors.text : colors.muted }}>{name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, minHeight: 58, gap: 8 },
  wordmark: { color: colors.text, fontSize: 31, fontWeight: "900", letterSpacing: -1.4 },
  headerIcon: { backgroundColor: "transparent" },
  search: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: 22, minHeight: 46, paddingHorizontal: 14 },
  switcher: { marginHorizontal: 16, marginTop: 5, marginBottom: 10, borderRadius: 24, flexDirection: "row", padding: 3, backgroundColor: colors.surface },
  switchOption: { flex: 1, minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  switchActive: { backgroundColor: colors.accent },
  hero: { justifyContent: "flex-end", paddingHorizontal: 17 },
  heroText: { gap: 9, paddingBottom: 5 },
  heroTitle: { color: colors.text, fontSize: 30, fontWeight: "800", lineHeight: 34, textShadowColor: "#000", textShadowRadius: 5 },
  heroMeta: { color: colors.muted, fontSize: 14, fontWeight: "600", marginBottom: 4 },
  pill: { borderRadius: 30, minWidth: 104 },
  outline: { borderRadius: 30, backgroundColor: "#23222688", borderColor: colors.muted, borderWidth: 1 },
  dots: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center" },
  dotTarget: { width: 21, height: 44, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 4, backgroundColor: colors.muted },
  dotActive: { backgroundColor: colors.accent, width: 9, height: 9, borderRadius: 5 },
  rail: { marginTop: 17, marginBottom: 14 },
  railHeader: { marginHorizontal: 16, minHeight: 44, marginBottom: 5 },
  seeAll: { minHeight: 44, paddingHorizontal: 4, justifyContent: "center" },
  link: { color: "#FF6373", fontWeight: "700", fontSize: 14 },
  railItems: { paddingHorizontal: 16, gap: 10 },
  rank: { position: "absolute", left: -4, bottom: 25, fontSize: 86, fontWeight: "900", color: "#77747C" },
  poster: { aspectRatio: 0.67, borderRadius: 10, overflow: "hidden", backgroundColor: colors.surface, justifyContent: "center", alignItems: "center" },
  badge: { position: "absolute", top: 5, left: 5, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, backgroundColor: "#161519DD", color: colors.text, fontSize: 10, fontWeight: "700" },
  episodeBadge: { position: "absolute", bottom: 5, left: 5, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, backgroundColor: "#B2DBB4", color: "#19281D", fontSize: 10, fontWeight: "800" },
  posterTitle: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 7, lineHeight: 17 },
  continueCard: { width: 178, minHeight: 118, justifyContent: "flex-end", padding: 12, borderRadius: 12, overflow: "hidden" },
  continueEpisode: { color: colors.muted, fontSize: 12, marginTop: 4 },
  continueTrack: { height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: colors.border, marginTop: 9 },
  continueProgress: { height: 3, backgroundColor: colors.accent },
  grid: { padding: 16, paddingBottom: 20 },
  gridRow: { gap: 12, marginBottom: 15 },
  genre: { height: 99, borderRadius: 12, overflow: "hidden", justifyContent: "flex-end", padding: 12 },
  genreText: { color: colors.text, fontWeight: "800", fontSize: 17 },
  genreInitial: { position: "absolute", color: "#FFFFFF20", fontSize: 72, fontWeight: "900", right: 8, top: -6 },
  dock: { flexDirection: "row", marginHorizontal: 15, marginBottom: 5, padding: 5, backgroundColor: "#39383DEB", borderWidth: 1, borderColor: colors.border, borderRadius: 34 },
  dockFloating: { position: "absolute", left: 0, right: 0, bottom: 8 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 49, gap: 3, borderRadius: 25 },
  tabActive: { backgroundColor: "#535159" },
  loading: { marginTop: 32 },
  inset: { margin: 16 },
});
