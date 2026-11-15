import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, ChevronDown, ChevronUp, Download, Monitor, Play, Volume2, X } from "lucide-react-native";
import { resolvePlayback } from "../services/api";
import { getQualityOptions, readAudioLanguages } from "../services/mediaOptions";
import { episodeHistoryStatus } from "../services/history";
import { readMediaPreferences, saveMediaPreferences } from "../services/mediaPreferences";
import { alternateAnimeAudio, animeAudioLabel, playbackProblem } from "../services/playbackErrors";
import { colors, episodeColors } from "../theme";
import { Action, IconButton } from "./Primitives";

const ANIME_AUDIO = [
  { code: "Sub", label: "Original audio", detail: "Subtitled" },
  { code: "Dub", label: "Dubbed" },
];

export default function MediaOptionsSheet({ initial, request, episodeList, history, onClose, onConfirm }) {
  const { mode, season: initialSeason, episode: initialEpisode } = initial;
  const downloading = mode === "download";
  const { width, height, fontScale } = useWindowDimensions();
  const episodic = request.type !== "movie";
  const anime = request.type === "anime";
  const [season, setSeason] = useState(initialSeason);
  const [selected, setSelected] = useState(() => new Set(initialEpisode ? [initialEpisode] : []));
  const [audio, setAudio] = useState(request.audio);
  const [language, setLanguage] = useState(null);
  const [quality, setQuality] = useState("Auto");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [available, setAvailable] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [audioOptions, setAudioOptions] = useState(null);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const seasons = [...new Set(episodeList.map(item => item.season))].sort((a, b) => a - b);
  const episodes = useMemo(() => episodeList.filter(item => item.season === season), [episodeList, season]);
  const lastPlayed = !downloading && episodeList.find(item =>
    item.season === history?.last?.season && item.number === history.last.number);
  const sample = episodic ? selected.values().next().value : 1;
  const key = preferencesReady && sample ? JSON.stringify([request.id, season, sample, audio, retry]) : null;
  const ready = !!key && available?.key === key;
  const options = ready ? available.options : [];
  const choice = options.find(item => item.label === quality) || options[0];
  const source = choice?.source;
  const checkingLanguages = !anime && source?.type === "mp4" && audioOptions?.uri !== source.uri;
  const languages = audioOptions?.uri === source?.uri ? audioOptions?.languages || [] : [];

  useEffect(() => {
    let active = true;
    readMediaPreferences(request, mode).then(preference => {
      if (!active) return;
      if (anime && ANIME_AUDIO.some(item => item.code === preference.audio)) setAudio(preference.audio);
      if (!anime && typeof preference.audioLanguage === "string") setLanguage(preference.audioLanguage);
      if (typeof preference.quality === "string" && preference.quality) setQuality(preference.quality);
      setPreferencesReady(true);
    });
    return () => { active = false; };
  }, [request, mode, anime]);

  useEffect(() => {
    if (!key) return;
    let active = true;
    const controller = new AbortController();
    let timer;
    setError(null);
    setRecovery(null);
    (async () => {
      try {
        const media = await resolvePlayback({ ...request, season, episode: sample, audio });
        if (!active) return;
        timer = setTimeout(() => controller.abort(), 7000);
        const options = await getQualityOptions(media.sources, mode, controller.signal);
        if (!options.length) throw new Error("This source is unavailable for " + (downloading ? "download." : "playback."));
        if (active) setAvailable({ key, options, subtitles: media.subtitles });
      } catch (error) {
        if (!active) return;
        const problem = playbackProblem(error);
        setAvailable({ key, options: [], error: problem });
        const fallback = problem.kind === "audio" ? alternateAnimeAudio({ ...request, audio }) : null;
        if (fallback) resolvePlayback({ ...request, season, episode: sample, audio: fallback }).then(() => {
          if (active) setRecovery({ key, audio: fallback });
        }).catch(() => {});
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, request, season, sample, audio, mode, downloading]);

  useEffect(() => {
    if (anime || !source) return;
    let active = true;
    readAudioLanguages(source).then(languages => {
      if (!active) return;
      setAudioOptions({ uri: source.uri, languages });
    });
    return () => { active = false; };
  }, [anime, source]);

  const selectEpisode = useCallback(number => {
    setError(null);
    if (!downloading) {
      setSelected(new Set([number]));
      return;
    }
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }, [downloading]);

  async function confirm() {
    if (!choice || working || checkingLanguages) return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm({
        mode, request: { ...request, season, episode: sample, audio,
          audioLanguage: languages.some(item => item.code === language) ? language : null },
        episodeNumbers: episodes.filter(item => selected.has(item.number)).map(item => item.number),
        quality: choice.label, source, subtitles: available.subtitles,
      });
    } catch (error) {
      setError(error.message);
    } finally {
      setWorking(false);
    }
  }

  const unavailable = ready && available.error;
  const allSelected = episodes.length > 0 && selected.size === episodes.length;
  const confirmTitle = downloading
    ? episodic && selected.size ? "Download " + selected.size + (selected.size === 1 ? " episode" : " episodes") : "Download"
    : episodic && sample ? "Play episode " + sample : "Play";
  const audioChoices = anime ? ANIME_AUDIO : [{ code: null, label: "Default audio" }, ...languages];
  const selectedAudio = anime ? audio : languages.some(item => item.code === language) ? language : null;
  const audioLabel = audioChoices.find(item => item.code === selectedAudio)?.label || "Default audio";
  const checkingQuality = !preferencesReady || (!!key && !ready);
  const qualityLabel = checkingQuality ? "Checking…" : choice?.label || (unavailable ? "Unavailable" : "Choose an episode");
  const optionsForField = expanded === "audio" ? audioChoices
    : options.map(option => ({ code: option.label, label: option.label }));
  const selectedFieldValue = expanded === "audio" ? selectedAudio : choice?.label;
  const loadingField = expanded === "audio" ? checkingLanguages : checkingQuality;
  const actionIcon = downloading ? Download : Play;
  const SheetIcon = actionIcon;
  const stackedFields = width < 360 || fontScale > 1.3;

  const renderEpisode = useCallback(({ item }) => {
    const checked = selected.has(item.number);
    const historyStatus = episodeHistoryStatus(history, item);
    const status = historyStatus === "lastPlayed" ? "Last played" : historyStatus === "watched" ? "Watched" : null;
    const tint = episodeColors[historyStatus];
    const label = "Episode " + item.number;
    const name = item.title && item.title !== label ? item.title : null;
    return (
      <Pressable accessibilityRole={downloading ? "checkbox" : "radio"} disabled={working}
        accessibilityLabel={[label, name, status].filter(Boolean).join(", ")}
        accessibilityState={{ checked }} onPress={() => selectEpisode(item.number)}
        style={({ pressed }) => [styles.episode, checked && styles.episodeSelected,
          tint && { backgroundColor: tint.background, borderColor: checked ? colors.accent : tint.border },
          pressed && styles.pressed]}>
        <View style={styles.episodeCopy}>
          <Text numberOfLines={1} style={[styles.episodeLabel, tint && { color: tint.text }]}>{label}</Text>
          {!!name && <Text numberOfLines={1} style={styles.episodeDetail}>{name}</Text>}
        </View>
        <SelectionMark checked={checked} square={downloading} />
      </Pressable>
    );
  }, [downloading, history, selected, selectEpisode, working]);

  function selectOption(code) {
    setError(null);
    if (expanded === "audio") {
      if (anime) {
        setAudio(code);
        saveMediaPreferences(request, mode, { audio: code });
      } else {
        setLanguage(code);
        saveMediaPreferences(request, mode, { audioLanguage: code });
      }
    } else {
      setQuality(code);
      saveMediaPreferences(request, mode, { quality: code });
    }
    setExpanded(null);
  }

  const fields = (
    <View style={[styles.fields, stackedFields && styles.stackedFields]}>
      <OptionField icon={Volume2} title="Audio" value={checkingLanguages ? "Checking…" : audioLabel}
        stacked={stackedFields} expanded={expanded === "audio"} disabled={working || !preferencesReady}
        onPress={() => setExpanded(expanded === "audio" ? null : "audio")} />
      <OptionField icon={Monitor} title="Quality" value={qualityLabel}
        stacked={stackedFields} expanded={expanded === "quality"} disabled={working}
        onPress={() => setExpanded(expanded === "quality" ? null : "quality")} />
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => {
      if (working) return;
      if (expanded) setExpanded(null);
      else onClose();
    }}>
      <View style={styles.modal}>
        <Pressable style={StyleSheet.absoluteFill} importantForAccessibility="no" disabled={working} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} accessibilityViewIsModal
          style={[styles.sheet, episodic && { height: Math.min(height * 0.9, 780) }]}>
          <View style={styles.header}>
            <View style={styles.grabber} />
            <View style={styles.headerRow}>
              <View style={styles.headerIcon}><SheetIcon size={21} color={colors.accent} /></View>
              <View style={styles.headerCopy}>
                <Text numberOfLines={1} style={styles.title}>{downloading ? "Download options" : "Play options"}</Text>
                {!!request.title && <Text numberOfLines={1} style={styles.showTitle}>{request.title}</Text>}
              </View>
              <IconButton icon={X} label="Close options" disabled={working} onPress={onClose} style={styles.close} />
            </View>
          </View>

          {episodic && !expanded ? (
            <FlatList key={season} style={styles.fill} contentContainerStyle={styles.body} data={episodes}
              keyExtractor={item => String(item.number)} renderItem={renderEpisode}
              ListHeaderComponent={<View style={styles.listHeader}>
                {fields}
                <View style={styles.episodeHeader}>
                  <View style={styles.sectionRow}>
                    <Text style={styles.sectionTitle}>Episodes</Text>
                    {downloading && (
                      <Pressable accessibilityRole="button" disabled={working || !episodes.length}
                        onPress={() => {
                          setError(null);
                          setSelected(new Set(allSelected ? [] : episodes.map(item => item.number)));
                        }}
                        style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
                        <Text style={styles.textButtonLabel}>{allSelected ? "Deselect all" : "Select all"}</Text>
                      </Pressable>
                    )}
                  </View>
                  {seasons.length > 1 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonStrip}
                      contentContainerStyle={styles.seasons}>
                      {seasons.map(value => (
                        <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: season === value }}
                          disabled={working} onPress={() => {
                            if (value === season) return;
                            setError(null);
                            setSeason(value);
                            setSelected(new Set(downloading ? [] : [episodeList.find(item => item.season === value).number]));
                          }} style={({ pressed }) => [styles.season, season === value && styles.episodeSelected, pressed && styles.pressed]}>
                          <Text style={[styles.seasonLabel, season === value && styles.seasonActive]}>Season {value}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                  {lastPlayed && lastPlayed.season !== season && (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Last played, season ${lastPlayed.season}, episode ${lastPlayed.number}`}
                      disabled={working} style={[styles.textButton, styles.lastEpisode]} onPress={() => {
                      setSeason(lastPlayed.season);
                      selectEpisode(lastPlayed.number);
                    }}>
                      <Text style={styles.lastEpisodeLabel}>Season {lastPlayed.season} · Episode {lastPlayed.number}</Text>
                    </Pressable>
                  )}
                </View>
              </View>}
            />
          ) : (
            <ScrollView style={episodic ? styles.fill : styles.shortBody} contentContainerStyle={styles.body}>
              {fields}
              {expanded && (
                <View style={styles.optionSection}>
                  <Text style={styles.sectionTitle}>{expanded === "audio" ? "Audio language" : "Video quality"}</Text>
                  {loadingField ? (
                    <View style={styles.status}>
                      <ActivityIndicator color={colors.accent} />
                      <Text style={[styles.muted, styles.wrap]}>Checking available options…</Text>
                    </View>
                  ) : optionsForField.length ? (
                    optionsForField.map(option => {
                      const checked = option.code === selectedFieldValue;
                      return (
                        <Pressable key={option.code ?? "default"} accessibilityRole="radio" accessibilityState={{ checked }}
                          disabled={working} onPress={() => selectOption(option.code)}
                          style={({ pressed }) => [styles.option, checked && styles.episodeSelected, pressed && styles.pressed]}>
                          <View style={styles.episodeCopy}>
                            <Text style={styles.episodeLabel}>{option.label}</Text>
                            {!!option.detail && <Text style={styles.episodeDetail}>{option.detail}</Text>}
                          </View>
                          <SelectionMark checked={checked} />
                        </Pressable>
                      );
                    })
                  ) : !unavailable && <Text style={styles.muted}>Select an episode to see its available qualities.</Text>}
                </View>
              )}
            </ScrollView>
          )}

          <View style={styles.footer}>
            {!!(error || unavailable) && (
              <View style={styles.errorRow}>
                <Text numberOfLines={3} style={styles.error}>{error || unavailable.message}</Text>
                {!!unavailable && (
                  <Pressable accessibilityRole="button" style={styles.textButton} onPress={() => setRetry(value => value + 1)}>
                    <Text style={styles.textButtonLabel}>Retry</Text>
                  </Pressable>
                )}
              </View>
            )}
            {unavailable && recovery?.key === key && (
              <Action secondary title={"Use " + animeAudioLabel(recovery.audio).toLowerCase()}
                onPress={() => setAudio(recovery.audio)} />
            )}
            {downloading && episodic && selected.size === 0 && !error && !unavailable && (
              <Text style={styles.hint}>Choose the episodes you want to save.</Text>
            )}
            <Action title={confirmTitle} icon={actionIcon} onPress={confirm}
              loading={working || checkingQuality || checkingLanguages} disabled={!choice} style={styles.confirm} textStyle={styles.confirmText} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function OptionField({ icon: Icon, title, value, stacked, expanded, disabled, onPress }) {
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title + ", " + value}
      accessibilityState={{ expanded, disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [
        styles.field, stacked && styles.fieldStacked, expanded && styles.episodeSelected, pressed && styles.pressed,
      ]}>
      <View style={styles.fieldTop}>
        <Icon size={16} color={colors.muted} />
        <Text style={styles.fieldTitle}>{title}</Text>
        <Chevron size={16} color={colors.muted} />
      </View>
      <Text numberOfLines={2} style={styles.fieldValue}>{value}</Text>
    </Pressable>
  );
}

function SelectionMark({ checked, square = false }) {
  return (
    <View style={[styles.mark, square && styles.square, checked && styles.markSelected]}>
      {checked && (square ? <Check size={14} strokeWidth={3} color={colors.ink} /> : <View style={styles.dot} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: "#0009", justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "92%", backgroundColor: colors.background,
    borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  header: { paddingHorizontal: 20, paddingTop: 9, paddingBottom: 16 },
  grabber: { width: 34, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 13 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.accent + "20",
    alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 21, fontWeight: "800", lineHeight: 26 },
  showTitle: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  close: { backgroundColor: colors.surface },
  fields: { gap: 12, flexDirection: "row" },
  stackedFields: { flexDirection: "column" },
  field: { flex: 1, minWidth: 0, minHeight: 68, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 9, justifyContent: "center", gap: 5, backgroundColor: colors.surface },
  fieldStacked: { flex: 0 },
  fieldTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldTitle: { flex: 1, fontSize: 12, fontWeight: "600", color: colors.muted },
  fieldValue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  shortBody: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  fill: { flex: 1, minHeight: 0 },
  listHeader: { gap: 16, marginBottom: 2 },
  episodeHeader: { gap: 8 },
  optionSection: { gap: 8 },
  sectionRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sectionTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  textButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8, borderRadius: 10, alignSelf: "flex-start" },
  textButtonLabel: { color: "#FF7784", fontSize: 13, fontWeight: "700" },
  lastEpisode: { backgroundColor: episodeColors.lastPlayed.background, borderColor: episodeColors.lastPlayed.border, borderWidth: 1 },
  lastEpisodeLabel: { color: episodeColors.lastPlayed.text, fontSize: 13, fontWeight: "700" },
  seasons: { gap: 7, alignItems: "center" },
  seasonStrip: { flexGrow: 0, flexShrink: 0 },
  season: { minHeight: 44, justifyContent: "center", borderRadius: 10, paddingHorizontal: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  seasonLabel: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  seasonActive: { color: colors.text },
  episode: { minHeight: 62, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  episodeCopy: { flex: 1, minWidth: 0, gap: 3 },
  episodeLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  episodeDetail: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  episodeSelected: { borderColor: colors.accent + "A0", backgroundColor: colors.accent + "18" },
  pressed: { opacity: 0.72 },
  option: { minHeight: 51, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { flexShrink: 0, width: 21, height: 21, borderRadius: 11, borderColor: colors.muted, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center" },
  square: { borderRadius: 5 },
  markSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink },
  status: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, gap: 7,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background },
  hint: { color: colors.muted, fontSize: 13, textAlign: "center" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { flex: 1, color: colors.error, fontSize: 13, lineHeight: 18 },
  wrap: { flexShrink: 1 },
  confirm: { borderRadius: 28 },
  confirmText: { flexShrink: 1, textAlign: "center" },
});
