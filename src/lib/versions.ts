import { sql } from "@/lib/db";
import { LIKED_SONGS_ID } from "@/lib/library";
import { recordOrganizeEvent } from "@/lib/organizeLog";
import { recordLikedAdd, recordLikedRemove, recordOwnEdit } from "@/lib/playlistIndex";
import type { SpotifyClient } from "@/lib/spotify/client";

/*
 * Keeping one version of a song: everywhere another version is (playlists
 * and Liked Songs), the kept one takes its place. Each change is described
 * well enough to undo it exactly, songs going back where they were.
 */

export interface VersionChange {
  placeId: string;
  // Whether the kept version was added here (it wasn't already in the place).
  keptAdded: boolean;
  // Versions taken out, with where they were (by the saved library).
  removed: { uri: string; position: number }[];
}

// Where each of these songs is, by the saved library.
function placesHolding(uris: string[]): Map<string, { uri: string; position: number }[]> {
  const byPlace = new Map<string, { uri: string; position: number }[]>();
  for (const uri of uris) {
    const rows = sql("SELECT place_id, position FROM place_tracks WHERE track_uri = ? ORDER BY position").all(uri) as {
      place_id: string;
      position: number;
    }[];
    for (const { place_id, position } of rows) {
      const list = byPlace.get(place_id) ?? [];
      list.push({ uri, position });
      byPlace.set(place_id, list);
    }
  }
  for (const list of byPlace.values()) list.sort((a, b) => a.position - b.position);
  return byPlace;
}

function holds(placeId: string, uri: string): boolean {
  return Boolean(sql("SELECT 1 FROM place_tracks WHERE place_id = ? AND track_uri = ?").get(placeId, uri));
}

/** The places keepVersion would change, for showing before it runs. */
export function previewKeepVersion(keep: string, others: string[]): VersionChange[] {
  return [...placesHolding(others.filter((uri) => uri !== keep))].map(([placeId, removed]) => ({
    placeId,
    keptAdded: !holds(placeId, keep),
    removed,
  }));
}

/**
 * Puts `keep` in place of `others` everywhere they are. In a playlist the
 * kept version goes where the first replaced one was; Liked Songs has no
 * order, so there it's just liked.
 */
export async function keepVersion(spotify: SpotifyClient, keep: string, others: string[]): Promise<VersionChange[]> {
  const changes = previewKeepVersion(keep, others);
  for (const change of changes) {
    const removedUris = [...new Set(change.removed.map((r) => r.uri))];
    if (change.placeId === LIKED_SONGS_ID) {
      if (change.keptAdded) {
        await spotify.saveToLibrary([keep]);
        await recordLikedAdd([keep]);
      }
      await spotify.removeFromLibrary(removedUris);
      await recordLikedRemove(removedUris);
    } else {
      // Added first, at the replaced version's spot, so removing the old
      // one afterwards leaves the kept one exactly there.
      if (change.keptAdded) {
        const position = change.removed[0].position;
        const snapshotId = await spotify.addTracksToPlaylistAt(change.placeId, [keep], position);
        await recordOwnEdit(change.placeId, { added: [keep], position }, snapshotId);
      }
      const snapshotId = await spotify.removeTracksFromPlaylist(change.placeId, removedUris);
      await recordOwnEdit(change.placeId, { removed: removedUris }, snapshotId);
    }
    if (change.keptAdded) {
      await recordOrganizeEvent({ action: "add", playlistId: change.placeId, uris: [keep], source: "lost-tracks" });
    }
    await recordOrganizeEvent({ action: "remove", playlistId: change.placeId, uris: removedUris, source: "lost-tracks" });
  }
  return changes;
}

/** Reverses keepVersion's changes: the old versions go back where they were. */
export async function undoKeepVersion(spotify: SpotifyClient, keep: string, changes: VersionChange[]): Promise<void> {
  for (const change of changes) {
    const removedUris = [...new Set(change.removed.map((r) => r.uri))];
    if (change.placeId === LIKED_SONGS_ID) {
      await spotify.saveToLibrary(removedUris);
      await recordLikedAdd(removedUris);
      if (change.keptAdded) {
        await spotify.removeFromLibrary([keep]);
        await recordLikedRemove([keep]);
      }
    } else {
      if (change.keptAdded) {
        const snapshotId = await spotify.removeTracksFromPlaylist(change.placeId, [keep]);
        await recordOwnEdit(change.placeId, { removed: [keep] }, snapshotId);
      }
      // Top to bottom, so each goes back at its old index.
      for (const { uri, position } of [...change.removed].sort((a, b) => a.position - b.position)) {
        const snapshotId = await spotify.addTracksToPlaylistAt(change.placeId, [uri], position);
        await recordOwnEdit(change.placeId, { added: [uri], position }, snapshotId);
      }
    }
    await recordOrganizeEvent({ action: "add", playlistId: change.placeId, uris: removedUris, source: "lost-tracks" });
    if (change.keptAdded) {
      await recordOrganizeEvent({ action: "remove", playlistId: change.placeId, uris: [keep], source: "lost-tracks" });
    }
  }
}
