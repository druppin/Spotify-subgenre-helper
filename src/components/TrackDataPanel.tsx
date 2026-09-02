"use client";

import type { TrackContext } from "@/lib/llm/types";
import { formatMusicalKey } from "@/lib/musicKey";

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

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
