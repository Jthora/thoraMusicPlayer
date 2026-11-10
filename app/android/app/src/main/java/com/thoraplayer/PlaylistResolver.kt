package com.thoraplayer

import java.io.StringReader
import java.net.URLDecoder
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.text.Normalizer
import java.util.Locale
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

/** A track in the library index, as far as playlist matching needs it. */
data class PlaylistLibraryTrack(
    val uri: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val displayName: String,
    val relativePath: String,
)

data class ParsedPlaylistEntry(
    val lineNumber: Int,
    val location: String,
    val title: String? = null,
    val artist: String? = null,
    val durationMs: Long? = null,
)

data class ParsedPlaylistFile(
    val name: String?,
    val format: String,
    val entries: List<ParsedPlaylistEntry>,
)

/** Reads m3u/m3u8 (with #EXTINF and #PLAYLIST), pls and xspf. */
object PlaylistFileParser {
    private val windows1252: Charset = Charset.forName("windows-1252")

    /** UTF-8/16 with or without BOM; legacy Winamp files that aren't valid UTF-8 are Windows-1252. */
    fun decode(bytes: ByteArray): String {
        fun startsWith(vararg prefix: Int) = bytes.size >= prefix.size && prefix.indices.all { bytes[it] == prefix[it].toByte() }
        return when {
            startsWith(0xEF, 0xBB, 0xBF) -> String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
            startsWith(0xFF, 0xFE) -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
            startsWith(0xFE, 0xFF) -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
            else -> try {
                Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString()
            } catch (_: CharacterCodingException) {
                String(bytes, windows1252)
            }
        }
    }

    fun parse(text: String, fileName: String): ParsedPlaylistFile {
        val lowered = fileName.lowercase(Locale.US)
        val head = text.trimStart().take(200).lowercase(Locale.US)
        return when {
            lowered.endsWith(".pls") || head.startsWith("[playlist]") -> parsePls(text)
            lowered.endsWith(".xspf") || (head.startsWith("<?xml") && text.contains("xspf.org")) -> parseXspf(text)
            else -> parseM3u(text, if (lowered.endsWith(".m3u8")) "m3u8" else "m3u")
        }
    }

    private fun parseM3u(text: String, format: String): ParsedPlaylistFile {
        var name: String? = null
        var pendingTitle: String? = null
        var pendingArtist: String? = null
        var pendingDuration: Long? = null
        val entries = mutableListOf<ParsedPlaylistEntry>()
        text.lineSequence().forEachIndexed { index, raw ->
            val line = raw.trim()
            when {
                line.isEmpty() -> Unit
                line.startsWith("#PLAYLIST:", ignoreCase = true) -> name = line.substringAfter(':').trim().ifBlank { null }
                line.startsWith("#EXTINF:", ignoreCase = true) -> {
                    val body = line.substringAfter(':')
                    val seconds = body.substringBefore(',').trim().split(' ').firstOrNull()?.toDoubleOrNull()
                    pendingDuration = seconds?.takeIf { it > 0 }?.let { (it * 1000).toLong() }
                    val display = if (body.contains(',')) body.substringAfter(',').trim() else ""
                    val split = splitArtistTitle(display)
                    pendingArtist = split.first
                    pendingTitle = split.second
                }
                line.startsWith("#") -> Unit
                else -> {
                    entries.add(ParsedPlaylistEntry(index + 1, line, pendingTitle, pendingArtist, pendingDuration))
                    pendingTitle = null
                    pendingArtist = null
                    pendingDuration = null
                }
            }
        }
        return ParsedPlaylistFile(name, format, entries)
    }

    private fun parsePls(text: String): ParsedPlaylistFile {
        val files = sortedMapOf<Int, String>()
        val titles = mutableMapOf<Int, String>()
        val lengths = mutableMapOf<Int, Long>()
        val lines = mutableMapOf<Int, Int>()
        val keyPattern = Regex("^(File|Title|Length)(\\d+)$", RegexOption.IGNORE_CASE)
        text.lineSequence().forEachIndexed { index, raw ->
            val line = raw.trim()
            val key = line.substringBefore('=', "").trim()
            val match = keyPattern.matchEntire(key) ?: return@forEachIndexed
            val number = match.groupValues[2].toInt()
            val value = line.substringAfter('=').trim()
            when (match.groupValues[1].lowercase(Locale.US)) {
                "file" -> {
                    files[number] = value
                    lines[number] = index + 1
                }
                "title" -> titles[number] = value
                "length" -> value.toLongOrNull()?.takeIf { it > 0 }?.let { lengths[number] = it * 1000 }
            }
        }
        val entries = files.map { (number, location) ->
            val split = splitArtistTitle(titles[number].orEmpty())
            ParsedPlaylistEntry(lines[number] ?: 0, location, split.second, split.first, lengths[number])
        }
        return ParsedPlaylistFile(null, "pls", entries)
    }

