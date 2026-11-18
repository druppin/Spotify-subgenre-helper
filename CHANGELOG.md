# Changelog

What changed in each release of Spotify Subgenre Assistant. Downloads and
install steps are on the [Releases page](https://github.com/druppin/Spotify-subgenre-helper/releases).

## [1.4.0] - 2026-11-18

There was no 1.3.0 release; this follows 1.2.0.

### Added
- **Profiles**: separate sets of keys (Spotify app, AI, Last.fm), each with its own library, tags and snapshots. Each profile belongs to one Spotify account, and logging in with another one is refused.
- **Music folder**: songs tagged with a Spotify ID get measured for mix density (sparse or dense), which the AI uses as a tie-breaker for drum and bass styles. An optional sound model (an 18 MB download) listens to each song and finds the playlists holding songs that sound like it. New songs are scanned automatically.
- **Tag snapshots**: save a playlist's tags, compare against them later, and restore them.
- Liked Songs as a destination, and saved albums as sources, in the sorter.
- A song's record label in the sorter.
- Redo in bulk a playlist's songs that already have tags.
- Flows can take out songs they added that no longer fit.

### Changed
- Chat answers are formatted as Markdown.
- Slow AI answers time out instead of hanging, and OpenRouter is asked for its fastest hosts.
- Playlists created in one tab show up in your other tabs.
- Accounts that aren't on the Spotify app's user list get a clear message when logging in.

### Fixed
- Songs no longer get Last.fm tags from a different artist with the same name.
- Saved MusicBrainz lookups are reused instead of being fetched again.

## [1.2.0] - 2026-10-27

### Added
- **Listen mode**: sort playlists you don't own by playing them, with the sorter following whatever is playing.
- **AI on/off** in the sorter's quick actions, to just listen and file.
- A song's release year in the sorter, plus the release's own year when it came out later (a remaster, say).
- **Remove from all playlists**: one button takes a song out of every playlist it's in (Liked Songs is left alone).

## [1.1.0] - 2026-10-22

### Added
- **Compare versions of a song** that's in your library more than once, then keep one everywhere or mark them as different on purpose. ([#2](https://github.com/druppin/Spotify-subgenre-helper/issues/2))
- **Original release dates** from MusicBrainz. ([#1](https://github.com/druppin/Spotify-subgenre-helper/issues/1))
- Open any song from My library in the sorter's view.
- A seek bar in My library's player.
- Expand every song's genres and playlists at once.

### Fixed
- Searching large playlists in My library no longer lags. ([#3](https://github.com/druppin/Spotify-subgenre-helper/issues/3))
- Next.js updated to 16.3.8 for security fixes.

## [1.0.0] - 2026-10-20

The first public release.

### Added
- **Subgenre sorter**: play through a playlist while the AI suggests each song's mood and specific subgenres, with confidence and reasons, then file it into your playlists.
- Ask the AI about a song, and apply the tags it suggests.
- Edit tags, or tag songs yourself.
- **My library**: scan all your playlists and Liked Songs, find songs in no playlist, and tag hundreds at once.
- **Flows**: pool several playlists into one, with filters by genre or confidence.
- A local, key-protected **library API** for other programs.
- A record-shop design with light and dark themes.

[1.4.0]: https://github.com/druppin/Spotify-subgenre-helper/releases/tag/v1.4.0
[1.2.0]: https://github.com/druppin/Spotify-subgenre-helper/releases/tag/v1.2.0
[1.1.0]: https://github.com/druppin/Spotify-subgenre-helper/releases/tag/v1.1.0
[1.0.0]: https://github.com/druppin/Spotify-subgenre-helper/releases/tag/v1.0.0
