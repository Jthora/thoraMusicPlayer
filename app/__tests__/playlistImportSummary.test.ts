import {PlaylistImportResult} from '../src/native/modules';
import {summarizeImports} from '../src/features/playlists/usePlaylistImport';

function result(partial: Partial<PlaylistImportResult>): PlaylistImportResult {
  return {
    sourceUri: 'content://x',
    sourceName: 'list.m3u8',
    format: 'm3u8',
    totalEntries: 10,
    resolvedCount: 0,
    unresolvedCount: 0,
    duplicateCount: 0,
    unsupportedCount: 0,
    importedAtSec: 0,
    diagnostics: [],
    playlistId: null,
    playlistName: null,
    ...partial,
  };
}

describe('summarizeImports', () => {
  it('names the playlist for a single import', () => {
    expect(summarizeImports([result({playlistId: 3, playlistName: 'Fusion Girl', resolvedCount: 7})], 0)).toBe(
      'Imported "Fusion Girl": 7 of 10 songs found',
    );
  });

  it('says when none of a single file is in the library', () => {
    expect(summarizeImports([result({sourceName: 'old.m3u'})], 0)).toBe(
      'No songs from old.m3u are in the library yet (10 entries)',
    );
  });

  it('totals a batch and reports empty and unreadable files', () => {
    const summary = summarizeImports(
      [
        result({playlistId: 1, playlistName: 'A', resolvedCount: 9}),
        result({playlistId: 2, playlistName: 'B', resolvedCount: 4, totalEntries: 5}),
        result({}),
      ],
      1,
    );
    expect(summary).toBe('Imported 2 playlists: 13 of 25 songs found; 1 with no songs in the library; 1 could not be read');
  });
});
