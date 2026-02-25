export type AppTabKey = 'home' | 'search' | 'yourLibrary' | 'create' | 'settings' | 'nowplaying';

export type LegacyTabKey = 'library' | 'playlists';

export type AnySupportedTabKey = AppTabKey | LegacyTabKey;

export function resolveAppTabKey(tabKey: AnySupportedTabKey): AppTabKey {
  if (tabKey === 'library') {
    return 'home';
  }

  if (tabKey === 'playlists') {
    return 'yourLibrary';
  }

  return tabKey;
}