    private fun parseXspf(text: String): ParsedPlaylistFile {
        val parser = XmlPullParserFactory.newInstance().apply { isNamespaceAware = false }.newPullParser()
        parser.setInput(StringReader(text))
        var name: String? = null
        val entries = mutableListOf<ParsedPlaylistEntry>()
        var inTrack = false
        var location: String? = null
        var title: String? = null
        var creator: String? = null
        var duration: Long? = null
        var trackLine = 0
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) {
                when (parser.name.substringAfter(':')) {
                    "track" -> {
                        inTrack = true
                        location = null; title = null; creator = null; duration = null
                        trackLine = parser.lineNumber
                    }
                    "location" -> if (inTrack && location == null) location = parser.nextText().trim()
                    "title" -> if (inTrack) title = parser.nextText().trim() else if (name == null) name = parser.nextText().trim()
                    "creator" -> if (inTrack) creator = parser.nextText().trim()
                    "duration" -> if (inTrack) duration = parser.nextText().trim().toLongOrNull()
                }
            } else if (event == XmlPullParser.END_TAG && parser.name.substringAfter(':') == "track") {
                inTrack = false
                val loc = location
                if (!loc.isNullOrBlank()) {
                    entries.add(ParsedPlaylistEntry(trackLine, loc, title?.ifBlank { null }, creator?.ifBlank { null }, duration))
                }
            }
            event = parser.next()
        }
        return ParsedPlaylistFile(name?.ifBlank { null }, "xspf", entries)
    }

    /** "Artist - Title" -> (artist, title); text without a separator is just a title. */
    private fun splitArtistTitle(display: String): Pair<String?, String?> {
        val trimmed = display.trim()
        if (trimmed.isEmpty()) return null to null
        val separator = trimmed.indexOf(" - ")
        return if (separator > 0) {
            trimmed.substring(0, separator).trim().ifBlank { null } to trimmed.substring(separator + 3).trim().ifBlank { null }
        } else {
            null to trimmed
        }
    }
}

data class PlaylistEntryResolution(
    val status: String, // resolved | unresolved | unsupported
    val reasonCode: String,
    val track: PlaylistLibraryTrack? = null,
)

/**
 * Matches playlist entries to library tracks, using the same ladder as the Mac repair tool
 * (docs/production/playlist-matching-spec.md): exact path -> moved folders (longest path suffix)
 * -> changed format (same name, other extension) -> tags -> unique file name. A guess between
 * several equally good candidates is never made: the entry stays unresolved instead.
 *
 * @param playlistFolder the playlist's own folder on the device ("Music/Thora/_playlists"),
 *   used to resolve relative entries; null when unknown.
 */
class PlaylistEntryResolver(tracks: List<PlaylistLibraryTrack>, private val playlistFolder: String?) {
    private val byUri = HashMap<String, PlaylistLibraryTrack>()
    private val byPath = HashMap<String, PlaylistLibraryTrack>()
    private val byName = HashMap<String, MutableList<PlaylistLibraryTrack>>()
    private val byStem = HashMap<String, MutableList<PlaylistLibraryTrack>>()
    private val byTitle = HashMap<String, MutableList<PlaylistLibraryTrack>>()

    init {
        tracks.forEach { track ->
            byUri[track.uri] = track
            val name = track.displayName.lowercase(Locale.ROOT)
            if (name.isNotEmpty()) {
                byPath.putIfAbsent(pathKey(folderOf(track), name), track)
                byName.getOrPut(name) { mutableListOf() }.add(track)
                byStem.getOrPut(stemOf(name)) { mutableListOf() }.add(track)
            }
            normalizeText(track.title).takeIf { it.isNotEmpty() }?.let { byTitle.getOrPut(it) { mutableListOf() }.add(track) }
        }
    }

