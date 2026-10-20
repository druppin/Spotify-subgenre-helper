"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { GenreChips, type SavedGenres } from "./GenreTagEditor";
import { CheckIcon } from "./Icons";

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  // Tags the AI proposed in this answer, and whether they were applied.
  suggestion?: { tags: { genre: string; confidence: number }[] } | null;
  applied?: boolean;
}

/**
 * Follow-up questions to the AI about one song: why it chose the tags,
 * what it knows about the song or a genre, and so on. The conversation is
 * saved per song, so it's still there when the song comes up again.
 */
export function TrackChat({
  trackId,
  firstTag,
  onTagsApplied,
}: {
  trackId: string;
  firstTag?: string;
  // Hears the song's tags after the user applies ones the AI suggested.
  onTagsApplied?: (tags: SavedGenres) => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  // The question waiting on an answer, shown until it's saved.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/track/${trackId}/chat`)
      .then((res) => res.json())
      .then((body) => !cancelled && setMessages(body.messages ?? []))
      .catch(() => !cancelled && setMessages([]));
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  const ask = async (question: string) => {
    question = question.trim();
    if (!question || pending) return;
    setPending(question);
    setDraft("");
    setError(null);
    try {
      // The AI can take a while on a long answer; the server gives it 60s
      // plus one retry.
      const res = await fetchWithTimeout(
        `/api/track/${trackId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        },
        150_000
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessages(body.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Put the question back so it can be sent again.
      setDraft(question);
    } finally {
      setPending(null);
    }
  };

  const [applyingId, setApplyingId] = useState<number | null>(null);
  const apply = async (messageId: number) => {
    setApplyingId(messageId);
    setError(null);
    try {
      const res = await fetch(`/api/track/${trackId}/chat/${messageId}/apply`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessages(body.messages);
      onTagsApplied?.(body.tags);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  };

  const startOver = async () => {
    await fetch(`/api/track/${trackId}/chat`, { method: "DELETE" }).catch(() => {});
    setMessages([]);
    setError(null);
  };

  const suggestions = firstTag
    ? ["Why did you tag it this way?", "What do you know about this song?", `Tell me about ${firstTag}.`]
    : ["Suggest tags for this song.", "What do you know about this song?"];

  if (messages === null) return null;

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">Ask the AI about this song</p>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => void startOver()}
            disabled={!!pending}
            title="Delete this conversation and start a new one"
            className="text-xs text-muted hover:text-danger disabled:opacity-50"
          >
            Start over
          </button>
        )}
      </div>

      {(messages.length > 0 || pending) && (
        <div ref={listRef} className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {messages.map((m) => (
            <div key={m.id} className="space-y-1.5">
              <ChatBubble role={m.role} content={m.content} />
              {m.suggestion && (
                <SuggestedTags
                  suggestion={m.suggestion}
                  applied={!!m.applied}
                  busy={applyingId === m.id}
                  onApply={() => void apply(m.id)}
                />
              )}
            </div>
          ))}
          {pending && (
            <>
              <ChatBubble role="user" content={pending} />
              <p className="text-xs text-muted">Thinking…</p>
            </>
          )}
        </div>
      )}

      {messages.length === 0 && !pending && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              className="rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-ink-2 hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter starts a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
          rows={1}
          placeholder="Ask a follow-up question…"
          aria-label="Ask the AI a question about this song"
          className="max-h-32 min-h-[2rem] flex-1 resize-y rounded-md border border-line-strong bg-ground px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-ink-2 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || !!pending}
          className="rounded-md bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-ground hover:bg-ink-2 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

function ChatBubble({ role, content }: { role: Message["role"]; content: string }) {
  return (
    <div
      className={`whitespace-pre-wrap px-3 py-2 text-[13px] leading-relaxed ${
        role === "user"
          ? "ml-10 rounded-[10px_10px_3px_10px] bg-raised text-ink"
          : "mr-10 rounded-[10px_10px_10px_3px] bg-ground text-ink-2"
      }`}
    >
      {content}
    </div>
  );
}

// Tags the AI proposed in an answer: shown like the song's own tags, with
// a button to make them the song's tags. Nothing changes until it's pressed.
function SuggestedTags({
  suggestion,
  applied,
  busy,
  onApply,
}: {
  suggestion: NonNullable<Message["suggestion"]>;
  applied: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  const own = suggestion.tags.map((t) => t.genre);
  const confidence = Object.fromEntries(suggestion.tags.map((t) => [t.genre, t.confidence]));
  return (
    <div className="mr-10 space-y-2 rounded-md border border-line-strong px-3 py-2">
      <p className="text-xs font-semibold text-muted">Suggested tags</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <GenreChips
          size="sm"
          genres={{ own, broader: [], edited: false, confidence, userTags: [], songConfidence: null }}
        />
      </div>
      {applied ? (
        <p className="inline-flex items-center gap-1 text-xs font-medium text-ok">
          <CheckIcon size={13} />
          Applied
        </p>
      ) : (
        <button
          type="button"
          onClick={onApply}
          disabled={busy}
          title="Replace this song's tags with these"
          className="rounded-md bg-ink px-3 py-1 text-[12.5px] font-semibold text-ground hover:bg-ink-2 disabled:opacity-50"
        >
          {busy ? "Applying…" : "Apply these tags"}
        </button>
      )}
    </div>
  );
}
