import {createMMKV} from 'react-native-mmkv';

import {describeError, logDiagnostic} from '../diagnostics';

type StorageBackend = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const inMemoryStore = new Map<string, string>();

const fallbackStorage: StorageBackend = {
  getItem(key: string): string | null {
    return inMemoryStore.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    inMemoryStore.set(key, value);
  },
  removeItem(key: string): void {
    inMemoryStore.delete(key);
  },
};

/** Which backend is live. 'memory' means settings won't survive a restart; it is logged as an error. */
export let kvStoreBackend: 'mmkv' | 'memory' = 'mmkv';

const storage: StorageBackend = (() => {
  try {
    const mmkv = createMMKV({
      id: 'android_music_player.kv',
    });
    return {
      getItem(key: string): string | null {
        return mmkv.getString(key) ?? null;
      },
      setItem(key: string, value: string): void {
        mmkv.set(key, value);
      },
      removeItem(key: string): void {
        mmkv.remove(key);
      },
    };
  } catch (error) {
    // If the MMKV native library is missing from the APK, keep the app bootable with an
    // in-memory fallback instead of crashing, but record it: nothing will persist.
    kvStoreBackend = 'memory';
    logDiagnostic('error', 'kvStore', 'MMKV unavailable; settings will not persist', {
      error: describeError(error).message,
    });
    if (__DEV__) {
      console.warn(
        '[kvStore] MMKV unavailable on this device/runtime, using in-memory fallback.'
      );
    }
    return fallbackStorage;
  }
})();

export const kvStore = {
  getItem(key: string): string | null {
    return storage.getItem(key);
  },
  setItem(key: string, value: string): void {
    storage.setItem(key, value);
  },
  removeItem(key: string): void {
    storage.removeItem(key);
  },
};
