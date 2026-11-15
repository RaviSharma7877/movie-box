import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Image, Alert, AppState, Pressable } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCw,
  Trash2,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from "lucide-react-native";
import { useDownloadQueue } from "../hooks/useDownloadQueue";
import { Action, IconButton, Chip, Notice } from "../components/Primitives";
import { colors, ui } from "../theme";
import * as FileSystem from "expo-file-system";
import { getDownloadConcurrency, reconcileSharedDownloads, retryGalleryVideo, setDownloadConcurrency } from '../services/downloadManager';
import { galleryAvailable, galleryFolder, openSharedVideo, sharedVideoExists } from '../services/videoLibrary';
import { groupSavedDownloads, formatStorage } from "../services/savedDownloadGroups";
export default function DownloadsScreen({ navigation }) {
  const { queue, pause, resume, remove } = useDownloadQueue();
  const [tab, setTab] = useState("Saved");
  const [simultaneous, setSimultaneous] = useState(1);
  const [expanded, setExpanded] = useState({});
  useEffect(() => { getDownloadConcurrency().then(setSimultaneous).catch(console.warn); }, []);
  useFocusEffect(useCallback(() => {
    if (!galleryAvailable) return;
    const refresh = () => reconcileSharedDownloads().catch(console.warn);
    refresh();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    return () => subscription.remove();
  }, []));
  async function changeConcurrency(value) {
    try { await setDownloadConcurrency(value); setSimultaneous(value); }
    catch (e) { Alert.alert('Couldn’t save setting', e.message); }
  }
  const saved = useMemo(() => queue.filter(e => e.status === "done"), [queue]);
  const groups = useMemo(() => groupSavedDownloads(saved), [saved]);
  const items = tab === "Transfers" ? queue.filter(e => e.status !== "done") : groups.flatMap(item =>
    item.group && expanded[item.id] ? [item, ...item.episodes.map(episode => ({ ...episode, grouped: true }))] : [item]
  );
  const storage = saved.reduce((total, item) => total + (Number(item.fileSize) || 0), 0);
  async function play(item) {
    const uri = item.uri || item.destUri;
    const exists = item.galleryUri
      ? await sharedVideoExists(item.galleryUri)
      : (await FileSystem.getInfoAsync(uri)).exists;
    if (!exists) {
      if (item.galleryUri) await reconcileSharedDownloads(new Set([item.id]));
      Alert.alert(
        "File not found",
        "This video was removed from the device. You can download it again from its title page.",
      );
      return;
    }
    navigation.navigate("Player", {
      title: item.title,
      streamUrl: uri,
      subtitlesUri: item.subtitlesUri,
      episodeCount: item.episodeCount,
      mediaRequest: {
        id: item.movieId,
        title: item.title,
        type: item.type,
        season: item.season,
        episode: item.episode,
        audio: item.audio,
        audioLanguage: item.audioLanguage,
        posterUrl: item.posterUrl,
      },
    });
  }
  const safely = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => Alert.alert("Couldn’t update download", e.message));
  async function openElsewhere(item) {
    if (!await sharedVideoExists(item.galleryUri)) {
      await reconcileSharedDownloads(new Set([item.id]));
      Alert.alert("File not found", "This video is no longer in the MovieBox folder.");
      return;
    }
    await openSharedVideo(item.galleryUri);
  }
  function deleteItem(item) {
    Alert.alert(
      "Delete download?",
      "Remove “" + item.title + "” from this device?",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => safely(() => remove(item.id)),
        },
      ],
    );
  }
  return (
    <SafeAreaView style={ui.screen}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
        ListHeaderComponent={
          <View>
            <View style={[ui.row, { marginBottom: 28 }]}>
              <IconButton
                icon={ArrowLeft}
                label="Go back"
                onPress={() => navigation.goBack()}
              />
              <Text style={ui.title}>Your library</Text>
            </View>
            <View style={[ui.card, { marginBottom: 24, gap: 8 }]}>
              <Download color={colors.accent} size={24} />
              <Text style={ui.heading}>
                {saved.length} {saved.length === 1 ? "video" : "videos"} saved
              </Text>
              {storage > 0 && <Text style={ui.body}>{formatStorage(storage)} used</Text>}
              {galleryAvailable && (
                <View style={{ gap: 4, marginTop: 6 }}>
                  <Text style={ui.heading}>Download folder</Text>
                  <Text selectable style={ui.body}>{galleryFolder}</Text>
                  <Text style={[ui.body, { fontSize: 12 }]}>Find finished videos in your Gallery or video player.</Text>
                </View>
              )}
              {queue.some((e) => e.status === "downloading") && (
                <Text style={[ui.body, { fontSize: 12 }]}>
                  Downloads continue in the background. Check progress in your phone’s notifications.
                </Text>
              )}
            </View>
            <View style={[ui.card, { marginBottom: 24, gap: 12 }]}>
              <Text style={ui.heading}>Simultaneous downloads</Text>
              <View style={[ui.row, { flexWrap: 'wrap', gap: 8 }]}>
                {[1, 2, 3, 4, 5].map(n => <Chip key={n} title={String(n)} selected={simultaneous === n} onPress={() => changeConcurrency(n)} />)}
              </View>
              <Text style={[ui.body, { fontSize: 12 }]}>Default: 1. Maximum: 5. Lower limits take effect as active downloads finish.</Text>
            </View>
            <View style={[ui.row, { marginBottom: 24 }]}>
              {["Saved", "Transfers"].map((t) => (
                <Chip
                  key={t}
                  title={
                    t +
                    (t === "Transfers"
                      ? " · " + queue.filter((e) => e.status !== "done").length
                      : "")
                  }
                  selected={tab === t}
                  onPress={() => setTab(t)}
                />
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => item.group ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: !!expanded[item.id] }}
            style={[ui.card, ui.row, { padding: 16 }]}
            onPress={() => setExpanded(previous => ({ ...previous, [item.id]: !previous[item.id] }))}>
            {!!item.posterUrl && <Image source={{ uri: item.posterUrl }} style={{ width: 52, height: 74, borderRadius: 8 }} />}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={ui.heading}>{item.title}</Text>
              <Text style={ui.body}>Season {item.season} · {item.ready} of {item.count} ready</Text>
              {item.storage > 0 && <Text style={ui.body}>{formatStorage(item.storage)}</Text>}
            </View>
            {expanded[item.id] ? <ChevronDown size={21} color={colors.muted} /> : <ChevronRight size={21} color={colors.muted} />}
          </Pressable>
        ) : (
          <View style={[ui.card, { padding: 16 }]}>
            <View style={[ui.row, { alignItems: "flex-start" }]}>
              {item.posterUrl && !item.grouped && (
                <Image
                  source={{ uri: item.posterUrl }}
                  style={{ width: 64, height: 92, borderRadius: 10 }}
                />
              )}
              <View style={{ flex: 1, gap: 6 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 17,
                    fontWeight: "600",
                    lineHeight: 23,
                  }}
                >
                  {item.grouped ? "Episode " + item.episode : item.title}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {item.type !== "movie" && !item.grouped
                    ? "S" +
                      (item.season || 1) +
                      " · E" +
                      (item.episode || 1) +
                      " · "
                    : ""}
                  {item.audio || "Default"} · {item.quality || "Auto"}
                </Text>
                <Text
                  style={{
                    color:
                      item.status === "error" ? colors.error : colors.accent,
                    fontSize: 12,
                  }}
                >
                  {item.status === "done"
                    ? (item.fileSize ? formatStorage(item.fileSize) + " · " : "") + "Ready offline"
                    : item.status === "downloading"
                      ? Math.round(item.progress * 100) + "% downloaded"
                      : item.status === "queued"
                        ? "Waiting to download"
                      : item.status === "paused"
                        ? "Paused"
                        : item.error || "Download interrupted"}
                </Text>
                {item.status === "done" && galleryAvailable && (
                  <Text style={[ui.body, { fontSize: 12 }]}>
                    {item.galleryUri ? "In Movies / MovieBox"
                      : item.galleryPending ? "Preparing for Gallery…"
                        : item.galleryError ? "Saved offline in MovieBox. Couldn’t add to Gallery."
                          : "Saved in MovieBox · Moving to Gallery soon"}
                  </Text>
                )}
              </View>
            </View>
            {item.status !== "done" && (
              <View
                style={{
                  height: 4,
                  backgroundColor: colors.border,
                  borderRadius: 2,
                  marginTop: 18,
                }}
              >
                <View
                  style={{
                    width: Math.min(100, (item.progress || 0) * 100) + "%",
                    height: 4,
                    backgroundColor: colors.accent,
                    borderRadius: 2,
                  }}
                />
              </View>
            )}
            <View style={[ui.row, { marginTop: 16 }]}>
              <Action
                secondary
                disabled={item.galleryPending}
                loading={item.galleryPending}
                style={{ flex: 1 }}
                title={
                  item.status === "done"
                    ? "Play"
                    : (item.status === "downloading" || item.status === "queued")
                      ? "Pause"
                      : item.status === "error"
                        ? "Try again"
                        : "Resume"
                }
                icon={
                  item.status === "done"
                    ? Play
                    : (item.status === "downloading" || item.status === "queued")
                      ? Pause
                      : RotateCw
                }
                onPress={() =>
                  safely(() =>
                    item.status === "done"
                      ? safely(() => play(item))
                      : (item.status === "downloading" || item.status === "queued")
                        ? pause(item.id)
                        : resume(item.id),
                  )
                }
              />
              {!item.galleryPending && <IconButton
                icon={Trash2}
                label={"Delete " + item.title}
                onPress={() => deleteItem(item)}
              />}
            </View>
            {item.galleryUri && (
              <Action secondary title="Open in another app" icon={ExternalLink}
                style={{ marginTop: 10 }} onPress={() => safely(() => openElsewhere(item))} />
            )}
            {item.galleryError && !item.galleryPending && (
              <Action secondary title="Retry saving to Gallery" icon={RotateCw}
                style={{ marginTop: 10 }} onPress={() => safely(() => retryGalleryVideo(item.id))} />
            )}
          </View>
        )}
        ListEmptyComponent={
          <Notice
            title={
              tab === "Saved"
                ? "Make room for a good film"
                : "No transfers in progress"
            }
            message={
              tab === "Saved"
                ? "Open a title and choose Save for offline. Downloadable titles will appear here."
                : "Your active and paused downloads will appear here."
            }
            action="Explore titles"
            onAction={() => navigation.navigate("Home")}
          />
        }
      />
    </SafeAreaView>
  );
}
