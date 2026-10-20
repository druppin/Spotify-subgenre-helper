"use client";

import { useState } from "react";
import type { StoredTags } from "@/lib/llm/types";
import { useDisplayPrefs } from "@/lib/displayPrefs";
import { CloseIcon } from "./Icons";
import { FAMILY_NAMES, familyMark, familyOf } from "@/lib/genreFamily";

// The song's own tags (which can be edited), the broader genres they roll
// up into, and how sure the AI is of each.
export type EditableGenres = StoredTags;

export interface SavedGenres extends StoredTags {
  subgenres: string[];
}

/**
 * How sure the AI is, as an exact-length bar and/or a percentage (the
 * viewer's choice in Settings). `mark` colours the bar; scores under 45
 * read as weak guesses.
 */
export function ConfidenceMeter({
  score,
  mark = "var(--ink)",
  width = 40,
  stacked = false,
  faded = false,
}: {
  score: number;
  mark?: string;
  // Pixels, or any CSS width ("100%" to fill a grid cell).
  width?: number | string;
  // Percentage above the bar (narrow columns) rather than beside it.
  stacked?: boolean;
  // Drawn lighter, for a weak guess.
  faded?: boolean;
}) {
  const { confidence } = useDisplayPrefs();
  const bar = confidence !== "percent" && (
    <span
      className={`relative inline-block h-1 rounded-full bg-line ${typeof width === "number" ? "flex-shrink-0" : "min-w-0 flex-1"}`}
      style={{ width }}
      aria-hidden
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${score}%`, background: mark, opacity: faded ? 0.6 : 1 }}
      />
    </span>
  );
  // With bars only, screen readers still get the number.
  const percent =
    confidence !== "bars" ? (
      <span className="text-[11.5px] font-medium tabular-nums text-muted">{score}%</span>
    ) : (
      <span className="sr-only">{score}% confident</span>
    );
  return (
    <span
      className={`inline-flex ${typeof width === "number" ? "flex-shrink-0" : "w-full min-w-0"} ${
        stacked ? "flex-col items-end gap-1" : "items-center gap-1.5"
      }`}
      title={`The AI is ${score}% confident`}
    >
      {stacked ? (
        <>
          {percent}
          {bar}
        </>
      ) : (
        <>
          {bar}
          {percent}
        </>
      )}
    </span>
  );
}

/**
 * A song's tags: each own tag with its genre family's dot and the AI's
 * confidence (or "yours" for tags the user added), then the broader genres
 * they roll up into. "md" lists them one per line for the summary card;
 * "sm" runs them inline for a table row. A weak guess (under 45%) gets a
 * dashed underline.
 */
export function GenreChips({ genres, size = "md" }: { genres: StoredTags; size?: "sm" | "md" }) {
  const tags = genres.own.map((genre) => {
    const family = familyOf(genre, genres.broader);
    const score = genres.confidence[genre];
    const mine = genres.userTags.includes(genre);
    return { genre, family, score, mine, weak: score !== undefined && score < 45 };
  });
  const name = (t: (typeof tags)[number]) => (
    <span
      className={`min-w-0 justify-self-start truncate ${t.weak ? "border-b border-dashed" : ""}`}
      style={t.weak ? { borderColor: familyMark(t.family) } : undefined}
    >
      {t.genre}
    </span>
  );
  const dot = (t: (typeof tags)[number], px: number) => (
    <span
      className="flex-shrink-0 rounded-full"
      style={{ width: px, height: px, background: familyMark(t.family) }}
      title={FAMILY_NAMES[t.family]}
    />
  );
  const score = (t: (typeof tags)[number], width: number | string) =>
    t.mine ? (
      <span className="text-[11.5px] text-muted" title="You added this tag">
        yours
      </span>
    ) : t.score !== undefined ? (
      <ConfidenceMeter score={t.score} mark={familyMark(t.family)} width={width} faded={t.weak} />
    ) : (
      <span className="text-[11.5px] text-faint" title="Not scored yet">
        unscored
      </span>
    );

  if (size === "sm") {
    return (
      <>
        {tags.map((t) => (
          <span key={t.genre} className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold">
            {dot(t, 7)}
            {name(t)}
            {score(t, 28)}
          </span>
        ))}
        {genres.broader.length > 0 && (
          <span className="truncate text-[12px] text-muted" title="The broader genres these tags belong to">
            in {genres.broader.join(", ")}
          </span>
        )}
      </>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2">
      {tags.map((t) => (
        <div
          key={t.genre}
          className="grid grid-cols-[10px_minmax(7.5rem,max-content)_minmax(0,1fr)] items-center gap-2.5 text-[13px] font-semibold"
        >
          {dot(t, 9)}
          {name(t)}
          <span className="flex min-w-0">{score(t, "100%")}</span>
        </div>
      ))}
      {genres.broader.length > 0 && (
        <span className="text-[12.5px] text-muted">
          {genres.own.length === 1 ? "Part of" : "These roll up into"} {genres.broader.join(", ")}.
        </span>
      )}
    </div>
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
            className={`inline-flex items-center gap-1 rounded-full bg-raised py-0.5 pl-2 pr-1 ${text} text-ink`}
          >
            {tag}
            <button
              type="button"
              onClick={() => setTags(tags.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
              title="Remove"
              className="rounded-full px-1 leading-none text-muted hover:bg-line hover:text-ink"
            >
              <CloseIcon size={11} />
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
          className={`min-w-24 flex-1 rounded border border-line-strong bg-ground px-1.5 py-0.5 ${text} text-ink placeholder:text-faint focus:border-ink-2 focus:outline-none`}
        />
      </div>
      <div className={`flex items-center gap-2 ${text}`}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded bg-ink px-2 py-0.5 font-medium text-ground hover:bg-ink-2 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="text-muted hover:text-ink">
          Cancel
        </button>
        {error && <span className="text-danger">{error}</span>}
      </div>
    </div>
  );
}
