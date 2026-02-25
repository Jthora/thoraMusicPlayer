package com.androidmusicplayerapp

data class UserPlaylist(
    val id: Long,
    val name: String,
    val entryCount: Int,
    val updatedAtSec: Long,
)

data class UserPlaylistTrack(
    val position: Int,
    val uri: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val displayName: String,
    val relativePath: String,
)
