import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "moviebox:watchlist";
export const titleId = (item) => item.category + ":" + item.type + ":" + item.id;
let pending = Promise.resolve();

export async function getWatchlist() {
  await pending;
  return read();
}

async function read() {
  return JSON.parse(await AsyncStorage.getItem(KEY) || "[]");
}

export function toggleWatchlist(item) {
  const key = titleId(item);
  const update = pending.then(async () => {
    const list = await read();
    const saved = list.some(entry => titleId(entry) === key);
    await AsyncStorage.setItem(KEY, JSON.stringify(saved
      ? list.filter(entry => titleId(entry) !== key)
      : [item, ...list]));
    return !saved;
  });
  pending = update.catch(() => {});
  return update;
}
