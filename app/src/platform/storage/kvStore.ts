import {createMMKV} from 'react-native-mmkv';

const storage = createMMKV({
  id: 'android_music_player.kv',
});

export const kvStore = {
  getItem(key: string): string | null {
    return storage.getString(key) ?? null;
  },
  setItem(key: string, value: string): void {
    storage.set(key, value);
  },
  removeItem(key: string): void {
    storage.remove(key);
  },
};
