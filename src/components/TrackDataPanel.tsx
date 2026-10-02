"use client";

import type { TrackContext } from "@/lib/llm/types";
import { formatMusicalKey } from "@/lib/musicKey";
import type { GenreVote, MusicBrainzInfo } from "@/lib/musicbrainz";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-800 px-2 py-1.5 text-center">
      <div className="text-sm font-semibold text-neutral-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function TrackDataPanel({ context }: { context: TrackContext }) {
  const tags = [...new Set([...context.artistGenres, ...context.lastfmTrackTags, ...context.lastfmArtistTags])];

  return (
    <div className="space-y-3">
      {context.audioFeatures ? (
        <div className="grid grid-cols-4 gap-1.5">
          <Stat label="BPM" value={Math.round(context.audioFeatures.tempo).toString()} />
          <Stat
            label="Key"
            value={formatMusicalKey(context.audioFeatures.key, context.audioFeatures.mode)}
          />
          <Stat label="Energy" value={pct(context.audioFeatures.energy)} />
          <Stat label="Dance" value={pct(context.audioFeatures.danceability)} />
          <Stat label="Valence" value={pct(context.audioFeatures.valence)} />
          <Stat label="Acoustic" value={pct(context.audioFeatures.acousticness)} />
          <Stat label="Instrumental" value={pct(context.audioFeatures.instrumentalness)} />
          <Stat label="Live" value={pct(context.audioFeatures.liveness)} />
        </div>
      ) : (
        <p className="text-xs text-neutral-500">No audio feature data available for this track.</p>
      )}

      <MusicBrainzVotes info={context.musicbrainz} />

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
              {tag}
            </span>
          ))}
        </div>
      )}

      <a
        href={`https://rateyourmusic.com/search?searchtype=l&searchterm=${encodeURIComponent(
          `${context.artistNames[0] ?? ""} ${context.albumName}`
        )}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-neutral-500 hover:text-green-400"
      >
        Look up on RateYourMusic ↗
      </a>
    </div>
  );
}

function VoteRow({ label, title, votes }: { label: string; title: string; votes: GenreVote[] }) {
  if (votes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500" title={title}>
        {label}
      </span>
      {votes.map((g) => (
        <span key={g.name} className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">
          {g.name}
          <span className="ml-1 text-sky-300/60">{g.votes}</span>
        </span>
      ))}
    </div>
  );
}

function MusicBrainzVotes({ info }: { info: MusicBrainzInfo }) {
  if (!info.matchedRecording) return null;
  const hasAny =
    info.recordingTags.length > 0 ||
    info.releaseGroupGenres.length > 0 ||
    info.artistGenres.some((a) => a.genres.length > 0);
  if (!hasAny) return null;
  const matched = `Matched MusicBrainz recording: ${info.matchedRecording}. Numbers are community votes.`;
  return (
    <div className="space-y-1">
      <VoteRow label="MB track" title={matched} votes={info.recordingTags} />
      <VoteRow label="MB release" title={matched} votes={info.releaseGroupGenres} />
      {info.artistGenres.map((a) => (
        <VoteRow key={a.artist} label={`MB · ${a.artist}`} title={matched} votes={a.genres} />
      ))}
    </div>
  );
}
