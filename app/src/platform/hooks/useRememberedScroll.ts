import {useCallback, useRef} from 'react';
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';
import type {FlashListRef} from '@shopify/flash-list';

const offsets = new Map<string, number>();

/**
 * Remembers a list's scroll position under `key` and restores it when the list is shown again
 * (e.g. back from a playlist to the playlist list). Spread the result onto a FlashList and give
 * the FlashList `key={key}` so a different list (another folder, another album) starts fresh.
 * Positions live for the app session.
 */
export function useRememberedScroll<T>(key: string) {
  const ref = useRef<FlashListRef<T>>(null);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsets.set(key, event.nativeEvent.contentOffset.y);
    },
    [key],
  );

  const onLoad = useCallback(() => {
    const offset = offsets.get(key);
    if (offset && offset > 0) {
      requestAnimationFrame(() => ref.current?.scrollToOffset({offset, animated: false}));
    }
  }, [key]);

  return {ref, onScroll, onLoad, scrollEventThrottle: 50};
}

export function rememberedScrollOffset(key: string): number | undefined {
  return offsets.get(key);
}

/** Test-only. */
export function resetRememberedScrolls(): void {
  offsets.clear();
}
