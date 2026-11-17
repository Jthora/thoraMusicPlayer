import {
  breadcrumb,
  buildFolderTree,
  compactStart,
  countSongFolders,
  folderSongs,
  upFrom,
} from '../src/features/library/folderTree';
import {MediaStoreTrack} from '../src/native/modules';

let nextId = 1;
const song = (relativePath: string, title: string): MediaStoreTrack => ({
  uri: `content://media/${nextId++}`,
  title,
  artist: 'Artist',
  album: 'Album',
  durationMs: 200_000,
  mimeType: 'audio/mpeg',
  sizeBytes: 1,
  dateModifiedEpochSeconds: 1,
  displayName: `${title}.mp3`,
  relativePath,
});

// Shaped like the phone: everything under Music/Thora/<source>/…, with MediaStore's trailing slashes.
const library = [
  song('Music/Thora/library/Big Bad Beats 2/', '02 Two'),
  song('Music/Thora/library/Big Bad Beats 10/', '01 Ten'),
  song('Music/Thora/library/Big Bad Beats 1/', '10 Ten'),
  song('Music/Thora/library/Big Bad Beats 1/', '2 Two'),
  song('Music/Thora/liked2026/', 'Liked A'),
  song('Music/Thora/liked2026/', 'Liked B'),
  song('Music/Thora/spotifyBackerUpper/Artist/Album/', 'Deep'),
];

describe('buildFolderTree', () => {
  const tree = buildFolderTree(library);

  test('counts every song in a branch, not just the songs directly in it', () => {
    expect(tree.root.total).toBe(7);
    expect(tree.byPath.get('Music/Thora')?.total).toBe(7);
    expect(tree.byPath.get('Music/Thora/library')?.total).toBe(4);
    expect(tree.byPath.get('Music/Thora/library')?.tracks).toHaveLength(0);
  });

  test('sorts folders and songs with numbers in order (2 before 10)', () => {
    const libraryFolder = tree.byPath.get('Music/Thora/library')!;
    expect(libraryFolder.children.map(child => child.name)).toEqual(['Big Bad Beats 1', 'Big Bad Beats 2', 'Big Bad Beats 10']);
    expect(tree.byPath.get('Music/Thora/library/Big Bad Beats 1')!.tracks.map(t => t.title)).toEqual(['2 Two', '10 Ten']);
  });

  test('browsing starts below the folders that only lead to one other folder', () => {
    const start = compactStart(tree.root);
    expect(start.path).toBe('Music/Thora');
    expect(start.children.map(child => child.name)).toEqual(['library', 'liked2026', 'spotifyBackerUpper']);
  });

  test('opening a folder skips single-folder chains (Artist -> Album)', () => {
    expect(compactStart(tree.byPath.get('Music/Thora/spotifyBackerUpper')!).path).toBe(
      'Music/Thora/spotifyBackerUpper/Artist/Album',
    );
  });

  test('up returns to the nearest folder worth showing, then to the top', () => {
    expect(upFrom(tree, 'Music/Thora/spotifyBackerUpper/Artist/Album')).toBeNull();
    expect(upFrom(tree, 'Music/Thora/library/Big Bad Beats 1')).toBe('Music/Thora/library');
    expect(upFrom(tree, 'Music/Thora/library')).toBeNull();
    expect(upFrom(tree, 'Music/Thora')).toBeNull();
  });

  test('play all in a folder plays its own songs, then each sub-folder in order', () => {
    expect(folderSongs(tree.byPath.get('Music/Thora/library')!).map(t => t.title)).toEqual([
      '2 Two',
      '10 Ten',
      '02 Two',
      '01 Ten',
    ]);
  });

  test('breadcrumb is relative to where browsing starts', () => {
    expect(breadcrumb(tree, 'Music/Thora/library/Big Bad Beats 2')).toBe('Thora › library › Big Bad Beats 2');
    expect(breadcrumb(tree, 'Music/Thora')).toBe('Thora');
  });

  test('counts only folders that hold songs', () => {
    expect(countSongFolders(tree)).toBe(5);
  });

  test('an empty library is an empty root', () => {
    const empty = buildFolderTree([]);
    expect(empty.root.total).toBe(0);
    expect(compactStart(empty.root)).toBe(empty.root);
  });
});
