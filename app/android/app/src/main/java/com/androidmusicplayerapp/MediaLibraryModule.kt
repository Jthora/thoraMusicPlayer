package com.androidmusicplayerapp

import android.app.Activity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MediaLibraryModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val indexStore by lazy { LibraryIndexStore(reactApplicationContext) }
    private val scanner by lazy { MediaLibraryScanner(reactApplicationContext) }
    private val searchRelevanceValidator by lazy { SearchRelevanceValidator(indexStore) }
    private val playlistImportPersistence by lazy { PlaylistImportPersistence(reactApplicationContext) }
    private val userPlaylistStore by lazy { UserPlaylistStore(reactApplicationContext) }
    private val playlistImporter by lazy {
        PlaylistImporter(reactApplicationContext, indexStore, playlistImportPersistence)
    }
    private val backgroundExecutor: ExecutorService = Executors.newFixedThreadPool(2)

    companion object {
        private const val STORAGE_PREFS_NAME = "storage_access"
        private const val STORAGE_URI_KEY = "granted_tree_uris"
        private const val MAX_SEARCH_QUERY_LENGTH = 256
        private const val MAX_SEARCH_LIMIT = 100
        private const val MAX_BROWSE_LIMIT = 500
        private const val MAX_PLAYLIST_NAME_LENGTH = 80
    }

    override fun getName(): String = "MediaLibrary"

    override fun invalidate() {
        backgroundExecutor.shutdown()
        super.invalidate()
    }

    private inline fun <T> runOnBackground(
        promise: Promise,
        errorCode: String,
        crossinline task: () -> T
    ) {
        backgroundExecutor.execute {
            runCatching { task() }
                .onSuccess { result -> promise.resolve(result) }
                .onFailure { error -> promise.reject(errorCode, error) }
        }
    }

    @ReactMethod
    fun scanMediaStore(limit: Int, promise: Promise) {
        scanMediaStorePage(limit, 0, promise)
    }

    @ReactMethod
    fun indexMediaStorePage(limit: Int, offset: Int, promise: Promise) {
        val safeLimit = if (limit <= 0) 50 else limit
        val safeOffset = if (offset < 0) 0 else offset

        runOnBackground(promise, "INDEX_MEDIASTORE_ERROR") {
            val allTracks = queryMediaStoreTracks()
            val totalCount = allTracks.size
            val pageItems = allTracks.drop(safeOffset).take(safeLimit)
            val nextOffset = safeOffset + pageItems.size
            val hasMore = nextOffset < totalCount
            val summary = indexStore.upsertTracks(pageItems, sourceType = "MEDIASTORE", sourceRoot = "EXTERNAL")

            buildIndexResultMap(
                items = pageItems,
                totalCount = totalCount,
                offset = safeOffset,
                nextOffset = nextOffset,
                hasMore = hasMore,
                summary = summary
            )
        }
    }

    @ReactMethod
    fun runIncrementalMediaStoreSync(limit: Int, promise: Promise) {
        val safeLimit = if (limit < 0) 0 else limit

        runOnBackground(promise, "INCREMENTAL_MEDIASTORE_ERROR") {
            val allTracks = queryMediaStoreTracks()
            val selected = if (safeLimit == 0) allTracks else allTracks.take(safeLimit)
            val diagnostics = mutableListOf<SyncDiagnostic>()

            if (safeLimit > 0 && safeLimit < allTracks.size) {
                diagnostics.add(
                    SyncDiagnostic(
                        level = "WARN",
                        code = "PARTIAL_SCAN_LIMIT",
                        root = "EXTERNAL",
                        message = "Incremental media scan limited to $safeLimit of ${allTracks.size} track(s)"
                    )
                )
            }

            val isFullCoverage = safeLimit == 0 || safeLimit >= allTracks.size
            val coverageMode = if (isFullCoverage) "FULL" else "PARTIAL"

            val summary = indexStore.syncIncremental(
                tracks = selected,
                sourceType = "MEDIASTORE",
                sourceRoot = "EXTERNAL",
                diagnostics = diagnostics,
                allowRemoval = isFullCoverage,
                coverageMode = coverageMode
            )
            Arguments.createMap().apply {
                putMap("summary", summary.toWritableMap())
                putDouble("scannedCount", selected.size.toDouble())
                putDouble("totalAvailable", allTracks.size.toDouble())
            }
        }
    }

    @ReactMethod
    fun scanMediaStorePage(limit: Int, offset: Int, promise: Promise) {
        val safeLimit = if (limit <= 0) 50 else limit
        val safeOffset = if (offset < 0) 0 else offset

        runOnBackground(promise, "MEDIASTORE_SCAN_PAGE_ERROR") {
            val allTracks = queryMediaStoreTracks()
            val totalCount = allTracks.size
            val pageItems = allTracks.drop(safeOffset).take(safeLimit)
            val nextOffset = safeOffset + pageItems.size
            val hasMore = nextOffset < totalCount
            val itemsArray = Arguments.createArray().apply {
                pageItems.forEach { pushMap(it) }
            }

            Arguments.createMap().apply {
                putArray("items", itemsArray)
                putDouble("totalCount", totalCount.toDouble())
                putDouble("offset", safeOffset.toDouble())
                putDouble("nextOffset", nextOffset.toDouble())
                putBoolean("hasMore", hasMore)
            }
        }
    }

    @ReactMethod
    fun scanSafRoots(options: ReadableMap?, promise: Promise) {
        val limitPerRoot = options?.getInt("limitPerRoot") ?: 100
        val safeLimitPerRoot = if (limitPerRoot <= 0) 100 else limitPerRoot

        runOnBackground(promise, "SAF_SCAN_ERROR") {
            scanner.performSafScan(safeLimitPerRoot, getStoredRootUris()).toWritableMap()
        }
    }

    @ReactMethod
    fun indexSafRoots(limitPerRoot: Int, promise: Promise) {
        val safeLimitPerRoot = if (limitPerRoot <= 0) 100 else limitPerRoot

        runOnBackground(promise, "INDEX_SAF_ERROR") {
            val roots = getStoredRootUris().sorted()
            val diagnostics = Arguments.createArray()
            val tracks = Arguments.createArray()

            var scanned = 0
            var inserted = 0
            var updated = 0
            var duplicate = 0
            var skipped = 0
            var removed = 0
            var snapshotId = 0L

            roots.forEach { root ->
                val rootResult = scanner.performSafScan(safeLimitPerRoot, setOf(root))
                rootResult.tracks.copyMapsTo(tracks)
                rootResult.diagnostics.copyMapsTo(diagnostics)

                val summary = indexStore.upsertTracks(
                    tracks = rootResult.trackMaps,
                    sourceType = "SAF",
                    sourceRoot = root
                )

                scanned += summary.scanned
                inserted += summary.inserted
                updated += summary.updated
                duplicate += summary.duplicate
                skipped += summary.skipped
                removed += summary.removed
                snapshotId = summary.snapshotId
            }

            Arguments.createMap().apply {
                putArray("roots", Arguments.createArray().apply { roots.forEach { pushString(it) } })
                putArray("tracks", tracks)
                putArray("diagnostics", diagnostics)
                putDouble("rootCount", roots.size.toDouble())
                putDouble("trackCount", tracks.size().toDouble())
                putMap(
                    "indexSummary",
                    Arguments.createMap().apply {
                        putDouble("scanned", scanned.toDouble())
                        putDouble("inserted", inserted.toDouble())
                        putDouble("updated", updated.toDouble())
                        putDouble("duplicate", duplicate.toDouble())
                        putDouble("skipped", skipped.toDouble())
                        putDouble("removed", removed.toDouble())
                        putDouble("snapshotId", snapshotId.toDouble())
                        putString("coverageMode", "PARTIAL")
                    }
                )
            }
        }
    }

    @ReactMethod
    fun runIncrementalSafSync(limitPerRoot: Int, promise: Promise) {
        val safeLimitPerRoot = if (limitPerRoot <= 0) 100 else limitPerRoot

        runOnBackground(promise, "INCREMENTAL_SAF_ERROR") {
            val roots = getStoredRootUris().sorted()
            val diagnostics = Arguments.createArray()
            val tracks = Arguments.createArray()

            var scanned = 0
            var inserted = 0
            var updated = 0
            var duplicate = 0
            var skipped = 0
            var removed = 0
            var snapshotId = 0L
            var fullCoverageAcrossRoots = true

            roots.forEach { root ->
                val rootResult = scanner.performSafScan(safeLimitPerRoot, setOf(root))
                rootResult.tracks.copyMapsTo(tracks)
                rootResult.diagnostics.copyMapsTo(diagnostics)

                val rootHasLimit = rootResult.diagnosticRows.any {
                    it.root == root && it.code == "ROOT_LIMIT_REACHED"
                }
                val rootHasAccessFailure = rootResult.diagnosticRows.any {
                    it.root == root && (it.code == "REVOKED_GRANT" || it.code == "ROOT_UNAVAILABLE")
                }
                val rootFullCoverage = !rootHasLimit && !rootHasAccessFailure
                fullCoverageAcrossRoots = fullCoverageAcrossRoots && rootFullCoverage

                val coverageMode = if (rootFullCoverage) "FULL" else "PARTIAL"
                val summary = indexStore.syncIncremental(
                    tracks = rootResult.trackMaps,
                    sourceType = "SAF",
                    sourceRoot = root,
                    diagnostics = rootResult.diagnosticRows,
                    allowRemoval = rootFullCoverage,
                    coverageMode = coverageMode
                )

                scanned += summary.scanned
                inserted += summary.inserted
                updated += summary.updated
                duplicate += summary.duplicate
                skipped += summary.skipped
                removed += summary.removed
                snapshotId = summary.snapshotId
            }

            Arguments.createMap().apply {
                putArray("roots", Arguments.createArray().apply { roots.forEach { pushString(it) } })
                putArray("tracks", tracks)
                putArray("diagnostics", diagnostics)
                putDouble("rootCount", roots.size.toDouble())
                putDouble("trackCount", tracks.size().toDouble())
                putMap(
                    "summary",
                    Arguments.createMap().apply {
                        putDouble("scanned", scanned.toDouble())
                        putDouble("inserted", inserted.toDouble())
                        putDouble("updated", updated.toDouble())
                        putDouble("duplicate", duplicate.toDouble())
                        putDouble("skipped", skipped.toDouble())
                        putDouble("removed", removed.toDouble())
                        putDouble("snapshotId", snapshotId.toDouble())
                        putString("coverageMode", if (fullCoverageAcrossRoots) "FULL" else "PARTIAL")
                    }
                )
            }
        }
    }

    @ReactMethod
    fun upsertScannedTracks(sourceType: String, sourceRoot: String, tracks: ReadableArray, promise: Promise) {
        runOnBackground(promise, "UPSERT_TRACKS_ERROR") {
            val list = mutableListOf<ReadableMap>()
            for (index in 0 until tracks.size()) {
                tracks.getMap(index)?.let { list.add(it) }
            }

            indexStore.upsertTracks(
                tracks = list,
                sourceType = if (sourceType.isBlank()) "UNKNOWN" else sourceType,
                sourceRoot = if (sourceRoot.isBlank()) "UNKNOWN" else sourceRoot
            ).toWritableMap()
        }
    }

    @ReactMethod
    fun recordPlaybackEvent(
        uri: String,
        eventType: String,
        positionMs: Double,
        durationMs: Double,
        promise: Promise
    ) {
        runOnBackground(promise, "PLAYBACK_EVENT_RECORD_ERROR") {
            val safePositionMs = if (positionMs.isFinite()) positionMs.toLong() else 0L
            val safeDurationMs = if (durationMs.isFinite()) durationMs.toLong() else 0L
            indexStore.recordPlaybackEvent(uri.trim(), eventType, safePositionMs, safeDurationMs).toWritableMap()
        }
    }

    @ReactMethod
    fun getIndexStats(promise: Promise) {
        runOnBackground(promise, "INDEX_STATS_ERROR") {
            indexStore.getIndexStats()
        }
    }

    @ReactMethod
    fun searchIndexedTracks(query: String, limit: Int, promise: Promise) {
        runOnBackground(promise, "SEARCH_INDEX_ERROR") {
            val normalizedQuery = normalizeSearchQuery(query)
            if (normalizedQuery.isBlank()) {
                Arguments.createArray()
            } else {
                indexStore.searchTracks(normalizedQuery, clampLimit(limit, defaultLimit = 30, maxLimit = MAX_SEARCH_LIMIT))
            }
        }
    }

    @ReactMethod
    fun searchUnified(query: String, scope: String, limit: Int, promise: Promise) {
        runOnBackground(promise, "SEARCH_UNIFIED_ERROR") {
            val normalizedQuery = normalizeSearchQuery(query)
            if (normalizedQuery.isBlank()) {
                Arguments.createMap().apply {
                    putString("scope", "all")
                    putArray("tracks", Arguments.createArray())
                    putArray("playlists", Arguments.createArray())
                    putArray("results", Arguments.createArray())
                }
            } else {
                val normalizedScope = normalizeSearchScope(scope)
                val safeLimit = clampLimit(limit, defaultLimit = 30, maxLimit = MAX_SEARCH_LIMIT)
                val tracks = indexStore.searchTracksByScope(normalizedQuery, normalizedScope, safeLimit)
                val playlists = if (normalizedScope == "all" || normalizedScope == "playlist_titles") {
                    userPlaylistStore.searchPlaylistsByName(normalizedQuery, safeLimit)
                } else {
                    Arguments.createArray()
                }

                val rows = Arguments.createArray().apply {
                    for (index in 0 until tracks.size()) {
                        tracks.getMap(index)?.let { track ->
                            pushMap(
                                Arguments.createMap().apply {
                                    putString("type", "song")
                                    putString("primaryText", track.getString("title") ?: "Unknown title")
                                    val artist = track.getString("artist") ?: "Unknown artist"
                                    val album = track.getString("album") ?: "Unknown album"
                                    putString("secondaryText", "$artist • $album")
                                    putString("uriOrId", track.getString("uri") ?: "")
                                    putBoolean("playable", true)
                                    putBoolean("addable", true)
                                }
                            )
                        }
                    }

                    for (index in 0 until playlists.size()) {
                        playlists.getMap(index)?.let { playlist ->
                            pushMap(
                                Arguments.createMap().apply {
                                    putString("type", "playlist")
                                    val name = playlist.getString("name") ?: "Playlist"
                                    putString("primaryText", name)
                                    val entryCount = playlist.getDouble("entryCount").toInt()
                                    putString("secondaryText", "Tracks: $entryCount")
                                    putString("uriOrId", (playlist.getDouble("id")).toLong().toString())
                                    putBoolean("playable", false)
                                    putBoolean("addable", false)
                                }
                            )
                        }
                    }
                }

                Arguments.createMap().apply {
                    putString("scope", normalizedScope)
                    putArray("tracks", tracks)
                    putArray("playlists", playlists)
                    putArray("results", rows)
                }
            }
        }
    }

    @ReactMethod
    fun browseIndexedAlbums(limit: Int, promise: Promise) {
        runOnBackground(promise, "BROWSE_ALBUMS_ERROR") {
            indexStore.browseAlbums(clampLimit(limit, defaultLimit = 50, maxLimit = MAX_BROWSE_LIMIT))
        }
    }

    @ReactMethod
    fun browseIndexedArtists(limit: Int, promise: Promise) {
        runOnBackground(promise, "BROWSE_ARTISTS_ERROR") {
            indexStore.browseArtists(clampLimit(limit, defaultLimit = 50, maxLimit = MAX_BROWSE_LIMIT))
        }
    }

    @ReactMethod
    fun browseIndexedSongs(limit: Int, promise: Promise) {
        runOnBackground(promise, "BROWSE_SONGS_ERROR") {
            indexStore.browseSongs(clampLimit(limit, defaultLimit = 100, maxLimit = MAX_BROWSE_LIMIT))
        }
    }

    @ReactMethod
    fun getRecentlyPlayedTracks(limit: Int, promise: Promise) {
        runOnBackground(promise, "RECENTLY_PLAYED_TRACKS_ERROR") {
            indexStore.getRecentlyPlayedTracks(clampLimit(limit, defaultLimit = 20, maxLimit = MAX_BROWSE_LIMIT))
        }
    }

    @ReactMethod
    fun getPopularTracks(limit: Int, windowDays: Int?, promise: Promise) {
        runOnBackground(promise, "POPULAR_TRACKS_ERROR") {
            val safeLimit = clampLimit(limit, defaultLimit = 20, maxLimit = MAX_BROWSE_LIMIT)
            indexStore.getPopularTracks(safeLimit, windowDays)
        }
    }

    @ReactMethod
    fun getRecentlyPlayedAlbums(limit: Int, promise: Promise) {
        runOnBackground(promise, "RECENTLY_PLAYED_ALBUMS_ERROR") {
            indexStore.getRecentlyPlayedAlbums(clampLimit(limit, defaultLimit = 20, maxLimit = MAX_BROWSE_LIMIT))
        }
    }

    @ReactMethod
    fun getRecentlyPlayedPlaylists(limit: Int, promise: Promise) {
        runOnBackground(promise, "RECENTLY_PLAYED_PLAYLISTS_ERROR") {
            userPlaylistStore.getRecentlyPlayedPlaylists(clampLimit(limit, defaultLimit = 20, maxLimit = MAX_BROWSE_LIMIT))
        }
    }

    @ReactMethod
    fun validateIndexedSearchRelevance(sampleLimit: Int, resultLimit: Int, promise: Promise) {
        runOnBackground(promise, "SEARCH_RELEVANCE_VALIDATION_ERROR") {
            searchRelevanceValidator.validate(sampleLimit, resultLimit)
        }
    }

    @ReactMethod
    fun generateFolderQueue(folderPath: String, anchorUri: String?, sortMode: String, limit: Int, promise: Promise) {
        runOnBackground(promise, "FOLDER_QUEUE_ERROR") {
            val result = indexStore.generateFolderQueue(folderPath, anchorUri, sortMode, limit)
            scanner.applyQueueReadabilityFilter(result, anchorUri)
        }
    }

    @ReactMethod
    fun getLatestSyncStatus(promise: Promise) {
        runOnBackground(promise, "LATEST_SYNC_STATUS_ERROR") {
            indexStore.getLatestSnapshotStatus()?.let { snapshot ->
                Arguments.createMap().apply {
                    putDouble("snapshotId", snapshot.snapshotId.toDouble())
                    putString("sourceType", snapshot.sourceType)
                    putString("sourceRoot", snapshot.sourceRoot)
                    putString("coverageMode", snapshot.coverageMode)
                    putDouble("startedAtSec", snapshot.startedAtSec.toDouble())
                    putDouble("completedAtSec", snapshot.completedAtSec.toDouble())
                    putDouble("scannedCount", snapshot.scannedCount.toDouble())
                    putDouble("insertedCount", snapshot.insertedCount.toDouble())
                    putDouble("updatedCount", snapshot.updatedCount.toDouble())
                    putDouble("duplicateCount", snapshot.duplicateCount.toDouble())
                    putDouble("skippedCount", snapshot.skippedCount.toDouble())
                    putDouble("removedCount", snapshot.removedCount.toDouble())
                }
            } ?: Arguments.createMap()
        }
    }

    @ReactMethod
    fun getLatestSyncDiagnostics(limit: Int, promise: Promise) {
        runOnBackground(promise, "LATEST_SYNC_DIAGNOSTICS_ERROR") {
            val snapshot = indexStore.getLatestSnapshotStatus()
            if (snapshot == null) {
                Arguments.createArray()
            } else {
                indexStore.getSnapshotDiagnostics(snapshot.snapshotId, limit)
            }
        }
    }

    @ReactMethod
    fun importPlaylistFile(playlistUri: String, sourceName: String?, promise: Promise) {
        runOnBackground(promise, "PLAYLIST_IMPORT_ERROR") {
            playlistImporter.importPlaylistFile(playlistUri, sourceName).toWritableMap()
        }
    }

    @ReactMethod
    fun getLatestPlaylistImportSummary(promise: Promise) {
        runOnBackground(promise, "PLAYLIST_IMPORT_LATEST_ERROR") {
            playlistImporter.getLatestImport()?.toWritableMap() ?: Arguments.createMap()
        }
    }

    @ReactMethod
    fun createUserPlaylist(name: String, promise: Promise) {
        runOnBackground(promise, "USER_PLAYLIST_CREATE_ERROR") {
            userPlaylistStore.createPlaylist(normalizePlaylistName(name))
        }
    }

    @ReactMethod
    fun listUserPlaylists(promise: Promise) {
        runOnBackground(promise, "USER_PLAYLIST_LIST_ERROR") {
            userPlaylistStore.listPlaylists()
        }
    }

    @ReactMethod
    fun getUserPlaylistEntries(playlistId: Double, promise: Promise) {
        runOnBackground(promise, "USER_PLAYLIST_ENTRIES_ERROR") {
            userPlaylistStore.getPlaylistEntries(requireValidPlaylistId(playlistId))
        }
    }

    @ReactMethod
    fun addTrackToUserPlaylist(playlistId: Double, track: ReadableMap, promise: Promise) {
        runOnBackground(promise, "USER_PLAYLIST_ADD_TRACK_ERROR") {
            userPlaylistStore.addTrack(requireValidPlaylistId(playlistId), track)
        }
    }

    @ReactMethod
    fun removeTrackFromUserPlaylist(playlistId: Double, position: Int, promise: Promise) {
        runOnBackground(promise, "USER_PLAYLIST_REMOVE_TRACK_ERROR") {
            userPlaylistStore.removeTrack(requireValidPlaylistId(playlistId), position)
        }
    }

    @ReactMethod
    fun moveTrackInUserPlaylist(playlistId: Double, fromPosition: Int, toPosition: Int, promise: Promise) {
        runOnBackground(promise, "USER_PLAYLIST_MOVE_TRACK_ERROR") {
            userPlaylistStore.moveTrack(requireValidPlaylistId(playlistId), fromPosition, toPosition)
        }
    }

    private fun queryMediaStoreTracks(): MutableList<WritableMap> {
        return scanner.queryMediaStoreTracks()
    }

    private fun requireValidPlaylistId(rawPlaylistId: Double): Long {
        if (!rawPlaylistId.isFinite()) {
            throw IllegalArgumentException("PLAYLIST_ID_INVALID")
        }

        val playlistId = rawPlaylistId.toLong()
        if (playlistId <= 0 || playlistId.toDouble() != rawPlaylistId) {
            throw IllegalArgumentException("PLAYLIST_ID_INVALID")
        }

        return playlistId
    }

    private fun normalizeSearchQuery(raw: String): String {
        return raw
            .replace(Regex("[\\u0000-\\u001F\\u007F]"), " ")
            .trim()
            .take(MAX_SEARCH_QUERY_LENGTH)
    }

    private fun normalizePlaylistName(raw: String): String {
        val normalized = raw
            .replace(Regex("[\\u0000-\\u001F\\u007F]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(MAX_PLAYLIST_NAME_LENGTH)

        if (normalized.isBlank()) {
            throw IllegalArgumentException("PLAYLIST_NAME_REQUIRED")
        }

        return normalized
    }

    private fun normalizeSearchScope(raw: String): String {
        return when (raw.trim().lowercase(Locale.US)) {
            "song_names" -> "song_names"
            "song_albums" -> "song_albums"
            "song_artists" -> "song_artists"
            "playlist_titles" -> "playlist_titles"
            else -> "all"
        }
    }

    private fun clampLimit(limit: Int, defaultLimit: Int, maxLimit: Int): Int {
        val safe = if (limit <= 0) defaultLimit else limit
        return safe.coerceAtMost(maxLimit)
    }

    private fun com.facebook.react.bridge.WritableArray.copyMapsTo(target: com.facebook.react.bridge.WritableArray) {
        for (index in 0 until size()) {
            getMap(index)?.let { target.pushMap(it) }
        }
    }

    private fun getStoredRootUris(): Set<String> {
        val prefs = reactApplicationContext.getSharedPreferences(STORAGE_PREFS_NAME, Activity.MODE_PRIVATE)
        return prefs.getStringSet(STORAGE_URI_KEY, emptySet()) ?: emptySet()
    }

}
