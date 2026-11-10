import {ReactNode} from 'react';

import {PlaybackClock, useLivePositionMs} from './playbackEvents';

type LivePositionProps = {
  clock: PlaybackClock | null;
  children: (positionMs: number) => ReactNode;
};

/**
 * Renders its children with the live playback position. Only this subtree re-renders as the
 * position advances, so the app shell above it stays still during playback.
 */
export function LivePosition({clock, children}: LivePositionProps) {
  const positionMs = useLivePositionMs(clock);
  return <>{children(positionMs)}</>;
}