    fun resolve(entry: ParsedPlaylistEntry): PlaylistEntryResolution {
        val raw = entry.location.trim()
        val lowered = raw.lowercase(Locale.ROOT)
        if (raw.isEmpty()) return unsupported("EMPTY_ENTRY")
        if (Regex("^(https?|rtsp|rtmp|mms|spotify):").containsMatchIn(lowered)) return unsupported("UNSUPPORTED_URI")
        if (lowered.startsWith("content://")) {
            byUri[raw]?.let { return resolved("CANONICAL_MATCH", it) }
            return byTags(entry) ?: unresolved("NO_MATCH")
        }

        val path = toSlashPath(raw)
        val segments = path.split('/').filter { it.isNotEmpty() }
        val fileName = segments.lastOrNull()?.lowercase(Locale.ROOT) ?: return unsupported("EMPTY_ENTRY")

        val device = devicePath(path)
        if (device != null) {
            val folder = device.substringBeforeLast('/', "")
            byPath[pathKey(folder, device.substringAfterLast('/').lowercase(Locale.ROOT))]?.let { return resolved("EXACT_PATH", it) }
        }
        // Compare folders using where a relative entry actually points ("../x.mp3" -> Music/Thora-test),
        // falling back to the raw path for entries from another machine ("C:/Users/…").
        val folders = (device?.split('/') ?: segments).dropLast(1).filter { it.isNotEmpty() && it != ".." && it != "." }

        bestByFolders(byName[fileName].orEmpty(), folders, entry)?.let { (track, reason) ->
            return resolved(if (reason == "SUFFIX") "PATH_SUFFIX" else reason, track)
        }
        val stem = stemOf(fileName)
        val otherFormats = byStem[stem].orEmpty().filter { it.displayName.lowercase(Locale.ROOT) != fileName }
        bestByFolders(otherFormats, folders, entry, requireFolder = true)?.let { (track, _) ->
            return resolved("FORMAT_CHANGE", track)
        }
        byTags(entry)?.let { return it }
        return if (byName[fileName].orEmpty().size > 1) unresolved("AMBIGUOUS_FILENAME") else unresolved("NO_MATCH")
    }

    /**
     * Among same-named candidates, pick the one sharing the most trailing folders with the entry
     * (handles moved parent folders). Ties are broken by tags; a unique file name with no shared
     * folder is accepted unless [requireFolder].
     */
    private fun bestByFolders(
        candidates: List<PlaylistLibraryTrack>,
        entryFolders: List<String>,
        entry: ParsedPlaylistEntry,
        requireFolder: Boolean = false,
    ): Pair<PlaylistLibraryTrack, String>? {
        if (candidates.isEmpty()) return null
        val scored = candidates.map { it to trailingCommon(entryFolders, folderOf(it).split('/').filter(String::isNotEmpty)) }
        val best = scored.maxOf { it.second }
        val top = scored.filter { it.second == best }.map { it.first }
        if (best > 0) {
            return if (top.size == 1) top[0] to "SUFFIX" else pickByTags(top, entry)?.let { it to "TAG_DISAMBIGUATED" }
        }
        // Nothing in common with the entry's folders.
        if (requireFolder || top.size > 1) return pickByTags(top, entry)?.let { it to "TAG_DISAMBIGUATED" }
        val only = top[0]
        val hasTags = entry.title != null || entry.artist != null || entry.durationMs != null
        return when {
            hasTags -> pickByTags(top, entry)?.let { it to "UNIQUE_FILENAME" } // tags must agree
            isDistinctive(only.displayName) -> only to "UNIQUE_FILENAME"
            else -> null // "01 Intro.mp3" somewhere else is a guess, not a match
        }
    }

    private fun byTags(entry: ParsedPlaylistEntry): PlaylistEntryResolution? {
        val title = entry.title ?: titleFromLocation(entry.location)?.second ?: return null
        val artist = entry.artist ?: titleFromLocation(entry.location)?.first
        val candidates = byTitle[normalizeText(title)].orEmpty()
        return pickByTags(candidates, entry.copy(title = title, artist = artist))?.let { resolved("TAG_MATCH", it) }
    }

    /** One candidate agreeing with the entry's artist and duration (when known), or null. */
    private fun pickByTags(candidates: List<PlaylistLibraryTrack>, entry: ParsedPlaylistEntry): PlaylistLibraryTrack? {
        if (candidates.isEmpty()) return null
        val artist = entry.artist?.let(::normalizeText)?.takeIf { it.isNotEmpty() }
        val title = entry.title?.let(::normalizeText)?.takeIf { it.isNotEmpty() }
        if (artist == null && title == null && entry.durationMs == null) return null
        // Each known field must agree; a field the track lacks (no tag, unknown duration) doesn't count against it.
        val agreeing = candidates.filter { track ->
            val trackArtist = normalizeText(track.artist).takeUnless { it.isEmpty() || it == "unknown artist" }
            val trackTitle = normalizeText(track.title).takeUnless { it.isEmpty() }
            (artist == null || trackArtist == null || trackArtist.contains(artist) || artist.contains(trackArtist)) &&
                (title == null || trackTitle == null || trackTitle == title) &&
                (entry.durationMs == null || track.durationMs <= 0 || kotlin.math.abs(track.durationMs - entry.durationMs) <= 3_000)
        }
        return agreeing.singleOrNull()
    }

