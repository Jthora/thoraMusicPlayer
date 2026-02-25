# Information Architecture Specification

## Top-Level Navigation
- Home
- Search
- Your Library
- Create
- Settings

## Home
### Sections
1. Recently Added
2. Last Played
3. Popular Songs

### Rules
- Remove legacy "Play from Library" CTA.
- No setup-first framing in primary home content.
- Last Played and Popular Songs may show placeholder state until analytics data is present.

## Search
### Intent
Single search surface for all key media entities.

### Default Behavior
- Default filter = All.
- Results can contain songs, albums, artists, playlists.

## Your Library
### Entry Behavior
- Always opens with `All Songs` selected.

### Top Pills
- Playlists
- Albums
- Artists
- All Songs

### Additional Content
- Recently played albums and playlists appear above pill section.

## Create
### Intent
Dedicated playlist creation and song-to-playlist authoring flow.

## Settings
### Layout
Navigation-controller style settings sections.

### Required First Section
Theme Color Control (presets + custom colors).

## Deprecated IA (To Remove)
- Legacy Library page naming and dead CTA behavior.
- Playlist creation tightly coupled to library browsing surface.
