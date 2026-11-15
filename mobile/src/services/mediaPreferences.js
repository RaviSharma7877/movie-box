import AsyncStorage from "@react-native-async-storage/async-storage";

const pending = new Map();
const preferenceKey = (request, mode) =>
  "moviebox:media-options:" + JSON.stringify([request.type, String(request.id), mode]);

async function read(key) {
  const value = await AsyncStorage.getItem(key);
  return value ? JSON.parse(value) : {};
}

export async function readMediaPreferences(request, mode) {
  const key = preferenceKey(request, mode);
  try {
    await pending.get(key);
    return await read(key);
  } catch {
    return {};
  }
}

export function saveMediaPreferences(request, mode, change) {
  const key = preferenceKey(request, mode);
  const write = (pending.get(key) || Promise.resolve()).then(async () => {
    const previous = await read(key).catch(() => ({}));
    await AsyncStorage.setItem(key, JSON.stringify({ ...previous, ...change }));
  }).catch(() => {});
  pending.set(key, write);
  write.then(() => { if (pending.get(key) === write) pending.delete(key); });
}
