import {useEffect, useState} from 'react';

import {FolderGrant, storageAccess} from '../../native/modules';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Unknown error';
}

export function useFolderGrants() {
  const [folderGrantStatus, setFolderGrantStatus] = useState('Using default Music folder');
  const [folderGrants, setFolderGrants] = useState<FolderGrant[]>([]);

  const refreshFolderGrants = async () => {
    if (!storageAccess) {
      setFolderGrantStatus('Folder access module unavailable');
      return [];
    }

    try {
      const grants = await storageAccess.getFolderGrants();
      setFolderGrants(grants);

      if (grants.length === 0) {
        setFolderGrantStatus('Using default Music folder (/storage/emulated/0/Music)');
        return grants;
      }

      const valid = grants.filter(item => item.granted).length;
      const revoked = grants.length - valid;
      setFolderGrantStatus(`Persisted grants: ${grants.length} (${valid} valid, ${revoked} revoked)`);
      return grants;
    } catch (error) {
      setFolderGrantStatus(`Failed to load folder grants (${getErrorMessage(error)})`);
      return [];
    }
  };

  useEffect(() => {
    void refreshFolderGrants();
  }, []);

  const pickFolderRoot = async () => {
    if (!storageAccess) {
      setFolderGrantStatus('Folder access module unavailable');
      return false;
    }

    try {
      const result = await storageAccess.pickFolderTree();
      setFolderGrantStatus(result.granted ? 'Folder grant persisted' : 'Folder selected but grant missing');
      await refreshFolderGrants();
      return result.granted;
    } catch (error) {
      setFolderGrantStatus(`Folder pick cancelled or failed (${getErrorMessage(error)})`);
      return false;
    }
  };

  const cleanupRevokedGrants = async () => {
    if (!storageAccess) {
      setFolderGrantStatus('Folder access module unavailable');
      return;
    }

    try {
      const removed = await storageAccess.cleanupRevokedFolderGrants();
      setFolderGrantStatus(`Revoked grants removed: ${removed}`);
      await refreshFolderGrants();
    } catch (error) {
      setFolderGrantStatus(`Failed to cleanup revoked grants (${getErrorMessage(error)})`);
    }
  };

  const removeGrant = async (uri: string) => {
    if (!storageAccess) {
      setFolderGrantStatus('Folder access module unavailable');
      return;
    }

    try {
      await storageAccess.removeFolderGrant(uri);
      setFolderGrantStatus('Folder grant removed');
      await refreshFolderGrants();
    } catch (error) {
      setFolderGrantStatus(`Failed to remove folder grant (${getErrorMessage(error)})`);
    }
  };

  return {
    folderGrantStatus,
    folderGrants,
    pickFolderRoot,
    refreshFolderGrants,
    cleanupRevokedGrants,
    removeGrant,
  };
}
