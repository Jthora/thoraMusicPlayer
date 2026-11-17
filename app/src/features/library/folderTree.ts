import {MediaStoreTrack} from '../../native/modules';
import {compareText} from './sortKeys';

/**
 * The library as a folder tree. A flat list of the deepest folders fell apart on a library built
 * from playlists (hundreds of album folders holding one song each); a tree with per-branch
 * totals shows where the music actually is.
 */
export type FolderNode = {
  /** "Music/Thora/library" (no trailing slash); "" is the root. */
  path: string;
  name: string;
  /** Sub-folders, sorted by name (numbers in names sort numerically). */
  children: FolderNode[];
  /** Songs directly in this folder. */
  tracks: MediaStoreTrack[];
  /** Songs in this folder and every folder below it. */
  total: number;
};

export type FolderTree = {
  root: FolderNode;
  byPath: Map<string, FolderNode>;
};


function segmentsOf(relativePath: string): string[] {
  return (relativePath || '')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean);
}

const byName = (left: MediaStoreTrack, right: MediaStoreTrack) =>
  compareText(left.displayName || left.title, right.displayName || right.title);

export function buildFolderTree(
  songs: readonly MediaStoreTrack[],
  compareTracks: (left: MediaStoreTrack, right: MediaStoreTrack) => number = byName,
): FolderTree {
  const root: FolderNode = {path: '', name: 'All folders', children: [], tracks: [], total: 0};
  const byPath = new Map<string, FolderNode>([['', root]]);
  const childIndex = new Map<FolderNode, Map<string, FolderNode>>();

  for (const track of songs) {
    let node = root;
    root.total += 1;
    for (const segment of segmentsOf(track.relativePath)) {
      let children = childIndex.get(node);
      if (!children) {
        children = new Map();
        childIndex.set(node, children);
      }
      let child = children.get(segment);
      if (!child) {
        const path = node.path ? `${node.path}/${segment}` : segment;
        child = {path, name: segment, children: [], tracks: [], total: 0};
        children.set(segment, child);
        byPath.set(path, child);
      }
      child.total += 1;
      node = child;
    }
    node.tracks.push(track);
  }

  for (const [node, children] of childIndex) {
    node.children = [...children.values()].sort((left, right) => compareText(left.name, right.name));
  }
  for (const node of byPath.values()) {
    node.tracks.sort(compareTracks);
  }
  return {root, byPath};
}

/** Skip folders that only lead to one other folder (Music -> Thora -> …): where browsing starts. */
export function compactStart(node: FolderNode): FolderNode {
  let current = node;
  while (current.tracks.length === 0 && current.children.length === 1) {
    current = current.children[0];
  }
  return current;
}

/** Every song in a folder and below it: its own songs first, then each sub-folder in order. */
export function folderSongs(node: FolderNode): MediaStoreTrack[] {
  const songs: MediaStoreTrack[] = [];
  const visit = (current: FolderNode) => {
    songs.push(...current.tracks);
    current.children.forEach(visit);
  };
  visit(node);
  return songs;
}

/**
 * Where "up" from `path` lands: the nearest ancestor worth showing (one that holds songs or more
 * than one folder), or null for the top of the browser.
 */
export function upFrom(tree: FolderTree, path: string): string | null {
  const start = compactStart(tree.root);
  let current = path;
  while (true) {
    if (!current || current === start.path || !current.startsWith(start.path)) {
      return null;
    }
    const parent = current.slice(0, Math.max(0, current.lastIndexOf('/')));
    if (parent.length <= start.path.length) {
      return null;
    }
    const node = tree.byPath.get(parent);
    if (!node || node.tracks.length > 0 || node.children.length > 1) {
      return parent;
    }
    current = parent;
  }
}

/** "Thora › library › All Music", relative to where browsing starts. */
export function breadcrumb(tree: FolderTree, path: string): string {
  const start = compactStart(tree.root);
  const relative = path.startsWith(start.path) ? path.slice(start.path.length).replace(/^\//, '') : path;
  return [start.name, ...segmentsOf(relative)].join(' › ');
}

/** Folders that directly hold songs (what "folders" means on the home screen). */
export function countSongFolders(tree: FolderTree): number {
  let count = 0;
  tree.byPath.forEach(node => {
    if (node.tracks.length > 0) {
      count += 1;
    }
  });
  return count;
}
