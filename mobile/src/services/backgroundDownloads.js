import { NativeModules, PermissionsAndroid, Platform } from "react-native";

const bridge = NativeModules.MovieBoxDownloads;
export const backgroundAvailable = Platform.OS === "android" && !!bridge;

export async function startDownloadService({ requestNotifications = true } = {}) {
  if (!backgroundAvailable) return;
  if (requestNotifications && Platform.Version >= 33 && !await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)) {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
      title: "Download notifications",
      message: "Show download progress while MovieBox is closed or your phone is locked.",
      buttonPositive: "Allow",
      buttonNegative: "Not now",
    });
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Allow download notifications in Android settings to start background downloads.");
  }
  await bridge.start();
}
export function downloadNotification(text, percent, finished = false) {
  bridge?.progress(text, Math.floor(percent), finished);
}
