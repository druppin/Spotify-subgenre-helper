"use client";

import { useState } from "react";
import type { StoredTags } from "@/lib/llm/types";

// The song's own tags (which can be edited), the broader genres they roll
// up into, and how sure the AI is of each.
export type EditableGenres = StoredTags;

export interface SavedGenres extends StoredTags {
  subgenres: string[];
}

// Low scores stand out so shaky tags are easy to spot.
export function confidenceColor(score: number): string {
  if (score >= 75) return "text-green-300";
  if (score >= 50) return "text-yellow-300/90";
  return "text-amber-500";
}

/**
 * A song's tags as chips: its own tags with the AI's confidence in each
 * (or "you" for tags the user added), then the broader genres, outlined.
 */
export function GenreChips({ genres, size = "md" }: { genres: StoredTags; size?: "sm" | "md" }) {
  const chip = size === "sm" ? "px-1.5 py-px text-[11px]" : "px-2 py-0.5 text-xs";
  return (
    <>
      {genres.own.map((genre) => {
        const score = genres.confidence[genre];
        const mine = genres.userTags.includes(genre);
        return (
          <span
            key={genre}
            title={
              mine
                ? "You added this tag"
                : score !== undefined
                  ? `The AI is ${score}% confident in this tag`
                  : "Not scored yet"
            }
            className={`inline-flex items-baseline gap-1 rounded-full bg-green-600/20 ${chip} text-green-400`}
          >
            {genre}
            {mine ? (
              <span className="text-[0.85em] text-neutral-400">you</span>
            ) : (
              score !== undefined && (
                <span className={`text-[0.85em] tabular-nums ${confidenceColor(score)}`}>{score}%</span>
              )
            )}
          </span>
        );
      })}
      {genres.broader.map((genre) => (
        <span
          key={genre}
          title="A broader genre the tags belong to"
          className={`rounded-full border border-green-600/30 ${chip} text-green-400/70`}
        >
          {genre}
        </span>
      ))}
    </>
  );
}

/** Saves a song's tags; resolves with them as stored, or throws the reason it failed. */
export async function saveGenreTags(trackId: string, tags: string[]): Promise<SavedGenres> {
  const res = await fetch(`/api/track/${trackId}/genres`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/**
 * A song's tags as chips, with a way to remove them, add new ones, and
 * save. The broader genres follow from the own tags, so they're shown but
 * not edited. `size` "sm" fits a table row.
 */
export function GenreTagEditor({
  genres,
  onSave,
  onCancel,
  size = "md",
}: {
  genres: EditableGenres;
  onSave: (tags: string[]) => Promise<void>;
  onCancel: () => void;
  size?: "sm" | "md";
}) {
  const [tags, setTags] = useState(genres.own);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = size === "sm" ? "text-[11px]" : "text-xs";

  // Commas separate several tags typed at once.
  const addDraft = (): string[] => {
    const added = draft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const next = [...tags];
    for (const tag of added) {
      if (!next.some((t) => t.toLowerCase() === tag.toLowerCase())) next.push(tag);
    }
    setTags(next);
    setDraft("");
    return next;
  };

  const save = async () => {
    // A tag still being typed counts.
    const final = draft.trim() ? addDraft() : tags;
    if (final.length === 0) {
      setError("Keep at least one tag.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(final);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 rounded-full bg-green-600/20 py-0.5 pl-2 pr-1 ${text} text-green-400`}
          >
            {tag}
            <button
              type="button"
              onClick={() => setTags(tags.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
              title="Remove"
              className="rounded-full px-1 leading-none text-green-300/70 hover:bg-green-600/30 hover:text-white"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) addDraft();
              else void save();
            } else if (e.key === "Escape") {
              onCancel();
            } else if (e.key === "Backspace" && !draft && tags.length > 0) {
              setTags(tags.slice(0, -1));
            }
          }}
          placeholder="Add a tag…"
          aria-label="Add a tag"
          autoFocus
          className={`min-w-24 flex-1 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 ${text} text-neutral-200 placeholder:text-neutral-600 focus:border-green-600 focus:outline-none`}
        />
      </div>
      <div className={`flex items-center gap-2 ${text}`}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded bg-green-600 px-2 py-0.5 font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="text-neutral-400 hover:text-neutral-200">
          Cancel
        </button>
        {error && <span className="text-red-400">{error}</span>}
      </div>
    </div>
  );
}
