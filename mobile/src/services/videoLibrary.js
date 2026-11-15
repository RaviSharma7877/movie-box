import { NativeModules, Platform } from "react-native";

const library = NativeModules.MovieBoxVideoLibrary;
export const galleryAvailable = Platform.OS === "android" && Platform.Version >= 29 && !!library;
export const galleryFolder = "Internal storage → Movies → MovieBox";

export function publishVideo(entry) {
  const episode = entry.type && entry.type !== "movie"
    ? ` - S${String(entry.season || 1).padStart(2, "0")}E${String(entry.episode || 1).padStart(2, "0")}`
    : "";
  const details = [entry.audio, entry.quality].filter(Boolean).join(" ");
  const title = (entry.title || "MovieBox video") + episode + (details ? ` (${details})` : "");
  const uri = entry.uri || entry.destUri;
  return library.publish(uri, title, entry.id, entry.kind === "hls" || /\.m3u8$/i.test(uri));
}

export const sharedVideoExists = (uri) => library.exists(uri);
export const removeSharedVideo = (uri) => library.remove(uri);
export const openSharedVideo = (uri) => library.open(uri);
