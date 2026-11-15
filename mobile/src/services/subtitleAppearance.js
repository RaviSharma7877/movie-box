import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "moviebox:subtitle-appearance";
export const subtitleSizes = { Small: 16, Medium: 19, Large: 24 };
export const subtitleBackgrounds = { Off: "transparent", Dim: "#000000A6", Solid: "#000000" };
export const defaultSubtitleAppearance = { size: "Medium", background: "Dim" };
let pending = Promise.resolve();

export async function readSubtitleAppearance() {
  await pending;
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(KEY));
    return {
      size: Object.prototype.hasOwnProperty.call(subtitleSizes, saved?.size) ? saved.size : defaultSubtitleAppearance.size,
      background: Object.prototype.hasOwnProperty.call(subtitleBackgrounds, saved?.background)
        ? saved.background : defaultSubtitleAppearance.background,
    };
  } catch {
    return defaultSubtitleAppearance;
  }
}

export function saveSubtitleAppearance(value) {
  pending = pending.then(() => AsyncStorage.setItem(KEY, JSON.stringify(value))).catch(() => {});
}
