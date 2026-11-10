/**
 * Regression: pressing play on a search result must play that result. Search used to call a
 * playFromBrowse() that ignored the row and resumed the previous queue (searching "Barbara" and
 * pressing play on "Barbara is a Wicked Bomber" played "Quartz Quadrant" from Fusion Girl).
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {SearchBrowsePanel} from '../src/features/library/SearchBrowsePanel';
import {MediaStoreTrack} from '../src/native/modules';
import {kvStore} from '../src/platform/storage/kvStore';
import {ThemeProvider} from '../src/ui/themeRuntime';

const track = (id: number, title: string, artist = 'Artist', relativePath = ''): MediaStoreTrack => ({
  uri: `content://media/${id}`,
  title,
  artist,
  album: 'Album',
  durationMs: 200_000,
  mimeType: 'audio/mpeg',
  sizeBytes: 1,
  dateModifiedEpochSeconds: 1,
  displayName: `${title}.mp3`,
  relativePath,
});

const barbara = track(1, 'Barbara is a Wicked Bomber', 'Fake Shark');
const otherBarbara = track(2, 'Barbara Ann', 'The Beach Boys');

function renderPanel(props: Partial<React.ComponentProps<typeof SearchBrowsePanel>>) {
  const onPlayTracks = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider>
        <SearchBrowsePanel
          status=""
          searchResults={[]}
          albums={[]}
          artists={[]}
          songs={[]}
          relevanceReport={null}
          onSearch={jest.fn(async () => {})}
          onBrowseAlbums={jest.fn(async () => {})}
          onBrowseArtists={jest.fn(async () => {})}
          onBrowseSongs={jest.fn(async () => {})}
          onPlayTracks={onPlayTracks}
          onValidateRelevance={jest.fn(async () => {})}
          {...props}
        />
      </ThemeProvider>,
    );
  });
  return {renderer, onPlayTracks};
}

const pressablesTitled = (renderer: ReactTestRenderer.ReactTestRenderer, title: string) =>
  renderer.root.findAll(node => node.props.title === title && typeof node.props.onPress === 'function');

afterEach(() => kvStore.removeItem('android_music_player.search_panel.v1'));

test('play on a search result plays the search results from that song', () => {
  kvStore.setItem(
    'android_music_player.search_panel.v1',
    JSON.stringify({mode: 'search', query: 'barbara', searchScope: 'all', currentFolderPath: ''}),
  );
  const results = [otherBarbara, barbara];
  const {renderer, onPlayTracks} = renderPanel({searchResults: results});

  expect(renderer.root.findAll(node => node.props.children === 'Barbara is a Wicked Bomber').length).toBeGreaterThan(0);

  const playButtons = pressablesTitled(renderer, '▶');
  expect(playButtons).toHaveLength(2);
  ReactTestRenderer.act(() => playButtons[1].props.onPress()); // the "Barbara is a Wicked Bomber" row

  expect(onPlayTracks).toHaveBeenCalledTimes(1);
  const [tracks, startUri, label] = onPlayTracks.mock.calls[0];
  expect(startUri).toBe(barbara.uri);
  expect((tracks as MediaStoreTrack[]).map(t => t.uri)).toContain(barbara.uri);
  expect(label).toBe('search');
  ReactTestRenderer.act(() => renderer.unmount());
});

test('play on a track in the folder browser plays that folder from that song', () => {
  const songs = [track(10, 'Zulu'), track(11, 'Alpha'), track(12, 'Mike')];
  const {renderer, onPlayTracks} = renderPanel({songs});

  const playButtons = pressablesTitled(renderer, 'PLAY');
  expect(playButtons.length).toBeGreaterThanOrEqual(3);
  // Folder rows are sorted by title: Alpha, Mike, Zulu. Press "Mike".
  ReactTestRenderer.act(() => playButtons[1].props.onPress());

  const [tracks, startUri] = onPlayTracks.mock.calls[0];
  expect((tracks as MediaStoreTrack[]).map(t => t.title)).toEqual(['Alpha', 'Mike', 'Zulu']);
  expect(startUri).toBe('content://media/12');
  ReactTestRenderer.act(() => renderer.unmount());
});
