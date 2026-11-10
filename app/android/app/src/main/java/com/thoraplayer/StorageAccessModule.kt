package com.thoraplayer

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class StorageAccessModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val REQUEST_CODE_PICK_FOLDER = 41027
        private const val REQUEST_CODE_PICK_PLAYLIST = 41028
        private const val REQUEST_CODE_PICK_PLAYLISTS = 41029
        private val PLAYLIST_MIME_TYPES = arrayOf(
            "audio/x-mpegurl", "audio/mpegurl", "application/x-mpegurl", "application/vnd.apple.mpegurl",
            "audio/x-scpls", "application/xspf+xml", "text/plain", "application/octet-stream",
        )
        private const val PREFS_NAME = "storage_access"
        private const val KEY_GRANTED_URIS = "granted_tree_uris"
    }

    private var pendingPickPromise: Promise? = null
    private var pendingPlaylistPickPromise: Promise? = null
    private var pendingPlaylistsPickPromise: Promise? = null

    private val pickerEventListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?
        ) {
            if (requestCode == REQUEST_CODE_PICK_PLAYLISTS) {
                handlePlaylistsPicked(resultCode, data)
                return
            }
            if (requestCode != REQUEST_CODE_PICK_FOLDER) {
                if (requestCode != REQUEST_CODE_PICK_PLAYLIST) {
                    return
                }

                val playlistPromise = pendingPlaylistPickPromise ?: return
                pendingPlaylistPickPromise = null

                if (resultCode != Activity.RESULT_OK || data?.data == null) {
                    playlistPromise.reject("PLAYLIST_PICK_CANCELLED", "Playlist selection was cancelled.")
                    return
                }

                val uri = data.data ?: run {
                    playlistPromise.reject("PLAYLIST_PICK_EMPTY", "No playlist URI returned from picker.")
                    return
                }

                val grantFlags =
                    data.flags and
                        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)

                val persistedGrant = runCatching {
                    reactApplicationContext.contentResolver.takePersistableUriPermission(uri, grantFlags)
                    true
                }.getOrElse { false }

                val granted = if (persistedGrant) {
                    hasPersistedReadGrant(uri.toString())
                } else {
                    false
                }

                val result = Arguments.createMap().apply {
                    putString("uri", uri.toString())
                    putString("name", displayNameOf(uri) ?: uri.lastPathSegment?.substringAfterLast('/') ?: "playlist.m3u")
                    putBoolean("granted", granted)
                }

                playlistPromise.resolve(result)
                return
            }

            val promise = pendingPickPromise ?: return
            pendingPickPromise = null

            if (resultCode != Activity.RESULT_OK || data?.data == null) {
                promise.reject("FOLDER_PICK_CANCELLED", "Folder selection was cancelled.")
                return
            }

            val uri = data.data ?: run {
                promise.reject("FOLDER_PICK_EMPTY", "No folder URI returned from picker.")
                return
            }

            val grantFlags =
                data.flags and
                    (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)

            try {
                reactApplicationContext.contentResolver.takePersistableUriPermission(uri, grantFlags)
            } catch (error: SecurityException) {
                promise.reject("PERSIST_GRANT_FAILED", error)
                return
            }

            persistUri(uri.toString())

            val result = Arguments.createMap().apply {
                putString("uri", uri.toString())
                putBoolean("granted", hasPersistedReadGrant(uri.toString()))
            }
            promise.resolve(result)
        }
    }

    init {
        reactContext.addActivityEventListener(pickerEventListener)
    }

    override fun getName(): String = "StorageAccess"

    @ReactMethod
    fun pickFolderTree(promise: Promise) {
        if (pendingPickPromise != null) {
            promise.reject("PICK_IN_PROGRESS", "A folder picker request is already in progress.")
            return
        }

        val current = reactApplicationContext.currentActivity
        if (current == null) {
            promise.reject("NO_ACTIVITY", "No active activity is available for folder picker.")
            return
        }

        pendingPickPromise = promise

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        }

        try {
            current.startActivityForResult(intent, REQUEST_CODE_PICK_FOLDER)
        } catch (error: Exception) {
            pendingPickPromise = null
            promise.reject("PICKER_START_FAILED", error)
        }
    }

    @ReactMethod
    fun getFolderGrants(promise: Promise) {
        promise.resolve(buildGrantArray(getStoredUris()))
    }

    @ReactMethod
    fun pickPlaylistFile(promise: Promise) {
        if (pendingPlaylistPickPromise != null) {
            promise.reject("PLAYLIST_PICK_IN_PROGRESS", "A playlist picker request is already in progress.")
            return
        }

        val current = reactApplicationContext.currentActivity
        if (current == null) {
            promise.reject("NO_ACTIVITY", "No active activity is available for playlist picker.")
            return
        }

        pendingPlaylistPickPromise = promise

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "audio/x-mpegurl"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/x-mpegurl", "audio/mpegurl", "application/vnd.apple.mpegurl", "text/plain"))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }

        try {
            current.startActivityForResult(intent, REQUEST_CODE_PICK_PLAYLIST)
        } catch (error: Exception) {
            pendingPlaylistPickPromise = null
            promise.reject("PLAYLIST_PICKER_START_FAILED", error)
        }
    }

    /**
     * Pick one or more playlist files (m3u/m3u8/pls/xspf). Grants are temporary: the files are read
     * right away, so this doesn't spend the app's limited persisted-permission slots.
     */
    @ReactMethod
    fun pickPlaylistFiles(promise: Promise) {
        if (pendingPlaylistsPickPromise != null || pendingPlaylistPickPromise != null) {
            promise.reject("PLAYLIST_PICK_IN_PROGRESS", "A playlist picker request is already in progress.")
            return
        }
        val current = reactApplicationContext.currentActivity
        if (current == null) {
            promise.reject("NO_ACTIVITY", "No active activity is available for playlist picker.")
            return
        }
        pendingPlaylistsPickPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, PLAYLIST_MIME_TYPES)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            current.startActivityForResult(intent, REQUEST_CODE_PICK_PLAYLISTS)
        } catch (error: Exception) {
            pendingPlaylistsPickPromise = null
            promise.reject("PLAYLIST_PICKER_START_FAILED", error)
        }
    }

    private fun handlePlaylistsPicked(resultCode: Int, data: Intent?) {
        val promise = pendingPlaylistsPickPromise ?: return
        pendingPlaylistsPickPromise = null
        if (resultCode != Activity.RESULT_OK || data == null) {
            promise.reject("PLAYLIST_PICK_CANCELLED", "Playlist selection was cancelled.")
            return
        }
        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(uris::add) }
        if (uris.isEmpty()) data.data?.let(uris::add)
        if (uris.isEmpty()) {
            promise.reject("PLAYLIST_PICK_EMPTY", "No playlist files were selected.")
            return
        }
        promise.resolve(Arguments.createArray().apply {
            uris.distinct().forEach { uri ->
                pushMap(Arguments.createMap().apply {
                    putString("uri", uri.toString())
                    putString("name", displayNameOf(uri) ?: uri.lastPathSegment?.substringAfterLast('/') ?: "playlist.m3u")
                    putBoolean("granted", true)
                })
            }
        })
    }

    private fun displayNameOf(uri: Uri): String? = runCatching {
        reactApplicationContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0)?.ifBlank { null } else null
        }
    }.getOrNull()

    @ReactMethod
    fun cleanupRevokedFolderGrants(promise: Promise) {
        val stored = getStoredUris()
        val revoked = stored.filterNot { hasPersistedReadGrant(it) }

        if (revoked.isEmpty()) {
            promise.resolve(0)
            return
        }

        revoked.forEach(::removePersistedUri)
        promise.resolve(revoked.size)
    }

    @ReactMethod
    fun removeFolderGrant(uri: String, promise: Promise) {
        val parsed = Uri.parse(uri)

        runCatching {
            reactApplicationContext.contentResolver.releasePersistableUriPermission(
                parsed,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        }

        removePersistedUri(uri)
        promise.resolve(true)
    }

    private fun buildGrantArray(uris: Set<String>) = Arguments.createArray().apply {
        uris.forEach { uri ->
            pushMap(
                Arguments.createMap().apply {
                    putString("uri", uri)
                    putBoolean("granted", hasPersistedReadGrant(uri))
                }
            )
        }
    }

    private fun persistUri(uri: String) {
        val updated = getStoredUris().toMutableSet().apply { add(uri) }
        saveStoredUris(updated)
    }

    private fun removePersistedUri(uri: String) {
        val updated = getStoredUris().toMutableSet().apply { remove(uri) }
        saveStoredUris(updated)
    }

    private fun hasPersistedReadGrant(uri: String): Boolean {
        val parsed = Uri.parse(uri)
        return reactApplicationContext.contentResolver.persistedUriPermissions.any {
            it.uri == parsed && it.isReadPermission
        }
    }

    private fun getStoredUris(): Set<String> {
        val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
        return prefs.getStringSet(KEY_GRANTED_URIS, emptySet()) ?: emptySet()
    }

    private fun saveStoredUris(uris: Set<String>) {
        val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
        prefs.edit().putStringSet(KEY_GRANTED_URIS, uris).commit()
    }
}