    private fun isDistinctive(displayName: String): Boolean {
        val core = stemOf(displayName).replace(Regex("^\\d{1,3}([ ._-]+\\d{1,3})?[ ._-]*"), "").trim().lowercase(Locale.ROOT)
        return core.length >= 6 && core !in GENERIC_NAMES && !Regex("^(track|audio|untitled)\\s*\\d*$").matches(core)
    }

    private fun titleFromLocation(location: String): Pair<String?, String?>? {
        val stem = stemOf(toSlashPath(location).substringAfterLast('/'))
            .replace(Regex("^\\d{1,3}([ ._-]+\\d{1,3})?[ ._-]+"), "")
        if (stem.isBlank()) return null
        val separator = stem.indexOf(" - ")
        return if (separator > 0) stem.substring(0, separator) to stem.substring(separator + 3) else null to stem
    }

    /** Where an entry points on this device ("Music/Thora/library/x.mp3"), when that can be known. */
    private fun devicePath(path: String): String? {
        val lowered = path.lowercase(Locale.ROOT)
        for (prefix in DEVICE_PREFIXES) {
            if (lowered.startsWith(prefix)) return canonicalize(path.substring(prefix.length))
        }
        if (path.startsWith("/") || Regex("^[a-zA-Z]:/").containsMatchIn(path) || path.startsWith("//")) return null
        return canonicalize(if (playlistFolder.isNullOrBlank()) path else "$playlistFolder/$path")
    }

    private fun resolved(reason: String, track: PlaylistLibraryTrack) = PlaylistEntryResolution("resolved", reason, track)
    private fun unresolved(reason: String) = PlaylistEntryResolution("unresolved", reason)
    private fun unsupported(reason: String) = PlaylistEntryResolution("unsupported", reason)

    companion object {
        private val DEVICE_PREFIXES = listOf("/storage/emulated/0/", "/sdcard/", "/storage/self/primary/", "/mnt/sdcard/")
        private val GENERIC_NAMES = setOf("intro", "outro", "interlude", "untitled", "prologue", "epilogue", "opening", "ending", "theme", "main theme", "reprise", "bonus track", "hidden track", "skit")

        fun toSlashPath(raw: String): String {
            var value = raw.trim().replace('\\', '/')
            if (value.lowercase(Locale.ROOT).startsWith("file://")) {
                value = value.substring(7).let { if (it.startsWith("localhost/")) it.substring(9) else it }
                value = runCatching { URLDecoder.decode(value.replace("+", "%2B"), "UTF-8") }.getOrDefault(value)
                if (Regex("^/[a-zA-Z]:/").containsMatchIn(value)) value = value.substring(1) // file:///C:/...
            }
            return value
        }

        /** Resolve "." and ".." segments; ".." above the root is dropped. */
        fun canonicalize(path: String): String {
            val stack = ArrayDeque<String>()
            path.split('/').map { it.trim() }.filter { it.isNotEmpty() && it != "." }.forEach { segment ->
                if (segment == "..") stack.removeLastOrNull() else stack.addLast(segment)
            }
            return stack.joinToString("/")
        }

        fun folderOf(track: PlaylistLibraryTrack): String = track.relativePath.replace('\\', '/').trim('/')

        private fun pathKey(folder: String, lowerName: String) = "${folder.trim('/').lowercase(Locale.ROOT)}/$lowerName"

        fun stemOf(name: String): String = name.substringBeforeLast('.', name)

        private fun trailingCommon(left: List<String>, right: List<String>): Int {
            var count = 0
            while (count < left.size && count < right.size &&
                left[left.size - 1 - count].equals(right[right.size - 1 - count], ignoreCase = true)
            ) count += 1
            return count
        }

        private val bracketNoise = Regex("[(\\[][^)\\]]*(remaster|feat\\.?|ft\\.|explicit|radio edit|bonus|mono|stereo)[^)\\]]*[)\\]]", RegexOption.IGNORE_CASE)
        private val featTail = Regex("\\s+(feat\\.?|ft\\.)\\s.*$", RegexOption.IGNORE_CASE)
        private val combining = Regex("\\p{Mn}+")
        private val nonAlnum = Regex("[^\\p{L}\\p{N}]+")

        /** Case, accents, punctuation, "(Remastered …)" and "feat." are ignored when comparing tags. */
        fun normalizeText(value: String?): String {
            if (value.isNullOrBlank()) return ""
            val stripped = featTail.replace(bracketNoise.replace(value, " "), "")
            val decomposed = Normalizer.normalize(stripped, Normalizer.Form.NFKD)
            return nonAlnum.replace(combining.replace(decomposed, ""), " ").trim().lowercase(Locale.ROOT)
        }
    }
}
